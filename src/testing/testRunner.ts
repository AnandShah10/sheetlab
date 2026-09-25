import { Workbook } from '../types/workbook';
import { TestResult, WorkbookTestCase, WorkbookTestFile } from './types';
import { parseA1 } from '../utils/cellRef';

export function runWorkbookTests(workbook: Workbook, file: WorkbookTestFile): TestResult[] {
  return file.tests.map((t) => runOne(workbook, t));
}

function runOne(workbook: Workbook, t: WorkbookTestCase): TestResult {
  if (!t.cell) {
    return { id: t.id, name: t.name, passed: false, message: 'Test has no cell reference' };
  }
  const parsed = parseCellRef(t.cell, workbook.meta.sheetOrder[0] ?? 'Sheet1');
  if (!parsed) {
    return { id: t.id, name: t.name, passed: false, message: `Bad cell ref ${t.cell}` };
  }
  const cell = workbook.sheets[parsed.sheetName]?.rows[parsed.row]?.[parsed.col];
  if (t.noError && cell?.type === 'error') {
    return {
      id: t.id,
      name: t.name,
      passed: false,
      message: `Expected no error, got ${cell.error?.code ?? 'error'}`,
      sheetName: parsed.sheetName,
      row: parsed.row,
      col: parsed.col,
    };
  }
  if (t.equals !== undefined) {
    const actual = cell?.value;
    const ok = actual === t.equals || String(actual) === String(t.equals);
    return {
      id: t.id,
      name: t.name,
      passed: ok,
      message: ok ? 'OK' : `Expected ${JSON.stringify(t.equals)}, got ${JSON.stringify(actual)}`,
      sheetName: parsed.sheetName,
      row: parsed.row,
      col: parsed.col,
    };
  }
  return {
    id: t.id,
    name: t.name,
    passed: true,
    message: 'OK',
    sheetName: parsed.sheetName,
    row: parsed.row,
    col: parsed.col,
  };
}

function parseCellRef(ref: string, defaultSheet: string): { sheetName: string; row: number; col: number } | null {
  const bang = ref.lastIndexOf('!');
  let sheetName = defaultSheet;
  let cellPart = ref;
  if (bang >= 0) {
    sheetName = ref.slice(0, bang).replace(/^'|'$/g, '');
    cellPart = ref.slice(bang + 1);
  }
  const p = parseA1(cellPart.replace(/\$/g, ''));
  if (!p) return null;
  return { sheetName, row: p.row, col: p.col };
}
