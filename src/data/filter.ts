import { Cell, FilterCondition, Worksheet } from '../types/workbook';

/**
 * Returns the set of row indices that MATCH the filter (i.e. should stay
 * visible). Filtering never deletes data — it produces a visibility set that
 * the webview grid applies client-side.
 *
 * The header row is always included so column labels stay visible (Excel-like).
 * Scans dense 0..rowCount-1 so sparse blanks are still evaluated.
 */
export function evaluateFilter(
  sheet: Worksheet,
  col: number,
  condition: FilterCondition,
  headerRow: number,
): Set<number> {
  const matches = new Set<number>();
  // Always keep the header visible
  matches.add(headerRow);

  const rowCount = Math.max(sheet.rowCount, 1);
  for (let r = 0; r < rowCount; r++) {
    if (r === headerRow) continue;
    const cell = sheet.rows[r]?.[col];
    const normalized = normalizeCell(cell);
    if (matchesCondition(normalized, condition)) matches.add(r);
  }
  return matches;
}

function normalizeCell(cell: Cell | undefined): Cell {
  if (!cell) return { raw: null, value: null, type: 'blank' };
  if (cell.type === 'blank') return cell;
  if (cell.value === null || cell.value === undefined || cell.value === '') {
    return { raw: cell.raw, value: null, type: 'blank' };
  }
  return cell;
}

function matchesCondition(cell: Cell, condition: FilterCondition): boolean {
  switch (condition.kind) {
    case 'blank':
      return cell.type === 'blank';
    case 'nonBlank':
      return cell.type !== 'blank';
    case 'textContains': {
      if (cell.type === 'blank') return false;
      return String(cell.value ?? '').toLowerCase().includes(String(condition.value ?? '').toLowerCase());
    }
    case 'textEquals': {
      if (cell.type === 'blank') return false;
      return String(cell.value ?? '').toLowerCase() === String(condition.value ?? '').toLowerCase();
    }
    case 'numberRange': {
      if (cell.type !== 'number' && typeof cell.value !== 'number') {
        const n = Number(cell.value);
        if (!Number.isFinite(n)) return false;
        if (condition.min !== undefined && n < condition.min) return false;
        if (condition.max !== undefined && n > condition.max) return false;
        return true;
      }
      const v = cell.value as number;
      if (condition.min !== undefined && v < condition.min) return false;
      if (condition.max !== undefined && v > condition.max) return false;
      return true;
    }
    case 'dateRange': {
      if (cell.type !== 'date' && typeof cell.value !== 'string') return false;
      const v = new Date(cell.value as string).getTime();
      if (Number.isNaN(v)) return false;
      if (condition.min && v < new Date(condition.min).getTime()) return false;
      if (condition.max && v > new Date(condition.max).getTime()) return false;
      return true;
    }
    case 'valuesIn':
      return condition.values.some((val) => val === cell.value || String(val) === String(cell.value ?? ''));
    default:
      return true;
  }
}

/** Distinct values for a column, used to populate an Excel-style filter dropdown. */
export function distinctColumnValues(
  sheet: Worksheet,
  col: number,
  headerRow: number,
): (string | number | boolean)[] {
  const seen = new Map<string, string | number | boolean>();
  const rowCount = Math.max(sheet.rowCount, 1);
  for (let r = 0; r < rowCount; r++) {
    if (r === headerRow) continue;
    const cell = sheet.rows[r]?.[col];
    if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined || cell.value === '') {
      continue;
    }
    seen.set(String(cell.value), cell.value as string | number | boolean);
  }
  return [...seen.values()].sort((a, b) => String(a).localeCompare(String(b)));
}
