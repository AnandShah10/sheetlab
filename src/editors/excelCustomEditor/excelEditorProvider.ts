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
import { insertRow, deleteRow, insertColumn, deleteColumn, duplicateRow, duplicateColumn, formatRange } from '../../data/rowColOps';
import { setColumnHidden, setRowHidden, showAllColumns, showAllRows } from '../../data/visibility';
import { createTable, removeTable } from '../../data/tables';
import { searchWorkbook, replaceInWorkbook } from '../../services/searchService';
import { runQuery } from '../../query/queryEngine';
import { getWebviewHtml } from '../shared/webviewHtml';
import { FormulaEngine } from '../../formula/formulaEngine';
import { AnalysisService } from '../../services/analysisService';
import { trackPanelFocus } from '../../services/activePanelRegistry';

/** One instance per open .xlsx/.xls/.xlsm document — VS Code's CustomDocument contract. */
class ExcelDocument implements vscode.CustomDocument {
  workbook!: Workbook;
  activeSheet!: string;
  readonly undoStack = new UndoStack();
  conflictWatcher?: ExcelConflictWatcher;
  formulaEngine?: FormulaEngine;
  analysis?: AnalysisService;
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
  /** Strong refs so VS Code save can always resolve the open document. */
  private readonly documents = new Map<string, ExcelDocument>();

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
    const key = uri.toString();
    // Reuse an existing document instance for the same URI when possible so
    // VS Code's save path never loses the CustomDocument reference.
    let doc = this.documents.get(key);
    if (!doc) {
      doc = new ExcelDocument(uri);
      this.documents.set(key, doc);
      doc.onDidDispose(() => {
        this.documents.delete(key);
        this.dirtyDocuments.delete(key);
      });
    }
    await this.loadWorkbook(doc);
    const stat = await vscode.workspace.fs.stat(uri);
    doc.conflictWatcher?.dispose();
    doc.conflictWatcher = new ExcelConflictWatcher(uri, stat.mtime);
    doc.conflictWatcher.onExternalChange(() => this.handleExternalChange(doc!));
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
    } else if (ext === '.ods') {
      // ODS via SheetJS (xlsx package)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const XLSX = require('xlsx') as typeof import('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: true });
      const sheets: typeof doc.workbook.sheets = {};
      const sheetOrder: string[] = [];
      for (const name of wb.SheetNames) {
        sheetOrder.push(name);
        const ws = wb.Sheets[name];
        const ref = ws['!ref'];
        const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
        const rows: Record<number, Record<number, import('../../types/workbook').Cell>> = {};
        let rowCount = 0;
        let colCount = 0;
        for (let r = range.s.r; r <= Math.min(range.e.r, maxRows - 1); r++) {
          const rowData: Record<number, import('../../types/workbook').Cell> = {};
          let has = false;
          for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = ws[addr];
            if (!cell) continue;
            has = true;
            colCount = Math.max(colCount, c + 1);
            if (cell.f) {
              rowData[c] = { raw: `=${cell.f}`, value: cell.v ?? null, type: 'formula', formula: cell.f };
            } else if (cell.t === 'n') {
              rowData[c] = { raw: String(cell.v ?? ''), value: Number(cell.v), type: 'number' };
            } else if (cell.v === undefined || cell.v === null || cell.v === '') {
              rowData[c] = { raw: null, value: null, type: 'blank' };
            } else {
              rowData[c] = { raw: String(cell.v), value: String(cell.v), type: 'string' };
            }
          }
          if (has) {
            rows[r] = rowData;
            rowCount = Math.max(rowCount, r + 1);
          }
        }
        sheets[name] = {
          name,
          rowCount: Math.max(rowCount, 1),
          colCount: Math.max(colCount, 1),
          rows,
          columns: {},
          rowMeta: {},
        };
      }
      doc.workbook = {
        meta: { sourceKind: 'ods', sourcePath: doc.uri.fsPath, sheetOrder },
        sheets,
      };
    } else {
      const kind = ext === '.xlsm' ? 'xlsm' : 'xlsx';
      const { workbook } = await readXlsxWorkbook(buffer, doc.uri.fsPath, kind, { maxRows });
      doc.workbook = workbook;
    }
    doc.activeSheet = doc.workbook.meta.sheetOrder[0];
    if (isCalculationEnabled()) {
      doc.formulaEngine = new FormulaEngine(doc.workbook.sheets, doc.workbook.meta.sheetOrder);
    }
    doc.analysis = new AnalysisService(() => doc.workbook);
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
        doc.analysis?.invalidate();
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
        const created = createWorksheet(doc.workbook, msg.name);
        // Populate initial data (e.g. a query result) in the SAME
        // synchronous handler execution as sheet creation, rather than
        // relying on the caller to send a separate 'pasteRange' message
        // afterward -- two independent fire-and-forget postMessage calls
        // give no hard guarantee the sheet exists yet by the time the
        // second one is processed, which was a real (if narrow) race.
        if (msg.data) pasteRange(created, 0, 0, msg.data);
        doc.activeSheet = msg.name; // jump to the newly created sheet, matching Excel's own behavior
        this.markDirty(doc);
        this.broadcastSheetOrderChange(doc, post);
        this.resyncSheet(doc, doc.activeSheet, post);
        return;
      }

      case 'renameSheet': {
        renameWorksheet(doc.workbook, msg.oldName, msg.newName);
        if (doc.activeSheet === msg.oldName) doc.activeSheet = msg.newName;
        this.markDirty(doc);
        this.broadcastSheetOrderChange(doc, post);
        return;
      }

      case 'deleteSheet': {
        deleteWorksheet(doc.workbook, msg.name);
        if (doc.activeSheet === msg.name) {
          doc.activeSheet = doc.workbook.meta.sheetOrder[0];
          this.resyncSheet(doc, doc.activeSheet, post);
        }
        this.markDirty(doc);
        this.broadcastSheetOrderChange(doc, post);
        return;
      }

      case 'runSearch': {
        const matches = searchWorkbook(doc.workbook, doc.activeSheet, msg.query, msg.options);
        post({ type: 'searchResults', matches, total: matches.length });
        return;
      }

      case 'runReplace': {
        const before = structuredCloneSheet(getSheet(doc.workbook, doc.activeSheet));
        const { replaced, matches } = replaceInWorkbook(
          doc.workbook,
          doc.activeSheet,
          msg.query,
          msg.replaceWith,
          msg.options,
          msg.mode,
        );
        if (replaced > 0) {
          doc.undoStack.push({
            sheetName: doc.activeSheet,
            before,
            after: structuredCloneSheet(getSheet(doc.workbook, doc.activeSheet)),
            label: 'Replace',
          });
          this.markDirty(doc);
          this.resyncSheet(doc, doc.activeSheet, post);
        }
        post({ type: 'searchResults', matches, total: matches.length });
        post({ type: 'undoRedoState', canUndo: doc.undoStack.canUndo(), canRedo: doc.undoStack.canRedo() });
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

      case 'duplicateRow': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        duplicateRow(sheet, msg.at);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Duplicate row' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'duplicateColumn': {
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        duplicateColumn(sheet, msg.at);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Duplicate column' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }


      case 'tracePrecedents': {
        if (!doc.analysis) doc.analysis = new AnalysisService(() => doc.workbook);
        const tree = doc.analysis.tracePrecedents({ sheetName: msg.sheetName, row: msg.row, col: msg.col });
        post({ type: 'analysisTraceResult', direction: 'precedents', tree, origin: { sheetName: msg.sheetName, row: msg.row, col: msg.col } });
        return;
      }
      case 'traceDependents': {
        if (!doc.analysis) doc.analysis = new AnalysisService(() => doc.workbook);
        const tree = doc.analysis.traceDependents({ sheetName: msg.sheetName, row: msg.row, col: msg.col });
        post({ type: 'analysisTraceResult', direction: 'dependents', tree, origin: { sheetName: msg.sheetName, row: msg.row, col: msg.col } });
        return;
      }
      case 'runLinter': {
        if (!doc.analysis) doc.analysis = new AnalysisService(() => doc.workbook);
        post({ type: 'analysisDiagnostics', diagnostics: doc.analysis.getDiagnostics() });
        return;
      }
      case 'runProfile': {
        if (!doc.analysis) doc.analysis = new AnalysisService(() => doc.workbook);
        post({ type: 'analysisProfile', profile: doc.analysis.getProfile() });
        return;
      }
      case 'explainCell': {
        if (!doc.analysis) doc.analysis = new AnalysisService(() => doc.workbook);
        const addr = { sheetName: msg.sheetName, row: msg.row, col: msg.col };
        const tree = doc.analysis.tracePrecedents(addr);
        const diags = doc.analysis.getDiagnostics().filter(
          (d) => d.sheetName === msg.sheetName && d.row === msg.row && d.col === msg.col,
        );
        post({ type: 'analysisTraceResult', direction: 'precedents', tree, origin: addr });
        if (diags.length) post({ type: 'analysisDiagnostics', diagnostics: diags });
        return;
      }

      case 'requestExport': {
        await vscode.commands.executeCommand('sheetlab.exportWorkbook');
        return;
      }

      case 'promptCreateSheet': {
        const name = await vscode.window.showInputBox({
          prompt: 'New worksheet name',
          value: msg.defaultName ?? `Sheet${doc.workbook.meta.sheetOrder.length + 1}`,
          validateInput: (v) => (!v.trim() ? 'Name is required' : undefined),
        });
        if (!name) return;
        const created = createWorksheet(doc.workbook, name.trim());
        if (msg.data) pasteRange(created, 0, 0, msg.data);
        doc.activeSheet = name.trim();
        this.markDirty(doc);
        this.broadcastSheetOrderChange(doc, post);
        this.resyncSheet(doc, doc.activeSheet, post);
        return;
      }

      case 'promptRenameSheet': {
        const newName = await vscode.window.showInputBox({
          prompt: `Rename worksheet "${msg.oldName}"`,
          value: msg.oldName,
          validateInput: (v) => (!v.trim() ? 'Name is required' : undefined),
        });
        if (!newName || newName.trim() === msg.oldName) return;
        renameWorksheet(doc.workbook, msg.oldName, newName.trim());
        if (doc.activeSheet === msg.oldName) doc.activeSheet = newName.trim();
        this.markDirty(doc);
        this.broadcastSheetOrderChange(doc, post);
        return;
      }

      case 'promptDeleteSheet': {
        if (doc.workbook.meta.sheetOrder.length <= 1) {
          void vscode.window.showWarningMessage('Cannot delete the only worksheet.');
          return;
        }
        const choice = await vscode.window.showWarningMessage(
          `Delete worksheet "${msg.name}"?`,
          { modal: true },
          'Delete',
        );
        if (choice !== 'Delete') return;
        deleteWorksheet(doc.workbook, msg.name);
        if (doc.activeSheet === msg.name) {
          doc.activeSheet = doc.workbook.meta.sheetOrder[0];
          this.resyncSheet(doc, doc.activeSheet, post);
        }
        this.markDirty(doc);
        this.broadcastSheetOrderChange(doc, post);
        return;
      }

      case 'promptDuplicateSheet': {
        const newName = await vscode.window.showInputBox({
          prompt: `Duplicate "${msg.name}" as`,
          value: `${msg.name} Copy`,
          validateInput: (v) => (!v.trim() ? 'Name is required' : undefined),
        });
        if (!newName) return;
        const src = getSheet(doc.workbook, msg.name);
        const created = createWorksheet(doc.workbook, newName.trim());
        // Deep-copy rows and meta
        created.rows = JSON.parse(JSON.stringify(src.rows));
        created.rowMeta = JSON.parse(JSON.stringify(src.rowMeta));
        created.columns = JSON.parse(JSON.stringify(src.columns));
        created.rowCount = src.rowCount;
        created.colCount = src.colCount;
        if (src.tables) created.tables = JSON.parse(JSON.stringify(src.tables));
        if (src.freezePane) created.freezePane = { ...src.freezePane };
        doc.activeSheet = newName.trim();
        this.markDirty(doc);
        this.broadcastSheetOrderChange(doc, post);
        this.resyncSheet(doc, doc.activeSheet, post);
        return;
      }

      case 'promptGoToCell': {
        const ref = await vscode.window.showInputBox({
          prompt: 'Go to cell (e.g. B12 or A1:C10)',
          placeHolder: 'A1',
        });
        if (!ref) return;
        post({ type: 'navigateToRef', ref: ref.trim() });
        return;
      }

      case 'promptCreateTable': {
        const a1 = rangeToA1(msg.range);
        const rows = msg.range.endRow - msg.range.startRow + 1;
        const cols = msg.range.endCol - msg.range.startCol + 1;
        const name = await vscode.window.showInputBox({
          prompt: `Table name for selection ${a1} (${rows} × ${cols})`,
          value: `Table${(getSheet(doc.workbook, msg.sheetName).tables?.length ?? 0) + 1}`,
          validateInput: (v) => (!v.trim() ? 'Name is required' : undefined),
        });
        if (!name) return;
        const totalsPick = await vscode.window.showQuickPick(
          ['No totals row (all rows are data)', 'Last row is a totals row'],
          { placeHolder: `Selection: ${a1}` },
        );
        if (!totalsPick) return;
        const hasTotalsRow = totalsPick.startsWith('Last');
        const sheet = getSheet(doc.workbook, msg.sheetName);
        const before = structuredCloneSheet(sheet);
        createTable(sheet, msg.range, name.trim(), true, hasTotalsRow);
        doc.undoStack.push({ sheetName: msg.sheetName, before, after: structuredCloneSheet(sheet), label: 'Create table' });
        this.markDirty(doc);
        this.resyncSheet(doc, msg.sheetName, post);
        return;
      }

      case 'exportWorkbook': {
        // Routed through the registered export commands so Save dialogs stay consistent.
        const map: Record<string, string> = {
          xlsx: 'sheetlab.exportAsXlsx',
          csv: 'sheetlab.exportAsCsv',
          tsv: 'sheetlab.exportAsTsv',
          ods: 'sheetlab.exportAsOds',
          xls: 'sheetlab.exportAsXls',
          xlsm: 'sheetlab.exportAsXlsm',
        };
        const cmd = map[msg.format] ?? 'sheetlab.exportAsXlsx';
        await vscode.commands.executeCommand(cmd);
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

  /**
   * Notifies the webview after any operation that changes the SET of
   * sheets (create/rename/delete) or which sheet is active as a result.
   * Without this, the webview's own `appState.sheetOrder`/`activeSheet`
   * never learn about the change -- they were only ever set once at
   * 'init' time -- so newly created sheets never appear as tabs, renamed
   * tabs keep showing the old name, and switching which sheet is "active"
   * after a delete silently leaves the grid pointed at a sheet name that
   * no longer exists.
   */
  private broadcastSheetOrderChange(doc: ExcelDocument, post: (m: HostToWebviewMessage) => void): void {
    const sheet = getSheet(doc.workbook, doc.activeSheet);
    post({
      type: 'sheetOrderChanged',
      sheetOrder: doc.workbook.meta.sheetOrder,
      activeSheet: doc.activeSheet,
      activeSheetSummary: {
        rowCount: sheet.rowCount,
        colCount: sheet.colCount,
        columns: sheet.columns,
        rowMeta: sheet.rowMeta,
        tables: sheet.tables ?? [],
        freezePane: sheet.freezePane,
      },
    });
  }

  private markDirty(doc: ExcelDocument): void {
    const key = doc.uri.toString();
    this.documents.set(key, doc);
    this.dirtyDocuments.add(key);
    doc.analysis?.invalidate();
    // Content-change event (we manage undo inside the webview/host, not via VS Code edits).
    this.onDidChangeCustomDocumentEmitter.fire({ document: doc });
  }

  async saveCustomDocument(doc: ExcelDocument): Promise<void> {
    // Re-bind in case VS Code handed us a stale wrapper after extension host restart.
    const key = doc.uri.toString();
    const live = this.documents.get(key) ?? doc;
    this.documents.set(key, live);
    if (!live.workbook) {
      await this.loadWorkbook(live);
    }
    live.conflictWatcher?.notifyOwnWritePending();
    const ok = await saveExcelWorkbook(live.workbook, live.uri);
    if (!ok) {
      // Rejection keeps the tab dirty; message already shown by saveExcelWorkbook.
      return Promise.reject(new Error('SheetLab save was cancelled or failed. The file was not modified.'));
    }
    this.dirtyDocuments.delete(key);
    await live.conflictWatcher?.refreshKnownMtime();
  }

  async saveCustomDocumentAs(doc: ExcelDocument, destination: vscode.Uri): Promise<void> {
    const key = doc.uri.toString();
    const live = this.documents.get(key) ?? doc;
    if (!live.workbook) {
      await this.loadWorkbook(live);
    }
    const ok = await saveExcelWorkbook(live.workbook, destination);
    if (!ok) {
      return Promise.reject(new Error('SheetLab save was cancelled or failed. The file was not modified.'));
    }
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


function rangeToA1(range: { startRow: number; startCol: number; endRow: number; endCol: number }): string {
  const col = (i: number) => {
    let n = i + 1;
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const a = `${col(range.startCol)}${range.startRow + 1}`;
  const b = `${col(range.endCol)}${range.endRow + 1}`;
  return a === b ? a : `${a}:${b}`;
}
