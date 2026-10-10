// The mode row on Atom screens: under the atom bar (which sits under the header), a full-width
// choice between View and Build for this atom. Build's background fills from the left with the
// atom's progress, whichever mode is showing, so the player can see how far it has got.
//
// The microscope is not here: each screen places its own with scienceButton().

import { createSegments, type Segments } from './components';
import { atomProgress } from '../core/progress';

export type AtomMode = 'view' | 'build';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let seg: Segments | null = null;
let currentZ: () => number = () => 1;
let build: HTMLElement | null = null;

/** Build the row once. `onPick` runs when the player picks the other mode; `z` says which
 *  atom is on screen, for the progress on Build. */
export function initModeBar(onPick: (mode: AtomMode) => void, z: () => number): void {
  if (seg) return;
  currentZ = z;
  seg = createSegments([{ id: 'view', label: 'View' }, { id: 'build', label: 'Build' }], {
    label: 'Atom mode',
    onChange: (id) => onPick(id as AtomMode),
  });
  build = seg.el.querySelector<HTMLElement>('[data-id="build"]');
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
  if (!build) return;
  const n = Math.round(Math.max(0, Math.min(1, atomProgress(currentZ()))) * 100);
  build.style.setProperty('--p', `${n}%`);
  build.classList.toggle('is-built', n >= 100);
  build.setAttribute('aria-label', `Build, ${n}% built`);
}

/** Screens used to put quick details beside the choice; the row no longer has that slot. Kept
 *  so callers still compile; it now just refreshes Build's progress. */
export function setModeDetail(_content?: string | Node | null): void {
  refreshModeProgress();
}
