/**
 * Excel-style Pivot Table UI — rows / columns / values / filter, then materialize.
 */

import { postToHost, onHostMessage } from '../app/vscodeApi';
import { appState } from '../state/appState';

interface ColOpt {
  col: number;
  label: string;
}

interface PivotResult {
  columns: string[];
  rows: (string | number | null)[][];
  note: string;
}

type Agg = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'countDistinct';

const AGGS: Array<{ id: Agg; label: string }> = [
  { id: 'sum', label: 'Sum' },
  { id: 'count', label: 'Count' },
  { id: 'avg', label: 'Average' },
  { id: 'min', label: 'Min' },
  { id: 'max', label: 'Max' },
  { id: 'countDistinct', label: 'Count unique' },
];

export class PivotModal {
  private backdrop: HTMLElement;
  private formEl: HTMLElement;
  private canvasEl: HTMLElement;
  private statusEl: HTMLElement;
  private openState = false;
  private columns: ColOpt[] = [];
  private last: PivotResult | null = null;

  private rowFields: number[] = [0];
  private colFields: number[] = [];
  private valueCol = 1;
  private valueAgg: Agg = 'sum';
  private value2Col: number | null = null;
  private value2Agg: Agg = 'count';
  private headerRow = 0;
  private filterCol: number | null = null;

  constructor(parent: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'sheetlab-charts-backdrop';
    this.backdrop.style.display = 'none';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    const panel = document.createElement('div');
    panel.className = 'sheetlab-charts-modal';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'sheetlab-charts-modal-header';
    header.innerHTML = '<span class="sheetlab-charts-modal-title">Pivot Table</span>';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sheetlab-tools-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'sheetlab-charts-modal-body';
    this.formEl = document.createElement('div');
    this.formEl.className = 'sheetlab-charts-modal-form';
    const right = document.createElement('div');
    right.className = 'sheetlab-charts-modal-right';
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'sheetlab-charts-modal-status';
    this.statusEl.textContent = 'Choose row / column / value fields';
    this.canvasEl = document.createElement('div');
    this.canvasEl.className = 'sheetlab-charts-modal-canvas';
    right.appendChild(this.statusEl);
    right.appendChild(this.canvasEl);
    body.appendChild(this.formEl);
    body.appendChild(right);
    panel.appendChild(header);
    panel.appendChild(body);
    this.backdrop.appendChild(panel);
    parent.appendChild(this.backdrop);

    onHostMessage((msg) => {
      if (msg.type === 'analysisColumnList' && this.openState) {
        this.columns = (msg.columns as ColOpt[]) ?? [];
        this.renderForm();
      }
      if (msg.type === 'analysisPivotResult') {
        this.last = msg.result as PivotResult;
        if (!this.openState) this.open();
        this.statusEl.textContent = this.last?.note || 'Done';
        this.renderResult(this.last);
      }
      if (msg.type === 'analysisPivotError') {
        if (!this.openState) this.open();
        this.statusEl.textContent = 'Error';
        this.canvasEl.innerHTML = `<div class="sheetlab-query-error">${esc(String((msg as any).message || 'Pivot failed'))}</div>`;
      }
    });
  }

  open(): void {
    this.openState = true;
    this.backdrop.style.display = 'flex';
    this.loadColumns();
    this.renderForm();
    if (this.last) this.renderResult(this.last);
    postToHost({ type: 'requestColumnList', sheetName: appState.activeSheet });
  }

  close(): void {
    this.openState = false;
    this.backdrop.style.display = 'none';
  }

  private loadColumns(): void {
    const sum = appState.sheetSummaries[appState.activeSheet];
    const n = Math.min(sum?.colCount ?? 10, 40);
    this.columns = [];
    for (let c = 0; c < n; c++) {
      const h = appState.getCell(appState.activeSheet, this.headerRow, c);
      const label =
        h?.value != null && String(h.value).trim() ? String(h.value).slice(0, 40) : colLetter(c);
      this.columns.push({ col: c, label });
    }
    if (this.valueCol >= this.columns.length) this.valueCol = Math.min(1, this.columns.length - 1);
  }

  private renderForm(): void {
    this.formEl.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'sheetlab-adv-form';

    form.appendChild(field('Rows (axis)', this.multiCol(this.rowFields, (v) => { this.rowFields = v; })));
    form.appendChild(field('Columns (axis)', this.multiCol(this.colFields, (v) => { this.colFields = v; }, true)));
    form.appendChild(field('Values column', this.colSel(this.valueCol, (c) => { this.valueCol = c; })));
    form.appendChild(field('Aggregation', select(AGGS.map((a) => ({ value: a.id, label: a.label })), this.valueAgg, (v) => {
      this.valueAgg = v as Agg;
    })));
    form.appendChild(field('2nd value (opt)', this.colSelOpt(this.value2Col, (c) => {
      this.value2Col = c;
      this.renderForm();
    })));
    if (this.value2Col != null) {
      form.appendChild(field('2nd aggregation', select(AGGS.map((a) => ({ value: a.id, label: a.label })), this.value2Agg, (v) => {
        this.value2Agg = v as Agg;
      })));
    }
    form.appendChild(field('Header row', num(this.headerRow, (n) => { this.headerRow = n; this.loadColumns(); })));
    form.appendChild(field('Filter column', this.colSelOpt(this.filterCol, (c) => { this.filterCol = c; })));

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'sheetlab-btn-primary sheetlab-adv-run';
    run.textContent = 'Build pivot';
    run.addEventListener('click', () => this.run());
    form.appendChild(run);

    const extras = document.createElement('div');
    extras.className = 'sheetlab-charts-extra-actions';
    const toSheet = document.createElement('button');
    toSheet.type = 'button';
    toSheet.className = 'sheetlab-btn-secondary';
    toSheet.textContent = 'To sheet';
    toSheet.addEventListener('click', () => this.materialize());
    extras.appendChild(toSheet);
    form.appendChild(extras);

    this.formEl.appendChild(form);
  }

  private run(): void {
    if (!this.rowFields.length && !this.colFields.length) {
      this.canvasEl.innerHTML = '<div class="sheetlab-query-error">Add at least one Row or Column field.</div>';
      return;
    }
    this.statusEl.textContent = 'Building pivot…';
    const values: Array<{ col: number; agg: Agg }> = [{ col: this.valueCol, agg: this.valueAgg }];
    if (this.value2Col != null) values.push({ col: this.value2Col, agg: this.value2Agg });
    postToHost({
      type: 'runPivot',
      config: {
        sheetName: appState.activeSheet,
        headerRow: this.headerRow,
        rowFields: this.rowFields,
        colFields: this.colFields,
        values,
        filterCol: this.filterCol,
      },
    });
  }

  private materialize(): void {
    if (!this.last?.rows?.length) {
      this.statusEl.textContent = 'Build a pivot first';
      return;
    }
    postToHost({
      type: 'materializeQuery',
      sql: '-- pivot table',
      sheetName: 'Pivot',
      columns: this.last.columns,
      rows: this.last.rows,
    });
    this.statusEl.textContent = 'Materializing pivot to a new sheet…';
  }

  private renderResult(r: PivotResult | null): void {
    this.canvasEl.innerHTML = '';
    if (!r || !r.columns.length) {
      this.canvasEl.innerHTML = '<div class="sheetlab-tools-empty">No pivot data</div>';
      return;
    }
    const table = document.createElement('table');
    table.className = 'sheetlab-adv-table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of r.rows.slice(0, 500)) {
      const tr = document.createElement('tr');
      tr.innerHTML = row.map((v) => `<td>${v == null ? '' : esc(String(v))}</td>`).join('');
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.canvasEl.appendChild(table);
    if (r.rows.length > 500) {
      const note = document.createElement('div');
      note.className = 'sheetlab-tools-muted';
      note.textContent = `Showing 500 of ${r.rows.length} rows`;
      this.canvasEl.appendChild(note);
    }
  }

  private colSel(value: number, onChange: (c: number) => void): HTMLSelectElement {
    return select(
      this.columns.map((c) => ({ value: String(c.col), label: `${colLetter(c.col)} — ${c.label}` })),
      String(value),
      (v) => onChange(Number(v)),
    );
  }

  private colSelOpt(value: number | null, onChange: (c: number | null) => void): HTMLSelectElement {
    return select(
      [{ value: '', label: '— None —' }, ...this.columns.map((c) => ({ value: String(c.col), label: `${colLetter(c.col)} — ${c.label}` }))],
      value == null ? '' : String(value),
      (v) => onChange(v === '' ? null : Number(v)),
    );
  }

  private multiCol(selected: number[], onChange: (v: number[]) => void, allowEmpty = false): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sheetlab-pivot-multi';
    for (const c of this.columns) {
      const lab = document.createElement('label');
      lab.className = 'sheetlab-adv-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.includes(c.col);
      cb.addEventListener('change', () => {
        const next = this.columns.filter((x) => {
          const el = wrap.querySelector(`input[data-col="${x.col}"]`) as HTMLInputElement | null;
          return el?.checked;
        }).map((x) => x.col);
        if (!allowEmpty && next.length === 0) {
          cb.checked = true;
          return;
        }
        onChange(next);
      });
      cb.dataset.col = String(c.col);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(` ${colLetter(c.col)} — ${c.label}`));
      wrap.appendChild(lab);
    }
    return wrap;
  }
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sheetlab-adv-field';
  const lab = document.createElement('label');
  lab.textContent = label;
  row.appendChild(lab);
  row.appendChild(control);
  return row;
}

function select(
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const s = document.createElement('select');
  s.className = 'sheetlab-adv-select';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    s.appendChild(opt);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function num(value: number, onChange: (n: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.className = 'sheetlab-adv-input';
  i.value = String(value);
  i.addEventListener('change', () => onChange(Number(i.value) || 0));
  return i;
}

function colLetter(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
