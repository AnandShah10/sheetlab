/** Convert a 0-based column index to Excel-style letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function colIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Convert Excel-style column letters to a 0-based column index: A -> 0, AA -> 26. */
export function colLetterToIndex(letters: string): number {
  let n = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    n = n * 26 + (upper.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Build an A1 reference from 0-based row/col, e.g. (0, 0) -> "A1". */
export function toA1(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

const A1_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
const RANGE_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)$/;

export interface ParsedRef {
  row: number;
  col: number;
}

/** Parse a single-cell A1 reference. Returns null if the string is not a valid reference. */
export function parseA1(ref: string): ParsedRef | null {
  const trimmed = ref.trim();
  const match = A1_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, colLetters, rowDigits] = match;
  return { col: colLetterToIndex(colLetters), row: parseInt(rowDigits, 10) - 1 };
}

export interface ParsedRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Parse an A1 reference or range: "B2", "A1:C10". Handles absolute markers ($).
 * Returns null when the input is neither a valid single cell nor a valid range.
 */
export function parseA1OrRange(ref: string): ParsedRange | null {
  const trimmed = ref.trim();
  const rangeMatch = RANGE_PATTERN.exec(trimmed);
  if (rangeMatch) {
    const [, c1, r1, c2, r2] = rangeMatch;
    const rowA = parseInt(r1, 10) - 1;
    const rowB = parseInt(r2, 10) - 1;
    const colA = colLetterToIndex(c1);
    const colB = colLetterToIndex(c2);
    return {
      startRow: Math.min(rowA, rowB),
      endRow: Math.max(rowA, rowB),
      startCol: Math.min(colA, colB),
      endCol: Math.max(colA, colB),
    };
  }
  const single = parseA1(trimmed);
  if (single) {
    return { startRow: single.row, endRow: single.row, startCol: single.col, endCol: single.col };
  }
  return null;
}

export function rangeToA1(range: ParsedRange): string {
  const start = toA1(range.startRow, range.startCol);
  const end = toA1(range.endRow, range.endCol);
  return start === end ? start : `${start}:${end}`;
}
