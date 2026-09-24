/**
 * Deterministic semantic workbook snapshot for profiling, tests, and future Git diff.
 * Omits transient UI state; sorts keys for stability.
 */

import { Workbook, Cell } from '../types/workbook';
import { toA1 } from '../utils/cellRef';

export const SNAPSHOT_VERSION = 1;

export interface SnapshotCell {
  a1: string;
  type: string;
  value: string | number | boolean | null;
  formula?: string;
}

export interface SnapshotSheet {
  name: string;
  index: number;
  hidden?: boolean;
  rowCount: number;
  colCount: number;
  cells: SnapshotCell[];
  tables: Array<{ name: string; range: string; hasHeaderRow: boolean }>;
}

export interface WorkbookSnapshot {
  version: number;
  sourceKind: string;
  sheets: SnapshotSheet[];
}

export function createWorkbookSnapshot(
  workbook: Workbook,
  opts: { maxCellsPerSheet?: number } = {},
): WorkbookSnapshot {
  const maxCells = opts.maxCellsPerSheet ?? 50_000;
  const sheets: SnapshotSheet[] = [];

  workbook.meta.sheetOrder.forEach((name, index) => {
    const sheet = workbook.sheets[name];
    if (!sheet) return;
    const cells: SnapshotCell[] = [];
    const rowKeys = Object.keys(sheet.rows)
      .map(Number)
      .sort((a, b) => a - b);
    for (const r of rowKeys) {
      const row = sheet.rows[r];
      const colKeys = Object.keys(row)
        .map(Number)
        .sort((a, b) => a - b);
      for (const c of colKeys) {
        const cell = row[c];
        if (!cell || cell.type === 'blank') continue;
        cells.push(serializeCell(r, c, cell));
        if (cells.length >= maxCells) break;
      }
      if (cells.length >= maxCells) break;
    }
    sheets.push({
      name,
      index,
      hidden: sheet.hidden,
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      cells,
      tables: (sheet.tables ?? []).map((t) => ({
        name: t.name,
        range: `${toA1(t.range.startRow, t.range.startCol)}:${toA1(t.range.endRow, t.range.endCol)}`,
        hasHeaderRow: t.hasHeaderRow,
      })),
    });
  });

  return {
    version: SNAPSHOT_VERSION,
    sourceKind: workbook.meta.sourceKind,
    sheets,
  };
}

function serializeCell(row: number, col: number, cell: Cell): SnapshotCell {
  return {
    a1: toA1(row, col),
    type: cell.type,
    value: cell.value,
    formula: cell.type === 'formula' ? cell.formula ?? undefined : undefined,
  };
}

export interface SnapshotDiffEntry {
  sheet: string;
  a1: string;
  kind: 'added' | 'removed' | 'value' | 'formula';
  before?: string;
  after?: string;
}

/** Compare two snapshots; returns up to maxEntries semantic cell changes. */
export function diffSnapshots(
  a: WorkbookSnapshot,
  b: WorkbookSnapshot,
  maxEntries = 500,
): SnapshotDiffEntry[] {
  const out: SnapshotDiffEntry[] = [];
  const mapA = flatten(a);
  const mapB = flatten(b);
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const key of [...keys].sort()) {
    if (out.length >= maxEntries) break;
    const ca = mapA.get(key);
    const cb = mapB.get(key);
    const [sheet, a1] = key.split('::');
    if (!ca && cb) {
      out.push({ sheet, a1, kind: 'added', after: formatSnap(cb) });
    } else if (ca && !cb) {
      out.push({ sheet, a1, kind: 'removed', before: formatSnap(ca) });
    } else if (ca && cb) {
      if ((ca.formula ?? '') !== (cb.formula ?? '')) {
        out.push({ sheet, a1, kind: 'formula', before: formatSnap(ca), after: formatSnap(cb) });
      } else if (String(ca.value) !== String(cb.value)) {
        out.push({ sheet, a1, kind: 'value', before: formatSnap(ca), after: formatSnap(cb) });
      }
    }
  }
  return out;
}

function flatten(s: WorkbookSnapshot): Map<string, SnapshotCell> {
  const m = new Map<string, SnapshotCell>();
  for (const sheet of s.sheets) {
    for (const c of sheet.cells) {
      m.set(`${sheet.name}::${c.a1}`, c);
    }
  }
  return m;
}

function formatSnap(c: SnapshotCell): string {
  if (c.formula) return `=${c.formula}`;
  return c.value === null || c.value === undefined ? '' : String(c.value);
}
