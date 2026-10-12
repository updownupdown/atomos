// The game card: one game, the same everywhere in the app (the Puzzles home, the Build page).
// A fully rounded plate: the game's icon, always black on a white circle set in from the edge,
// so a game reads apart from everything else on screen; then its name and difficulty (five
// pips, the lit ones all in the level's color, the rest gray; the word is only read out and
// shown on hover); then its round button at the far end: Play filled blue (the Next button,
// magenta, where it is the next step), Replay a blue ring. The button shows only its icon; its
// word is read out. An optional extra line sits under the difficulty, for screens with no room
// beside the card (the Build page puts what a step builds to the card's right instead). Only
// the button acts.
//
//   gameCard({ id: 'merge', name: 'Tokamak', difficulty: 34, action: { label: 'Play', onClick } })
//   gameCard({ ..., difficulty: { lo: 5, hi: 25 } })   // a game's whole range
//   setCardDifficulty(card, 63)                         // the Puzzles home, after a level is picked

import { puzzleIcon } from './catalog';
import { icon } from '../ui/icons';
import { difficultyLevel, difficultyWord, LEVELS } from './difficulty';

export interface GameCardAction {
  /** "Play", "Replay" or another word or two: read out, and shown as its icon (Replay's arrow,
   *  else the play triangle). */
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
  /** A board's difficulty dial, 1 to 100, or a game's span of it. Omit to leave the gauge out. */
  difficulty?: number | { lo: number; hi: number };
  /** The button at the right; omit for a card with nothing to do. */
  action?: GameCardAction;
  /** A ready-made button instead (the app's Next button, a locked Play), in the same place. */
  button?: HTMLElement;
  /** A line under the difficulty: text, or an element the caller keeps updating. */
  extra?: string | HTMLElement;
  className?: string;
}

/** Five pips, lit from level `from` to level `to` (1 to 5). */
function pips(from: number, to: number): string {
  return Array.from({ length: LEVELS }, (_, i) => `<i class="${i + 1 >= from && i + 1 <= to ? 'on' : ''}"></i>`).join('');
}

/** The pips and the spoken word for a dial or a span of it. */
function paintDifficulty(diff: HTMLElement, difficulty: number | { lo: number; hi: number }): void {
  const d = typeof difficulty === 'number' ? { lo: difficulty, hi: difficulty } : difficulty;
  const from = difficultyLevel(d.lo);
  const to = difficultyLevel(d.hi);
  const word = from === to ? difficultyWord(d.lo) : `${difficultyWord(d.lo)} to ${difficultyWord(d.hi)}`;
  diff.innerHTML = `<span class="gcard-pips" aria-hidden="true">${pips(typeof difficulty === 'number' ? 1 : from, to)}</span><span class="sr-only"></span>`;
  diff.querySelector('.sr-only')!.textContent = `Difficulty: ${word}`;
  diff.title = `Difficulty: ${word}`;
}

/** Shows a new dial on a card already built (the level picked on the Puzzles home). */
export function setCardDifficulty(card: HTMLElement, dial: number): void {
  const diff = card.querySelector<HTMLElement>('.gcard-diff');
  if (diff) paintDifficulty(diff, dial);
}

/** A game's card: icon square, name, difficulty and its Play button. */
export function gameCard(o: GameCardOptions): HTMLElement {
  const card = document.createElement('div');
  card.className = `gcard${o.className ? ` ${o.className}` : ''}`;
  card.dataset.game = o.id;
  // The card is the size container; its inside lays out by the width it gets.
  const inner = document.createElement('div');
  inner.className = 'gcard-in';
  card.append(inner);

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
    const diff = document.createElement('span');
    diff.className = 'gcard-diff';
    body.append(diff);
    paintDifficulty(diff, o.difficulty);
  }

  if (o.extra !== undefined) {
    const extra = typeof o.extra === 'string' ? document.createElement('span') : o.extra;
    if (typeof o.extra === 'string') extra.textContent = o.extra;
    extra.classList.add('gcard-extra');
    body.append(extra);
  }

  inner.append(art, body);

  if (o.button) {
    o.button.classList.add('gcard-go');
    inner.append(o.button);
  } else if (o.action) {
    const a = o.action;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${a.kind ?? (a.label === 'Replay' ? 'secondary' : 'primary')} gcard-go`;
    b.innerHTML = `${icon(a.label === 'Replay' ? 'restart' : 'play', { size: 20 })}<span class="gcard-label"></span>`;
    b.querySelector('.gcard-label')!.textContent = a.label;
    b.setAttribute('aria-label', a.ariaLabel ?? `${a.label} ${o.name}`);
    b.disabled = Boolean(a.disabled);
    b.onclick = () => a.onClick();
    inner.append(b);
  }
  return card;
}
