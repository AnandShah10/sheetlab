import * as vscode from 'vscode';
import { CsvSpreadsheetEditorProvider } from '../editors/csvSpreadsheetEditor/csvEditorProvider';

/**
 * Opens the CSV/TSV in SheetLab's **spreadsheet-only** custom editor (grid, no text pane).
 */
export function registerOpenCsvAsSpreadsheet(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.openCsvAsSpreadsheet', async (uriArg?: vscode.Uri) => {
    const uri = uriArg ?? vscode.window.activeTextEditor?.document.uri ?? vscode.window.activeTextEditor?.document?.uri;
    const fallback = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    let resolved = uriArg;
    if (!resolved) {
      resolved = vscode.window.activeTextEditor?.document.uri;
    }
    if (!resolved) {
      // Active custom editor / other tab
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const input = tab?.input as { uri?: vscode.Uri } | undefined;
      resolved = input?.uri;
    }
    if (!resolved) {
      void vscode.window.showWarningMessage('Open a CSV or TSV file first.');
      return;
    }
    CsvSpreadsheetEditorProvider.setPendingViewMode('spreadsheet');
    await vscode.commands.executeCommand('vscode.openWith', resolved, CsvSpreadsheetEditorProvider.viewType);
  });
}

/**
 * Opens the CSV/TSV in SheetLab with **side-by-side text + grid preview**.
 * Separate from "Open as Spreadsheet" so users pick preview vs grid explicitly.
 */
export function registerOpenCsvAsPreview(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.openCsvAsPreview', async (uriArg?: vscode.Uri) => {
    let resolved = uriArg ?? vscode.window.activeTextEditor?.document.uri;
    if (!resolved) {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const input = tab?.input as { uri?: vscode.Uri } | undefined;
      resolved = input?.uri;
    }
    if (!resolved) {
      void vscode.window.showWarningMessage('Open a CSV or TSV file first.');
      return;
    }
    CsvSpreadsheetEditorProvider.setPendingViewMode('split');
    await vscode.commands.executeCommand('vscode.openWith', resolved, CsvSpreadsheetEditorProvider.viewType);
  });
}
