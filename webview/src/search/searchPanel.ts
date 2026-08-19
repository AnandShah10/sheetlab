import { postToHost } from '../app/vscodeApi';
import { onHostMessage } from '../app/vscodeApi';
import { SearchMatch } from '../../../src/types/workbook';

export class SearchPanel {
  private container: HTMLElement;
  private queryInput!: HTMLInputElement;
  private replaceInput!: HTMLInputElement;
  private resultsList!: HTMLDivElement;
  private scopeSelect!: HTMLSelectElement;
  private regexCheckbox!: HTMLInputElement;
  private caseCheckbox!: HTMLInputElement;
  private wholeCellCheckbox!: HTMLInputElement;
  private onNavigate: ((sheetName: string, row: number, col: number) => void) | undefined;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-panel', 'sheetlab-search-panel');
    this.container.style.display = 'none';
    this.build();
    onHostMessage((msg) => {
      if (msg.type === 'searchResults') this.renderResults(msg.matches, msg.total);
    });
  }

  setOnNavigate(fn: (sheetName: string, row: number, col: number) => void): void {
    this.onNavigate = fn;
  }

  open(): void {
    this.container.style.display = 'flex';
    this.queryInput.focus();
  }

  close(): void {
    this.container.style.display = 'none';
  }

  toggle(): void {
    this.container.style.display === 'none' ? this.open() : this.close();
  }

  private build(): void {
    const header = document.createElement('div');
    header.className = 'sheetlab-panel-header';
    header.innerHTML = `<span>Search Workbook</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'sheetlab-panel-close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    this.queryInput = document.createElement('input');
    this.queryInput.placeholder = 'Find…';
    this.queryInput.className = 'sheetlab-search-input';

    this.replaceInput = document.createElement('input');
    this.replaceInput.placeholder = 'Replace with…';
    this.replaceInput.className = 'sheetlab-search-input';

    this.scopeSelect = document.createElement('select');
    ['currentSheet', 'workbook'].forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v === 'currentSheet' ? 'Current sheet' : 'Entire workbook';
      this.scopeSelect.appendChild(opt);
    });

    this.regexCheckbox = this.labeledCheckbox('Regex');
    this.caseCheckbox = this.labeledCheckbox('Case sensitive');
    this.wholeCellCheckbox = this.labeledCheckbox('Whole cell');

    const findBtn = document.createElement('button');
    findBtn.textContent = 'Find All';
    findBtn.className = 'sheetlab-btn-primary';
    findBtn.addEventListener('click', () => this.runSearch());

    this.resultsList = document.createElement('div');
    this.resultsList.className = 'sheetlab-search-results';

    const optionsRow = document.createElement('div');
    optionsRow.className = 'sheetlab-search-options';
    optionsRow.appendChild(this.scopeSelect);
    optionsRow.appendChild(this.regexCheckbox.parentElement!);
    optionsRow.appendChild(this.caseCheckbox.parentElement!);
    optionsRow.appendChild(this.wholeCellCheckbox.parentElement!);

    this.queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.runSearch();
    });

    this.container.appendChild(header);
    this.container.appendChild(this.queryInput);
    this.container.appendChild(this.replaceInput);
    this.container.appendChild(optionsRow);
    this.container.appendChild(findBtn);
    this.container.appendChild(this.resultsList);
  }

  private labeledCheckbox(label: string): HTMLInputElement {
    const wrap = document.createElement('label');
    wrap.className = 'sheetlab-checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(label));
    return cb;
  }

  private runSearch(): void {
    postToHost({
      type: 'runSearch',
      query: this.queryInput.value,
      options: {
        scope: this.scopeSelect.value as 'currentSheet' | 'workbook',
        regex: this.regexCheckbox.checked,
        caseSensitive: this.caseCheckbox.checked,
        wholeCell: this.wholeCellCheckbox.checked,
        replaceWith: this.replaceInput.value || undefined,
      },
    });
  }

  private renderResults(matches: SearchMatch[], total: number): void {
    this.resultsList.innerHTML = '';
    const summary = document.createElement('div');
    summary.className = 'sheetlab-search-summary';
    summary.textContent = `${total} match${total === 1 ? '' : 'es'}`;
    this.resultsList.appendChild(summary);

    matches.slice(0, 500).forEach((m) => {
      const item = document.createElement('div');
      item.className = 'sheetlab-search-result-item';
      item.textContent = `${m.sheetName}!${colLetter(m.col)}${m.row + 1} — ${m.preview}`;
      item.addEventListener('click', () => this.onNavigate?.(m.sheetName, m.row, m.col));
      this.resultsList.appendChild(item);
    });
  }
}

function colLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
