import * as vscode from 'vscode';
import { CsvSpreadsheetEditorProvider } from '../editors/csvSpreadsheetEditor/csvEditorProvider';

/**
 * Opens the SAME file that's currently in the plain text editor using
 * SheetLab's CSV spreadsheet Custom Editor. This is the one explicit action
 * that switches a CSV out of "normal text file" mode -- nothing else does.
 */
export function registerOpenCsvAsSpreadsheet(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.openCsvAsSpreadsheet', async (uriArg?: vscode.Uri) => {
    const uri = uriArg ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      void vscode.window.showWarningMessage('Open a CSV or TSV file first.');
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, CsvSpreadsheetEditorProvider.viewType);
  });
}
