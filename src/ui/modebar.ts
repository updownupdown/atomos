// The mode row on Atom screens: under the atom bar (which sits under the header), a full-width radio choice between View and
// Build for this atom. Build always carries the atom's progress, a ring and a percentage,
// whichever mode is showing, so the player can see how far the atom has got from View too.
//
// The microscope is not here: each screen places its own with scienceButton().

import { createSegments, type Segments } from './components';
import { atomProgress } from '../core/progress';

export type AtomMode = 'view' | 'build';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let seg: Segments | null = null;
let currentZ: () => number = () => 1;
let ring: HTMLElement | null = null;
let pct: HTMLElement | null = null;

/** Build the row once. `onPick` runs when the player picks the other mode; `z` says which
 *  atom is on screen, for the progress on Build. */
export function initModeBar(onPick: (mode: AtomMode) => void, z: () => number): void {
  if (seg) return;
  currentZ = z;
  seg = createSegments([{ id: 'view', label: 'View' }, { id: 'build', label: 'Build' }], {
    label: 'Atom mode',
    onChange: (id) => onPick(id as AtomMode),
  });
  // Build reads: the ring on the left, the word, then the percentage on the right.
  const build = seg.el.querySelector('[data-id="build"]')!;
  ring = document.createElement('span');
  ring.className = 'mode-ring';
  ring.setAttribute('aria-hidden', 'true');
  pct = document.createElement('b');
  pct.className = 'mode-pct';
  build.prepend(ring);
  build.append(pct);
  $('mode-seg').append(seg.el);
  refreshModeProgress();
}

/** Show or hide the row, and mark the current mode. */
export function showModeBar(visible: boolean, mode: AtomMode): void {
  $('mode-row').hidden = !visible;
  seg?.select(mode);
  if (visible) refreshModeProgress();
}

/** Redraw Build's progress for the atom on screen. Call after a puzzle is solved. */
export function refreshModeProgress(): void {
  if (!ring || !pct) return;
  const p = Math.max(0, Math.min(1, atomProgress(currentZ())));
  const n = Math.round(p * 100);
  ring.classList.toggle('is-done', p >= 1);
  ring.innerHTML = `<svg viewBox="0 0 20 20"><circle class="mode-prog-track" cx="10" cy="10" r="7.5"/><circle class="mode-prog-arc" cx="10" cy="10" r="7.5" pathLength="100" stroke-dasharray="${n} 100"/></svg>`;
  pct.textContent = `${n}%`;
  pct.setAttribute('aria-label', `${n}% built`);
}

/** Screens used to put quick details beside the choice; the row no longer has that slot. Kept
 *  so callers still compile; it now just refreshes Build's progress. */
export function setModeDetail(_content?: string | Node | null): void {
  refreshModeProgress();
}
