import { Cell, CellRange } from '../../../src/types/workbook';
import { appState } from '../state/appState';
import { postToHost } from '../app/vscodeApi';
import { colIndexToLetter } from '../app/cellRef';
import { cellsToClipboardMatrix, matrixToClipboardText, clipboardTextToMatrix } from './clipboard';
import { GridContextMenu } from '../contextMenu/gridContextMenu';
import { formatNumber, getNumberFormatColor } from './numberFormat';

const ROW_HEADER_WIDTH = 48;
const OVERSCAN_ROWS = 6;
const OVERSCAN_COLS = 3;

export class Grid {
  private container: HTMLElement;
  private scrollEl!: HTMLDivElement;
  private canvasEl!: HTMLDivElement;
  private headerRowEl!: HTMLDivElement;
  private frozenColLayer!: HTMLDivElement;
  private frozenRowLayer!: HTMLDivElement;
  private frozenCornerLayer!: HTMLDivElement;
  private frozenRowHeaderLayer!: HTMLDivElement;
  private frozenCellNodes = new Map<string, HTMLDivElement>();
  private frozenRowHeaderNodes = new Map<number, HTMLDivElement>();
  private cellNodes = new Map<string, HTMLDivElement>();
  private colWidths: number[] = [];
  private rowOffsets: number[] = []; // rowOffsets[r] = top pixel offset of row r; length = rowCount+1
  private rowMetaRef: unknown = null;
  private rowHeight: number;
  private requestedRanges = new Set<string>();
  private editingInput: HTMLInputElement | null = null;
  private onCellSelect: ((row: number, col: number) => void) | undefined;
  private onRangeChange: ((range: CellRange) => void) | undefined;
  private dragging = false;
  private contextMenu = new GridContextMenu();

  constructor(container: HTMLElement) {
    this.container = container;
    this.rowHeight = appState.settings?.rowHeight ?? 24;
    this.build();
    appState.subscribe(() => this.renderVisible());
  }

  setSelectionHandlers(onCellSelect: (row: number, col: number) => void, onRangeChange: (range: CellRange) => void): void {
    this.onCellSelect = onCellSelect;
    this.onRangeChange = onRangeChange;
  }

  private build(): void {
    this.container.innerHTML = '';
    this.container.classList.add('sheetlab-grid-root');

    const headerRow = document.createElement('div');
    headerRow.className = 'sheetlab-col-headers';
    this.headerRowEl = headerRow;

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'sheetlab-grid-scroll';
    this.canvasEl = document.createElement('div');
    this.canvasEl.className = 'sheetlab-grid-canvas';
    this.scrollEl.appendChild(this.canvasEl);

    this.frozenColLayer = document.createElement('div');
    this.frozenColLayer.className = 'sheetlab-frozen-layer sheetlab-frozen-col-layer';
    this.frozenRowLayer = document.createElement('div');
    this.frozenRowLayer.className = 'sheetlab-frozen-layer sheetlab-frozen-row-layer';
    this.frozenCornerLayer = document.createElement('div');
    this.frozenCornerLayer.className = 'sheetlab-frozen-layer sheetlab-frozen-corner-layer';
    this.frozenRowHeaderLayer = document.createElement('div');
    this.frozenRowHeaderLayer.className = 'sheetlab-frozen-layer sheetlab-frozen-row-header-layer';
    this.canvasEl.appendChild(this.frozenColLayer);
    this.canvasEl.appendChild(this.frozenRowLayer);
    this.canvasEl.appendChild(this.frozenCornerLayer);
    this.canvasEl.appendChild(this.frozenRowHeaderLayer);

    this.container.appendChild(headerRow);
    this.container.appendChild(this.scrollEl);

    this.scrollEl.addEventListener('scroll', () => this.onScroll());
    window.addEventListener('resize', () => this.renderVisible());
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('copy', (e) => this.onCopy(e));
    document.addEventListener('paste', (e) => this.onPaste(e));

    this.resetColumnWidths();
    this.updateCanvasSize();
    this.renderVisible();
  }

  private resetColumnWidths(): void {
    const defaultWidth = appState.settings?.defaultColumnWidth ?? 100;
    const colCount = appState.currentColCount();
    this.colWidths = new Array(colCount).fill(defaultWidth);
    const sheet = appState.sheetSummaries[appState.activeSheet];
    if (sheet) {
      Object.entries(sheet.columns).forEach(([idx, meta]) => {
        this.colWidths[Number(idx)] = meta.hidden ? 0 : meta.width;
      });
    }
  }

  /** Rebuilds the row-offset prefix-sum array, accounting for per-row height overrides and hidden rows. */
  private rebuildRowOffsets(): void {
    const sheet = appState.sheetSummaries[appState.activeSheet];
    const rowMeta = sheet?.rowMeta ?? {};
    this.rowMetaRef = rowMeta;
    const rowCount = Math.max(appState.currentRowCount(), 100);
    const offsets = new Array(rowCount + 1);
    offsets[0] = 0;
    for (let r = 0; r < rowCount; r++) {
      const meta = rowMeta[r];
      const height = meta?.hidden ? 0 : (meta?.height ?? this.rowHeight);
      offsets[r + 1] = offsets[r] + height;
    }
    this.rowOffsets = offsets;
  }

  private rebuildRowOffsetsIfStale(): void {
    const sheet = appState.sheetSummaries[appState.activeSheet];
    const rowMeta = sheet?.rowMeta ?? {};
    if (rowMeta !== this.rowMetaRef || this.rowOffsets.length === 0) {
      this.rebuildRowOffsets();
    }
  }

  private rowTop(row: number): number {
    return this.rowOffsets[Math.min(row, this.rowOffsets.length - 1)] ?? row * this.rowHeight;
  }

  private rowHeightAt(row: number): number {
    const top = this.rowTop(row);
    const bottom = this.rowTop(row + 1);
    return bottom - top;
  }

  /** Binary search: the row index whose vertical span contains pixel offset `y`. */
  private rowAtOffset(y: number): number {
    const offsets = this.rowOffsets;
    let lo = 0;
    let hi = offsets.length - 2;
    if (hi < 0) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private updateCanvasSize(): void {
    this.rebuildRowOffsetsIfStale();
    const totalWidth = this.colWidths.reduce((a, b) => a + b, 0);
    this.canvasEl.style.height = `${this.rowOffsets[this.rowOffsets.length - 1]}px`;
    this.canvasEl.style.width = `${totalWidth}px`;
  }

  reset(): void {
    this.resetColumnWidths();
    this.rebuildRowOffsets();
    this.requestedRanges.clear();
    this.cellNodes.forEach((n) => n.remove());
    this.cellNodes.clear();
    this.rowHeaderNodes.forEach((n) => n.remove());
    this.rowHeaderNodes.clear();
    this.updateCanvasSize();
    this.scrollEl.scrollTop = 0;
    this.scrollEl.scrollLeft = 0;
    this.renderVisible();
  }

  scrollToCell(row: number, col: number): void {
    this.rebuildRowOffsetsIfStale();
    const top = this.rowTop(row);
    const left = this.colWidths.slice(0, col).reduce((a, b) => a + b, 0);
    this.scrollEl.scrollTop = Math.max(0, top - this.scrollEl.clientHeight / 2);
    this.scrollEl.scrollLeft = Math.max(0, left - this.scrollEl.clientWidth / 2);
  }

  private onScroll(): void {
    this.renderVisible();
    this.maybeRequestMoreRows();
  }

  private maybeRequestMoreRows(): void {
    const { startRow, endRow } = this.visibleRowRange();
    const chunk = appState.settings?.chunkSize ?? 5000;
    const chunkIndex = Math.floor(endRow / chunk);
    const key = `${appState.activeSheet}:${chunkIndex}`;
    if (this.requestedRanges.has(key)) return;
    const start = chunkIndex * chunk;
    const rowsLoaded = appState.rowsBySheet[appState.activeSheet] ?? {};
    const alreadyHave = Object.prototype.hasOwnProperty.call(rowsLoaded, start);
    if (alreadyHave) return;
    this.requestedRanges.add(key);
    postToHost({
      type: 'requestSheetRows',
      sheetName: appState.activeSheet,
      startRow: start,
      endRow: start + chunk,
    });
    void startRow;
  }

  private visibleRowRange(): { startRow: number; endRow: number } {
    this.rebuildRowOffsetsIfStale();
    const top = this.scrollEl.scrollTop;
    const height = this.scrollEl.clientHeight;
    const startRow = Math.max(0, this.rowAtOffset(top) - OVERSCAN_ROWS);
    const endRow = Math.min(this.rowOffsets.length - 1, this.rowAtOffset(top + height) + OVERSCAN_ROWS + 1);
    return { startRow, endRow };
  }

  private visibleColRange(): { startCol: number; endCol: number } {
    const left = this.scrollEl.scrollLeft;
    const width = this.scrollEl.clientWidth;
    let acc = 0;
    let startCol = 0;
    for (; startCol < this.colWidths.length; startCol++) {
      if (acc + this.colWidths[startCol] > left) break;
      acc += this.colWidths[startCol];
    }
    startCol = Math.max(0, startCol - OVERSCAN_COLS);
    let endCol = startCol;
    let w = 0;
    while (endCol < this.colWidths.length && w < width + left) {
      w += this.colWidths[endCol];
      endCol++;
    }
    endCol = Math.min(this.colWidths.length, endCol + OVERSCAN_COLS);
    return { startCol, endCol };
  }

  private colOffset(col: number): number {
    let acc = 0;
    for (let i = 0; i < col; i++) acc += this.colWidths[i] ?? (appState.settings?.defaultColumnWidth ?? 100);
    return acc;
  }

  private renderVisible(): void {
    const { startRow, endRow } = this.visibleRowRange();
    const { startCol, endCol } = this.visibleColRange();

    this.renderColumnHeaders(startCol, endCol);

    const keep = new Set<string>();
    for (let r = startRow; r < endRow; r++) {
      if (this.rowHeightAt(r) === 0) continue; // hidden row
      for (let c = startCol; c < endCol; c++) {
        if (this.colWidths[c] === 0) continue; // hidden column
        const key = `${r}:${c}`;
        keep.add(key);
        this.renderCell(r, c, key);
      }
    }
    for (const [key, node] of this.cellNodes) {
      if (!keep.has(key)) {
        node.remove();
        this.cellNodes.delete(key);
      }
    }
    this.renderRowHeaders(startRow, endRow);
    this.renderFrozenPanes();
  }

  private renderColumnHeaders(startCol: number, endCol: number): void {
    this.headerRowEl.innerHTML = '';
    const spacer = document.createElement('div');
    spacer.className = 'sheetlab-corner';
    spacer.style.width = `${ROW_HEADER_WIDTH}px`;
    this.headerRowEl.appendChild(spacer);

    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.style.left = `${-this.scrollEl.scrollLeft}px`;
    for (let c = startCol; c < endCol; c++) {
      if (this.colWidths[c] === 0) continue;
      const el = document.createElement('div');
      el.className = 'sheetlab-col-header';
      el.textContent = colIndexToLetter(c);
      el.style.position = 'absolute';
      el.style.left = `${this.colOffset(c)}px`;
      el.style.width = `${this.colWidths[c]}px`;
      el.dataset.col = String(c);
      el.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).classList.contains('sheetlab-col-resize-handle')) return;
        this.selectWholeColumn(c);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.selectWholeColumn(c);
        this.contextMenu.showForColumn(c, e.clientX, e.clientY);
      });
      this.attachColumnResize(el, c);
      wrap.appendChild(el);
    }
    this.headerRowEl.appendChild(wrap);
  }

  private attachColumnResize(headerEl: HTMLDivElement, col: number): void {
    const handle = document.createElement('div');
    handle.className = 'sheetlab-col-resize-handle';
    headerEl.appendChild(handle);
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = this.colWidths[col];
      const onMove = (moveEvt: MouseEvent) => {
        const delta = moveEvt.clientX - startX;
        this.colWidths[col] = Math.max(24, startWidth + delta);
        this.updateCanvasSize();
        this.renderVisible();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        postToHost({ type: 'resizeColumn', sheetName: appState.activeSheet, col, width: this.colWidths[col] });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  private attachRowResize(headerEl: HTMLDivElement, row: number): void {
    const handle = document.createElement('div');
    handle.className = 'sheetlab-row-resize-handle';
    headerEl.appendChild(handle);
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startHeight = this.rowHeightAt(row) || this.rowHeight;
      const onMove = (moveEvt: MouseEvent) => {
        const delta = moveEvt.clientY - startY;
        const newHeight = Math.max(12, startHeight + delta);
        const sheetSummary = appState.sheetSummaries[appState.activeSheet];
        if (sheetSummary) {
          sheetSummary.rowMeta[row] = { ...sheetSummary.rowMeta[row], height: newHeight };
        }
        this.rebuildRowOffsets();
        this.updateCanvasSize();
        this.renderVisible();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const finalHeight = this.rowHeightAt(row);
        postToHost({ type: 'resizeRow', sheetName: appState.activeSheet, row, height: finalHeight });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  private selectWholeColumn(col: number): void {
    this.commitEditIfAny();
    const lastRow = Math.max(0, appState.currentRowCount() - 1);
    appState.selection = {
      active: { row: 0, col },
      range: { startRow: 0, startCol: col, endRow: lastRow, endCol: col },
      editing: false,
    };
    appState.notify();
    this.onCellSelect?.(0, col);
    this.onRangeChange?.(appState.selection.range);
  }

  private selectWholeRow(row: number): void {
    this.commitEditIfAny();
    const lastCol = Math.max(0, appState.currentColCount() - 1);
    appState.selection = {
      active: { row, col: 0 },
      range: { startRow: row, startCol: 0, endRow: row, endCol: lastCol },
      editing: false,
    };
    appState.notify();
    this.onCellSelect?.(row, 0);
    this.onRangeChange?.(appState.selection.range);
  }

  private rowHeaderNodes = new Map<number, HTMLDivElement>();

  private renderRowHeaders(startRow: number, endRow: number): void {
    let layer = this.canvasEl.querySelector<HTMLDivElement>('.sheetlab-row-header-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'sheetlab-row-header-layer';
      this.canvasEl.appendChild(layer);
    }
    layer.style.transform = `translateX(${this.scrollEl.scrollLeft}px)`;

    const keep = new Set<number>();
    for (let r = startRow; r < endRow; r++) {
      if (this.rowHeightAt(r) === 0) continue; // hidden row
      keep.add(r);
      let node = this.rowHeaderNodes.get(r);
      let label: HTMLSpanElement;
      if (!node) {
        node = document.createElement('div');
        node.className = 'sheetlab-row-header';
        node.style.width = `${ROW_HEADER_WIDTH}px`;
        label = document.createElement('span');
        node.appendChild(label);
        node.addEventListener('mousedown', (e) => {
          if ((e.target as HTMLElement).classList.contains('sheetlab-row-resize-handle')) return;
          this.selectWholeRow(r);
        });
        node.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.selectWholeRow(r);
          this.contextMenu.showForRow(r, e.clientX, e.clientY);
        });
        this.attachRowResize(node, r);
        layer.appendChild(node);
        this.rowHeaderNodes.set(r, node);
      } else {
        label = node.querySelector('span')!;
      }
      node.style.top = `${this.rowTop(r)}px`;
      node.style.height = `${this.rowHeightAt(r)}px`;
      label.textContent = String(r + 1);
    }
    for (const [r, node] of this.rowHeaderNodes) {
      if (!keep.has(r)) {
        node.remove();
        this.rowHeaderNodes.delete(r);
      }
    }
  }

  /**
   * Renders the frozen-pane overlays (spec section 41's "Freeze Panes").
   * All layers are children of `canvasEl`, so they inherit its native
   * scroll translation from the browser for free; we only need to counter-
   * translate the axis/axes that should stay pinned:
   *   - frozenColLayer (frozen columns): counter-translate horizontally,
   *     let vertical scroll pass through naturally.
   *   - frozenRowLayer (frozen rows): counter-translate vertically, let
   *     horizontal scroll pass through naturally.
   *   - frozenCornerLayer (both frozen): counter-translate both axes.
   *   - frozenRowHeaderLayer (row-number gutter for frozen rows): counter-
   *     translate both axes, same as the corner layer -- the row-number
   *     column is itself always horizontally pinned (see renderRowHeaders),
   *     and for frozen rows specifically it also needs to stay vertically
   *     pinned so "row 1" stays visible even after scrolling down past it.
   */
  private renderFrozenPanes(): void {
    const freeze = appState.sheetSummaries[appState.activeSheet]?.freezePane;
    const freezeRows = Math.min(freeze?.row ?? 0, 200);
    const freezeCols = Math.min(freeze?.col ?? 0, 100);

    if (freezeRows === 0 && freezeCols === 0) {
      this.frozenColLayer.style.display = 'none';
      this.frozenRowLayer.style.display = 'none';
      this.frozenCornerLayer.style.display = 'none';
      this.frozenRowHeaderLayer.style.display = 'none';
      this.clearFrozenNodes();
      return;
    }

    const scrollLeft = this.scrollEl.scrollLeft;
    const scrollTop = this.scrollEl.scrollTop;
    const { startCol, endCol } = this.visibleColRange();
    const { startRow, endRow } = this.visibleRowRange();

    const keep = new Set<string>();

    // Frozen columns: rows currently in the visible viewport, cols [0, freezeCols).
    if (freezeCols > 0) {
      this.frozenColLayer.style.display = '';
      this.frozenColLayer.style.transform = `translateX(${scrollLeft}px)`;
      for (let r = startRow; r < endRow; r++) {
        if (this.rowHeightAt(r) === 0) continue;
        for (let c = 0; c < freezeCols; c++) {
          if (this.colWidths[c] === 0) continue;
          keep.add(this.frozenCell(r, c, this.frozenColLayer));
        }
      }
    } else {
      this.frozenColLayer.style.display = 'none';
    }

    // Frozen rows: cols currently in the visible viewport, rows [0, freezeRows).
    if (freezeRows > 0) {
      this.frozenRowLayer.style.display = '';
      this.frozenRowLayer.style.transform = `translateY(${scrollTop}px)`;
      for (let r = 0; r < freezeRows; r++) {
        if (this.rowHeightAt(r) === 0) continue;
        for (let c = startCol; c < endCol; c++) {
          if (this.colWidths[c] === 0) continue;
          keep.add(this.frozenCell(r, c, this.frozenRowLayer));
        }
      }
    } else {
      this.frozenRowLayer.style.display = 'none';
    }

    // Corner: both frozen ranges.
    if (freezeRows > 0 && freezeCols > 0) {
      this.frozenCornerLayer.style.display = '';
      this.frozenCornerLayer.style.transform = `translate(${scrollLeft}px, ${scrollTop}px)`;
      for (let r = 0; r < freezeRows; r++) {
        if (this.rowHeightAt(r) === 0) continue;
        for (let c = 0; c < freezeCols; c++) {
          if (this.colWidths[c] === 0) continue;
          keep.add(this.frozenCell(r, c, this.frozenCornerLayer));
        }
      }
    } else {
      this.frozenCornerLayer.style.display = 'none';
    }

    for (const [key, node] of this.frozenCellNodes) {
      if (!keep.has(key)) {
        node.remove();
        this.frozenCellNodes.delete(key);
      }
    }

    // Row-number gutter for frozen rows: pinned both axes, same as the corner.
    if (freezeRows > 0) {
      this.frozenRowHeaderLayer.style.display = '';
      this.frozenRowHeaderLayer.style.transform = `translate(${scrollLeft}px, ${scrollTop}px)`;
      const keepHeaders = new Set<number>();
      for (let r = 0; r < freezeRows; r++) {
        if (this.rowHeightAt(r) === 0) continue;
        keepHeaders.add(r);
        this.frozenRowHeaderCell(r);
      }
      for (const [r, node] of this.frozenRowHeaderNodes) {
        if (!keepHeaders.has(r)) {
          node.remove();
          this.frozenRowHeaderNodes.delete(r);
        }
      }
    } else {
      this.frozenRowHeaderLayer.style.display = 'none';
      this.frozenRowHeaderNodes.forEach((n) => n.remove());
      this.frozenRowHeaderNodes.clear();
    }
  }

  private frozenRowHeaderCell(row: number): void {
    let node = this.frozenRowHeaderNodes.get(row);
    let label: HTMLSpanElement;
    if (!node) {
      node = document.createElement('div');
      node.className = 'sheetlab-row-header';
      node.style.width = `${ROW_HEADER_WIDTH}px`;
      label = document.createElement('span');
      node.appendChild(label);
      node.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).classList.contains('sheetlab-row-resize-handle')) return;
        this.selectWholeRow(row);
      });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.selectWholeRow(row);
        this.contextMenu.showForRow(row, e.clientX, e.clientY);
      });
      this.attachRowResize(node, row);
      this.frozenRowHeaderLayer.appendChild(node);
      this.frozenRowHeaderNodes.set(row, node);
    } else {
      label = node.querySelector('span')!;
    }
    node.style.top = `${this.rowTop(row)}px`;
    node.style.height = `${this.rowHeightAt(row)}px`;
    label.textContent = String(row + 1);
  }

  private clearFrozenNodes(): void {
    this.frozenCellNodes.forEach((n) => n.remove());
    this.frozenCellNodes.clear();
    this.frozenRowHeaderNodes.forEach((n) => n.remove());
    this.frozenRowHeaderNodes.clear();
  }

  /** Creates or updates a single frozen-pane cell node inside `layer`; returns its dedupe key. */
  private frozenCell(row: number, col: number, layer: HTMLDivElement): string {
    const key = `${layer.className}:${row}:${col}`;
    let node = this.frozenCellNodes.get(key);
    if (!node) {
      node = document.createElement('div');
      node.className = 'sheetlab-cell sheetlab-frozen-cell';
      node.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.onCellMouseDown(e, row, col);
      });
      node.addEventListener('mouseenter', () => this.onCellMouseEnter(row, col));
      node.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.beginEdit(row, col);
      });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        appState.selection = { active: { row, col }, range: { startRow: row, startCol: col, endRow: row, endCol: col }, editing: false };
        appState.notify();
        this.contextMenu.show(e.clientX, e.clientY);
      });
      layer.appendChild(node);
      this.frozenCellNodes.set(key, node);
    }
    node.style.top = `${this.rowTop(row)}px`;
    node.style.left = `${ROW_HEADER_WIDTH + this.colOffset(col)}px`;
    node.style.width = `${this.colWidths[col]}px`;
    node.style.height = `${this.rowHeightAt(row)}px`;
    this.styleCellContent(node, row, col);
    return key;
  }

  private renderCell(row: number, col: number, key: string): void {
    let node = this.cellNodes.get(key);
    if (!node) {
      node = document.createElement('div');
      node.className = 'sheetlab-cell';
      node.dataset.row = String(row);
      node.dataset.col = String(col);
      node.addEventListener('mousedown', (e) => this.onCellMouseDown(e, row, col));
      node.addEventListener('mouseenter', () => this.onCellMouseEnter(row, col));
      node.addEventListener('dblclick', () => this.beginEdit(row, col));
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.inSelection(row, col)) {
          appState.selection = { active: { row, col }, range: { startRow: row, startCol: col, endRow: row, endCol: col }, editing: false };
          appState.notify();
        }
        this.contextMenu.show(e.clientX, e.clientY);
      });
      this.canvasEl.appendChild(node);
      this.cellNodes.set(key, node);
    }

    node.style.top = `${this.rowTop(row)}px`;
    node.style.left = `${ROW_HEADER_WIDTH + this.colOffset(col)}px`;
    node.style.width = `${this.colWidths[col]}px`;
    node.style.height = `${this.rowHeightAt(row)}px`;
    this.styleCellContent(node, row, col);
  }

  /** Content/format/selection styling shared between the main grid and the frozen-pane overlay layers. */
  private styleCellContent(node: HTMLDivElement, row: number, col: number): void {
    const cell = appState.getCell(appState.activeSheet, row, col);
    node.textContent = displayText(cell);
    node.classList.toggle('sheetlab-cell-error', cell.type === 'error');
    node.classList.toggle('sheetlab-cell-number', cell.type === 'number');
    node.classList.toggle('sheetlab-gridlines', appState.showGridlines);
    applyCellFormatStyles(node, cell);
    this.applyTableBorderStyles(node, row, col);

    const hidden = appState.visibleRowFilter[appState.activeSheet];
    node.style.display = hidden && !hidden.has(row) ? 'none' : '';

    const sel = appState.selection;
    const inRange = row >= sel.range.startRow && row <= sel.range.endRow && col >= sel.range.startCol && col <= sel.range.endCol;
    const isActive = sel.active.row === row && sel.active.col === col;
    node.classList.toggle('sheetlab-cell-selected', inRange && !isActive);
    node.classList.toggle('sheetlab-cell-active', isActive);
  }

  private inSelection(row: number, col: number): boolean {
    const r = appState.selection.range;
    return row >= r.startRow && row <= r.endRow && col >= r.startCol && col <= r.endCol;
  }

  /** Adds border/header classes when a cell belongs to a registered Excel Table (spec section 23). */
  private applyTableBorderStyles(node: HTMLDivElement, row: number, col: number): void {
    const tables = appState.sheetSummaries[appState.activeSheet]?.tables ?? [];
    const table = tables.find(
      (t) => row >= t.range.startRow && row <= t.range.endRow && col >= t.range.startCol && col <= t.range.endCol,
    );
    node.classList.toggle('sheetlab-cell-in-table', Boolean(table));
    node.classList.toggle('sheetlab-table-edge-top', Boolean(table) && row === table!.range.startRow);
    node.classList.toggle('sheetlab-table-edge-bottom', Boolean(table) && row === table!.range.endRow);
    node.classList.toggle('sheetlab-table-edge-left', Boolean(table) && col === table!.range.startCol);
    node.classList.toggle('sheetlab-table-edge-right', Boolean(table) && col === table!.range.endCol);
    node.classList.toggle('sheetlab-table-header', Boolean(table) && table!.hasHeaderRow && row === table!.range.startRow);
  }

  private onCellMouseDown(e: MouseEvent, row: number, col: number): void {
    this.commitEditIfAny();
    this.dragging = true;
    appState.selection = { active: { row, col }, range: { startRow: row, startCol: col, endRow: row, endCol: col }, editing: false };
    appState.notify();
    this.onCellSelect?.(row, col);
    this.onRangeChange?.(appState.selection.range);
    const onUp = () => {
      this.dragging = false;
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mouseup', onUp);
    void e;
  }

  private onCellMouseEnter(row: number, col: number): void {
    if (!this.dragging) return;
    const a = appState.selection.active;
    appState.selection.range = {
      startRow: Math.min(a.row, row),
      endRow: Math.max(a.row, row),
      startCol: Math.min(a.col, col),
      endCol: Math.max(a.col, col),
    };
    appState.notify();
    this.onRangeChange?.(appState.selection.range);
  }

  beginEdit(row: number, col: number, initialChar?: string): void {
    this.commitEditIfAny();
    const key = `${row}:${col}`;
    const node = this.cellNodes.get(key);
    if (!node) return;
    const cell = appState.getCell(appState.activeSheet, row, col);
    const input = document.createElement('input');
    input.className = 'sheetlab-cell-editor';
    input.value = initialChar ?? (cell.type === 'formula' ? (cell.raw ?? '') : (cell.raw ?? ''));
    node.textContent = '';
    node.appendChild(input);
    input.focus();
    if (initialChar) {
      input.setSelectionRange(input.value.length, input.value.length);
    } else {
      input.select();
    }
    this.editingInput = input;
    appState.selection.editing = true;

    const commit = (moveRow: number) => {
      const raw = input.value;
      postToHost({ type: 'editCell', sheetName: appState.activeSheet, row, col, raw });
      appState.setCellLocally(appState.activeSheet, row, col, inferLocalCell(raw));
      this.editingInput = null;
      appState.selection.editing = false;
      if (moveRow !== 0) {
        this.moveActive(moveRow, 0);
      } else {
        this.renderVisible();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const raw = input.value;
        postToHost({ type: 'editCell', sheetName: appState.activeSheet, row, col, raw });
        appState.setCellLocally(appState.activeSheet, row, col, inferLocalCell(raw));
        this.editingInput = null;
        appState.selection.editing = false;
        this.moveActive(0, e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.editingInput = null;
        appState.selection.editing = false;
        this.renderVisible();
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => {
      if (this.editingInput === input) commit(0);
    });
  }

  private commitEditIfAny(): void {
    if (this.editingInput) {
      this.editingInput.blur();
    }
  }

  private moveActive(dRow: number, dCol: number): void {
    const next = {
      row: Math.max(0, appState.selection.active.row + dRow),
      col: Math.max(0, appState.selection.active.col + dCol),
    };
    appState.selection = { active: next, range: { startRow: next.row, startCol: next.col, endRow: next.row, endCol: next.col }, editing: false };
    appState.notify();
    this.onCellSelect?.(next.row, next.col);
    this.scrollToCell(next.row, next.col);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.editingInput) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const { row, col } = appState.selection.active;
    const withShift = e.shiftKey;

    const extendOrMove = (dRow: number, dCol: number) => {
      e.preventDefault();
      if (withShift) {
        const r = appState.selection.range;
        appState.selection.range = {
          startRow: Math.min(r.startRow, row + dRow, row),
          endRow: Math.max(r.endRow, row + dRow, row),
          startCol: Math.min(r.startCol, col + dCol, col),
          endCol: Math.max(r.endCol, col + dCol, col),
        };
        appState.notify();
        this.onRangeChange?.(appState.selection.range);
      } else {
        this.moveActive(dRow, dCol);
      }
    };

    switch (e.key) {
      case 'ArrowDown': return extendOrMove(1, 0);
      case 'ArrowUp': return extendOrMove(-1, 0);
      case 'ArrowLeft': return extendOrMove(0, -1);
      case 'ArrowRight': return extendOrMove(0, 1);
      case 'Enter': return this.beginEdit(row, col);
      case 'F2': return this.beginEdit(row, col);
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        postToHost({ type: 'clearRange', sheetName: appState.activeSheet, range: appState.selection.range });
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          this.beginEdit(row, col, e.key);
        }
    }
  }

  private onCopy(e: ClipboardEvent): void {
    if (this.editingInput) return;
    const matrix = cellsToClipboardMatrix(appState.activeSheet, appState.selection.range);
    const text = matrixToClipboardText(matrix);
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
  }

  private onPaste(e: ClipboardEvent): void {
    if (this.editingInput) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    const matrix = clipboardTextToMatrix(text);
    postToHost({
      type: 'pasteRange',
      sheetName: appState.activeSheet,
      startRow: appState.selection.active.row,
      startCol: appState.selection.active.col,
      data: matrix,
    });
    e.preventDefault();
  }
}

function displayText(cell: Cell): string {
  if (cell.type === 'blank' || cell.value === null) return '';
  if (cell.type === 'error') return cell.error?.code ?? '#ERROR!';
  if (cell.type === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
  if (cell.type === 'number' && typeof cell.value === 'number' && cell.format?.numberFormat) {
    return formatNumber(cell.value, cell.format.numberFormat);
  }
  return String(cell.value);
}

function applyCellFormatStyles(node: HTMLDivElement, cell: Cell): void {
  const f = cell.format;
  node.style.fontWeight = f?.bold ? '600' : '';
  node.style.fontStyle = f?.italic ? 'italic' : '';
  node.style.textDecoration = f?.underline ? 'underline' : '';

  // A number format's own conditional color (e.g. "[Red]" in a negative
  // section) takes precedence over the cell's static font color for that
  // value, matching Excel's own behavior -- the sign-based color rule is
  // part of how the format renders that specific value, not a competing
  // independent style.
  let color = f?.fontColor ?? '';
  if (cell.type === 'number' && typeof cell.value === 'number' && f?.numberFormat) {
    const formatColor = getNumberFormatColor(cell.value, f.numberFormat);
    if (formatColor) color = formatColor;
  }
  node.style.color = color;

  node.style.backgroundColor = f?.backgroundColor ?? '';
  node.style.textAlign = f?.align ?? (cell.type === 'number' ? 'right' : 'left');

  const borderStyle = '1px solid var(--vscode-foreground)';
  node.style.borderTop = f?.border?.top ? borderStyle : '';
  node.style.borderRight = f?.border?.right ? borderStyle : '';
  node.style.borderBottom = f?.border?.bottom ? borderStyle : '';
  node.style.borderLeft = f?.border?.left ? borderStyle : '';
}

function inferLocalCell(raw: string): Cell {
  if (raw === '') return { raw: null, value: null, type: 'blank' };
  if (raw.startsWith('=')) return { raw, value: null, type: 'formula', formula: raw.slice(1) };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { raw, value: Number(raw), type: 'number' };
  if (/^(true|false)$/i.test(raw)) return { raw, value: raw.toLowerCase() === 'true', type: 'boolean' };
  return { raw, value: raw, type: 'string' };
}
