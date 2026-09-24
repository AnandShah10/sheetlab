/**
 * Position a fixed menu so it stays fully inside the viewport.
 * Prefers opening upward when the anchor is in the lower half (sheet tabs).
 */
export function positionMenu(
  menu: HTMLElement,
  x: number,
  y: number,
  opts?: { preferUp?: boolean },
): void {
  menu.style.position = 'fixed';
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.visibility = 'hidden';
  menu.style.zIndex = '10000';
  menu.style.maxHeight = 'min(320px, calc(100vh - 16px))';
  menu.style.overflowY = 'auto';
  menu.style.overflowX = 'hidden';

  // Must be in the DOM to measure
  if (!menu.parentElement) document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;

  let left = x;
  let top = y;

  if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
  if (left < pad) left = pad;

  const preferUp = opts?.preferUp ?? y > vh * 0.55;
  if (preferUp) {
    top = y - rect.height;
    if (top < pad) {
      // Not enough room above — open down but clamp
      top = Math.min(y, vh - rect.height - pad);
      if (top < pad) top = pad;
    }
  } else {
    if (top + rect.height > vh - pad) {
      top = Math.max(pad, y - rect.height);
    }
  }

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.visibility = 'visible';
}
