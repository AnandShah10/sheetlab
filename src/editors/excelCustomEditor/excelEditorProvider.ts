import * as vscode from 'vscode';
import * as path from 'path';
import {
  CellRange,
  FilterSpec,
  HostToWebviewMessage,
  SortKey,
  WebviewToHostMessage,
  Workbook,
} from '../../types/workbook';
import { readXlsxWorkbook } from '../../excel/excelReader';
import { readLegacyXls } from '../../excel/legacyXlsReader';
import { saveExcelWorkbook } from '../../services/saveService';
import { getGridSettings, isCalculationEnabled } from '../../services/settingsService';
import { getMaxQueryResultRows } from '../../services/settingsService';
import { UndoStack } from '../../services/undoService';
import { ExcelConflictWatcher, promptExternalChange } from '../../services/conflictService';
import { getSheet, pasteRange, setCellRaw, clearRange, createWorksheet, renameWorksheet, deleteWorksheet } from '../../workbook/workbookModel';
import { sortRange } from '../../data/sort';
import { evaluateFilter } from '../../data/filter';
import { applyCleanup } from '../../data/cleanup';
import { insertRow, deleteRow, insertColumn, deleteColumn, formatRange } from '../../data/rowColOps';
import { setColumnHidden, setRowHidden, showAllColumns, showAllRows } from '../../data/visibility';
import { createTable, removeTable } from '../../data/tables';
import { searchWorkbook } from '../../services/searchService';
import { runQuery } from '../../query/queryEngine';
import { getWebviewHtml } from '../shared/webviewHtml';
import { FormulaEngine } from '../../formula/formulaEngine';
import { trackPanelFocus } from '../../services/activePanelRegistry';

/** One instance per open .xlsx/.xls/.xlsm document — VS Code's CustomDocument contract. */
class ExcelDocument implements vscode.CustomDocument {
  workbook!: Workbook;
  activeSheet!: string;
  readonly undoStack = new UndoStack();
  conflictWatcher?: ExcelConflictWatcher;
  formulaEngine?: FormulaEngine;
  private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.onDidDisposeEmitter.event;

  constructor(public readonly uri: vscode.Uri) {}

  dispose(): void {
    this.conflictWatcher?.dispose();
    this.formulaEngine?.dispose();
    this.onDidDisposeEmitter.fire();
    this.onDidDisposeEmitter.dispose();
  }
}

export class ExcelEditorProvider implements vscode.CustomEditorProvider<ExcelDocument> {
  public static readonly viewType = 'sheetlab.excelEditor';

  private readonly onDidChangeCustomDocumentEmitter = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<ExcelDocument> | vscode.CustomDocumentContentChangeEvent<ExcelDocument>
  >();
  public readonly onDidChangeCustomDocument = this.onDidChangeCustomDocumentEmitter.event;

  private readonly dirtyDocuments = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ExcelEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(ExcelEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<ExcelDocument> {
    const doc = new ExcelDocument(uri);
    await this.loadWorkbook(doc);
    const stat = await vscode.workspace.fs.stat(uri);
    doc.conflictWatcher = new ExcelConflictWatcher(uri, stat.mtime);
    doc.conflictWatcher.onExternalChange(() => this.handleExternalChange(doc));
    return doc;
  }

  private async loadWorkbook(doc: ExcelDocument): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(doc.uri);
    const buffer = Buffer.from(bytes);
    const ext = path.extname(doc.uri.fsPath).toLowerCase();
    const settings = getGridSettings();
    const maxRows = vscode.workspace.getConfiguration('sheetlab').get<number>('performance.maxRowsInMemory', 500000);
    void settings;

    if (ext === '.xls') {
      const { workbook } = readLegacyXls(buffer, doc.uri.fsPath, maxRows);
      doc.workbook = workbook;
    } else {
      const kind = ext === '.xlsm' ? 'xlsm' : 'xlsx';
      const { workbook } = await readXlsxWorkbook(buffer, doc.uri.fsPath, kind, { maxRows });
      doc.workbook = workbook;
    }
    doc.activeSheet = doc.workbook.meta.sheetOrder[0];
    if (isCalculationEnabled()) {
      doc.formulaEngine = new FormulaEngine(doc.workbook.sheets, doc.workbook.meta.sheetOrder);
    }
  }

  private async handleExternalChange(doc: ExcelDocument): Promise<void> {
    const choice = await promptExternalChange(this.dirtyDocuments.has(doc.uri.toString()));
    if (choice === 'reload') {
      await this.loadWorkbook(doc);
      this.dirtyDocuments.delete(doc.uri.toString());
    }
    // 'keepMine' and 'cancel' both leave the in-memory workbook untouched.
  }

  async resolveCustomEditor(
    doc: ExcelDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    panel.webview.html = getWebviewHtml(panel.webview, this.context.extensionUri, 'SheetLab');

    const post = (msg: HostToWebviewMessage) => panel.webview.postMessage(msg);
    const focusSub = trackPanelFocus(panel, post, {
      getWorkbook: () => doc.workbook,
      getActiveSheetName: () => doc.activeSheet,
    });

    panel.webview.onDidReceiveMessage(async (raw: WebviewToHostMessage) => {
      try {
        await this.handleMessage(doc, raw, post);
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error', detail: String(err) });
      }
    });

    panel.onDidDispose(() => focusSub.dispose());
  }

  private async handleMessage(
    doc: ExcelDocument,
    msg: WebviewToHostMessage,
    post: (m: HostToWebviewMessage) => void,
  ): Promise<void> {
    const settings = getGridSettings();

    switch (msg.type) {
      case 'ready': {
        const firstSheet = getSheet(doc.workbook, doc.activeSheet);
        post({
          type: 'init',
          settings,
          workbook: {
            meta: doc.workbook.meta,
            sheetOrder: doc.workbook.meta.sheetOrder,
            sheetSummaries: Object.fromEntries(
              Object.entries(doc.workbook.sheets).map(([name, s]) => [
                name,
                { rowCount: s.rowCount, colCount: s.colCount, columns: s.columns, rowMeta: s.rowMeta, tables: s.tables ?? [], freezePane: s.freezePane },
              ]),
            ),
            firstSheet: {
              name: doc.activeSheet,
              rows: sliceRows(firstSheet.rows, 0, settings.chunkSize),
              rowRangeEnd: settings.chunkSize,
            },
          },
        });
        return;
      }

      case 'requestSheetRows': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        post({
          type: 'sheetData',
          sheetName: msg.sheetName,
          rows: sliceRows(sheet.rows, msg.startRow, msg.endRow),
          rowRangeStart: msg.startRow,
          rowRangeEnd: msg.endRow,
        });
        return;
      }

      case 'editCell': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        const cell = doc.formulaEngine
          ? this.editViaFormulaEngine(doc, msg.sheetName, msg.row, msg.col, msg.raw)
          : setCellRaw(sheet, msg.row, msg.col, msg.raw);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Edit cell' });
        this.markDirty(doc);
        post({ type: 'applyEdit', edit: { sheetName: msg.sheetName, row: msg.row, col: msg.col, cell } });
        post({ type: 'undoRedoState', canUndo: doc.undoStack.canUndo(), canRedo: doc.undoStack.canRedo() });
        return;
      }

      case 'pasteRange': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        pasteRange(sheet, msg.startRow, msg.startCol, msg.data);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Paste' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'clearRange': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        clearRange(sheet, msg.range);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Clear' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'sortRange': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        const { warnings } = sortRange(sheet, msg.range, msg.keys as SortKey[], msg.hasHeaderRow);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Sort' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        if (warnings.length) post({ type: 'error', message: warnings.join(' ') });
        return;
      }

      case 'applyFilter': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const filter = msg.filter as FilterSpec;
        const matches = evaluateFilter(sheet, filter.col, filter.condition, 0);
        post({ type: 'filterResult', sheetName: msg.sheetName, col: filter.col, visibleRows: Array.from(matches) });
        return;
      }

      case 'cleanData': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        const cleaned = applyCleanup(sheet, msg.range as CellRange, msg.operation);
        doc.workbook.sheets[msg.sheetName] = cleaned;
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(cleaned), label: 'Clean data' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'undo': {
        const entry = doc.undoStack.undo();
        if (entry) {
          doc.workbook.sheets[entry.sheetName] = entry.before;
          this.resyncSheet(doc, entry.sheetName, post);
        }
        post({ type: 'undoRedoState', canUndo: doc.undoStack.canUndo(), canRedo: doc.undoStack.canRedo() });
        return;
      }

      case 'redo': {
        const entry = doc.undoStack.redo();
        if (entry) {
          doc.workbook.sheets[entry.sheetName] = entry.after;
          this.resyncSheet(doc, entry.sheetName, post);
        }
        post({ type: 'undoRedoState', canUndo: doc.undoStack.canUndo(), canRedo: doc.undoStack.canRedo() });
        return;
      }

      case 'save': {
        doc.conflictWatcher?.notifyOwnWritePending();
        const ok = await saveExcelWorkbook(doc.workbook, doc.uri);
        if (ok) {
          this.dirtyDocuments.delete(doc.uri.toString());
          await doc.conflictWatcher?.refreshKnownMtime();
          post({ type: 'saved', dirty: false });
        }
        return;
      }

      case 'switchSheet': {
        doc.activeSheet = msg.sheetName;
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'createSheet': {
        createWorksheet(doc.workbook, msg.name);
        this.markDirty(doc);
        return;
      }

      case 'renameSheet': {
        renameWorksheet(doc.workbook, msg.oldName, msg.newName);
        this.markDirty(doc);
        return;
      }

      case 'deleteSheet': {
        deleteWorksheet(doc.workbook, msg.name);
        this.markDirty(doc);
        return;
      }

      case 'runSearch': {
        const matches = searchWorkbook(doc.workbook, doc.activeSheet, msg.query, msg.options);
        post({ type: 'searchResults', matches, total: matches.length });
        return;
      }

      case 'runQuery': {
        const result = runQuery(doc.workbook, msg.sql, getMaxQueryResultRows());
        if ('message' in result) {
          post({ type: 'queryError', error: result });
        } else {
          post({ type: 'queryResult', result });
        }
        return;
      }

      case 'resizeColumn': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        sheet.columns[msg.col] = { ...sheet.columns[msg.col], width: msg.width };
        this.markDirty(doc);
        return;
      }

      case 'resizeRow': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        sheet.rowMeta[msg.row] = { ...sheet.rowMeta[msg.row], height: msg.height };
        this.markDirty(doc);
        return;
      }

      case 'setFreezePane': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        sheet.freezePane = msg.pane;
        this.markDirty(doc);
        this.pushSheetMeta(doc, msg.sheetName, post);
        return;
      }

      case 'formatCells': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        formatRange(sheet, msg.range, msg.format);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Format' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'insertRow': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        insertRow(sheet, msg.at);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Insert row' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'deleteRow': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        deleteRow(sheet, msg.at);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Delete row' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'insertColumn': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        insertColumn(sheet, msg.at);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Insert column' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'deleteColumn': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        deleteColumn(sheet, msg.at);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Delete column' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'setColumnHidden': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        setColumnHidden(sheet, msg.col, msg.hidden);
        this.markDirty(doc);
        this.pushSheetMeta(doc, msg.sheetName, post);
        return;
      }

      case 'setRowHidden': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        setRowHidden(sheet, msg.row, msg.hidden);
        this.markDirty(doc);
        this.pushSheetMeta(doc, msg.sheetName, post);
        return;
      }

      case 'showAllHidden': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        if (msg.axis === 'column') showAllColumns(sheet);
        else showAllRows(sheet);
        this.markDirty(doc);
        this.pushSheetMeta(doc, msg.sheetName, post);
        return;
      }

      case 'createTable': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        try {
          createTable(sheet, msg.range, msg.name, msg.hasHeaderRow, msg.hasTotalsRow ?? false);
        } catch (err) {
          post({ type: 'error', message: err instanceof Error ? err.message : 'Could not create table' });
          return;
        }
        this.markDirty(doc);
        this.pushSheetMeta(doc, msg.sheetName, post);
        return;
      }

      case 'removeTable': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        removeTable(sheet, msg.name);
        this.markDirty(doc);
        this.pushSheetMeta(doc, msg.sheetName, post);
        return;
      }
    }
  }

  private editViaFormulaEngine(doc: ExcelDocument, sheetName: string, row: number, col: number, raw: string) {
    doc.formulaEngine!.setCellAndRecalculate(sheetName, row, col, raw);
    const cell = doc.formulaEngine!.getCell(sheetName, row, col);
    const sheet = getSheet(doc.workbook, sheetName);
    if (!sheet.rows[row]) sheet.rows[row] = {};
    sheet.rows[row][col] = cell;
    return cell;
  }

  private resyncSheet(doc: ExcelDocument, sheetName: string, post: (m: HostToWebviewMessage) => void): void {
    const sheet = getSheet(doc.workbook, sheetName);
    const settings = getGridSettings();
    post({
      type: 'sheetData',
      sheetName,
      rows: sliceRows(sheet.rows, 0, settings.chunkSize),
      rowRangeStart: 0,
      rowRangeEnd: settings.chunkSize,
    });
    this.pushSheetMeta(doc, sheetName, post);
  }

  private pushSheetMeta(doc: ExcelDocument, sheetName: string, post: (m: HostToWebviewMessage) => void): void {
    const sheet = getSheet(doc.workbook, sheetName);
    post({
      type: 'sheetMeta',
      sheetName,
      columns: sheet.columns,
      rowMeta: sheet.rowMeta,
      tables: sheet.tables ?? [],
      freezePane: sheet.freezePane,
    });
  }

  private markDirty(doc: ExcelDocument): void {
    this.dirtyDocuments.add(doc.uri.toString());
    this.onDidChangeCustomDocumentEmitter.fire({ document: doc });
  }

  async saveCustomDocument(doc: ExcelDocument): Promise<void> {
    doc.conflictWatcher?.notifyOwnWritePending();
    await saveExcelWorkbook(doc.workbook, doc.uri);
    this.dirtyDocuments.delete(doc.uri.toString());
    await doc.conflictWatcher?.refreshKnownMtime();
  }

  async saveCustomDocumentAs(doc: ExcelDocument, destination: vscode.Uri): Promise<void> {
    await saveExcelWorkbook(doc.workbook, destination);
  }

  async revertCustomDocument(doc: ExcelDocument): Promise<void> {
    await this.loadWorkbook(doc);
    this.dirtyDocuments.delete(doc.uri.toString());
  }

  async backupCustomDocument(
    doc: ExcelDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    const buffer = await require('../../excel/excelWriter').writeXlsxWorkbook(doc.workbook);
    await vscode.workspace.fs.writeFile(context.destination, buffer);
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          /* ignore */
        }
      },
    };
  }
}

function sliceRows(rows: Record<number, unknown>, start: number, end: number): Record<number, any> {
  const out: Record<number, any> = {};
  for (const key of Object.keys(rows)) {
    const idx = Number(key);
    if (idx >= start && idx < end) out[idx] = (rows as any)[idx];
  }
  return out;
}

function structuredCloneSheet<T>(sheet: T): T {
  return JSON.parse(JSON.stringify(sheet));
}
