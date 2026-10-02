import { Worksheet } from '../types/workbook';

export interface SheetUndoEntry {
  kind?: 'sheet';
  sheetName: string;
  before: Worksheet;
  after: Worksheet;
  label: string;
}

/** One undo step that restores multiple sheets (e.g. pipeline replay). */
export interface CompositeUndoEntry {
  kind: 'composite';
  label: string;
  parts: SheetUndoEntry[];
}

/** Undo creation of a worksheet (materialize query, etc.). */
export interface SheetCreateUndoEntry {
  kind: 'sheetCreate';
  label: string;
  sheetName: string;
  previousActiveSheet: string;
  previousSheetOrder: string[];
  /** Full sheet for redo */
  sheetSnapshot: Worksheet;
}

export type UndoEntry = SheetUndoEntry | CompositeUndoEntry | SheetCreateUndoEntry;

/**
 * Linear undo/redo stack of worksheet snapshots, composites, or sheet-create ops.
 * Capped so repeated ops on large sheets don't grow memory unbounded.
 */
export class UndoStack {
  private readonly stack: UndoEntry[] = [];
  private cursor = -1;
  private readonly maxEntries = 200;

  push(entry: UndoEntry): void {
    this.stack.splice(this.cursor + 1);
    this.stack.push(entry);
    if (this.stack.length > this.maxEntries) {
      this.stack.shift();
    }
    this.cursor = this.stack.length - 1;
  }

  canUndo(): boolean {
    return this.cursor >= 0;
  }

  canRedo(): boolean {
    return this.cursor < this.stack.length - 1;
  }

  undo(): UndoEntry | null {
    if (!this.canUndo()) return null;
    const entry = this.stack[this.cursor];
    this.cursor--;
    return entry;
  }

  redo(): UndoEntry | null {
    if (!this.canRedo()) return null;
    this.cursor++;
    return this.stack[this.cursor];
  }

  clear(): void {
    this.stack.length = 0;
    this.cursor = -1;
  }
}
