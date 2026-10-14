// The game list: every game, as on the Play screen (pinned games first, then playable ones, each
// part A to Z), as a sheet rising from the dock's dropdown while a game is open on Play. Each
// row is the game's icon, its name and what it is for; the game open now is marked. Games not
// built yet are listed, dimmed, and can't be picked.
//
//   openGameList({ current: 'flux', onPick: (id) => open(id) });

import { PUZZLES, puzzleIcon, type PuzzleType } from '../puzzles/catalog';
import { pinnedGames } from '../core/wins';
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

let openList: Sheet | null = null;

export function openGameList(o: { current: string; onPick: (id: string) => void; onClose?: () => void }): void {
  const sheet = openSheet({ title: 'Games', label: 'All games', from: 'dock', onClose: () => { if (openList === sheet) openList = null; o.onClose?.(); } });
  openList = sheet;
  sheet.body.innerHTML = `<ul class="sheet-rows gl-rows">${gamesInOrder().map((p) => gameRow(p, o.current)).join('')}</ul>`;
  sheet.body.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-game]');
    if (!row || row.disabled) return;
    sheet.close();
    if (row.dataset.game !== o.current) o.onPick(row.dataset.game!);
  });
  const cur = sheet.body.querySelector<HTMLElement>('.is-current');
  requestAnimationFrame(() => {
    if (cur) sheet.body.scrollTop = Math.max(0, cur.offsetTop - sheet.body.clientHeight / 2 + cur.offsetHeight / 2);
    (cur ?? sheet.body.querySelector<HTMLElement>('[data-game]'))?.focus({ preventScroll: true });
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
