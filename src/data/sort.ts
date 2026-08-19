import { Cell, CellRange, SortKey, Worksheet } from '../types/workbook';
import { getRangeAsMatrix } from '../workbook/workbookModel';

/**
 * Sort a range in-place on the worksheet, moving entire rows together so
 * that formulas/relationships within a row are never split across sort
 * boundaries (spec section 19). Formulas that reference cells OUTSIDE the
 * sorted range are not rewritten — like Excel, that's a known sharp edge we
 * surface via `warnings`, not something we silently "fix" by guessing intent.
 */
export function sortRange(
  sheet: Worksheet,
  range: CellRange,
  keys: SortKey[],
  hasHeaderRow: boolean,
): { warnings: string[] } {
  const warnings: string[] = [];
  const dataStartRow = hasHeaderRow ? range.startRow + 1 : range.startRow;
  if (dataStartRow > range.endRow) return { warnings };

  const bodyRange: CellRange = { ...range, startRow: dataStartRow };
  const matrix = getRangeAsMatrix(sheet, bodyRange);

  const hasFormulaOutsideRange = matrix.some((row) =>
    row.some((cell) => cell.type === 'formula' && referencesOutsideRange(cell.formula ?? '', range)),
  );
  if (hasFormulaOutsideRange) {
    warnings.push(
      'Some formulas in this range reference cells outside the sorted range. Their results may no longer ' +
        'match the intended row after sorting — review formulas after sort.',
    );
  }

  const relativeKeys = keys.map((k) => ({ ...k, col: k.col - range.startCol }));

  const indexed = matrix.map((row, i) => ({ row, originalIndex: i }));
  indexed.sort((a, b) => {
    for (const key of relativeKeys) {
      const cmp = compareCells(a.row[key.col], b.row[key.col]);
      const signed = key.direction === 'asc' ? cmp : -cmp;
      if (signed !== 0) return signed;
    }
    return a.originalIndex - b.originalIndex; // stable
  });

  indexed.forEach(({ row }, newOffset) => {
    const targetRow = dataStartRow + newOffset;
    if (!sheet.rows[targetRow]) sheet.rows[targetRow] = {};
    row.forEach((cell, colOffset) => {
      const col = range.startCol + colOffset;
      if (cell.type === 'blank') {
        delete sheet.rows[targetRow][col];
      } else {
        sheet.rows[targetRow][col] = cell;
      }
    });
  });

  return { warnings };
}

function referencesOutsideRange(formula: string, range: CellRange): boolean {
  // Best-effort static check: look for any A1 reference and see if it falls outside range.
  const refPattern = /\$?([A-Za-z]{1,3})\$?(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = refPattern.exec(formula)) !== null) {
    const col = colLetterToIndex(match[1]);
    const row = parseInt(match[2], 10) - 1;
    if (row < range.startRow || row > range.endRow || col < range.startCol || col > range.endCol) {
      return true;
    }
  }
  return false;
}

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  return n - 1;
}

function compareCells(a: Cell, b: Cell): number {
  const aBlank = a.type === 'blank';
  const bBlank = b.type === 'blank';
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1; // blanks sort last, both asc and desc handled by caller flip
  if (bBlank) return -1;

  if (a.type === 'number' && b.type === 'number') {
    return (a.value as number) - (b.value as number);
  }
  if (a.type === 'date' && b.type === 'date') {
    return new Date(a.value as string).getTime() - new Date(b.value as string).getTime();
  }
  if (a.type === 'boolean' && b.type === 'boolean') {
    return Number(a.value) - Number(b.value);
  }
  // Mixed types or text: compare as locale-aware strings.
  return String(a.value ?? '').localeCompare(String(b.value ?? ''), undefined, { numeric: true });
}
