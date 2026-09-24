/**
 * Persist pipelines under `.sheetlab/pipelines/` in the workspace (opt-in by use).
 */

import * as vscode from 'vscode';
import { TransformationPipeline, PIPELINE_FORMAT_VERSION } from './types';

function pipelinesDir(workspaceFolder: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(workspaceFolder, '.sheetlab', 'pipelines');
}

export async function ensurePipelinesDir(folder: vscode.Uri): Promise<vscode.Uri> {
  const dir = pipelinesDir(folder);
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, '.sheetlab'));
  } catch {
    /* exists */
  }
  try {
    await vscode.workspace.fs.createDirectory(dir);
  } catch {
    /* exists */
  }
  return dir;
}

export async function savePipeline(pipeline: TransformationPipeline, folder?: vscode.Uri): Promise<vscode.Uri | undefined> {
  const root = folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showWarningMessage('Open a workspace folder to save pipelines.');
    return undefined;
  }
  const dir = await ensurePipelinesDir(root);
  const safe = pipeline.name.replace(/[^\w.-]+/g, '_').toLowerCase() || 'pipeline';
  const target = vscode.Uri.joinPath(dir, `${safe}.json`);
  const body = JSON.stringify(
    { ...pipeline, version: PIPELINE_FORMAT_VERSION, updatedAt: new Date().toISOString() },
    null,
    2,
  );
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
  return target;
}

export async function listPipelines(folder?: vscode.Uri): Promise<Array<{ name: string; uri: vscode.Uri }>> {
  const root = folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return [];
  const dir = pipelinesDir(root);
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.json'))
      .map(([name]) => ({ name: name.replace(/\.json$/i, ''), uri: vscode.Uri.joinPath(dir, name) }));
  } catch {
    return [];
  }
}

export async function loadPipeline(uri: vscode.Uri): Promise<TransformationPipeline> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as TransformationPipeline;
}
