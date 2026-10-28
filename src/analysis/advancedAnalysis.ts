/**
 * Advanced Analysis — configurable aggregation + chart series.
 * Supports category (X), measures (Y with aggregations), optional series split, filters.
 */

import { Worksheet, Cell } from '../types/workbook';

export type ChartType =
  | 'bar'
  | 'stackedBar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'histogram';

export type AggFn = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'median' | 'countDistinct';

export interface MeasureSpec {
  col: number;
  agg: AggFn;
  label?: string;
}

export interface AdvancedAnalysisConfig {
  sheetName: string;
  chartType: ChartType;
  /** X-axis / category column index */
  categoryCol: number;
  measures: MeasureSpec[];
  /** Optional series / legend dimension */
  seriesCol?: number | null;
  headerRow: number;
  maxCategories: number;
  sortBy: 'category' | 'value' | 'none';
  sortDir: 'asc' | 'desc';
  title?: string;
  showLegend: boolean;
  showValues: boolean;
  /** Keep only rows where filterCol value is in filterValues (if set) */
  filterCol?: number | null;
  filterValues?: string[];
  /** Scatter: X numeric col (overrides category for scatter) */
  scatterXCol?: number | null;
  scatterYCol?: number | null;
}

export interface AdvancedSeries {
  name: string;
  values: number[];
}

export interface AdvancedAnalysisResult {
  config: AdvancedAnalysisConfig;
  title: string;
  categories: string[];
  series: AdvancedSeries[];
  /** Pivot table rows for display */
  table: Array<{ category: string; series?: string; values: Record<string, number> }>;
  rowCountUsed: number;
  note: string;
  columnLabels: string[];
}

function cellText(cell: Cell | undefined): string {
  if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined) return '';
  return String(cell.value).trim();
}

function cellNumber(cell: Cell | undefined): number | null {
  if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined) return null;
  if (cell.type === 'number' && typeof cell.value === 'number' && Number.isFinite(cell.value)) return cell.value;
  if (cell.type === 'date') {
    const t = new Date(String(cell.value)).getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) return cell.value;
  const n = Number(String(cell.value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function columnLabel(sheet: Worksheet, col: number, headerRow: number): string {
  const t = cellText(sheet.rows[headerRow]?.[col]);
  if (t) return t.slice(0, 48);
  let n = col + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function listColumns(sheet: Worksheet, headerRow = 0, maxCols = 50): Array<{ col: number; label: string }> {
  const cols = Math.min(sheet.colCount || maxCols, maxCols);
  const out: Array<{ col: number; label: string }> = [];
  for (let c = 0; c < cols; c++) {
    out.push({ col: c, label: columnLabel(sheet, c, headerRow) });
  }
  return out;
}

function measureKey(m: MeasureSpec, sheet: Worksheet, headerRow: number): string {
  return m.label || `${m.agg}(${columnLabel(sheet, m.col, headerRow)})`;
}

function aggregate(values: number[], texts: string[], agg: AggFn): number {
  switch (agg) {
    case 'count':
      return values.length + texts.filter((t) => t !== '').length;
    case 'countDistinct': {
      const set = new Set<string>();
      for (const v of values) set.add(String(v));
      for (const t of texts) if (t) set.add(t);
      return set.size;
    }
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case 'min':
      return values.length ? Math.min(...values) : 0;
    case 'max':
      return values.length ? Math.max(...values) : 0;
    case 'median': {
      if (!values.length) return 0;
      const s = [...values].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    default:
      return 0;
  }
}

type Bucket = {
  nums: Map<string, number[]>; // measureKey -> numbers
  texts: Map<string, string[]>;
};

export function runAdvancedAnalysis(sheet: Worksheet, config: AdvancedAnalysisConfig): AdvancedAnalysisResult {
  const headerRow = config.headerRow ?? 0;
  const measures =
    config.measures?.length > 0
      ? config.measures
      : [{ col: Math.min(1, Math.max(0, sheet.colCount - 1)), agg: 'count' as AggFn }];

  // Scatter special case
  if (config.chartType === 'scatter' && config.scatterXCol != null && config.scatterYCol != null) {
    return runScatter(sheet, config, headerRow);
  }

  // Histogram: single measure numeric distribution
  if (config.chartType === 'histogram') {
    return runHistogram(sheet, config, headerRow, measures[0]);
  }

  const buckets = new Map<string, Bucket>(); // key = category||series
  let rowCountUsed = 0;
  const maxRow = Math.min(sheet.rowCount - 1, 100_000);

  for (let r = headerRow + 1; r <= maxRow; r++) {
    if (config.filterCol != null && config.filterValues && config.filterValues.length) {
      const fv = cellText(sheet.rows[r]?.[config.filterCol]);
      if (!config.filterValues.includes(fv)) continue;
    }
    const cat = cellText(sheet.rows[r]?.[config.categoryCol]) || '(blank)';
    const series =
      config.seriesCol != null && config.seriesCol >= 0
        ? cellText(sheet.rows[r]?.[config.seriesCol]) || '(blank)'
        : '';
    const key = series ? `${cat}\x1f${series}` : cat;
    let b = buckets.get(key);
    if (!b) {
      b = { nums: new Map(), texts: new Map() };
      buckets.set(key, b);
    }
    for (const m of measures) {
      const mk = measureKey(m, sheet, headerRow);
      const cell = sheet.rows[r]?.[m.col];
      const n = cellNumber(cell);
      if (n !== null) {
        const arr = b.nums.get(mk) ?? [];
        arr.push(n);
        b.nums.set(mk, arr);
      } else {
        const t = cellText(cell);
        const arr = b.texts.get(mk) ?? [];
        arr.push(t);
        b.texts.set(mk, arr);
      }
    }
    rowCountUsed++;
  }

  // Build pivot rows
  type Row = { category: string; series: string; values: Record<string, number> };
  const rows: Row[] = [];
  for (const [key, b] of buckets) {
    const [category, series = ''] = key.split('\x1f');
    const values: Record<string, number> = {};
    for (const m of measures) {
      const mk = measureKey(m, sheet, headerRow);
      values[mk] = aggregate(b.nums.get(mk) ?? [], b.texts.get(mk) ?? [], m.agg);
    }
    rows.push({ category, series, values });
  }

  // Categories ordered
  let categories = [...new Set(rows.map((r) => r.category))];
  if (config.sortBy === 'category') {
    categories.sort((a, b) => (config.sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a)));
  } else if (config.sortBy === 'value') {
    const firstMk = measureKey(measures[0], sheet, headerRow);
    const totals = new Map<string, number>();
    for (const r of rows) {
      totals.set(r.category, (totals.get(r.category) ?? 0) + (r.values[firstMk] ?? 0));
    }
    categories.sort((a, b) => {
      const d = (totals.get(a) ?? 0) - (totals.get(b) ?? 0);
      return config.sortDir === 'asc' ? d : -d;
    });
  }
  if (categories.length > config.maxCategories) {
    categories = categories.slice(0, config.maxCategories);
  }

  const seriesNames =
    config.seriesCol != null && config.seriesCol >= 0
      ? [...new Set(rows.map((r) => r.series))].sort()
      : measures.map((m) => measureKey(m, sheet, headerRow));

  const series: AdvancedSeries[] = [];
  if (config.seriesCol != null && config.seriesCol >= 0) {
    const mk = measureKey(measures[0], sheet, headerRow);
    for (const sn of seriesNames) {
      series.push({
        name: sn,
        values: categories.map((cat) => {
          const row = rows.find((r) => r.category === cat && r.series === sn);
          return row?.values[mk] ?? 0;
        }),
      });
    }
  } else {
    for (const m of measures) {
      const mk = measureKey(m, sheet, headerRow);
      series.push({
        name: mk,
        values: categories.map((cat) => {
          const row = rows.find((r) => r.category === cat);
          return row?.values[mk] ?? 0;
        }),
      });
    }
  }

  const title =
    config.title?.trim() ||
    `${config.chartType} · ${columnLabel(sheet, config.categoryCol, headerRow)}`;

  return {
    config,
    title,
    categories,
    series,
    table: rows
      .filter((r) => categories.includes(r.category))
      .map((r) => ({ category: r.category, series: r.series || undefined, values: r.values })),
    rowCountUsed,
    note: `${rowCountUsed} rows · ${categories.length} categories · ${series.length} series`,
    columnLabels: listColumns(sheet, headerRow).map((c) => c.label),
  };
}

function runHistogram(
  sheet: Worksheet,
  config: AdvancedAnalysisConfig,
  headerRow: number,
  measure: MeasureSpec,
): AdvancedAnalysisResult {
  const nums: number[] = [];
  const maxRow = Math.min(sheet.rowCount - 1, 100_000);
  for (let r = headerRow + 1; r <= maxRow; r++) {
    if (config.filterCol != null && config.filterValues?.length) {
      const fv = cellText(sheet.rows[r]?.[config.filterCol]);
      if (!config.filterValues.includes(fv)) continue;
    }
    const n = cellNumber(sheet.rows[r]?.[measure.col]);
    if (n !== null) nums.push(n);
  }
  nums.sort((a, b) => a - b);
  if (!nums.length) {
    return {
      config,
      title: config.title || 'Histogram',
      categories: [],
      series: [],
      table: [],
      rowCountUsed: 0,
      note: 'No numeric values',
      columnLabels: listColumns(sheet, headerRow).map((c) => c.label),
    };
  }
  const bins = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(nums.length))));
  const min = nums[0];
  const max = nums[nums.length - 1];
  const width = max === min ? 1 : (max - min) / bins;
  const categories: string[] = [];
  const values: number[] = [];
  for (let i = 0; i < bins; i++) {
    const from = min + i * width;
    const to = i === bins - 1 ? max : min + (i + 1) * width;
    let count = 0;
    for (const v of nums) {
      if (v >= from && (i === bins - 1 ? v <= to : v < to)) count++;
    }
    categories.push(`${round(from)}–${round(to)}`);
    values.push(count);
  }
  const label = measureKey(measure, sheet, headerRow);
  return {
    config,
    title: config.title || `Histogram · ${columnLabel(sheet, measure.col, headerRow)}`,
    categories,
    series: [{ name: label, values }],
    table: categories.map((c, i) => ({ category: c, values: { [label]: values[i] } })),
    rowCountUsed: nums.length,
    note: `${nums.length} values · ${bins} bins`,
    columnLabels: listColumns(sheet, headerRow).map((c) => c.label),
  };
}

function runScatter(
  sheet: Worksheet,
  config: AdvancedAnalysisConfig,
  headerRow: number,
): AdvancedAnalysisResult {
  const xCol = config.scatterXCol!;
  const yCol = config.scatterYCol!;
  const xs: number[] = [];
  const ys: number[] = [];
  const labels: string[] = [];
  const maxRow = Math.min(sheet.rowCount - 1, 5_000);
  for (let r = headerRow + 1; r <= maxRow; r++) {
    if (config.filterCol != null && config.filterValues?.length) {
      const fv = cellText(sheet.rows[r]?.[config.filterCol]);
      if (!config.filterValues.includes(fv)) continue;
    }
    const x = cellNumber(sheet.rows[r]?.[xCol]);
    const y = cellNumber(sheet.rows[r]?.[yCol]);
    if (x === null || y === null) continue;
    xs.push(x);
    ys.push(y);
    labels.push(String(r + 1));
  }
  return {
    config,
    title:
      config.title ||
      `Scatter · ${columnLabel(sheet, xCol, headerRow)} vs ${columnLabel(sheet, yCol, headerRow)}`,
    categories: labels,
    series: [
      { name: 'x', values: xs },
      { name: 'y', values: ys },
    ],
    table: labels.map((lab, i) => ({
      category: lab,
      values: { x: xs[i], y: ys[i] },
    })),
    rowCountUsed: xs.length,
    note: `${xs.length} points`,
    columnLabels: listColumns(sheet, headerRow).map((c) => c.label),
  };
}

function round(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toExponential(1);
  return String(Math.round(n * 100) / 100);
}
