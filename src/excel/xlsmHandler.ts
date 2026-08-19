import * as vscode from 'vscode';
import { Workbook } from '../types/workbook';

/**
 * ExcelJS cannot guarantee round-tripping a VBA project binary through its
 * writer. Per spec section 30, we treat that as a data-integrity issue, not
 * a feature gap: we never call the writer on an .xlsm workbook that
 * originally had macros without an explicit, informed confirmation from the
 * user, and we never overwrite the original file in place without that
 * confirmation — the caller is expected to write to a temp path first and
 * only replace the original after the user agrees.
 */
export async function confirmXlsmSaveIfNeeded(workbook: Workbook): Promise<boolean> {
  if (workbook.meta.sourceKind !== 'xlsm') return true;

  const hasVbaWarning = workbook.meta.unsupportedFeatures?.some((f) => f.includes('VBA project'));
  if (!hasVbaWarning) return true;

  const choice = await vscode.window.showWarningMessage(
    'This XLSM workbook contains a VBA project (macros). SheetLab cannot guarantee macros will be preserved ' +
      'when saving. Saving now may remove or corrupt the VBA project while keeping your cell data intact.',
    { modal: true },
    'Save Anyway (cell data only)',
    'Cancel',
  );

  return choice === 'Save Anyway (cell data only)';
}
