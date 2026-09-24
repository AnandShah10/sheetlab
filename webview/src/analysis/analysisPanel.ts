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

type SectionId = 'analyze' | 'navigate' | 'pipelines' | 'queries' | 'quality' | 'git';

/**
 * Unified SheetLab Tools side panel — analysis, navigation, pipelines,
 * queries, validation, and Git — so users are not forced through the palette.
 */
export class AnalysisPanel {
  private container: HTMLElement;
  private body!: HTMLDivElement;
  private sectionHost!: HTMLDivElement;
  private activeSection: SectionId = 'analyze';
  private onNavigate: ((sheet: string, row: number, col: number) => void) | undefined;
  private recordingHint = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-panel', 'sheetlab-analysis-panel', 'sheetlab-tools-panel');
    this.container.style.display = 'none';
    this.container.style.flexDirection = 'column';
    this.container.style.minWidth = '280px';
    this.container.style.maxWidth = '360px';
    this.container.style.width = '320px';
    this.build();
    onHostMessage((msg) => {
      if (msg.type === 'analysisTraceResult') {
        this.open();
        this.setSection('analyze');
        this.renderTrace(msg.direction, msg.tree as TraceNode, msg.origin);
      }
      if (msg.type === 'analysisDiagnostics') {
        this.open();
        this.setSection('analyze');
        this.renderDiagnostics(msg.diagnostics as Diagnostic[]);
      }
      if (msg.type === 'analysisProfile') {
        this.open();
        this.setSection('analyze');
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
    const sheetName = appState.activeSheet;
    const { row, col } = appState.selection.active;
    postToHost({ type: 'tracePrecedents', sheetName, row, col });
    this.open();
    this.setSection('analyze');
  }

  requestDependents(): void {
    const sheetName = appState.activeSheet;
    const { row, col } = appState.selection.active;
    postToHost({ type: 'traceDependents', sheetName, row, col });
    this.open();
    this.setSection('analyze');
  }

  requestLinter(): void {
    postToHost({ type: 'runLinter' });
    this.open();
    this.setSection('analyze');
  }

  requestProfile(): void {
    postToHost({ type: 'runProfile' });
    this.open();
    this.setSection('analyze');
  }

  requestExplain(): void {
    const sheetName = appState.activeSheet;
    const { row, col } = appState.selection.active;
    postToHost({ type: 'explainCell', sheetName, row, col });
    this.open();
    this.setSection('analyze');
  }

  private host(command: string): void {
    postToHost({ type: 'runHostCommand', command });
  }

  private build(): void {
    const header = document.createElement('div');
    header.className = 'sheetlab-panel-header';
    header.innerHTML = '<span>SheetLab Tools</span>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'sheetlab-panel-close';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    const tabs = document.createElement('div');
    tabs.className = 'sheetlab-tools-tabs';
    tabs.style.display = 'flex';
    tabs.style.flexWrap = 'wrap';
    tabs.style.gap = '2px';
    tabs.style.padding = '4px 6px';
    tabs.style.borderBottom = '1px solid var(--vscode-widget-border, rgba(128,128,128,0.25))';

    const sections: Array<[SectionId, string]> = [
      ['analyze', 'Analyze'],
      ['navigate', 'Navigate'],
      ['pipelines', 'Pipelines'],
      ['queries', 'Queries'],
      ['quality', 'Quality'],
      ['git', 'Git'],
    ];
    for (const [id, label] of sections) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.section = id;
      b.className = 'sheetlab-btn-secondary sheetlab-tools-tab';
      b.style.fontSize = '11px';
      b.style.padding = '3px 8px';
      b.addEventListener('click', () => this.setSection(id));
      tabs.appendChild(b);
    }

    this.sectionHost = document.createElement('div');
    this.sectionHost.style.padding = '8px';
    this.sectionHost.style.borderBottom = '1px solid var(--vscode-widget-border, rgba(128,128,128,0.2))';
    this.sectionHost.style.flexShrink = '0';

    this.body = document.createElement('div');
    this.body.className = 'sheetlab-analysis-body';
    this.body.style.overflow = 'auto';
    this.body.style.flex = '1';
    this.body.style.minHeight = '0';
    this.body.style.fontSize = '12px';
    this.body.style.padding = '8px';
    this.body.innerHTML = '<div style="opacity:0.75">Run an action above. Results appear here.</div>';

    this.container.appendChild(header);
    this.container.appendChild(tabs);
    this.container.appendChild(this.sectionHost);
    this.container.appendChild(this.body);

    this.setSection('analyze');
  }

  private setSection(id: SectionId): void {
    this.activeSection = id;
    for (const btn of this.container.querySelectorAll<HTMLButtonElement>('.sheetlab-tools-tab')) {
      const on = btn.dataset.section === id;
      btn.style.fontWeight = on ? '600' : '400';
      btn.style.outline = on ? '1px solid var(--vscode-focusBorder, #007fd4)' : 'none';
    }
    this.sectionHost.innerHTML = '';
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexDirection = 'column';
    actions.style.gap = '6px';

    const add = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheetlab-btn-secondary';
      b.textContent = label;
      b.title = title;
      b.style.textAlign = 'left';
      b.style.padding = '6px 10px';
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };

    if (id === 'analyze') {
      add('Trace Precedents', 'Depends-on tree for the active cell', () => this.requestPrecedents());
      add('Trace Dependents', 'Who depends on the active cell', () => this.requestDependents());
      add('Explain Cell', 'Precedents + issues for the active cell', () => this.requestExplain());
      add('Run Linter', 'Whole-workbook formula/structure checks', () => this.requestLinter());
      add('Analyze Workbook', 'Profile sheets, formulas, cycles', () => this.requestProfile());
    } else if (id === 'navigate') {
      add('Go to Symbol…', 'Sheets, tables, named ranges, formulas', () => this.host('sheetlab.goToSymbol'));
      add('Peek Cell…', 'Inspect a reference without hunting', () => this.host('sheetlab.peekCell'));
      add('Go to Cell…', 'Jump to A1-style address', () => postToHost({ type: 'uiCommand', command: 'openGoToCell' }));
    } else if (id === 'pipelines') {
      add('Start Recording', 'Capture Clean Data ops into a pipeline', () => {
        this.recordingHint = true;
        this.host('sheetlab.startRecordingTransformations');
        this.body.innerHTML =
          '<div>Recording will start after you name the pipeline. Use <b>Clean Data</b> as usual; steps are captured. Then <b>Stop Recording</b>.</div>';
      });
      add('Stop Recording & Save', 'Write pipeline to .sheetlab/pipelines/', () => {
        this.recordingHint = false;
        this.host('sheetlab.stopRecordingTransformations');
      });
      add('View Pipeline…', 'Session or saved pipelines', () => this.host('sheetlab.viewPipeline'));
      add('Run Saved Pipeline…', 'Replay steps on the open workbook', () => this.host('sheetlab.runPipeline'));
      this.body.innerHTML = this.recordingHint
        ? '<div>Recording mode — run Clean Data operations, then Stop Recording.</div>'
        : '<div style="opacity:0.8">Pipelines store clean-data steps under <code>.sheetlab/pipelines/</code>.</div>';
    } else if (id === 'queries') {
      add('Open Query Panel', 'Write and run SheetLab SQL', () => postToHost({ type: 'uiCommand', command: 'openQuery' }));
      add('Save Query…', 'Persist SQL under .sheetlab/queries/', () => this.host('sheetlab.saveQuery'));
      add('Run Saved Query…', 'Pick a saved query and copy/open it', () => this.host('sheetlab.runSavedQuery'));
      this.body.innerHTML =
        '<div style="opacity:0.8">Saved queries live in <code>.sheetlab/queries/</code> (workspace folder required).</div>';
    } else if (id === 'quality') {
      add('Run Data Validation…', 'required / unique / type / regex rules', () => this.host('sheetlab.runDataValidation'));
      add('Run Linter', 'Formula & structure diagnostics', () => this.requestLinter());
      this.body.innerHTML =
        '<div style="opacity:0.8">Optional rules file: <code>.sheetlab/rules/default.json</code></div>';
    } else if (id === 'git') {
      add('Compare with HEAD…', 'Semantic cell/formula diff vs Git HEAD', () => this.host('sheetlab.compareWithHead'));
      add('Analyze Snapshot', 'Stability check + profile summary', () => this.host('sheetlab.compareSnapshots'));
      this.body.innerHTML =
        '<div style="opacity:0.8">Compares semantic cell values/formulas — not raw XLSX XML noise. Requires a Git workspace.</div>';
    }

    this.sectionHost.appendChild(actions);
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
    line.textContent = `${node.label}${badge}${node.formula ? `  ${node.formula}` : ''}${
      node.valuePreview != null ? ` = ${node.valuePreview}` : ''
    }`;
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
