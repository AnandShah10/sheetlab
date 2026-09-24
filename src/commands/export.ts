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
/** Prompt the user for an export format and dispatch the matching command. */
export function registerExportWorkbook(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.exportWorkbook', async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Excel Workbook (.xlsx)', format: 'xlsx' },
        { label: 'Macro-enabled Excel (.xlsm)', format: 'xlsm' },
        { label: 'Legacy Excel (.xls)', format: 'xls' },
        { label: 'OpenDocument Spreadsheet (.ods)', format: 'ods' },
        { label: 'CSV (.csv)', format: 'csv' },
        { label: 'TSV (.tsv)', format: 'tsv' },
      ],
      { placeHolder: 'Export as…' },
    );
    if (!pick) return;
    const map: Record<string, string> = {
      xlsx: 'sheetlab.exportAsXlsx',
      xlsm: 'sheetlab.exportAsXlsm',
      xls: 'sheetlab.exportAsXls',
      ods: 'sheetlab.exportAsOds',
      csv: 'sheetlab.exportAsCsv',
      tsv: 'sheetlab.exportAsTsv',
    };
    await vscode.commands.executeCommand(map[pick.format]);
  });
}

export function registerExportAsTsv(
  _context: vscode.ExtensionContext,
  getActiveWorkbookAndSheet: () => { workbook: Workbook; sheetName: string } | undefined,
): vscode.Disposable {
  return vscode.commands.registerCommand('sheetlab.exportAsTsv', async () => {
    const active = getActiveWorkbookAndSheet();
    if (!active) {
      void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
      return;
    }
    const { workbook, sheetName } = active;
    const defaultUri = vscode.Uri.file(workbook.meta.sourcePath.replace(/\.[^.]+$/, '.tsv'));
    const target = await vscode.window.showSaveDialog({ defaultUri, filters: { TSV: ['tsv'] } });
    if (!target) return;
    const sheet = workbook.sheets[sheetName];
    const dialect = { ...(workbook.meta.csvDialect ?? DEFAULT_CSV_DIALECT), delimiter: '\t' };
    const text = serializeCsv(sheet, dialect);
    await vscode.workspace.fs.writeFile(target, encodeCsv(text, dialect));
    void vscode.window.showInformationMessage(`Exported to ${target.fsPath}`);
  });
}

/** ODS / XLS / XLSM export via SheetJS (xlsx package already a dependency). */
export function registerSheetJsExports(
  _context: vscode.ExtensionContext,
  getActiveWorkbook: () => Workbook | undefined,
): vscode.Disposable[] {
  const formats: Array<{ cmd: string; ext: string; bookType: string; filter: string }> = [
    { cmd: 'sheetlab.exportAsOds', ext: 'ods', bookType: 'ods', filter: 'OpenDocument Spreadsheet' },
    { cmd: 'sheetlab.exportAsXls', ext: 'xls', bookType: 'xls', filter: 'Excel 97-2003' },
    { cmd: 'sheetlab.exportAsXlsm', ext: 'xlsm', bookType: 'xlsm', filter: 'Excel Macro-Enabled' },
  ];
  return formats.map(({ cmd, ext, bookType, filter }) =>
    vscode.commands.registerCommand(cmd, async () => {
      const workbook = getActiveWorkbook();
      if (!workbook) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      const defaultUri = vscode.Uri.file(workbook.meta.sourcePath.replace(/\.[^.]+$/, `.${ext}`));
      const target = await vscode.window.showSaveDialog({ defaultUri, filters: { [filter]: [ext] } });
      if (!target) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const XLSX = require('xlsx') as typeof import('xlsx');
        const wb = XLSX.utils.book_new();
        for (const name of workbook.meta.sheetOrder) {
          const sheet = workbook.sheets[name];
          if (!sheet) continue;
          const aoa: (string | number | boolean | null)[][] = [];
          const maxR = Math.max(0, sheet.rowCount - 1);
          const maxC = Math.max(0, sheet.colCount - 1);
          for (let r = 0; r <= maxR; r++) {
            const line: (string | number | boolean | null)[] = [];
            for (let c = 0; c <= maxC; c++) {
              const cell = sheet.rows[r]?.[c];
              if (!cell || cell.type === 'blank') line.push(null);
              else if (cell.type === 'formula') line.push(cell.raw);
              else line.push(cell.value as string | number | boolean | null);
            }
            aoa.push(line);
          }
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
        }
        const out = XLSX.write(wb, { bookType: bookType as import('xlsx').BookType, type: 'buffer' }) as Buffer;
        await vscode.workspace.fs.writeFile(target, out);
        void vscode.window.showInformationMessage(`Exported to ${target.fsPath}`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}
