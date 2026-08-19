import { Cell, FilterCondition, Worksheet } from '../types/workbook';

/**
 * Returns the set of row indices that MATCH the filter (i.e. should stay
 * visible). Filtering never deletes data — it produces a visibility set that
 * the webview grid applies client-side, and multiple column filters are
 * combined with AND, matching Excel's AutoFilter semantics.
 */
export function evaluateFilter(
  sheet: Worksheet,
  col: number,
  condition: FilterCondition,
  headerRow: number,
): Set<number> {
  const matches = new Set<number>();
  const rowIndices = Object.keys(sheet.rows)
    .map(Number)
    .filter((r) => r !== headerRow);

  for (const r of rowIndices) {
    const cell = sheet.rows[r]?.[col] ?? { raw: null, value: null, type: 'blank' as const };
    if (matchesCondition(cell, condition)) matches.add(r);
  }
  return matches;
}

function matchesCondition(cell: Cell, condition: FilterCondition): boolean {
  switch (condition.kind) {
    case 'blank':
      return cell.type === 'blank';
    case 'nonBlank':
      return cell.type !== 'blank';
    case 'textContains':
      return String(cell.value ?? '').toLowerCase().includes(condition.value.toLowerCase());
    case 'textEquals':
      return String(cell.value ?? '').toLowerCase() === condition.value.toLowerCase();
    case 'numberRange': {
      if (cell.type !== 'number') return false;
      const v = cell.value as number;
      if (condition.min !== undefined && v < condition.min) return false;
      if (condition.max !== undefined && v > condition.max) return false;
      return true;
    }
    case 'dateRange': {
      if (cell.type !== 'date') return false;
      const v = new Date(cell.value as string).getTime();
      if (condition.min && v < new Date(condition.min).getTime()) return false;
      if (condition.max && v > new Date(condition.max).getTime()) return false;
      return true;
    }
    case 'valuesIn':
      return condition.values.some((val) => val === cell.value);
    default:
      return true;
  }
}

/** Distinct values for a column, used to populate an Excel-style filter dropdown. */
export function distinctColumnValues(sheet: Worksheet, col: number, headerRow: number): (string | number | boolean)[] {
  const seen = new Map<string, string | number | boolean>();
  for (const [rowStr, row] of Object.entries(sheet.rows)) {
    if (Number(rowStr) === headerRow) continue;
    const cell = row[col];
    if (!cell || cell.type === 'blank' || cell.value === null) continue;
    seen.set(String(cell.value), cell.value);
  }
  return Array.from(seen.values());
}
