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
  /** CSV/TSV only: spreadsheet | text | side-by-side split. */
  viewMode: 'spreadsheet' | 'text' | 'split' = 'spreadsheet';
  /** Raw source text for CSV/TSV preview pane. */
  textContent = '';


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
    // Default grid-only; open-with-preview command sets preferredViewMode to split.
    this.viewMode = 'spreadsheet';
    this.notify();
  }

  /**
   * Replaces cached rows within [rangeStart, rangeEnd) with `rows` (a full,
   * authoritative snapshot of that range from the host), rather than a
   * naive merge. This matters because a sparse row map omits blank rows
   * entirely -- after a structural change (insert/delete row, sort, clean,
   * paste) shifts content around, a row that's now blank simply won't be a
   * key in `rows`. A plain `{...existing, ...rows}` merge would leave that
   * row's STALE pre-change content sitting in the cache forever, which
   * shows up as ghost/duplicated content (e.g. inserting a row appearing to
   * "duplicate" the row below it, because the old position never got
   * cleared). Clearing the covered range first, then applying the fresh
   * data on top, is correct for both this resync case and the plain
   * incremental-scroll-chunk case (clearing an as-yet-unloaded range is a
   * harmless no-op there).
   */
  mergeSheetRows(sheetName: string, rows: Record<number, RowData>, rangeStart: number, rangeEnd: number): void {
    const existing = this.rowsBySheet[sheetName] ?? {};
    const next: Record<number, RowData> = {};
    for (const [key, row] of Object.entries(existing)) {
      const idx = Number(key);
      if (idx < rangeStart || idx >= rangeEnd) next[idx] = row;
    }
    Object.assign(next, rows);
    this.rowsBySheet[sheetName] = next;
    this.notify();
  }

  replaceSheetRows(sheetName: string, rows: Record<number, RowData>): void {
    this.rowsBySheet[sheetName] = rows;
    this.notify();
  }

  /**
   * Applies a create/rename/delete sheet-list change from the host,
   * including switching the active sheet when the host says it changed
   * (e.g. jumping to a newly created sheet, or falling back to another
   * sheet after the active one was deleted). Resets selection to A1 and
   * clears any stale per-sheet visible-row filter reference so the grid
   * doesn't carry over state from a different sheet.
   */
  applySheetOrderChange(sheetOrder: string[], activeSheet: string, activeSheetSummary?: SerializedWorkbookInit['sheetSummaries'][string]): void {
    this.sheetOrder = sheetOrder;
    if (activeSheetSummary) {
      this.sheetSummaries[activeSheet] = activeSheetSummary;
    }
    if (activeSheet !== this.activeSheet) {
      this.activeSheet = activeSheet;
      this.selection = {
        active: { row: 0, col: 0 },
        range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        editing: false,
      };
    }
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
