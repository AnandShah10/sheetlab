import * as XLSX from 'xlsx';
import { Cell, RowData, Workbook, WorkbookMeta, Worksheet } from '../types/workbook';

/**
 * .xls is the legacy OLE2/BIFF binary format, not a zip-based OOXML file —
 * ExcelJS does not read it. We use SheetJS's community ('xlsx') package for
 * this format instead, but treat it as READ-ONLY: SheetJS's free tier does
 * not reliably round-trip binary .xls on write, and silently "saving" to
 * .xls would risk corrupting formatting/formulas the user never touched.
 *
 * Per spec section 58 (no false claims): SheetLab opens .xls, lets you view
 * and copy data and run queries against it, but the Save action for an .xls
 * source offers "Export as XLSX" / "Export as CSV" instead of an in-place
 * overwrite, with that constraint explained in the UI and README.
 */
export function readLegacyXls(buffer: Buffer, sourcePath: string, maxRows: number): {
  workbook: Workbook;
  truncated: boolean;
} {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: true });

  const sheets: Record<string, Worksheet> = {};
  const sheetOrder: string[] = [];
  let truncatedAny = false;

  for (const sheetName of wb.SheetNames) {
    sheetOrder.push(sheetName);
    const ws = wb.Sheets[sheetName];
    const ref = ws['!ref'];
    const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };

    const rows: Record<number, RowData> = {};
    let colCount = 0;
    let rowCount = 0;
    let dropped = 0;

    for (let r = range.s.r; r <= range.e.r; r++) {
      const zeroRow = r - range.s.r;
      if (zeroRow >= maxRows) {
        dropped++;
        continue;
      }
      const rowData: RowData = {};
      let rowHasData = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cellRaw = ws[addr];
        if (!cellRaw) continue;
        rowHasData = true;
        const zeroCol = c - range.s.c;
        colCount = Math.max(colCount, zeroCol + 1);
        rowData[zeroCol] = convertLegacyCell(cellRaw);
      }
      if (rowHasData) {
        rows[zeroRow] = rowData;
        rowCount = Math.max(rowCount, zeroRow + 1);
      }
    }

    if (dropped > 0) truncatedAny = true;

    sheets[sheetName] = { name: sheetName, rowCount, colCount, rows, columns: {}, rowMeta: {} };
  }

  const meta: WorkbookMeta = {
    sourceKind: 'xls',
    sourcePath,
    sheetOrder,
    unsupportedFeatures: [
      'Opened via legacy .xls reader (read-only in this version). Use "Export as XLSX" to save changes.',
    ],
  };

  return { workbook: { meta, sheets }, truncated: truncatedAny };
}

function convertLegacyCell(raw: XLSX.CellObject): Cell {
  if (raw.f) {
    return { raw: `=${raw.f}`, value: normalize(raw.v), type: 'formula', formula: raw.f };
  }
  switch (raw.t) {
    case 'n':
      return { raw: String(raw.v), value: raw.v as number, type: 'number' };
    case 'b':
      return { raw: String(raw.v), value: raw.v as boolean, type: 'boolean' };
    case 'd':
      return { raw: (raw.v as Date).toISOString(), value: (raw.v as Date).toISOString(), type: 'date' };
    case 'e':
      return { raw: String(raw.v), value: null, type: 'error', error: { code: '#VALUE!', message: String(raw.v) } };
    case 's':
    default:
      return { raw: String(raw.v ?? ''), value: raw.v !== undefined ? String(raw.v) : null, type: 'string' };
  }
}

function normalize(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return String(v);
}
