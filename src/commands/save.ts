import * as vscode from 'vscode';

export function registerSaveSpreadsheet(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.saveSpreadsheet', async () => {
    await vscode.commands.executeCommand('workbench.action.files.save');
  });
}
