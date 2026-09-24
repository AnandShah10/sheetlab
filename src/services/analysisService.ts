/**
 * Cached analysis orchestrator. Graph + diagnostics rebuild on demand;
 * invalidated when the caller signals workbook mutation.
 */

import { Workbook } from '../types/workbook';
import { DependencyGraph } from '../analysis/dependencyGraph';
import { runLinter } from '../analysis/diagnostics';
import { profileWorkbook } from '../analysis/profiler';
import { CellAddress, TraceTreeNode, WorkbookDiagnostic, WorkbookProfile } from '../analysis/types';

export class AnalysisService {
  private graph: DependencyGraph | null = null;
  private diagnostics: WorkbookDiagnostic[] | null = null;
  private profile: WorkbookProfile | null = null;
  private generation = 0;

  constructor(private getWorkbook: () => Workbook | undefined) {}

  invalidate(): void {
    this.graph = null;
    this.diagnostics = null;
    this.profile = null;
    this.generation++;
  }

  getGraph(): DependencyGraph | null {
    const wb = this.getWorkbook();
    if (!wb) return null;
    if (!this.graph) this.graph = DependencyGraph.build(wb);
    return this.graph;
  }

  getDiagnostics(): WorkbookDiagnostic[] {
    const wb = this.getWorkbook();
    if (!wb) return [];
    const g = this.getGraph();
    if (!g) return [];
    if (!this.diagnostics) this.diagnostics = runLinter(wb, g);
    return this.diagnostics;
  }

  getProfile(): WorkbookProfile | null {
    const wb = this.getWorkbook();
    if (!wb) return null;
    const g = this.getGraph();
    if (!this.profile) this.profile = profileWorkbook(wb, g ?? undefined);
    return this.profile;
  }

  tracePrecedents(addr: CellAddress): TraceTreeNode | null {
    return this.getGraph()?.tracePrecedents(addr) ?? null;
  }

  traceDependents(addr: CellAddress): TraceTreeNode | null {
    return this.getGraph()?.traceDependents(addr) ?? null;
  }

  getGeneration(): number {
    return this.generation;
  }
}
