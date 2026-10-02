/**
 * Lightweight Git helpers for the active workbook file.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export interface FileGitStatus {
  /** True when working tree differs from the index or HEAD for this file. */
  unstaged: boolean;
  /** True when the file is staged differently from HEAD. */
  staged: boolean;
  /** Relative path from repo root, if inside a git work tree. */
  relativePath?: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export async function getFileGitStatus(filePath: string): Promise<FileGitStatus> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder || !filePath) {
    return { unstaged: false, staged: false };
  }

  try {
    const { stdout: rootOut } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: folder,
    });
    const root = toPosix(rootOut.trim());
    const full = toPosix(path.resolve(filePath));
    if (!full.startsWith(root)) {
      return { unstaged: false, staged: false };
    }
    let relative = full.slice(root.length).replace(/^\//, '');

    // porcelain v1: XY PATH
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', relative], {
      cwd: root,
    });
    const line = stdout.split('\n').find((l) => l.trim().length > 0);
    if (!line) {
      return { unstaged: false, staged: false, relativePath: relative };
    }
    // First char = staged, second = unstaged (working tree)
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    const staged = x !== ' ' && x !== '?';
    const unstaged = y !== ' ' || x === '?' || y === '?';
    // Untracked: ?? — treat as "has local changes worth reviewing"
    const untracked = line.startsWith('??');
    return {
      unstaged: unstaged || untracked,
      staged: staged && !untracked,
      relativePath: relative,
    };
  } catch {
    return { unstaged: false, staged: false };
  }
}
