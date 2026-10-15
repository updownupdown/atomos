// A game's five difficulty levels as play buttons, and its wins at each.
//
// levelButtons: one button per level, its word over a play icon (a white disc, the triangle in the
// level's color); tapping one plays that level. Every level the game deals is filled in its own
// level color, none singled out; levels it never deals are plain gray and cannot be pressed. Used
// by the Play screen's top box and the difficulty bar inside a game.
//
//   row.replaceWith(levelButtons({ game: 'packing', onPlay: (level) => play(level) }));
//
// levelStats: the Won and Flawless counts at each level, in five columns that line up with the
// buttons when both sit in rows of the same width.

import { icon } from '../ui/icons';
import { winsOf } from '../core/wins';
import { difficultyLevel, difficultyRange, LEVELS, levelWord } from './difficulty';

export interface LevelButtonsOptions {
  /** The game (its id), for the levels it deals. */
  game: string;
  /** The level (1 to 5) its Play deals at, told to screen readers only; nothing shows it. */
  picked?: number;
  /** A level was pressed. */
  onPlay: (level: number) => void;
  /** What a screen reader hears for the row. */
  label?: string;
}

/** The levels a game deals, from its easiest to its hardest. */
export function levelsOf(game: string): { from: number; to: number } {
  const { lo, hi } = difficultyRange(game);
  return { from: difficultyLevel(lo), to: difficultyLevel(hi) };
}

export function levelButtons(o: LevelButtonsOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'lvl-btns';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', o.label ?? 'Play at a difficulty');
  const { from, to } = levelsOf(o.game);
  for (let level = 1; level <= LEVELS; level++) {
    const word = levelWord(level);
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.level = String(level);
    if (level < from || level > to) {
      b.className = 'lvl-btn is-off';
      b.disabled = true;
      b.title = `${word}: not dealt in this game`;
      b.innerHTML = `<span class="lvl-btn-word">${word}</span><span class="sr-only">: not dealt</span>`;
    } else {
      const on = level === o.picked;
      b.className = `lvl-btn lvl-${level}`;
      b.setAttribute('aria-label', `Play ${word}${on ? ', the level picked' : ''}`);
      if (on) b.setAttribute('aria-current', 'true');
      b.innerHTML = `<span class="lvl-btn-word" aria-hidden="true">${word}</span><span class="lvl-btn-icon" aria-hidden="true">${icon('play', { size: 16 })}</span>`;
      b.onclick = () => o.onPlay(level);
    }
    row.append(b);
  }
  return row;
}

/** The Won and Flawless counts at each level the game deals, one column per level (levels it
 *  never deals stay empty). */
export function levelStats(game: string): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'lvl-stats';
  const { from, to } = levelsOf(game);
  const wins = winsOf(game);
  const cell = (n: number, glyph: 'check' | 'star', what: string) =>
    `<span class="lvl-stat${n ? '' : ' is-zero'}" title="${n} ${what}">${icon(glyph, { size: 14 })}<b>${n}</b></span>`;
  grid.innerHTML = wins.map((w, i) => {
    const level = i + 1;
    if (level < from || level > to) return '<div class="lvl-stats-col is-off" aria-hidden="true"></div>';
    const say = `${levelWord(level)}: ${w.solved} won, ${w.flawless} flawless`;
    return `<div class="lvl-stats-col" role="group" aria-label="${say}"><span class="lvl-stats-word" aria-hidden="true">${levelWord(level)}</span>${cell(w.solved, 'check', 'won')}${cell(w.flawless, 'star', 'flawless')}</div>`;
  }).join('');
  return grid;
}
