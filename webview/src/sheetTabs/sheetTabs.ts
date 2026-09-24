import { appState } from '../state/appState';
import { postToHost } from '../app/vscodeApi';

export class SheetTabs {
  private container: HTMLElement;
  private onSwitch: ((name: string) => void) | undefined;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('sheetlab-sheet-tabs');
    this.container.setAttribute('role', 'tablist');
    appState.subscribe(() => this.render());
  }

  setOnSwitch(fn: (name: string) => void): void {
    this.onSwitch = fn;
  }

  render(): void {
    this.container.innerHTML = '';
    const kind = appState.meta?.sourceKind;
    // Excel + ODS support multi-sheet; CSV/TSV can still create extra sheets in-memory (export as xlsx to keep them).
    const multiSheet = kind === 'xlsx' || kind === 'xlsm' || kind === 'xls' || kind === 'ods' || kind === 'csv' || kind === 'tsv' || !kind;

    for (const name of appState.sheetOrder) {
      const wrap = document.createElement('div');
      wrap.className = 'sheetlab-sheet-tab-wrap';
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';

      const tab = document.createElement('button');
      tab.className = 'sheetlab-sheet-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(name === appState.activeSheet));
      tab.textContent = name;
      if (name === appState.activeSheet) tab.classList.add('sheetlab-sheet-tab-active');
      tab.addEventListener('click', () => {
        if (name === appState.activeSheet) return;
        appState.activeSheet = name;
        appState.selection = {
          active: { row: 0, col: 0 },
          range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
          editing: false,
        };
        appState.notify();
        postToHost({ type: 'switchSheet', sheetName: name });
        this.onSwitch?.(name);
      });
      tab.addEventListener('dblclick', () => this.renameTab(name));
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, name);
      });

      // Visible chevron so sheet options are always discoverable (not only via right-click).
      const menuBtn = document.createElement('button');
      menuBtn.className = 'sheetlab-sheet-tab-menu';
      menuBtn.textContent = '▾';
      menuBtn.title = `Options for ${name}`;
      menuBtn.style.border = 'none';
      menuBtn.style.background = 'transparent';
      menuBtn.style.cursor = 'pointer';
      menuBtn.style.padding = '0 4px';
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = menuBtn.getBoundingClientRect();
        this.showContextMenu(rect.left, rect.bottom + 2, name);
      });

      wrap.appendChild(tab);
      wrap.appendChild(menuBtn);
      this.container.appendChild(wrap);
    }

    if (multiSheet) {
      const addBtn = document.createElement('button');
      addBtn.className = 'sheetlab-sheet-tab-add';
      addBtn.textContent = '+';
      addBtn.title = 'New worksheet';
      addBtn.addEventListener('click', () => this.createSheet());
      this.container.appendChild(addBtn);
    }
  }

  private createSheet(): void {
    const name = prompt('New worksheet name:', `Sheet${appState.sheetOrder.length + 1}`);
    if (!name) return;
    postToHost({ type: 'createSheet', name });
  }

  private renameTab(oldName: string): void {
    const newName = prompt('Rename worksheet:', oldName);
    if (!newName || newName === oldName) return;
    postToHost({ type: 'renameSheet', oldName, newName });
  }

  private showContextMenu(x: number, y: number, name: string): void {
    document.querySelectorAll('.sheetlab-context-menu').forEach((el) => el.remove());

    const menu = document.createElement('div');
    menu.className = 'sheetlab-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = '10000';

    const addItem = (label: string, action: () => void) => {
      const item = document.createElement('div');
      item.className = 'sheetlab-context-menu-item';
      item.textContent = label;
      item.addEventListener('click', () => {
        action();
        menu.remove();
      });
      menu.appendChild(item);
    };

    addItem('Rename', () => this.renameTab(name));
    addItem('Duplicate sheet', () => {
      const newName = prompt('Duplicate as:', `${name} Copy`);
      if (!newName) return;
      postToHost({ type: 'createSheet', name: newName });
      // Host should copy content; for now create empty then paste is a follow-up.
      // Prefer dedicated duplicate if host supports it via rename/create flow.
    });
    if (appState.sheetOrder.length > 1) {
      addItem('Delete', () => {
        if (confirm(`Delete worksheet "${name}"?`)) {
          postToHost({ type: 'deleteSheet', name });
        }
      });
    }

    document.body.appendChild(menu);

    const closeOnce = () => {
      menu.remove();
      document.removeEventListener('click', closeOnce);
    };
    setTimeout(() => document.addEventListener('click', closeOnce), 0);
  }
}
