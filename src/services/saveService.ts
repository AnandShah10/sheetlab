import * as vscode from 'vscode';
import { Workbook } from '../types/workbook';
import { writeXlsxWorkbook } from '../excel/excelWriter';
import { confirmXlsmSaveIfNeeded } from '../excel/xlsmHandler';

/**
 * Writes an Excel workbook back to disk "atomically": we write the new
 * content to a sibling temp file first, then use `vscode.workspace.fs.rename`
 * (with overwrite) to move it over the original in one filesystem operation.
 * We use the `vscode.workspace.fs` API rather than Node's `fs` module
 * specifically so this also works against virtual/remote filesystems (SSH,
 * WSL, virtual workspaces) that VS Code supports but Node's `fs` cannot see.
 * A crash or process kill mid-write leaves either the old file or the fully
 * written new file — never a half-written one. If the write fails, the
 * original file is left untouched and the error is surfaced via a VS Code
 * notification rather than swallowed.
 */
export async function saveExcelWorkbook(workbook: Workbook, targetUri: vscode.Uri): Promise<boolean> {
  const proceed = await confirmXlsmSaveIfNeeded(workbook);
  if (!proceed) return false;

  let buffer: Buffer;
  try {
    buffer = await writeXlsxWorkbook(workbook);
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
