import { Worksheet } from '../types/workbook';

export function setColumnHidden(sheet: Worksheet, col: number, hidden: boolean): void {
  sheet.columns[col] = { width: sheet.columns[col]?.width ?? 100, hidden };
}

export function setRowHidden(sheet: Worksheet, row: number, hidden: boolean): void {
  sheet.rowMeta[row] = { height: sheet.rowMeta[row]?.height ?? 24, hidden };
}

export function showAllColumns(sheet: Worksheet): void {
  for (const meta of Object.values(sheet.columns)) meta.hidden = false;
}

export function showAllRows(sheet: Worksheet): void {
  for (const meta of Object.values(sheet.rowMeta)) meta.hidden = false;
}
