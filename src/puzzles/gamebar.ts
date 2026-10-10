// The header of every game, the same in Build, Practice and the gate puzzles, on the gray header
// fill: the game's name with what it is for ("Building lithium") on the left and its tools on the
// right (Undo, Restart, Hint, Info, the microscope); under them the stats in four equal columns
// (Difficulty, Moves, Par, and how far the board has got); then one message line for the goal,
// the Hint button's line and the game's own status. Back sits in a footer at the bottom left
// (gameFooter).

import { icon } from '../ui/icons';
import { firstTimeLine } from '../ui/nu';
import { difficultyWord } from './difficulty';
import type { PuzzleView, Stat } from './view';

export interface GameBar {
  readonly el: HTMLElement;
  /** The message line; first-time lines are placed just above it. */
  readonly msg: HTMLElement;
  /** The game's name, and a few words on what this play is for ("Building lithium"). */
  setTitle(name: string, context?: string): void;
  /** Sets the rating shown as five pips (1 to 10, two per pip). */
  setDifficulty(rating: number): void;
  /** Refreshes the stats and the message from the view; cheap enough to call every frame. */
  update(v: PuzzleView | null, message: string): void;
}

const NONE = '–';

/** The stats a view gives for the Progress column (and, rarely, the Par column). Views that don't
 *  say read their status line: "3 / 12 placed" becomes Placed, 3/12. */
export function statsOf(v: PuzzleView): { par: Stat; progress: Stat } {
  const own = v.stats?.() ?? {};
  let progress = own.progress;
  if (!progress) {
    const m = /^(\d+)\s*\/\s*(\d+)\s+([a-z]+)/i.exec(v.hint().replace(/<[^>]+>/g, ''));
    progress = m ? { label: m[3][0].toUpperCase() + m[3].slice(1), value: `${m[1]}/${m[2]}` } : { label: 'Progress', value: NONE };
  }
  const par = own.par ?? { label: 'Par', value: v.par === null ? NONE : String(v.par) };
  return { par, progress };
}

export function createGameBar(tools: HTMLElement[], msg?: HTMLElement): GameBar {
  const el = document.createElement('div');
  el.className = 'gbar';
  el.innerHTML = `
    <div class="gbar-top">
      <div class="gbar-name"><h2 class="gbar-title"></h2><span class="gbar-ctx"></span></div>
      <div class="gbar-tools"></div>
    </div>
    <div class="gbar-stats">
      <div class="gbar-stat"><span class="gbar-k">Difficulty</span><span class="gbar-v gbar-pips" data-v="diff"></span></div>
      <div class="gbar-stat"><span class="gbar-k">Moves</span><span class="gbar-v" data-v="moves">0</span></div>
      <div class="gbar-stat"><span class="gbar-k" data-k="par">Par</span><span class="gbar-v" data-v="par">${NONE}</span></div>
      <div class="gbar-stat"><span class="gbar-k" data-k="progress">Progress</span><span class="gbar-v" data-v="progress">${NONE}</span></div>
    </div>`;
  el.querySelector('.gbar-tools')!.append(...tools);
  const line = msg ?? document.createElement('p');
  line.classList.add('gbar-msg');
  line.setAttribute('role', 'status');
  line.setAttribute('aria-live', 'polite');
  el.append(line);
  const get = (sel: string) => el.querySelector<HTMLElement>(sel)!;
  const cells = {
    diff: get('[data-v="diff"]'),
    moves: get('[data-v="moves"]'),
    parK: get('[data-k="par"]'),
    par: get('[data-v="par"]'),
    progK: get('[data-k="progress"]'),
    prog: get('[data-v="progress"]'),
  };
  const set = (e: HTMLElement, text: string) => { if (e.textContent !== text) e.textContent = text; };

  const title = get('.gbar-title'), ctx = get('.gbar-ctx');
  return {
    el,
    msg: line,
    setTitle(name, context = '') {
      set(title, name);
      set(ctx, context);
      ctx.hidden = !context;
    },
    setDifficulty(rating) {
      const on = Math.ceil(rating / 2);
      cells.diff.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('');
      cells.diff.setAttribute('aria-label', difficultyWord(rating));
      cells.diff.title = difficultyWord(rating);
    },
    update(v, message) {
      if (!v) {
        set(cells.moves, NONE); set(cells.par, NONE); set(cells.prog, NONE);
      } else {
        const s = statsOf(v);
        set(cells.moves, String(v.moves));
        set(cells.parK, s.par.label); set(cells.par, s.par.value);
        set(cells.progK, s.progress.label); set(cells.prog, s.progress.value);
      }
      set(line, message);
    },
  };
}

/** The first time a game is played, Nu offers its rules under the bar instead of opening them:
 *  Rules opens them, Not now (or any other tap) lets the player start. Shown once per game, and
 *  not at all when Nu is off in Settings; the Info button always has the rules. */
export function offerRules(bar: GameBar, game: { id: string; name: string }, open: () => void): void {
  clearOffers(bar);
  const line = firstTimeLine(`rules-${game.id}`, `First time playing ${game.name}? Here's how it works.`, bar.msg);
  if (!line) return;
  line.classList.add('gbar-nu');
  const acts = document.createElement('span');
  acts.className = 'nu-acts';
  const rules = document.createElement('button');
  rules.className = 'secondary nu-act';
  rules.textContent = 'Rules';
  rules.onclick = () => open();
  const later = document.createElement('button');
  later.className = 'nu-act nu-act-quiet';
  later.textContent = 'Not now';
  later.onclick = () => line.remove();
  acts.append(rules, later);
  line.append(acts);
}

/** Takes away an offer still showing (the player left the game before acting on it), so it comes
 *  back the next time instead. */
export function clearOffers(bar: GameBar): void {
  bar.el.querySelectorAll('.gbar-nu').forEach((e) => e.remove());
}

export interface GameFooter {
  readonly el: HTMLElement;
  readonly back: HTMLButtonElement;
  setLabel(label: string): void;
}

/** The strip under a game: Back at the bottom left, named for where it goes ("Back to lithium",
 *  "Back to Practice"). */
export function gameFooter(label: string, onClick: () => void): GameFooter {
  const el = document.createElement('div');
  el.className = 'gfoot';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'back-plate gfoot-back';
  back.innerHTML = `${icon('chevron-left', { size: 20 })}<span></span>`;
  back.onclick = onClick;
  el.append(back);
  const setLabel = (l: string) => { back.querySelector('span')!.textContent = l; back.setAttribute('aria-label', l); };
  setLabel(label);
  return { el, back, setLabel };
}
