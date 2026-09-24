import * as vscode from 'vscode';
import {
  CellRange,
  FilterSpec,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../../types/workbook';
import { CsvDocumentSync } from '../../csv/csvDocumentSync';
import { getGridSettings, getMaxQueryResultRows } from '../../services/settingsService';
import { UndoStack } from '../../services/undoService';
import { pasteRange, setCellRaw, clearRange } from '../../workbook/workbookModel';
import { sortRange } from '../../data/sort';
import { evaluateFilter } from '../../data/filter';
import { applyCleanup } from '../../data/cleanup';
import { insertRow, deleteRow, insertColumn, deleteColumn, formatRange } from '../../data/rowColOps';
import { setColumnHidden, setRowHidden, showAllColumns, showAllRows } from '../../data/visibility';
import { createTable, removeTable } from '../../data/tables';
import { searchWorkbook } from '../../services/searchService';
import { runQuery } from '../../query/queryEngine';
import { getWebviewHtml } from '../shared/webviewHtml';
import { transformationRecorder } from '../../pipelines/recorder';
import { Workbook, Worksheet } from '../../types/workbook';
import { trackPanelFocus } from '../../services/activePanelRegistry';

/**
 * Registered with `priority: "option"` in package.json, so a .csv/.tsv file
 * still opens in VS Code's normal text editor by default. This provider only
 * activates when the user explicitly runs "Open as Spreadsheet" (which calls
 * `vscode.commands.executeCommand('vscode.openWith', uri, ExcelEditorProvider... )`
 * — see commands/openCsvAsSpreadsheet.ts).
 *
 * Because this is a CustomTextEditorProvider, `resolveCustomTextEditor`
 * receives the exact same `vscode.TextDocument` VS Code uses for the plain
 * text editor. See csv/csvDocumentSync.ts for why that single fact is what
 * makes CSV text<->spreadsheet synchronization (spec section 27) tractable
 * instead of a hand-rolled two-copies-of-the-file problem.
 */
export class CsvSpreadsheetEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'sheetlab.csvSpreadsheetEditor';

  /**
   * Preferred view mode per document URI. Survives re-open of the same custom
   * editor (VS Code reuses the panel and may not fire resolve/ready again).
   */
  private static readonly preferredModeByUri = new Map<string, 'spreadsheet' | 'split'>();

  /** Live webview panels so we can push a mode change when the user picks the other open command. */
  private static readonly panelsByUri = new Map<string, vscode.WebviewPanel>();

  static getPreferredMode(uri: vscode.Uri): 'spreadsheet' | 'split' {
    return CsvSpreadsheetEditorProvider.preferredModeByUri.get(uri.toString()) ?? 'spreadsheet';
  }

  static setPreferredMode(uri: vscode.Uri, mode: 'spreadsheet' | 'split'): void {
    CsvSpreadsheetEditorProvider.preferredModeByUri.set(uri.toString(), mode);
  }

  /**
   * Set mode for this file, open/reveal the custom editor, and if a panel is
   * already open push the new mode into the webview immediately.
   */
  static async openWithMode(uri: vscode.Uri, mode: 'spreadsheet' | 'split'): Promise<void> {
    CsvSpreadsheetEditorProvider.setPreferredMode(uri, mode);
    const key = uri.toString();
    const existing = CsvSpreadsheetEditorProvider.panelsByUri.get(key);
    // Always openWith so VS Code switches from the text editor to the custom editor.
    await vscode.commands.executeCommand('vscode.openWith', uri, CsvSpreadsheetEditorProvider.viewType);
    // Panel may still be the previous one (retainContextWhenHidden) — force mode on it.
    const panel = CsvSpreadsheetEditorProvider.panelsByUri.get(key) ?? existing;
    if (panel) {
      panel.reveal(panel.viewColumn, false);
      panel.webview.postMessage({ type: 'forceViewMode', mode });
      // Second tick: webview may still be handling reveal/focus.
      setTimeout(() => {
        panel.webview.postMessage({ type: 'forceViewMode', mode });
      }, 50);
    }
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new CsvSpreadsheetEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(CsvSpreadsheetEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const sync = new CsvDocumentSync(document);
    const session: CsvSession = { sync, undoStack: new UndoStack(), panel };

    const docKey = document.uri.toString();
    CsvSpreadsheetEditorProvider.panelsByUri.set(docKey, panel);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    panel.webview.html = getWebviewHtml(panel.webview, this.context.extensionUri, 'SheetLab (CSV)');

    const post = (msg: HostToWebviewMessage) => panel.webview.postMessage(msg);
    const focusSub = trackPanelFocus(panel, post, {
      getWorkbook: () => ({
        meta: { sourceKind: sync.getDialect().delimiter === '\t' ? 'tsv' : 'csv', sourcePath: document.uri.fsPath, sheetOrder: [sync.getWorksheet().name] },
        sheets: { [sync.getWorksheet().name]: sync.getWorksheet() },
      }),
      getActiveSheetName: () => sync.getWorksheet().name,
    });

    const changeSub = sync.onDidChange(({ external }) => {
      if (external) {
        post({
          type: 'externalChange',
          message: 'This CSV changed (edited as text, or modified outside VS Code). The spreadsheet view has been refreshed.',
        });
        resyncActiveSheet();
        post({ type: 'textContent', text: sync.getDocumentText() });
      }
    });

    const dirtySub = vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved.uri.toString() === document.uri.toString()) {
        post({ type: 'saved', dirty: false });
      }
    });

    const resyncActiveSheet = () => {
      const sheet = sync.getWorksheet();
      const settings = getGridSettings();
      post({
        type: 'sheetData',
        sheetName: sheet.name,
        rows: sliceRows(sheet.rows, 0, settings.chunkSize),
        rowRangeStart: 0,
        rowRangeEnd: settings.chunkSize,
      });
      post({
        type: 'sheetMeta',
        sheetName: sheet.name,
        columns: sheet.columns,
        rowMeta: sheet.rowMeta,
        tables: sheet.tables ?? [],
        freezePane: sheet.freezePane,
      });
      post({ type: 'textContent', text: sync.getDocumentText() });
      const { truncated, droppedRows } = sync.getTruncationInfo();
      if (truncated) {
        post({
          type: 'error',
          message: `This CSV has more rows than the configured limit; ${droppedRows} trailing rows were not loaded. ` +
            `Increase "sheetlab.performance.maxRowsInMemory" to load more.`,
        });
      }
    };

    panel.webview.onDidReceiveMessage(async (raw: WebviewToHostMessage) => {
      try {
        await this.handleMessage(session, raw, post, resyncActiveSheet);
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error', detail: String(err) });
      }
    });

    panel.onDidDispose(() => {
      CsvSpreadsheetEditorProvider.panelsByUri.delete(docKey);
      changeSub.dispose();
      dirtySub.dispose();
      focusSub.dispose();
      sync.dispose();
    });
  }

  private async handleMessage(
    session: CsvSession,
    msg: WebviewToHostMessage,
    post: (m: HostToWebviewMessage) => void,
    resyncActiveSheet: () => void,
  ): Promise<void> {
    const { sync, undoStack } = session;
    const settings = getGridSettings();

    switch (msg.type) {
      case 'ready': {
        const sheet = sync.getWorksheet();
        const preferredViewMode = CsvSpreadsheetEditorProvider.getPreferredMode(session.sync.getDocumentUri());
        post({
          type: 'init',
          settings,
          textContent: session.sync.getDocumentText(),
          preferredViewMode,
          workbook: {
            meta: {
              sourceKind: sync.getDialect().delimiter === '\t' ? 'tsv' : 'csv',
              sourcePath: documentUri(session),
              sheetOrder: [sheet.name],
            } as unknown as Workbook['meta'],
            sheetOrder: [sheet.name],
            sheetSummaries: { [sheet.name]: { rowCount: sheet.rowCount, colCount: sheet.colCount, columns: sheet.columns, rowMeta: sheet.rowMeta, tables: sheet.tables ?? [], freezePane: sheet.freezePane } },
            firstSheet: {
              name: sheet.name,
              rows: sliceRows(sheet.rows, 0, settings.chunkSize),
              rowRangeEnd: settings.chunkSize,
            },
          },
        });
        return;
      }

      case 'setViewMode': {
        // Remember so the next open command / re-init matches the user's last choice
        // for this file; open-as-spreadsheet / open-preview still override via openWithMode.
        const mode = msg.mode === 'split' || msg.mode === 'text' ? 'split' : 'spreadsheet';
        if (msg.mode === 'spreadsheet' || msg.mode === 'split') {
          CsvSpreadsheetEditorProvider.setPreferredMode(session.sync.getDocumentUri(), msg.mode);
        } else if (msg.mode === 'text') {
          CsvSpreadsheetEditorProvider.setPreferredMode(session.sync.getDocumentUri(), 'split');
        }
        void mode;
        return;
      }

      case 'applyTextContent': {
        await sync.applyRawText(msg.text);
        resyncActiveSheet();
        post({ type: 'textContent', text: sync.getDocumentText() });
        post({ type: 'dirtyChanged', dirty: sync.isDirty() });
        pushTextContent(session, post);
        return;
      }

      case 'requestSheetRows': {
        const sheet = sync.getWorksheet();
        post({
          type: 'sheetData',
          sheetName: sheet.name,
          rows: sliceRows(sheet.rows, msg.startRow, msg.endRow),
          rowRangeStart: msg.startRow,
          rowRangeEnd: msg.endRow,
        });
        return;
      }

      case 'editCell': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        const cell = setCellRaw(next, msg.row, msg.col, msg.raw);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Edit cell' });
        await sync.commitWorksheet(next);
        post({ type: 'applyEdit', edit: { sheetName: next.name, row: msg.row, col: msg.col, cell } });
        post({ type: 'undoRedoState', canUndo: undoStack.canUndo(), canRedo: undoStack.canRedo() });
        post({ type: 'dirtyChanged', dirty: sync.isDirty() });
        pushTextContent(session, post);
        return;
      }

      case 'pasteRange': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        pasteRange(next, msg.startRow, msg.startCol, msg.data);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Paste' });
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'clearRange': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        clearRange(next, msg.range as CellRange);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Clear' });
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'sortRange': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        const { warnings } = sortRange(next, msg.range as CellRange, msg.keys, msg.hasHeaderRow);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Sort' });
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        if (warnings.length) post({ type: 'error', message: warnings.join(' ') });
        return;
      }

      case 'applyFilter': {
        const sheet = sync.getWorksheet();
        const filter = msg.filter as FilterSpec;
        const matches = evaluateFilter(sheet, filter.col, filter.condition, 0);
        post({ type: 'filterResult', sheetName: sheet.name, col: filter.col, visibleRows: Array.from(matches) });
        return;
      }

      case 'cleanData': {
        const before = clone(sync.getWorksheet());
        const cleaned = applyCleanup(sync.getWorksheet(), msg.range as CellRange, msg.operation);
        undoStack.push({ sheetName: cleaned.name, before, after: clone(cleaned), label: 'Clean data' });
        await sync.commitWorksheet(cleaned);
        resyncActiveSheet();
        transformationRecorder.record(msg.sheetName, msg.range, msg.operation);
        return;
      }

      case 'undo': {
        const entry = undoStack.undo();
        if (entry) {
          await sync.commitWorksheet(entry.before);
          resyncActiveSheet();
        }
        post({ type: 'undoRedoState', canUndo: undoStack.canUndo(), canRedo: undoStack.canRedo() });
        return;
      }

      case 'redo': {
        const entry = undoStack.redo();
        if (entry) {
          await sync.commitWorksheet(entry.after);
          resyncActiveSheet();
        }
        post({ type: 'undoRedoState', canUndo: undoStack.canUndo(), canRedo: undoStack.canRedo() });
        return;
      }

      case 'requestExport': {
        await vscode.commands.executeCommand('sheetlab.exportWorkbook');
        return;
      }

      case 'exportWorkbook': {
        const map: Record<string, string> = {
          xlsx: 'sheetlab.exportAsXlsx',
          csv: 'sheetlab.exportAsCsv',
          tsv: 'sheetlab.exportAsTsv',
          ods: 'sheetlab.exportAsOds',
          xls: 'sheetlab.exportAsXls',
          xlsm: 'sheetlab.exportAsXlsm',
        };
        await vscode.commands.executeCommand(map[msg.format] ?? 'sheetlab.exportAsXlsx');
        return;
      }

      case 'save': {
        await sync.save();
        post({ type: 'saved', dirty: false });
        return;
      }

      case 'runSearch': {
        const sheet = sync.getWorksheet();
        const fakeWorkbook: Workbook = {
          meta: { sourceKind: 'csv', sourcePath: '', sheetOrder: [sheet.name] },
          sheets: { [sheet.name]: sheet },
        };
        const matches = searchWorkbook(fakeWorkbook, sheet.name, msg.query, { ...msg.options, scope: 'currentSheet' });
        post({ type: 'searchResults', matches, total: matches.length });
        return;
      }

      case 'runQuery': {
        const sheet = sync.getWorksheet();
        const fakeWorkbook: Workbook = {
          meta: { sourceKind: 'csv', sourcePath: '', sheetOrder: [sheet.name] },
          sheets: { [sheet.name]: sheet },
        };
        const result = runQuery(fakeWorkbook, msg.sql, getMaxQueryResultRows());
        if ('message' in result) {
          post({ type: 'queryError', error: result });
        } else {
          post({ type: 'queryResult', result });
        }
        return;
      }

      case 'resizeColumn': {
        const sheet = sync.getWorksheet();
        sheet.columns[msg.col] = { ...sheet.columns[msg.col], width: msg.width };
        return;
      }

      case 'resizeRow': {
        const sheet = sync.getWorksheet();
        sheet.rowMeta[msg.row] = { ...sheet.rowMeta[msg.row], height: msg.height };
        return;
      }

      case 'formatCells': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        formatRange(next, msg.range, msg.format);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Format' });
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'insertRow': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        insertRow(next, msg.at);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Insert row' });
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'deleteRow': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        deleteRow(next, msg.at);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Delete row' });
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'insertColumn': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        insertColumn(next, msg.at);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Insert column' });
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'deleteColumn': {
        const before = clone(sync.getWorksheet());
        const next = clone(sync.getWorksheet());
        deleteColumn(next, msg.at);
        undoStack.push({ sheetName: next.name, before, after: clone(next), label: 'Delete column' });
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'setColumnHidden': {
        const next = clone(sync.getWorksheet());
        setColumnHidden(next, msg.col, msg.hidden);
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'setRowHidden': {
        const next = clone(sync.getWorksheet());
        setRowHidden(next, msg.row, msg.hidden);
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'showAllHidden': {
        const next = clone(sync.getWorksheet());
        if (msg.axis === 'column') showAllColumns(next);
        else showAllRows(next);
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'createTable': {
        const next = clone(sync.getWorksheet());
        try {
          createTable(next, msg.range, msg.name, msg.hasHeaderRow, msg.hasTotalsRow ?? false);
        } catch (err) {
          post({ type: 'error', message: err instanceof Error ? err.message : 'Could not create table' });
          return;
        }
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }

      case 'removeTable': {
        const next = clone(sync.getWorksheet());
        removeTable(next, msg.name);
        await sync.commitWorksheet(next);
        resyncActiveSheet();
        return;
      }
    }
  }
}

interface CsvSession {
  sync: CsvDocumentSync;
  undoStack: UndoStack;
  panel: vscode.WebviewPanel;
}

function sliceRows(rows: Worksheet['rows'], start: number, end: number): Worksheet['rows'] {
  const out: Worksheet['rows'] = {};
  for (const key of Object.keys(rows)) {
    const idx = Number(key);
    if (idx >= start && idx < end) out[idx] = rows[idx];
  }
  return out;
}

function clone(sheet: Worksheet): Worksheet {
  return JSON.parse(JSON.stringify(sheet));
}


function documentUri(session: CsvSession): string {
  return session.sync.getSourcePath();
}

/** After grid mutations, keep the text pane in sync with the TextDocument. */
function pushTextContent(session: CsvSession, post: (m: import('../../types/workbook').HostToWebviewMessage) => void): void {
  post({ type: 'textContent', text: session.sync.getDocumentText() });
}
