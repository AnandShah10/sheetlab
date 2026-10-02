/**
 * Scan a column for formula-pattern outliers and propose relative fixes from a majority template.
 */

import { Workbook } from '../types/workbook';
import { normalizeFormulaPattern } from './diagnostics';
import { toA1 } from '../utils/cellRef';

export interface CellFixProposal {
  sheetName: string;
  row: number;
  col: number;
  a1: string;
  current?: string;
  proposed: string;
  reason: string;
}

export function proposeColumnFormulaFixes(
  workbook: Workbook,
  sheetName: string,
  col: number,
  options?: { maxScan?: number; activeRow?: number },
): CellFixProposal[] {
  const sheet = workbook.sheets[sheetName];
  if (!sheet) return [];
  const maxScan = options?.maxScan ?? 5000;
  const formulas: Array<{ row: number; formula: string; pattern: string }> = [];

  for (const [rowStr, rowData] of Object.entries(sheet.rows)) {
    const row = Number(rowStr);
    if (row >= maxScan) continue;
    const cell = rowData[col];
    if (!cell || cell.type !== 'formula') continue;
    const formula = cell.formula ? `=${cell.formula}` : String(cell.raw ?? '');
    const pattern = normalizeFormulaPattern(formula, row, col);
    formulas.push({ row, formula, pattern });
  }
  if (formulas.length < 2) return [];

  // Majority pattern
  const counts = new Map<string, number>();
  for (const f of formulas) counts.set(f.pattern, (counts.get(f.pattern) ?? 0) + 1);
  let bestPattern = '';
  let bestCount = 0;
  for (const [p, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      bestPattern = p;
    }
  }
  if (bestCount < 2) return [];

  // Template: first formula matching majority pattern
  const template = formulas.find((f) => f.pattern === bestPattern);
  if (!template) return [];

  const proposals: CellFixProposal[] = [];
  for (const f of formulas) {
    if (f.pattern === bestPattern) continue;
    const proposed = shiftFormula(template.formula, template.row, col, f.row, col);
    proposals.push({
      sheetName,
      row: f.row,
      col,
      a1: toA1(f.row, col),
      current: f.formula,
      proposed,
      reason: `Pattern differs from majority (${bestCount}/${formulas.length} cells)`,
    });
  }

  // Prefer showing active row first
  if (options?.activeRow != null) {
    proposals.sort((a, b) => {
      if (a.row === options.activeRow) return -1;
      if (b.row === options.activeRow) return 1;
      return a.row - b.row;
    });
  }
  return proposals.slice(0, 50);
}

function shiftFormula(formula: string, fromRow: number, fromCol: number, toRow: number, toCol: number): string {
  const body = formula.startsWith('=') ? formula.slice(1) : formula;
  const dR = toRow - fromRow;
  const dC = toCol - fromCol;
  const shifted = body.replace(
    /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g,
    (_m, absC: string, letters: string, absR: string, digits: string) => {
      let col = 0;
      const u = letters.toUpperCase();
      for (let i = 0; i < u.length; i++) col = col * 26 + (u.charCodeAt(i) - 64);
      col -= 1;
      let row = parseInt(digits, 10) - 1;
      if (!absC) col += dC;
      if (!absR) row += dR;
      if (row < 0) row = 0;
      if (col < 0) col = 0;
      return `${absC}${colToLetters(col)}${absR}${row + 1}`;
    },
  );
  return `=${shifted}`;
}

function colToLetters(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
