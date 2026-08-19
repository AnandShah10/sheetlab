import {
  Cell,
  CellRange,
  GridSettings,
  RowData,
  SerializedWorkbookInit,
  WorkbookMeta,
} from '../../../src/types/workbook';

export interface SelectionState {
  active: { row: number; col: number };
  range: CellRange;
  editing: boolean;
}

export type ListenerFn = () => void;

/**
 * Minimal observable store (no framework) so `grid`, `toolbar`, `formulaBar`,
 * `nameBox`, and `sheetTabs` can all react to the same state without a
 * bundled UI library. Kept intentionally small: the state that actually
 * needs to be shared across modules, nothing else.
 */
export class AppState {
  meta!: WorkbookMeta;
  sheetOrder: string[] = [];
  sheetSummaries: SerializedWorkbookInit['sheetSummaries'] = {};
  activeSheet = '';
  rowsBySheet: Record<string, Record<number, RowData>> = {};
  visibleRowFilter: Record<string, Set<number> | null> = {}; // null = no filter applied
  settings!: GridSettings;

  selection: SelectionState = {
    active: { row: 0, col: 0 },
    range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
    editing: false,
  };

  canUndo = false;
  canRedo = false;
  dirty = false;
  showFormulaBar = true;
  showGridlines = true;

  private listeners: ListenerFn[] = [];

  subscribe(fn: ListenerFn): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  notify(): void {
    for (const l of this.listeners) l();
  }

  initFromHost(init: SerializedWorkbookInit, settings: GridSettings): void {
    this.meta = init.meta;
    this.sheetOrder = init.sheetOrder;
    this.sheetSummaries = init.sheetSummaries;
    this.activeSheet = init.firstSheet.name;
    this.rowsBySheet = { [init.firstSheet.name]: init.firstSheet.rows };
    this.visibleRowFilter = { [init.firstSheet.name]: null };
    this.settings = settings;
    this.showGridlines = settings.showGridlines;
    this.notify();
  }

  mergeSheetRows(sheetName: string, rows: Record<number, RowData>): void {
    const existing = this.rowsBySheet[sheetName] ?? {};
    this.rowsBySheet[sheetName] = { ...existing, ...rows };
    this.notify();
  }

  replaceSheetRows(sheetName: string, rows: Record<number, RowData>): void {
    this.rowsBySheet[sheetName] = rows;
    this.notify();
  }

  updateSheetMeta(
    sheetName: string,
    meta: { columns: SerializedWorkbookInit['sheetSummaries'][string]['columns']; rowMeta: SerializedWorkbookInit['sheetSummaries'][string]['rowMeta']; tables: SerializedWorkbookInit['sheetSummaries'][string]['tables']; freezePane: SerializedWorkbookInit['sheetSummaries'][string]['freezePane'] },
  ): void {
    const existing = this.sheetSummaries[sheetName];
    this.sheetSummaries[sheetName] = {
      rowCount: existing?.rowCount ?? 0,
      colCount: existing?.colCount ?? 0,
      ...meta,
    };
    this.notify();
  }

  getCell(sheetName: string, row: number, col: number): Cell {
    return this.rowsBySheet[sheetName]?.[row]?.[col] ?? { raw: null, value: null, type: 'blank' };
  }

  setCellLocally(sheetName: string, row: number, col: number, cell: Cell): void {
    if (!this.rowsBySheet[sheetName]) this.rowsBySheet[sheetName] = {};
    if (!this.rowsBySheet[sheetName][row]) this.rowsBySheet[sheetName][row] = {};
    this.rowsBySheet[sheetName][row][col] = cell;
    this.notify();
  }

  currentRowCount(): number {
    return this.sheetSummaries[this.activeSheet]?.rowCount ?? 0;
  }

  currentColCount(): number {
    return Math.max(this.sheetSummaries[this.activeSheet]?.colCount ?? 0, 26);
  }
}

export const appState = new AppState();
