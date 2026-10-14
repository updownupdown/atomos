// The bar. On Home it is a pill at the foot holding Collect, Learn and Play, each an icon over its
// name. Everywhere else it sits in the header beside the mark (shell.ts), which never moves, so
// going from one page to another only swaps what is in it:
//   At Learn's and Play's tops: the three sections in a row, the one open lit.
//   Anywhere in Collect, on an atom and in a game on Play: the dropdown of what is open (the
//   atom's number over its symbol and its name, or the game's icon and name) with a chevron
//   pointing down, which drops the atom list or the game list under the header; then, for an
//   atom, Build | Learn as one toggle, the page open lit (on Collect, where neither is, Build is
//   filled to say it is the way in), or for a game its Difficulty button (playground.ts puts it in
//   #dock-extra).
// Nu rests in the mark (src/ui/mark.ts), not here.

import { elementAt, placeColour } from '../gallery/data';
import { inkOn } from '../gallery/looks';
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

const SECTIONS: { id: Exclude<Section, 'home'>; button: string; icon: IconName; label: string }[] = [
  { id: 'collect', button: 'nav-collect', icon: 'collect', label: 'Collect' },
  { id: 'learn', button: 'nav-gallery', icon: 'atlas', label: 'Learn' },
  { id: 'play', button: 'nav-puzzles', icon: 'puzzles', label: 'Play' },
];

const PAGES: { id: AtomPage; button: string; icon: IconName; label: string }[] = [
  { id: 'build', button: 'dock-build', icon: 'build', label: 'Build' },
  { id: 'learn', button: 'dock-learn', icon: 'atlas', label: 'Learn' },
];

const FIT_STEPS = 10;

export class Dock {
  private state: DockState = { section: 'home', pick: null, hidden: false };
  private pickBtn: HTMLButtonElement;
  private badge: HTMLElement;
  private name: HTMLElement;
  private seg: HTMLElement;
  private extra: HTMLElement;

  constructor(private el: HTMLElement, o: { onSection: (s: Section, lit: boolean) => void; onPick: () => void; onPage: (p: AtomPage) => void }) {
    for (const s of SECTIONS) {
      const b = document.getElementById(s.button)!;
      b.querySelector('.nav-ico')!.innerHTML = icon(s.icon);
      b.onclick = () => o.onSection(s.id, this.state.section === s.id && !this.state.pick);
    }
    for (const p of PAGES) {
      const b = document.getElementById(p.button)!;
      b.querySelector('.nav-ico')!.innerHTML = icon(p.icon, { size: 20 });
      b.onclick = () => o.onPage(p.id);
    }
    this.pickBtn = el.querySelector<HTMLButtonElement>('.dock-pick')!;
    this.pickBtn.innerHTML = `<span class="dock-badge"><small></small><b></b></span><span class="dock-name"></span>${icon('chevron-down', { size: 20 })}`;
    this.badge = this.pickBtn.querySelector('.dock-badge')!;
    this.name = this.pickBtn.querySelector('.dock-name')!;
    this.pickBtn.onclick = () => o.onPick();
    this.seg = document.getElementById('dock-seg')!;
    this.extra = document.getElementById('dock-extra')!;
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
      // Inside a section the dropdown takes the sections' place.
      b.hidden = deep;
    }
    this.seg.hidden = !pages;
    // On Collect neither page is open: Build is filled, the way into the atom.
    this.seg.classList.toggle('is-cta', pages && !state.page);
    for (const p of PAGES) {
      const b = document.getElementById(p.button)!;
      b.setAttribute('aria-current', pages && state.page === p.id ? 'page' : 'false');
    }
    this.extra.hidden = !(deep && state.pick!.kind === 'game');
    this.pickBtn.hidden = !deep;
    const p = state.pick;
    if (!p) return;
    if (p.kind === 'atom') {
      const e = elementAt(p.z);
      const c = placeColour(e);
      this.badge.className = 'dock-badge dock-badge--atom';
      this.badge.style.background = c;
      this.badge.style.color = inkOn(c);
      this.badge.innerHTML = `<small>${e.z}</small><b>${e.symbol}</b>`;
      this.name.textContent = e.name;
      this.pickBtn.setAttribute('aria-label', `${e.name}, element ${e.z}. Show all atoms`);
      for (const pg of PAGES) document.getElementById(pg.button)!.setAttribute('aria-label', `${pg.label} ${e.name}`);
    } else {
      const t = puzzleType(p.id);
      this.badge.className = 'dock-badge dock-badge--game';
      this.badge.style.removeProperty('background');
      this.badge.style.removeProperty('color');
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

  /** Long names (Rutherfordium on a 360px phone) step down from 17px to 15px before they
   *  ellipsize. */
  private fit(): void {
    const n = this.name;
    if (!n.clientWidth) return;
    for (let i = 0; i <= FIT_STEPS; i++) {
      n.style.fontSize = `${17 - (2 * i) / FIT_STEPS}px`;
      if (n.scrollWidth <= n.clientWidth) return;
    }
  }
}
