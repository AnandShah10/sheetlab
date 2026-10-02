/**
 * Lightweight in-memory (+ optional disk) history of SheetLab queries for lineage.
 */

import * as vscode from 'vscode';

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  ranAt: string;
  sheetHint?: string;
  rowCount?: number;
  elapsedMs?: number;
}

const MAX = 40;
const memory: QueryHistoryEntry[] = [];

export function recordQuery(entry: Omit<QueryHistoryEntry, 'id' | 'ranAt'> & { ranAt?: string }): void {
  memory.unshift({
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ranAt: entry.ranAt ?? new Date().toISOString(),
    sql: entry.sql,
    sheetHint: entry.sheetHint,
    rowCount: entry.rowCount,
    elapsedMs: entry.elapsedMs,
  });
  if (memory.length > MAX) memory.length = MAX;
  void persist();
}

export function getQueryHistory(): QueryHistoryEntry[] {
  return [...memory];
}

export function queriesMentioningSheet(sheetName: string): QueryHistoryEntry[] {
  const lower = sheetName.toLowerCase();
  return memory.filter(
    (e) =>
      (e.sheetHint && e.sheetHint.toLowerCase() === lower) ||
      e.sql.toLowerCase().includes(lower) ||
      e.sql.toLowerCase().includes(`from ${lower}`) ||
      e.sql.toLowerCase().includes(`"${lower}"`),
  );
}

async function persist(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) return;
  try {
    const dir = vscode.Uri.joinPath(folder, '.sheetlab');
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      await vscode.workspace.fs.createDirectory(dir);
    }
    const uri = vscode.Uri.joinPath(dir, 'query-history.json');
    const payload = JSON.stringify({ version: 1, entries: memory }, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(payload, 'utf8'));
  } catch {
    /* non-fatal */
  }
}

export async function loadQueryHistoryFromDisk(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) return;
  try {
    const uri = vscode.Uri.joinPath(folder, '.sheetlab', 'query-history.json');
    const bytes = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(Buffer.from(bytes).toString('utf8')) as { entries?: QueryHistoryEntry[] };
    if (Array.isArray(data.entries)) {
      memory.length = 0;
      memory.push(...data.entries.slice(0, MAX));
    }
  } catch {
    /* ignore */
  }
}
