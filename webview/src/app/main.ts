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

const root = document.getElementById('sheetlab-root')!;
root.innerHTML = '';
root.classList.add('sheetlab-app');

const toolbarEl = div('sheetlab-toolbar-container');
const barsRow = div('sheetlab-bars-row');
const nameBoxEl = div('sheetlab-name-box-container');
const formulaBarEl = div('sheetlab-formula-bar-container');
const gridEl = div('sheetlab-grid-container');
const tabsEl = div('sheetlab-tabs-container');
const statusBarEl = div('sheetlab-status-bar-container');

const searchPanelEl = div('sheetlab-search-panel-container');
const queryPanelEl = div('sheetlab-query-panel-container');
const cleanPanelEl = div('sheetlab-clean-panel-container');
const filterPopupEl = div('sheetlab-filter-popup-container');

barsRow.appendChild(nameBoxEl);
barsRow.appendChild(formulaBarEl);

root.appendChild(toolbarEl);
root.appendChild(barsRow);
root.appendChild(gridEl);
root.appendChild(tabsEl);
root.appendChild(statusBarEl);
root.appendChild(searchPanelEl);
root.appendChild(queryPanelEl);
root.appendChild(cleanPanelEl);
root.appendChild(filterPopupEl);

const grid = new Grid(gridEl);
const formulaBar = new FormulaBar(formulaBarEl);
const nameBox = new NameBox(nameBoxEl);
const sheetTabs = new SheetTabs(tabsEl);
new StatusBar(statusBarEl); // subscribes itself; no further interaction needed here
const searchPanel = new SearchPanel(searchPanelEl);
const queryPanel = new QueryPanel(queryPanelEl);
const cleanPanel = new DataCleaningPanel(cleanPanelEl);
const filterPopup = new FilterPopup(filterPopupEl);

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
    const formats = ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv'] as const;
    const choice = prompt(
      'Export format (xlsx, xlsm, xls, ods, csv, tsv):',
      'xlsx',
    );
    if (!choice) return;
    const format = choice.trim().toLowerCase();
    if (!(formats as readonly string[]).includes(format)) {
      alert(`Unsupported format "${choice}". Use one of: ${formats.join(', ')}`);
      return;
    }
    postToHost({ type: 'exportWorkbook', format: format as (typeof formats)[number] });
  },
});

nameBox.setOnNavigate((range) => {
  appState.selection = { active: { row: range.startRow, col: range.startCol }, range, editing: false };
  appState.notify();
  grid.scrollToCell(range.startRow, range.startCol);
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
  for (const panel of [searchPanel, queryPanel, cleanPanel, filterPopup]) {
    panel.close();
  }
});

onHostMessage((msg) => {
  switch (msg.type) {
    case 'init': {
      appState.initFromHost(msg.workbook, msg.settings);
      sheetTabs.render();
      grid.reset();
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
      appState.visibleRowFilter[msg.sheetName] = new Set(msg.visibleRows);
      appState.notify();
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
      const ref = prompt('Go to cell (e.g. B12 or A1:C10):');
      if (ref) {
        const parsed = parseA1OrRange(ref);
        if (parsed) {
          appState.selection = { active: { row: parsed.startRow, col: parsed.startCol }, range: parsed, editing: false };
          appState.notify();
          grid.scrollToCell(parsed.startRow, parsed.startCol);
        }
      }
      break;
    }
    case 'openNewWorksheetPrompt': {
      const name = prompt('New worksheet name:');
      if (name) postToHost({ type: 'createSheet', name });
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
    case 'openExport': {
      const formats = ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv'];
      const choice = prompt('Export format (xlsx, xlsm, xls, ods, csv, tsv):', 'xlsx');
      if (choice && formats.includes(choice.trim().toLowerCase())) {
        postToHost({ type: 'exportWorkbook', format: choice.trim().toLowerCase() as any });
      }
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
