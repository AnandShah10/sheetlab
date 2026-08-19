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

export function colLetterToIndex(letters: string): number {
  let n = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    n = n * 26 + (upper.charCodeAt(i) - 64);
  }
  return n - 1;
}

export function toA1(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

const A1_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
const RANGE_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)$/;

export interface ParsedRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

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
  const single = A1_PATTERN.exec(trimmed);
  if (single) {
    const [, colLetters, rowDigits] = single;
    const row = parseInt(rowDigits, 10) - 1;
    const col = colLetterToIndex(colLetters);
    return { startRow: row, endRow: row, startCol: col, endCol: col };
  }
  return null;
}
