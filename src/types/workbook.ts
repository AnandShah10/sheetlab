/**
 * Core data model shared between the extension host and the Webview.
 * Kept dependency-free (no `vscode` or DOM imports) so it can be imported
 * from both sides of the message boundary without bundling issues.
 */

export type CellValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'formula'
  | 'error'
  | 'blank';

export interface CellError {
  code: '#DIV/0!' | '#N/A' | '#NAME?' | '#NULL!' | '#NUM!' | '#REF!' | '#VALUE!' | '#UNSUPPORTED!';
  message: string;
}

/**
 * A single cell. `raw` is what a user typed or what came from the source file
 * (e.g. `=SUM(A1:A5)` for a formula, `"1234"` for text-that-looks-numeric).
 * `value` is the resolved, typed value used for display/sorting/aggregation.
 * `formula` is populated only when type === 'formula'.
 */
export interface Cell {
  raw: string | null;
  value: string | number | boolean | null;
  type: CellValueType;
  formula?: string;
  error?: CellError;
  format?: CellFormat;
}

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  align?: 'left' | 'center' | 'right';
  wrapText?: boolean;
  numberFormat?: string; // e.g. '0.00', '0%', '$#,##0.00', 'yyyy-mm-dd'
  border?: {
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
  };
}

/** Sparse row storage: column index -> Cell. Absent columns are blank. */
export type RowData = Record<number, Cell>;

export interface ColumnMeta {
  width: number;
  hidden?: boolean;
}

export interface RowMeta {
  height: number;
  hidden?: boolean;
}

export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface NamedRange {
  name: string;
  sheetName: string;
  range: CellRange;
}

export interface ExcelTableMeta {
  name: string;
  range: CellRange;
  hasHeaderRow: boolean;
  /** Whether the last row of `range` is a totals row (spec section 23's [#Totals] structured-reference item). Defaults to false when absent from older-saved data. */
  hasTotalsRow?: boolean;
}

export interface FreezePane {
  row: number; // number of frozen rows from top
  col: number; // number of frozen columns from left
}

/**
 * A worksheet. Rows are stored sparsely (map keyed by row index) so that
 * a 500,000-row sheet with mostly-empty regions doesn't allocate dense arrays.
 */
export interface Worksheet {
  name: string;
  rowCount: number;
  colCount: number;
  rows: Record<number, RowData>;
  columns: Record<number, ColumnMeta>;
  rowMeta: Record<number, RowMeta>;
  hidden?: boolean;
  freezePane?: FreezePane;
  tables?: ExcelTableMeta[];
}

export type SourceKind = 'xlsx' | 'xls' | 'xlsm' | 'csv' | 'tsv';

export interface WorkbookMeta {
  sourceKind: SourceKind;
  sourcePath: string;
  sheetOrder: string[];
  namedRanges?: NamedRange[];
  /** Populated for CSV/TSV so we can round-trip formatting faithfully. */
  csvDialect?: CsvDialect;
  /** Features detected in the source file that SheetLab cannot fully preserve on save. */
  unsupportedFeatures?: string[];
  truncated?: {
    reason: string;
    droppedRows: number;
  };
}

export interface CsvDialect {
  delimiter: string;
  quoteChar: string;
  hasHeaderRow: boolean;
  lineEnding: '\n' | '\r\n';
  encoding: 'utf8' | 'utf8bom' | 'latin1';
}

export interface Workbook {
  meta: WorkbookMeta;
  sheets: Record<string, Worksheet>;
}

// ---------------------------------------------------------------------------
// Extension <-> Webview protocol
// ---------------------------------------------------------------------------

/** Messages sent from the extension host to the webview. */
export type HostToWebviewMessage =
  | { type: 'init'; workbook: SerializedWorkbookInit; settings: GridSettings }
  | { type: 'sheetData'; sheetName: string; rows: Record<number, RowData>; rowRangeStart: number; rowRangeEnd: number }
  | { type: 'applyEdit'; edit: CellEditResult }
  | { type: 'undoRedoState'; canUndo: boolean; canRedo: boolean }
  | { type: 'saved'; dirty: false }
  | { type: 'dirtyChanged'; dirty: boolean }
  | { type: 'externalChange'; message: string }
  | { type: 'queryResult'; result: QueryResultPayload }
  | { type: 'queryError'; error: QueryErrorPayload }
  | { type: 'searchResults'; matches: SearchMatch[]; total: number }
  | { type: 'filterResult'; sheetName: string; col: number; visibleRows: number[] }
  | {
      type: 'sheetMeta';
      sheetName: string;
      columns: Record<number, ColumnMeta>;
      rowMeta: Record<number, RowMeta>;
      tables: ExcelTableMeta[];
      freezePane?: FreezePane;
    }
  | { type: 'uiCommand'; command: UiCommand }
  | { type: 'error'; message: string; detail?: string };

/** Focus/toggle actions triggered from the Command Palette or keybindings, routed to whichever SheetLab panel is active. */
export type UiCommand =
  | 'openSearch'
  | 'openQuery'
  | 'openGoToCell'
  | 'openCleanData'
  | 'openNewWorksheetPrompt'
  | 'toggleFormulaBar'
  | 'toggleGridlines'
  | 'freezePanesAtSelection';

/** Messages sent from the webview to the extension host. */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'requestSheetRows'; sheetName: string; startRow: number; endRow: number }
  | { type: 'editCell'; sheetName: string; row: number; col: number; raw: string }
  | { type: 'pasteRange'; sheetName: string; startRow: number; startCol: number; data: string[][] }
  | { type: 'clearRange'; sheetName: string; range: CellRange }
  | { type: 'sortRange'; sheetName: string; range: CellRange; keys: SortKey[]; hasHeaderRow: boolean }
  | { type: 'applyFilter'; sheetName: string; filter: FilterSpec }
  | { type: 'clearFilter'; sheetName: string }
  | { type: 'runSearch'; query: string; options: SearchOptions }
  | { type: 'runQuery'; sql: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'switchSheet'; sheetName: string }
  | { type: 'createSheet'; name: string }
  | { type: 'renameSheet'; oldName: string; newName: string }
  | { type: 'deleteSheet'; name: string }
  | { type: 'resizeColumn'; sheetName: string; col: number; width: number }
  | { type: 'resizeRow'; sheetName: string; row: number; height: number }
  | { type: 'setFreezePane'; sheetName: string; pane: FreezePane }
  | { type: 'cleanData'; sheetName: string; range: CellRange; operation: CleanupOperation }
  | { type: 'formatCells'; sheetName: string; range: CellRange; format: Partial<CellFormat> }
  | { type: 'insertRow'; sheetName: string; at: number }
  | { type: 'deleteRow'; sheetName: string; at: number }
  | { type: 'insertColumn'; sheetName: string; at: number }
  | { type: 'deleteColumn'; sheetName: string; at: number }
  | { type: 'setColumnHidden'; sheetName: string; col: number; hidden: boolean }
  | { type: 'setRowHidden'; sheetName: string; row: number; hidden: boolean }
  | { type: 'showAllHidden'; sheetName: string; axis: 'row' | 'column' }
  | { type: 'createTable'; sheetName: string; range: CellRange; name: string; hasHeaderRow: boolean; hasTotalsRow?: boolean }
  | { type: 'removeTable'; sheetName: string; name: string };

export interface SerializedWorkbookInit {
  meta: WorkbookMeta;
  sheetOrder: string[];
  sheetSummaries: Record<
    string,
    {
      rowCount: number;
      colCount: number;
      columns: Record<number, ColumnMeta>;
      rowMeta: Record<number, RowMeta>;
      tables: ExcelTableMeta[];
      freezePane?: FreezePane;
    }
  >;
  /** First chunk of rows for the initially active sheet so the grid can paint immediately. */
  firstSheet: { name: string; rows: Record<number, RowData>; rowRangeEnd: number };
}

export interface GridSettings {
  theme: 'auto' | 'dark' | 'light' | 'high-contrast';
  fontSize: number;
  rowHeight: number;
  defaultColumnWidth: number;
  showGridlines: boolean;
  chunkSize: number;
}

export interface CellEditResult {
  sheetName: string;
  row: number;
  col: number;
  cell: Cell;
}

export interface SortKey {
  col: number;
  direction: 'asc' | 'desc';
}

export type FilterCondition =
  | { kind: 'textContains'; value: string }
  | { kind: 'textEquals'; value: string }
  | { kind: 'numberRange'; min?: number; max?: number }
  | { kind: 'dateRange'; min?: string; max?: string }
  | { kind: 'blank' }
  | { kind: 'nonBlank' }
  | { kind: 'valuesIn'; values: (string | number | boolean)[] };

export interface FilterSpec {
  col: number;
  condition: FilterCondition;
}

export interface SearchOptions {
  scope: 'currentSheet' | 'workbook';
  regex: boolean;
  caseSensitive: boolean;
  wholeCell: boolean;
  replaceWith?: string;
}

export interface SearchMatch {
  sheetName: string;
  row: number;
  col: number;
  preview: string;
}

export type CleanupOperation =
  | { kind: 'trimWhitespace' }
  | { kind: 'removeEmptyRows' }
  | { kind: 'removeEmptyColumns' }
  | { kind: 'removeDuplicateRows' }
  | { kind: 'normalizeCase'; mode: 'upper' | 'lower' | 'title' }
  | { kind: 'findReplace'; find: string; replace: string; regex: boolean }
  | { kind: 'convertTextToNumber' }
  | { kind: 'convertNumberToText' }
  | { kind: 'fillDown' }
  | { kind: 'fillRight' }
  | { kind: 'splitColumn'; delimiter: string }
  | { kind: 'mergeColumns'; cols: number[]; separator: string };

export interface QueryResultPayload {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface QueryErrorPayload {
  message: string;
  line?: number;
  column?: number;
  expression?: string;
}
