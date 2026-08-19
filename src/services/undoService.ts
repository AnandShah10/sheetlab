import { Worksheet } from '../types/workbook';

interface UndoEntry {
  sheetName: string;
  before: Worksheet;
  after: Worksheet;
  label: string;
}

/**
 * A simple linear undo/redo stack of whole-worksheet snapshots. This is
 * intentionally coarse-grained (snapshot per logical operation — one cell
 * edit, one paste, one sort, one cleanup op) rather than per-keystroke, and
 * it is capped so pasting into a 500k-row sheet repeatedly doesn't grow
 * memory unbounded. It covers cell edits, paste, delete, sort, filter
 * application, data cleaning, and row/column operations (spec section 32).
 *
 * For CSV documents specifically, this stack works ALONGSIDE VS Code's own
 * text-document undo (see csvDocumentSync.ts) rather than replacing it —
 * each entry here corresponds to exactly one WorkspaceEdit, so Ctrl+Z in the
 * spreadsheet view and Ctrl+Z in the plain text view stay consistent.
 */
export class UndoStack {
  private readonly stack: UndoEntry[] = [];
  private cursor = -1; // index of the last applied entry
  private readonly maxEntries = 200;

  push(entry: UndoEntry): void {
    // Discard any redo tail once a new edit is made.
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
