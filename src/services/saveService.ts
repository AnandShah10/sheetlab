import * as vscode from 'vscode';
import { Workbook } from '../types/workbook';
import { writeXlsxWorkbook } from '../excel/excelWriter';
import { confirmXlsmSaveIfNeeded } from '../excel/xlsmHandler';

/**
 * Writes an Excel workbook back to disk "atomically": we write the new
 * content to a sibling temp file first, then use `vscode.workspace.fs.rename`
 * (with overwrite) to move it over the original in one filesystem operation.
 */
export async function saveExcelWorkbook(workbook: Workbook, targetUri: vscode.Uri): Promise<boolean> {
  const proceed = await confirmXlsmSaveIfNeeded(workbook);
  if (!proceed) return false;

  let buffer: Buffer;
  try {
    buffer = await buildSaveBuffer(workbook, targetUri);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `SheetLab could not build the workbook to save: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  const tempUri = targetUri.with({ path: `${targetUri.path}.sheetlab-tmp-${Date.now()}` });

  try {
    await vscode.workspace.fs.writeFile(tempUri, buffer);
    await vscode.workspace.fs.rename(tempUri, targetUri, { overwrite: true });
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `SheetLab failed to save "${targetUri.fsPath}": ${err instanceof Error ? err.message : String(err)}. ` +
        'The original file was not modified.',
    );
    try {
      await vscode.workspace.fs.delete(tempUri);
    } catch {
      /* best effort cleanup */
    }
    return false;
  }
}

async function buildSaveBuffer(workbook: Workbook, targetUri: vscode.Uri): Promise<Buffer> {
  const pathLower = targetUri.fsPath.toLowerCase();
  const kind = workbook.meta.sourceKind;

  // Prefer the destination extension when Save As was used.
  if (pathLower.endsWith('.ods') || kind === 'ods') {
    return writeViaSheetJs(workbook, 'ods');
  }
  if (pathLower.endsWith('.xls') || kind === 'xls') {
    return writeViaSheetJs(workbook, 'xls');
  }
  if (pathLower.endsWith('.xlsm') || kind === 'xlsm') {
    // Prefer ExcelJS path which preserves more structure when possible.
    try {
      return await writeXlsxWorkbook(workbook);
    } catch {
      return writeViaSheetJs(workbook, 'xlsm');
    }
  }
  return writeXlsxWorkbook(workbook);
}

function writeViaSheetJs(workbook: Workbook, bookType: 'ods' | 'xls' | 'xlsm' | 'xlsx'): Buffer {
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
  return XLSX.write(wb, { bookType: bookType as import('xlsx').BookType, type: 'buffer' }) as Buffer;
}
