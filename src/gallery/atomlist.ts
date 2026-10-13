// The atom list: every atom in one plain list, grouped by period, for getting from one atom to
// another quickly. Each row is the atom's number, symbol and name, then two bars: its stable
// parts and its fleeting isotopes. No pictures, so it opens at once.
//
// It opens from the collection button (createListToggle) at the top right of Collect's title row
// and of the atom bar, and looks the same from both. The button shows the whole collection's
// progress (atoms built, of 118, as its count and its fill) and turns its chevron while the list
// is open. The list drops from under the bar that holds the button; tapping a row picks that
// atom and closes it, as do the button again, the mask below it, Escape and the system Back.
//
//   const toggle = createListToggle({ current: () => z, onPick: (z) => show(z) });
//   bar.append(toggle.el);

import { MAX_Z, elementAt } from './data';
import { atomBuilt, fleetingCount, rowOpen, rowSpan, segmentsOf } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import { fleetingOpen } from './locks';
import { icon } from '../ui/icons';
import './atomlist.css';

export interface ListToggleOptions {
  /** The atom on screen now: marked in the list and scrolled to. */
  current: () => number;
  /** A row was tapped: the list has started closing. */
  onPick: (z: number) => void;
}

export interface ListToggle {
  el: HTMLButtonElement;
  /** Repaint the count and fill (progress changed). */
  refresh(): void;
}

/** The whole collection: atoms built, and the shares of the stable parts and fleeting
 *  isotopes built, from 0 to 1. */
export function collectionProgress(save: SaveData): { built: number; atoms: number; stable: number; fleeting: number } {
  let built = 0, sb = 0, st = 0, fb = 0, ft = 0;
  for (let z = 1; z <= MAX_Z; z++) {
    if (atomBuilt(z, save)) built++;
    const segs = segmentsOf(z, save);
    sb += segs.filter((s) => s.done).length;
    st += segs.length;
    const f = fleetingCount(z, save);
    fb += f.built;
    ft += f.total;
  }
  return { built, atoms: MAX_Z, stable: st ? sb / st : 0, fleeting: ft ? fb / ft : 0 };
}

/** One atom's two shares: its stable parts, and its fleeting isotopes (null when it has none
 *  or they are not open yet). */
export function atomShares(z: number, save: SaveData, fleetOn = fleetingOpen(save)): { stable: number; fleeting: number | null } {
  const segs = segmentsOf(z, save);
  const f = fleetingCount(z, save);
  return {
    stable: segs.length ? segs.filter((s) => s.done).length / segs.length : 0,
    fleeting: fleetOn && f.total ? f.built / f.total : null,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** A share as a bar: cyan while it runs, green once full, empty track before it starts. */
export function shareBar(share: number | null, cls = ''): string {
  if (share === null) return `<span class="al-bar is-off ${cls}"></span>`;
  return `<span class="al-bar ${cls}${share >= 1 ? ' is-done' : ''}"><i style="width:${pct(share)}"></i></span>`;
}

const toggles = new Set<ListToggle & { setOpen(open: boolean): void }>();
let openList: { close: () => void } | null = null;

export function createListToggle(o: ListToggleOptions): ListToggle {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'alist-toggle';
  el.setAttribute('aria-expanded', 'false');
  el.setAttribute('aria-haspopup', 'dialog');
  el.innerHTML = `<span class="alist-fill"></span><span class="alist-count"></span>${icon('chevron-down', { size: 18 })}`;
  const fill = el.querySelector<HTMLElement>('.alist-fill')!;
  const count = el.querySelector<HTMLElement>('.alist-count')!;
  const t = {
    el,
    refresh() {
      const save = loadSave();
      let built = 0;
      for (let z = 1; z <= MAX_Z; z++) if (atomBuilt(z, save)) built++;
      count.textContent = `${built}/${MAX_Z}`;
      fill.style.width = pct(built / MAX_Z);
      el.setAttribute('aria-label', `Your collection: ${built} of ${MAX_Z} atoms built. ${el.getAttribute('aria-expanded') === 'true' ? 'Hide' : 'Show'} all atoms`);
    },
    setOpen(open: boolean) {
      el.setAttribute('aria-expanded', String(open));
      el.classList.toggle('is-open', open);
      t.refresh();
    },
  };
  el.onclick = () => {
    if (openList) { openList.close(); return; }
    openAtomList(el, o);
  };
  toggles.add(t);
  window.addEventListener('atomos:progress', () => t.refresh());
  t.refresh();
  return t;
}

/** Open the list under the bar holding `anchor`. */
function openAtomList(anchor: HTMLElement, o: ListToggleOptions): void {
  const save = loadSave();
  const fleetOn = fleetingOpen(save);
  const current = o.current();
  const bar = anchor.closest<HTMLElement>('.nav, .atom-bar') ?? anchor;
  const top = Math.round(bar.getBoundingClientRect().bottom);

  const scrim = document.createElement('div');
  scrim.className = 'alist-scrim';
  scrim.style.setProperty('--alist-top', `${top}px`);
  const panel = document.createElement('section');
  panel.className = 'alist';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'All atoms');

  const all = collectionProgress(save);
  const stat = (ico: string, word: string, text: string) => `<span class="al-stat"><span class="al-stat-ico">${icon(ico as never, { size: 18 })}</span>${word} <b>${text}</b></span>`;
  let html = `<div class="al-sum">${stat('atom', 'Atoms', `${all.built} of ${all.atoms}`)}${stat('isotope-stable', 'Stable', pct(all.stable))}${fleetOn ? stat('isotope-fleeting', 'Fleeting', pct(all.fleeting)) : ''}</div>`;
  html += `<div class="al-key" aria-hidden="true"><span>#</span><span></span><span>Atom</span><span class="al-key-bars">Stable · Fleeting</span></div>`;
  for (let p = 1; p <= 7; p++) {
    const [first, last] = rowSpan(p);
    let built = 0;
    for (let z = first; z <= last; z++) if (atomBuilt(z, save)) built++;
    const open = rowOpen(p, save);
    html += `<h3 class="al-period${open ? '' : ' is-locked'}">${open ? '' : `<span class="al-lock">${icon('lock', { size: 16 })}</span>`}Period ${p}<small>${built} of ${last - first + 1} built</small></h3><ul class="al-rows">`;
    for (let z = first; z <= last; z++) {
      const e = elementAt(z);
      const s = atomShares(z, save, fleetOn);
      const done = atomBuilt(z, save);
      html += `<li><button type="button" class="al-row${z === current ? ' is-current' : ''}${done ? ' is-built' : ''}" data-z="${z}" aria-label="${esc(`${e.name}, ${z}: ${pct(s.stable)} stable${s.fleeting === null ? '' : `, ${pct(s.fleeting)} fleeting`}`)}"${z === current ? ' aria-current="true"' : ''}>`
        + `<span class="al-z">${z}</span><b class="al-sym">${e.symbol}</b><span class="al-name">${esc(e.name)}</span>`
        + `<span class="al-bars">${shareBar(s.stable)}${shareBar(s.fleeting)}</span></button></li>`;
    }
    html += '</ul>';
  }
  panel.innerHTML = html;
  scrim.append(panel);
  document.body.append(scrim);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openList = null;
    window.removeEventListener('keydown', onKey, true);
    for (const t of toggles) t.setOpen(false);
    scrim.classList.remove('is-open');
    const done = () => scrim.remove();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setTimeout(done, 200);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  window.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.al-row');
    if (row) { close(); o.onPick(Number(row.dataset.z)); return; }
    if (e.target === scrim) close();
  });
  openList = { close };
  for (const t of toggles) if (t.el === anchor) t.setOpen(true);

  // The atom on screen sits in the middle of the list's view.
  const cur = panel.querySelector<HTMLElement>('.al-row.is-current');
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    if (cur) {
      panel.scrollTop = Math.max(0, cur.offsetTop - panel.clientHeight / 2 + cur.offsetHeight / 2);
      cur.focus({ preventScroll: true });
    } else panel.querySelector<HTMLElement>('.al-row')?.focus({ preventScroll: true });
  });
}

/** Close the list if it is open (the screen is changing). */
export function closeAtomList(): void {
  openList?.close();
}
