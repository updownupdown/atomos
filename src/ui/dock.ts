// The dock, a pill at the foot of every screen but the 3D atom full screen.
//   On Home, and at the top of Learn (the Atlas) and Play (the list of games), it holds Home,
//   Collect, Learn and Play, always in that order, each an icon over its name; the one open sits
//   on a lighter plate in the accent.
//   Anywhere in Collect (Collect itself, an atom's Build or Learn pages), on an atom opened from
//   Learn, and in a game on Play, it becomes: Home (its icon alone) at the left, then the
//   dropdown of what is open (the atom's number and name, or the game's icon and name) with a
//   chevron pointing up, which opens the atom list or the game list above the dock; and, for an
//   atom, Build and Learn at the right, the page open lit and the other one tap away.
// Nu lives in the Home icon, as its rose nucleus, whenever it is nowhere else on the screen.

import { elementAt, placeColour } from '../gallery/data';
import { puzzleIcon, puzzleType } from '../puzzles/catalog';
import { icon, type IconName } from './icons';
import { startNu } from './nu';

export type Section = 'home' | 'collect' | 'learn' | 'play';

/** What the dropdown shows: an atom, or a game on Play. */
export type DockPick = { kind: 'atom'; z: number } | { kind: 'game'; id: string };

/** An atom's two pages, Build and Learn. */
export type AtomPage = 'build' | 'learn';

export interface DockState {
  /** The section lit, or none (Settings). */
  section: Section | null;
  /** Inside a section: what the dropdown shows. Null on Home and at Learn's and Play's tops. */
  pick: DockPick | null;
  /** With an atom in the dropdown: Build and Learn, and which of them is open (null: neither,
   *  as on Collect). */
  page?: AtomPage | null;
  /** The 3D atom full screen has the whole screen. */
  hidden: boolean;
}

const SECTIONS: { id: Section; button: string; icon: IconName; label: string }[] = [
  { id: 'home', button: 'nav-home', icon: 'home', label: 'Home' },
  { id: 'collect', button: 'nav-collect', icon: 'collect', label: 'Collect' },
  { id: 'learn', button: 'nav-gallery', icon: 'atlas', label: 'Learn' },
  { id: 'play', button: 'nav-puzzles', icon: 'puzzles', label: 'Play' },
];

const PAGES: { id: AtomPage; button: string; icon: IconName; label: string }[] = [
  { id: 'build', button: 'dock-build', icon: 'build', label: 'Build' },
  { id: 'learn', button: 'dock-learn', icon: 'atlas', label: 'Learn' },
];

/** The Home icon (icons/home.svg) with its nucleus as Nu's home slot: an empty ring that Nu
 *  fills whenever it has nothing else to show (nu.ts). */
const HOME_ICON = '<svg class="icon icon-home" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">'
  + '<g stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 11L12 4L20.4 11"/><path d="M5.8 9.4V19.6H18.2V9.4"/></g>'
  + '<circle class="nu-slot nu-home-slot" cx="12" cy="14.2" r="2.4"/></svg>';

const FIT_STEPS = 10;

export class Dock {
  private state: DockState = { section: 'home', pick: null, hidden: false };
  private pickBtn: HTMLButtonElement;
  private badge: HTMLElement;
  private name: HTMLElement;

  constructor(private el: HTMLElement, o: { onSection: (s: Section, lit: boolean) => void; onPick: () => void; onPage: (p: AtomPage) => void }) {
    for (const s of SECTIONS) {
      const b = document.getElementById(s.button)!;
      b.querySelector('.nav-ico')!.innerHTML = s.id === 'home' ? HOME_ICON : icon(s.icon);
      b.onclick = () => o.onSection(s.id, this.state.section === s.id && !this.state.pick);
    }
    for (const p of PAGES) {
      const b = document.getElementById(p.button)!;
      b.querySelector('.nav-ico')!.innerHTML = icon(p.icon);
      b.setAttribute('aria-label', p.label);
      b.title = p.label;
      b.onclick = () => o.onPage(p.id);
    }
    this.pickBtn = el.querySelector<HTMLButtonElement>('.dock-pick')!;
    this.pickBtn.innerHTML = `<span class="dock-badge"></span><span class="dock-name"></span>${icon('chevron-up', { size: 18 })}`;
    this.badge = this.pickBtn.querySelector('.dock-badge')!;
    this.name = this.pickBtn.querySelector('.dock-name')!;
    this.pickBtn.onclick = () => o.onPick();
    new ResizeObserver(() => this.fit()).observe(this.pickBtn);
    startNu();
  }

  get current(): DockState { return this.state; }

  paint(state: DockState): void {
    this.state = state;
    const deep = Boolean(state.pick);
    const pages = deep && state.pick!.kind === 'atom';
    this.el.hidden = state.hidden;
    this.el.classList.toggle('is-deep', deep);
    this.el.classList.toggle('has-pages', pages);
    for (const s of SECTIONS) {
      const b = document.getElementById(s.button)!;
      const on = !deep && state.section === s.id;
      b.setAttribute('aria-current', on ? 'page' : 'false');
      // Inside a section only Home stays, as its icon alone.
      b.hidden = deep && s.id !== 'home';
      b.setAttribute('aria-label', s.label);
    }
    for (const p of PAGES) {
      const b = document.getElementById(p.button)!;
      b.hidden = !pages;
      b.setAttribute('aria-current', pages && state.page === p.id ? 'page' : 'false');
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
      for (const pg of PAGES) document.getElementById(pg.button)!.setAttribute('aria-label', `${pg.label} ${e.name}`);
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
