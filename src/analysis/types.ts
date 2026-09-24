/**
 * Shared analysis-domain types. No vscode/DOM imports — usable from host
 * services, tests, and (via the message protocol) the webview.
 */

import { CellRange } from '../types/workbook';

export interface CellAddress {
  sheetName: string;
  row: number;
  col: number;
}

export type RefKind = 'cell' | 'range' | 'sheet' | 'structured' | 'name' | 'unknown';

export interface ExtractedRef {
  kind: RefKind;
  /** Original substring in the formula */
  text: string;
  sheetName?: string;
  row?: number;
  col?: number;
  range?: CellRange;
  /** For structured refs e.g. Table1[Col] */
  tableName?: string;
  columnName?: string;
}

export interface DependencyEdge {
  from: CellAddress;
  to: CellAddress;
  via: string;
}

export interface DependencyNode {
  address: CellAddress;
  formula?: string;
  valuePreview?: string;
  type?: string;
  /** Direct precedents (cells this formula reads) */
  precedents: CellAddress[];
  /** Direct dependents (cells that read this cell) */
  dependents: CellAddress[];
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface WorkbookDiagnostic {
  id: string;
  ruleId: string;
  severity: DiagnosticSeverity;
  message: string;
  sheetName?: string;
  row?: number;
  col?: number;
  endRow?: number;
  endCol?: number;
  related?: CellAddress[];
  /** Optional one-line explanation */
  detail?: string;
}

export interface WorkbookProfile {
  sheetCount: number;
  sheets: Array<{
    name: string;
    rowCount: number;
    colCount: number;
    populatedCells: number;
    formulaCells: number;
    errorCells: number;
    tables: number;
    hiddenRows: number;
    hiddenCols: number;
  }>;
  totalPopulatedCells: number;
  totalFormulaCells: number;
  totalErrorCells: number;
  tableCount: number;
  namedRangeCount: number;
  cycleCount: number;
  diagnosticSummary: { error: number; warning: number; info: number };
  topConnectedCells: Array<{ address: string; degree: number }>;
  analyzedAt: string;
  partial: boolean;
  notes: string[];
}

export interface TraceTreeNode {
  address: CellAddress;
  label: string;
  formula?: string;
  valuePreview?: string;
  kind: 'cell' | 'range' | 'literal' | 'cycle' | 'truncated';
  children: TraceTreeNode[];
}

export interface AnalysisLimits {
  maxTraversalDepth: number;
  maxNodes: number;
  maxDiagnostics: number;
  maxCellsScanned: number;
}
