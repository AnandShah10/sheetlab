/**
 * Column / range descriptive statistics and chart series for SheetLab Tools.
 * Pure functions — no vscode/DOM.
 */

import { Worksheet, Cell, CellRange } from '../types/workbook';

export interface ColumnStats {
  sheetName: string;
  col: number;
  /** A1-style header or letter */
  label: string;
  rowStart: number;
  rowEnd: number;
  count: number;
  nonBlank: number;
  blank: number;
  numbers: number;
  texts: number;
  dates: number;
  bools: number;
  errors: number;
  formulas: number;
  unique: number;
  min?: number;
  max?: number;
  sum?: number;
  mean?: number;
  median?: number;
  stdev?: number;
  /** Top value frequencies (for categorical / mixed) */
  topValues: Array<{ value: string; count: number }>;
  /** Histogram bins for numeric columns */
  histogram?: Array<{ from: number; to: number; count: number; label: string }>;
}

export interface ChartSpec {
  kind: 'histogram' | 'bar' | 'line' | 'pie';
  title: string;
  sheetName: string;
  /** Categories or bin labels */
  labels: string[];
  /** Parallel series; most charts use one series */
  series: Array<{ name: string; values: number[] }>;
  note?: string;
}

function cellNumber(cell: Cell | undefined): number | null {
  if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined) return null;
  if (cell.type === 'number' && typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    return cell.value;
  }
  if (cell.type === 'date') {
    const t = new Date(String(cell.value)).getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) return cell.value;
  const n = Number(String(cell.value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cellText(cell: Cell | undefined): string {
  if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined) return '';
  return String(cell.value);
}

function headerLabel(sheet: Worksheet, col: number): string {
  const h = sheet.rows[0]?.[col];
  const t = cellText(h).trim();
  if (t) return t.slice(0, 40);
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function medianOf(sorted: number[]): number | undefined {
  if (!sorted.length) return undefined;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function stdevOf(values: number[], mean: number): number | undefined {
  if (values.length < 2) return undefined;
  let s = 0;
  for (const v of values) s += (v - mean) ** 2;
  return Math.sqrt(s / (values.length - 1));
}

export function analyzeColumn(
  sheet: Worksheet,
  col: number,
  opts?: { headerRow?: number; maxRows?: number },
): ColumnStats {
  const headerRow = opts?.headerRow ?? 0;
  const maxRows = opts?.maxRows ?? 50_000;
  const rowEnd = Math.min(sheet.rowCount - 1, maxRows);
  const nums: number[] = [];
  const freq = new Map<string, number>();
  let nonBlank = 0;
  let blank = 0;
  let numbers = 0;
  let texts = 0;
  let dates = 0;
  let bools = 0;
  let errors = 0;
  let formulas = 0;

  for (let r = headerRow + 1; r <= rowEnd; r++) {
    const cell = sheet.rows[r]?.[col];
    if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined || cell.value === '') {
      blank++;
      continue;
    }
    nonBlank++;
    if (cell.type === 'formula') formulas++;
    if (cell.type === 'error') {
      errors++;
      continue;
    }
    if (cell.type === 'number') numbers++;
    else if (cell.type === 'date') dates++;
    else if (cell.type === 'boolean') bools++;
    else texts++;

    const n = cellNumber(cell);
    if (n !== null) nums.push(n);
    const key = cellText(cell).slice(0, 80) || '(blank)';
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  const topValues = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([value, count]) => ({ value, count }));

  nums.sort((a, b) => a - b);
  const sum = nums.length ? nums.reduce((a, b) => a + b, 0) : undefined;
  const mean = sum !== undefined && nums.length ? sum / nums.length : undefined;

  let histogram: ColumnStats['histogram'];
  if (nums.length >= 4) {
    const min = nums[0];
    const max = nums[nums.length - 1];
    const bins = Math.min(12, Math.max(5, Math.ceil(Math.sqrt(nums.length))));
    const width = max === min ? 1 : (max - min) / bins;
    histogram = [];
    for (let i = 0; i < bins; i++) {
      const from = min + i * width;
      const to = i === bins - 1 ? max : min + (i + 1) * width;
      let count = 0;
      for (const v of nums) {
        if (v >= from && (i === bins - 1 ? v <= to : v < to)) count++;
      }
      histogram.push({
        from,
        to,
        count,
        label: `${formatNum(from)}–${formatNum(to)}`,
      });
    }
  }

  return {
    sheetName: sheet.name,
    col,
    label: headerLabel(sheet, col),
    rowStart: headerRow + 1,
    rowEnd,
    count: rowEnd - headerRow,
    nonBlank,
    blank,
    numbers,
    texts,
    dates,
    bools,
    errors,
    formulas,
    unique: freq.size,
    min: nums.length ? nums[0] : undefined,
    max: nums.length ? nums[nums.length - 1] : undefined,
    sum,
    mean,
    median: medianOf(nums),
    stdev: mean !== undefined ? stdevOf(nums, mean) : undefined,
    topValues,
    histogram,
  };
}

export function analyzeRange(sheet: Worksheet, range: CellRange): ColumnStats[] {
  const out: ColumnStats[] = [];
  for (let c = range.startCol; c <= range.endCol; c++) {
    out.push(analyzeColumn(sheet, c, { headerRow: range.startRow > 0 ? range.startRow - 1 : 0 }));
  }
  return out;
}

export function buildChartFromColumn(
  sheet: Worksheet,
  col: number,
  kind: ChartSpec['kind'],
  opts?: { headerRow?: number; maxCategories?: number },
): ChartSpec {
  const stats = analyzeColumn(sheet, col, { headerRow: opts?.headerRow ?? 0 });
  const maxCat = opts?.maxCategories ?? 20;

  if (kind === 'histogram' && stats.histogram?.length) {
    return {
      kind: 'histogram',
      title: `Histogram · ${stats.label}`,
      sheetName: sheet.name,
      labels: stats.histogram.map((b) => b.label),
      series: [{ name: 'Count', values: stats.histogram.map((b) => b.count) }],
      note: `${stats.nonBlank} values · min ${formatNum(stats.min)} · max ${formatNum(stats.max)}`,
    };
  }

  if (kind === 'line') {
    const headerRow = opts?.headerRow ?? 0;
    const labels: string[] = [];
    const values: number[] = [];
    const limit = Math.min(sheet.rowCount - 1, headerRow + 500);
    for (let r = headerRow + 1; r <= limit; r++) {
      const n = cellNumber(sheet.rows[r]?.[col]);
      if (n === null) continue;
      labels.push(String(r + 1));
      values.push(n);
    }
    return {
      kind: 'line',
      title: `Line · ${stats.label}`,
      sheetName: sheet.name,
      labels,
      series: [{ name: stats.label, values }],
      note: `${values.length} points`,
    };
  }

  // bar / pie from top values
  const top = stats.topValues.slice(0, maxCat);
  return {
    kind: kind === 'pie' ? 'pie' : 'bar',
    title: `${kind === 'pie' ? 'Pie' : 'Bar'} · ${stats.label}`,
    sheetName: sheet.name,
    labels: top.map((t) => (t.value.length > 24 ? t.value.slice(0, 22) + '…' : t.value)),
    series: [{ name: 'Count', values: top.map((t) => t.count) }],
    note: `${stats.unique} unique · showing top ${top.length}`,
  };
}

function formatNum(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toExponential(2);
  return (Math.round(n * 1000) / 1000).toLocaleString();
}
