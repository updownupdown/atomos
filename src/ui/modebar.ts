// The mode row on Atom screens, under the atom bar: Build (first, since that is where the game
// moves forward), View (the 3D atom) and Info (the element's pages). progressHtml, the ring and
// percentages, is shared with the gallery's views row.
//
// The microscope is not here: each screen places its own with scienceButton().

import { createSegments, type Segments } from './components';
import { atomProgress, fleetingCount } from '../core/progress';

export type AtomMode = 'view' | 'build' | 'info';

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
    { id: 'build', label: 'Build' },
    { id: 'view', label: 'View' },
    { id: 'info', label: 'Info' },
  ], {
    label: 'Atom mode',
    onChange: (id) => onPick(id as AtomMode),
  });
  // The row is the choice alone: the atom's progress lives on its Build page.
  $('mode-seg').append(seg.el);
}

/** Show or hide the row, and mark the current mode. */
export function showModeBar(visible: boolean, mode: AtomMode): void {
  $('mode-row').hidden = !visible;
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
