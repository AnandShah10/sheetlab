import { appState } from '../state/appState';
import { postToHost } from '../app/vscodeApi';
import { Cell } from '../../../src/types/workbook';

export class FormulaBar {
  private container: HTMLElement;
  private input!: HTMLInputElement;
  private onCommit: ((raw: string) => void) | undefined;

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
    appState.subscribe(() => this.syncFromSelection());
  }

  setOnCommit(fn: (raw: string) => void): void {
    this.onCommit = fn;
  }

  private build(): void {
    this.container.innerHTML = '';
    this.container.classList.add('sheetlab-formula-bar');

    const fx = document.createElement('span');
    fx.className = 'sheetlab-fx-icon';
    fx.textContent = 'fx';

    this.input = document.createElement('input');
    this.input.className = 'sheetlab-formula-input';
    this.input.setAttribute('aria-label', 'Formula bar');
    this.input.spellcheck = false;

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.syncFromSelection();
        this.input.blur();
      }
    });
    this.input.addEventListener('blur', () => this.commit());

    this.container.appendChild(fx);
    this.container.appendChild(this.input);
  }

  private commit(): void {
    const raw = this.input.value;
    const { row, col } = appState.selection.active;
    postToHost({ type: 'editCell', sheetName: appState.activeSheet, row, col, raw });
    appState.setCellLocally(appState.activeSheet, row, col, inferLocalCell(raw));
    this.onCommit?.(raw);
  }

  setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'flex' : 'none';
  }

  private syncFromSelection(): void {
    if (document.activeElement === this.input) return; // don't clobber active typing
    const { row, col } = appState.selection.active;
    const cell = appState.getCell(appState.activeSheet, row, col);
    this.input.value = cell.raw ?? '';
  }
}

function inferLocalCell(raw: string): Cell {
  if (raw === '') return { raw: null, value: null, type: 'blank' };
  if (raw.startsWith('=')) return { raw, value: null, type: 'formula', formula: raw.slice(1) };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { raw, value: Number(raw), type: 'number' };
  if (/^(true|false)$/i.test(raw)) return { raw, value: raw.toLowerCase() === 'true', type: 'boolean' };
  return { raw, value: raw, type: 'string' };
}
