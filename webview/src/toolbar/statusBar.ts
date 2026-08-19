import { appState } from '../state/appState';

export class StatusBar {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-status-bar');
    appState.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const sel = appState.selection.range;
    const rowCount = sel.endRow - sel.startRow + 1;
    const colCount = sel.endCol - sel.startCol + 1;
    const cellCount = rowCount * colCount;

    let sum = 0;
    let numericCount = 0;
    let min = Infinity;
    let max = -Infinity;

    if (cellCount > 1 && cellCount < 200000) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        for (let c = sel.startCol; c <= sel.endCol; c++) {
          const cell = appState.getCell(appState.activeSheet, r, c);
          if (cell.type === 'number' && typeof cell.value === 'number') {
            sum += cell.value;
            numericCount++;
            min = Math.min(min, cell.value);
            max = Math.max(max, cell.value);
          }
        }
      }
    }

    const parts: string[] = [];
    parts.push(`${appState.meta?.sourceKind?.toUpperCase() ?? ''} · ${appState.activeSheet}`);
    parts.push(`${appState.currentRowCount().toLocaleString()} rows`);
    if (cellCount > 1) {
      parts.push(`Selected: ${rowCount}×${colCount} (${cellCount.toLocaleString()} cells)`);
      if (numericCount > 0) {
        parts.push(`Sum: ${formatNum(sum)}`);
        parts.push(`Avg: ${formatNum(sum / numericCount)}`);
        parts.push(`Min: ${formatNum(min)}`);
        parts.push(`Max: ${formatNum(max)}`);
        parts.push(`Count: ${numericCount}`);
      }
    }
    if (appState.dirty) parts.push('● Unsaved');

    this.container.textContent = parts.join('   ');
  }
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
