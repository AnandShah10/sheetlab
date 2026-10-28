/**
 * Advanced Analysis UI — full chart builder (axes, measures, series, filters)
 * rendered inside Tools → Charts. Not mixed with formula Analyze chips.
 */

import { postToHost, onHostMessage } from '../app/vscodeApi';
import { appState } from '../state/appState';

export type ChartType =
  | 'bar'
  | 'stackedBar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'histogram';

export type AggFn = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'median' | 'countDistinct';

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
  config: {
    chartType: ChartType;
    showLegend: boolean;
    showValues: boolean;
  };
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

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6'];

export class AdvancedChartsBuilder {
  private host: HTMLElement;
  private body: HTMLElement;
  private setStatus: (s: string) => void;
  private columns: ColOpt[] = [];
  private lastResult: AdvancedResult | null = null;

  // form state
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
  private maxCategories = 25;
  private sortBy: 'category' | 'value' | 'none' = 'value';
  private sortDir: 'asc' | 'desc' = 'desc';
  private title = '';
  private showLegend = true;
  private showValues = false;
  private filterCol: number | null = null;

  constructor(host: HTMLElement, body: HTMLElement, setStatus: (s: string) => void) {
    this.host = host;
    this.body = body;
    this.setStatus = setStatus;
    onHostMessage((msg) => {
      if (msg.type === 'analysisColumnList') {
        this.columns = (msg.columns as ColOpt[]) ?? [];
        this.renderForm();
      }
      if (msg.type === 'analysisAdvancedResult') {
        this.lastResult = msg.result as AdvancedResult;
        this.setStatus((this.lastResult as AdvancedResult).note || 'Done');
        this.renderResult(this.lastResult);
      }
    });
  }

  showResult(result: unknown): void {
    this.lastResult = result as AdvancedResult;
    if (this.lastResult) {
      this.setStatus(this.lastResult.note || 'Done');
      this.renderResult(this.lastResult);
    }
  }

  open(): void {
    this.setStatus('Advanced Analysis — configure axes & measures');
    postToHost({ type: 'requestColumnList', sheetName: appState.activeSheet });
    // optimistic columns from local summary if list is slow
    if (!this.columns.length) {
      const sum = appState.sheetSummaries[appState.activeSheet];
      const n = Math.min(sum?.colCount ?? 8, 30);
      this.columns = [];
      for (let c = 0; c < n; c++) {
        const h = appState.getCell(appState.activeSheet, 0, c);
        const label =
          h?.value != null && String(h.value).trim()
            ? String(h.value).slice(0, 40)
            : colLetter(c);
        this.columns.push({ col: c, label });
      }
    }
    if (this.measureCol >= this.columns.length) this.measureCol = Math.min(1, this.columns.length - 1);
    this.renderForm();
    // Keep previous chart visible if any
    if (this.lastResult) this.renderResult(this.lastResult);
    else {
      this.body.innerHTML =
        '<div class="sheetlab-tools-empty">Configure category, measure, and chart type above, then click <b>Run analysis</b>. The chart and data table appear here.</div>';
    }
  }

  private renderForm(): void {
    this.host.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'sheetlab-adv-form';

    form.appendChild(this.field('Chart type', this.select(
      CHART_TYPES.map((c) => ({ value: c.id, label: c.label })),
      this.chartType,
      (v) => {
        this.chartType = v as ChartType;
        this.renderForm();
      },
    )));

    form.appendChild(this.field('Title', this.input(this.title, (v) => { this.title = v; }, 'Optional chart title')));

    if (this.chartType === 'scatter') {
      form.appendChild(this.field('X axis (numeric)', this.colSelect(this.scatterX, (c) => { this.scatterX = c; })));
      form.appendChild(this.field('Y axis (numeric)', this.colSelect(this.scatterY, (c) => { this.scatterY = c; })));
    } else if (this.chartType === 'histogram') {
      form.appendChild(this.field('Measure (numeric column)', this.colSelect(this.measureCol, (c) => { this.measureCol = c; })));
    } else {
      form.appendChild(this.field('Category (X axis)', this.colSelect(this.categoryCol, (c) => { this.categoryCol = c; })));
      form.appendChild(this.field('Measure column', this.colSelect(this.measureCol, (c) => { this.measureCol = c; })));
      form.appendChild(this.field('Aggregation', this.select(
        AGGS.map((a) => ({ value: a.id, label: a.label })),
        this.measureAgg,
        (v) => { this.measureAgg = v as AggFn; },
      )));
      form.appendChild(this.field('2nd measure (optional)', this.colSelectOptional(this.measure2Col, (c) => { this.measure2Col = c; })));
      if (this.measure2Col != null) {
        form.appendChild(this.field('2nd aggregation', this.select(
          AGGS.map((a) => ({ value: a.id, label: a.label })),
          this.measure2Agg,
          (v) => { this.measure2Agg = v as AggFn; },
        )));
      }
      form.appendChild(this.field('Series / legend (optional)', this.colSelectOptional(this.seriesCol, (c) => { this.seriesCol = c; })));
    }

    form.appendChild(this.field('Header row (0-based)', this.numberInput(this.headerRow, (n) => { this.headerRow = n; })));
    form.appendChild(this.field('Max categories', this.numberInput(this.maxCategories, (n) => { this.maxCategories = Math.max(1, n); })));
    form.appendChild(this.field('Sort by', this.select(
      [
        { value: 'value', label: 'Value' },
        { value: 'category', label: 'Category name' },
        { value: 'none', label: 'None' },
      ],
      this.sortBy,
      (v) => { this.sortBy = v as 'category' | 'value' | 'none'; },
    )));
    form.appendChild(this.field('Sort direction', this.select(
      [
        { value: 'desc', label: 'Descending' },
        { value: 'asc', label: 'Ascending' },
      ],
      this.sortDir,
      (v) => { this.sortDir = v as 'asc' | 'desc'; },
    )));
    form.appendChild(this.field('Filter column (optional)', this.colSelectOptional(this.filterCol, (c) => { this.filterCol = c; })));

    const checks = document.createElement('div');
    checks.className = 'sheetlab-adv-checks';
    checks.appendChild(this.check('Show legend', this.showLegend, (v) => { this.showLegend = v; }));
    checks.appendChild(this.check('Show values on chart', this.showValues, (v) => { this.showValues = v; }));
    form.appendChild(checks);

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'sheetlab-btn-primary sheetlab-adv-run';
    run.textContent = 'Run analysis';
    run.addEventListener('click', () => this.run());
    form.appendChild(run);

    this.host.appendChild(form);
  }

  private run(): void {
    this.setStatus('Running advanced analysis…');
    const measures: Array<{ col: number; agg: AggFn }> = [
      { col: this.measureCol, agg: this.chartType === 'histogram' ? 'count' : this.measureAgg },
    ];
    if (this.measure2Col != null && this.chartType !== 'histogram' && this.chartType !== 'scatter') {
      measures.push({ col: this.measure2Col, agg: this.measure2Agg });
    }
    const config = {
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
    };
    postToHost({ type: 'runAdvancedAnalysis', config });
  }

  private renderResult(r: AdvancedResult): void {
    this.body.innerHTML = '';
    this.body.scrollTop = 0;
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = r.title || 'Chart';
    this.body.appendChild(title);
    const note = document.createElement('div');
    note.className = 'sheetlab-tools-muted';
    note.textContent = r.note;
    this.body.appendChild(note);

    const wrap = document.createElement('div');
    wrap.className = 'sheetlab-chart-wrap sheetlab-adv-chart';
    wrap.appendChild(renderAdvancedSvg(r));
    this.body.appendChild(wrap);

    if (r.config.showLegend && r.series.length) {
      const leg = document.createElement('div');
      leg.className = 'sheetlab-adv-legend';
      r.series.forEach((s, i) => {
        const item = document.createElement('span');
        item.innerHTML = `<i style="background:${COLORS[i % COLORS.length]}"></i>${escapeHtml(s.name)}`;
        leg.appendChild(item);
      });
      this.body.appendChild(leg);
    }

    // Data table
    if (r.table?.length) {
      const h = document.createElement('div');
      h.className = 'sheetlab-tools-result-title';
      h.style.marginTop = '10px';
      h.textContent = 'Data';
      this.body.appendChild(h);
      const table = document.createElement('table');
      table.className = 'sheetlab-adv-table';
      const keys = r.series.map((s) => s.name);
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr><th>Category</th>${r.table[0]?.series != null ? '<th>Series</th>' : ''}${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const row of r.table.slice(0, 100)) {
        const tr = document.createElement('tr');
        let html = `<td>${escapeHtml(row.category)}</td>`;
        if (row.series != null) html += `<td>${escapeHtml(row.series)}</td>`;
        for (const k of keys) {
          const v = row.values[k];
          html += `<td>${v != null ? fmt(v) : ''}</td>`;
        }
        tr.innerHTML = html;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      this.body.appendChild(table);
    }
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sheetlab-adv-field';
    const lab = document.createElement('label');
    lab.textContent = label;
    row.appendChild(lab);
    row.appendChild(control);
    return row;
  }

  private select(
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

  private colSelect(value: number, onChange: (c: number) => void): HTMLSelectElement {
    const opts = this.columns.map((c) => ({ value: String(c.col), label: `${colLetter(c.col)} — ${c.label}` }));
    return this.select(opts, String(value), (v) => onChange(Number(v)));
  }

  private colSelectOptional(value: number | null, onChange: (c: number | null) => void): HTMLSelectElement {
    const opts = [
      { value: '', label: '— None —' },
      ...this.columns.map((c) => ({ value: String(c.col), label: `${colLetter(c.col)} — ${c.label}` })),
    ];
    return this.select(opts, value == null ? '' : String(value), (v) => onChange(v === '' ? null : Number(v)));
  }

  private input(value: string, onChange: (v: string) => void, placeholder = ''): HTMLInputElement {
    const i = document.createElement('input');
    i.className = 'sheetlab-adv-input';
    i.value = value;
    i.placeholder = placeholder;
    i.addEventListener('change', () => onChange(i.value));
    i.addEventListener('input', () => onChange(i.value));
    return i;
  }

  private numberInput(value: number, onChange: (n: number) => void): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'number';
    i.className = 'sheetlab-adv-input';
    i.value = String(value);
    i.addEventListener('change', () => onChange(Number(i.value) || 0));
    return i;
  }

  private check(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderAdvancedSvg(
  r: AdvancedResult,
  size?: { width?: number; height?: number },
): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const type = r.config?.chartType ?? 'bar';
  const W = size?.width ?? 360;
  const H = size?.height ?? (type === 'pie' || type === 'donut' ? 260 : 220);
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(H));
  svg.setAttribute('class', 'sheetlab-chart-svg');

  const series = r.series ?? [];
  const cats = r.categories ?? [];
  if (!series.length || (!cats.length && type !== 'scatter')) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '12');
    t.setAttribute('y', '24');
    t.setAttribute('fill', 'currentColor');
    t.textContent = 'No data — adjust fields and Run analysis';
    svg.appendChild(t);
    return svg;
  }

  if (type === 'pie' || type === 'donut') {
    const values = series[0]?.values ?? [];
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2;
    const cy = H / 2;
    const rOuter = Math.min(cx, cy) - 24;
    const rInner = type === 'donut' ? rOuter * 0.55 : 0;
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      const slice = (v / total) * Math.PI * 2;
      const a0 = angle;
      angle += slice;
      const x1 = cx + rOuter * Math.cos(a0);
      const y1 = cy + rOuter * Math.sin(a0);
      const x2 = cx + rOuter * Math.cos(angle);
      const y2 = cy + rOuter * Math.sin(angle);
      const large = slice > Math.PI ? 1 : 0;
      const path = document.createElementNS(ns, 'path');
      if (rInner > 0) {
        const ix1 = cx + rInner * Math.cos(angle);
        const iy1 = cy + rInner * Math.sin(angle);
        const ix2 = cx + rInner * Math.cos(a0);
        const iy2 = cy + rInner * Math.sin(a0);
        path.setAttribute(
          'd',
          `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${rInner} ${rInner} 0 ${large} 0 ${ix2} ${iy2} Z`,
        );
      } else {
        path.setAttribute('d', `M ${cx} ${cy} L ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} Z`);
      }
      path.setAttribute('fill', COLORS[i % COLORS.length]);
      path.setAttribute('opacity', '0.9');
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${cats[i] ?? i}: ${v}`;
      path.appendChild(title);
      svg.appendChild(path);
    });
    return svg;
  }

  if (type === 'scatter') {
    const xs = series.find((s) => s.name === 'x')?.values ?? series[0]?.values ?? [];
    const ys = series.find((s) => s.name === 'y')?.values ?? series[1]?.values ?? [];
    const padL = 40, padR = 12, padT = 16, padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, 1);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 1);
    const sx = (v: number) => padL + ((v - minX) / (maxX - minX || 1)) * plotW;
    const sy = (v: number) => padT + plotH - ((v - minY) / (maxY - minY || 1)) * plotH;
    // axes
    for (const [x1, y1, x2, y2] of [
      [padL, padT + plotH, padL + plotW, padT + plotH],
      [padL, padT, padL, padT + plotH],
    ]) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('opacity', '0.25');
      svg.appendChild(line);
    }
    xs.forEach((x, i) => {
      const y = ys[i];
      if (y == null) return;
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(sx(x)));
      c.setAttribute('cy', String(sy(y)));
      c.setAttribute('r', '3.5');
      c.setAttribute('fill', COLORS[0]);
      c.setAttribute('opacity', '0.8');
      svg.appendChild(c);
    });
    return svg;
  }

  // bar / stackedBar / line / area / histogram
  const padL = 40, padR = 12, padT = 16, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = cats.length;
  const stacked = type === 'stackedBar';
  let maxV = 1;
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (const s of series) sum += s.values[i] ?? 0;
      maxV = Math.max(maxV, sum);
    }
  } else {
    for (const s of series) for (const v of s.values) maxV = Math.max(maxV, v);
  }

  // axis
  const axis = document.createElementNS(ns, 'line');
  axis.setAttribute('x1', String(padL));
  axis.setAttribute('y1', String(padT + plotH));
  axis.setAttribute('x2', String(padL + plotW));
  axis.setAttribute('y2', String(padT + plotH));
  axis.setAttribute('stroke', 'currentColor');
  axis.setAttribute('opacity', '0.3');
  svg.appendChild(axis);

  const groupW = plotW / Math.max(n, 1);
  const gap = 2;
  const barW = stacked
    ? Math.max(2, groupW - gap * 2)
    : Math.max(2, (groupW - gap * 2) / Math.max(series.length, 1));

  if (type === 'line' || type === 'area') {
    series.forEach((s, si) => {
      let d = '';
      s.values.forEach((v, i) => {
        const x = padL + groupW * i + groupW / 2;
        const y = padT + plotH - (v / maxV) * plotH;
        d += (i === 0 ? 'M' : 'L') + ` ${x} ${y}`;
      });
      if (type === 'area' && s.values.length) {
        const lastX = padL + groupW * (s.values.length - 1) + groupW / 2;
        const firstX = padL + groupW / 2;
        d += ` L ${lastX} ${padT + plotH} L ${firstX} ${padT + plotH} Z`;
        const area = document.createElementNS(ns, 'path');
        area.setAttribute('d', d);
        area.setAttribute('fill', COLORS[si % COLORS.length]);
        area.setAttribute('opacity', '0.25');
        svg.appendChild(area);
        d = '';
        s.values.forEach((v, i) => {
          const x = padL + groupW * i + groupW / 2;
          const y = padT + plotH - (v / maxV) * plotH;
          d += (i === 0 ? 'M' : 'L') + ` ${x} ${y}`;
        });
      }
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', COLORS[si % COLORS.length]);
      path.setAttribute('stroke-width', '2');
      svg.appendChild(path);
    });
  } else {
    // bars
    for (let i = 0; i < n; i++) {
      if (stacked) {
        let yBase = padT + plotH;
        series.forEach((s, si) => {
          const v = s.values[i] ?? 0;
          const h = (v / maxV) * plotH;
          const x = padL + groupW * i + gap;
          const y = yBase - h;
          const rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('x', String(x));
          rect.setAttribute('y', String(y));
          rect.setAttribute('width', String(barW));
          rect.setAttribute('height', String(Math.max(h, 0)));
          rect.setAttribute('fill', COLORS[si % COLORS.length]);
          rect.setAttribute('opacity', '0.9');
          rect.setAttribute('rx', '1');
          svg.appendChild(rect);
          yBase = y;
        });
      } else {
        series.forEach((s, si) => {
          const v = s.values[i] ?? 0;
          const h = (v / maxV) * plotH;
          const x = padL + groupW * i + gap + si * barW;
          const y = padT + plotH - h;
          const rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('x', String(x));
          rect.setAttribute('y', String(y));
          rect.setAttribute('width', String(Math.max(barW - 1, 1)));
          rect.setAttribute('height', String(Math.max(h, 0)));
          rect.setAttribute('fill', COLORS[si % COLORS.length]);
          rect.setAttribute('opacity', '0.9');
          rect.setAttribute('rx', '1');
          svg.appendChild(rect);
          if (r.config.showValues && h > 10) {
            const t = document.createElementNS(ns, 'text');
            t.setAttribute('x', String(x + barW / 2));
            t.setAttribute('y', String(y - 2));
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('fill', 'currentColor');
            t.setAttribute('font-size', '8');
            t.textContent = fmt(v);
            svg.appendChild(t);
          }
        });
      }
    }
  }

  // category labels
  const step = Math.max(1, Math.ceil(n / 8));
  cats.forEach((lab, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const x = padL + groupW * i + groupW / 2;
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(H - 10));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', 'currentColor');
    t.setAttribute('font-size', '9');
    t.setAttribute('opacity', '0.8');
    t.textContent = lab.length > 12 ? lab.slice(0, 11) + '…' : lab;
    svg.appendChild(t);
  });

  const maxLab = document.createElementNS(ns, 'text');
  maxLab.setAttribute('x', String(padL - 4));
  maxLab.setAttribute('y', String(padT + 4));
  maxLab.setAttribute('text-anchor', 'end');
  maxLab.setAttribute('fill', 'currentColor');
  maxLab.setAttribute('font-size', '9');
  maxLab.setAttribute('opacity', '0.75');
  maxLab.textContent = fmt(maxV);
  svg.appendChild(maxLab);

  return svg;
}
