import { postToHost, onHostMessage } from '../app/vscodeApi';
import { appState } from '../state/appState';
import { FilterCondition } from '../../../src/types/workbook';

/**
 * A single-column filter, matching the toolbar's "Filter" affordance. Full
 * per-column Excel-style dropdown menus on every header are a natural
 * follow-up; this ships the functional core: pick a column (defaults to the
 * active cell's column), choose a condition, apply it. Filtering hides rows
 * client-side in the grid rather than deleting data (spec section 20).
 */
export class FilterPopup {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-panel', 'sheetlab-filter-popup');
    this.container.style.display = 'none';
    this.build();
    onHostMessage((msg) => {
      if (msg.type === 'filterResult') {
        appState.visibleRowFilter[msg.sheetName] = new Set(msg.visibleRows);
        appState.notify();
      }
    });
  }

  toggle(): void {
    this.container.style.display === 'none' ? this.open() : this.close();
  }

  open(): void {
    this.container.style.display = 'flex';
  }

  close(): void {
    this.container.style.display = 'none';
  }

  private build(): void {
    const header = document.createElement('div');
    header.className = 'sheetlab-panel-header';
    header.innerHTML = '<span>Filter</span>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'X';
    closeBtn.className = 'sheetlab-panel-close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);
    this.container.appendChild(header);

    const kindSelect = document.createElement('select');
    const kinds: FilterCondition['kind'][] = ['textContains', 'textEquals', 'numberRange', 'blank', 'nonBlank'];
    kinds.forEach((k) => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      kindSelect.appendChild(opt);
    });

    const valueInput = document.createElement('input');
    valueInput.placeholder = 'Value';

    const applyBtn = document.createElement('button');
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
        case 'numberRange':
          condition = { kind: 'numberRange', min: Number(valueInput.value) };
          break;
        case 'textEquals':
          condition = { kind: 'textEquals', value: valueInput.value };
          break;
        default:
          condition = { kind: 'textContains', value: valueInput.value };
      }
      postToHost({ type: 'applyFilter', sheetName: appState.activeSheet, filter: { col, condition } });
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'sheetlab-btn-secondary';
    clearBtn.textContent = 'Clear Filter';
    clearBtn.addEventListener('click', () => {
      appState.visibleRowFilter[appState.activeSheet] = null;
      appState.notify();
      postToHost({ type: 'clearFilter', sheetName: appState.activeSheet });
    });

    this.container.appendChild(kindSelect);
    this.container.appendChild(valueInput);
    this.container.appendChild(applyBtn);
    this.container.appendChild(clearBtn);
  }
}
