import * as vscode from 'vscode';
import { ExcelEditorProvider } from './editors/excelCustomEditor/excelEditorProvider';
import { CsvSpreadsheetEditorProvider } from './editors/csvSpreadsheetEditor/csvEditorProvider';
import { registerOpenCsvAsSpreadsheet } from './commands/openCsvAsSpreadsheet';
import { registerOpenAsText } from './commands/openAsText';
import { registerRefreshSpreadsheet } from './commands/refreshSpreadsheet';
import { registerSaveSpreadsheet } from './commands/save';
import { registerExportAsXlsx, registerExportAsCsv } from './commands/export';
import { registerUiCommands } from './commands/uiCommands';
import { activePanelRegistry } from './services/activePanelRegistry';

/**
 * Activation is intentionally lightweight: `activationEvents` in
 * package.json only fires on `onLanguage:csv` / `onLanguage:tsv` (Custom
 * Editor `viewType` contributions activate the extension automatically for
 * their own selectors, so .xlsx/.xlsm/.xls don't need an explicit
 * activation event). We do NOT do any eager file scanning, workspace
 * indexing, or network calls here or anywhere else in the extension --
 * see spec section 39 (privacy) and section 38 (security).
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    ExcelEditorProvider.register(context),
    CsvSpreadsheetEditorProvider.register(context),
    registerOpenCsvAsSpreadsheet(context),
    registerOpenAsText(context),
    registerRefreshSpreadsheet(context),
    registerSaveSpreadsheet(context),
    registerExportAsXlsx(context, () => activePanelRegistry.getActiveWorkbook()),
    registerExportAsCsv(context, () => activePanelRegistry.getActiveWorkbookAndSheet()),
    ...registerUiCommands(context),
  );
}

export function deactivate(): void {
  // Editor providers and their per-document watchers are cleaned up via
  // context.subscriptions and each CustomDocument's `dispose()`; nothing
  // else to tear down here.
}
