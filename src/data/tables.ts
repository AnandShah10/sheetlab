import { CellRange, ExcelTableMeta, Worksheet } from '../types/workbook';

/**
 * Registers a new Excel Table over `range`. Per spec section 23, SheetLab
 * distinguishes an ordinary cell range from an Excel Table by tracking
 * named table metadata on the worksheet. Structured references
 * (`Table1[Column]`, `Table1[#Headers]`, etc.) are resolved against this
 * metadata by src/formula/structuredReferences.ts.
 */
export function createTable(
  sheet: Worksheet,
  range: CellRange,
  name: string,
  hasHeaderRow: boolean,
  hasTotalsRow = false,
): void {
  if (!sheet.tables) sheet.tables = [];
  if (sheet.tables.some((t) => t.name === name)) {
    throw new Error(`A table named "${name}" already exists on this sheet.`);
  }
  if (sheet.tables.some((t) => rangesOverlap(t.range, range))) {
    throw new Error('Tables cannot overlap an existing table on this sheet.');
  }
  sheet.tables.push({ name, range, hasHeaderRow, hasTotalsRow });
}

export function removeTable(sheet: Worksheet, name: string): void {
  if (!sheet.tables) return;
  sheet.tables = sheet.tables.filter((t) => t.name !== name);
}

export function findTableAt(sheet: Worksheet, row: number, col: number): ExcelTableMeta | undefined {
  return sheet.tables?.find(
    (t) => row >= t.range.startRow && row <= t.range.endRow && col >= t.range.startCol && col <= t.range.endCol,
  );
}

function rangesOverlap(a: CellRange, b: CellRange): boolean {
  return a.startRow <= b.endRow && a.endRow >= b.startRow && a.startCol <= b.endCol && a.endCol >= b.startCol;
}
