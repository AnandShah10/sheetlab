import { appState } from '../state/appState';
import { toA1, parseA1OrRange } from '../app/cellRef';

export class NameBox {
  private container: HTMLElement;
  private input!: HTMLInputElement;
  private onNavigate: ((range: { startRow: number; startCol: number; endRow: number; endCol: number }) => void) | undefined;

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
    appState.subscribe(() => this.syncFromSelection());
  }

  setOnNavigate(fn: (range: { startRow: number; startCol: number; endRow: number; endCol: number }) => void): void {
    this.onNavigate = fn;
  }

  private build(): void {
    this.container.innerHTML = '';
    this.container.classList.add('sheetlab-name-box');
    this.input = document.createElement('input');
    this.input.className = 'sheetlab-name-box-input';
    this.input.setAttribute('aria-label', 'Name box');
    this.input.spellcheck = false;

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const parsed = parseA1OrRange(this.input.value);
        if (parsed) {
          this.onNavigate?.(parsed);
        } else {
          this.input.classList.add('sheetlab-name-box-invalid');
          setTimeout(() => this.input.classList.remove('sheetlab-name-box-invalid'), 400);
        }
        this.input.blur();
      } else if (e.key === 'Escape') {
        this.syncFromSelection();
        this.input.blur();
      }
    });

    this.container.appendChild(this.input);
  }

  private syncFromSelection(): void {
    if (document.activeElement === this.input) return;
    const sel = appState.selection;
    const isSingle = sel.range.startRow === sel.range.endRow && sel.range.startCol === sel.range.endCol;
    this.input.value = isSingle
      ? toA1(sel.active.row, sel.active.col)
      : `${toA1(sel.range.startRow, sel.range.startCol)}:${toA1(sel.range.endRow, sel.range.endCol)}`;
  }
}
