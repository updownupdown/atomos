// The atom navigator: the bar along the foot of the atom screens. Previous and next arrows at
// the ends; in the middle one button with the number and chevron in cyan, the name in the
// wordmark's tracked capitals and the symbol, which opens the element picker. View's loupe and
// Build both mount one, so stepping through elements looks and works the same in each.
// Long names (Rutherfordium on a 360px phone) never truncate: fit() steps the name down in size
// and tracking until it fits, and as a last resort drops the symbol to give the name its room.
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

const FIT_STEPS = 12;

export function createAtomBar(o: AtomBarOptions): AtomBar {
  const el = document.createElement('footer');
  el.className = 'loupe-bar atom-bar';
  el.innerHTML = `<button class="bar-arrow" data-dir="-1" aria-label="Previous element">${icon('prev', { size: 28 })}</button>`
    + `<button class="bar-mid" aria-haspopup="dialog"></button>`
    + `<button class="bar-arrow" data-dir="1" aria-label="Next element">${icon('next', { size: 28 })}</button>`;
  const [prev, mid, next] = [...el.querySelectorAll<HTMLButtonElement>('button')];
  let z = 1;
  const set = (to: number) => {
    z = Math.max(1, Math.min(MAX_Z, to));
    const e = elementAt(z);
    mid.innerHTML = `<span class="bar-z">${e.z}<span class="bar-chev">${icon('chevron-up', { size: 18 })}</span></span>`
      + `<span class="bar-name">${e.name}</span><span class="bar-sym">${e.symbol}</span>`;
    mid.setAttribute('aria-label', `${e.name}, element ${e.z}. Choose another element`);
    prev.disabled = z === 1;
    next.disabled = z === MAX_Z;
    prev.title = z > 1 ? elementAt(z - 1).name : '';
    next.title = z < MAX_Z ? elementAt(z + 1).name : '';
    fit();
  };
  // Largest size first: 17px at 0.3em tracking, down to 11px at 0.12em.
  const fit = () => {
    const name = mid.querySelector<HTMLElement>('.bar-name');
    if (!name || !mid.clientWidth) return; // hidden: the observer refits once it shows
    el.classList.remove('atom-bar--compact');
    for (const compact of [false, true]) {
      el.classList.toggle('atom-bar--compact', compact);
      for (let i = 0; i <= FIT_STEPS; i++) {
        const t = i / FIT_STEPS;
        name.style.fontSize = `${17 - 6 * t}px`;
        name.style.setProperty('--track', `${(0.3 - 0.18 * t).toFixed(3)}em`);
        if (name.scrollWidth <= name.clientWidth) return;
      }
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
