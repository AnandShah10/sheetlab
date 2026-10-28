/**
 * Excel-style pivot table engine (rows × columns × values with aggregation).
 */

import { Worksheet, Cell } from '../types/workbook';

export type PivotAgg = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'countDistinct';

export interface PivotValueField {
  col: number;
  agg: PivotAgg;
  label?: string;
}

export interface PivotConfig {
  sheetName: string;
  headerRow: number;
  /** Row axis fields (column indices) */
  rowFields: number[];
  /** Column axis fields (column indices) — 0 or 1 supported fully; 2+ nested labels */
  colFields: number[];
  values: PivotValueField[];
  /** Optional filter: keep rows where filterCol value is in filterValues */
  filterCol?: number | null;
  filterValues?: string[];
  maxRowKeys?: number;
  maxColKeys?: number;
}

export interface PivotResult {
  /** Header row: [row field labels..., ...col keys or value labels] */
  columns: string[];
  rows: (string | number | null)[][];
  rowFieldLabels: string[];
  colKeys: string[];
  valueLabels: string[];
  note: string;
}

function cellText(cell: Cell | undefined): string {
  if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined) return '';
  return String(cell.value).trim();
}

function cellNumber(cell: Cell | undefined): number | null {
  if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined) return null;
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) return cell.value;
  const n = Number(String(cell.value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function headerLabel(sheet: Worksheet, col: number, headerRow: number): string {
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

function aggValues(nums: number[], texts: string[], agg: PivotAgg): number {
  switch (agg) {
    case 'count':
      return nums.length + texts.filter((t) => t !== '').length;
    case 'countDistinct': {
      const set = new Set<string>();
      for (const v of nums) set.add(String(v));
      for (const t of texts) if (t) set.add(t);
      return set.size;
    }
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'min':
      return nums.length ? Math.min(...nums) : 0;
    case 'max':
      return nums.length ? Math.max(...nums) : 0;
    default:
      return 0;
  }
}

type Bucket = { nums: number[]; texts: string[] };

export function runPivot(sheet: Worksheet, config: PivotConfig): PivotResult {
  const headerRow = config.headerRow ?? 0;
  const maxRow = Math.min(sheet.rowCount - 1, 100_000);
  const maxRowKeys = config.maxRowKeys ?? 500;
  const maxColKeys = config.maxColKeys ?? 50;

  if (!config.values?.length) {
    return {
      columns: [],
      rows: [],
      rowFieldLabels: [],
      colKeys: [],
      valueLabels: [],
      note: 'Add at least one value field',
    };
  }

  const rowFieldLabels = config.rowFields.map((c) => headerLabel(sheet, c, headerRow));
  const valueLabels = config.values.map(
    (v) => v.label || `${v.agg}(${headerLabel(sheet, v.col, headerRow)})`,
  );

  // key: rowKey \x1f colKey \x1f valueIndex -> bucket
  const buckets = new Map<string, Bucket>();
  const rowKeySet = new Map<string, string[]>(); // key -> parts
  const colKeySet = new Map<string, string[]>();

  for (let r = headerRow + 1; r <= maxRow; r++) {
    if (config.filterCol != null && config.filterValues?.length) {
      const fv = cellText(sheet.rows[r]?.[config.filterCol]);
      if (!config.filterValues.includes(fv)) continue;
    }
    const rowParts = config.rowFields.map((c) => cellText(sheet.rows[r]?.[c]) || '(blank)');
    const colParts = config.colFields.map((c) => cellText(sheet.rows[r]?.[c]) || '(blank)');
    const rowKey = rowParts.join('\u0001');
    const colKey = colParts.length ? colParts.join('\u0001') : '';
    if (!rowKeySet.has(rowKey)) rowKeySet.set(rowKey, rowParts);
    if (colParts.length && !colKeySet.has(colKey)) colKeySet.set(colKey, colParts);

    config.values.forEach((vf, vi) => {
      const bKey = `${rowKey}\x1f${colKey}\x1f${vi}`;
      let b = buckets.get(bKey);
      if (!b) {
        b = { nums: [], texts: [] };
        buckets.set(bKey, b);
      }
      const cell = sheet.rows[r]?.[vf.col];
      const n = cellNumber(cell);
      if (n !== null) b.nums.push(n);
      else {
        const t = cellText(cell);
        if (t) b.texts.push(t);
      }
    });
  }

  let rowKeys = [...rowKeySet.keys()];
  let colKeys = config.colFields.length ? [...colKeySet.keys()] : [''];
  if (rowKeys.length > maxRowKeys) rowKeys = rowKeys.slice(0, maxRowKeys);
  if (colKeys.length > maxColKeys) colKeys = colKeys.slice(0, maxColKeys);

  // Sort keys
  rowKeys.sort((a, b) => a.localeCompare(b));
  colKeys.sort((a, b) => a.localeCompare(b));

  // Build columns
  const columns: string[] = [...rowFieldLabels];
  if (config.colFields.length === 0) {
    columns.push(...valueLabels);
  } else {
    for (const ck of colKeys) {
      const label = ck.replace(/\u0001/g, ' | ') || '(all)';
      if (valueLabels.length === 1) columns.push(label);
      else for (const vl of valueLabels) columns.push(`${label} · ${vl}`);
    }
  }

  const rows: (string | number | null)[][] = [];
  for (const rk of rowKeys) {
    const parts = rowKeySet.get(rk) ?? rk.split('\u0001');
    const out: (string | number | null)[] = [...parts];
    for (const ck of colKeys) {
      for (let vi = 0; vi < config.values.length; vi++) {
        const b = buckets.get(`${rk}\x1f${ck}\x1f${vi}`);
        out.push(b ? aggValues(b.nums, b.texts, config.values[vi].agg) : null);
      }
    }
    rows.push(out);
  }

  return {
    columns,
    rows,
    rowFieldLabels,
    colKeys: colKeys.map((c) => c.replace(/\u0001/g, ' | ') || '(all)'),
    valueLabels,
    note: `${rows.length} row groups · ${colKeys.length} column groups · ${config.values.length} value(s)`,
  };
}
