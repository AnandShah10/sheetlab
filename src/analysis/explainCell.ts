/**
 * Deterministic "why might this cell be wrong?" evidence from neighbors + diagnostics.
 */

import { Workbook } from '../types/workbook';
import { WorkbookDiagnostic } from './types';
import { normalizeFormulaPattern } from './diagnostics';
import { toA1 } from '../utils/cellRef';
import { DependencyGraph } from './dependencyGraph';

export interface CellExplanation {
  address: string;
  sheetName: string;
  row: number;
  col: number;
  formula?: string;
  valuePreview?: string;
  type?: string;
  findings: Array<{ severity: 'error' | 'warning' | 'info'; title: string; detail: string }>;
  neighborPatterns: Array<{ a1: string; formula: string; matches: boolean }>;
  /** If a clear majority neighbor pattern exists, a relative formula to apply */
  proposedFix?: string;
  precedentCount: number;
  dependentCount: number;
}

export function explainCell(
  workbook: Workbook,
  sheetName: string,
  row: number,
  col: number,
  graph?: DependencyGraph,
  diagnostics?: WorkbookDiagnostic[],
): CellExplanation {
  const sheet = workbook.sheets[sheetName];
  const cell = sheet?.rows[row]?.[col];
  const address = `${sheetName}!${toA1(row, col)}`;
  const findings: CellExplanation['findings'] = [];
  const neighborPatterns: CellExplanation['neighborPatterns'] = [];

  const formula = cell?.type === 'formula' ? (cell.formula ? `=${cell.formula}` : String(cell.raw ?? '')) : undefined;

  if (cell?.type === 'error') {
    findings.push({
      severity: 'error',
      title: cell.error?.code ?? 'Formula error',
      detail: cell.error?.message ?? 'This cell evaluates to an error.',
    });
  }

  if (diagnostics) {
    for (const d of diagnostics) {
      if (d.sheetName === sheetName && d.row === row && d.col === col) {
        findings.push({
          severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
          title: d.ruleId,
          detail: d.detail ? `${d.message} — ${d.detail}` : d.message,
        });
      }
    }
  }

  // Neighbor formula pattern comparison (same column, nearby rows)
  if (formula && sheet) {
    const originPattern = normalizeFormulaPattern(formula, row, col);
    for (const delta of [-2, -1, 1, 2]) {
      const nr = row + delta;
      const ncell = sheet.rows[nr]?.[col];
      if (!ncell || ncell.type !== 'formula') continue;
      const nf = ncell.formula ? `=${ncell.formula}` : String(ncell.raw ?? '');
      const np = normalizeFormulaPattern(nf, nr, col);
      const matches = np === originPattern;
      neighborPatterns.push({ a1: toA1(nr, col), formula: nf, matches });
      if (!matches) {
        findings.push({
          severity: 'warning',
          title: 'inconsistent-with-neighbor',
          detail: `Pattern differs from ${toA1(nr, col)} (${nf}). Relative structure of this cell may be wrong.`,
        });
      }
    }
  }

  if (!formula && cell?.type === 'number') {
    // Hardcoded constant in a formula-heavy column?
    let formulaNeighbors = 0;
    for (const delta of [-1, 1]) {
      if (sheet?.rows[row + delta]?.[col]?.type === 'formula') formulaNeighbors++;
    }
    if (formulaNeighbors >= 1) {
      findings.push({
        severity: 'info',
        title: 'hardcoded-among-formulas',
        detail: 'This cell is a constant while neighboring cells in the column are formulas.',
      });
    }
  }

  const node = graph?.getNode({ sheetName, row, col });
  const precedentCount = node?.precedents.length ?? 0;
  const dependentCount = node?.dependents.length ?? 0;

  if (formula && precedentCount === 0) {
    findings.push({
      severity: 'info',
      title: 'no-cell-refs',
      detail: 'Formula does not reference other cells (or refs could not be resolved).',
    });
  }

  if (!findings.length) {
    findings.push({
      severity: 'info',
      title: 'no-issues-detected',
      detail: 'No local lint issues or neighbor pattern mismatches were found for this cell.',
    });
  }

  let proposedFix: string | undefined;
  if (formula && neighborPatterns.length) {
    const matching = neighborPatterns.filter((n) => n.matches);
    const mismatched = neighborPatterns.filter((n) => !n.matches);
    // If we are the outlier (no matches) but neighbors agree with each other, propose adapting the closest matching pattern
    if (mismatched.length && matching.length === 0 && sheet) {
      // Prefer row-1 neighbor formula adjusted relatively
      const above = sheet.rows[row - 1]?.[col];
      if (above?.type === 'formula') {
        const src = above.formula ? `=${above.formula}` : String(above.raw ?? '');
        proposedFix = shiftFormula(src, row - 1, col, row, col);
        findings.push({
          severity: 'info',
          title: 'proposed-fix',
          detail: `Suggested formula based on cell above: ${proposedFix}`,
        });
      }
    }
  }

  return {
    address,
    sheetName,
    row,
    col,
    formula,
    valuePreview: cell?.value != null ? String(cell.value) : undefined,
    type: cell?.type,
    findings,
    neighborPatterns,
    proposedFix,
    precedentCount,
    dependentCount,
  };
}

/** Shift relative A1 refs when copying a formula from one cell to another. */
function shiftFormula(formula: string, fromRow: number, fromCol: number, toRow: number, toCol: number): string {
  const body = formula.startsWith('=') ? formula.slice(1) : formula;
  const dR = toRow - fromRow;
  const dC = toCol - fromCol;
  const shifted = body.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g, (_m, absC: string, letters: string, absR: string, digits: string) => {
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
  });
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
