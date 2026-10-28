/**
 * Full-size Charts workspace modal — not the narrow Tools dock.
 * Form on the left, large chart + data table on the right.
 */

import { postToHost, onHostMessage } from '../app/vscodeApi';
import { appState } from '../state/appState';
import { renderAdvancedSvg } from './advancedCharts';

type ChartType =
  | 'bar'
  | 'stackedBar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'histogram';
type AggFn = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'median' | 'countDistinct';

interface ColOpt {
  col: number;
  label: string;
}

interface AdvancedResult {
  title: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  table: Array<{ category: string; series?: string; values: Record<string, number> }>;
  note: string;
  config: { chartType: ChartType; showLegend: boolean; showValues: boolean };
}

const CHART_TYPES: Array<{ id: ChartType; label: string }> = [
  { id: 'bar', label: 'Bar' },
  { id: 'stackedBar', label: 'Stacked bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'donut', label: 'Donut' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'histogram', label: 'Histogram' },
];

const AGGS: Array<{ id: AggFn; label: string }> = [
  { id: 'sum', label: 'Sum' },
  { id: 'avg', label: 'Average' },
  { id: 'count', label: 'Count' },
  { id: 'min', label: 'Min' },
  { id: 'max', label: 'Max' },
  { id: 'median', label: 'Median' },
  { id: 'countDistinct', label: 'Count unique' },
];

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#ec4899'];

const CHART_CONFIG_KEY = 'sheetlab.chartConfig.v1';

export class ChartsModal {
  private backdrop: HTMLElement;
  private panel: HTMLElement;
  private formEl: HTMLElement;
  private canvasEl: HTMLElement;
  private statusEl: HTMLElement;
  private openState = false;
  private columns: ColOpt[] = [];
  private lastResult: AdvancedResult | null = null;

  private chartType: ChartType = 'bar';
  private categoryCol = 0;
  private measureCol = 1;
  private measureAgg: AggFn = 'sum';
  private measure2Col: number | null = null;
  private measure2Agg: AggFn = 'sum';
  private seriesCol: number | null = null;
  private scatterX = 0;
  private scatterY = 1;
  private headerRow = 0;
  private maxCategories = 30;
  private sortBy: 'category' | 'value' | 'none' = 'value';
  private sortDir: 'asc' | 'desc' = 'desc';
  private title = '';
  private showLegend = true;
  private showValues = false;
  private filterCol: number | null = null;

  constructor(parent: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'sheetlab-charts-backdrop';
    this.backdrop.style.display = 'none';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    this.panel = document.createElement('div');
    this.panel.className = 'sheetlab-charts-modal';
    this.panel.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'sheetlab-charts-modal-header';
    header.innerHTML = '<span class="sheetlab-charts-modal-title">Charts &amp; Advanced Analysis</span>';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sheetlab-tools-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
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
    this.statusEl.textContent = 'Pick axes and measures, then Run';
    this.canvasEl = document.createElement('div');
    this.canvasEl.className = 'sheetlab-charts-modal-canvas';
    this.canvasEl.innerHTML =
      '<div class="sheetlab-tools-empty">Configure the chart on the left, then click <b>Run analysis</b>.</div>';
    right.appendChild(this.statusEl);
    right.appendChild(this.canvasEl);

    body.appendChild(this.formEl);
    body.appendChild(right);
    this.panel.appendChild(header);
    this.panel.appendChild(body);
    this.backdrop.appendChild(this.panel);
    parent.appendChild(this.backdrop);

    // Resize modal from edges
    this.attachModalResize();

    onHostMessage((msg) => {
      if (msg.type === 'analysisColumnList' && this.openState) {
        this.columns = (msg.columns as ColOpt[]) ?? [];
        this.renderForm();
      }
      if (msg.type === 'analysisAdvancedResult') {
        this.lastResult = msg.result as AdvancedResult;
        if (!this.openState) this.open();
        this.statusEl.textContent = this.lastResult?.note || 'Done';
        this.renderResult(this.lastResult);
      }
      if (msg.type === 'analysisAdvancedError') {
        if (!this.openState) this.open();
        this.statusEl.textContent = 'Error';
        this.canvasEl.innerHTML = `<div class="sheetlab-query-error">${esc(String((msg as any).message || 'Analysis failed'))}</div>`;
      }
    });
  }

  open(): void {
    this.openState = true;
    this.backdrop.style.display = 'flex';
    this.loadSavedConfig();
    this.loadColumns();
    this.renderForm();
    if (this.lastResult) this.renderResult(this.lastResult);
    else {
      this.canvasEl.innerHTML =
        '<div class="sheetlab-tools-empty">Configure the chart on the left, or click <b>Sample chart</b>, then <b>Run analysis</b>.</div>';
    }
    postToHost({ type: 'requestColumnList', sheetName: appState.activeSheet });
  }

  close(): void {
    this.openState = false;
    this.backdrop.style.display = 'none';
  }

  isOpen(): boolean {
    return this.openState;
  }

  /** Called when host returns analysis while modal may need to open */
  showResult(result: unknown): void {
    this.lastResult = result as AdvancedResult;
    if (!this.openState) this.open();
    else {
      this.statusEl.textContent = this.lastResult?.note || 'Done';
      this.renderResult(this.lastResult);
    }
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
    if (this.measureCol >= this.columns.length) {
      this.measureCol = Math.min(1, Math.max(0, this.columns.length - 1));
    }
  }

  private renderForm(): void {
    this.formEl.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'sheetlab-adv-form';

    form.appendChild(field('Chart type', select(CHART_TYPES.map((c) => ({ value: c.id, label: c.label })), this.chartType, (v) => {
      this.chartType = v as ChartType;
      this.renderForm();
    })));
    form.appendChild(field('Title', input(this.title, (v) => { this.title = v; }, 'Optional title')));

    if (this.chartType === 'scatter') {
      form.appendChild(field('X axis', this.colSel(this.scatterX, (c) => { this.scatterX = c; })));
      form.appendChild(field('Y axis', this.colSel(this.scatterY, (c) => { this.scatterY = c; })));
    } else if (this.chartType === 'histogram') {
      form.appendChild(field('Numeric column', this.colSel(this.measureCol, (c) => { this.measureCol = c; })));
    } else {
      form.appendChild(field('Category (X axis)', this.colSel(this.categoryCol, (c) => { this.categoryCol = c; })));
      form.appendChild(field('Measure column', this.colSel(this.measureCol, (c) => { this.measureCol = c; })));
      form.appendChild(field('Aggregation', select(AGGS.map((a) => ({ value: a.id, label: a.label })), this.measureAgg, (v) => {
        this.measureAgg = v as AggFn;
      })));
      form.appendChild(field('2nd measure', this.colSelOpt(this.measure2Col, (c) => {
        this.measure2Col = c;
        this.renderForm();
      })));
      if (this.measure2Col != null) {
        form.appendChild(field('2nd aggregation', select(AGGS.map((a) => ({ value: a.id, label: a.label })), this.measure2Agg, (v) => {
          this.measure2Agg = v as AggFn;
        })));
      }
      form.appendChild(field('Series / legend', this.colSelOpt(this.seriesCol, (c) => { this.seriesCol = c; })));
    }

    form.appendChild(field('Header row', num(this.headerRow, (n) => { this.headerRow = n; this.loadColumns(); })));
    form.appendChild(field('Max categories', num(this.maxCategories, (n) => { this.maxCategories = Math.max(1, n); })));
    form.appendChild(field('Sort by', select([
      { value: 'value', label: 'Value' },
      { value: 'category', label: 'Category' },
      { value: 'none', label: 'None' },
    ], this.sortBy, (v) => { this.sortBy = v as 'category' | 'value' | 'none'; })));
    form.appendChild(field('Sort dir', select([
      { value: 'desc', label: 'Descending' },
      { value: 'asc', label: 'Ascending' },
    ], this.sortDir, (v) => { this.sortDir = v as 'asc' | 'desc'; })));
    form.appendChild(field('Filter column', this.colSelOpt(this.filterCol, (c) => { this.filterCol = c; })));

    const checks = document.createElement('div');
    checks.className = 'sheetlab-adv-checks';
    checks.appendChild(check('Legend', this.showLegend, (v) => { this.showLegend = v; }));
    checks.appendChild(check('Show values', this.showValues, (v) => { this.showValues = v; }));
    form.appendChild(checks);

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'sheetlab-btn-primary sheetlab-adv-run';
    run.textContent = 'Run analysis';
    run.addEventListener('click', () => this.run());
    form.appendChild(run);

    const extras = document.createElement('div');
    extras.className = 'sheetlab-charts-extra-actions';
    const mk = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheetlab-btn-secondary';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      extras.appendChild(b);
    };
    mk('Sample chart', 'Use first columns and run a bar chart', () => this.runSample());
    mk('Export SVG', 'Download the current chart as SVG', () => this.exportSvg());
    mk('Export PNG', 'Download the current chart as PNG', () => this.exportPng());
    mk('To sheet', 'Materialize chart data as a new worksheet', () => this.materialize());
    form.appendChild(extras);

    this.formEl.appendChild(form);
  }

  private run(): void {
    const err = this.validate();
    if (err) {
      this.statusEl.textContent = 'Fix configuration';
      this.canvasEl.innerHTML = `<div class="sheetlab-query-error">${esc(err)}</div>`;
      return;
    }
    this.saveConfig();
    this.statusEl.textContent = 'Running…';
    this.canvasEl.innerHTML = '<div class="sheetlab-tools-empty">Computing chart…</div>';
    const measures: Array<{ col: number; agg: AggFn }> = [
      { col: this.measureCol, agg: this.chartType === 'histogram' ? 'count' : this.measureAgg },
    ];
    if (this.measure2Col != null && this.chartType !== 'histogram' && this.chartType !== 'scatter') {
      measures.push({ col: this.measure2Col, agg: this.measure2Agg });
    }
    postToHost({
      type: 'runAdvancedAnalysis',
      config: {
        sheetName: appState.activeSheet,
        chartType: this.chartType,
        categoryCol: this.categoryCol,
        measures,
        seriesCol: this.seriesCol,
        headerRow: this.headerRow,
        maxCategories: this.maxCategories,
        sortBy: this.sortBy,
        sortDir: this.sortDir,
        title: this.title || undefined,
        showLegend: this.showLegend,
        showValues: this.showValues,
        filterCol: this.filterCol,
        scatterXCol: this.scatterX,
        scatterYCol: this.scatterY,
      },
    });
  }

  private validate(): string | null {
    if (!appState.activeSheet) return 'No active sheet.';
    if (!this.columns.length) return 'No columns found. Open a sheet with a header row.';
    const maxCol = this.columns.length - 1;
    if (this.chartType === 'scatter') {
      if (this.scatterX < 0 || this.scatterX > maxCol) return 'X axis column is out of range.';
      if (this.scatterY < 0 || this.scatterY > maxCol) return 'Y axis column is out of range.';
      if (this.scatterX === this.scatterY) return 'Scatter needs two different columns for X and Y.';
    } else if (this.chartType === 'histogram') {
      if (this.measureCol < 0 || this.measureCol > maxCol) return 'Numeric column is out of range.';
    } else {
      if (this.categoryCol < 0 || this.categoryCol > maxCol) return 'Category column is out of range.';
      if (this.measureCol < 0 || this.measureCol > maxCol) return 'Measure column is out of range.';
    }
    return null;
  }

  private saveConfig(): void {
    try {
      localStorage.setItem(
        CHART_CONFIG_KEY,
        JSON.stringify({
          chartType: this.chartType,
          categoryCol: this.categoryCol,
          measureCol: this.measureCol,
          measureAgg: this.measureAgg,
          measure2Col: this.measure2Col,
          measure2Agg: this.measure2Agg,
          seriesCol: this.seriesCol,
          scatterX: this.scatterX,
          scatterY: this.scatterY,
          headerRow: this.headerRow,
          maxCategories: this.maxCategories,
          sortBy: this.sortBy,
          sortDir: this.sortDir,
          title: this.title,
          showLegend: this.showLegend,
          showValues: this.showValues,
          filterCol: this.filterCol,
        }),
      );
    } catch { /* ignore */ }
  }

  private loadSavedConfig(): void {
    try {
      const raw = localStorage.getItem(CHART_CONFIG_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c.chartType) this.chartType = c.chartType;
      if (typeof c.categoryCol === 'number') this.categoryCol = c.categoryCol;
      if (typeof c.measureCol === 'number') this.measureCol = c.measureCol;
      if (c.measureAgg) this.measureAgg = c.measureAgg;
      if (c.measure2Col !== undefined) this.measure2Col = c.measure2Col;
      if (c.measure2Agg) this.measure2Agg = c.measure2Agg;
      if (c.seriesCol !== undefined) this.seriesCol = c.seriesCol;
      if (typeof c.scatterX === 'number') this.scatterX = c.scatterX;
      if (typeof c.scatterY === 'number') this.scatterY = c.scatterY;
      if (typeof c.headerRow === 'number') this.headerRow = c.headerRow;
      if (typeof c.maxCategories === 'number') this.maxCategories = c.maxCategories;
      if (c.sortBy) this.sortBy = c.sortBy;
      if (c.sortDir) this.sortDir = c.sortDir;
      if (typeof c.title === 'string') this.title = c.title;
      if (typeof c.showLegend === 'boolean') this.showLegend = c.showLegend;
      if (typeof c.showValues === 'boolean') this.showValues = c.showValues;
      if (c.filterCol !== undefined) this.filterCol = c.filterCol;
    } catch { /* ignore */ }
  }

  private runSample(): void {
    if (!this.columns.length) {
      this.loadColumns();
    }
    this.chartType = 'bar';
    this.categoryCol = 0;
    this.measureCol = Math.min(1, Math.max(0, this.columns.length - 1));
    this.measureAgg = this.measureCol === this.categoryCol ? 'count' : 'sum';
    this.seriesCol = null;
    this.measure2Col = null;
    this.title = 'Sample chart';
    this.renderForm();
    this.run();
  }

  private exportSvg(): void {
    const svg = this.canvasEl.querySelector('svg');
    if (!svg) {
      this.statusEl.textContent = 'No chart to export — run analysis first';
      return;
    }
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sheetlab-chart-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    this.statusEl.textContent = 'SVG downloaded';
  }

  private exportPng(): void {
    const svg = this.canvasEl.querySelector('svg');
    if (!svg) {
      this.statusEl.textContent = 'No chart to export — run analysis first';
      return;
    }
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('style')) {
      clone.setAttribute('style', 'background:#ffffff;color:#1e1e1e');
    }
    const vb = clone.getAttribute('viewBox') || '0 0 640 360';
    const parts = vb.split(/[\s,]+/).map(Number);
    const w = Math.max(parts[2] || 640, 320);
    const h = Math.max(parts[3] || 360, 200);
    const scale = 2;
    const xml = new XMLSerializer().serializeToString(clone);
    // data: URL avoids CSP blocking blob: on img-src in locked-down webviews
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          this.statusEl.textContent = 'Canvas unavailable for PNG export';
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const href = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = href;
        a.download = `sheetlab-chart-${Date.now()}.png`;
        a.click();
        this.statusEl.textContent = 'PNG downloaded';
      } catch (e) {
        this.statusEl.textContent = e instanceof Error ? e.message : 'PNG export failed';
      }
    };
    img.onerror = () => {
      this.statusEl.textContent = 'PNG export failed to load SVG';
    };
    img.src = url;
  }

  private materialize(): void {
    const r = this.lastResult;
    if (!r || !r.table?.length) {
      this.statusEl.textContent = 'No chart data to materialize — run analysis first';
      return;
    }
    const keys = r.series.map((s) => s.name);
    const columns = r.table[0]?.series != null ? ['Category', 'Series', ...keys] : ['Category', ...keys];
    const rows: (string | number | boolean | null)[][] = r.table.map((row) => {
      const out: (string | number | boolean | null)[] = [row.category];
      if (row.series != null) out.push(row.series);
      for (const k of keys) out.push(row.values[k] ?? null);
      return out;
    });
    postToHost({
      type: 'materializeQuery',
      sql: `-- chart: ${r.title}`,
      sheetName: 'ChartData',
      columns,
      rows,
    });
    this.statusEl.textContent = 'Materializing chart data to a new sheet…';
  }

  private renderResult(r: AdvancedResult | null): void {
    this.canvasEl.innerHTML = '';
    if (!r) {
      this.canvasEl.innerHTML = '<div class="sheetlab-tools-empty">No result</div>';
      return;
    }
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = r.title || 'Chart';
    this.canvasEl.appendChild(title);

    const hasData =
      (r.series?.length > 0 && r.series.some((s) => s.values?.length > 0)) ||
      (r.categories?.length > 0);
    if (!hasData) {
      this.canvasEl.innerHTML +=
        '<div class="sheetlab-query-error">No data points for this configuration. Check category/measure columns, header row, and filters.</div>';
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'sheetlab-chart-wrap sheetlab-charts-modal-svg-wrap';
    const svg = renderAdvancedSvg(r, { width: 640, height: 360 });
    wrap.appendChild(svg);
    this.canvasEl.appendChild(wrap);

    if (r.config?.showLegend && r.series?.length) {
      const leg = document.createElement('div');
      leg.className = 'sheetlab-adv-legend';
      r.series.forEach((s, i) => {
        const item = document.createElement('span');
        item.innerHTML = `<i style="background:${COLORS[i % COLORS.length]}"></i>${esc(s.name)}`;
        leg.appendChild(item);
      });
      this.canvasEl.appendChild(leg);
    }

    if (r.table?.length) {
      const h = document.createElement('div');
      h.className = 'sheetlab-tools-result-title';
      h.style.marginTop = '12px';
      h.textContent = 'Data';
      this.canvasEl.appendChild(h);
      const table = document.createElement('table');
      table.className = 'sheetlab-adv-table';
      const keys = r.series.map((s) => s.name);
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr><th>Category</th>${r.table[0]?.series != null ? '<th>Series</th>' : ''}${keys.map((k) => `<th>${esc(k)}</th>`).join('')}</tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const row of r.table.slice(0, 200)) {
        const tr = document.createElement('tr');
        let html = `<td>${esc(row.category)}</td>`;
        if (row.series != null) html += `<td>${esc(row.series)}</td>`;
        for (const k of keys) {
          const v = row.values[k];
          html += `<td>${v != null ? fmt(v) : ''}</td>`;
        }
        tr.innerHTML = html;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      this.canvasEl.appendChild(table);
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

  private attachModalResize(): void {
    const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
    for (const edge of edges) {
      const h = document.createElement('div');
      h.className = `sheetlab-charts-resize sheetlab-charts-resize-${edge}`;
      h.dataset.edge = edge;
      this.panel.appendChild(h);
      h.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = this.panel.getBoundingClientRect();
        const start = { w: rect.width, h: rect.height, l: rect.left, t: rect.top };
        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let w = start.w;
          let hgt = start.h;
          let left = start.l;
          let top = start.t;
          if (edge.includes('e')) w = Math.max(480, start.w + dx);
          if (edge.includes('w')) {
            w = Math.max(480, start.w - dx);
            left = start.l + dx;
          }
          if (edge.includes('s')) hgt = Math.max(320, start.h + dy);
          if (edge.includes('n')) {
            hgt = Math.max(320, start.h - dy);
            top = start.t + dy;
          }
          this.panel.style.width = `${w}px`;
          this.panel.style.height = `${hgt}px`;
          this.panel.style.left = `${left}px`;
          this.panel.style.top = `${top}px`;
          this.panel.style.transform = 'none';
          this.panel.style.position = 'fixed';
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }
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

function input(value: string, onChange: (v: string) => void, placeholder = ''): HTMLInputElement {
  const i = document.createElement('input');
  i.className = 'sheetlab-adv-input';
  i.value = value;
  i.placeholder = placeholder;
  i.addEventListener('input', () => onChange(i.value));
  return i;
}

function num(value: number, onChange: (n: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.className = 'sheetlab-adv-input';
  i.value = String(value);
  i.addEventListener('change', () => onChange(Number(i.value) || 0));
  return i;
}

function check(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'sheetlab-adv-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = value;
  cb.addEventListener('change', () => onChange(cb.checked));
  wrap.appendChild(cb);
  wrap.appendChild(document.createTextNode(' ' + label));
  return wrap;
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

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return (Math.round(n * 1000) / 1000).toLocaleString();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
