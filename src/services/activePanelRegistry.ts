import * as vscode from 'vscode';
import { HostToWebviewMessage, UiCommand, Workbook } from '../types/workbook';

export interface ActiveWorkbookAccessor {
  getWorkbook: () => Workbook;
  getActiveSheetName: () => string;
}

/**
 * Command Palette commands like "SheetLab: Run Query" or "SheetLab: Go To
 * Cell" don't know which open SheetLab editor the user means -- VS Code
 * doesn't hand command callbacks a reference to "the active custom editor's
 * webview". This registry is populated by each editor provider when its
 * panel becomes active/visible, so commands can find and message the right
 * target via a small `uiCommand` protocol message the webview interprets
 * (open the search panel, open the query panel, toggle the formula bar, ...).
 */
class ActivePanelRegistry {
  private active: ((m: HostToWebviewMessage) => void) | undefined;
  private accessor: ActiveWorkbookAccessor | undefined;

  setActive(post: (m: HostToWebviewMessage) => void, accessor?: ActiveWorkbookAccessor): void {
    this.active = post;
    this.accessor = accessor;
  }

  clearIfCurrent(post: (m: HostToWebviewMessage) => void): void {
    if (this.active === post) {
      this.active = undefined;
      this.accessor = undefined;
    }
  }

  send(command: UiCommand): boolean {
    if (!this.active) return false;
    this.active({ type: 'uiCommand', command });
    return true;
  }

  getActiveWorkbook(): Workbook | undefined {
    return this.accessor?.getWorkbook();
  }

  getActiveWorkbookAndSheet(): { workbook: Workbook; sheetName: string } | undefined {
    if (!this.accessor) return undefined;
    return { workbook: this.accessor.getWorkbook(), sheetName: this.accessor.getActiveSheetName() };
  }

  hasActive(): boolean {
    return this.active !== undefined;
  }
}

export const activePanelRegistry = new ActivePanelRegistry();

export function trackPanelFocus(
  panel: vscode.WebviewPanel,
  post: (m: HostToWebviewMessage) => void,
  accessor?: ActiveWorkbookAccessor,
): vscode.Disposable {
  if (panel.active) activePanelRegistry.setActive(post, accessor);
  const sub = panel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active) {
      activePanelRegistry.setActive(post, accessor);
    }
  });
  return new vscode.Disposable(() => {
    sub.dispose();
    activePanelRegistry.clearIfCurrent(post);
  });
}
