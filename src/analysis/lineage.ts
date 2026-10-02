/**
 * Combined lineage: formula dependencies + recorded pipeline steps touching a cell/range.
 */

import { Workbook, CellRange } from '../types/workbook';
import { DependencyGraph } from './dependencyGraph';
import { TransformationPipeline, TransformationStep } from '../pipelines/types';
import { QueryHistoryEntry } from '../services/queryHistory';
import { toA1 } from '../utils/cellRef';

export interface LineageNode {
  kind: 'cell' | 'pipeline-step' | 'note';
  label: string;
  detail?: string;
  sheetName?: string;
  row?: number;
  col?: number;
  children: LineageNode[];
}

function rangeContains(range: CellRange, row: number, col: number): boolean {
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    col >= range.startCol &&
    col <= range.endCol
  );
}

function rangeLabel(sheet: string, range: CellRange): string {
  const a = toA1(range.startRow, range.startCol);
  const b = toA1(range.endRow, range.endCol);
  return a === b ? `${sheet}!${a}` : `${sheet}!${a}:${b}`;
}

/**
 * Build lineage for a cell: formula precedent tree + pipeline steps whose range covers this cell.
 */
export function buildLineage(
  workbook: Workbook,
  sheetName: string,
  row: number,
  col: number,
  pipelines: TransformationPipeline[] = [],
  graph?: DependencyGraph,
  queries: QueryHistoryEntry[] = [],
): LineageNode {
  const g = graph ?? DependencyGraph.build(workbook);
  const root: LineageNode = {
    kind: 'cell',
    label: `${sheetName}!${toA1(row, col)}`,
    sheetName,
    row,
    col,
    children: [],
  };

  const sheet = workbook.sheets[sheetName];
  const cell = sheet?.rows[row]?.[col];
  if (cell?.type === 'formula') {
    root.detail = cell.formula ? `=${cell.formula}` : String(cell.raw ?? '');
  } else if (cell?.value != null) {
    root.detail = String(cell.value);
  }

  if (sheet?.lineage) {
    root.children.push({
      kind: 'note',
      label: `Sheet origin: ${sheet.lineage.kind}`,
      detail: [
        sheet.lineage.sql ? `SQL: ${sheet.lineage.sql}` : '',
        sheet.lineage.pipelineName ? `Pipeline: ${sheet.lineage.pipelineName}` : '',
        sheet.lineage.sourceSheet ? `Source sheet: ${sheet.lineage.sourceSheet}` : '',
        sheet.lineage.createdAt ? `At: ${sheet.lineage.createdAt}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      children: [],
    });
  }

  // Formula precedents (one level expanded via graph tree, depth-capped)
  const tree = g.tracePrecedents({ sheetName, row, col }, 6);
  for (const child of tree.children) {
    root.children.push(traceToLineage(child));
  }

  // Pipeline steps that touched this cell
  const pipeNodes: LineageNode[] = [];
  for (const pipe of pipelines) {
    for (const step of pipe.steps) {
      if (step.sheetName !== sheetName) continue;
      if (!rangeContains(step.range, row, col)) continue;
      pipeNodes.push({
        kind: 'pipeline-step',
        label: `${pipe.name} · ${step.operation.kind}`,
        detail: rangeLabel(step.sheetName, step.range),
        sheetName: step.sheetName,
        row: step.range.startRow,
        col: step.range.startCol,
        children: [],
      });
    }
  }
  if (pipeNodes.length) {
    root.children.push({
      kind: 'note',
      label: 'Transformation pipelines',
      detail: 'Recorded clean-data steps whose range includes this cell',
      children: pipeNodes,
    });
  }

  if (queries.length) {
    root.children.push({
      kind: 'note',
      label: 'Recent queries',
      detail: 'Queries that mention this sheet (session / .sheetlab history)',
      children: queries.slice(0, 8).map((q) => ({
        kind: 'note' as const,
        label: q.sql.length > 80 ? q.sql.slice(0, 80) + '…' : q.sql,
        detail: `${q.ranAt}${q.rowCount != null ? ` · ${q.rowCount} rows` : ''}`,
        children: [],
      })),
    });
  }

  if (!root.children.length) {
    root.children.push({
      kind: 'note',
      label: 'No formula refs or pipeline steps found',
      children: [],
    });
  }

  return root;
}

function traceToLineage(node: {
  address: { sheetName: string; row: number; col: number };
  label: string;
  formula?: string;
  valuePreview?: string;
  kind: string;
  children: unknown[];
}): LineageNode {
  return {
    kind: node.kind === 'cycle' || node.kind === 'truncated' ? 'note' : 'cell',
    label: node.label + (node.kind === 'cycle' ? ' ⟳' : node.kind === 'truncated' ? ' …' : ''),
    detail: node.formula ?? node.valuePreview,
    sheetName: node.address.sheetName,
    row: node.address.row,
    col: node.address.col,
    children: (node.children as typeof node[]).map(traceToLineage),
  };
}

export function listPipelinesTouching(
  pipelines: TransformationPipeline[],
  sheetName: string,
  row: number,
  col: number,
): TransformationStep[] {
  const out: TransformationStep[] = [];
  for (const p of pipelines) {
    for (const s of p.steps) {
      if (s.sheetName === sheetName && rangeContains(s.range, row, col)) out.push(s);
    }
  }
  return out;
}
