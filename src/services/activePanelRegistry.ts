import * as vscode from 'vscode';
import { HostToWebviewMessage, UiCommand, Workbook } from '../types/workbook';

export interface ActiveWorkbookAccessor {
  getWorkbook: () => Workbook;
  getActiveSheetName: () => string;
}

/**
 * Command Palette commands need a target webview. Opening the palette moves
 * focus off the custom editor, so we keep the *last* focused SheetLab panel
 * and only clear it when that panel is disposed — not merely when it becomes
 * inactive.
 */
class ActivePanelRegistry {
  private active: ((m: HostToWebviewMessage) => void) | undefined;
  private accessor: ActiveWorkbookAccessor | undefined;
  /** Last SheetLab panel that had focus (survives Command Palette focus steal). */
  private lastPost: ((m: HostToWebviewMessage) => void) | undefined;
  private lastAccessor: ActiveWorkbookAccessor | undefined;

  setActive(post: (m: HostToWebviewMessage) => void, accessor?: ActiveWorkbookAccessor): void {
    this.active = post;
    this.accessor = accessor;
    this.lastPost = post;
    this.lastAccessor = accessor;
  }

  clearIfCurrent(post: (m: HostToWebviewMessage) => void): void {
    if (this.active === post) {
      this.active = undefined;
      this.accessor = undefined;
    }
    if (this.lastPost === post) {
      this.lastPost = undefined;
      this.lastAccessor = undefined;
    }
  }

  send(command: UiCommand): boolean {
    const post = this.active ?? this.lastPost;
    if (!post) return false;
    post({ type: 'uiCommand', command });
    return true;
  }

  getActiveWorkbook(): Workbook | undefined {
    return (this.accessor ?? this.lastAccessor)?.getWorkbook();
  }

  getActiveWorkbookAndSheet(): { workbook: Workbook; sheetName: string } | undefined {
    const acc = this.accessor ?? this.lastAccessor;
    if (!acc) return undefined;
    return { workbook: acc.getWorkbook(), sheetName: acc.getActiveSheetName() };
  }

  hasActive(): boolean {
    return this.active !== undefined || this.lastPost !== undefined;
  }
}

export const activePanelRegistry = new ActivePanelRegistry();

export function trackPanelFocus(
  panel: vscode.WebviewPanel,
  post: (m: HostToWebviewMessage) => void,
  accessor?: ActiveWorkbookAccessor,
): vscode.Disposable {
  // Register immediately so commands work even before the next focus event.
  activePanelRegistry.setActive(post, accessor);
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
