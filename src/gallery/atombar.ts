// The atom navigator: the bar across the top of the atom screens. The host places it (the
// element is a plain flex row 60px tall). It is the top of the atom screens, which have no
// title row. Left to right: Back (to Collect, or Tables if the atom was opened there), the
// element (its number over its symbol, then its name, big), the up and down chevrons for the
// element before and after, and the collection button (atomlist.ts), which opens the list of
// every atom; a tap on the name opens it too. (The Build page's single track marks its own
// Stable and Fleeting parts, so the bar carries no legend.)
// View's loupe and Build both mount one, so stepping through elements looks and works the
// same in each.
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
    + `<button class="bar-pick" aria-haspopup="dialog"><span class="bar-z"><small></small><b></b></span><span class="bar-name"></span></button>`
    + `<button class="bar-btn" data-dir="-1" aria-label="Previous element">${icon('chevron-up', { size: 24 })}</button>`
    + `<button class="bar-btn" data-dir="1" aria-label="Next element">${icon('chevron-down', { size: 24 })}</button>`;
  const [back, more, prev, next] = [...el.querySelectorAll<HTMLButtonElement>('button')];
  const name = el.querySelector<HTMLElement>('.bar-name')!;
  const num = el.querySelector<HTMLElement>('.bar-z small')!;
  const sym = el.querySelector<HTMLElement>('.bar-z b')!;
  let z = 1;
  const set = (to: number) => {
    z = Math.max(1, Math.min(MAX_Z, to));
    const e = elementAt(z);
    more.setAttribute('aria-label', `${e.name}, element ${e.z}. Show all atoms`);
    name.textContent = e.name;
    num.textContent = String(e.z);
    sym.textContent = e.symbol;
    prev.disabled = z === 1;
    next.disabled = z === MAX_Z;
    prev.title = z > 1 ? elementAt(z - 1).name : '';
    next.title = z < MAX_Z ? elementAt(z + 1).name : '';
    fit();
  };
  // Largest size first: 24px down to 14px.
  const fit = () => {
    if (!name.clientWidth) return; // hidden: the observer refits once it shows
    for (let i = 0; i <= FIT_STEPS; i++) {
      name.style.fontSize = `${24 - (10 * i) / FIT_STEPS}px`;
      if (name.scrollWidth <= name.clientWidth) return;
    }
  };
  new ResizeObserver(fit).observe(more);
  const go = (to: number) => {
    if (to < 1 || to > MAX_Z || to === z) return;
    set(to);
    o.onChange(to);
  };
  prev.onclick = () => go(z - 1);
  next.onclick = () => go(z + 1);
  const list = createListToggle({ current: () => z, onPick: (p) => go(p) });
  el.append(list.el);
  more.onclick = () => list.el.click();
  back.onclick = () => el.dispatchEvent(new CustomEvent('atomos:collect', { bubbles: true, detail: { z } }));
  set(z);
  return { el, set, get z() { return z; } };
}
