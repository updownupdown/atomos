// The atom navigator: the bar along the foot of the atom screens. On the left, one button that
// reads like a periodic-table cell laid on its side: the atomic number large with the atomic
// weight small beneath it, then the symbol, then the name in the wordmark's tracked capitals,
// and a cyan "Select" that says the whole button opens the element picker. Previous and next
// sit together on the right. View's loupe and Build both mount one, so stepping through
// elements looks and works the same in each.
// Long names (Rutherfordium on a 360px phone) never truncate: fit() steps the name down in size
// and tracking until it fits.
//
//   const bar = createAtomBar({ onChange: (z) => show(z), locked: (z) => !collected(z) });
//   host.append(bar.el);
//   bar.set(26);

import { MAX_Z, elementAt } from './data';
import { icon } from '../ui/icons';
import { openElementPicker } from '../ui/picker';

export interface AtomBarOptions {
  /** The player stepped or picked another element; the bar has already moved to it. */
  onChange: (z: number) => void;
  /** Elements the picker shows as locked. */
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
  el.innerHTML = `<button class="bar-mid" aria-haspopup="dialog"></button>`
    + `<button class="bar-arrow" data-dir="-1" aria-label="Previous element">${icon('prev', { size: 26 })}</button>`
    + `<button class="bar-arrow" data-dir="1" aria-label="Next element">${icon('next', { size: 26 })}</button>`;
  const [mid, prev, next] = [...el.querySelectorAll<HTMLButtonElement>('button')];
  let z = 1;
  const set = (to: number) => {
    z = Math.max(1, Math.min(MAX_Z, to));
    const e = elementAt(z);
    // Standard atomic weight; for elements without one, the mass number of the longest-lived
    // isotope in brackets, as periodic tables print it.
    const weight = e.weight == null ? `[${e.commonA}]` : `${Number(e.weight.toPrecision(5))}`;
    mid.innerHTML = `<span class="bar-cell"><span class="bar-z">${e.z}</span><span class="bar-w">${weight}</span></span>`
      + `<span class="bar-sym">${e.symbol}</span><span class="bar-name">${e.name}</span>`
      + `<span class="bar-select">Select</span>`;
    mid.setAttribute('aria-label', `${e.name}, element ${e.z}. Choose another element`);
    prev.disabled = z === 1;
    next.disabled = z === MAX_Z;
    prev.title = z > 1 ? elementAt(z - 1).name : '';
    next.title = z < MAX_Z ? elementAt(z + 1).name : '';
    fit();
  };
  // Largest size first: 15px at 0.24em tracking, down to 10px at 0.1em.
  const fit = () => {
    const name = mid.querySelector<HTMLElement>('.bar-name');
    if (!name || !mid.clientWidth) return; // hidden: the observer refits once it shows
    for (let i = 0; i <= FIT_STEPS; i++) {
      const t = i / FIT_STEPS;
      name.style.fontSize = `${15 - 5 * t}px`;
      name.style.setProperty('--track', `${(0.24 - 0.14 * t).toFixed(3)}em`);
      if (name.scrollWidth <= name.clientWidth) return;
    }
  };
  new ResizeObserver(fit).observe(mid);
  const go = (to: number) => {
    if (to < 1 || to > MAX_Z || to === z) return;
    set(to);
    o.onChange(to);
  };
  prev.onclick = () => go(z - 1);
  next.onclick = () => go(z + 1);
  mid.onclick = () => openElementPicker((p) => go(p), { current: z, locked: o.locked });
  set(z);
  return { el, set, get z() { return z; } };
}
