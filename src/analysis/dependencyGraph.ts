/**
 * Workbook dependency graph built from formula text extraction.
 * Powers Trace Precedents/Dependents, cycles, lint, and profile hotspots.
 */

import { Workbook, Worksheet } from '../types/workbook';
import {
  AnalysisLimits,
  CellAddress,
  DependencyNode,
  TraceTreeNode,
} from './types';
import {
  cellKey,
  expandRangeCells,
  extractFormulaRefs,
  formatAddress,
} from './formulaRefs';

const DEFAULT_LIMITS: AnalysisLimits = {
  maxTraversalDepth: 12,
  maxNodes: 5000,
  maxDiagnostics: 500,
  maxCellsScanned: 200_000,
};

export class DependencyGraph {
  private readonly nodes = new Map<string, DependencyNode>();
  private readonly formulaCells: CellAddress[] = [];
  readonly limits: AnalysisLimits;
  readonly partial: boolean;
  readonly notes: string[] = [];

  private constructor(limits: AnalysisLimits, partial: boolean) {
    this.limits = limits;
    this.partial = partial;
  }

  static build(workbook: Workbook, limits: Partial<AnalysisLimits> = {}): DependencyGraph {
    const lim = { ...DEFAULT_LIMITS, ...limits };
    let scanned = 0;
    let partial = false;
    const g = new DependencyGraph(lim, false);

    for (const sheetName of workbook.meta.sheetOrder) {
      const sheet = workbook.sheets[sheetName];
      if (!sheet) continue;
      for (const [rowStr, row] of Object.entries(sheet.rows)) {
        for (const [colStr, cell] of Object.entries(row)) {
          scanned++;
          if (scanned > lim.maxCellsScanned) {
            partial = true;
            g.notes.push(`Scan capped at ${lim.maxCellsScanned} cells; graph may be incomplete.`);
            g.finishPartial(partial);
            return g;
          }
          const row = Number(rowStr);
          const col = Number(colStr);
          const key = cellKey(sheetName, row, col);
          const node: DependencyNode = {
            address: { sheetName, row, col },
            formula: cell.type === 'formula' ? cell.formula ?? cell.raw ?? undefined : undefined,
            valuePreview: preview(cell.value),
            type: cell.type,
            precedents: [],
            dependents: [],
          };
          g.nodes.set(key, node);

          if (cell.type === 'formula' && (cell.formula || cell.raw)) {
            g.formulaCells.push({ sheetName, row, col });
            const formula = cell.formula ? `=${cell.formula}` : String(cell.raw);
            const refs = extractFormulaRefs(formula, sheetName);
            for (const ref of refs) {
              if (ref.kind === 'cell' && ref.row !== undefined && ref.col !== undefined) {
                const targetSheet = ref.sheetName ?? sheetName;
                node.precedents.push({ sheetName: targetSheet, row: ref.row, col: ref.col });
                ensureNode(g, targetSheet, ref.row, ref.col, sheet);
              } else if (ref.kind === 'range' && ref.range) {
                const targetSheet = ref.sheetName ?? sheetName;
                // Edge to range anchor (start) + sample of cells for dependents map
                const expanded = expandRangeCells(targetSheet, ref.range, 64);
                for (const c of expanded) {
                  node.precedents.push(c);
                  ensureNode(g, c.sheetName, c.row, c.col, workbook.sheets[c.sheetName]);
                }
              }
            }
          }
        }
      }
    }

    // Invert edges → dependents
    for (const node of g.nodes.values()) {
      for (const p of node.precedents) {
        const pk = cellKey(p.sheetName, p.row, p.col);
        let pn = g.nodes.get(pk);
        if (!pn) {
          pn = {
            address: p,
            precedents: [],
            dependents: [],
          };
          g.nodes.set(pk, pn);
        }
        pn.dependents.push(node.address);
      }
    }

    g.finishPartial(partial);
    return g;
  }

  private finishPartial(partial: boolean): void {
    (this as { partial: boolean }).partial = partial;
  }

  getNode(addr: CellAddress): DependencyNode | undefined {
    return this.nodes.get(cellKey(addr.sheetName, addr.row, addr.col));
  }

  getFormulaCells(): CellAddress[] {
    return this.formulaCells.slice();
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  /** Detect cycles via DFS; returns list of cycle paths (as address keys). */
  findCycles(maxReport = 20): string[][] {
    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (key: string) => {
      if (visited.has(key) || cycles.length >= maxReport) return;
      if (visiting.has(key)) {
        const idx = stack.indexOf(key);
        if (idx >= 0) cycles.push(stack.slice(idx).concat(key));
        return;
      }
      visiting.add(key);
      stack.push(key);
      const node = this.nodes.get(key);
      if (node) {
        for (const p of node.precedents) {
          visit(cellKey(p.sheetName, p.row, p.col));
        }
      }
      stack.pop();
      visiting.delete(key);
      visited.add(key);
    };

    for (const key of this.nodes.keys()) visit(key);
    return cycles;
  }

  tracePrecedents(origin: CellAddress, depth?: number): TraceTreeNode {
    return this.trace(origin, 'precedents', depth ?? this.limits.maxTraversalDepth);
  }

  traceDependents(origin: CellAddress, depth?: number): TraceTreeNode {
    return this.trace(origin, 'dependents', depth ?? this.limits.maxTraversalDepth);
  }

  private trace(
    origin: CellAddress,
    direction: 'precedents' | 'dependents',
    maxDepth: number,
  ): TraceTreeNode {
    const visited = new Set<string>();
    let nodesEmitted = 0;

    const walk = (addr: CellAddress, depth: number): TraceTreeNode => {
      const key = cellKey(addr.sheetName, addr.row, addr.col);
      const node = this.nodes.get(key);
      const label = formatAddress(addr.sheetName, addr.row, addr.col);

      if (visited.has(key)) {
        return { address: addr, label, kind: 'cycle', children: [], formula: node?.formula };
      }
      if (depth > maxDepth || nodesEmitted >= this.limits.maxNodes) {
        return { address: addr, label, kind: 'truncated', children: [], formula: node?.formula };
      }

      visited.add(key);
      nodesEmitted++;

      const children: TraceTreeNode[] = [];
      const nextList = direction === 'precedents' ? node?.precedents ?? [] : node?.dependents ?? [];
      // Dedupe
      const seenChild = new Set<string>();
      for (const next of nextList) {
        const ck = cellKey(next.sheetName, next.row, next.col);
        if (seenChild.has(ck)) continue;
        seenChild.add(ck);
        children.push(walk(next, depth + 1));
      }
      visited.delete(key);

      return {
        address: addr,
        label,
        formula: node?.formula,
        valuePreview: node?.valuePreview,
        kind: 'cell',
        children,
      };
    };

    return walk(origin, 0);
  }

  topConnected(limit = 10): Array<{ address: string; degree: number }> {
    const scored: Array<{ address: string; degree: number }> = [];
    for (const node of this.nodes.values()) {
      const degree = node.precedents.length + node.dependents.length;
      if (degree === 0) continue;
      scored.push({
        address: formatAddress(node.address.sheetName, node.address.row, node.address.col),
        degree,
      });
    }
    scored.sort((a, b) => b.degree - a.degree);
    return scored.slice(0, limit);
  }
}

function ensureNode(
  g: DependencyGraph,
  sheetName: string,
  row: number,
  col: number,
  sheet: Worksheet | undefined,
): void {
  const key = cellKey(sheetName, row, col);
  if ((g as unknown as { nodes: Map<string, DependencyNode> }).nodes.has(key)) return;
  const cell = sheet?.rows[row]?.[col];
  (g as unknown as { nodes: Map<string, DependencyNode> }).nodes.set(key, {
    address: { sheetName, row, col },
    formula: cell?.type === 'formula' ? cell.formula : undefined,
    valuePreview: preview(cell?.value),
    type: cell?.type,
    precedents: [],
    dependents: [],
  });
}

function preview(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
