import { Workbook, Worksheet } from '../types/workbook';
import { WorkbookDiagnostic } from '../analysis/types';
import { toA1 } from '../utils/cellRef';

export type RuleKind = 'required' | 'unique' | 'type' | 'regex' | 'range' | 'enum';

export interface ColumnRule {
  /** Header label in row 0, or 0-based column index as string */
  column: string | number;
  kind: RuleKind;
  /** For type: number | string | boolean */
  type?: 'number' | 'string' | 'boolean';
  pattern?: string;
  min?: number;
  max?: number;
  values?: string[];
  sheetName?: string;
}

export interface ValidationConfig {
  version: number;
  rules: ColumnRule[];
}

export function runValidation(workbook: Workbook, config: ValidationConfig): WorkbookDiagnostic[] {
  const out: WorkbookDiagnostic[] = [];
  for (const rule of config.rules) {
    const sheetName = rule.sheetName ?? workbook.meta.sheetOrder[0];
    const sheet = workbook.sheets[sheetName];
    if (!sheet) {
      out.push({
        id: `val:missing-sheet:${sheetName}`,
        ruleId: 'validation-sheet',
        severity: 'error',
        message: `Validation rule references missing sheet "${sheetName}"`,
        sheetName,
      });
      continue;
    }
    const col = resolveColumn(sheet, rule.column);
    if (col < 0) {
      out.push({
        id: `val:missing-col:${rule.column}`,
        ruleId: 'validation-column',
        severity: 'warning',
        message: `Column "${rule.column}" not found for validation`,
        sheetName,
      });
      continue;
    }
    applyRule(sheet, sheetName, col, rule, out);
  }
  return out;
}

function resolveColumn(sheet: Worksheet, column: string | number): number {
  if (typeof column === 'number') return column;
  if (/^\d+$/.test(column)) return parseInt(column, 10);
  const header = sheet.rows[0];
  if (!header) return -1;
  const want = column.trim().toLowerCase();
  for (const [c, cell] of Object.entries(header)) {
    if (String(cell.value ?? cell.raw ?? '').trim().toLowerCase() === want) return Number(c);
  }
  return -1;
}

function applyRule(
  sheet: Worksheet,
  sheetName: string,
  col: number,
  rule: ColumnRule,
  out: WorkbookDiagnostic[],
): void {
  const startRow = 1; // assume header in row 0
  const seen = new Set<string>();
  const re = rule.pattern ? new RegExp(rule.pattern) : null;

  for (const [rowStr, row] of Object.entries(sheet.rows)) {
    const row = Number(rowStr);
    if (row < startRow) continue;
    const cell = sheet.rows[row]?.[col];
    const val = cell?.value;
    const empty = val === null || val === undefined || val === '';

    if (rule.kind === 'required' && empty) {
      out.push(diag(sheetName, row, col, 'required', `Missing required value in ${toA1(row, col)}`));
      continue;
    }
    if (empty) continue;

    if (rule.kind === 'unique') {
      const key = String(val);
      if (seen.has(key)) {
        out.push(diag(sheetName, row, col, 'unique', `Duplicate value "${key}"`));
      }
      seen.add(key);
    }
    if (rule.kind === 'type' && rule.type) {
      const ok =
        rule.type === 'number'
          ? typeof val === 'number'
          : rule.type === 'boolean'
            ? typeof val === 'boolean'
            : typeof val === 'string';
      if (!ok) out.push(diag(sheetName, row, col, 'type', `Expected ${rule.type}, got ${typeof val}`));
    }
    if (rule.kind === 'regex' && re && !re.test(String(val))) {
      out.push(diag(sheetName, row, col, 'regex', `Value does not match /${rule.pattern}/`));
    }
    if (rule.kind === 'range' && typeof val === 'number') {
      if (rule.min !== undefined && val < rule.min) {
        out.push(diag(sheetName, row, col, 'range', `Value ${val} below min ${rule.min}`));
      }
      if (rule.max !== undefined && val > rule.max) {
        out.push(diag(sheetName, row, col, 'range', `Value ${val} above max ${rule.max}`));
      }
    }
    if (rule.kind === 'enum' && rule.values && !rule.values.map(String).includes(String(val))) {
      out.push(diag(sheetName, row, col, 'enum', `Value "${val}" not in allowed set`));
    }
  }
}

function diag(
  sheetName: string,
  row: number,
  col: number,
  ruleId: string,
  message: string,
): WorkbookDiagnostic {
  return {
    id: `val:${ruleId}:${sheetName}:${row}:${col}`,
    ruleId: `data-quality-${ruleId}`,
    severity: 'warning',
    message,
    sheetName,
    row,
    col,
  };
}
