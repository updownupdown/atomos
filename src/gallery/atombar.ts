// The atom navigator: the bar across the top of the atom screens. The host places it (the
// element is a plain flex row 60px tall). Previous on the far left, next on the far right, cyan
// chevrons on small plates. Between them one gray plate is the element: its number on the left,
// its name centered in the wordmark's tracked capitals, the three dots always on the right;
// tapping anywhere on it opens the element picker.
// View's loupe and Build both mount one, so stepping through elements looks and works the
// same in each.
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
  el.innerHTML = `<button class="bar-btn" data-dir="-1" aria-label="Previous element">${icon('chevron-left', { size: 26 })}</button>`
    + `<button class="bar-pick" aria-haspopup="dialog"><span class="bar-z"></span><span class="bar-name"></span><span class="bar-dots">${icon('more-vertical', { size: 22 })}</span></button>`
    + `<button class="bar-btn" data-dir="1" aria-label="Next element">${icon('chevron-right', { size: 26 })}</button>`;
  const [prev, more, next] = [...el.querySelectorAll<HTMLButtonElement>('button')];
  const name = el.querySelector<HTMLElement>('.bar-name')!;
  const num = el.querySelector<HTMLElement>('.bar-z')!;
  let z = 1;
  const set = (to: number) => {
    z = Math.max(1, Math.min(MAX_Z, to));
    const e = elementAt(z);
    more.setAttribute('aria-label', `${e.name}, element ${e.z}. Choose another element`);
    name.textContent = e.name;
    num.textContent = String(e.z);
    prev.disabled = z === 1;
    next.disabled = z === MAX_Z;
    prev.title = z > 1 ? elementAt(z - 1).name : '';
    next.title = z < MAX_Z ? elementAt(z + 1).name : '';
    fit();
  };
  // Largest size first: 15px at 0.24em tracking, down to 10px at 0.1em.
  const fit = () => {
    if (!name.clientWidth) return; // hidden: the observer refits once it shows
    for (let i = 0; i <= FIT_STEPS; i++) {
      const t = i / FIT_STEPS;
      name.style.fontSize = `${15 - 5 * t}px`;
      name.style.setProperty('--track', `${(0.24 - 0.14 * t).toFixed(3)}em`);
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
  more.onclick = () => openElementPicker((p) => go(p), { current: z, locked: o.locked });
  set(z);
  return { el, set, get z() { return z; } };
}
