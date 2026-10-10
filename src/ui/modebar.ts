// The mode row on Atom screens: under the header, a radio choice between View and Build for
// this atom, then a slot for quick details about the mode, then the microscope.
//
// The shell owns the choice and fills the slot with a default (the element's number and
// name). A screen can put its own details in the slot while it shows:
//
//   setModeDetail(`<b>3 of 5</b> puzzles solved`);   // HTML string or a Node
//   setModeDetail(null);                              // back to the default
//
// The shell resets the slot to the default whenever the screen or mode changes.

import { createSegments, type Segments } from './components';
import { scienceButton } from './science';

export type AtomMode = 'view' | 'build';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let seg: Segments | null = null;
let fallback: string | Node = '';
let custom = false;

const put = (content: string | Node) => {
  const slot = $('mode-detail');
  if (typeof content === 'string') slot.innerHTML = content;
  else slot.replaceChildren(content);
};

/** Build the row once; `onPick` runs when the player picks the other mode. */
export function initModeBar(onPick: (mode: AtomMode) => void): void {
  if (seg) return;
  seg = createSegments([{ id: 'view', label: 'View' }, { id: 'build', label: 'Build' }], {
    label: 'Atom mode',
    onChange: (id) => onPick(id as AtomMode),
  });
  $('mode-seg').append(seg.el);
  $('mode-row').append(scienceButton());
}

/** Show or hide the row, and mark the current mode. */
export function showModeBar(visible: boolean, mode: AtomMode): void {
  $('mode-row').hidden = !visible;
  seg?.select(mode);
}

/** A screen's own quick details for the mode, or null for the default. */
export function setModeDetail(content: string | Node | null): void {
  custom = content !== null;
  put(content ?? fallback);
}

/** The shell's default details; shown whenever no screen has set its own. */
export function setModeDefault(content: string | Node, reset = false): void {
  fallback = content;
  if (reset) custom = false;
  if (!custom) put(content);
}
