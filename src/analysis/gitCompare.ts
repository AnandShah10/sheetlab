/**
 * Compare the active workbook path to HEAD using a semantic snapshot.
 * Uses `git show` via child_process when available — no network.
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Workbook } from '../types/workbook';
import { createWorkbookSnapshot, diffSnapshots, SnapshotDiffEntry } from './snapshot';

const execFileAsync = promisify(execFile);

export async function compareWorkbookToHead(
  current: Workbook,
  filePath: string,
  loadFromBuffer: (buf: Buffer, path: string) => Promise<Workbook>,
): Promise<{ diffs: SnapshotDiffEntry[]; note: string } | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showWarningMessage('Open a workspace folder to compare with Git HEAD.');
    return undefined;
  }

  let relative = filePath;
  try {
    const { stdout: root } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: folder });
    const top = root.trim().replace(/\\/g, '/');
    const full = filePath.replace(/\\/g, '/');
    relative = full.startsWith(top) ? full.slice(top.length).replace(/^\//, '') : filePath;
  } catch {
    void vscode.window.showWarningMessage('Not a Git repository (or git is unavailable).');
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${relative}`], {
      cwd: folder,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    const headWb = await loadFromBuffer(Buffer.from(stdout), filePath);
    const a = createWorkbookSnapshot(headWb);
    const b = createWorkbookSnapshot(current);
    const diffs = diffSnapshots(a, b, 500);
    return {
      diffs,
      note: diffs.length ? `${diffs.length} semantic change(s) vs HEAD` : 'No semantic cell changes vs HEAD',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|exists on disk|pathspec/i.test(msg)) {
      return { diffs: [], note: 'File is not in HEAD (new or untracked).' };
    }
    void vscode.window.showErrorMessage(`Git compare failed: ${msg}`);
    return undefined;
  }
}
