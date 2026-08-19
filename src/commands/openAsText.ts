import * as vscode from 'vscode';

/**
 * Returns the current CSV/TSV to VS Code's normal text editor. Because the
 * spreadsheet editor is backed by the same TextDocument (see
 * csvDocumentSync.ts), whatever was on-disk (or unsaved-but-applied via
 * WorkspaceEdit) is exactly what the text editor will show -- there is no
 * separate "spreadsheet copy" to reconcile.
 */
export function registerOpenAsText(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.openAsText', async (uriArg?: vscode.Uri) => {
    const uri = uriArg ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) return;
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
  });
}
