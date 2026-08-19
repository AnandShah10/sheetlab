import * as Papa from 'papaparse';
import { Cell, CsvDialect, Worksheet } from '../types/workbook';

/**
 * Serialize a Worksheet back to CSV/TSV text using the dialect that was
 * detected (or explicitly configured) when the file was opened, so that
 * round-tripping an untouched file produces byte-for-byte-equivalent output
 * wherever possible (same delimiter, quoting, and line endings).
 */
export function serializeCsv(worksheet: Worksheet, dialect: CsvDialect): string {
  const rowIndices = Object.keys(worksheet.rows)
    .map(Number)
    .sort((a, b) => a - b);

  const maxRow = rowIndices.length > 0 ? rowIndices[rowIndices.length - 1] : -1;
  const data: string[][] = [];

  for (let r = 0; r <= maxRow; r++) {
    const rowData = worksheet.rows[r] ?? {};
    const cols = Object.keys(rowData).map(Number);
    const maxCol = Math.max(worksheet.colCount - 1, cols.length > 0 ? Math.max(...cols) : -1);
    const line: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      line.push(cellToCsvString(rowData[c]));
    }
    data.push(line);
  }

  const csv = Papa.unparse(data, {
    delimiter: dialect.delimiter,
    quoteChar: dialect.quoteChar,
    newline: dialect.lineEnding,
  });

  return csv + dialect.lineEnding; // trailing newline matches common CSV convention
}

function cellToCsvString(cell: Cell | undefined): string {
  if (!cell || cell.type === 'blank' || cell.value === null || cell.value === undefined) {
    return '';
  }
  if (cell.type === 'boolean') {
    return cell.value ? 'true' : 'false';
  }
  return String(cell.value);
}

/** Encode text according to the CSV dialect's declared encoding (BOM handling only; we always write UTF-8 bytes). */
export function encodeCsv(text: string, dialect: CsvDialect): Buffer {
  const body = Buffer.from(text, 'utf8');
  if (dialect.encoding === 'utf8bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
  }
  return body;
}
