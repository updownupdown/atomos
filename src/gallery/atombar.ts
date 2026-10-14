// The atom header, retired: an atom's screens have no header now. Build and Learn are buttons in
// the dock (src/ui/dock.ts), beside the atom's dropdown, and Learn's tabs are the top of its
// screen. Build and Info still mount one each, so this keeps their place: an empty, hidden bar.
//
//   const bar = createAtomBar('build');
//   host.append(bar.el);
//   bar.set(26);

import { MAX_Z } from './data';

export interface AtomBar {
  el: HTMLElement;
  /** The atom shown. */
  set(z: number): void;
  readonly z: number;
}

export function createAtomBar(_mode: 'build' | 'info'): AtomBar {
  const el = document.createElement('div');
  el.className = 'atom-bar';
  el.hidden = true;
  let z = 1;
  const set = (to: number) => { z = Math.max(1, Math.min(MAX_Z, to)); };
  return { el, set, get z() { return z; } };
}
