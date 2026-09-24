import * as vscode from 'vscode';
import { activePanelRegistry } from '../services/activePanelRegistry';
import { buildSymbolIndex, WorkbookSymbol } from '../analysis/symbols';
import { createWorkbookSnapshot, diffSnapshots } from '../analysis/snapshot';
import { toA1 } from '../utils/cellRef';
import { AnalysisService } from '../services/analysisService';

export function registerAnalysisCommands(_context: vscode.ExtensionContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('sheetlab.goToSymbol', async () => {
      const wb = activePanelRegistry.getActiveWorkbook();
      if (!wb) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      const symbols = buildSymbolIndex(wb);
      const pick = await vscode.window.showQuickPick(
        symbols.map((s) => ({
          label: s.name,
          description: s.kind,
          detail: s.detail,
          symbol: s,
        })),
        {
          placeHolder: 'Go to sheet, table, named range, or formula…',
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );
      if (!pick) return;
      goTo(pick.symbol);
    }),

    vscode.commands.registerCommand('sheetlab.peekCell', async () => {
      const pair = activePanelRegistry.getActiveWorkbookAndSheet();
      if (!pair) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      const ref = await vscode.window.showInputBox({
        prompt: 'Peek cell (e.g. B12 or Sheet2!A1)',
        placeHolder: 'A1',
      });
      if (!ref) return;
      const parsed = parseSheetRef(ref.trim(), pair.sheetName);
      if (!parsed) {
        void vscode.window.showWarningMessage(`Could not parse reference "${ref}"`);
        return;
      }
      const sheet = pair.workbook.sheets[parsed.sheetName];
      const cell = sheet?.rows[parsed.row]?.[parsed.col];
      const a1 = toA1(parsed.row, parsed.col);
      const lines = [
        `Sheet: ${parsed.sheetName}`,
        `Cell: ${a1}`,
        `Type: ${cell?.type ?? 'blank'}`,
        `Value: ${cell?.value ?? '(empty)'}`,
      ];
      if (cell?.formula) lines.push(`Formula: =${cell.formula}`);
      if (cell?.error) lines.push(`Error: ${cell.error.code}`);

      const choice = await vscode.window.showInformationMessage(lines.join(' · '), 'Open', 'Precedents', 'Dependents');
      if (choice === 'Open') {
        activePanelRegistry.navigateToCell(parsed.sheetName, parsed.row, parsed.col);
      } else if (choice === 'Precedents') {
        activePanelRegistry.navigateToCell(parsed.sheetName, parsed.row, parsed.col);
        setTimeout(() => activePanelRegistry.send('tracePrecedents'), 80);
      } else if (choice === 'Dependents') {
        activePanelRegistry.navigateToCell(parsed.sheetName, parsed.row, parsed.col);
        setTimeout(() => activePanelRegistry.send('traceDependents'), 80);
      }
    }),

    vscode.commands.registerCommand('sheetlab.compareSnapshots', async () => {
      const wb = activePanelRegistry.getActiveWorkbook();
      if (!wb) {
        void vscode.window.showWarningMessage('Open a spreadsheet in SheetLab first.');
        return;
      }
      const snap = createWorkbookSnapshot(wb);
      const again = createWorkbookSnapshot(wb);
      const diff = diffSnapshots(snap, again);
      const analysis = new AnalysisService(() => wb);
      const profile = analysis.getProfile();
      void vscode.window.showInformationMessage(
        [
          `Snapshot: ${snap.sheets.length} sheets, ${snap.sheets.reduce((n, s) => n + s.cells.length, 0)} cells`,
          `Stability check (self-diff): ${diff.length} changes`,
          profile
            ? `Formulas ${profile.totalFormulaCells} · cycles ${profile.cycleCount} · errors ${profile.diagnosticSummary.error}`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
      activePanelRegistry.send('runProfile');
    }),
  ];
}

function goTo(symbol: WorkbookSymbol): void {
  activePanelRegistry.navigateToCell(symbol.sheetName, symbol.row ?? 0, symbol.col ?? 0);
}

function parseSheetRef(
  ref: string,
  defaultSheet: string,
): { sheetName: string; row: number; col: number } | null {
  const bang = ref.lastIndexOf('!');
  let sheetName = defaultSheet;
  let cellPart = ref;
  if (bang >= 0) {
    sheetName = ref.slice(0, bang).replace(/^'|'$/g, '');
    cellPart = ref.slice(bang + 1);
  }
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(cellPart.trim());
  if (!m) return null;
  let col = 0;
  const letters = m[1].toUpperCase();
  for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
  col -= 1;
  const row = parseInt(m[2], 10) - 1;
  return { sheetName, row, col };
}
