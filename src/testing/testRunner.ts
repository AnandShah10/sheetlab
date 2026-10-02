import { Workbook } from '../types/workbook';
import { TestResult, WorkbookTestCase, WorkbookTestFile } from './types';
import { parseA1, parseA1OrRange, colLetterToIndex } from '../utils/cellRef';

export function runWorkbookTests(workbook: Workbook, file: WorkbookTestFile): TestResult[] {
  return file.tests.map((t) => runOne(workbook, t));
}

function runOne(workbook: Workbook, t: WorkbookTestCase): TestResult {
  const defaultSheet = workbook.meta.sheetOrder[0] ?? 'Sheet1';

  if (t.uniqueColumn !== undefined) {
    return checkUniqueColumn(workbook, t, defaultSheet);
  }

  if (t.rangeNoErrors) {
    return checkRangeNoErrors(workbook, t, defaultSheet);
  }

  if (!t.cell) {
    return { id: t.id, name: t.name, passed: false, message: 'Test has no cell / uniqueColumn / rangeNoErrors' };
  }

  const parsed = parseCellRef(t.cell, t.sheetName ?? defaultSheet);
  if (!parsed) {
    return { id: t.id, name: t.name, passed: false, message: `Bad cell ref ${t.cell}` };
  }
  const cell = workbook.sheets[parsed.sheetName]?.rows[parsed.row]?.[parsed.col];

  if (t.noError && cell?.type === 'error') {
    return fail(t, `Expected no error, got ${cell.error?.code ?? 'error'}`, parsed);
  }

  if (t.formulaContains !== undefined) {
    const f = cell?.formula ?? (cell?.raw?.startsWith('=') ? cell.raw.slice(1) : '');
    const ok = (f ?? '').toLowerCase().includes(String(t.formulaContains).toLowerCase());
    return ok
      ? pass(t, parsed)
      : fail(t, `Formula does not contain "${t.formulaContains}" (got ${f || '(none)'})`, parsed);
  }

  if (t.equals !== undefined) {
    const actual = cell?.value;
    const ok = actual === t.equals || String(actual) === String(t.equals);
    return ok
      ? pass(t, parsed)
      : fail(t, `Expected ${JSON.stringify(t.equals)}, got ${JSON.stringify(actual)}`, parsed);
  }

  if (t.notEquals !== undefined) {
    const actual = cell?.value;
    const bad = actual === t.notEquals || String(actual) === String(t.notEquals);
    return bad
      ? fail(t, `Value should not equal ${JSON.stringify(t.notEquals)}`, parsed)
      : pass(t, parsed);
  }

  if (t.noError) {
    return cell?.type === 'error'
      ? fail(t, `Expected no error, got ${cell.error?.code ?? 'error'}`, parsed)
      : pass(t, parsed);
  }

  return pass(t, parsed);
}

function checkUniqueColumn(workbook: Workbook, t: WorkbookTestCase, defaultSheet: string): TestResult {
  const sheetName = t.sheetName ?? defaultSheet;
  const sheet = workbook.sheets[sheetName];
  if (!sheet) {
    return { id: t.id, name: t.name, passed: false, message: `Missing sheet ${sheetName}` };
  }
  const col = resolveColumn(sheet, t.uniqueColumn!);
  if (col < 0) {
    return { id: t.id, name: t.name, passed: false, message: `Column not found: ${t.uniqueColumn}` };
  }
  const seen = new Map<string, number>();
  for (const [rowStr, row] of Object.entries(sheet.rows)) {
    const r = Number(rowStr);
    if (r === 0) continue; // skip header
    const cell = row[col];
    const val = cell?.value;
    if (val === null || val === undefined || val === '') continue;
    const key = String(val);
    if (seen.has(key)) {
      return {
        id: t.id,
        name: t.name,
        passed: false,
        message: `Duplicate "${key}" at rows ${seen.get(key)! + 1} and ${r + 1}`,
        sheetName,
        row: r,
        col,
      };
    }
    seen.set(key, r);
  }
  return { id: t.id, name: t.name, passed: true, message: 'OK', sheetName };
}

function checkRangeNoErrors(workbook: Workbook, t: WorkbookTestCase, defaultSheet: string): TestResult {
  const parsed = parseSheetRange(t.rangeNoErrors!, t.sheetName ?? defaultSheet);
  if (!parsed) {
    return { id: t.id, name: t.name, passed: false, message: `Bad range ${t.rangeNoErrors}` };
  }
  const sheet = workbook.sheets[parsed.sheetName];
  if (!sheet) {
    return { id: t.id, name: t.name, passed: false, message: `Missing sheet ${parsed.sheetName}` };
  }
  for (let r = parsed.startRow; r <= parsed.endRow; r++) {
    for (let c = parsed.startCol; c <= parsed.endCol; c++) {
      const cell = sheet.rows[r]?.[c];
      if (cell?.type === 'error') {
        return {
          id: t.id,
          name: t.name,
          passed: false,
          message: `Error ${cell.error?.code ?? ''} at row ${r + 1}, col ${c + 1}`,
          sheetName: parsed.sheetName,
          row: r,
          col: c,
        };
      }
    }
  }
  return { id: t.id, name: t.name, passed: true, message: 'OK', sheetName: parsed.sheetName };
}

function resolveColumn(
  sheet: Workbook['sheets'][string],
  column: string | number,
): number {
  if (typeof column === 'number') return column;
  if (/^\d+$/.test(column)) return parseInt(column, 10);
  // Header name first so values like "id" are not treated as Excel column letters.
  const header = sheet.rows[0];
  if (header) {
    const want = String(column).trim().toLowerCase();
    for (const [c, cell] of Object.entries(header)) {
      if (String(cell.value ?? cell.raw ?? '').trim().toLowerCase() === want) return Number(c);
    }
  }
  if (/^[A-Za-z]{1,3}$/.test(String(column))) return colLetterToIndex(String(column));
  return -1;
}

function pass(
  t: WorkbookTestCase,
  parsed?: { sheetName: string; row: number; col: number },
): TestResult {
  return {
    id: t.id,
    name: t.name,
    passed: true,
    message: 'OK',
    sheetName: parsed?.sheetName,
    row: parsed?.row,
    col: parsed?.col,
  };
}

function fail(
  t: WorkbookTestCase,
  message: string,
  parsed?: { sheetName: string; row: number; col: number },
): TestResult {
  return {
    id: t.id,
    name: t.name,
    passed: false,
    message,
    sheetName: parsed?.sheetName,
    row: parsed?.row,
    col: parsed?.col,
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

function parseSheetRange(
  ref: string,
  defaultSheet: string,
): { sheetName: string; startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const bang = ref.lastIndexOf('!');
  let sheetName = defaultSheet;
  let rangePart = ref;
  if (bang >= 0) {
    sheetName = ref.slice(0, bang).replace(/^'|'$/g, '');
    rangePart = ref.slice(bang + 1);
  }
  const range = parseA1OrRange(rangePart.replace(/\$/g, ''));
  if (!range) return null;
  return { sheetName, ...range };
}
