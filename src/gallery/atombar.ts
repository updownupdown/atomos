// The atom header: the bar across the top of an atom's screens, Build and Info. It holds the
// Build | Info switch across its width (Info's microscope sits at its end; the gallery adds
// it). Which atom is open, and the list of every atom, are in the dock's dropdown at the foot;
// the section's icon there goes back to the section's top. The host places the bar (a plain
// flex row 60px tall). Build and Info each mount one in the same place, so moving between them
// looks like one bar.
//
//   const bar = createAtomBar('build');
//   host.append(bar.el);
//   bar.set(26);
//
// Picking the other mode fires 'atomos:mode' (bubbling, detail { mode, z }); the app shell
// answers it.

import { MAX_Z, elementAt } from './data';
import { icon } from '../ui/icons';
import { createSegments } from '../ui/components';

export interface AtomBar {
  el: HTMLElement;
  /** The atom shown (for the switch's label). */
  set(z: number): void;
  readonly z: number;
}

export function createAtomBar(mode: 'build' | 'info'): AtomBar {
  const el = document.createElement('div');
  el.className = 'loupe-bar atom-bar';
  let z = 1;
  const seg = createSegments([
    { id: 'build', label: 'Build', icon: icon('mode-build', { size: 20 }) },
    { id: 'info', label: 'Info', icon: icon('info', { size: 20 }) },
  ], {
    active: mode,
    onChange: (to) => {
      el.dispatchEvent(new CustomEvent('atomos:mode', { bubbles: true, detail: { mode: to, z } }));
      // This bar belongs to its own mode: it reads so again once the page has moved on.
      window.setTimeout(() => seg.select(mode), 400);
    },
  });
  const wrap = document.createElement('div');
  wrap.className = 'mode-seg';
  wrap.append(seg.el);
  el.append(wrap);
  const set = (to: number) => {
    z = Math.max(1, Math.min(MAX_Z, to));
    seg.el.setAttribute('aria-label', `${elementAt(z).name}: Build or Info`);
  };
  set(z);
  return { el, set, get z() { return z; } };
}
