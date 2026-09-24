import { appState } from '../state/appState';
import { postToHost } from '../app/vscodeApi';
import { CellFormat } from '../../../src/types/workbook';
import { createIcon, hasIcon } from './icons';

export interface ToolbarCallbacks {
  onOpenSearch: () => void;
  onOpenQuery: () => void;
  onOpenCleanData: () => void;
  onSort: (direction: 'asc' | 'desc') => void;
  onToggleFilter: () => void;
  onFreezePanes: () => void;
  onUnfreezePanes?: () => void;
  onExport?: () => void;
  onSetViewMode?: (mode: 'spreadsheet' | 'text' | 'split') => void;
  onTracePrecedents?: () => void;
  onTraceDependents?: () => void;
  onRunLinter?: () => void;
  onAnalyzeWorkbook?: () => void;
  onExplainCell?: () => void;
  onOpenAnalysis?: () => void;
  /** Called after any format/action is applied, so the caller can scroll the affected cell into view -- important since the active cell is very often scrolled off-screen when a toolbar button is clicked. */
  onActionApplied?: () => void;
}

export class Toolbar {
  private container: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private dirtyIndicator!: HTMLSpanElement;

  constructor(container: HTMLElement, private callbacks: ToolbarCallbacks) {
    this.container = container;
    this.build();
    appState.subscribe(() => this.syncButtonStates());
  }

  private build(): void {
    this.container.innerHTML = '';
    this.container.classList.add('sheetlab-toolbar');
    this.container.setAttribute('role', 'toolbar');

    const saveBtn = this.button('Save', 'save', () => postToHost({ type: 'save' }));
    this.undoBtn = this.button('Undo', 'undo', () => postToHost({ type: 'undo' }));
    this.redoBtn = this.button('Redo', 'redo', () => postToHost({ type: 'redo' }));
    const searchBtn = this.button('Search', 'search', () => this.callbacks.onOpenSearch());
    const sortAscBtn = this.button('Sort A→Z', 'sort-asc', () => this.callbacks.onSort('asc'));
    const sortDescBtn = this.button('Sort Z→A', 'sort-desc', () => this.callbacks.onSort('desc'));
    const filterBtn = this.button('Filter', 'filter', () => this.callbacks.onToggleFilter());
    const queryBtn = this.button('Query', 'query', () => this.callbacks.onOpenQuery());
    const cleanBtn = this.button('Clean Data', 'clean', () => this.callbacks.onOpenCleanData());
    const freezeBtn = this.button('Freeze Panes', 'freeze', () => this.callbacks.onFreezePanes());
    const unfreezeBtn = this.button('Unfreeze Panes', 'freeze', () => this.callbacks.onUnfreezePanes?.());
    const exportBtn = this.button('Export', 'save', () => this.callbacks.onExport?.());
    const boldBtn = this.button('B', 'bold', () => this.toggleFormat('bold'));
    const italicBtn = this.button('I', 'italic', () => this.toggleFormat('italic'));
    const underlineBtn = this.button('U', 'underline', () => this.toggleFormat('underline'));
    const fontColorInput = this.colorInput('Font color', (hex) => this.applyFormat({ fontColor: hex }));
    const bgColorInput = this.colorInput('Fill color', (hex) => this.applyFormat({ backgroundColor: hex }));
    const numberFormatSelect = this.numberFormatSelect();
    const customFormatGroup = this.customFormatInput();
    const addBorderBtn = this.button('Border', 'border-all', () => this.setBorder(true));
    const removeBorderBtn = this.button('No Border', 'border-none', () => this.setBorder(false));

    this.dirtyIndicator = document.createElement('span');
    this.dirtyIndicator.className = 'sheetlab-dirty-indicator';
    this.dirtyIndicator.title = 'Unsaved changes';

    const group = (...els: HTMLElement[]) => {
      const g = document.createElement('div');
      g.className = 'sheetlab-toolbar-group';
      els.forEach((el) => g.appendChild(el));
      return g;
    };

    this.container.appendChild(group(saveBtn, exportBtn, this.dirtyIndicator));
    this.container.appendChild(group(this.undoBtn, this.redoBtn));
    this.container.appendChild(group(searchBtn));
    this.container.appendChild(group(sortAscBtn, sortDescBtn, filterBtn));
    this.container.appendChild(group(queryBtn, cleanBtn));
    this.container.appendChild(group(boldBtn, italicBtn, underlineBtn, fontColorInput, bgColorInput));
    this.container.appendChild(group(addBorderBtn, removeBorderBtn));
    this.container.appendChild(group(numberFormatSelect, customFormatGroup));
    this.container.appendChild(group(freezeBtn, unfreezeBtn));

    // Tools side panel (analysis, pipelines, queries, quality, git)
    const toolsGroup = group(
      this.button('Tools', 'query', () => this.callbacks.onOpenAnalysis?.()),
    );
    toolsGroup.dataset.role = 'analysis';
    this.container.appendChild(toolsGroup);

    // CSV/TSV view mode toggles (hidden for Excel)
    const viewGroup = this.viewModeGroup();
    viewGroup.dataset.role = 'view-mode';
    this.container.appendChild(viewGroup);

    this.syncButtonStates();
  }

  private viewModeGroup(): HTMLElement {
    const g = document.createElement('div');
    g.className = 'sheetlab-toolbar-group sheetlab-view-mode-group';
    // Two distinct options only (not a 3-way control).
    const modes: Array<['spreadsheet' | 'split', string, string]> = [
      ['spreadsheet', 'Spreadsheet', 'Spreadsheet view (grid only)'],
      ['split', 'Preview', 'Side-by-side text + grid preview'],
    ];
    for (const [mode, label, title] of modes) {
      const btn = document.createElement('button');
      btn.className = 'sheetlab-toolbar-btn sheetlab-view-mode-btn';
      btn.textContent = label;
      btn.title = title;
      btn.dataset.mode = mode;
      btn.addEventListener('click', () => this.callbacks.onSetViewMode?.(mode));
      g.appendChild(btn);
    }
    return g;
  }

  private button(label: string, iconClass: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `sheetlab-toolbar-btn sheetlab-icon-${iconClass}`;
    btn.title = label;
    if (hasIcon(iconClass)) {
      btn.appendChild(createIcon(iconClass));
      const text = document.createElement('span');
      text.textContent = label;
      text.className = 'sheetlab-btn-label';
      btn.appendChild(text);
    } else {
      btn.textContent = label; // e.g. B/I/U -- text label is the icon convention here
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  private syncButtonStates(): void {
    this.undoBtn.disabled = !appState.canUndo;
    this.redoBtn.disabled = !appState.canRedo;
    this.dirtyIndicator.style.visibility = appState.dirty ? 'visible' : 'hidden';

    const isCsv = appState.meta?.sourceKind === 'csv' || appState.meta?.sourceKind === 'tsv';
    const viewGroup = this.container.querySelector('[data-role="view-mode"]') as HTMLElement | null;
    if (viewGroup) {
      viewGroup.style.display = isCsv ? 'inline-flex' : 'none';
      viewGroup.querySelectorAll('.sheetlab-view-mode-btn').forEach((el) => {
        const btn = el as HTMLButtonElement;
        const isActive =
          (btn.dataset.mode === 'spreadsheet' && appState.viewMode === 'spreadsheet') ||
          (btn.dataset.mode === 'split' && appState.viewMode === 'split');
        btn.classList.toggle('sheetlab-view-mode-active', isActive);
      });
    }
  }

  private toggleFormat(key: 'bold' | 'italic' | 'underline'): void {
    const { row, col } = appState.selection.active;
    const current = appState.getCell(appState.activeSheet, row, col).format?.[key];
    this.applyFormat({ [key]: !current });
  }

  private applyFormat(format: Partial<CellFormat>): void {
    postToHost({ type: 'formatCells', sheetName: appState.activeSheet, range: appState.selection.range, format });
    // The active cell is very often scrolled off-screen when a toolbar
    // button is clicked (e.g. after scrolling far right/down to find a
    // cell to format) -- without this, the format silently applies to a
    // cell the user can't currently see, which looks exactly like "the
    // button doesn't do anything."
    this.callbacks.onActionApplied?.();
  }

  private colorInput(title: string, onChange: (hex: string) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'color';
    input.title = title;
    input.className = 'sheetlab-toolbar-color-input';
    let lastApplied: string | null = null;
    const apply = () => {
      if (input.value === lastApplied) return; // color inputs can fire input+change for the same value; avoid double-posting
      lastApplied = input.value;
      onChange(input.value);
    };
    // Both events are listened for because native color-picker widgets
    // vary in which one fires reliably across platforms; `apply()`
    // de-duplicates so this never double-applies.
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    return input;
  }

  private numberFormatSelect(): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'sheetlab-toolbar-format-select';
    select.title = 'Number format';
    const options: Array<[string, string]> = [
      ['', 'General'],
      ['0', 'Number (0)'],
      ['0.00', 'Number (0.00)'],
      ['#,##0', 'Number, thousands (#,##0)'],
      ['#,##0.00', 'Number, thousands (#,##0.00)'],
      ['0%', 'Percentage (0%)'],
      ['0.00%', 'Percentage (0.00%)'],
      ['$#,##0.00', 'Currency ($#,##0.00)'],
      ['yyyy-mm-dd', 'Date (yyyy-mm-dd)'],
    ];
    options.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      this.applyFormat({ numberFormat: select.value || undefined });
    });
    return select;
  }

  private setBorder(on: boolean): void {
    this.applyFormat({ border: { top: on, right: on, bottom: on, left: on } });
  }

  /** Free-text number format code input, for formats beyond the preset dropdown (spec section 22). */
  private customFormatInput(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sheetlab-toolbar-custom-format';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Custom format code';
    input.title = 'Custom number format code (e.g. 0.000, #,##0;(#,##0))';
    input.className = 'sheetlab-toolbar-custom-format-input';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.className = 'sheetlab-btn-secondary';
    applyBtn.addEventListener('click', () => {
      if (input.value.trim() === '') return;
      this.applyFormat({ numberFormat: input.value.trim() });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyBtn.click();
      }
    });

    wrap.appendChild(input);
    wrap.appendChild(applyBtn);
    return wrap;
  }
}
