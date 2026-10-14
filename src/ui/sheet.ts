// The sheets the header opens. Search and Settings drop from the top of the screen: a title row
// with the sheet's icon and name and a round close button. The atom list and the game list drop
// from the bar's dropdown, under the header, which stays above their mask so the dropdown and
// the mark still answer: their title is small, at the bottom left beside a chevron up that
// pulls the list back up. Each has an optional bar that stays put at its top (the atom list's
// Collect | Learn, search's field), a body that scrolls and an optional foot. One is open at a
// time; Escape, the close button, the mask and Back close it.
//
//   const s = openSheet({ title: 'Games', icon: 'puzzles', label: 'All games', from: 'bar' });
//   s.body.append(list);

import { icon, type IconName } from './icons';
import './sheet.css';

export interface SheetOptions {
  /** The words in the title row. */
  title: string;
  /** The icon before them. */
  icon?: IconName;
  /** The sheet's accessible name. */
  label: string;
  /** Drops from under the header (the bar's dropdowns), or from the top of the screen. */
  from: 'bar' | 'top';
  className?: string;
  onClose?: () => void;
}

export interface Sheet {
  readonly panel: HTMLElement;
  /** The title row: the title, then the close button; under the header, the small title and its
   *  chevron at the bottom left, before the foot. */
  readonly head: HTMLElement;
  /** Under the title row, staying put; empty and hidden unless something is put in it. */
  readonly bar: HTMLElement;
  /** The part that scrolls. */
  readonly body: HTMLElement;
  /** Under the body, staying put; hidden while empty. */
  readonly foot: HTMLElement;
  close(): void;
}

let current: Sheet | null = null;

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function openSheet(o: SheetOptions): Sheet {
  current?.close();
  const scrim = document.createElement('div');
  scrim.className = `sheet-scrim sheet-scrim--${o.from}`;
  const panel = document.createElement('section');
  panel.className = `sheet${o.className ? ` ${o.className}` : ''}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', o.label);
  const shut = document.createElement('button');
  shut.type = 'button';
  if (o.from === 'bar') {
    panel.innerHTML = '<div class="sheet-bar"></div><div class="sheet-body"></div><div class="sheet-tail"><div class="sheet-head"></div><div class="sheet-foot"></div></div>';
    shut.className = 'sheet-up';
    shut.setAttribute('aria-label', `Close ${o.title}`);
    shut.innerHTML = `${icon('chevron-up', { size: 20 })}<span>${o.title}</span>`;
    panel.querySelector('.sheet-head')!.append(shut);
  } else {
    panel.innerHTML = `<div class="sheet-head"><h2 class="sheet-title">${o.icon ? icon(o.icon, { size: 22 }) : ''}<span>${o.title}</span></h2></div>`
      + '<div class="sheet-bar"></div><div class="sheet-body"></div><div class="sheet-foot"></div>';
    shut.className = 'sheet-close';
    shut.setAttribute('aria-label', 'Close');
    shut.innerHTML = icon('close', { size: 22 });
    panel.querySelector('.sheet-head')!.append(shut);
  }
  const head = panel.querySelector<HTMLElement>('.sheet-head')!;
  scrim.append(panel);
  document.body.append(scrim);

  let closed = false;
  const sheet: Sheet = {
    panel,
    head,
    bar: panel.querySelector<HTMLElement>('.sheet-bar')!,
    body: panel.querySelector<HTMLElement>('.sheet-body')!,
    foot: panel.querySelector<HTMLElement>('.sheet-foot')!,
    close() {
      if (closed) return;
      closed = true;
      if (current === sheet) current = null;
      window.removeEventListener('keydown', onKey, true);
      scrim.classList.remove('is-open');
      o.onClose?.();
      if (still()) scrim.remove(); else window.setTimeout(() => scrim.remove(), 220);
    },
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); sheet.close(); } };
  window.addEventListener('keydown', onKey, true);
  shut.onclick = () => sheet.close();
  scrim.addEventListener('click', (e) => { if (e.target === scrim) sheet.close(); });
  current = sheet;
  requestAnimationFrame(() => scrim.classList.add('is-open'));
  return sheet;
}

/** Close the open sheet, if any (the screen is changing). */
export function closeSheet(): void {
  current?.close();
}

/** The sheet open now, if any. */
export function openSheetPanel(): HTMLElement | null {
  return current?.panel ?? null;
}

/** A search field for a sheet's bar: the magnifier, the input and, once something is typed, a
 *  clear button (the app's own icon, not the browser's). Typing and clearing fire 'input'. */
export function sheetSearch(o: { placeholder: string; label: string }): { el: HTMLLabelElement; input: HTMLInputElement } {
  const el = document.createElement('label');
  el.className = 'al-search';
  el.innerHTML = `${icon('search', { size: 20 })}<input type="search" placeholder="${o.placeholder}" aria-label="${o.label}" autocomplete="off" enterkeyhint="search">`
    + `<button type="button" class="al-clear" aria-label="Clear" hidden>${icon('clear', { size: 22 })}</button>`;
  const input = el.querySelector('input')!;
  const clear = el.querySelector<HTMLButtonElement>('.al-clear')!;
  input.addEventListener('input', () => { clear.hidden = !input.value; });
  clear.onclick = (e) => {
    e.preventDefault();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };
  return { el, input };
}
