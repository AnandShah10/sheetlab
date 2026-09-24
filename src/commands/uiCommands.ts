import * as vscode from 'vscode';
import { activePanelRegistry } from '../services/activePanelRegistry';
import { UiCommand } from '../types/workbook';

/**
 * Thin Command Palette / keybinding entry points that just forward to
 * whichever SheetLab panel currently has focus. If no SheetLab editor is
 * active, we tell the user rather than failing silently.
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
    ['sheetlab.exportWorkbook', 'openExport'],
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
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
      }
    }),
  );
}
