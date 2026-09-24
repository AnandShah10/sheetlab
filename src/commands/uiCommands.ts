import * as vscode from 'vscode';
import { activePanelRegistry } from '../services/activePanelRegistry';
import { UiCommand } from '../types/workbook';

/**
 * Command Palette / keybinding entry points that forward to the last focused
 * SheetLab webview via the uiCommand protocol.
 *
 * Do NOT register command IDs that are already registered elsewhere
 * (e.g. sheetlab.exportWorkbook is owned by commands/export.ts).
 * A duplicate registerCommand throws and aborts the rest of activate(),
 * which is what made Trace/Lint/Profile appear as "command not found".
 */
export function registerUiCommands(_context: vscode.ExtensionContext): vscode.Disposable[] {
  const bindings: Array<[string, UiCommand]> = [
    ['sheetlab.searchWorkbook', 'openSearch'],
    ['sheetlab.runQuery', 'openQuery'],
    ['sheetlab.goToCell', 'openGoToCell'],
    ['sheetlab.cleanData', 'openCleanData'],
    ['sheetlab.newWorksheet', 'openNewWorksheetPrompt'],
    ['sheetlab.toggleFormulaBar', 'toggleFormulaBar'],
    ['sheetlab.toggleGridlines', 'toggleGridlines'],
    ['sheetlab.freezePanes', 'freezePanesAtSelection'],
    ['sheetlab.unfreezePanes', 'unfreezePanes'],
    // Analysis (must stay after freeze; never share IDs with export.ts)
    ['sheetlab.tracePrecedents', 'tracePrecedents'],
    ['sheetlab.traceDependents', 'traceDependents'],
    ['sheetlab.runLinter', 'runLinter'],
    ['sheetlab.analyzeWorkbook', 'runProfile'],
    ['sheetlab.explainCell', 'explainCell'],
    ['sheetlab.showProblems', 'runLinter'],
  ];

  return bindings.map(([commandId, uiCommand]) =>
    vscode.commands.registerCommand(commandId, () => {
      const handled = activePanelRegistry.send(uiCommand);
      if (!handled) {
        void vscode.window.showWarningMessage(
          'Open a spreadsheet in SheetLab first, then run this command again.',
        );
      }
    }),
  );
}
