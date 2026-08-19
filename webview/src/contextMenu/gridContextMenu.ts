import { postToHost } from '../app/vscodeApi';
import { appState } from '../state/appState';
import { cellsToClipboardMatrix, matrixToClipboardText, clipboardTextToMatrix } from '../grid/clipboard';
import { findTableAtLocal } from '../grid/tableHitTest';

type MenuItem = [string, () => void];

export class GridContextMenu {
  show(x: number, y: number): void {
    const range = appState.selection.range;
    const tableHere = findTableAtLocal(appState.selection.active.row, appState.selection.active.col);

    const items: MenuItem[] = [
      ['Cut', () => this.cut()],
      ['Copy', () => this.copy()],
      ['Paste', () => this.paste()],
      ['Clear Contents', () => postToHost({ type: 'clearRange', sheetName: appState.activeSheet, range })],
      ['—', () => {}],
      ['Insert Row Above', () => postToHost({ type: 'insertRow', sheetName: appState.activeSheet, at: range.startRow })],
      ['Insert Row Below', () => postToHost({ type: 'insertRow', sheetName: appState.activeSheet, at: range.endRow + 1 })],
      ['Delete Row', () => postToHost({ type: 'deleteRow', sheetName: appState.activeSheet, at: range.startRow })],
      ['Hide Row', () => postToHost({ type: 'setRowHidden', sheetName: appState.activeSheet, row: range.startRow, hidden: true })],
      ['—', () => {}],
      ['Insert Column Left', () => postToHost({ type: 'insertColumn', sheetName: appState.activeSheet, at: range.startCol })],
      ['Insert Column Right', () => postToHost({ type: 'insertColumn', sheetName: appState.activeSheet, at: range.endCol + 1 })],
      ['Delete Column', () => postToHost({ type: 'deleteColumn', sheetName: appState.activeSheet, at: range.startCol })],
      ['Hide Column', () => postToHost({ type: 'setColumnHidden', sheetName: appState.activeSheet, col: range.startCol, hidden: true })],
      ['—', () => {}],
      ['Show All Hidden Rows', () => postToHost({ type: 'showAllHidden', sheetName: appState.activeSheet, axis: 'row' })],
      ['Show All Hidden Columns', () => postToHost({ type: 'showAllHidden', sheetName: appState.activeSheet, axis: 'column' })],
      ['—', () => {}],
      tableHere
        ? ['Remove Table', () => postToHost({ type: 'removeTable', sheetName: appState.activeSheet, name: tableHere.name })]
        : ['Create Table from Selection', () => this.createTable()],
    ];

    this.render(x, y, items);
  }

  /** Right-click menu for a column header. */
  showForColumn(col: number, x: number, y: number): void {
    const items: MenuItem[] = [
      ['Sort Sheet A→Z by this Column', () => this.sortByColumn(col, 'asc')],
      ['Sort Sheet Z→A by this Column', () => this.sortByColumn(col, 'desc')],
      ['—', () => {}],
      ['Insert Column Left', () => postToHost({ type: 'insertColumn', sheetName: appState.activeSheet, at: col })],
      ['Insert Column Right', () => postToHost({ type: 'insertColumn', sheetName: appState.activeSheet, at: col + 1 })],
      ['Delete Column', () => postToHost({ type: 'deleteColumn', sheetName: appState.activeSheet, at: col })],
      ['Hide Column', () => postToHost({ type: 'setColumnHidden', sheetName: appState.activeSheet, col, hidden: true })],
      ['Show All Hidden Columns', () => postToHost({ type: 'showAllHidden', sheetName: appState.activeSheet, axis: 'column' })],
    ];
    this.render(x, y, items);
  }

  /** Right-click menu for a row header. */
  showForRow(row: number, x: number, y: number): void {
    const items: MenuItem[] = [
      ['Insert Row Above', () => postToHost({ type: 'insertRow', sheetName: appState.activeSheet, at: row })],
      ['Insert Row Below', () => postToHost({ type: 'insertRow', sheetName: appState.activeSheet, at: row + 1 })],
      ['Delete Row', () => postToHost({ type: 'deleteRow', sheetName: appState.activeSheet, at: row })],
      ['Hide Row', () => postToHost({ type: 'setRowHidden', sheetName: appState.activeSheet, row, hidden: true })],
      ['Show All Hidden Rows', () => postToHost({ type: 'showAllHidden', sheetName: appState.activeSheet, axis: 'row' })],
    ];
    this.render(x, y, items);
  }

  private render(x: number, y: number, items: MenuItem[]): void {
    const existing = document.querySelector('.sheetlab-context-menu');
    existing?.remove();

    const menu = document.createElement('div');
    menu.className = 'sheetlab-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    items.forEach(([label, action]) => {
      if (label === '—') {
        const sep = document.createElement('div');
        sep.style.borderTop = '1px solid var(--vscode-widget-border, rgba(128,128,128,0.3))';
        sep.style.margin = '4px 0';
        menu.appendChild(sep);
        return;
      }
      const item = document.createElement('div');
      item.className = 'sheetlab-context-menu-item';
      item.textContent = label;
      item.addEventListener('click', () => {
        action();
        menu.remove();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    const closeOnce = () => {
      menu.remove();
      document.removeEventListener('click', closeOnce);
    };
    setTimeout(() => document.addEventListener('click', closeOnce), 0);
  }

  private sortByColumn(col: number, direction: 'asc' | 'desc'): void {
    const rowCount = appState.currentRowCount();
    postToHost({
      type: 'sortRange',
      sheetName: appState.activeSheet,
      range: { startRow: 0, startCol: 0, endRow: Math.max(0, rowCount - 1), endCol: Math.max(0, appState.currentColCount() - 1) },
      keys: [{ col, direction }],
      hasHeaderRow: true,
    });
  }

  private copy(): void {
    const matrix = cellsToClipboardMatrix(appState.activeSheet, appState.selection.range);
    const text = matrixToClipboardText(matrix);
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  private cut(): void {
    this.copy();
    postToHost({ type: 'clearRange', sheetName: appState.activeSheet, range: appState.selection.range });
  }

  private paste(): void {
    navigator.clipboard?.readText().then((text) => {
      if (!text) return;
      const matrix = clipboardTextToMatrix(text);
      postToHost({
        type: 'pasteRange',
        sheetName: appState.activeSheet,
        startRow: appState.selection.active.row,
        startCol: appState.selection.active.col,
        data: matrix,
      });
    }).catch(() => undefined);
  }

  private createTable(): void {
    const name = prompt('Table name:', `Table${((appState.sheetSummaries[appState.activeSheet]?.tables ?? []).length) + 1}`);
    if (!name) return;
    const hasTotalsRow = confirm('Does the LAST row of the selection contain totals (a totals row), rather than data? Click Cancel if every row is data.');
    postToHost({
      type: 'createTable',
      sheetName: appState.activeSheet,
      range: appState.selection.range,
      name,
      hasHeaderRow: true,
      hasTotalsRow,
    });
  }
}
