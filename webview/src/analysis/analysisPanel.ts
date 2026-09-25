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

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'navigate', label: 'Go' },
  { id: 'pipelines', label: 'Pipes' },
  { id: 'queries', label: 'SQL' },
  { id: 'quality', label: 'QA' },
  { id: 'git', label: 'Git' },
];

/**
 * Docked Tools panel optimized for results visibility:
 * compact chrome (header/tabs/chips) + large scrollable results.
 */
export class AnalysisPanel {
  private container: HTMLElement;
  private body!: HTMLDivElement;
  private sectionHost!: HTMLDivElement;
  private contextEl!: HTMLSpanElement;
  private statusEl!: HTMLDivElement;
  private activeSection: SectionId = 'analyze';
  private onNavigate: ((sheet: string, row: number, col: number) => void) | undefined;
  private openState = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-panel', 'sheetlab-tools-panel', 'sheetlab-tools-panel--closed');
    this.build();
    appState.subscribe(() => this.refreshContext());
    onHostMessage((msg) => {
      if (msg.type === 'analysisTraceResult') {
        this.open();
        this.setSection('analyze', false);
        this.renderTrace(msg.direction, msg.tree as TraceNode, msg.origin);
      }
      if (msg.type === 'analysisDiagnostics') {
        this.open();
        this.setSection('analyze', false);
        this.renderDiagnostics(msg.diagnostics as Diagnostic[]);
      }
      if (msg.type === 'analysisProfile') {
        this.open();
        this.setSection('analyze', false);
        this.renderProfile(msg.profile as Profile);
      }
    });
  }

  setOnNavigate(fn: (sheet: string, row: number, col: number) => void): void {
    this.onNavigate = fn;
  }

  open(): void {
    this.openState = true;
    this.container.classList.remove('sheetlab-tools-panel--closed');
    this.container.classList.add('sheetlab-tools-panel--open');
    this.refreshContext();
  }

  close(): void {
    this.openState = false;
    this.container.classList.add('sheetlab-tools-panel--closed');
    this.container.classList.remove('sheetlab-tools-panel--open');
  }

  toggle(): void {
    this.openState ? this.close() : this.open();
  }

  requestPrecedents(): void {
    const { row, col } = appState.selection.active;
    postToHost({ type: 'tracePrecedents', sheetName: appState.activeSheet, row, col });
    this.open();
    this.setStatus('Tracing precedents…');
  }

  requestDependents(): void {
    const { row, col } = appState.selection.active;
    postToHost({ type: 'traceDependents', sheetName: appState.activeSheet, row, col });
    this.open();
    this.setStatus('Tracing dependents…');
  }

  requestLinter(): void {
    postToHost({ type: 'runLinter' });
    this.open();
    this.setStatus('Running linter…');
  }

  requestProfile(): void {
    postToHost({ type: 'runProfile' });
    this.open();
    this.setStatus('Profiling…');
  }

  requestExplain(): void {
    const { row, col } = appState.selection.active;
    postToHost({ type: 'explainCell', sheetName: appState.activeSheet, row, col });
    this.open();
    this.setStatus('Explaining cell…');
  }

  private host(command: string, status?: string): void {
    this.setStatus(status ?? 'Opening…');
    postToHost({ type: 'runHostCommand', command });
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private refreshContext(): void {
    if (!this.openState || !this.contextEl) return;
    const { row, col } = appState.selection.active;
    const sheetName = appState.activeSheet || 'Sheet1';
    const rows = appState.rowsBySheet?.[sheetName];
    const cell = rows?.[row]?.[col];
    const formula = cell?.formula ? `=${cell.formula}` : '';
    const val = cell?.value != null ? String(cell.value) : '';
    const preview = formula || val || '';
    this.contextEl.textContent = preview
      ? `${sheetName}!${a1(row, col)} · ${preview.length > 48 ? preview.slice(0, 48) + '…' : preview}`
      : `${sheetName}!${a1(row, col)}`;
    this.contextEl.title = preview || `${sheetName}!${a1(row, col)}`;
  }

  private build(): void {
    const header = document.createElement('div');
    header.className = 'sheetlab-tools-header';
    const left = document.createElement('div');
    left.className = 'sheetlab-tools-header-left';
    const title = document.createElement('span');
    title.className = 'sheetlab-tools-title';
    title.textContent = 'Tools';
    this.contextEl = document.createElement('span');
    this.contextEl.className = 'sheetlab-tools-context';
    left.appendChild(title);
    left.appendChild(this.contextEl);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sheetlab-tools-close';
    closeBtn.setAttribute('aria-label', 'Close tools');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(left);
    header.appendChild(closeBtn);

    const tabs = document.createElement('div');
    tabs.className = 'sheetlab-tools-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const s of SECTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheetlab-tools-tab';
      b.dataset.section = s.id;
      b.setAttribute('role', 'tab');
      b.textContent = s.label;
      b.title = s.id;
      b.addEventListener('click', () => this.setSection(s.id));
      tabs.appendChild(b);
    }

    this.sectionHost = document.createElement('div');
    this.sectionHost.className = 'sheetlab-tools-actions';

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'sheetlab-tools-status';
    this.statusEl.textContent = 'Ready';

    this.body = document.createElement('div');
    this.body.className = 'sheetlab-tools-results';
    this.body.innerHTML =
      '<div class="sheetlab-tools-empty">Run an action above. Trees, problems, and profiles show here.</div>';

    this.container.appendChild(header);
    this.container.appendChild(tabs);
    this.container.appendChild(this.sectionHost);
    this.container.appendChild(this.statusEl);
    this.container.appendChild(this.body);

    this.setSection('analyze');
  }

  /** @param rebuildActions when false, keep existing chips (after results arrive) */
  private setSection(id: SectionId, rebuildActions = true): void {
    this.activeSection = id;
    for (const btn of this.container.querySelectorAll<HTMLButtonElement>('.sheetlab-tools-tab')) {
      const on = btn.dataset.section === id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (!rebuildActions) return;
    this.sectionHost.innerHTML = '';

    const chip = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheetlab-tools-chip';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      this.sectionHost.appendChild(b);
    };

    if (id === 'analyze') {
      chip('Precedents', 'Trace what this cell depends on', () => this.requestPrecedents());
      chip('Dependents', 'Trace what depends on this cell', () => this.requestDependents());
      chip('Explain', 'Precedents + issues for active cell', () => this.requestExplain());
      chip('Lint', 'Workbook-wide structure/formula checks', () => this.requestLinter());
      chip('Profile', 'Sheets, formulas, cycles summary', () => this.requestProfile());
    } else if (id === 'navigate') {
      chip('Symbol…', 'Go to sheet, table, name, or formula', () => this.host('sheetlab.goToSymbol', 'Go to Symbol…'));
      chip('Peek…', 'Inspect a cell reference', () => this.host('sheetlab.peekCell', 'Peek…'));
      chip('Go to…', 'Jump to A1 address', () => postToHost({ type: 'uiCommand', command: 'openGoToCell' }));
    } else if (id === 'pipelines') {
      chip('Record', 'Start capturing Clean Data steps', () => this.host('sheetlab.startRecordingTransformations', 'Recording…'));
      chip('Stop', 'Stop and save pipeline', () => this.host('sheetlab.stopRecordingTransformations', 'Saving…'));
      chip('View…', 'View session or saved pipelines', () => this.host('sheetlab.viewPipeline', 'Pipelines…'));
      chip('Run…', 'Replay a saved pipeline', () => this.host('sheetlab.runPipeline', 'Run pipeline…'));
    } else if (id === 'queries') {
      chip('Query', 'Open query panel', () => postToHost({ type: 'uiCommand', command: 'openQuery' }));
      chip('Save…', 'Save SQL under .sheetlab/queries/', () => this.host('sheetlab.saveQuery', 'Save query…'));
      chip('Open…', 'Run a saved query', () => this.host('sheetlab.runSavedQuery', 'Load queries…'));
    } else if (id === 'quality') {
      chip('Validate…', 'Data quality rules', () => this.host('sheetlab.runDataValidation', 'Validating…'));
      chip('Tests…', 'Run .sheetlab/tests/*.json', () => this.host('sheetlab.runWorkbookTests', 'Tests…'));
      chip('Lint', 'Formula & structure', () => this.requestLinter());
    } else if (id === 'git') {
      chip('vs HEAD…', 'Semantic diff vs Git HEAD', () => this.host('sheetlab.compareWithHead', 'Comparing…'));
      chip('Snapshot', 'Stability + profile summary', () => this.host('sheetlab.compareSnapshots', 'Snapshot…'));
    }
  }

  private renderTrace(
    direction: string,
    tree: TraceNode | null,
    origin: { sheetName: string; row: number; col: number },
  ): void {
    this.setStatus('Done');
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = `${direction === 'precedents' ? 'Precedents' : 'Dependents'} · ${origin.sheetName}!${a1(origin.row, origin.col)}`;
    this.body.appendChild(title);
    if (!tree) {
      this.body.appendChild(empty('No dependency data.'));
      return;
    }
    this.body.appendChild(this.renderTree(tree, 0));
  }

  private renderTree(node: TraceNode, depth: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sheetlab-tools-tree-node';
    wrap.style.paddingLeft = `${Math.min(depth, 8) * 10}px`;
    const line = document.createElement('button');
    line.type = 'button';
    line.className = 'sheetlab-tools-tree-btn';
    const badge = node.kind === 'cycle' ? ' ⟳' : node.kind === 'truncated' ? ' …' : '';
    line.textContent = `${node.label}${badge}${node.formula ? `  ${node.formula}` : ''}${
      node.valuePreview != null ? ` = ${node.valuePreview}` : ''
    }`;
    line.title = node.label;
    line.addEventListener('click', () => {
      this.onNavigate?.(node.address.sheetName, node.address.row, node.address.col);
    });
    wrap.appendChild(line);
    for (const child of node.children || []) {
      wrap.appendChild(this.renderTree(child, depth + 1));
    }
    return wrap;
  }

  private renderDiagnostics(list: Diagnostic[]): void {
    this.setStatus(`${list.length} finding(s)`);
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = `Problems · ${list.length}`;
    this.body.appendChild(title);
    if (!list.length) {
      this.body.appendChild(empty('No issues found.'));
      return;
    }
    for (const d of list) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `sheetlab-tools-diag sheetlab-tools-diag--${d.severity}`;
      const loc =
        d.sheetName !== undefined && d.row !== undefined && d.col !== undefined
          ? `${d.sheetName}!${a1(d.row, d.col)}`
          : d.sheetName ?? '';
      item.innerHTML = `<span class="sheetlab-tools-diag-sev">${escapeHtml(d.severity)}</span>
        <span class="sheetlab-tools-diag-loc">${escapeHtml(loc)}</span>
        <span class="sheetlab-tools-diag-msg">${escapeHtml(d.message)}</span>`;
      if (d.detail) {
        const det = document.createElement('div');
        det.className = 'sheetlab-tools-diag-detail';
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
    this.setStatus(p.partial ? 'Partial profile' : 'Profile ready');
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = 'Profile';
    this.body.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'sheetlab-tools-stat-grid';
    for (const [k, v] of [
      ['Sheets', p.sheetCount],
      ['Cells', p.totalPopulatedCells],
      ['Formulas', p.totalFormulaCells],
      ['Errors', p.totalErrorCells],
      ['Tables', p.tableCount],
      ['Cycles', p.cycleCount],
    ] as Array<[string, number]>) {
      const card = document.createElement('div');
      card.className = 'sheetlab-tools-stat';
      card.innerHTML = `<div class="sheetlab-tools-stat-value">${v}</div><div class="sheetlab-tools-stat-label">${k}</div>`;
      grid.appendChild(card);
    }
    this.body.appendChild(grid);

    const diags = document.createElement('div');
    diags.className = 'sheetlab-tools-muted';
    diags.textContent = `${p.diagnosticSummary.error} errors · ${p.diagnosticSummary.warning} warnings · ${p.diagnosticSummary.info} info`;
    this.body.appendChild(diags);

    if (p.sheets?.length) {
      const h = document.createElement('div');
      h.className = 'sheetlab-tools-result-title';
      h.style.marginTop = '10px';
      h.textContent = 'Sheets';
      this.body.appendChild(h);
      for (const s of p.sheets) {
        const row = document.createElement('div');
        row.className = 'sheetlab-tools-muted';
        row.textContent = `${s.name}: ${s.populatedCells} cells · ${s.formulaCells} fx · ${s.errorCells} err`;
        this.body.appendChild(row);
      }
    }
  }
}

function empty(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'sheetlab-tools-empty';
  d.textContent = text;
  return d;
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
