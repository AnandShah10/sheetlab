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

interface CellExplanation {
  address: string;
  sheetName?: string;
  row?: number;
  col?: number;
  formula?: string;
  valuePreview?: string;
  type?: string;
  findings: Array<{ severity: string; title: string; detail: string }>;
  neighborPatterns: Array<{ a1: string; formula: string; matches: boolean }>;
  proposedFix?: string;
  precedentCount: number;
  dependentCount: number;
}

interface ColumnStatsView {
  sheetName: string;
  col: number;
  label: string;
  count: number;
  nonBlank: number;
  blank: number;
  numbers: number;
  texts: number;
  dates: number;
  bools: number;
  errors: number;
  formulas: number;
  unique: number;
  min?: number;
  max?: number;
  sum?: number;
  mean?: number;
  median?: number;
  stdev?: number;
  topValues: Array<{ value: string; count: number }>;
  histogram?: Array<{ from: number; to: number; count: number; label: string }>;
}

interface ChartView {
  kind: 'histogram' | 'bar' | 'line' | 'pie';
  title: string;
  sheetName: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  note?: string;
}

interface GitDiffEntry {
  sheet: string;
  a1: string;
  kind: string;
  before?: string;
  after?: string;
}

interface FixProposal {
  sheetName: string;
  row: number;
  col: number;
  a1: string;
  current?: string;
  proposed: string;
  reason: string;
}

interface LineageNode {
  kind: string;
  label: string;
  detail?: string;
  sheetName?: string;
  row?: number;
  col?: number;
  children: LineageNode[];
}

interface TestResultRow {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  sheetName?: string;
  row?: number;
  col?: number;
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
  private onNavigate: ((sheet: string, row: number, col: number) => void) | undefined;
  private openState = false;
  private panelWidth = 300;
  private resizeHandle!: HTMLDivElement;
  private static readonly WIDTH_KEY = 'sheetlab.toolsPanelWidth';
  private static readonly MIN_W = 220;
  private static readonly MAX_W = 720;

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
      if (msg.type === 'analysisExplanation') {
        this.open();
        this.setSection('analyze', false);
        this.renderExplanation(msg.explanation as CellExplanation);
      }
      if (msg.type === 'analysisColumnStats') {
        this.open();
        this.renderColumnStats(msg.stats as ColumnStatsView);
      }
      // Quick analysisChart ignored here — use Charts modal

      // analysisAdvancedResult is handled by ChartsModal (full-size workspace), not Tools

      if (msg.type === 'analysisGitDiff') {
        this.open();
        this.setSection('git', false);
        this.renderGitDiff(msg.note as string, msg.diffs as GitDiffEntry[]);
      }
      if (msg.type === 'analysisTestResults') {
        this.open();
        this.setSection('quality', false);
        this.renderTestResults(msg.suiteName as string, msg.results as TestResultRow[]);
      }
      if (msg.type === 'analysisWorkbookExplanation') {
        this.open();
        this.setSection('analyze', false);
        this.renderWorkbookExplanation(msg.text as string);
      }
      if (msg.type === 'analysisLineage') {
        this.open();
        this.setSection('analyze', false);
        this.renderLineage(msg.root as LineageNode);
      }
      if (msg.type === 'analysisFixProposals') {
        this.open();
        this.setSection('analyze', false);
        this.renderFixProposals(msg.proposals as FixProposal[]);
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
    this.applyWidth();
    this.refreshContext();
  }

  close(): void {
    this.openState = false;
    this.container.classList.add('sheetlab-tools-panel--closed');
    this.container.classList.remove('sheetlab-tools-panel--open');
    this.container.style.width = '';
    this.container.style.minWidth = '';
    this.container.style.maxWidth = '';
  }

  private applyWidth(): void {
    if (!this.openState) return;
    const w = Math.min(
      AnalysisPanel.MAX_W,
      Math.max(AnalysisPanel.MIN_W, this.panelWidth),
    );
    this.panelWidth = w;
    this.container.style.width = `${w}px`;
    this.container.style.minWidth = `${w}px`;
    this.container.style.maxWidth = `${w}px`;
  }

  private loadStoredWidth(): void {
    try {
      const raw = localStorage.getItem(AnalysisPanel.WIDTH_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) this.panelWidth = n;
      }
    } catch {
      /* sandbox may block storage */
    }
  }

  private saveWidth(): void {
    try {
      localStorage.setItem(AnalysisPanel.WIDTH_KEY, String(this.panelWidth));
    } catch {
      /* ignore */
    }
  }

  private panelHeight: number | null = null;

  private attachResize(): void {
    // Left edge (primary dock resize — width)
    this.bindEdgeResize(this.resizeHandle, 'w');

    // Extra handles: top, bottom, right, corners
    const edges = [
      ['n', 'sheetlab-tools-resize-n'],
      ['s', 'sheetlab-tools-resize-s'],
      ['e', 'sheetlab-tools-resize-e'],
      ['ne', 'sheetlab-tools-resize-ne'],
      ['nw', 'sheetlab-tools-resize-nw'],
      ['se', 'sheetlab-tools-resize-se'],
      ['sw', 'sheetlab-tools-resize-sw'],
    ] as const;
    for (const [edge, cls] of edges) {
      const h = document.createElement('div');
      h.className = `sheetlab-tools-resize-extra ${cls}`;
      h.dataset.edge = edge;
      this.container.appendChild(h);
      this.bindEdgeResize(h, edge);
    }
  }

  private bindEdgeResize(handle: HTMLElement, edge: string): void {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = this.panelWidth;
      const startH = this.panelHeight ?? this.container.getBoundingClientRect().height;
      const cursors: Record<string, string> = {
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
        ne: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', sw: 'nesw-resize',
      };
      document.body.style.cursor = cursors[edge] ?? 'col-resize';
      document.body.style.userSelect = 'none';
      handle.classList.add('is-dragging');
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (edge.includes('w')) {
          // left edge of right-docked panel: drag left = wider
          this.panelWidth = startW - dx;
          this.applyWidth();
        }
        if (edge.includes('e')) {
          this.panelWidth = startW + dx;
          this.applyWidth();
        }
        if (edge.includes('n') || edge.includes('s')) {
          let h = startH;
          if (edge.includes('s')) h = startH + dy;
          if (edge.includes('n')) h = startH - dy;
          h = Math.min(Math.max(h, 200), window.innerHeight - 40);
          this.panelHeight = h;
          this.container.style.height = `${h}px`;
          this.container.style.maxHeight = `${h}px`;
          this.container.style.alignSelf = 'stretch';
        }
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        this.saveWidth();
        handle.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
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


  requestColumnStats(): void {
    this.open();
    this.setStatus('Computing stats…');
    postToHost({
      type: 'runColumnStats',
      sheetName: appState.activeSheet,
      col: appState.selection.active.col,
    });
  }

  requestChart(kind: 'histogram' | 'bar' | 'line' | 'pie'): void {
    this.open();
    this.setStatus('Building chart…');
    postToHost({
      type: 'runChart',
      sheetName: appState.activeSheet,
      col: appState.selection.active.col,
      kind,
    });
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

  requestLineage(): void {
    const { row, col } = appState.selection.active;
    postToHost({ type: 'showLineage', sheetName: appState.activeSheet, row, col });
    this.open();
    this.setStatus('Building lineage…');
  }

  requestColumnFixes(): void {
    const { row, col } = appState.selection.active;
    postToHost({ type: 'proposeColumnFixes', sheetName: appState.activeSheet, row, col });
    this.open();
    this.setStatus('Scanning column for formula outliers…');
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
    this.loadStoredWidth();

    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'sheetlab-tools-resize';
    this.resizeHandle.title = 'Drag to resize';
    this.resizeHandle.setAttribute('role', 'separator');
    this.resizeHandle.setAttribute('aria-orientation', 'vertical');
    this.attachResize();

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

    this.container.appendChild(this.resizeHandle);
    this.container.appendChild(header);
    this.container.appendChild(tabs);
    this.container.appendChild(this.sectionHost);
    this.container.appendChild(this.statusEl);
    this.container.appendChild(this.body);

    this.setSection('analyze');
  }

  /** @param rebuildActions when false, keep existing chips (after results arrive) */
  private setSection(id: SectionId, rebuildActions = true): void {
    for (const btn of Array.from(this.container.querySelectorAll('.sheetlab-tools-tab')) as HTMLButtonElement[]) {
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
      chip('Lineage', 'Formula + pipeline lineage for active cell', () => this.requestLineage());
      chip('Explain', 'Why this value may be wrong', () => this.requestExplain());
      chip('Fix column', 'Preview formula fixes for outlier cells in column', () => this.requestColumnFixes());
      chip('Lint', 'Workbook-wide structure/formula checks', () => this.requestLinter());
      chip('Profile', 'Sheets, formulas, cycles summary', () => this.requestProfile());
      chip('Column stats', 'Quick describe active column', () => this.requestColumnStats());
      chip('Explain WB', 'Structural overview of the workbook', () => this.host('sheetlab.explainWorkbook', 'Explaining workbook…'));
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
      /* Materialize is on the query result toolbar after Run */
    } else if (id === 'quality') {
      chip('Validate…', 'Data quality rules', () => this.host('sheetlab.runDataValidation', 'Validating…'));
      chip('Tests…', 'Run .sheetlab/tests/*.json', () => this.host('sheetlab.runWorkbookTests', 'Tests…'));
      chip('Lint', 'Formula & structure', () => this.requestLinter());
    } else if (id === 'git') {
      chip('Highlight changes', 'Highlight changed cells vs HEAD (grid + list)', () => this.host('sheetlab.highlightGitChanges', 'Highlighting…'));
      chip('VS Code Diff', 'Open native side-by-side Git diff', () => this.host('sheetlab.openNativeGitDiff', 'Opening VS Code diff…'));
      chip('Clear highlights', 'Remove cell highlight decorations', () => this.host('sheetlab.clearDiffHighlights', 'Cleared'));
      chip('vs HEAD…', 'Semantic diff vs Git HEAD', () => this.host('sheetlab.compareWithHead', 'Comparing…'));
      chip('vs Commit…', 'Compare with a recent Git commit', () => this.host('sheetlab.compareWithCommit', 'Pick commit…'));
      chip('2 Commits…', 'Diff two commits of this file', () => this.host('sheetlab.compareTwoCommits', 'Pick commits…'));
      chip('vs File…', 'Compare with another workbook file', () => this.host('sheetlab.compareWithFile', 'Pick file…'));
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
  private renderExplanation(ex: CellExplanation): void {
    this.setStatus(`${ex.findings.length} finding(s)`);
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = `Explain · ${ex.address}`;
    this.body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'sheetlab-tools-muted';
    meta.textContent = [
      ex.type ? `type ${ex.type}` : '',
      ex.formula ?? '',
      ex.valuePreview != null ? `= ${ex.valuePreview}` : '',
      `${ex.precedentCount} precedents · ${ex.dependentCount} dependents`,
    ].filter(Boolean).join(' · ');
    this.body.appendChild(meta);

    for (const f of ex.findings) {
      const item = document.createElement('div');
      item.className = `sheetlab-tools-diag sheetlab-tools-diag--${f.severity}`;
      item.innerHTML = `<span class="sheetlab-tools-diag-sev">${escapeHtml(f.severity)}</span>
        <span class="sheetlab-tools-diag-msg"><b>${escapeHtml(f.title)}</b> — ${escapeHtml(f.detail)}</span>`;
      this.body.appendChild(item);
    }

    if (ex.proposedFix && ex.sheetName != null && ex.row != null && ex.col != null) {
      const box = document.createElement('div');
      box.className = 'sheetlab-tools-fix';
      box.innerHTML = `<div class="sheetlab-tools-muted">Suggested: <code>${escapeHtml(ex.proposedFix)}</code></div>`;
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'sheetlab-tools-chip';
      apply.textContent = 'Apply suggested formula';
      apply.title = 'Uses normal cell edit (undoable)';
      const sheetName = ex.sheetName;
      const row = ex.row;
      const col = ex.col;
      const raw = ex.proposedFix;
      apply.addEventListener('click', () => {
        postToHost({ type: 'editCell', sheetName, row, col, raw });
        this.setStatus('Applied suggested formula (undoable)');
      });
      box.appendChild(apply);
      this.body.appendChild(box);
    }

    if (ex.neighborPatterns.length) {
      const h = document.createElement('div');
      h.className = 'sheetlab-tools-result-title';
      h.style.marginTop = '8px';
      h.textContent = 'Neighbors';
      this.body.appendChild(h);
      for (const n of ex.neighborPatterns) {
        const row = document.createElement('div');
        row.className = 'sheetlab-tools-muted';
        row.textContent = `${n.matches ? '✓' : '✗'} ${n.a1}  ${n.formula}`;
        this.body.appendChild(row);
      }
    }
  }




  private renderColumnStats(s: ColumnStatsView): void {
    this.setStatus(`${s.label} · ${s.nonBlank} values`);
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = `Column stats · ${s.label}`;
    this.body.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'sheetlab-tools-muted';
    sub.textContent = `${s.sheetName}`;
    this.body.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'sheetlab-stats-grid';
    const cards: Array<[string, string]> = [
      ['Non-blank', String(s.nonBlank)],
      ['Blank', String(s.blank)],
      ['Unique', String(s.unique)],
      ['Numbers', String(s.numbers)],
      ['Text', String(s.texts)],
      ['Dates', String(s.dates)],
      ['Formulas', String(s.formulas)],
      ['Errors', String(s.errors)],
    ];
    if (s.min !== undefined) cards.push(['Min', fmt(s.min)]);
    if (s.max !== undefined) cards.push(['Max', fmt(s.max)]);
    if (s.mean !== undefined) cards.push(['Mean', fmt(s.mean)]);
    if (s.median !== undefined) cards.push(['Median', fmt(s.median)]);
    if (s.stdev !== undefined) cards.push(['Stdev', fmt(s.stdev)]);
    if (s.sum !== undefined) cards.push(['Sum', fmt(s.sum)]);
    for (const [k, v] of cards) {
      const card = document.createElement('div');
      card.className = 'sheetlab-stats-card';
      card.innerHTML = `<div class="sheetlab-stats-k">${escapeHtml(k)}</div><div class="sheetlab-stats-v">${escapeHtml(v)}</div>`;
      grid.appendChild(card);
    }
    this.body.appendChild(grid);

    if (s.topValues?.length) {
      const h = document.createElement('div');
      h.className = 'sheetlab-tools-result-title';
      h.style.marginTop = '10px';
      h.textContent = 'Top values';
      this.body.appendChild(h);
      for (const tv of s.topValues.slice(0, 10)) {
        const row = document.createElement('div');
        row.className = 'sheetlab-stats-freq';
        const pct = s.nonBlank ? Math.round((tv.count / s.nonBlank) * 100) : 0;
        row.innerHTML = `<span class="sheetlab-stats-freq-val">${escapeHtml(tv.value)}</span>
          <span class="sheetlab-stats-freq-bar"><i style="width:${pct}%"></i></span>
          <span class="sheetlab-stats-freq-n">${tv.count}</span>`;
        this.body.appendChild(row);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'sheetlab-tools-git-nav';
    actions.style.marginTop = '8px';
    for (const [label, kind] of [
      ['Histogram', 'histogram'],
      ['Bar', 'bar'],
      ['Line', 'line'],
      ['Pie', 'pie'],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sheetlab-tools-chip';
      b.textContent = label;
      b.addEventListener('click', () => this.requestChart(kind));
      actions.appendChild(b);
    }
    this.body.appendChild(actions);
  }

  private renderChart(c: ChartView): void {
    this.setStatus(c.title);
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = c.title;
    this.body.appendChild(title);
    if (c.note) {
      const n = document.createElement('div');
      n.className = 'sheetlab-tools-muted';
      n.textContent = c.note;
      this.body.appendChild(n);
    }
    const wrap = document.createElement('div');
    wrap.className = 'sheetlab-chart-wrap';
    wrap.appendChild(buildSvgChart(c));
    this.body.appendChild(wrap);
  }

  private applyHighlightsFromDiffs(diffs: GitDiffEntry[]): void {
    const map: typeof appState.diffHighlights = {};
    for (const d of diffs) {
      const m = /^([A-Za-z]+)(\d+)$/.exec(d.a1.trim());
      if (!m) continue;
      let col = 0;
      const letters = m[1].toUpperCase();
      for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
      col -= 1;
      const row = parseInt(m[2], 10) - 1;
      map[`${d.sheet}!${row}!${col}`] = {
        kind: d.kind,
        before: d.before,
        after: d.after,
        a1: d.a1,
      };
    }
    appState.diffHighlights = map;
    appState.notify();
  }

  private gitDiffs: GitDiffEntry[] = [];
  private gitIndex = 0;

  private renderGitDiff(note: string, diffs: GitDiffEntry[]): void {
    this.gitDiffs = diffs;
    this.gitIndex = 0;
    this.setStatus(`${diffs.length} change(s)`);
    this.applyHighlightsFromDiffs(diffs);

    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = 'Changes';
    this.body.appendChild(title);

    const noteEl = document.createElement('div');
    noteEl.className = 'sheetlab-tools-muted';
    noteEl.textContent = note;
    this.body.appendChild(noteEl);

    const actions = document.createElement('div');
    actions.className = 'sheetlab-tools-git-nav';
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'sheetlab-tools-chip';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.title = 'Re-run compare vs HEAD';
    refreshBtn.addEventListener('click', () => this.host('sheetlab.highlightGitChanges', 'Refreshing…'));
    const nativeBtn = document.createElement('button');
    nativeBtn.type = 'button';
    nativeBtn.className = 'sheetlab-tools-chip';
    nativeBtn.textContent = 'VS Code Diff';
    nativeBtn.addEventListener('click', () => this.host('sheetlab.openNativeGitDiff', 'Opening…'));
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'sheetlab-tools-chip';
    clearBtn.textContent = 'Clear highlights';
    clearBtn.addEventListener('click', () => {
      appState.diffHighlights = {};
      appState.notify();
      this.host('sheetlab.clearDiffHighlights', 'Cleared');
    });
    actions.appendChild(refreshBtn);
    actions.appendChild(nativeBtn);
    actions.appendChild(clearBtn);
    this.body.appendChild(actions);

    if (!diffs.length) {
      this.body.appendChild(empty('No changes vs HEAD.'));
      return;
    }

    const filter = document.createElement('select');
    filter.className = 'sheetlab-tools-git-filter';
    for (const opt of ['all', 'value', 'formula', 'added', 'removed']) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt === 'all' ? 'All kinds' : opt;
      filter.appendChild(o);
    }
    this.body.appendChild(filter);

    const list = document.createElement('div');
    list.className = 'sheetlab-diff-unified';
    this.body.appendChild(list);

    const renderList = () => {
      const f = filter.value;
      const items = f === 'all' ? this.gitDiffs : this.gitDiffs.filter((d) => d.kind === f);
      list.innerHTML = '';
      items.slice(0, 300).forEach((d, i) => {
        const block = document.createElement('div');
        block.className =
          'sheetlab-diff-hunk sheetlab-diff-hunk-' +
          (d.kind === 'added' ? 'added' : d.kind === 'removed' ? 'removed' : 'changed');
        if (i === this.gitIndex) block.classList.add('sheetlab-tools-git-active');

        const head = document.createElement('div');
        head.className = 'sheetlab-diff-hunk-header';
        head.innerHTML = `<span class="sheetlab-diff-kind">${escapeHtml(d.kind)}</span> <code>${escapeHtml(d.sheet)}!${escapeHtml(d.a1)}</code>`;
        head.addEventListener('click', () => {
          this.gitIndex = i;
          navigateDiff(d);
          renderList();
        });
        block.appendChild(head);

        if (d.kind !== 'added' && (d.before != null || d.kind === 'removed')) {
          const minus = document.createElement('div');
          minus.className = 'sheetlab-diff-line sheetlab-diff-line-del';
          minus.innerHTML = `<span class="sheetlab-diff-prefix">−</span><span class="sheetlab-diff-text">${escapeHtml(d.before ?? '∅')}</span>`;
          block.appendChild(minus);
        }
        if (d.kind !== 'removed' && (d.after != null || d.kind === 'added')) {
          const plus = document.createElement('div');
          plus.className = 'sheetlab-diff-line sheetlab-diff-line-add';
          plus.innerHTML = `<span class="sheetlab-diff-prefix">+</span><span class="sheetlab-diff-text">${escapeHtml(d.after ?? '∅')}</span>`;
          block.appendChild(plus);
        }

        const rowActions = document.createElement('div');
        rowActions.className = 'sheetlab-diff-hunk-actions';
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'sheetlab-tools-chip';
        go.textContent = 'Go to cell';
        go.addEventListener('click', (ev) => {
          ev.stopPropagation();
          navigateDiff(d);
        });
        const revert = document.createElement('button');
        revert.type = 'button';
        revert.className = 'sheetlab-tools-chip';
        revert.textContent = d.kind === 'added' ? 'Delete cell' : 'Revert to HEAD';
        revert.title = 'Restore HEAD value in the workbook, then refresh the diff';
        revert.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const m = /^([A-Za-z]+)(\\d+)$/.exec(d.a1.trim());
          if (!m) return;
          let col = 0;
          const letters = m[1].toUpperCase();
          for (let j = 0; j < letters.length; j++) col = col * 26 + (letters.charCodeAt(j) - 64);
          col -= 1;
          const row = parseInt(m[2], 10) - 1;
          const raw =
            d.kind === 'added' ? '' : d.before != null ? String(d.before) : '';
          postToHost({
            type: 'revertDiffCell',
            sheetName: d.sheet,
            row,
            col,
            raw,
            kind: d.kind,
          });
          this.setStatus('Reverted — refreshing diff…');
          // Host re-compares after mutation; also nudge after a short delay
          setTimeout(() => this.host('sheetlab.highlightGitChanges', 'Refreshing…'), 400);
        });
        rowActions.appendChild(go);
        rowActions.appendChild(revert);
        block.appendChild(rowActions);
        list.appendChild(block);
      });
    };

    const navigateDiff = (d: GitDiffEntry) => {
      const m = /^([A-Za-z]+)(\\d+)$/.exec(d.a1);
      if (m) {
        let col = 0;
        const letters = m[1].toUpperCase();
        for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
        col -= 1;
        const row = parseInt(m[2], 10) - 1;
        this.onNavigate?.(d.sheet, row, col);
      }
    };

    filter.addEventListener('change', () => {
      this.gitIndex = 0;
      renderList();
    });
    renderList();
    if (diffs.length) navigateDiff(diffs[0]);
  }

  private renderTestResults(suiteName: string, results: TestResultRow[]): void {
    const failed = results.filter((r) => !r.passed).length;
    this.setStatus(`${results.length - failed}/${results.length} passed`);
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = `Tests · ${suiteName}`;
    this.body.appendChild(title);
    for (const r of results) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sheetlab-tools-diag ' + (r.passed ? 'sheetlab-tools-diag--info' : 'sheetlab-tools-diag--error');
      item.innerHTML = `<span class="sheetlab-tools-diag-sev">${r.passed ? 'pass' : 'fail'}</span>
        <span class="sheetlab-tools-diag-msg"><b>${escapeHtml(r.name)}</b>${r.passed ? '' : ' — ' + escapeHtml(r.message)}</span>`;
      if (r.sheetName != null && r.row != null && r.col != null) {
        item.addEventListener('click', () => this.onNavigate?.(r.sheetName!, r.row!, r.col!));
      }
      this.body.appendChild(item);
    }
  }


  private renderFixProposals(proposals: FixProposal[]): void {
    this.setStatus(proposals.length ? `${proposals.length} proposed fix(es)` : 'No outliers');
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = 'Column formula fixes (preview)';
    this.body.appendChild(title);
    if (!proposals.length) {
      this.body.appendChild(empty('No formula-pattern outliers found in this column.'));
      return;
    }
    const selected = new Set<number>(proposals.map((_, i) => i));
    const list = document.createElement('div');
    this.body.appendChild(list);
    const actions = document.createElement('div');
    actions.className = 'sheetlab-tools-git-nav';
    const applySel = document.createElement('button');
    applySel.type = 'button';
    applySel.className = 'sheetlab-tools-chip';
    applySel.textContent = 'Apply selected';
    const applyAll = document.createElement('button');
    applyAll.type = 'button';
    applyAll.className = 'sheetlab-tools-chip';
    applyAll.textContent = 'Apply all';
    actions.appendChild(applySel);
    actions.appendChild(applyAll);
    this.body.appendChild(actions);
    const render = () => {
      list.innerHTML = '';
      proposals.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'sheetlab-tools-fix';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selected.has(i);
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(i);
          else selected.delete(i);
        });
        const body = document.createElement('div');
        body.style.flex = '1';
        body.innerHTML = `<div><b>${escapeHtml(p.sheetName)}!${escapeHtml(p.a1)}</b> <span class="sheetlab-tools-muted">${escapeHtml(p.reason)}</span></div>
          <div class="sheetlab-tools-muted">${escapeHtml(p.current ?? '')} → <code>${escapeHtml(p.proposed)}</code></div>`;
        body.style.cursor = 'pointer';
        body.addEventListener('click', () => this.onNavigate?.(p.sheetName, p.row, p.col));
        row.style.flexDirection = 'row';
        row.style.alignItems = 'flex-start';
        row.style.gap = '8px';
        row.appendChild(cb);
        row.appendChild(body);
        list.appendChild(row);
      });
    };
    const apply = (idxs: number[]) => {
      const fixes = idxs.map((i) => {
        const p = proposals[i];
        return { sheetName: p.sheetName, row: p.row, col: p.col, raw: p.proposed };
      });
      postToHost({ type: 'applyCellFixes', fixes });
      this.setStatus(`Applying ${fixes.length} fix(es)…`);
    };
    applySel.addEventListener('click', () => apply([...selected]));
    applyAll.addEventListener('click', () => apply(proposals.map((_, i) => i)));
    render();
  }

  private renderLineage(root: LineageNode): void {
    this.setStatus('Lineage ready');
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = `Lineage · ${root.label}`;
    this.body.appendChild(title);
    if (root.detail) {
      const d = document.createElement('div');
      d.className = 'sheetlab-tools-muted';
      d.textContent = root.detail;
      this.body.appendChild(d);
    }
    this.body.appendChild(this.renderLineageNode(root, 0, true));
  }

  private renderLineageNode(node: LineageNode, depth: number, isRoot = false): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.paddingLeft = `${Math.min(depth, 10) * 10}px`;
    if (!isRoot) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheetlab-tools-tree-btn';
      const kind = node.kind === 'pipeline-step' ? '↻ ' : node.kind === 'note' ? '· ' : '';
      btn.textContent = `${kind}${node.label}${node.detail ? '  ' + node.detail : ''}`;
      btn.title = node.detail ?? node.label;
      if (node.sheetName != null && node.row != null && node.col != null) {
        btn.addEventListener('click', () => this.onNavigate?.(node.sheetName!, node.row!, node.col!));
      }
      wrap.appendChild(btn);
    }
    for (const c of node.children || []) {
      wrap.appendChild(this.renderLineageNode(c, depth + (isRoot ? 0 : 1)));
    }
    return wrap;
  }

  private renderWorkbookExplanation(text: string): void {
    this.setStatus('Overview ready');
    this.body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sheetlab-tools-result-title';
    title.textContent = 'Workbook explanation';
    this.body.appendChild(title);
    const pre = document.createElement('pre');
    pre.className = 'sheetlab-tools-explain-pre';
    pre.textContent = text;
    this.body.appendChild(pre);
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

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toExponential(2);
  return (Math.round(n * 1000) / 1000).toLocaleString();
}

function buildSvgChart(c: ChartView): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 320;
  const H = c.kind === 'pie' ? 240 : 200;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('class', 'sheetlab-chart-svg');

  const values = c.series[0]?.values ?? [];
  const labels = c.labels;
  if (!values.length) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '16');
    t.setAttribute('y', '24');
    t.setAttribute('fill', 'currentColor');
    t.textContent = 'No data for this chart.';
    svg.appendChild(t);
    return svg;
  }

  const colors = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#ec4899'];

  if (c.kind === 'pie') {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2;
    const cy = H / 2 - 8;
    const r = Math.min(cx, cy) - 20;
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      const slice = (v / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += slice;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const large = slice > Math.PI ? 1 : 0;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute(
        'd',
        `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      );
      path.setAttribute('fill', colors[i % colors.length]);
      path.setAttribute('opacity', '0.9');
      svg.appendChild(path);
    });
    return svg;
  }

  // bar / histogram / line
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(...values, 1);
  const n = values.length;
  const gap = c.kind === 'line' ? 0 : 4;
  const barW = c.kind === 'line' ? 0 : Math.max(2, (plotW - gap * (n - 1)) / n);

  // axis
  const axis = document.createElementNS(ns, 'line');
  axis.setAttribute('x1', String(padL));
  axis.setAttribute('y1', String(padT + plotH));
  axis.setAttribute('x2', String(padL + plotW));
  axis.setAttribute('y2', String(padT + plotH));
  axis.setAttribute('stroke', 'currentColor');
  axis.setAttribute('opacity', '0.3');
  svg.appendChild(axis);

  if (c.kind === 'line') {
    let d = '';
    values.forEach((v, i) => {
      const x = padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
      const y = padT + plotH - (v / maxV) * plotH;
      d += (i === 0 ? 'M' : 'L') + ` ${x} ${y}`;
    });
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', colors[0]);
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
    values.forEach((v, i) => {
      const x = padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
      const y = padT + plotH - (v / maxV) * plotH;
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', String(x));
      dot.setAttribute('cy', String(y));
      dot.setAttribute('r', '2.5');
      dot.setAttribute('fill', colors[0]);
      svg.appendChild(dot);
    });
  } else {
    values.forEach((v, i) => {
      const h = (v / maxV) * plotH;
      const x = padL + i * (barW + gap);
      const y = padT + plotH - h;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(barW));
      rect.setAttribute('height', String(Math.max(h, 1)));
      rect.setAttribute('fill', colors[i % colors.length]);
      rect.setAttribute('opacity', '0.85');
      rect.setAttribute('rx', '2');
      svg.appendChild(rect);
    });
  }

  // sparse labels
  const step = Math.max(1, Math.ceil(n / 6));
  labels.forEach((lab, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const x =
      c.kind === 'line'
        ? padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
        : padL + i * (barW + gap) + barW / 2;
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(H - 8));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'currentColor');
    text.setAttribute('font-size', '9');
    text.setAttribute('opacity', '0.75');
    text.textContent = lab.length > 10 ? lab.slice(0, 9) + '…' : lab;
    svg.appendChild(text);
  });

  // max label
  const maxLab = document.createElementNS(ns, 'text');
  maxLab.setAttribute('x', String(padL - 4));
  maxLab.setAttribute('y', String(padT + 4));
  maxLab.setAttribute('text-anchor', 'end');
  maxLab.setAttribute('fill', 'currentColor');
  maxLab.setAttribute('font-size', '9');
  maxLab.setAttribute('opacity', '0.75');
  maxLab.textContent = String(Math.round(maxV * 100) / 100);
  svg.appendChild(maxLab);

  return svg;
}
