// The dock: Collect, Learn and Play, always in that order, in a pill at the foot of every screen
// but the 3D atom full screen.
//   At a section's top (Collect's table, Learn's maps, Play's list) the three share the pill
//   equally, each an icon over its name; the one open sits on a lighter plate in the accent.
//   Inside a section (an atom, an Atlas page, a game) they shrink to icons at the left, the
//   section's still lit, and the rest of the pill is the dropdown: what is open (the atom's
//   number and name, or the game's icon and name) with a chevron pointing up, which opens the
//   atom list or the game list above the dock.
// There is no Back to a section's top: tapping the lit section goes there; tapping another one
// goes to that section, as it was left.

import { elementAt, placeColour } from '../gallery/data';
import { puzzleIcon, puzzleType } from '../puzzles/catalog';
import { icon, type IconName } from './icons';

export type Section = 'collect' | 'learn' | 'play';

/** What the dropdown shows: an atom, or a game on Play. */
export type DockPick = { kind: 'atom'; z: number } | { kind: 'game'; id: string };

export interface DockState {
  /** The section lit, or none (Settings). */
  section: Section | null;
  /** Inside the section: what the dropdown shows. Null at a section's top. */
  pick: DockPick | null;
  /** The 3D atom full screen has the whole screen. */
  hidden: boolean;
}

const SECTIONS: { id: Section; button: string; icon: IconName; label: string }[] = [
  { id: 'collect', button: 'nav-collect', icon: 'collect', label: 'Collect' },
  { id: 'learn', button: 'nav-gallery', icon: 'atlas', label: 'Learn' },
  { id: 'play', button: 'nav-puzzles', icon: 'puzzles', label: 'Play' },
];

const FIT_STEPS = 10;

export class Dock {
  private state: DockState = { section: 'collect', pick: null, hidden: false };
  private pickBtn: HTMLButtonElement;
  private badge: HTMLElement;
  private name: HTMLElement;

  constructor(private el: HTMLElement, o: { onSection: (s: Section, lit: boolean) => void; onPick: () => void }) {
    for (const s of SECTIONS) {
      const b = document.getElementById(s.button)!;
      b.querySelector('.nav-ico')!.innerHTML = icon(s.icon);
      b.onclick = () => o.onSection(s.id, this.state.section === s.id);
    }
    this.pickBtn = el.querySelector<HTMLButtonElement>('.dock-pick')!;
    this.pickBtn.innerHTML = `<span class="dock-badge"></span><span class="dock-name"></span>${icon('chevron-up', { size: 18 })}`;
    this.badge = this.pickBtn.querySelector('.dock-badge')!;
    this.name = this.pickBtn.querySelector('.dock-name')!;
    this.pickBtn.onclick = () => o.onPick();
    new ResizeObserver(() => this.fit()).observe(this.pickBtn);
  }

  get current(): DockState { return this.state; }

  paint(state: DockState): void {
    this.state = state;
    const deep = Boolean(state.pick);
    this.el.hidden = state.hidden;
    this.el.classList.toggle('is-deep', deep);
    for (const s of SECTIONS) {
      const b = document.getElementById(s.button)!;
      const on = state.section === s.id;
      b.setAttribute('aria-current', on ? 'page' : 'false');
      // Inside a section the icons carry no words: say where each goes.
      b.setAttribute('aria-label', deep && on ? `${s.label}: back to the top` : s.label);
    }
    this.pickBtn.hidden = !deep;
    const p = state.pick;
    if (!p) return;
    if (p.kind === 'atom') {
      const e = elementAt(p.z);
      this.badge.className = 'dock-badge dock-badge--atom';
      this.badge.style.setProperty('--c', placeColour(e));
      this.badge.textContent = String(e.z);
      this.name.textContent = e.name;
      this.pickBtn.setAttribute('aria-label', `${e.name}, element ${e.z}. Show all atoms`);
    } else {
      const t = puzzleType(p.id);
      this.badge.className = 'dock-badge dock-badge--game';
      this.badge.style.removeProperty('--c');
      this.badge.innerHTML = puzzleIcon(t.id, 20);
      this.name.textContent = t.name;
      this.pickBtn.setAttribute('aria-label', `${t.name}. Show all games`);
    }
    this.fit();
  }

  /** Says whether the dropdown's list is open (its chevron turns). */
  setOpen(open: boolean): void {
    this.pickBtn.setAttribute('aria-expanded', String(open));
    this.pickBtn.classList.toggle('is-open', open);
  }

  /** Long names (Rutherfordium on a 360px phone) step down from 15px to 13px before they
   *  ellipsize. */
  private fit(): void {
    const n = this.name;
    if (!n.clientWidth) return;
    for (let i = 0; i <= FIT_STEPS; i++) {
      n.style.fontSize = `${15 - (2 * i) / FIT_STEPS}px`;
      if (n.scrollWidth <= n.clientWidth) return;
    }
  }
}
