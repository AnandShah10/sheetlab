/**
 * Compare workbook working tree (or in-memory dirty buffer) to Git HEAD.
 * Prefer disk for “git-like” diffs; fall back to in-memory when dirty.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Workbook } from '../types/workbook';
import { createWorkbookSnapshot, diffSnapshots, SnapshotDiffEntry } from './snapshot';

const execFileAsync = promisify(execFile);

export interface CompareResult {
  diffs: SnapshotDiffEntry[];
  note: string;
  /** Absolute path used as the “after” side */
  filePath: string;
  relativePath?: string;
  repoRoot?: string;
}

export async function compareWorkbookToHead(
  current: Workbook,
  filePath: string,
  loadFromBuffer: (buf: Buffer, path: string) => Promise<Workbook>,
  options?: { preferMemory?: boolean },
): Promise<CompareResult | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showWarningMessage('Open a workspace folder to compare with Git HEAD.');
    return undefined;
  }

  let relative = filePath;
  let repoRoot = folder;
  try {
    const { stdout: root } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: folder });
    repoRoot = root.trim();
    const top = repoRoot.replace(/\\/g, '/');
    const full = filePath.replace(/\\/g, '/');
    relative = full.startsWith(top) ? full.slice(top.length).replace(/^\//, '') : filePath;
  } catch {
    void vscode.window.showWarningMessage('Not a Git repository (or git is unavailable).');
    return undefined;
  }

  let headBuf: Buffer;
  try {
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${relative}`], {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    headBuf = Buffer.from(stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|exists on disk|pathspec|bad revision/i.test(msg)) {
      return {
        diffs: [],
        note: 'File is not in HEAD (new or untracked).',
        filePath,
        relativePath: relative,
        repoRoot,
      };
    }
    void vscode.window.showErrorMessage(`Git compare failed: ${msg}`);
    return undefined;
  }

  // “After” side: disk working tree matches VS Code’s git diff unless preferMemory
  let afterWb: Workbook;
  try {
    if (options?.preferMemory) {
      afterWb = current;
    } else {
      const diskBuf = await fs.promises.readFile(filePath);
      afterWb = await loadFromBuffer(diskBuf, filePath);
    }
  } catch {
    afterWb = current;
  }

  const headWb = await loadFromBuffer(headBuf, filePath);
  // HEAD = before (a), working tree = after (b)
  const a = createWorkbookSnapshot(headWb);
  const b = createWorkbookSnapshot(afterWb);
  const diffs = diffSnapshots(a, b, 2000);
  return {
    diffs,
    note: diffs.length
      ? `${diffs.length} cell change(s) vs HEAD (working tree)`
      : 'No semantic cell changes vs HEAD',
    filePath,
    relativePath: relative,
    repoRoot,
  };
}

/** Open VS Code’s native side-by-side diff (HEAD on left, working tree on right). */
export async function openNativeGitDiff(filePath: string): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  try {
    await vscode.commands.executeCommand('git.openChange', uri);
    return;
  } catch {
    /* fall through */
  }

  // Fallback: materialize HEAD content into a virtual document
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showWarningMessage('Open a workspace folder for Git diff.');
    return;
  }
  try {
    const { stdout: root } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: folder });
    const top = root.trim().replace(/\\/g, '/');
    const full = filePath.replace(/\\/g, '/');
    const relative = full.startsWith(top) ? full.slice(top.length).replace(/^\//, '') : path.basename(filePath);
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${relative}`], {
      cwd: root.trim(),
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    const left = uri.with({ scheme: 'untitled', path: `HEAD/${path.basename(filePath)}` });
    // Use vscode.diff with a temp file for left content
    const tmp = path.join(
      require('os').tmpdir(),
      `sheetlab-head-${path.basename(filePath)}`,
    );
    await fs.promises.writeFile(tmp, Buffer.from(stdout));
    const leftUri = vscode.Uri.file(tmp);
    await vscode.commands.executeCommand(
      'vscode.diff',
      leftUri,
      uri,
      `HEAD ↔ ${path.basename(filePath)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Could not open VS Code diff: ${msg}`);
  }
}
