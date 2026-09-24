import * as vscode from 'vscode';
import { ExcelEditorProvider } from './editors/excelCustomEditor/excelEditorProvider';
import { CsvSpreadsheetEditorProvider } from './editors/csvSpreadsheetEditor/csvEditorProvider';
import { registerOpenCsvAsSpreadsheet, registerOpenCsvAsPreview } from './commands/openCsvAsSpreadsheet';
import { registerOpenAsText } from './commands/openAsText';
import { registerRefreshSpreadsheet } from './commands/refreshSpreadsheet';
import { registerSaveSpreadsheet } from './commands/save';
import {
  registerExportAsXlsx,
  registerExportAsCsv,
  registerExportAsTsv,
  registerExportWorkbook,
  registerSheetJsExports,
} from './commands/export';
import { registerUiCommands } from './commands/uiCommands';
import { activePanelRegistry } from './services/activePanelRegistry';

/**
 * Activation is lightweight: custom editors + commands only.
 * No eager file scanning, network, or telemetry.
 */
export function activate(context: vscode.ExtensionContext): void {
  const push = (...items: Array<vscode.Disposable | vscode.Disposable[]>) => {
    for (const item of items) {
      if (Array.isArray(item)) context.subscriptions.push(...item);
      else context.subscriptions.push(item);
    }
  };

  try {
    push(
      ExcelEditorProvider.register(context),
      CsvSpreadsheetEditorProvider.register(context),
      registerOpenCsvAsSpreadsheet(context),
      registerOpenCsvAsPreview(context),
      registerOpenAsText(context),
      registerRefreshSpreadsheet(context),
      registerSaveSpreadsheet(context),
      registerExportAsXlsx(context, () => activePanelRegistry.getActiveWorkbook()),
      registerExportAsCsv(context, () => activePanelRegistry.getActiveWorkbookAndSheet()),
      registerExportAsTsv(context, () => activePanelRegistry.getActiveWorkbookAndSheet()),
      registerExportWorkbook(context),
      ...registerSheetJsExports(context, () => activePanelRegistry.getActiveWorkbook()),
    );
  } catch (err) {
    console.error('[SheetLab] Failed to register editors/export commands', err);
    void vscode.window.showErrorMessage(
      `SheetLab failed to activate core commands: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    push(...registerUiCommands(context));
  } catch (err) {
    console.error('[SheetLab] Failed to register UI commands', err);
    void vscode.window.showErrorMessage(
      `SheetLab failed to register UI commands: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function deactivate(): void {
  // Subscriptions dispose automatically.
}
