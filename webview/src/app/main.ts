import { appState } from '../state/appState';
import { postToHost, onHostMessage } from './vscodeApi';
import { Grid } from '../grid/grid';
import { FormulaBar } from '../formulaBar/formulaBar';
import { NameBox } from '../nameBox/nameBox';
import { SheetTabs } from '../sheetTabs/sheetTabs';
import { Toolbar } from '../toolbar/toolbar';
import { StatusBar } from '../toolbar/statusBar';
import { SearchPanel } from '../search/searchPanel';
import { QueryPanel } from '../query/queryPanel';
import { DataCleaningPanel } from '../dataCleaning/dataCleaningPanel';
import { FilterPopup } from '../contextMenu/filterPopup';
import { parseA1OrRange } from './cellRef';
import { TextPreview } from '../textPreview/textPreview';
import { AnalysisPanel } from '../analysis/analysisPanel';
import { ChartsModal } from '../analysis/chartsModal';
import { PivotModal } from '../analysis/pivotModal';

document.body.style.margin = '0';
document.body.style.height = '100vh';
const root = document.getElementById('sheetlab-root')!;
root.innerHTML = '';
root.classList.add('sheetlab-app');

const toolbarEl = div('sheetlab-toolbar-container');
const barsRow = div('sheetlab-bars-row');
const nameBoxEl = div('sheetlab-name-box-container');
const formulaBarEl = div('sheetlab-formula-bar-container');
const gridEl = div('sheetlab-grid-container');
const textPreviewEl = div('sheetlab-text-preview-container');
const mainSplitEl = div('sheetlab-main-split');
const tabsEl = div('sheetlab-tabs-container');
const statusBarEl = div('sheetlab-status-bar-container');

const searchPanelEl = div('sheetlab-search-panel-container');
const queryPanelEl = div('sheetlab-query-panel-container');
const cleanPanelEl = div('sheetlab-clean-panel-container');
const filterPopupEl = div('sheetlab-filter-popup-container');
const analysisPanelEl = div('sheetlab-analysis-panel-container');

barsRow.appendChild(nameBoxEl);
barsRow.appendChild(formulaBarEl);

mainSplitEl.appendChild(textPreviewEl);
mainSplitEl.appendChild(gridEl);

const workRow = div('sheetlab-work-row');
workRow.appendChild(mainSplitEl);
workRow.appendChild(analysisPanelEl);

root.appendChild(toolbarEl);
root.appendChild(barsRow);
root.appendChild(workRow);
root.appendChild(tabsEl);
root.appendChild(statusBarEl);
root.appendChild(searchPanelEl);
root.appendChild(queryPanelEl);
root.appendChild(cleanPanelEl);
root.appendChild(filterPopupEl);

const diffBanner = div('sheetlab-diff-banner');
diffBanner.style.display = 'none';
// Sit above the grid/work area so highlights are obvious
root.insertBefore(diffBanner, workRow);

const grid = new Grid(gridEl);
const textPreview = new TextPreview(textPreviewEl);
const formulaBar = new FormulaBar(formulaBarEl);
const nameBox = new NameBox(nameBoxEl);
const sheetTabs = new SheetTabs(tabsEl);
new StatusBar(statusBarEl); // subscribes itself; no further interaction needed here
const searchPanel = new SearchPanel(searchPanelEl);
const queryPanel = new QueryPanel(queryPanelEl);
const cleanPanel = new DataCleaningPanel(cleanPanelEl);
const filterPopup = new FilterPopup(filterPopupEl);
const analysisPanel = new AnalysisPanel(analysisPanelEl);
const chartsModal = new ChartsModal(root);
const pivotModal = new PivotModal(root);

function updateDiffBanner(): void {
  const keys = Object.keys(appState.diffHighlights);
  if (!keys.length) {
    diffBanner.style.display = 'none';
    return;
  }
  diffBanner.style.display = 'flex';
  let added = 0, removed = 0, changed = 0;
  for (const k of keys) {
    const kind = appState.diffHighlights[k]?.kind ?? 'value';
    if (kind === 'added') added++;
    else if (kind === 'removed') removed++;
    else changed++;
  }
  const n = keys.length;
  diffBanner.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'sheetlab-diff-banner-label';
  label.textContent = `${n} change${n === 1 ? '' : 's'} vs HEAD`;
  diffBanner.appendChild(label);
  const legend = document.createElement('span');
  legend.className = 'sheetlab-diff-banner-legend';
  legend.textContent = `+${added}  −${removed}  ~${changed}`;
  diffBanner.appendChild(legend);
  const onlyBtn = document.createElement('button');
  onlyBtn.type = 'button';
  onlyBtn.className = 'sheetlab-tools-chip';
  onlyBtn.textContent = appState.diffShowOnlyChanged ? 'Show all rows' : 'Show only changes';
  onlyBtn.addEventListener('click', () => {
    appState.diffShowOnlyChanged = !appState.diffShowOnlyChanged;
    if (appState.diffShowOnlyChanged) {
      const rows = new Set<number>([0]);
      for (const key of Object.keys(appState.diffHighlights)) {
        const parts = key.split('!');
        if (parts[0] === appState.activeSheet) rows.add(Number(parts[1]));
      }
      appState.visibleRowFilter[appState.activeSheet] = rows;
    } else {
      appState.visibleRowFilter[appState.activeSheet] = null;
    }
    appState.notify();
    grid.reset();
    updateDiffBanner();
  });
  diffBanner.appendChild(onlyBtn);
  const toolsBtn = document.createElement('button');
  toolsBtn.type = 'button';
  toolsBtn.className = 'sheetlab-tools-chip';
  toolsBtn.textContent = 'Open Changes list';
  toolsBtn.addEventListener('click', () => analysisPanel.open());
  diffBanner.appendChild(toolsBtn);
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'sheetlab-tools-chip';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    appState.diffHighlights = {};
    appState.diffShowOnlyChanged = false;
    appState.visibleRowFilter[appState.activeSheet] = null;
    appState.notify();
    grid.reset();
    updateDiffBanner();
  });
  diffBanner.appendChild(clearBtn);
}
appState.subscribe(() => updateDiffBanner());


new Toolbar(toolbarEl, {
  onOpenSearch: () => searchPanel.toggle(),
  onOpenQuery: () => queryPanel.toggle(),
  onOpenCleanData: () => cleanPanel.toggle(),
  onToggleFilter: () => filterPopup.toggle(),
  onActionApplied: () => {
    const { row, col } = appState.selection.active;
    grid.scrollToCell(row, col);
  },
  onSort: (direction) => {
    const range = fullColumnRangeFromSelection();
    postToHost({
      type: 'sortRange',
      sheetName: appState.activeSheet,
      range,
      keys: [{ col: appState.selection.active.col, direction }],
      hasHeaderRow: true,
    });
  },
  onFreezePanes: () => {
    postToHost({
      type: 'setFreezePane',
      sheetName: appState.activeSheet,
      pane: { row: appState.selection.active.row, col: appState.selection.active.col },
    });
  },
  onUnfreezePanes: () => {
    postToHost({
      type: 'setFreezePane',
      sheetName: appState.activeSheet,
      pane: { row: 0, col: 0 },
    });
  },
  onExport: () => {
    // Host shows VS Code QuickPick — webview prompt() is blocked by sandbox.
    postToHost({ type: 'requestExport' });
  },
  onSetViewMode: (mode) => {
    appState.viewMode = mode;
    root.dataset.viewMode = mode;
    appState.notify();
    postToHost({ type: 'setViewMode', mode });
    // Grid needs a layout pass when leaving text-only mode
    requestAnimationFrame(() => grid.reset());
  },
  onTracePrecedents: () => analysisPanel.requestPrecedents(),
  onTraceDependents: () => analysisPanel.requestDependents(),
  onRunLinter: () => analysisPanel.requestLinter(),
  onAnalyzeWorkbook: () => analysisPanel.requestProfile(),
  onExplainCell: () => analysisPanel.requestExplain(),
  onOpenAnalysis: () => analysisPanel.toggle(),
  onOpenCharts: () => chartsModal.open(),
  onOpenPivot: () => pivotModal.open(),
  onDiffVsHead: () => {
    analysisPanel.open();
    // Semantic highlights on grid + list (working tree vs HEAD)
    postToHost({ type: 'runHostCommand', command: 'sheetlab.highlightGitChanges' });
  },
});

nameBox.setOnNavigate((range) => {
  appState.selection = { active: { row: range.startRow, col: range.startCol }, range, editing: false };
  appState.notify();
  grid.scrollToCell(range.startRow, range.startCol);
});

analysisPanel.setOnNavigate((sheetName, row, col) => {
  if (sheetName !== appState.activeSheet) {
    postToHost({ type: 'switchSheet', sheetName });
    appState.activeSheet = sheetName;
  }
  appState.selection = { active: { row, col }, range: { startRow: row, startCol: col, endRow: row, endCol: col }, editing: false };
  appState.notify();
  grid.scrollToCell(row, col);
});

searchPanel.setOnNavigate((sheetName, row, col) => {
  if (sheetName !== appState.activeSheet) {
    postToHost({ type: 'switchSheet', sheetName });
    appState.activeSheet = sheetName;
  }
  appState.selection = { active: { row, col }, range: { startRow: row, startCol: col, endRow: row, endCol: col }, editing: false };
  appState.notify();
  grid.scrollToCell(row, col);
});

grid.setSelectionHandlers(
  () => {
    /* selection changes flow through appState already; nothing extra needed here */
  },
  () => {
    /* range changes flow through appState already */
  },
);

sheetTabs.setOnSwitch(() => grid.reset());

// Escape closes any open floating panel (search/query/clean-data/filter) --
// previously the only way to close one was the small "X" button.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const panel of [searchPanel, queryPanel, cleanPanel, filterPopup, analysisPanel]) {
    panel.close();
  }
});

onHostMessage((msg) => {
  switch (msg.type) {
    case 'applyPipeline': {
      // Host posted pipeline apply — forward to host handler (editor has undo stack)
      postToHost(msg);
      break;
    }
    case 'forceNavigate': {
      if (msg.sheetName !== appState.activeSheet) {
        postToHost({ type: 'switchSheet', sheetName: msg.sheetName });
        appState.activeSheet = msg.sheetName;
      }
      appState.selection = {
        active: { row: msg.row, col: msg.col },
        range: { startRow: msg.row, startCol: msg.col, endRow: msg.row, endCol: msg.col },
        editing: false,
      };
      appState.notify();
      grid.scrollToCell(msg.row, msg.col);
      break;
    }
    case 'conditionalFormatsUpdated': {
      appState.setConditionalFormats(msg.sheetName, msg.rules as any);
      grid.reset();
      break;
    }
    case 'analysisAdvancedResult': {
      chartsModal.showResult(msg.result);
      break;
    }
    case 'diffHighlights': {
      if (msg.clear) {
        appState.diffHighlights = {};
        appState.diffShowOnlyChanged = false;
      } else {
        const map: typeof appState.diffHighlights = {};
        for (const e of msg.entries ?? []) {
          map[`${e.sheet}!${e.row}!${e.col}`] = {
            kind: e.kind,
            before: e.before,
            after: e.after,
            a1: e.a1,
          };
        }
        appState.diffHighlights = map;
        if ((msg.entries ?? []).length) {
          analysisPanel.open();
        }
      }
      appState.notify();
      grid.reset();
      updateDiffBanner();
      break;
    }
    case 'gitFileStatus': {
      appState.gitUnstaged = msg.unstaged;
      appState.gitStaged = msg.staged;
      appState.notify();
      break;
    }
    case 'forceViewMode': {
      const mode = msg.mode === 'text' ? 'split' : msg.mode;
      appState.viewMode = mode;
      root.dataset.viewMode = mode;
      appState.notify();
      const layout = () => {
        root.dataset.viewMode = mode;
        grid.reset();
        window.dispatchEvent(new Event('resize'));
      };
      requestAnimationFrame(layout);
      setTimeout(layout, 50);
      setTimeout(layout, 150);
      break;
    }
    case 'textContent': {
      textPreview.setTextFromHost(msg.text);
      break;
    }
    case 'navigateToRef': {
      const range = parseA1OrRange(msg.ref);
      if (range) {
        appState.selection = {
          active: { row: range.startRow, col: range.startCol },
          range,
          editing: false,
        };
        appState.notify();
        grid.scrollToCell(range.startRow, range.startCol);
      }
      break;
    }
    case 'init': {
      appState.initFromHost(msg.workbook, msg.settings, msg.preferredViewMode);
      if (msg.textContent != null) {
        textPreview.setTextFromHost(msg.textContent);
      }
      root.dataset.viewMode = appState.viewMode;
      appState.notify();
      sheetTabs.render();
      grid.reset();
      // Re-apply preferred mode after layout so Preview (split) is never stuck on spreadsheet
      const preferred = msg.preferredViewMode ?? appState.viewMode;
      if (preferred && preferred !== 'spreadsheet') {
        const apply = () => {
          appState.viewMode = preferred;
          root.dataset.viewMode = preferred;
          appState.notify();
          grid.reset();
          window.dispatchEvent(new Event('resize'));
        };
        requestAnimationFrame(apply);
        setTimeout(apply, 50);
        setTimeout(apply, 200);
      }
      break;
    }
    case 'sheetData': {
      appState.mergeSheetRows(msg.sheetName, msg.rows, msg.rowRangeStart, msg.rowRangeEnd);
      break;
    }
    case 'applyEdit': {
      appState.setCellLocally(msg.edit.sheetName, msg.edit.row, msg.edit.col, msg.edit.cell);
      break;
    }
    case 'undoRedoState': {
      appState.canUndo = msg.canUndo;
      appState.canRedo = msg.canRedo;
      appState.notify();
      break;
    }
    case 'saved': {
      appState.dirty = false;
      appState.notify();
      break;
    }
    case 'dirtyChanged': {
      appState.dirty = msg.dirty;
      appState.notify();
      break;
    }
    case 'externalChange': {
      showToast(msg.message);
      // Reload the currently visible chunk from the (now authoritative) host state.
      postToHost({ type: 'requestSheetRows', sheetName: appState.activeSheet, startRow: 0, endRow: appState.settings.chunkSize });
      break;
    }
    case 'filterResult': {
      // col < 0 is "clear filter" from host
      appState.visibleRowFilter[msg.sheetName] =
        msg.col < 0 ? null : new Set(msg.visibleRows);
      appState.notify();
      // Force grid row-offset rebuild for collapsed filtered rows
      grid.reset();
      break;
    }
    case 'sheetMeta': {
      appState.updateSheetMeta(msg.sheetName, {
        columns: msg.columns,
        rowMeta: msg.rowMeta,
        tables: msg.tables,
        freezePane: msg.freezePane,
      });
      break;
    }
    case 'sheetOrderChanged': {
      appState.applySheetOrderChange(msg.sheetOrder, msg.activeSheet, msg.activeSheetSummary);
      grid.reset();
      break;
    }
    case 'uiCommand': {
      handleUiCommand(msg.command);
      break;
    }
    case 'error': {
      showToast(msg.message, true);
      break;
    }
    default:
      break; // searchResults/queryResult/queryError are handled directly by their panels
  }
  appState.dirty = appState.dirty || msg.type === 'applyEdit';
});

function handleUiCommand(command: string): void {
  switch (command) {
    case 'openSearch': searchPanel.open(); break;
    case 'openQuery': queryPanel.open(); break;
    case 'openCleanData': cleanPanel.open(); break;
    case 'openGoToCell': {
      postToHost({ type: 'promptGoToCell' });
      break;
    }
    case 'openNewWorksheetPrompt': {
      postToHost({
        type: 'promptCreateSheet',
        defaultName: `Sheet${appState.sheetOrder.length + 1}`,
      });
      break;
    }
    case 'toggleFormulaBar':
      appState.showFormulaBar = !appState.showFormulaBar;
      formulaBar.setVisible(appState.showFormulaBar);
      break;
    case 'toggleGridlines':
      appState.showGridlines = !appState.showGridlines;
      appState.notify();
      break;
    case 'unfreezePanes':
      postToHost({
        type: 'setFreezePane',
        sheetName: appState.activeSheet,
        pane: { row: 0, col: 0 },
      });
      break;
    case 'openTools': analysisPanel.open(); break;
    case 'tracePrecedents': analysisPanel.requestPrecedents(); break;
    case 'traceDependents': analysisPanel.requestDependents(); break;
    case 'runLinter': analysisPanel.requestLinter(); break;
    case 'runProfile': analysisPanel.requestProfile(); break;
    case 'explainCell': analysisPanel.requestExplain(); break;
    case 'openExport': {
      postToHost({ type: 'requestExport' });
      break;
    }
    case 'freezePanesAtSelection':
      postToHost({
        type: 'setFreezePane',
        sheetName: appState.activeSheet,
        pane: { row: appState.selection.active.row, col: appState.selection.active.col },
      });
      break;
    default:
      break;
  }
}

function fullColumnRangeFromSelection() {
  const r = appState.selection.range;
  const isSingleCell = r.startRow === r.endRow && r.startCol === r.endCol;
  if (!isSingleCell) return r;
  return { startRow: 0, startCol: r.startCol, endRow: appState.currentRowCount() - 1, endCol: r.startCol };
}

function showToast(message: string, isError = false): void {
  const toast = document.createElement('div');
  toast.className = isError ? 'sheetlab-toast sheetlab-toast-error' : 'sheetlab-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

postToHost({ type: 'ready' });
