export type AggregateFn = 'sum' | 'count' | 'counta' | 'average' | 'min' | 'max';

export function aggregate(values: (number | null)[], fn: AggregateFn): number | null {
  const numeric = values.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

  switch (fn) {
    case 'sum':
      return numeric.length ? numeric.reduce((a, b) => a + b, 0) : 0;
    case 'count':
      return numeric.length;
    case 'counta':
      return values.filter((v) => v !== null).length;
    case 'average':
      return numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;
    case 'min':
      return numeric.length ? Math.min(...numeric) : null;
    case 'max':
      return numeric.length ? Math.max(...numeric) : null;
    default:
      return null;
  }
}

/** Selection-summary stats shown in the status bar (spec section 42). */
export interface SelectionStats {
  cellCount: number;
  rowCount: number;
  colCount: number;
  sum: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  numericCount: number;
}

export function computeSelectionStats(values: (number | null)[], rowCount: number, colCount: number): SelectionStats {
  const numeric = values.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  return {
    cellCount: values.length,
    rowCount,
    colCount,
    numericCount: numeric.length,
    sum: numeric.length ? numeric.reduce((a, b) => a + b, 0) : null,
    average: numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null,
    min: numeric.length ? Math.min(...numeric) : null,
    max: numeric.length ? Math.max(...numeric) : null,
  };
}
