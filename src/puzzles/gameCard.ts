// The game card: one game, the same everywhere in the app (the Puzzles home, the Build page).
// The game's icon fills a white square the full height of the card, inked black, so a game
// reads apart from everything else on screen; then its name and difficulty (five pips and a
// word), then its Play button inside the card. An optional extra line sits under the
// difficulty. The card is a plain filled surface; only the button acts.
//
//   gameCard({ id: 'merge', name: 'Tokamak', difficulty: 4, action: { label: 'Play', onClick } })
//   gameCard({ ..., difficulty: { lo: 1, hi: 3 } })   // a game's whole range, on the Puzzles home

import { puzzleIcon } from './catalog';
import { difficultyLevel, difficultyWord, LEVELS } from './difficulty';

export interface GameCardAction {
  /** "Play", "Replay" or another word or two. */
  label: string;
  onClick: () => void;
  /** Replay and other second choices take the outline button; Play is filled. Defaults to
   *  'secondary' for "Replay", else 'primary'. */
  kind?: 'primary' | 'secondary';
  /** A longer label for screen readers ("Play Tokamak"); defaults to the label and the name. */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface GameCardOptions {
  /** The puzzle type's id (catalog.ts), for its icon. */
  id: string;
  name: string;
  /** A board's rating, 1 to 10, or a game's range of them. Omit to leave the gauge out. */
  difficulty?: number | { lo: number; hi: number };
  /** The button at the right; omit for a card with nothing to do. */
  action?: GameCardAction;
  /** A line under the difficulty: text, or an element the caller keeps updating. */
  extra?: string | HTMLElement;
  className?: string;
}

/** Five pips, lit from level `from` to level `to` (1 to 5). */
function pips(from: number, to: number): string {
  return Array.from({ length: LEVELS }, (_, i) => `<i class="${i + 1 >= from && i + 1 <= to ? 'on' : ''}"></i>`).join('');
}

/** A game's card: icon square, name, difficulty and its Play button. */
export function gameCard(o: GameCardOptions): HTMLElement {
  const card = document.createElement('div');
  card.className = `gcard${o.className ? ` ${o.className}` : ''}`;
  card.dataset.game = o.id;

  const art = document.createElement('span');
  art.className = 'gcard-icon';
  art.setAttribute('aria-hidden', 'true');
  art.innerHTML = puzzleIcon(o.id, 36);

  const body = document.createElement('div');
  body.className = 'gcard-body';
  const name = document.createElement('b');
  name.className = 'gcard-name';
  name.textContent = o.name;
  body.append(name);

  if (o.difficulty !== undefined) {
    const d = typeof o.difficulty === 'number' ? { lo: o.difficulty, hi: o.difficulty } : o.difficulty;
    const from = difficultyLevel(d.lo);
    const to = difficultyLevel(d.hi);
    const word = from === to ? difficultyWord(d.lo) : `${difficultyWord(d.lo)}–${difficultyWord(d.hi)}`;
    const diff = document.createElement('span');
    diff.className = 'gcard-diff';
    diff.innerHTML = `<span class="gcard-pips" aria-hidden="true">${pips(typeof o.difficulty === 'number' ? 1 : from, to)}</span><span class="gcard-word"></span>`;
    diff.querySelector('.gcard-word')!.textContent = word;
    diff.title = `Difficulty: ${from === to ? word : `${difficultyWord(d.lo)} to ${difficultyWord(d.hi)}`}`;
    body.append(diff);
  }

  if (o.extra !== undefined) {
    const extra = typeof o.extra === 'string' ? document.createElement('span') : o.extra;
    if (typeof o.extra === 'string') extra.textContent = o.extra;
    extra.classList.add('gcard-extra');
    body.append(extra);
  }

  card.append(art, body);

  if (o.action) {
    const a = o.action;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${a.kind ?? (a.label === 'Replay' ? 'secondary' : 'primary')} gcard-go`;
    b.textContent = a.label;
    b.setAttribute('aria-label', a.ariaLabel ?? `${a.label} ${o.name}`);
    b.disabled = Boolean(a.disabled);
    b.onclick = () => a.onClick();
    card.append(b);
  }
  return card;
}
