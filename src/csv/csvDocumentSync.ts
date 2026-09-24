import * as vscode from 'vscode';
import * as path from 'path';
import { CsvDialect, Worksheet } from '../types/workbook';
import { parseCsv } from './csvReader';
import { serializeCsv } from './csvWriter';
import { getCsvSettings } from '../services/settingsService';

/**
 * CsvDocumentSync is the piece that makes section 27 of the spec work:
 * the CSV spreadsheet view is NOT a separate copy of the file — it is a
 * projection of the exact same `vscode.TextDocument` that the plain text
 * editor uses.
 *
 * Architectural choice: our CSV editor is registered as a
 * `CustomTextEditorProvider`, not a `CustomReadonlyEditorProvider` and not a
 * from-scratch file-system reader. `resolveCustomTextEditor` hands us the
 * live `TextDocument` VS Code already opened for that URI. That buys us,
 * for free, from VS Code itself:
 *
 *   - a single shared dirty-state / save / revert lifecycle
 *   - VS Code's own undo stack for edits we make via WorkspaceEdit
 *   - automatic propagation to any other visible editor of the same
 *     document (including the plain text editor, if both are open in a
 *     split), via the standard `onDidChangeTextDocument` event
 *   - VS Code's existing external-modification / conflict-on-save handling
 *
 * We only need to (a) parse the document's text into a Worksheet for the
 * grid, (b) turn grid edits back into WorkspaceEdits against the document,
 * and (c) re-parse on `onDidChangeTextDocument` when the change did not
 * originate from us (i.e. the user edited the raw text, or another
 * extension/process touched the file and VS Code reloaded it).
 */
export class CsvDocumentSync implements vscode.Disposable {
  private worksheet: Worksheet;
  private dialect: CsvDialect;
  private truncated = false;
  private droppedRows = 0;
  private applyingOwnEdit = false;
  private readonly changeEmitter = new vscode.EventEmitter<{ external: boolean }>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly document: vscode.TextDocument) {
    const parsed = this.parse();
    this.worksheet = parsed.worksheet;
    this.dialect = parsed.dialect;
    this.truncated = parsed.truncated;
    this.droppedRows = parsed.droppedRows;

    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== this.document.uri.toString()) return;
        if (this.applyingOwnEdit) return; // change originated from us; already reflected in memory
        this.reparse();
        this.changeEmitter.fire({ external: true });
      }),
    );
  }

  private parse() {
    const buffer = Buffer.from(this.document.getText(), 'utf8');
    const ext = path.extname(this.document.uri.fsPath).toLowerCase();
    const settings = getCsvSettings();
    return parseCsv(buffer, ext, {
      delimiterOverride: settings.delimiter,
      hasHeaderRowOverride: settings.hasHeaderRow,
      maxRows: settings.maxRowsInMemory,
    });
  }

  private reparse(): void {
    const parsed = this.parse();
    this.worksheet = parsed.worksheet;
    // Preserve the *original* detected delimiter/header choice rather than
    // re-detecting on every keystroke, unless the user explicitly changes
    // the setting — flip-flopping delimiter detection mid-edit would be
    // disorienting (e.g. a single comma typed inside a still-unquoted field).
    this.dialect = { ...this.dialect, hasHeaderRow: parsed.dialect.hasHeaderRow };
    this.truncated = parsed.truncated;
    this.droppedRows = parsed.droppedRows;
  }

  getWorksheet(): Worksheet {
    return this.worksheet;
  }

  getDialect(): CsvDialect {
    return this.dialect;
  }

  getTruncationInfo(): { truncated: boolean; droppedRows: number } {
    return { truncated: this.truncated, droppedRows: this.droppedRows };
  }

  isDirty(): boolean {
    return this.document.isDirty;
  }

  getDocumentText(): string {
    return this.document.getText();
  }

  getSourcePath(): string {
    return this.document.uri.fsPath;
  }

  /**
   * Replace the entire document text (from the side-by-side text pane) and
   * re-parse into the in-memory worksheet.
   */
  async applyRawText(text: string): Promise<boolean> {
    const fullRange = new vscode.Range(
      this.document.positionAt(0),
      this.document.positionAt(this.document.getText().length),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, text);

    this.applyingOwnEdit = true;
    try {
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        this.reparse();
        this.changeEmitter.fire({ external: false });
      }
      return applied;
    } finally {
      this.applyingOwnEdit = false;
    }
  }

  /**
   * Apply a full-worksheet rewrite (used for cell edits, paste, sort,
   * filter-apply-as-edit, and data cleaning) as a single WorkspaceEdit so it
   * becomes exactly one entry in VS Code's undo stack.
   */
  async commitWorksheet(next: Worksheet): Promise<boolean> {
    this.worksheet = next;
    const text = serializeCsv(next, this.dialect);
    const fullRange = new vscode.Range(
      this.document.positionAt(0),
      this.document.positionAt(this.document.getText().length),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, text);

    this.applyingOwnEdit = true;
    try {
      const applied = await vscode.workspace.applyEdit(edit);
      return applied;
    } finally {
      this.applyingOwnEdit = false;
    }
  }

  async save(): Promise<boolean> {
    return this.document.save();
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.changeEmitter.dispose();
  }
}
