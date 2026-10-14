// The game list: every game, as on the Play screen (pinned games first, then playable ones, each
// part A to Z), as a sheet dropping from the bar's dropdown while a game is open on Play. Each
// row is the game's icon and name, then its five difficulty levels as dots: each level the game
// deals in that level's color, a smaller gray dot for one it never deals. Tapping the row opens
// the game where it was left; tapping a dot opens it at that level. The game open now is marked.
// Games not built yet are listed, dimmed, and can't be picked.
//
//   openGameList({ current: 'flux', onPick: (id, level) => open(id, level) });

import { PUZZLES, puzzleIcon, type PuzzleType } from '../puzzles/catalog';
import { lastDial, pinnedGames } from '../core/wins';
import { dialFor, difficultyLevel, LEVELS, levelInGame, levelWord } from '../puzzles/difficulty';
import { openSheet, type Sheet } from './sheet';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The games in the Play screen's order: pinned first, then the rest; playable before the
 *  others in each part, A to Z. */
export function gamesInOrder(): PuzzleType[] {
  const pins = new Set(pinnedGames());
  const az = [...PUZZLES].sort((a, b) => a.name.localeCompare(b.name));
  const order = (ps: PuzzleType[]) => [...ps.filter((p) => p.make), ...ps.filter((p) => !p.make)];
  return [...order(az.filter((p) => pins.has(p.id))), ...order(az.filter((p) => !pins.has(p.id)))];
}

/** A game as a row: its icon, its name (with `name` as HTML when given, for search's
 *  highlight) and what it is for. */
export function gameRow(p: PuzzleType, current = '', name = esc(p.name)): string {
  const on = p.id === current;
  return `<li><button type="button" class="sheet-row${on ? ' is-current' : ''}" data-game="${p.id}"${on ? ' aria-current="true"' : ''}${p.make ? '' : ' disabled'}>`
    + `<span class="sheet-ico" aria-hidden="true">${puzzleIcon(p.id, 22)}</span>`
    + `<span class="sheet-name"><span>${name}</span><small>${p.make ? esc(p.use) : 'Not built yet'}</small></span></button></li>`;
}

/** The level a game opens at: where it was last played or picked, or an easy board (as Play). */
export function openingLevel(id: string): number {
  return difficultyLevel(dialFor(id, lastDial(id) ?? 30));
}

/** A game in the list: its icon and name, then a pip for each of the five levels. */
function listRow(p: PuzzleType, current: string): string {
  const on = p.id === current;
  const pips = Array.from({ length: LEVELS }, (_, i) => {
    const level = i + 1;
    if (!p.make || !levelInGame(p.id, level)) return '<span class="gl-lvl is-off" aria-hidden="true"><i></i></span>';
    const word = levelWord(level);
    return `<button type="button" class="gl-lvl" data-level="${level}" style="--lvl: var(--c-lvl-${level})" aria-label="${esc(p.name)}, ${word}" title="${word}"><i></i></button>`;
  }).join('');
  return `<li class="gl-item${on ? ' is-current' : ''}"><button type="button" class="sheet-row" data-game="${p.id}"${on ? ' aria-current="true"' : ''}${p.make ? '' : ' disabled'}>`
    + `<span class="sheet-ico" aria-hidden="true">${puzzleIcon(p.id, 26)}</span>`
    + `<span class="sheet-name"><span>${esc(p.name)}</span>${p.make ? '' : '<small>Not built yet</small>'}</span></button>`
    + `<span class="gl-lvls" role="group" aria-label="${esc(p.name)} difficulty">${pips}</span></li>`;
}

let openList: Sheet | null = null;

export function openGameList(o: { current: string; onPick: (id: string, level?: number) => void; onClose?: () => void }): void {
  const sheet = openSheet({ title: 'Games', icon: 'puzzles', label: 'All games', from: 'bar', onClose: () => { if (openList === sheet) openList = null; o.onClose?.(); } });
  openList = sheet;
  sheet.body.innerHTML = `<ul class="sheet-rows gl-rows">${gamesInOrder().map((p) => listRow(p, o.current)).join('')}</ul>`;
  sheet.body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pip = t.closest<HTMLButtonElement>('.gl-lvl[data-level]');
    const row = t.closest('.gl-item')?.querySelector<HTMLButtonElement>('[data-game]');
    if (!row || row.disabled) return;
    if (!pip && !t.closest('.sheet-row')) return;
    sheet.close();
    const id = row.dataset.game!;
    if (pip) o.onPick(id, Number(pip.dataset.level));
    else if (id !== o.current) o.onPick(id);
  });
  const cur = sheet.body.querySelector<HTMLElement>('.is-current');
  requestAnimationFrame(() => {
    if (cur) sheet.body.scrollTop = Math.max(0, cur.offsetTop - sheet.body.clientHeight / 2 + cur.offsetHeight / 2);
    (cur?.querySelector<HTMLElement>('[data-game]') ?? sheet.body.querySelector<HTMLElement>('[data-game]'))?.focus({ preventScroll: true });
  });
}

/** Close the list if it is open (the screen is changing). */
export function closeGameList(): void {
  openList?.close();
}

/** The list is open. */
export function gameListOpen(): boolean {
  return openList !== null;
}
