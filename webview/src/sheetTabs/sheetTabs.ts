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
    if (appState.sheetOrder.length <= 1 && appState.meta?.sourceKind !== 'xlsx' && appState.meta?.sourceKind !== 'xlsm') {
      // Single-sheet CSV: still show one tab for consistency, but hide add/manage affordances.
    }

    for (const name of appState.sheetOrder) {
      const tab = document.createElement('button');
      tab.className = 'sheetlab-sheet-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(name === appState.activeSheet));
      tab.textContent = name;
      if (name === appState.activeSheet) tab.classList.add('sheetlab-sheet-tab-active');
      tab.addEventListener('click', () => {
        if (name === appState.activeSheet) return;
        postToHost({ type: 'switchSheet', sheetName: name });
        this.onSwitch?.(name);
      });
      tab.addEventListener('dblclick', () => this.renameTab(name));
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e, name);
      });
      this.container.appendChild(tab);
    }

    const isExcel = appState.meta?.sourceKind === 'xlsx' || appState.meta?.sourceKind === 'xlsm' || appState.meta?.sourceKind === 'xls';
    if (isExcel) {
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

  private showContextMenu(e: MouseEvent, name: string): void {
    const menu = document.createElement('div');
    menu.className = 'sheetlab-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const rename = document.createElement('div');
    rename.className = 'sheetlab-context-menu-item';
    rename.textContent = 'Rename';
    rename.addEventListener('click', () => {
      this.renameTab(name);
      menu.remove();
    });

    const del = document.createElement('div');
    del.className = 'sheetlab-context-menu-item';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      if (confirm(`Delete worksheet "${name}"?`)) {
        postToHost({ type: 'deleteSheet', name });
      }
      menu.remove();
    });

    menu.appendChild(rename);
    menu.appendChild(del);
    document.body.appendChild(menu);

    const closeOnce = () => {
      menu.remove();
      document.removeEventListener('click', closeOnce);
    };
    setTimeout(() => document.addEventListener('click', closeOnce), 0);
  }
}
