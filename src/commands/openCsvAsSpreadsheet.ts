import * as vscode from 'vscode';
import { CsvSpreadsheetEditorProvider } from '../editors/csvSpreadsheetEditor/csvEditorProvider';

function resolveCsvUri(uriArg?: vscode.Uri): vscode.Uri | undefined {
  if (uriArg) return uriArg;
  if (vscode.window.activeTextEditor?.document.uri) {
    return vscode.window.activeTextEditor.document.uri;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input as { uri?: vscode.Uri } | undefined;
  return input?.uri;
}

/**
 * Opens the CSV/TSV in SheetLab's **spreadsheet-only** view (grid, no text pane).
 * Always forces spreadsheet mode, even if the same file was previously opened as Preview.
 */
export function registerOpenCsvAsSpreadsheet(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.openCsvAsSpreadsheet', async (uriArg?: vscode.Uri) => {
    const uri = resolveCsvUri(uriArg);
    if (!uri) {
      void vscode.window.showWarningMessage('Open a CSV or TSV file first.');
      return;
    }
    await CsvSpreadsheetEditorProvider.openWithMode(uri, 'spreadsheet');
  });
}

/**
 * Opens the CSV/TSV with **side-by-side text + grid preview**.
 * Always forces preview mode, even if the same file was previously opened as Spreadsheet.
 */
export function registerOpenCsvAsPreview(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.openCsvAsPreview', async (uriArg?: vscode.Uri) => {
    const uri = resolveCsvUri(uriArg);
    if (!uri) {
      void vscode.window.showWarningMessage('Open a CSV or TSV file first.');
      return;
    }
    await CsvSpreadsheetEditorProvider.openWithMode(uri, 'split');
  });
}
