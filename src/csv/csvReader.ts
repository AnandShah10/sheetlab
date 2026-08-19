import * as Papa from 'papaparse';
import { Cell, CsvDialect, RowData, Worksheet } from '../types/workbook';
import { detectBom, detectDialect, detectHasHeaderRow } from './delimiterDetector';

export interface CsvParseOptions {
  delimiterOverride?: string; // 'auto' means detect
  hasHeaderRowOverride?: 'auto' | 'true' | 'false';
  maxRows: number;
}

export interface CsvParseResult {
  worksheet: Worksheet;
  dialect: CsvDialect;
  truncated: boolean;
  droppedRows: number;
}

/**
 * Parse raw CSV/TSV bytes into a Worksheet using PapaParse for correct
 * handling of quoted fields, escaped quotes ("" inside a quoted field),
 * embedded delimiters, and embedded newlines within quoted cells.
 *
 * We intentionally use PapaParse's synchronous string-mode parser here for
 * files under the configured row cap; for very large files the caller should
 * prefer `parseCsvStreaming` (see below) to avoid holding two full copies of
 * the text in memory.
 */
export function parseCsv(buffer: Buffer, filenameExt: string, options: CsvParseOptions): CsvParseResult {
  const hasBom = detectBom(buffer);
  const text = buffer.toString(hasBom ? 'utf8' : 'utf8');
  const stripped = hasBom ? text.replace(/^\uFEFF/, '') : text;

  const baseDialect = detectDialect(stripped, buffer, filenameExt);
  const delimiter =
    !options.delimiterOverride || options.delimiterOverride === 'auto'
      ? baseDialect.delimiter
      : options.delimiterOverride;

  const parsed = Papa.parse<string[]>(stripped, {
    delimiter,
    quoteChar: '"',
    escapeChar: '"',
    newline: baseDialect.lineEnding,
    skipEmptyLines: false,
    dynamicTyping: false, // we do our own, format-aware typing below
  });

  const allRows = parsed.data;
  const hasHeaderRow =
    options.hasHeaderRowOverride === 'true'
      ? true
      : options.hasHeaderRowOverride === 'false'
        ? false
        : detectHasHeaderRow(allRows);

  const truncated = allRows.length > options.maxRows;
  const droppedRows = truncated ? allRows.length - options.maxRows : 0;
  const rowsToUse = truncated ? allRows.slice(0, options.maxRows) : allRows;

  const rows: Record<number, RowData> = {};
  let colCount = 0;

  rowsToUse.forEach((rawRow, rowIndex) => {
    const rowData: RowData = {};
    rawRow.forEach((rawValue, colIndex) => {
      colCount = Math.max(colCount, colIndex + 1);
      rowData[colIndex] = inferCell(rawValue);
    });
    rows[rowIndex] = rowData;
  });

  const worksheet: Worksheet = {
    name: 'Sheet1',
    rowCount: rowsToUse.length,
    colCount,
    rows,
    columns: {},
    rowMeta: {},
  };

  const dialect: CsvDialect = {
    ...baseDialect,
    delimiter,
    hasHeaderRow,
  };

  return { worksheet, dialect, truncated, droppedRows };
}

/** Infer a typed Cell from a raw CSV string value without over-guessing (dates are conservative). */
function inferCell(raw: string): Cell {
  if (raw === '' || raw === null || raw === undefined) {
    return { raw: null, value: null, type: 'blank' };
  }
  const trimmed = raw.trim();

  if (/^-?\d+(\.\d+)?$/.test(trimmed) && trimmed !== '') {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) {
      return { raw, value: num, type: 'number' };
    }
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return { raw, value: trimmed.toLowerCase() === 'true', type: 'boolean' };
  }
  // ISO-8601 date/datetime only — avoid false positives on ambiguous formats like "1/2/3".
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(trimmed)) {
    return { raw, value: trimmed, type: 'date' };
  }
  return { raw, value: raw, type: 'string' };
}

/**
 * Streaming variant for very large files: parses in chunks via Papa.parse's
 * step callback so the extension host never holds a second fully-materialized
 * copy of the parsed rows alongside the raw text. Used when file size exceeds
 * a threshold chosen by the caller (see documentService.ts).
 */
export function parseCsvStreaming(
  buffer: Buffer,
  filenameExt: string,
  options: CsvParseOptions,
  onChunk: (rows: RowData[], startIndex: number) => void,
): Promise<{ dialect: CsvDialect; totalRows: number; colCount: number; truncated: boolean; droppedRows: number }> {
  return new Promise((resolve, reject) => {
    const hasBom = detectBom(buffer);
    const text = buffer.toString('utf8').replace(hasBom ? /^\uFEFF/ : /^(?!)/, '');
    const baseDialect = detectDialect(text, buffer, filenameExt);
    const delimiter =
      !options.delimiterOverride || options.delimiterOverride === 'auto'
        ? baseDialect.delimiter
        : options.delimiterOverride;

    let rowIndex = 0;
    let colCount = 0;
    let buffered: RowData[] = [];
    let bufferStart = 0;
    let truncated = false;

    Papa.parse<string[]>(text, {
      delimiter,
      quoteChar: '"',
      escapeChar: '"',
      newline: baseDialect.lineEnding,
      skipEmptyLines: false,
      step: (result) => {
        if (rowIndex >= options.maxRows) {
          truncated = true;
          return;
        }
        const rowData: RowData = {};
        (result.data as string[]).forEach((rawValue, colIndex) => {
          colCount = Math.max(colCount, colIndex + 1);
          rowData[colIndex] = inferCell(rawValue);
        });
        buffered.push(rowData);
        if (buffered.length >= options.maxRows) {
          // chunk flush handled below by size, but respect step-level cap too
        }
        if (buffered.length >= 5000) {
          onChunk(buffered, bufferStart);
          bufferStart += buffered.length;
          buffered = [];
        }
        rowIndex++;
      },
      complete: () => {
        if (buffered.length > 0) {
          onChunk(buffered, bufferStart);
        }
        resolve({
          dialect: { ...baseDialect, delimiter },
          totalRows: rowIndex,
          colCount,
          truncated,
          droppedRows: truncated ? rowIndex - options.maxRows : 0,
        });
      },
      error: (err: Error) => reject(err),
    });
  });
}
