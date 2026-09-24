/**
 * Extract A1 / sheet!A1 / range references from formula text without full
 * Excel grammar. Good enough for dependency graphs, lint, and navigation.
 * Structured table refs are recognized as opaque structured refs.
 *
 * Supported:
 * - A1, $B$2
 * - A1:C10
 * - Sheet1!B2, 'My Sheet'!$A$1
 * - Full-column Customers!A:F
 * - Full-row 1:10
 * - Table1[Column]
 */

import { colLetterToIndex, parseA1, parseA1OrRange } from '../utils/cellRef';
import { ExtractedRef } from './types';

/**
 * Groups:
 * 1 quoted sheet  2 bare sheet
 * 3 cell/range/col-range/row-range A1 part
 * 4 table name    5 structured column
 */
const REF_TOKEN =
  /(?:(?:'([^']+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)|([A-Za-z_][\w.]*)\[([^\]]*)\]/g;

/** Cap used when expanding whole-column refs so graphs stay bounded. */
export const WHOLE_COLUMN_ROW_CAP = 200;

/**
 * Strip string literals so we don't treat "A1" inside a string as a reference.
 */
export function stripFormulaStrings(formula: string): string {
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      i++;
      while (i < formula.length) {
        if (formula[i] === '"' && formula[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (formula[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function extractFormulaRefs(formula: string, defaultSheet: string): ExtractedRef[] {
  const body = formula.startsWith('=') ? formula.slice(1) : formula;
  const scan = stripFormulaStrings(body);
  const refs: ExtractedRef[] = [];
  const seen = new Set<string>();

  REF_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_TOKEN.exec(scan)) !== null) {
    // Structured Table[col] — groups 4 & 5
    if (m[4] !== undefined) {
      const key = `S:${m[4]}[${m[5]}]`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({
        kind: 'structured',
        text: m[0],
        tableName: m[4],
        columnName: m[5],
        sheetName: defaultSheet,
      });
      continue;
    }

    const sheetName = (m[1] || m[2] || defaultSheet).trim();
    const a1 = m[3];
    if (!a1) continue;

    const key = `${sheetName}!${a1.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cleaned = a1.replace(/\$/g, '');

    // Full column range: A:F
    const colRange = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/i.exec(cleaned);
    if (colRange) {
      const startCol = colLetterToIndex(colRange[1]);
      const endCol = colLetterToIndex(colRange[2]);
      refs.push({
        kind: 'range',
        text: m[0],
        sheetName,
        range: {
          startRow: 0,
          endRow: WHOLE_COLUMN_ROW_CAP - 1,
          startCol: Math.min(startCol, endCol),
          endCol: Math.max(startCol, endCol),
        },
      });
      continue;
    }

    // Full row range: 1:10
    const rowRange = /^(\d+):(\d+)$/.exec(cleaned);
    if (rowRange) {
      const startRow = parseInt(rowRange[1], 10) - 1;
      const endRow = parseInt(rowRange[2], 10) - 1;
      refs.push({
        kind: 'range',
        text: m[0],
        sheetName,
        range: {
          startRow: Math.min(startRow, endRow),
          endRow: Math.max(startRow, endRow),
          startCol: 0,
          endCol: 25,
        },
      });
      continue;
    }

    if (cleaned.includes(':')) {
      const range = parseA1OrRange(cleaned);
      if (!range) {
        refs.push({ kind: 'unknown', text: m[0], sheetName });
        continue;
      }
      refs.push({
        kind: 'range',
        text: m[0],
        sheetName,
        range,
      });
    } else {
      const cell = parseA1(cleaned);
      if (!cell) {
        refs.push({ kind: 'unknown', text: m[0], sheetName });
        continue;
      }
      refs.push({
        kind: 'cell',
        text: m[0],
        sheetName,
        row: cell.row,
        col: cell.col,
      });
    }
  }

  return refs;
}

/** Expand a range ref into individual cell addresses (capped). */
export function expandRangeCells(
  sheetName: string,
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
  maxCells: number,
): Array<{ sheetName: string; row: number; col: number }> {
  const cells: Array<{ sheetName: string; row: number; col: number }> = [];
  for (let r = range.startRow; r <= range.endRow; r++) {
    for (let c = range.startCol; c <= range.endCol; c++) {
      cells.push({ sheetName, row: r, col: c });
      if (cells.length >= maxCells) return cells;
    }
  }
  return cells;
}

export function cellKey(sheetName: string, row: number, col: number): string {
  return `${sheetName}!${row},${col}`;
}

export function formatAddress(sheetName: string, row: number, col: number): string {
  const letters = (() => {
    let n = col + 1;
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  })();
  return `${sheetName}!${letters}${row + 1}`;
}
