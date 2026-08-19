import * as vscode from 'vscode';

export function registerRefreshSpreadsheet(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.refreshSpreadsheet', async () => {
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
  });
}
