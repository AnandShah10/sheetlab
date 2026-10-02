import { postToHost, onHostMessage } from '../app/vscodeApi';
import { appState } from '../state/appState';
import { FilterCondition } from '../../../src/types/workbook';
import { colIndexToLetter } from '../app/cellRef';

/**
 * Single-column filter popup. Applies a condition on the active column;
 * host evaluates and returns visible row indices. Header row stays visible.
 */
export class FilterPopup {
  private container: HTMLElement;
  private colLabel!: HTMLElement;
  private status!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-panel', 'sheetlab-filter-popup');
    this.container.style.display = 'none';
    this.build();
    onHostMessage((msg) => {
      if (msg.type === 'filterResult') {
        if (msg.col < 0) {
          appState.visibleRowFilter[msg.sheetName] = null;
          appState.notify();
          this.status.textContent = 'Filter cleared';
          return;
        }
        appState.visibleRowFilter[msg.sheetName] = new Set(msg.visibleRows);
        appState.notify();
        const total = appState.currentRowCount();
        const visible = msg.visibleRows.length;
        this.status.textContent = `Showing ${visible} of ${total} rows (col ${colIndexToLetter(msg.col)})`;
      }
    });
    appState.subscribe(() => {
      if (this.container.style.display !== 'none') this.refreshColLabel();
    });
  }

  toggle(): void {
    this.container.style.display === 'none' ? this.open() : this.close();
  }

  open(): void {
    this.refreshColLabel();
    this.container.style.display = 'flex';
  }

  close(): void {
    this.container.style.display = 'none';
  }

  private refreshColLabel(): void {
    const col = appState.selection.active.col;
    this.colLabel.textContent = `Column ${colIndexToLetter(col)} (active cell)`;
  }

  private build(): void {
    const header = document.createElement('div');
    header.className = 'sheetlab-panel-header';
    const title = document.createElement('span');
    title.textContent = 'Filter';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.className = 'sheetlab-panel-close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);
    this.container.appendChild(header);

    this.colLabel = document.createElement('div');
    this.colLabel.className = 'sheetlab-filter-col-label';
    this.container.appendChild(this.colLabel);

    const kindSelect = document.createElement('select');
    kindSelect.className = 'sheetlab-filter-kind';
    const kinds: Array<{ value: FilterCondition['kind']; label: string }> = [
      { value: 'textContains', label: 'Contains text' },
      { value: 'textEquals', label: 'Equals text' },
      { value: 'numberRange', label: 'Number ≥ (min)' },
      { value: 'blank', label: 'Is blank' },
      { value: 'nonBlank', label: 'Is not blank' },
    ];
    for (const k of kinds) {
      const opt = document.createElement('option');
      opt.value = k.value;
      opt.textContent = k.label;
      kindSelect.appendChild(opt);
    }

    const valueInput = document.createElement('input');
    valueInput.className = 'sheetlab-filter-value';
    valueInput.placeholder = 'Value…';
    valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyBtn.click();
    });

    kindSelect.addEventListener('change', () => {
      const needsValue = kindSelect.value !== 'blank' && kindSelect.value !== 'nonBlank';
      valueInput.style.display = needsValue ? '' : 'none';
      if (needsValue) valueInput.focus();
    });

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'sheetlab-btn-primary';
    applyBtn.textContent = 'Apply Filter';
    applyBtn.addEventListener('click', () => {
      const col = appState.selection.active.col;
      let condition: FilterCondition;
      switch (kindSelect.value as FilterCondition['kind']) {
        case 'blank':
          condition = { kind: 'blank' };
          break;
        case 'nonBlank':
          condition = { kind: 'nonBlank' };
          break;
        case 'numberRange': {
          const n = Number(valueInput.value);
          if (!Number.isFinite(n)) {
            this.status.textContent = 'Enter a valid number for the minimum';
            return;
          }
          condition = { kind: 'numberRange', min: n };
          break;
        }
        case 'textEquals':
          if (!valueInput.value) {
            this.status.textContent = 'Enter a value to match';
            return;
          }
          condition = { kind: 'textEquals', value: valueInput.value };
          break;
        default:
          if (!valueInput.value) {
            this.status.textContent = 'Enter text to search for';
            return;
          }
          condition = { kind: 'textContains', value: valueInput.value };
      }
      this.status.textContent = 'Applying…';
      postToHost({ type: 'applyFilter', sheetName: appState.activeSheet, filter: { col, condition } });
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'sheetlab-btn-secondary';
    clearBtn.textContent = 'Clear Filter';
    clearBtn.addEventListener('click', () => {
      appState.visibleRowFilter[appState.activeSheet] = null;
      appState.notify();
      this.status.textContent = 'Filter cleared';
      postToHost({ type: 'clearFilter', sheetName: appState.activeSheet });
    });

    this.status = document.createElement('div');
    this.status.className = 'sheetlab-filter-status';
    this.status.textContent = 'Select a cell in the column to filter, then Apply.';

    this.container.appendChild(kindSelect);
    this.container.appendChild(valueInput);
    this.container.appendChild(applyBtn);
    this.container.appendChild(clearBtn);
    this.container.appendChild(this.status);
  }
}
