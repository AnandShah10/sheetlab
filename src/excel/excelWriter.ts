import ExcelJS from 'exceljs';
import { Cell, CellFormat, Workbook } from '../types/workbook';

/**
 * Serialize our internal Workbook model back into an XLSX/XLSM buffer.
 *
 * Important limitation (documented, not hidden): ExcelJS's writer does not
 * round-trip an untouched workbook byte-for-byte — it rebuilds the OOXML
 * package from the in-memory model. Cell values, formulas (as text),
 * fonts/fills/alignment/number-formats/borders we captured, worksheet
 * names/order, and freeze panes are preserved. Charts, pivot tables, most
 * data-validation rules, and (for .xlsm) the VBA project binary are NOT
 * preserved by this writer. For .xlsm we surface a confirmation prompt
 * before ever calling this function — see xlsmHandler.ts.
 */
export async function writeXlsxWorkbook(workbook: Workbook): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SheetLab';
  wb.created = new Date();
  wb.modified = new Date();

  for (const sheetName of workbook.meta.sheetOrder) {
    const sheet = workbook.sheets[sheetName];
    if (!sheet) continue;
    const ws = wb.addWorksheet(sheetName, {
      state: sheet.hidden ? 'hidden' : 'visible',
      views: sheet.freezePane
        ? [{ state: 'frozen', xSplit: sheet.freezePane.col, ySplit: sheet.freezePane.row }]
        : undefined,
    });

    Object.entries(sheet.rows).forEach(([rowIdxStr, rowData]) => {
      const rowIdx = Number(rowIdxStr);
      Object.entries(rowData).forEach(([colIdxStr, cell]) => {
        const colIdx = Number(colIdxStr);
        const excelCell = ws.getCell(rowIdx + 1, colIdx + 1);
        applyCellValue(excelCell, cell);
        applyCellFormat(excelCell, cell.format);
      });
    });

    Object.entries(sheet.columns).forEach(([colIdxStr, meta]) => {
      const colIdx = Number(colIdxStr);
      const col = ws.getColumn(colIdx + 1);
      col.width = Math.max(2, Math.round(meta.width / 7));
      if (meta.hidden) col.hidden = true;
    });

    registerTablesBestEffort(ws, sheet);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function applyCellValue(excelCell: ExcelJS.Cell, cell: Cell): void {
  switch (cell.type) {
    case 'formula':
      excelCell.value = { formula: cell.formula ?? '', result: coerceFormulaResult(cell.value) } as ExcelJS.CellFormulaValue;
      break;
    case 'number':
      excelCell.value = typeof cell.value === 'number' ? cell.value : Number(cell.value);
      break;
    case 'boolean':
      excelCell.value = Boolean(cell.value);
      break;
    case 'date':
      excelCell.value = typeof cell.value === 'string' ? new Date(cell.value) : null;
      break;
    case 'error':
      excelCell.value = { error: cell.error?.code ?? '#VALUE!' } as ExcelJS.CellErrorValue;
      break;
    case 'blank':
      excelCell.value = null;
      break;
    case 'string':
    default:
      excelCell.value = cell.value !== null ? String(cell.value) : null;
  }
}

function coerceFormulaResult(value: Cell['value']): string | number | boolean | undefined {
  if (value === null) return undefined;
  return value;
}

function applyCellFormat(excelCell: ExcelJS.Cell, format?: CellFormat): void {
  if (!format) return;
  if (format.bold || format.italic || format.underline || format.fontSize || format.fontColor) {
    excelCell.font = {
      bold: format.bold,
      italic: format.italic,
      underline: format.underline,
      size: format.fontSize,
      color: format.fontColor ? { argb: cssToArgb(format.fontColor) } : undefined,
    };
  }
  if (format.backgroundColor) {
    excelCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: cssToArgb(format.backgroundColor) },
    };
  }
  if (format.align || format.wrapText) {
    excelCell.alignment = { horizontal: format.align, wrapText: format.wrapText };
  }
  if (format.numberFormat) {
    excelCell.numFmt = format.numberFormat;
  }
  if (format.border) {
    const thin: ExcelJS.BorderStyle = 'thin';
    excelCell.border = {
      top: format.border.top ? { style: thin } : undefined,
      right: format.border.right ? { style: thin } : undefined,
      bottom: format.border.bottom ? { style: thin } : undefined,
      left: format.border.left ? { style: thin } : undefined,
    };
  }
}

function cssToArgb(css: string): string {
  const hex = css.replace('#', '');
  return `FF${hex.toUpperCase()}`;
}

/**
 * Best-effort registration of Excel Table definitions (spec section 23) via
 * ExcelJS's `addTable`. This is called AFTER all cell values are already
 * written via the loop above, and deliberately omits the `rows` parameter
 * `addTable` accepts -- passing our own row data through it risks ExcelJS
 * overwriting cells with different content than what we already wrote,
 * which would be a data-integrity regression. Omitting `rows` means the
 * worst-case failure mode is `addTable` throwing (caught below, table
 * metadata silently not written, cell data unaffected) rather than any
 * possibility of corrupting cell values. If a given ExcelJS version
 * requires `rows`, this degrades to "the workbook saves with correct cell
 * data but the table isn't registered as a native Excel Table" -- which is
 * the safe direction to fail per this project's stated priority of data
 * integrity over feature completeness.
 */
function registerTablesBestEffort(ws: ExcelJS.Worksheet, sheet: { tables?: { name: string; hasHeaderRow: boolean; range: { startRow: number; startCol: number; endRow: number; endCol: number } }[] }): void {
  if (!sheet.tables) return;
  for (const table of sheet.tables) {
    try {
      const startCell = ws.getCell(table.range.startRow + 1, table.range.startCol + 1).address;
      const colCount = table.range.endCol - table.range.startCol + 1;
      const columns = Array.from({ length: colCount }, (_, i) => {
        const headerCell = table.hasHeaderRow ? ws.getCell(table.range.startRow + 1, table.range.startCol + 1 + i) : undefined;
        return { name: (headerCell?.value ? String(headerCell.value) : `Column${i + 1}`) };
      });
      (ws as unknown as { addTable: (opts: unknown) => void }).addTable({
        name: table.name,
        ref: startCell,
        headerRow: table.hasHeaderRow,
        columns,
      });
    } catch {
      // See function doc: safe to skip silently. Cell data for this range
      // was already written above regardless of whether this succeeds.
      continue;
    }
  }
}
