// The roulette in Nu's park (park.ts): six games picked at random, played one after the other.
// Each ends when you fail at it, or when its minute is up; a bar then counts down to the next,
// showing it playing, so you're ready. The six games' points (points.ts, 10 for a par run) add
// up to the roulette's score, kept here with the best and the last few runs.
//
// It opens from the wheel in Nu's home and from the top of the games sheet.

import { F, GAMES, S, type GameId } from './games';
import { fmt } from './points';
import { atomSvg } from './score-atom';

const KEY = 'atomos.nu-roulette';
export const ROUND = 6;
/** How long each game may run, at most. */
export const GAME_MS = 60_000;
/** The wait before the next game. */
export const NEXT_MS = 4500;

export interface Run { at: number; total: number; games: { id: GameId; pts: number }[] }
export interface Book { best: number; runs: Run[] }

export function readBook(): Book {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const runs = Array.isArray(v.runs) ? v.runs.filter((r: Run) => r && Number.isFinite(r.total) && Array.isArray(r.games)) : [];
      return { best: Number.isFinite(v.best) ? v.best : 0, runs };
    }
  } catch { /* nothing kept */ }
  return { best: 0, runs: [] };
}

/** Keeps a finished run (the last ten) and the best; true if it's a new best. */
export function keepRun(run: Run): boolean {
  const b = readBook(), better = run.total > b.best;
  b.runs = [run, ...b.runs].slice(0, 10);
  if (better) b.best = run.total;
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* not kept */ }
  return better;
}

/** Six different games. */
export function pickSix(rnd = Math.random): GameId[] {
  const ids = GAMES.map((g) => g.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, ROUND);
}

const COLOURS = ['#5f8ae0', '#2ea57a', '#c07f1e', '#a865d6', '#6fd0e6', '#e4e8ea'];

/** A small roulette wheel: a ring with six colored dots round it, turning (the CSS turns it). */
export function wheelSvg(size = 40): string {
  const dots = COLOURS.map((c, k) => {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 6;
    return `<circle cx="${(20 + Math.cos(a) * 12).toFixed(2)}" cy="${(20 + Math.sin(a) * 12).toFixed(2)}" r="3.6" fill="${c}"/>`;
  }).join('');
  return `<svg class="nur-wheel" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="2.5"/><g class="nur-turn">${dots}</g><circle cx="20" cy="20" r="3.5" fill="currentColor"/></svg>`;
}

export const ROULETTE_ICON = S(`<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="5.5" r="1.9" ${F}/><circle cx="17.6" cy="15.2" r="1.9" ${F}/><circle cx="6.4" cy="15.2" r="1.9" ${F}/><circle cx="12" cy="12" r="1.6" ${F}/>`);

const game = (id: GameId) => GAMES.find((g) => g.id === id)!;

/** The game's chip: its icon and name, and its points once played. */
export function chip(id: GameId, pts?: number): string {
  const g = game(id);
  return `<span class="nur-chip"><i>${g.icon}</i><span>${g.label}</span>${pts === undefined ? '' : `<b>${atomSvg(pts, 30)}</b>`}</span>`;
}

const when = (t: number): string => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The roulette sheet's body: the six games (spinning into place one after the other, unless
 *  it's showing a run just played), the run's score if there is one, the best and the last runs. */
export function rouletteHtml(ids: GameId[], run: Run | null, best: boolean): string {
  const book = readBook();
  const head = run
    ? `<div class="nur-total"><p class="nur-big">${atomSvg(run.total, 96, { tone: best ? 'var(--c-accent)' : undefined })}</p>${best ? '<p class="nur-sub">New best</p>' : `<p class="nur-sub nur-best"><span>Best:</span>${atomSvg(book.best, 36)}</p>`}</div>`
    : `<p class="nur-lead">Six games, one after the other. Each ends when you fail, or after a minute. Ten points is a fair run in any of them.</p>`;
  const slots = (run ? run.games.map((g) => chip(g.id, g.pts)) : ids.map((id) => chip(id))).map((c, k) => `<li style="--k:${k}">${c}</li>`).join('');
  const past = book.runs.filter((r) => r !== book.runs[0] || !run).slice(0, 5);
  return `${head}<ol class="nur-six${run ? '' : ' is-spinning'}">${slots}</ol>`
    + (!run && book.best ? `<p class="nur-best"><span>Best:</span>${atomSvg(book.best, 36)}</p>` : '')
    + (past.length ? `<h3 class="nur-h">Last runs</h3><ul class="nur-runs">${past.map((r) => `<li><span>${when(r.at)}</span><b>${atomSvg(r.total, 30)}</b></li>`).join('')}</ul>` : '');
}
