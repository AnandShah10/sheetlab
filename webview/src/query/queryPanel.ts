import { postToHost, onHostMessage } from '../app/vscodeApi';
import { QueryErrorPayload, QueryResultPayload } from '../../../src/types/workbook';
import { appState } from '../state/appState';

export class QueryPanel {
  private container: HTMLElement;
  private editor!: HTMLTextAreaElement;
  private resultGrid!: HTMLDivElement;
  private errorBox!: HTMLDivElement;
  private lastResult: QueryResultPayload | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-panel', 'sheetlab-query-panel');
    this.container.style.display = 'none';
    this.build();
    onHostMessage((msg) => {
      if (msg.type === 'queryResult') this.renderResult(msg.result);
      if (msg.type === 'queryError') this.renderError(msg.error);
    });
  }

  open(): void {
    this.container.style.display = 'flex';
    this.editor.focus();
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
    header.innerHTML = `<span>Query (SheetLab Query Language)</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'sheetlab-panel-close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    const hint = document.createElement('div');
    hint.className = 'sheetlab-query-hint';
    hint.textContent =
      'SELECT col, SUM(col2) AS total FROM SheetName WHERE col3 > 10 GROUP BY col ORDER BY total DESC LIMIT 100. ' +
      'Not full SQL -- no joins or subqueries.';

    this.editor = document.createElement('textarea');
    this.editor.className = 'sheetlab-query-editor';
    this.editor.rows = 4;
    this.editor.placeholder = `SELECT * FROM ${appState.activeSheet || 'Sheet1'}`;
    this.editor.spellcheck = false;

    const runBtn = document.createElement('button');
    runBtn.className = 'sheetlab-btn-primary';
    runBtn.textContent = 'Run Query';
    runBtn.addEventListener('click', () => this.run());
    this.editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.run();
      }
    });

    const actions = document.createElement('div');
    actions.className = 'sheetlab-query-actions';
    const copyBtn = this.actionButton('Copy Result', () => this.copyResult());
    const newSheetBtn = this.actionButton('New Worksheet From Result', () => this.exportToNewSheet());
    if (appState.meta?.sourceKind === 'csv' || appState.meta?.sourceKind === 'tsv') {
      // CSV/TSV is fundamentally single-sheet -- there's nowhere for a new
      // worksheet to live, so disable this rather than silently doing
      // nothing when clicked (the host has no 'createSheet' handler for
      // the CSV editor at all).
      newSheetBtn.disabled = true;
      newSheetBtn.title = 'Not available for CSV/TSV -- export the result to a new file instead (Copy Result, then paste into a new CSV).';
    }
    actions.appendChild(copyBtn);
    actions.appendChild(newSheetBtn);

    this.errorBox = document.createElement('div');
    this.errorBox.className = 'sheetlab-query-error';

    this.resultGrid = document.createElement('div');
    this.resultGrid.className = 'sheetlab-query-result-grid';

    this.container.appendChild(header);
    this.container.appendChild(hint);
    this.container.appendChild(this.editor);
    this.container.appendChild(runBtn);
    this.container.appendChild(this.errorBox);
    this.container.appendChild(actions);
    this.container.appendChild(this.resultGrid);
  }

  private actionButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = 'sheetlab-btn-secondary';
    btn.addEventListener('click', onClick);
    return btn;
  }

  private run(): void {
    this.errorBox.textContent = '';
    this.errorBox.style.display = 'none';
    postToHost({ type: 'runQuery', sql: this.editor.value });
  }

  private renderError(error: QueryErrorPayload): void {
    this.errorBox.style.display = 'block';
    const parts = [error.message];
    if (error.column !== undefined) parts.push(`(near position ${error.column})`);
    if (error.expression) parts.push(`-- "${error.expression}"`);
    this.errorBox.textContent = parts.join(' ');
    this.resultGrid.innerHTML = '';
    this.lastResult = null;
  }

  private renderResult(result: QueryResultPayload): void {
    this.lastResult = result;
    this.resultGrid.innerHTML = '';

    const meta = document.createElement('div');
    meta.className = 'sheetlab-query-result-meta';
    meta.textContent = `${result.rowCount.toLocaleString()} row(s) in ${result.elapsedMs}ms${result.truncated ? ' (truncated)' : ''}`;
    this.resultGrid.appendChild(meta);

    const table = document.createElement('table');
    table.className = 'sheetlab-result-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    result.columns.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    result.rows.slice(0, 500).forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((val) => {
        const td = document.createElement('td');
        td.textContent = val === null ? '' : String(val);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    this.resultGrid.appendChild(table);
  }

  private copyResult(): void {
    if (!this.lastResult) return;
    const text = [
      this.lastResult.columns.join('\t'),
      ...this.lastResult.rows.map((r) => r.map((v) => (v === null ? '' : String(v))).join('\t')),
    ].join('\n');
    const btn = this.container.querySelector('button') as HTMLButtonElement | null;
    // Prefer the Copy Result button label feedback
    const copyBtn = Array.from(this.container.querySelectorAll('button')).find(
      (b) => (b.textContent || '').includes('Copy'),
    ) as HTMLButtonElement | undefined;
    const done = () => {
      if (!copyBtn) return;
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.textContent = prev || 'Copy Result';
        copyBtn.disabled = false;
      }, 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          done();
        } finally {
          ta.remove();
        }
      });
    } else {
      done();
    }
  }

  private exportToNewSheet(): void {
    if (!this.lastResult) return;
    postToHost({
      type: 'promptCreateSheet',
      defaultName: 'Query Result',
      data: [
        this.lastResult.columns,
        ...this.lastResult.rows.map((r) => r.map((v) => (v === null ? '' : String(v)))),
      ],
    });
  }
}
