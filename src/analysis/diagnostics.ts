/**
 * Spreadsheet lint rules. Conservative heuristics — prefer silence over noise.
 */

import { Workbook } from '../types/workbook';
import { DependencyGraph } from './dependencyGraph';
import { extractFormulaRefs } from './formulaRefs';
import { WorkbookDiagnostic } from './types';
import { toA1 } from '../utils/cellRef';

export function runLinter(
  workbook: Workbook,
  graph: DependencyGraph,
  maxDiagnostics = 500,
): WorkbookDiagnostic[] {
  const out: WorkbookDiagnostic[] = [];
  const push = (d: WorkbookDiagnostic) => {
    if (out.length < maxDiagnostics) out.push(d);
  };

  // Circular references
  const cycles = graph.findCycles(30);
  for (const cycle of cycles) {
    const first = cycle[0];
    if (!first) continue;
    const [sheetName, rc] = first.split('!');
    const [rowStr, colStr] = (rc || '').split(',');
    push({
      id: `cycle:${first}`,
      ruleId: 'circular-reference',
      severity: 'error',
      message: `Circular reference involving ${cycle.length - 1} cell(s)`,
      detail: cycle.map(formatKey).join(' → '),
      sheetName,
      row: Number(rowStr),
      col: Number(colStr),
    });
  }

  for (const sheetName of workbook.meta.sheetOrder) {
    const sheet = workbook.sheets[sheetName];
    if (!sheet) continue;

    // Formula errors + broken refs
    for (const [rowStr, row] of Object.entries(sheet.rows)) {
      for (const [colStr, cell] of Object.entries(row)) {
        const row = Number(rowStr);
        const col = Number(colStr);
        if (cell.type === 'error') {
          push({
            id: `err:${sheetName}:${row}:${col}`,
            ruleId: 'formula-error',
            severity: 'error',
            message: cell.error?.code ?? 'Formula error',
            detail: cell.error?.message ?? cell.raw ?? undefined,
            sheetName,
            row,
            col,
          });
        }
        if (cell.type === 'formula') {
          const formula = cell.formula ? `=${cell.formula}` : String(cell.raw ?? '');
          const refs = extractFormulaRefs(formula, sheetName);
          for (const ref of refs) {
            if (ref.kind === 'cell' && ref.row !== undefined && ref.col !== undefined) {
              const targetSheet = ref.sheetName ?? sheetName;
              if (!workbook.sheets[targetSheet]) {
                push({
                  id: `missing-sheet:${sheetName}:${row}:${col}:${ref.text}`,
                  ruleId: 'broken-reference',
                  severity: 'error',
                  message: `Reference to missing sheet "${targetSheet}"`,
                  sheetName,
                  row,
                  col,
                });
              }
            }
            if (ref.kind === 'unknown') {
              push({
                id: `badref:${sheetName}:${row}:${col}:${ref.text}`,
                ruleId: 'broken-reference',
                severity: 'warning',
                message: `Could not resolve reference "${ref.text}"`,
                sheetName,
                row,
                col,
              });
            }
          }
        }
      }
    }

    // Inconsistent formulas in contiguous formula columns (sample)
    detectInconsistentFormulas(workbook, sheetName, push);

    // Duplicate headers on first row of tables / used range
    const headerRow = sheet.rows[0];
    if (headerRow) {
      const seen = new Map<string, number>();
      for (const [colStr, cell] of Object.entries(headerRow)) {
        const label = String(cell.value ?? cell.raw ?? '').trim().toLowerCase();
        if (!label) continue;
        const col = Number(colStr);
        if (seen.has(label)) {
          push({
            id: `dup-header:${sheetName}:${label}`,
            ruleId: 'duplicate-column-header',
            severity: 'warning',
            message: `Duplicate column header "${cell.value ?? cell.raw}"`,
            sheetName,
            row: 0,
            col,
            related: [{ sheetName, row: 0, col: seen.get(label)! }],
          });
        } else {
          seen.set(label, col);
        }
      }
    }
  }

  // Unused sheets (no formulas reference them and no cross-sheet from them)
  if (workbook.meta.sheetOrder.length > 1) {
    const referenced = new Set<string>();
    for (const addr of graph.getFormulaCells()) {
      const node = graph.getNode(addr);
      if (!node) continue;
      referenced.add(addr.sheetName);
      for (const p of node.precedents) referenced.add(p.sheetName);
    }
    for (const name of workbook.meta.sheetOrder) {
      if (!referenced.has(name) && workbook.meta.sheetOrder[0] !== name) {
        // Only flag if sheet has almost no content
        const sheet = workbook.sheets[name];
        const populated = sheet ? Object.keys(sheet.rows).length : 0;
        if (populated <= 1) {
          push({
            id: `unused-sheet:${name}`,
            ruleId: 'unused-sheet',
            severity: 'info',
            message: `Sheet "${name}" appears unused (few cells, no formula links)`,
            sheetName: name,
          });
        }
      }
    }
  }

  return out;
}

function detectInconsistentFormulas(
  workbook: Workbook,
  sheetName: string,
  push: (d: WorkbookDiagnostic) => void,
): void {
  const sheet = workbook.sheets[sheetName];
  if (!sheet) return;

  // Group formulas by column; compare normalized patterns for contiguous runs
  const byCol = new Map<number, Array<{ row: number; pattern: string; raw: string }>>();
  for (const [rowStr, row] of Object.entries(sheet.rows)) {
    for (const [colStr, cell] of Object.entries(row)) {
      if (cell.type !== 'formula') continue;
      const raw = cell.formula ? `=${cell.formula}` : String(cell.raw ?? '');
      const pattern = normalizeFormulaPattern(raw, Number(rowStr), Number(colStr));
      const col = Number(colStr);
      const list = byCol.get(col) ?? [];
      list.push({ row: Number(rowStr), pattern, raw });
      byCol.set(col, list);
    }
  }

  for (const [col, list] of byCol) {
    list.sort((a, b) => a.row - b.row);
    if (list.length < 3) continue;
    // Find majority pattern in sliding windows of contiguous rows
    let i = 0;
    while (i < list.length) {
      let j = i + 1;
      while (j < list.length && list[j].row === list[j - 1].row + 1) j++;
      const run = list.slice(i, j);
      if (run.length >= 3) {
        const counts = new Map<string, number>();
        for (const r of run) counts.set(r.pattern, (counts.get(r.pattern) ?? 0) + 1);
        let best = '';
        let bestN = 0;
        for (const [p, n] of counts) {
          if (n > bestN) {
            best = p;
            bestN = n;
          }
        }
        if (bestN >= 2) {
          for (const r of run) {
            if (r.pattern !== best) {
              push({
                id: `inconsistent:${sheetName}:${r.row}:${col}`,
                ruleId: 'inconsistent-formula',
                severity: 'warning',
                message: `Formula pattern differs from neighboring cells in column ${toA1(0, col).replace(/\d+/, '')}`,
                detail: `This: ${r.raw} · Expected pattern like neighbors`,
                sheetName,
                row: r.row,
                col,
              });
            }
          }
        }
      }
      i = j;
    }
  }
}

/** Normalize relative refs so D17*E17 and D18*E18 share a pattern. */
export function normalizeFormulaPattern(formula: string, originRow: number, originCol: number): string {
  const body = formula.startsWith('=') ? formula.slice(1) : formula;
  return body.replace(/\$?([A-Za-z]{1,3})\$?(\d+)/g, (_m, letters: string, digits: string) => {
    const col = lettersToCol(letters);
    const row = parseInt(digits, 10) - 1;
    const dr = row - originRow;
    const dc = col - originCol;
    return `[${dc},${dr}]`;
  }).replace(/\s+/g, '').toUpperCase();
}

function lettersToCol(letters: string): number {
  let n = 0;
  const u = letters.toUpperCase();
  for (let i = 0; i < u.length; i++) n = n * 26 + (u.charCodeAt(i) - 64);
  return n - 1;
}

function formatKey(key: string): string {
  const [sheet, rc] = key.split('!');
  const [r, c] = (rc || '').split(',').map(Number);
  if (Number.isFinite(r) && Number.isFinite(c)) return `${sheet}!${toA1(r, c)}`;
  return key;
}
