import { Cell } from '../types/workbook';

/**
 * Excel and most spreadsheet apps put/accept clipboard data as
 * tab-separated values with rows separated by newlines (the "TSV clipboard"
 * convention), which is what makes copy/paste interoperate between Excel,
 * Google Sheets, and SheetLab. We use the same convention here.
 */
export function cellsToClipboardText(matrix: Cell[][]): string {
  return matrix
    .map((row) => row.map((cell) => escapeForClipboard(displayValue(cell))).join('\t'))
    .join('\n');
}

export function clipboardTextToMatrix(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return parseDelimited(normalized);
}

/**
 * Quote-aware tab/newline tokenizer for pasted clipboard text. A naive
 * `.split('\n')` breaks as soon as a copied cell contains an embedded
 * newline inside a quoted field (e.g. copied from a cell with wrapped
 * text) — this walks the string character-by-character so quoted spans
 * can contain literal tabs and newlines.
 */
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

  // Drop a single trailing all-empty row caused by a trailing newline in the copied text.
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }
  return rows;
}

function displayValue(cell: Cell): string {
  if (cell.type === 'blank' || cell.value === null) return '';
  if (cell.type === 'formula') return cell.raw ?? '';
  return String(cell.value);
}

function escapeForClipboard(value: string): string {
  if (value.includes('\t') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
