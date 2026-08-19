import { appState } from '../state/appState';

export function findTableAtLocal(row: number, col: number): { name: string } | undefined {
  const tables = appState.sheetSummaries[appState.activeSheet]?.tables ?? [];
  return tables.find(
    (t) => row >= t.range.startRow && row <= t.range.endRow && col >= t.range.startCol && col <= t.range.endCol,
  );
}
