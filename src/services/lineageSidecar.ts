/**
 * Persist per-sheet lineage next to the workbook as `.sheetlab/lineage/<basename>.json`.
 * Survives reload even though XLSX custom XML is not written yet.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Workbook } from '../types/workbook';

export async function writeLineageSidecar(workbook: Workbook): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder || !workbook.meta.sourcePath) return;

  const entries: Record<string, NonNullable<(typeof workbook.sheets)[string]['lineage']>> = {};
  for (const [name, sheet] of Object.entries(workbook.sheets)) {
    if (sheet.lineage) entries[name] = sheet.lineage;
  }
  if (!Object.keys(entries).length) return;

  try {
    const dir = vscode.Uri.joinPath(folder, '.sheetlab', 'lineage');
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      await vscode.workspace.fs.createDirectory(dir);
    }
    const base = path.basename(workbook.meta.sourcePath).replace(/\.[^.]+$/, '');
    const uri = vscode.Uri.joinPath(dir, `${base}.json`);
    const payload = JSON.stringify(
      {
        version: 1,
        sourcePath: workbook.meta.sourcePath,
        updatedAt: new Date().toISOString(),
        sheets: entries,
      },
      null,
      2,
    );
    await vscode.workspace.fs.writeFile(uri, Buffer.from(payload, 'utf8'));
  } catch {
    /* non-fatal */
  }
}

export async function loadLineageSidecar(workbook: Workbook): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder || !workbook.meta.sourcePath) return;
  try {
    const base = path.basename(workbook.meta.sourcePath).replace(/\.[^.]+$/, '');
    const uri = vscode.Uri.joinPath(folder, '.sheetlab', 'lineage', `${base}.json`);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
      sheets?: Record<string, NonNullable<(typeof workbook.sheets)[string]['lineage']>>;
    };
    if (!data.sheets) return;
    for (const [name, lin] of Object.entries(data.sheets)) {
      if (workbook.sheets[name] && lin) {
        workbook.sheets[name].lineage = lin;
      }
    }
  } catch {
    /* ignore missing */
  }
}
