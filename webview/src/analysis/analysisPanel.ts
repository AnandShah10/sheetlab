import { postToHost, onHostMessage } from '../app/vscodeApi';
import { appState } from '../state/appState';

interface TraceNode {
  address: { sheetName: string; row: number; col: number };
  label: string;
  formula?: string;
  valuePreview?: string;
  kind: string;
  children: TraceNode[];
}

interface Diagnostic {
  id: string;
  ruleId: string;
  severity: string;
  message: string;
  sheetName?: string;
  row?: number;
  col?: number;
  detail?: string;
}

interface Profile {
  sheetCount: number;
  totalPopulatedCells: number;
  totalFormulaCells: number;
  totalErrorCells: number;
  tableCount: number;
  cycleCount: number;
  diagnosticSummary: { error: number; warning: number; info: number };
  sheets: Array<{ name: string; formulaCells: number; populatedCells: number; errorCells: number }>;
  topConnectedCells: Array<{ address: string; degree: number }>;
  partial: boolean;
  notes: string[];
}

/**
 * Side panel for dependency traces, lint problems, and workbook profile.
 */
export class AnalysisPanel {
  private container: HTMLElement;
  private body!: HTMLDivElement;
  private onNavigate: ((sheet: string, row: number, col: number) => void) | undefined;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-panel', 'sheetlab-analysis-panel');
    this.container.style.display = 'none';
    this.build();
    onHostMessage((msg) => {
      if (msg.type === 'analysisTraceResult') {
        this.open();
        this.renderTrace(msg.direction, msg.tree as TraceNode, msg.origin);
      }
      if (msg.type === 'analysisDiagnostics') {
        this.open();
        this.renderDiagnostics(msg.diagnostics as Diagnostic[]);
      }
      if (msg.type === 'analysisProfile') {
        this.open();
        this.renderProfile(msg.profile as Profile);
      }
    });
  }

  setOnNavigate(fn: (sheet: string, row: number, col: number) => void): void {
    this.onNavigate = fn;
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

  requestPrecedents(): void {
    // Snapshot selection immediately — toolbar/commands must not rely on context menu focus.
    const sheetName = appState.activeSheet;
    const { row, col } = appState.selection.active;
    postToHost({ type: 'tracePrecedents', sheetName, row, col });
    this.open();
  }

  requestDependents(): void {
    const sheetName = appState.activeSheet;
    const { row, col } = appState.selection.active;
    postToHost({ type: 'traceDependents', sheetName, row, col });
    this.open();
  }

  requestLinter(): void {
    postToHost({ type: 'runLinter' });
    this.open();
  }

  requestProfile(): void {
    postToHost({ type: 'runProfile' });
    this.open();
  }

  requestExplain(): void {
    const { row, col } = appState.selection.active;
    postToHost({ type: 'explainCell', sheetName: appState.activeSheet, row, col });
    this.open();
  }

  private build(): void {
    const header = document.createElement('div');
    header.className = 'sheetlab-panel-header';
    header.innerHTML = '<span>Analysis</span>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'sheetlab-panel-close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    const actions = document.createElement('div');
    actions.className = 'sheetlab-search-actions';
    actions.style.display = 'flex';
    actions.style.flexWrap = 'wrap';
    actions.style.gap = '4px';
    for (const [label, fn] of [
      ['Precedents', () => this.requestPrecedents()],
      ['Dependents', () => this.requestDependents()],
      ['Lint', () => this.requestLinter()],
      ['Profile', () => this.requestProfile()],
      ['Explain', () => this.requestExplain()],
    ] as Array<[string, () => void]>) {
      const b = document.createElement('button');
      b.className = 'sheetlab-btn-secondary';
      b.textContent = label;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    }

    this.body = document.createElement('div');
    this.body.className = 'sheetlab-analysis-body';
    this.body.style.overflow = 'auto';
    this.body.style.flex = '1';
    this.body.style.minHeight = '0';
    this.body.style.fontSize = '12px';

    this.container.appendChild(header);
    this.container.appendChild(actions);
    this.container.appendChild(this.body);
  }

  private renderTrace(
    direction: string,
    tree: TraceNode | null,
    origin: { sheetName: string; row: number; col: number },
  ): void {
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    title.textContent = `${direction === 'precedents' ? 'Precedents' : 'Dependents'} of ${origin.sheetName}!${a1(origin.row, origin.col)}`;
    this.body.appendChild(title);
    if (!tree) {
      this.body.appendChild(document.createTextNode('No dependency data.'));
      return;
    }
    this.body.appendChild(this.renderTree(tree, 0));
  }

  private renderTree(node: TraceNode, depth: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.marginLeft = `${depth * 12}px`;
    wrap.style.padding = '2px 0';
    const line = document.createElement('button');
    line.type = 'button';
    line.className = 'sheetlab-analysis-node';
    line.style.background = 'transparent';
    line.style.border = 'none';
    line.style.color = 'inherit';
    line.style.cursor = 'pointer';
    line.style.textAlign = 'left';
    line.style.padding = '2px 4px';
    line.style.borderRadius = '3px';
    const badge = node.kind === 'cycle' ? ' ⟳' : node.kind === 'truncated' ? ' …' : '';
    line.textContent = `${node.label}${badge}${node.formula ? `  ${node.formula}` : ''}${node.valuePreview != null ? ` = ${node.valuePreview}` : ''}`;
    line.title = node.label;
    line.addEventListener('click', () => {
      this.onNavigate?.(node.address.sheetName, node.address.row, node.address.col);
    });
    line.addEventListener('mouseenter', () => {
      line.style.background = 'var(--vscode-list-hoverBackground, rgba(128,128,128,0.15))';
    });
    line.addEventListener('mouseleave', () => {
      line.style.background = 'transparent';
    });
    wrap.appendChild(line);
    for (const child of node.children || []) {
      wrap.appendChild(this.renderTree(child, depth + 1));
    }
    return wrap;
  }

  private renderDiagnostics(list: Diagnostic[]): void {
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    title.textContent = `Problems (${list.length})`;
    this.body.appendChild(title);
    if (!list.length) {
      this.body.appendChild(document.createTextNode('No issues found.'));
      return;
    }
    for (const d of list) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sheetlab-analysis-diag';
      item.style.display = 'block';
      item.style.width = '100%';
      item.style.textAlign = 'left';
      item.style.background = 'transparent';
      item.style.border = 'none';
      item.style.borderBottom = '1px solid var(--vscode-widget-border, rgba(128,128,128,0.2))';
      item.style.color = 'inherit';
      item.style.padding = '6px 4px';
      item.style.cursor = d.row !== undefined ? 'pointer' : 'default';
      const loc =
        d.sheetName !== undefined && d.row !== undefined && d.col !== undefined
          ? `${d.sheetName}!${a1(d.row, d.col)} · `
          : d.sheetName
            ? `${d.sheetName} · `
            : '';
      item.innerHTML = `<strong>[${d.severity}]</strong> ${loc}${escapeHtml(d.message)}`;
      if (d.detail) {
        const det = document.createElement('div');
        det.style.opacity = '0.8';
        det.style.fontSize = '11px';
        det.textContent = d.detail;
        item.appendChild(det);
      }
      item.addEventListener('click', () => {
        if (d.sheetName !== undefined && d.row !== undefined && d.col !== undefined) {
          this.onNavigate?.(d.sheetName, d.row, d.col);
        }
      });
      this.body.appendChild(item);
    }
  }

  private renderProfile(p: Profile): void {
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    title.textContent = 'Workbook profile';
    this.body.appendChild(title);

    const lines = [
      `Sheets: ${p.sheetCount}`,
      `Populated cells: ${p.totalPopulatedCells}`,
      `Formulas: ${p.totalFormulaCells}`,
      `Errors: ${p.totalErrorCells}`,
      `Tables: ${p.tableCount}`,
      `Cycles: ${p.cycleCount}`,
      `Diagnostics: ${p.diagnosticSummary.error} errors, ${p.diagnosticSummary.warning} warnings, ${p.diagnosticSummary.info} info`,
    ];
    if (p.partial) lines.push('⚠ Analysis was partial (limits applied).');
    for (const n of p.notes || []) lines.push(`• ${n}`);

    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.margin = '0 0 12px';
    pre.textContent = lines.join('\n');
    this.body.appendChild(pre);

    if (p.sheets?.length) {
      const h = document.createElement('div');
      h.style.fontWeight = '600';
      h.textContent = 'Sheets';
      this.body.appendChild(h);
      for (const s of p.sheets) {
        const row = document.createElement('div');
        row.textContent = `${s.name}: ${s.populatedCells} cells, ${s.formulaCells} formulas, ${s.errorCells} errors`;
        this.body.appendChild(row);
      }
    }
    if (p.topConnectedCells?.length) {
      const h = document.createElement('div');
      h.style.fontWeight = '600';
      h.style.marginTop = '8px';
      h.textContent = 'Most connected cells';
      this.body.appendChild(h);
      for (const c of p.topConnectedCells) {
        const row = document.createElement('div');
        row.textContent = `${c.address} (degree ${c.degree})`;
        this.body.appendChild(row);
      }
    }
  }
}

function a1(row: number, col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${s}${row + 1}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
