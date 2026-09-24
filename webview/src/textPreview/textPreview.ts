import { appState } from '../state/appState';
import { postToHost } from '../app/vscodeApi';

/**
 * Raw CSV/TSV text pane for side-by-side (or text-only) preview.
 * Edits are applied back through the Custom Text Document via the host.
 */
export class TextPreview {
  private container: HTMLElement;
  private header!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private applyingFromHost = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-text-preview');
    this.build();
    appState.subscribe(() => this.syncFromState());
  }

  private build(): void {
    this.header = document.createElement('div');
    this.header.className = 'sheetlab-text-preview-header';
    this.header.textContent = 'Source text';

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'sheetlab-text-preview-area';
    this.textarea.spellcheck = false;
    this.textarea.setAttribute('aria-label', 'CSV/TSV source text');
    this.textarea.addEventListener('input', () => this.onUserEdit());

    this.container.appendChild(this.header);
    this.container.appendChild(this.textarea);
  }

  private syncFromState(): void {
    const isCsv = appState.meta?.sourceKind === 'csv' || appState.meta?.sourceKind === 'tsv';
    this.container.style.display =
      isCsv && (appState.viewMode === 'text' || appState.viewMode === 'split') ? 'flex' : 'none';

    if (!isCsv) return;
    this.header.textContent = appState.meta.sourceKind === 'tsv' ? 'TSV source' : 'CSV source';

    // Avoid overwriting while the user is typing in this pane.
    if (!this.applyingFromHost && document.activeElement === this.textarea) return;
    if (this.textarea.value !== appState.textContent) {
      const selStart = this.textarea.selectionStart;
      const selEnd = this.textarea.selectionEnd;
      this.textarea.value = appState.textContent;
      try {
        this.textarea.setSelectionRange(selStart, selEnd);
      } catch {
        /* ignore */
      }
    }
  }

  private onUserEdit(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      postToHost({ type: 'applyTextContent', text: this.textarea.value });
    }, 400);
  }

  /** Host pushed new text (external edit or after grid commit). */
  setTextFromHost(text: string): void {
    this.applyingFromHost = true;
    appState.textContent = text;
    this.textarea.value = text;
    appState.notify();
    this.applyingFromHost = false;
  }
}
