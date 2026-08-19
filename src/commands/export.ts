import * as vscode from 'vscode';
import { Workbook } from '../types/workbook';
import { writeXlsxWorkbook } from '../excel/excelWriter';
import { serializeCsv, encodeCsv } from '../csv/csvWriter';
import { CsvDialect } from '../types/workbook';

const DEFAULT_CSV_DIALECT: CsvDialect = {
  delimiter: ',',
  quoteChar: '"',
  hasHeaderRow: true,
  lineEnding: '\n',
  encoding: 'utf8',
};

/**
 * Export the currently active workbook to XLSX. When the source was a CSV,
 * this is an explicit conversion -- per spec section 29 the user is told
 * plainly that a new XLSX file is being created, not that their CSV "became"
 * an Excel file.
 */
export function registerExportAsXlsx(_context: vscode.ExtensionContext, getActiveWorkbook: () => Workbook | undefined): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.exportAsXlsx', async () => {
    const workbook = getActiveWorkbook();
    if (!workbook) {
      void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
      return;
    }
    if (workbook.meta.sourceKind === 'csv' || workbook.meta.sourceKind === 'tsv') {
      const proceed = await vscode.window.showInformationMessage(
        'This creates a NEW .xlsx file from your CSV data. The original CSV file is not modified or converted.',
        'Continue',
        'Cancel',
      );
      if (proceed !== 'Continue') return;
    }

    const defaultUri = vscode.Uri.file(workbook.meta.sourcePath.replace(/\.[^.]+$/, '.xlsx'));
    const target = await vscode.window.showSaveDialog({ defaultUri, filters: { 'Excel Workbook': ['xlsx'] } });
    if (!target) return;

    try {
      const buffer = await writeXlsxWorkbook(workbook);
      await vscode.workspace.fs.writeFile(target, buffer);
      void vscode.window.showInformationMessage(`Exported to ${target.fsPath}`);
    } catch (err) {
      void vscode.window.showErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/**
 * Export to CSV. When the source is a multi-sheet XLSX, only the active
 * sheet is exported -- per spec section 29 the user is told that worksheets,
 * formatting, formulas, and other workbook metadata cannot be represented in
 * a single CSV.
 */
export function registerExportAsCsv(
  _context: vscode.ExtensionContext,
  getActiveWorkbookAndSheet: () => { workbook: Workbook; sheetName: string } | undefined,
): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.exportAsCsv', async () => {
    const active = getActiveWorkbookAndSheet();
    if (!active) {
      void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
      return;
    }
    const { workbook, sheetName } = active;
    if (workbook.meta.sheetOrder.length > 1) {
      const proceed = await vscode.window.showInformationMessage(
        `This workbook has ${workbook.meta.sheetOrder.length} worksheets. CSV can only hold one sheet -- only ` +
          `"${sheetName}" will be exported, and formatting, formulas, and other workbook metadata will be lost.`,
        'Continue',
        'Cancel',
      );
      if (proceed !== 'Continue') return;
    }

    const defaultUri = vscode.Uri.file(workbook.meta.sourcePath.replace(/\.[^.]+$/, '.csv'));
    const target = await vscode.window.showSaveDialog({ defaultUri, filters: { 'CSV': ['csv'] } });
    if (!target) return;

    const sheet = workbook.sheets[sheetName];
    const dialect = workbook.meta.csvDialect ?? DEFAULT_CSV_DIALECT;
    const text = serializeCsv(sheet, dialect);
    await vscode.workspace.fs.writeFile(target, encodeCsv(text, dialect));
    void vscode.window.showInformationMessage(`Exported to ${target.fsPath}`);
  });
}