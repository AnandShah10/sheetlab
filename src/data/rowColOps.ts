import { Worksheet } from '../types/workbook';

/**
 * Insert a blank row at index `at`, shifting every row at or below it down
 * by one. Formulas are NOT rewritten (same documented limitation as sort —
 * see data/sort.ts): a formula referencing a row that moved will keep
 * pointing at its old row number, matching the sharp edge Excel itself has
 * without a full dependency-rewrite engine.
 */
export function insertRow(sheet: Worksheet, at: number): void {
  const shifted: Worksheet['rows'] = {};
  for (const [key, row] of Object.entries(sheet.rows)) {
    const idx = Number(key);
    shifted[idx >= at ? idx + 1 : idx] = row;
  }
  sheet.rows = shifted;
  sheet.rowCount += 1;

  const shiftedMeta: Worksheet['rowMeta'] = {};
  for (const [key, meta] of Object.entries(sheet.rowMeta)) {
    const idx = Number(key);
    shiftedMeta[idx >= at ? idx + 1 : idx] = meta;
  }
  sheet.rowMeta = shiftedMeta;
}

export function deleteRow(sheet: Worksheet, at: number): void {
  const shifted: Worksheet['rows'] = {};
  for (const [key, row] of Object.entries(sheet.rows)) {
    const idx = Number(key);
    if (idx === at) continue;
    shifted[idx > at ? idx - 1 : idx] = row;
  }
  sheet.rows = shifted;
  sheet.rowCount = Math.max(0, sheet.rowCount - 1);

  const shiftedMeta: Worksheet['rowMeta'] = {};
  for (const [key, meta] of Object.entries(sheet.rowMeta)) {
    const idx = Number(key);
    if (idx === at) continue;
    shiftedMeta[idx > at ? idx - 1 : idx] = meta;
  }
  sheet.rowMeta = shiftedMeta;
}

export function insertColumn(sheet: Worksheet, at: number): void {
  for (const row of Object.values(sheet.rows)) {
    const shifted: typeof row = {};
    for (const [key, cell] of Object.entries(row)) {
      const idx = Number(key);
      shifted[idx >= at ? idx + 1 : idx] = cell;
    }
    Object.keys(row).forEach((k) => delete row[Number(k)]);
    Object.assign(row, shifted);
  }
  sheet.colCount += 1;

  const shiftedCols: Worksheet['columns'] = {};
  for (const [key, meta] of Object.entries(sheet.columns)) {
    const idx = Number(key);
    shiftedCols[idx >= at ? idx + 1 : idx] = meta;
  }
  sheet.columns = shiftedCols;
}

export function deleteColumn(sheet: Worksheet, at: number): void {
  for (const row of Object.values(sheet.rows)) {
    const shifted: typeof row = {};
    for (const [key, cell] of Object.entries(row)) {
      const idx = Number(key);
      if (idx === at) continue;
      shifted[idx > at ? idx - 1 : idx] = cell;
    }
    Object.keys(row).forEach((k) => delete row[Number(k)]);
    Object.assign(row, shifted);
  }
  sheet.colCount = Math.max(0, sheet.colCount - 1);

  const shiftedCols: Worksheet['columns'] = {};
  for (const [key, meta] of Object.entries(sheet.columns)) {
    const idx = Number(key);
    if (idx === at) continue;
    shiftedCols[idx > at ? idx - 1 : idx] = meta;
  }
  sheet.columns = shiftedCols;
}

/** Apply a partial format patch (merge, not replace) to every cell in a range. */
export function formatRange(sheet: Worksheet, range: { startRow: number; startCol: number; endRow: number; endCol: number }, format: Partial<Worksheet['rows'][number][number]['format']>): void {
  for (let r = range.startRow; r <= range.endRow; r++) {
    if (!sheet.rows[r]) sheet.rows[r] = {};
    for (let c = range.startCol; c <= range.endCol; c++) {
      const existing = sheet.rows[r][c] ?? { raw: null, value: null, type: 'blank' as const };
      sheet.rows[r][c] = { ...existing, format: { ...existing.format, ...format } };
    }
  }
}
