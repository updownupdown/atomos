// The mode bar on Atom screens: a bar floating at the foot of the screen with View (the 3D
// atom), Build (its puzzles) and Info (the element's pages), in that order. A swipe sideways
// along the bar, or across the Build and Info pages, steps to the mode beside. progressHtml, the
// ring and percentages, is shared with the gallery's views row.
//
// The microscope is not here: each screen places its own with scienceButton().

import { createSegments, type Segments } from './components';
import { atomProgress, fleetingCount } from '../core/progress';

export type AtomMode = 'view' | 'build' | 'info';

/** The modes, left to right. */
export const MODES: AtomMode[] = ['view', 'build', 'info'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let seg: Segments | null = null;
let currentZ: () => number = () => 1;
let prog: HTMLElement | null = null;

/** The ring and percentages the mode rows share; the gallery's views row shows the figures
 *  alone (`ring` false). The percentage turns green at 100%. */
export function progressHtml(main: number, extra?: { label: string; pct: number } | null, ring = true): string {
  const n = Math.round(Math.max(0, Math.min(1, main)) * 100);
  const arc = `<span class="mode-ring${n >= 100 ? ' is-done' : ''}" aria-hidden="true"><svg viewBox="0 0 20 20"><circle class="mode-prog-track" cx="10" cy="10" r="7.5"/><circle class="mode-prog-arc" cx="10" cy="10" r="7.5" pathLength="100" stroke-dasharray="${n} 100"/></svg></span>`;
  const sub = extra ? `<small class="mode-sub">${Math.round(extra.pct * 100)}% ${extra.label}</small>` : '';
  return `${ring ? arc : ''}<span class="mode-figs"><b class="mode-pct${n >= 100 ? ' is-done' : ''}">${n}%</b>${sub}</span>`;
}

/** Build the row once. `onPick` runs when the player picks the other mode; `z` says which
 *  atom is on screen, for the progress. */
export function initModeBar(onPick: (mode: AtomMode) => void, z: () => number): void {
  if (seg) return;
  currentZ = z;
  seg = createSegments([
    { id: 'view', label: 'View' },
    { id: 'build', label: 'Build' },
    { id: 'info', label: 'Info' },
  ], {
    label: 'Atom mode',
    onChange: (id) => onPick(id as AtomMode),
  });
  // The row is the choice alone: the atom's progress lives on its Build page.
  $('mode-seg').append(seg.el);
  swipeModes((step) => {
    const at = MODES.indexOf(current);
    const to = MODES[at + step];
    if (to) onPick(to);
  });
}

let current: AtomMode = 'view';

/** A quick sideways swipe on an Atom screen steps between modes: anywhere on the bar, and on
 *  pages that only scroll up and down. Never on the 3D atom (dragging it turns and focuses it),
 *  on sliders, or on anything that scrolls sideways itself. */
function swipeModes(step: (dir: 1 | -1) => void): void {
  let start: { x: number; y: number; id: number } | null = null;
  const blocked = (t: EventTarget | null): boolean => {
    let el = t instanceof Element ? t : null;
    if (!el || el.closest('canvas, input, textarea, select, [role="slider"], .modal, .win, [data-no-swipe]')) return true;
    if (el.closest('#mode-row')) return false;
    if (!el.closest('.atom-panel, .build-home')) return true;
    for (; el && el !== document.body; el = el.parentElement) {
      const o = getComputedStyle(el).overflowX;
      if ((o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
    }
    return false;
  };
  document.addEventListener('pointerdown', (e) => {
    const on = document.body.dataset.screen?.startsWith('atom') && !document.body.classList.contains('puzzling') && !$('mode-row').hidden;
    start = on && e.isPrimary && !blocked(e.target) ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  }, true);
  document.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      // The tap that ends a swipe on the bar must not also pick the segment under it.
      const eat = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', eat, true), 50);
      step(dx < 0 ? 1 : -1);
    }
  }, true);
  document.addEventListener('pointercancel', () => { start = null; }, true);
}

/** Show or hide the row, and mark the current mode. */
export function showModeBar(visible: boolean, mode: AtomMode): void {
  $('mode-row').hidden = !visible;
  current = mode;
  seg?.select(mode);
  if (visible) refreshModeProgress();
}

/** Redraw the progress for the atom on screen. Call after a puzzle is solved. */
export function refreshModeProgress(): void {
  if (!prog) return;
  const z = currentZ();
  const main = atomProgress(z);
  const f = fleetingCount(z);
  const extra = f.total ? { label: 'fleeting', pct: f.built / f.total } : null;
  prog.innerHTML = progressHtml(main, extra);
  const n = Math.round(main * 100);
  prog.setAttribute('aria-label', extra ? `${n}% built, ${Math.round(extra.pct * 100)}% of fleeting isotopes` : `${n}% built`);
}

/** Screens used to put quick details beside the choice; the row no longer has that slot. Kept
 *  so callers still compile; it now just refreshes the progress. */
export function setModeDetail(_content?: string | Node | null): void {
  refreshModeProgress();
}
