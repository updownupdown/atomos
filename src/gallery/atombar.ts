// The atom navigator: the bar across the top of the atom screens. The host places it (the
// element is a plain flex row 60px tall). It is the top of the atom screens, which have no
// title row. Left to right: Back (to Collect, or Tables if the atom was opened there), the
// element (its number and symbol on one line, its name under them in the screen titles' style),
// and the Atoms button (atomlist.ts), which opens the list of every atom; a tap on the name opens
// it too. (The Build page's single track marks its own Stable and Fleeting parts, so the bar
// carries no legend.)
// View's loupe and Build both mount one, so moving between elements looks and works the same
// in each.
// Long names (Rutherfordium on a 360px phone) never truncate: fit() steps the name down in size
// until it fits.
//
//   const bar = createAtomBar({ onChange: (z) => show(z), locked: (z) => !collected(z) });
//   host.append(bar.el);
//   bar.set(26);
//
// Back fires 'atomos:collect' (bubbling, detail { z }); the app shell answers it.

import { MAX_Z, elementAt } from './data';
import { icon } from '../ui/icons';
import { createListToggle } from './atomlist';

export interface AtomBarOptions {
  /** The player stepped or picked another element; the bar has already moved to it. */
  onChange: (z: number) => void;
  /** Elements not open yet (the list marks their periods). */
  locked?: (z: number) => boolean;
}

export interface AtomBar {
  el: HTMLElement;
  /** Show an element without calling onChange. */
  set(z: number): void;
  readonly z: number;
}

const FIT_STEPS = 10;

export function createAtomBar(o: AtomBarOptions): AtomBar {
  const el = document.createElement('footer');
  el.className = 'loupe-bar atom-bar';
  el.innerHTML = `<button class="bar-btn bar-collect" aria-label="Back" title="Back">${icon('chevron-left', { size: 24 })}</button>`
    + `<button class="bar-pick" aria-haspopup="dialog"><span class="bar-z"></span><span class="bar-name"></span></button>`;
  const [back, more] = [...el.querySelectorAll<HTMLButtonElement>('button')];
  const name = el.querySelector<HTMLElement>('.bar-name')!;
  const id = el.querySelector<HTMLElement>('.bar-z')!;
  let z = 1;
  const set = (to: number) => {
    z = Math.max(1, Math.min(MAX_Z, to));
    const e = elementAt(z);
    more.setAttribute('aria-label', `${e.name}, element ${e.z}. Show all atoms`);
    name.textContent = e.name;
    id.textContent = `${e.z} ${e.symbol}`;
    fit();
  };
  // The titles' 15px first, down to 13px.
  const fit = () => {
    if (!name.clientWidth) return; // hidden: the observer refits once it shows
    for (let i = 0; i <= FIT_STEPS; i++) {
      name.style.fontSize = `${15 - (2 * i) / FIT_STEPS}px`;
      if (name.scrollWidth <= name.clientWidth) return;
    }
  };
  new ResizeObserver(fit).observe(more);
  const go = (to: number) => {
    if (to < 1 || to > MAX_Z || to === z) return;
    set(to);
    o.onChange(to);
  };
  const list = createListToggle({ current: () => z, onPick: (p) => go(p) });
  el.append(list.el);
  more.onclick = () => list.el.click();
  back.onclick = () => el.dispatchEvent(new CustomEvent('atomos:collect', { bubbles: true, detail: { z } }));
  set(z);
  return { el, set, get z() { return z; } };
}
