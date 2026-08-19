import { HyperFormula, ExportedCellChange } from 'hyperformula';
import { Cell, CellError, Worksheet } from '../types/workbook';
import { resolveStructuredReferences } from './structuredReferences';

/**
 * Real formula evaluation via HyperFormula (Apache-2.0, actively maintained,
 * pure TypeScript — no native bindings, so it works inside the extension
 * host without extra build steps). HyperFormula supports the functions
 * enumerated in the spec (SUM/SUMIF/SUMIFS, COUNT family, AVERAGE/MIN/MAX,
 * ROUND family, ABS/MOD, IF/IFS/AND/OR/NOT/IFERROR, text functions,
 * date/time basics, VLOOKUP/HLOOKUP/INDEX/MATCH, and XLOOKUP in recent
 * versions) plus full A1/range/cross-sheet references.
 *
 * What we do NOT claim: HyperFormula's function set is large but not 100%
 * identical to Excel's — array formulas, some volatile functions, and a
 * handful of newer Excel functions may be missing. When HyperFormula
 * reports a formula as unparseable, we mark the cell as
 * type: 'error', code: '#UNSUPPORTED!' rather than guessing a value, and we
 * always keep the original formula text so it survives a save untouched.
 */
export class FormulaEngine {
  private readonly hf: HyperFormula;
  private readonly sheetIdByName = new Map<string, number>();
  private readonly sheets: Record<string, Worksheet>;

  constructor(sheets: Record<string, Worksheet>, sheetOrder: string[]) {
    // Stored by reference deliberately: later table create/remove/edit
    // operations mutate `doc.workbook.sheets` (the same object passed in
    // here) in place or reassign a sheet's entry on it, and structured
    // reference resolution below should see those changes without the
    // caller having to re-construct the formula engine.
    this.sheets = sheets;
    this.hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' });

    for (const name of sheetOrder) {
      const sheetId = this.hf.addSheet(name);
      const idNum = this.hf.getSheetId(name);
      if (idNum !== undefined) this.sheetIdByName.set(name, idNum);
      void sheetId;
    }

    for (const name of sheetOrder) {
      const sheet = sheets[name];
      const sheetId = this.sheetIdByName.get(name);
      if (sheetId === undefined) continue;
      const data = this.worksheetToHfMatrix(sheet, name);
      this.hf.setSheetContent(sheetId, data);
    }
  }

  /** Recalculate a single cell edit and propagate to dependents; returns all cells that changed value. */
  setCellAndRecalculate(sheetName: string, row: number, col: number, raw: string): ExportedCellChange[] {
    const sheetId = this.sheetIdByName.get(sheetName);
    if (sheetId === undefined) return [];
    const changes = this.hf.setCellContents({ sheet: sheetId, row, col }, [[this.toHfInput(raw, sheetName, row)]]);
    return changes.filter((c): c is ExportedCellChange => c instanceof ExportedCellChange);
  }

  getCell(sheetName: string, row: number, col: number): Cell {
    const sheetId = this.sheetIdByName.get(sheetName);
    if (sheetId === undefined) return { raw: null, value: null, type: 'blank' };

    const address = { sheet: sheetId, row, col };
    const cellType = this.hf.getCellType(address);
    const formula = this.hf.getCellFormula(address);
    const value = this.hf.getCellValue(address);

    if (formula) {
      if (isHfError(value)) {
        const err = mapHfError(value);
        return { raw: `=${formula}`, value: null, type: 'error', formula, error: err };
      }
      return { raw: `=${formula}`, value: normalizeHfValue(value), type: 'formula', formula };
    }

    if (cellType === 'EMPTY') return { raw: null, value: null, type: 'blank' };
    return { raw: String(value ?? ''), value: normalizeHfValue(value), type: inferTypeFromHf(value) };
  }

  dispose(): void {
    this.hf.destroy();
  }

  private worksheetToHfMatrix(sheet: Worksheet, sheetName: string): (string | number | boolean | null)[][] {
    const matrix: (string | number | boolean | null)[][] = [];
    for (let r = 0; r < sheet.rowCount; r++) {
      const row: (string | number | boolean | null)[] = [];
      for (let c = 0; c < sheet.colCount; c++) {
        const cell = sheet.rows[r]?.[c];
        row.push(cell ? this.toHfInput(cell.type === 'formula' ? (cell.raw ?? '') : String(cell.value ?? ''), sheetName, r) : null);
      }
      matrix.push(row);
    }
    return matrix;
  }

  /**
   * Converts a raw cell input into what HyperFormula expects. For formulas,
   * this is also where Excel structured table references
   * (`Table[Column]`, `Table[@Column]`) get rewritten into plain A1/range
   * references HyperFormula can actually evaluate -- see
   * structuredReferences.ts. Resolution failures (unknown table/column) are
   * a no-op here by design: the formula passes through unchanged and
   * HyperFormula will surface its own parse/name error rather than SheetLab
   * guessing a value.
   */
  private toHfInput(raw: string, sheetName: string, row: number): string | number | boolean | null {
    if (raw === '' || raw === null || raw === undefined) return null;
    if (raw.startsWith('=')) {
      try {
        return resolveStructuredReferences(raw, sheetName, row, this.sheets);
      } catch {
        return raw;
      }
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
    return raw;
  }
}

function isHfError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'type' in (value as object) && 'error' in (value as object);
}

function mapHfError(value: unknown): CellError {
  const v = value as { error?: { type?: string } } | { message?: string };
  const raw = (v as { message?: string }).message ?? '#VALUE!';
  const known: CellError['code'][] = ['#DIV/0!', '#N/A', '#NAME?', '#NULL!', '#NUM!', '#REF!', '#VALUE!'];
  const match = known.find((k) => raw.includes(k));
  return { code: match ?? '#UNSUPPORTED!', message: raw };
}

function normalizeHfValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  return String(value);
}

function inferTypeFromHf(value: unknown): Cell['type'] {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null) return 'blank';
  return 'string';
}
