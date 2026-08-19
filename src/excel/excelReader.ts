import ExcelJS from 'exceljs';
import { Cell, CellFormat, RowData, SourceKind, Workbook, WorkbookMeta, Worksheet } from '../types/workbook';
import { parseA1OrRange } from '../utils/cellRef';

export interface ExcelReadOptions {
  maxRows: number;
}

export interface ExcelReadResult {
  workbook: Workbook;
  truncated: boolean;
  droppedRowsBySheet: Record<string, number>;
}

/**
 * Reads .xlsx and .xlsm via ExcelJS, which understands the OOXML zip format
 * used by both. `.xls` (legacy binary BIFF format, pre-2007) is a different
 * file format entirely and is NOT handled here — see `legacyXlsReader.ts`.
 *
 * ExcelJS preserves cell values, formulas (as text — not recalculated),
 * number formats, fonts, fills, alignment, and merged cells. It does NOT
 * preserve: VBA project binaries (xlsm macros), pivot tables, charts,
 * conditional-formatting rules beyond basic cases, or data validation. Those
 * are recorded in `unsupportedFeatures` so the UI can warn before save
 * rather than silently dropping them.
 */
export async function readXlsxWorkbook(
  buffer: Buffer,
  sourcePath: string,
  sourceKind: 'xlsx' | 'xlsm',
  options: ExcelReadOptions,
): Promise<ExcelReadResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const sheets: Record<string, Worksheet> = {};
  const sheetOrder: string[] = [];
  const droppedRowsBySheet: Record<string, number> = {};
  const unsupportedFeatures: string[] = [];
  let truncatedAny = false;

  if (sourceKind === 'xlsm' && hasVbaProject(wb)) {
    unsupportedFeatures.push(
      'This workbook contains a VBA project (macros). SheetLab can view and edit cell data, but cannot ' +
        'guarantee the VBA project will be preserved byte-for-byte on save. Saving will prompt for confirmation.',
    );
  }

  wb.eachSheet((worksheet) => {
    sheetOrder.push(worksheet.name);
    const rows: Record<number, RowData> = {};
    let colCount = 0;
    let rowCount = 0;
    let dropped = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const zeroRow = rowNumber - 1;
      if (zeroRow >= options.maxRows) {
        dropped++;
        return;
      }
      rowCount = Math.max(rowCount, zeroRow + 1);
      const rowData: RowData = {};
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const zeroCol = colNumber - 1;
        colCount = Math.max(colCount, zeroCol + 1);
        rowData[zeroCol] = convertCell(cell);
      });
      rows[zeroRow] = rowData;
    });

    if (dropped > 0) {
      truncatedAny = true;
      droppedRowsBySheet[worksheet.name] = dropped;
    }

    const columns: Worksheet['columns'] = {};
    worksheet.columns?.forEach((col, idx) => {
      if (col?.width) {
        columns[idx] = { width: Math.round(col.width * 7) }; // Excel width units -> approx px
      }
    });

    sheets[worksheet.name] = {
      name: worksheet.name,
      rowCount,
      colCount,
      rows,
      columns,
      rowMeta: {},
      hidden: worksheet.state === 'hidden' || worksheet.state === 'veryHidden',
      freezePane: extractFreezePane(worksheet),
      tables: extractTables(worksheet),
    };
  });

  const meta: WorkbookMeta = {
    sourceKind: sourceKind as SourceKind,
    sourcePath,
    sheetOrder,
    unsupportedFeatures: unsupportedFeatures.length ? unsupportedFeatures : undefined,
  };

  return { workbook: { meta, sheets }, truncated: truncatedAny, droppedRowsBySheet };
}

function hasVbaProject(wb: ExcelJS.Workbook): boolean {
  // ExcelJS exposes the raw vbaProject buffer when present on the loaded model.
  const anyWb = wb as unknown as { vbaProject?: unknown };
  return Boolean(anyWb.vbaProject);
}

function extractFreezePane(worksheet: ExcelJS.Worksheet): Worksheet['freezePane'] {
  const view = worksheet.views?.[0];
  if (view && view.state === 'frozen') {
    return { row: view.ySplit ?? 0, col: view.xSplit ?? 0 };
  }
  return undefined;
}

/**
 * Reads Excel Table definitions (spec section 23) via ExcelJS's `tables`
 * map, populated after `xlsx.load` parses the table XML parts. This is
 * accessed defensively (the exact internal shape has varied across ExcelJS
 * versions) so an API mismatch degrades to "no tables detected" rather than
 * a crash -- cell data is read independently either way, so nothing is
 * lost, only the table boundary/name metadata.
 */
function extractTables(worksheet: ExcelJS.Worksheet): Worksheet['tables'] {
  const anyWs = worksheet as unknown as {
    tables?: Record<string, { table?: { name?: string; ref?: string; headerRow?: boolean; totalsRow?: boolean; tl?: { row: number; col: number }; columns?: unknown[] } }>;
  };
  const rawTables = anyWs.tables;
  if (!rawTables || typeof rawTables !== 'object') return undefined;

  const result: NonNullable<Worksheet['tables']> = [];
  for (const entry of Object.values(rawTables)) {
    const t = entry?.table;
    if (!t?.name) continue;
    try {
      // `ref` is the OOXML table part's own range attribute (e.g. "A1:D10")
      // -- the authoritative source for the table's boundary. Only fall
      // back to a single-cell guess from `tl` (top-left) if `ref` is
      // missing, since without it we cannot reliably know the row extent.
      const parsedRange = t.ref ? parseA1OrRange(t.ref) : null;
      const range = parsedRange ?? {
        startRow: t.tl?.row ?? 0,
        startCol: t.tl?.col ?? 0,
        endRow: t.tl?.row ?? 0,
        endCol: (t.tl?.col ?? 0) + Math.max(0, (Array.isArray(t.columns) ? t.columns.length : 1) - 1),
      };
      // `totalsRow` mirrors `headerRow`'s defensive read -- ExcelJS's exact
      // property name/shape for this has also varied across versions, so
      // an absent/unexpected value simply means "no totals row detected"
      // rather than a crash.
      result.push({ name: t.name, hasHeaderRow: t.headerRow !== false, hasTotalsRow: t.totalsRow === true, range });
    } catch {
      // Defensive: an unexpected shape for this table entry should never
      // abort loading the rest of the workbook.
      continue;
    }
  }
  return result.length > 0 ? result : undefined;
}

function convertCell(cell: ExcelJS.Cell): Cell {
  const format = convertFormat(cell);

  if (cell.formula) {
    return {
      raw: `=${cell.formula}`,
      value: normalizeResultValue(cell.result),
      type: 'formula',
      formula: cell.formula,
      format,
    };
  }

  const value = cell.value;
  if (value === null || value === undefined) {
    return { raw: null, value: null, type: 'blank', format };
  }
  if (typeof value === 'number') {
    return { raw: String(value), value, type: 'number', format };
  }
  if (typeof value === 'boolean') {
    return { raw: String(value), value, type: 'boolean', format };
  }
  if (value instanceof Date) {
    return { raw: value.toISOString(), value: value.toISOString(), type: 'date', format };
  }
  if (typeof value === 'object' && 'error' in (value as object)) {
    return {
      raw: String((value as ExcelJS.CellErrorValue).error),
      value: null,
      type: 'error',
      error: { code: '#VALUE!', message: String((value as ExcelJS.CellErrorValue).error) },
      format,
    };
  }
  if (typeof value === 'object' && 'richText' in (value as object)) {
    const text = (value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    return { raw: text, value: text, type: 'string', format };
  }
  return { raw: String(value), value: String(value), type: 'string', format };
}

function normalizeResultValue(result: unknown): string | number | boolean | null {
  if (result === null || result === undefined) return null;
  if (typeof result === 'number' || typeof result === 'boolean') return result;
  if (result instanceof Date) return result.toISOString();
  return String(result);
}

function convertFormat(cell: ExcelJS.Cell): CellFormat | undefined {
  const font = cell.font;
  const fill = cell.fill;
  const alignment = cell.alignment;
  const numFmt = cell.numFmt;
  const border = cell.border;

  const format: CellFormat = {};
  let hasAny = false;

  if (font?.bold) { format.bold = true; hasAny = true; }
  if (font?.italic) { format.italic = true; hasAny = true; }
  if (font?.underline) { format.underline = true; hasAny = true; }
  if (font?.size) { format.fontSize = font.size; hasAny = true; }
  if (font?.color?.argb) { format.fontColor = argbToCss(font.color.argb); hasAny = true; }
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid' && fill.fgColor?.argb) {
    format.backgroundColor = argbToCss(fill.fgColor.argb);
    hasAny = true;
  }
  if (alignment?.horizontal) {
    format.align = alignment.horizontal as CellFormat['align'];
    hasAny = true;
  }
  if (alignment?.wrapText) { format.wrapText = true; hasAny = true; }
  if (numFmt) { format.numberFormat = numFmt; hasAny = true; }
  if (border && (border.top || border.right || border.bottom || border.left)) {
    format.border = {
      top: Boolean(border.top),
      right: Boolean(border.right),
      bottom: Boolean(border.bottom),
      left: Boolean(border.left),
    };
    hasAny = true;
  }

  return hasAny ? format : undefined;
}

function argbToCss(argb: string): string {
  // ExcelJS ARGB is 8 hex chars: AARRGGBB
  if (argb.length === 8) {
    return `#${argb.slice(2)}`;
  }
  return `#${argb}`;
}
