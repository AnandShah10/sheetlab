import { Cell, CellRange, Workbook, Worksheet } from '../types/workbook';
import { inferCellFromInput } from './cellModel';

export function getSheet(workbook: Workbook, sheetName: string): Worksheet {
  const sheet = workbook.sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  return sheet;
}

export function setCellRaw(sheet: Worksheet, row: number, col: number, raw: string): Cell {
  const cell = inferCellFromInput(raw);
  if (!sheet.rows[row]) sheet.rows[row] = {};
  if (cell.type === 'blank') {
    delete sheet.rows[row][col];
    if (Object.keys(sheet.rows[row]).length === 0) delete sheet.rows[row];
  } else {
    sheet.rows[row][col] = cell;
  }
  sheet.rowCount = Math.max(sheet.rowCount, row + 1);
  sheet.colCount = Math.max(sheet.colCount, col + 1);
  return cell;
}

export function clearRange(sheet: Worksheet, range: CellRange): void {
  for (let r = range.startRow; r <= range.endRow; r++) {
    if (!sheet.rows[r]) continue;
    for (let c = range.startCol; c <= range.endCol; c++) {
      delete sheet.rows[r][c];
    }
    if (Object.keys(sheet.rows[r]).length === 0) delete sheet.rows[r];
  }
}

export function pasteRange(sheet: Worksheet, startRow: number, startCol: number, data: string[][]): void {
  data.forEach((rowValues, rOffset) => {
    rowValues.forEach((value, cOffset) => {
      setCellRaw(sheet, startRow + rOffset, startCol + cOffset, value);
    });
  });
}

export function getRangeAsMatrix(sheet: Worksheet, range: CellRange): Cell[][] {
  const matrix: Cell[][] = [];
  for (let r = range.startRow; r <= range.endRow; r++) {
    const row: Cell[] = [];
    for (let c = range.startCol; c <= range.endCol; c++) {
      row.push(sheet.rows[r]?.[c] ?? { raw: null, value: null, type: 'blank' });
    }
    matrix.push(row);
  }
  return matrix;
}

export function createWorksheet(workbook: Workbook, name: string): Worksheet {
  if (workbook.sheets[name]) {
    throw new Error(`A sheet named "${name}" already exists`);
  }
  const sheet: Worksheet = { name, rowCount: 0, colCount: 0, rows: {}, columns: {}, rowMeta: {} };
  workbook.sheets[name] = sheet;
  workbook.meta.sheetOrder.push(name);
  return sheet;
}

export function renameWorksheet(workbook: Workbook, oldName: string, newName: string): void {
  if (!workbook.sheets[oldName]) throw new Error(`Sheet "${oldName}" not found`);
  if (workbook.sheets[newName]) throw new Error(`A sheet named "${newName}" already exists`);
  workbook.sheets[newName] = { ...workbook.sheets[oldName], name: newName };
  delete workbook.sheets[oldName];
  workbook.meta.sheetOrder = workbook.meta.sheetOrder.map((n) => (n === oldName ? newName : n));
}

export function deleteWorksheet(workbook: Workbook, name: string): void {
  if (workbook.meta.sheetOrder.length <= 1) {
    throw new Error('A workbook must have at least one worksheet.');
  }
  delete workbook.sheets[name];
  workbook.meta.sheetOrder = workbook.meta.sheetOrder.filter((n) => n !== name);
}

export function duplicateWorksheet(workbook: Workbook, name: string, newName: string): Worksheet {
  const source = getSheet(workbook, name);
  const copy: Worksheet = JSON.parse(JSON.stringify(source));
  copy.name = newName;
  workbook.sheets[newName] = copy;
  const idx = workbook.meta.sheetOrder.indexOf(name);
  workbook.meta.sheetOrder.splice(idx + 1, 0, newName);
  return copy;
}
