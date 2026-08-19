import { Cell, CellRange } from '../../../src/types/workbook';
import { appState } from '../state/appState';

export function cellsToClipboardMatrix(sheetName: string, range: CellRange): Cell[][] {
  const matrix: Cell[][] = [];
  for (let r = range.startRow; r <= range.endRow; r++) {
    const row: Cell[] = [];
    for (let c = range.startCol; c <= range.endCol; c++) {
      row.push(appState.getCell(sheetName, r, c));
    }
    matrix.push(row);
  }
  return matrix;
}

export function matrixToClipboardText(matrix: Cell[][]): string {
  return matrix
    .map((row) =>
      row
        .map((cell) => {
          const text = cell.type === 'blank' || cell.value === null ? '' : cell.type === 'formula' ? (cell.raw ?? '') : String(cell.value);
          return escapeCell(text);
        })
        .join('\t'),
    )
    .join('\n');
}

export function clipboardTextToMatrix(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return parseDelimited(normalized);
}

/** Quote-aware tab/newline tokenizer — see src/services/clipboardService.ts for rationale (kept in sync). */
function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === '\t') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  row.push(field);
  rows.push(row);

  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }
  return rows;
}

function escapeCell(value: string): string {
  if (value.includes('\t') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
