/**
 * Small inline SVG icons for the toolbar. The `sheetlab-icon-*` CSS classes
 * previously applied to toolbar buttons had no actual icon defined anywhere
 * -- this module is what those classes were meant to hook up to.
 *
 * Kept as plain geometric SVG (rects/lines/circles/simple paths) rather
 * than a bundled icon font, since the webview has no font-loading step of
 * its own; each icon inherits `currentColor` so it follows the button's
 * text color (and therefore VS Code's theme) automatically.
 */
const ICONS: Record<string, string> = {
  save: '<path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 2v4h5V2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 10h6v4H5z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  undo: '<path d="M4 8h7a3 3 0 1 1 0 6h-2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 5.5 4 8l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  redo: '<path d="M12 8H5a3 3 0 1 0 0 6h2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 5.5 12 8l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="10.2" y1="10.2" x2="14" y2="14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  'sort-asc': '<path d="M4 11h3M4 8h5M4 5h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 5v6M12 11l-2-2M12 11l2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  'sort-desc': '<path d="M4 11h7M4 8h5M4 5h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 5v6M12 5l-2 2M12 5l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  filter: '<path d="M3 3h10l-4 5v4l-2 1V8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  query: '<ellipse cx="8" cy="4" rx="4.5" ry="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 4v7c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 7.5c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  clean: '<path d="M8 2l.9 2.6L11.5 5l-2.6.9L8 8.5l-.9-2.6L4.5 5l2.6-.9z" fill="currentColor"/><path d="M4 11l.5 1.5L6 13l-1.5.5L4 15l-.5-1.5L2 13l1.5-.5z" fill="currentColor"/><path d="M12 9l.4 1.2L13.6 10.6l-1.2.4L12 12.2l-.4-1.2L10.4 10.6l1.2-.4z" fill="currentColor"/>',
  freeze: '<line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.2"/><line x1="3" y1="4.5" x2="13" y2="11.5" stroke="currentColor" stroke-width="1.2"/><line x1="13" y1="4.5" x2="3" y2="11.5" stroke="currentColor" stroke-width="1.2"/>',
  'border-all': '<rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1"/><line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1"/>',
  'border-none': '<rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.5 2"/>',
};

export function createIcon(name: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('sheetlab-btn-icon');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

export function hasIcon(name: string): boolean {
  return name in ICONS;
}