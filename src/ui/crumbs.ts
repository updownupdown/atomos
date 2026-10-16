// The trail in the header, off Home: from the mark (Home) to the screen open, each step a link
// back to it and the last the screen itself.
//
//   (.) › Collect                        Collect
//   (.) › Collect › (Nd Neodymium ⌄)     an atom's Build page (Collect goes back to Collect on
//                                        that atom); the atom is a dropdown of the atoms
//   (.) › Collect › Nd › [] Flux         a puzzle from that page (Nd goes back to it)
//   (.) › Atlas › (Nd Neodymium ⌄)       an atom's page in the Atlas; the atom is a dropdown of
//                                        the atoms
//   (.) › Play › ([] Flux ⌄)             a game on Play; the game is a dropdown of the games
//
// Only a dropdown sits on a pale plate; links and the screen open are plain words. The mark is
// the header's own (shell.ts); the steps follow it.

import { elementAt, placeColour } from '../gallery/data';
import { inkOn } from '../gallery/looks';
import { puzzleIcon, puzzleType } from '../puzzles/catalog';
import { icon } from './icons';

export interface Crumb {
  /** The words shown. An atom shows its symbol as a link, its plate and name as a dropdown. */
  label: string;
  /** An atom (its plate, in a dropdown) or a game (its icon) leading the words. */
  atom?: number;
  game?: string;
  /** Or its own icon, as SVG (a game in Nu's park). */
  icon?: string;
  /** A link back to this step. */
  go?: () => void;
  /** A dropdown: opens the list of its kind. */
  drop?: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A crumb for an atom: its symbol as a link, its plate and name as a dropdown. */
export function atomCrumb(z: number, o: { go?: () => void; drop?: () => void } = {}): Crumb {
  const e = elementAt(z);
  return { label: o.drop ? e.name : e.symbol, atom: z, ...o };
}

/** A crumb for a game: its icon and name. */
export function gameCrumb(id: string, o: { go?: () => void; drop?: () => void } = {}): Crumb {
  return { label: puzzleType(id).name, game: id, ...o };
}

export class Crumbs {
  private drop: HTMLButtonElement | null = null;

  constructor(private el: HTMLElement) {}

  /** Paint the trail; null (Home, or View full screen) empties it. */
  paint(trail: Crumb[] | null): void {
    this.el.hidden = !trail;
    this.drop = null;
    if (!trail) { this.el.replaceChildren(); return; }
    this.el.replaceChildren(...trail.flatMap((c, i) => [this.sep(), this.crumb(c, i === trail.length - 1)]));
    this.fit();
  }

  /** Says whether the dropdown's list is open (its chevron turns). */
  setOpen(open: boolean): void {
    this.drop?.setAttribute('aria-expanded', String(open));
    this.drop?.classList.toggle('is-open', open);
  }

  private sep(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'crumb-sep';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = icon('chevron-right', { size: 16 });
    return s;
  }

  private crumb(c: Crumb, last: boolean): HTMLElement {
    const lead = c.atom && c.drop ? this.plate(c.atom)
      : c.game ? `<span class="crumb-game">${puzzleIcon(c.game, 18)}</span>`
      : c.icon ? `<span class="crumb-game">${c.icon.replace(/width="\d+" height="\d+"/, 'width="18" height="18"')}</span>` : '';
    const name = `<span class="crumb-name">${esc(c.label)}</span>`;
    let el: HTMLElement;
    if (c.drop || c.go) {
      const b = document.createElement('button');
      b.type = 'button';
      b.onclick = () => (c.drop ?? c.go)!();
      el = b;
    } else {
      el = document.createElement('span');
      el.setAttribute('aria-current', 'page');
    }
    el.className = `crumb ${c.drop ? 'crumb--drop' : c.go ? 'crumb--link' : 'crumb--here'}${last ? ' is-last' : ''}`;
    el.innerHTML = lead + name + (c.drop ? icon('chevron-down', { size: 18 }) : '');
    if (c.drop) {
      el.setAttribute('aria-haspopup', 'dialog');
      el.setAttribute('aria-expanded', 'false');
      el.setAttribute('aria-label', c.atom ? `${c.label}, element ${c.atom}. Show all atoms` : `${c.label}. Show all games`);
      this.drop = el as HTMLButtonElement;
    } else if (c.go && c.atom) {
      el.setAttribute('aria-label', elementAt(c.atom).name);
    }
    return el;
  }

  /** An atom's plate: its number over its symbol, in its place color. */
  private plate(z: number): string {
    const e = elementAt(z);
    const c = placeColour(e);
    return `<span class="crumb-plate" style="background:${c};color:${inkOn(c)}"><small>${e.z}</small><b>${e.symbol}</b></span>`;
  }

  /** A long name (Rutherfordium on a 360px phone) steps down from 17px to 15px before it
   *  ellipsizes. */
  private fit(): void {
    const n = this.el.querySelector<HTMLElement>('.crumb--drop .crumb-name');
    if (!n?.clientWidth) return;
    for (let i = 0; i <= 10; i++) {
      n.style.fontSize = `${17 - i / 5}px`;
      if (n.scrollWidth <= n.clientWidth) return;
    }
  }
}
