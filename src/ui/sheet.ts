// The sheets the dock and the header open: the atom list and the game list rise from the dock's
// dropdown, and search drops from the top. One is open at a time. Each has a title row with a
// close button, an optional bar that stays put under it (the atom list's Collect | Learn), a body
// that scrolls and an optional foot. Escape, the close button, the mask and Back close it; the
// dock stays above the mask, so its sections and dropdown still answer while a sheet is up.
//
//   const s = openSheet({ title: 'Games', label: 'All games', from: 'dock' });
//   s.body.append(list);

import { icon } from './icons';
import './sheet.css';

export interface SheetOptions {
  /** The words in the title row; null for none (search puts its field there instead). */
  title: string | null;
  /** The sheet's accessible name. */
  label: string;
  /** Rises from above the dock, or drops from the top of the screen. */
  from: 'dock' | 'top';
  className?: string;
  onClose?: () => void;
}

export interface Sheet {
  readonly panel: HTMLElement;
  /** The title row: the title (if any), then the close button. */
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
  panel.innerHTML = `${o.from === 'dock' ? '<span class="sheet-grab" aria-hidden="true"></span>' : ''}<div class="sheet-head">${o.title ? `<h2 class="sheet-title">${o.title}</h2>` : ''}</div>`
    + '<div class="sheet-bar"></div><div class="sheet-body"></div><div class="sheet-foot"></div>';
  const head = panel.querySelector<HTMLElement>('.sheet-head')!;
  const shut = document.createElement('button');
  shut.type = 'button';
  shut.className = 'sheet-close';
  shut.setAttribute('aria-label', 'Close');
  shut.innerHTML = icon('close', { size: 22 });
  head.append(shut);
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
