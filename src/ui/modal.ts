// One modal sheet for the whole app: settings, element cards, the science
// behind a puzzle. It lives outside every screen so any of them can open it.
// Every sheet gets an X in its top-right corner; there is no need for a Close button.
// The title (the sheet's first heading) and the X stay pinned while the sheet scrolls.

import { closeButton } from './components';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let cleanup: (() => void) | null = null;
let bound = false;

function bind(): void {
  if (bound) return;
  bound = true;
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOpen()) closeModal(); });
}

/** Fills the sheet and shows it; returns the sheet so callers can wire buttons. */
export function openModal(html: string, onClose: (() => void) | null = null): HTMLElement {
  bind();
  cleanup?.();
  cleanup = onClose;
  const sheet = $('modal-sheet');
  sheet.innerHTML = html;
  sheet.prepend(stickyHead(sheet));
  $('modal').hidden = false;
  sheet.scrollTop = 0;
  return sheet;
}

/** A pinned header holding the sheet's leading heading (if it opens with one) and the X. */
export function stickyHead(card: HTMLElement, onClose: () => void = closeModal): HTMLElement {
  const head = document.createElement('div');
  head.className = 'ui-modal-head';
  const first = card.firstElementChild;
  if (first && /^H[1-3]$/.test(first.tagName)) head.append(first);
  head.append(closeButton(onClose));
  return head;
}

export function closeModal(): void {
  cleanup?.();
  cleanup = null;
  $('modal').hidden = true;
}

export function modalOpen(): boolean {
  return !$('modal').hidden;
}
