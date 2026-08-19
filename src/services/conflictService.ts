import * as vscode from 'vscode';

/**
 * Excel Custom Editors are backed by a `CustomDocument`, not a
 * `TextDocument`, so unlike CSV (see csvDocumentSync.ts) VS Code does not
 * automatically detect external modifications for us — we watch the file
 * ourselves and compare mtimes.
 */
export class ExcelConflictWatcher implements vscode.Disposable {
  private lastKnownMtime: number;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onExternalChange = this.changeEmitter.event;
  private suppressNext = false;

  constructor(
    private readonly uri: vscode.Uri,
    initialMtime: number,
  ) {
    this.lastKnownMtime = initialMtime;
    this.watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);
    this.watcher.onDidChange(() => this.handleFsEvent());
  }

  private async handleFsEvent(): Promise<void> {
    if (this.suppressNext) {
      this.suppressNext = false;
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(this.uri);
      if (stat.mtime !== this.lastKnownMtime) {
        this.lastKnownMtime = stat.mtime;
        this.changeEmitter.fire();
      }
    } catch {
      // File may have been deleted; ignore — VS Code surfaces that separately.
    }
  }

  /** Call right before SheetLab itself writes the file, so our own write isn't reported as "external". */
  notifyOwnWritePending(): void {
    this.suppressNext = true;
  }

  async refreshKnownMtime(): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(this.uri);
      this.lastKnownMtime = stat.mtime;
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    this.watcher.dispose();
    this.changeEmitter.dispose();
  }
}

/**
 * Prompts the user when we detect the underlying file changed outside
 * SheetLab while it has unsaved edits open. We never silently pick a side.
 */
export async function promptExternalChange(dirty: boolean): Promise<'reload' | 'keepMine' | 'cancel'> {
  if (!dirty) {
    const choice = await vscode.window.showInformationMessage(
      'This file changed on disk. Reload it in SheetLab?',
      'Reload',
      'Ignore',
    );
    return choice === 'Reload' ? 'reload' : 'cancel';
  }

  const choice = await vscode.window.showWarningMessage(
    'This file changed on disk, and you have unsaved changes in SheetLab. Reloading will discard your edits.',
    { modal: true },
    'Reload (discard my changes)',
    'Keep My Changes',
  );
  if (choice === 'Reload (discard my changes)') return 'reload';
  if (choice === 'Keep My Changes') return 'keepMine';
  return 'cancel';
}
