import * as vscode from 'vscode';

export interface SavedQuery {
  version: number;
  name: string;
  description?: string;
  sql: string;
  updatedAt: string;
}

function queriesDir(folder: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(folder, '.sheetlab', 'queries');
}

async function ensureDir(folder: vscode.Uri): Promise<vscode.Uri> {
  const dir = queriesDir(folder);
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, '.sheetlab'));
  } catch {
    /* */
  }
  try {
    await vscode.workspace.fs.createDirectory(dir);
  } catch {
    /* */
  }
  return dir;
}

export async function saveQuery(query: SavedQuery, folder?: vscode.Uri): Promise<vscode.Uri | undefined> {
  const root = folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showWarningMessage('Open a workspace folder to save queries.');
    return undefined;
  }
  const dir = await ensureDir(root);
  const safe = query.name.replace(/[^\w.-]+/g, '_').toLowerCase() || 'query';
  const target = vscode.Uri.joinPath(dir, `${safe}.json`);
  const body = JSON.stringify({ ...query, version: 1, updatedAt: new Date().toISOString() }, null, 2);
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
  return target;
}

export async function listQueries(folder?: vscode.Uri): Promise<Array<{ name: string; uri: vscode.Uri }>> {
  const root = folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(queriesDir(root));
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.json'))
      .map(([name]) => ({ name: name.replace(/\.json$/i, ''), uri: vscode.Uri.joinPath(queriesDir(root), name) }));
  } catch {
    return [];
  }
}

export async function loadQuery(uri: vscode.Uri): Promise<SavedQuery> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as SavedQuery;
}
