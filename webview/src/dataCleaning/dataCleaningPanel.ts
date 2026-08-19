import { postToHost } from '../app/vscodeApi';
import { appState } from '../state/appState';
import { CleanupOperation } from '../../../src/types/workbook';

export class DataCleaningPanel {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-panel', 'sheetlab-clean-panel');
    this.container.style.display = 'none';
    this.build();
  }

  open(): void {
    this.container.style.display = 'flex';
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
    header.innerHTML = '<span>Clean Data (applies to current selection)</span>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'X';
    closeBtn.className = 'sheetlab-panel-close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);
    this.container.appendChild(header);

    const simpleOps: Array<[string, CleanupOperation]> = [
      ['Trim Whitespace', { kind: 'trimWhitespace' }],
      ['Remove Empty Rows', { kind: 'removeEmptyRows' }],
      ['Remove Empty Columns', { kind: 'removeEmptyColumns' }],
      ['Remove Duplicate Rows', { kind: 'removeDuplicateRows' }],
      ['UPPERCASE', { kind: 'normalizeCase', mode: 'upper' }],
      ['lowercase', { kind: 'normalizeCase', mode: 'lower' }],
      ['Title Case', { kind: 'normalizeCase', mode: 'title' }],
      ['Convert Text to Number', { kind: 'convertTextToNumber' }],
      ['Convert Number to Text', { kind: 'convertNumberToText' }],
      ['Fill Down', { kind: 'fillDown' }],
      ['Fill Right', { kind: 'fillRight' }],
    ];

    const grid = document.createElement('div');
    grid.className = 'sheetlab-clean-op-grid';
    simpleOps.forEach(([label, op]) => {
      const btn = document.createElement('button');
      btn.className = 'sheetlab-btn-secondary';
      btn.textContent = label;
      btn.addEventListener('click', () => this.apply(op));
      grid.appendChild(btn);
    });
    this.container.appendChild(grid);

    const frRow = document.createElement('div');
    frRow.className = 'sheetlab-clean-row';
    const findInput = document.createElement('input');
    findInput.placeholder = 'Find';
    const replaceInput = document.createElement('input');
    replaceInput.placeholder = 'Replace with';
    const regexCb = document.createElement('input');
    regexCb.type = 'checkbox';
    const regexLabel = document.createElement('label');
    regexLabel.appendChild(regexCb);
    regexLabel.appendChild(document.createTextNode('Regex'));
    const frBtn = document.createElement('button');
    frBtn.className = 'sheetlab-btn-secondary';
    frBtn.textContent = 'Find and Replace';
    frBtn.addEventListener('click', () =>
      this.apply({ kind: 'findReplace', find: findInput.value, replace: replaceInput.value, regex: regexCb.checked }),
    );
    frRow.append(findInput, replaceInput, regexLabel, frBtn);
    this.container.appendChild(frRow);

    const splitRow = document.createElement('div');
    splitRow.className = 'sheetlab-clean-row';
    const splitDelim = document.createElement('input');
    splitDelim.placeholder = 'Delimiter (e.g. ,)';
    splitDelim.value = ',';
    const splitBtn = document.createElement('button');
    splitBtn.className = 'sheetlab-btn-secondary';
    splitBtn.textContent = 'Split Column';
    splitBtn.addEventListener('click', () => this.apply({ kind: 'splitColumn', delimiter: splitDelim.value }));
    splitRow.append(splitDelim, splitBtn);
    this.container.appendChild(splitRow);

    const mergeRow = document.createElement('div');
    mergeRow.className = 'sheetlab-clean-row';
    const mergeSep = document.createElement('input');
    mergeSep.placeholder = 'Separator';
    mergeSep.value = ' ';
    const mergeBtn = document.createElement('button');
    mergeBtn.className = 'sheetlab-btn-secondary';
    mergeBtn.textContent = 'Merge Selected Columns';
    mergeBtn.addEventListener('click', () => {
      const r = appState.selection.range;
      const cols = Array.from({ length: r.endCol - r.startCol + 1 }, (_, i) => r.startCol + i);
      this.apply({ kind: 'mergeColumns', cols, separator: mergeSep.value });
    });
    mergeRow.append(mergeSep, mergeBtn);
    this.container.appendChild(mergeRow);
  }

  private apply(operation: CleanupOperation): void {
    postToHost({
      type: 'cleanData',
      sheetName: appState.activeSheet,
      range: appState.selection.range,
      operation,
    });
  }
}
