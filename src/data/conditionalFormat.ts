/**
 * SheetLab conditional formatting — evaluate cell-value rules for display.
 * Rules live on Worksheet.conditionalFormats and are applied in the grid
 * (do not mutate cell.format permanently).
 */

import { Cell, CellFormat, CellRange, ConditionalFormatRule, CfOperator, Worksheet } from '../types/workbook';

function inRange(row: number, col: number, range?: CellRange): boolean {
  if (!range) return true;
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    col >= range.startCol &&
    col <= range.endCol
  );
}

/** Parse cell value as number: handles currency, %, commas, parentheses negatives. */
export function parseCellNumber(cell: Cell | undefined): number | null {
  if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined || cell.value === '') {
    return null;
  }
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) return cell.value;
  if (typeof cell.value === 'boolean') return cell.value ? 1 : 0;

  let s = String(cell.value).trim();
  if (!s) return null;
  // (123) → -123
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) s = '-' + paren[1];
  s = s.replace(/[$€£¥₹,\s]/g, '');
  const pct = s.endsWith('%');
  if (pct) s = s.slice(0, -1);
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

function matches(op: CfOperator, cell: Cell | undefined, value?: string | number, value2?: string | number): boolean {
  const blank =
    !cell ||
    cell.type === 'blank' ||
    cell.value === null ||
    cell.value === undefined ||
    cell.value === '';
  if (op === 'blank') return blank;
  if (op === 'notBlank') return !blank;
  if (blank) return false;

  if (op === 'contains') {
    return String(cell.value).toLowerCase().includes(String(value ?? '').toLowerCase());
  }

  const num = parseCellNumber(cell);
  const v1 = typeof value === 'number' ? value : value === undefined || value === '' ? NaN : Number(value);
  const v2 = typeof value2 === 'number' ? value2 : value2 === undefined || value2 === '' ? NaN : Number(value2);

  if (op === 'between' && num !== null && Number.isFinite(v1) && Number.isFinite(v2)) {
    const lo = Math.min(v1, v2);
    const hi = Math.max(v1, v2);
    return num >= lo && num <= hi;
  }

  if (num !== null && Number.isFinite(v1)) {
    switch (op) {
      case 'gt':
        return num > v1;
      case 'gte':
        return num >= v1;
      case 'lt':
        return num < v1;
      case 'lte':
        return num <= v1;
      case 'eq':
        return num === v1;
      case 'neq':
        return num !== v1;
    }
  }

  // Non-numeric fallback for eq/neq only
  const s = String(cell.value);
  const t = String(value ?? '');
  switch (op) {
    case 'eq':
      return s === t;
    case 'neq':
      return s !== t;
    default:
      return false;
  }
}

/** First matching rule styles (stopIfTrue ends evaluation). */
export function resolveConditionalStyle(
  sheet: Worksheet,
  row: number,
  col: number,
): Partial<CellFormat> | undefined {
  const rules = sheet.conditionalFormats;
  if (!rules?.length) return undefined;
  const cell = sheet.rows[row]?.[col];
  let merged: Partial<CellFormat> | undefined;
  for (const rule of rules) {
    if (!inRange(row, col, rule.range)) continue;
    if (!matches(rule.operator, cell, rule.value, rule.value2)) continue;
    merged = { ...(merged ?? {}), ...rule.style };
    if (rule.stopIfTrue !== false) break;
  }
  return merged;
}

export function addConditionalRule(sheet: Worksheet, rule: ConditionalFormatRule): void {
  if (!sheet.conditionalFormats) sheet.conditionalFormats = [];
  // Normalize operator aliases
  const op = rule.operator;
  sheet.conditionalFormats.push({ ...rule, operator: op });
}

export function removeConditionalRule(sheet: Worksheet, id: string): boolean {
  if (!sheet.conditionalFormats) return false;
  const n = sheet.conditionalFormats.length;
  sheet.conditionalFormats = sheet.conditionalFormats.filter((r) => r.id !== id);
  return sheet.conditionalFormats.length < n;
}

export function clearConditionalRules(sheet: Worksheet): void {
  sheet.conditionalFormats = [];
}
