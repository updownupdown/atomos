// The frame of every game, the same in Build, Puzzles and the gate puzzles.
//   Under the app header, on gray: the game's icon and name, then its stats on one line
//   (Difficulty, Moves, Par). How far the board has got is left to the board and the message
//   under it, which every game shows. Difficulty is the first to go on a small screen.
//   Then, on black: Back on the left, named for where it goes ("Gallium", "All games"), and the
//   game's tools on the right (Undo, Restart, Hint, Info), each on a gray plate.
//   Under those, the status line: the lead buttons on the left (the microscope; Puzzles adds
//   its board settings there), one message (the goal, the Hint button's line or the game's own
//   status) and the game's own action on the right, if it has any (Test; Chroma's gluon).
//   The board sits on black under it all.
// The first time a game is played, a Learn to Play card floats under the status line
// (offerRules).

import { backButton, textButton } from '../ui/components';
import { firstTimeDue, markSeen } from '../ui/nu';
import { difficultyWord } from './difficulty';
import { icon } from '../ui/icons';
import type { PuzzleView, Stat, ViewAction } from './view';

export interface GameBar {
  /** The top: the gray stats bar and the black bar with Back and the tools. */
  readonly el: HTMLElement;
  /** The status line under the tools (part of `el`): the lead buttons, the message and the
   *  game's action. */
  readonly foot: HTMLElement;
  readonly msg: HTMLElement;
  readonly back: HTMLButtonElement;
  /** The game's name, and its icon (HTML) beside it. */
  setTitle(name: string, iconHtml?: string): void;
  /** Where Back goes, in a word or two: "Gallium", "All games". */
  setBack(label: string): void;
  /** Sets the rating shown as five pips (1 to 10, two per pip). */
  setDifficulty(rating: number): void;
  /** Refreshes the stats, the message and the action from the view; cheap enough to call every
   *  frame. */
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

export function createGameBar(tools: HTMLElement[], back: { label: string; onClick: () => void }, lead: HTMLElement[] = []): GameBar {
  const el = document.createElement('div');
  el.className = 'gbar';
  el.innerHTML = `
    <div class="gbar-head"><div class="gbar-in">
      <h2 class="gbar-title"><span class="gbar-icon" aria-hidden="true"></span><span class="gbar-name"></span></h2>
      <div class="gbar-stats">
        <div class="gbar-stat gbar-stat--diff"><span class="gbar-k">Difficulty</span><span class="gbar-v gbar-pips" data-v="diff"></span></div>
        <div class="gbar-stat"><span class="gbar-k">Moves</span><span class="gbar-v" data-v="moves">0</span></div>
        <div class="gbar-stat"><span class="gbar-k" data-k="par">Par</span><span class="gbar-v" data-v="par">${NONE}</span></div>
      </div>
    </div></div>
    <div class="gbar-nav"><div class="gbar-in"><div class="gbar-tools"></div></div></div>`;
  const backBtn = backButton(back.label, back.onClick, 'gbar-back');
  el.querySelector('.gbar-nav .gbar-in')!.prepend(backBtn);
  el.querySelector('.gbar-tools')!.append(...tools);

  const foot = document.createElement('div');
  foot.className = 'gfoot';
  foot.innerHTML = '<div class="gfoot-line"><span class="gbar-lead"></span><p class="gbar-msg" role="status" aria-live="polite"></p></div>';
  foot.querySelector('.gbar-lead')!.append(...lead);
  const line = foot.querySelector<HTMLElement>('.gbar-msg')!;
  // The game's own actions, beside the message: kept as buttons and refreshed in place.
  const acts = document.createElement('span');
  acts.className = 'gbar-acts';
  foot.querySelector('.gfoot-line')!.append(acts);
  el.append(foot);
  const runs: (() => void)[] = [];
  const syncActions = (list: ViewAction[]) => {
    while (acts.children.length > list.length) acts.lastElementChild!.remove();
    list.forEach((a, k) => {
      let b = acts.children[k] as HTMLButtonElement | undefined;
      const kind = a.icon ? 'pill' : 'text';
      if (!b || b.dataset.kind !== kind || (a.icon && b.dataset.icon !== a.icon)) {
        const fresh = textButton('', () => runs[k]?.(), a.icon ? 'gbar-act gbar-act--pill' : 'gbar-act');
        fresh.dataset.kind = kind;
        if (a.icon) {
          fresh.dataset.icon = a.icon;
          fresh.innerHTML = `${icon(a.icon, { size: 18 })}<span></span>`;
        }
        if (b) b.replaceWith(fresh); else acts.append(fresh);
        b = fresh;
      }
      runs[k] = a.run;
      const label = b.querySelector('span') ?? b;
      set(label as HTMLElement, a.label);
      b.disabled = Boolean(a.disabled);
      if (a.pressed !== undefined) b.setAttribute('aria-pressed', String(a.pressed)); else b.removeAttribute('aria-pressed');
      if (a.ariaLabel) b.setAttribute('aria-label', a.ariaLabel); else b.removeAttribute('aria-label');
    });
  };

  const get = (sel: string) => el.querySelector<HTMLElement>(sel)!;
  const cells = {
    diff: get('[data-v="diff"]'),
    moves: get('[data-v="moves"]'),
    parK: get('[data-k="par"]'),
    par: get('[data-v="par"]'),
  };
  const set = (e: HTMLElement, text: string) => { if (e.textContent !== text) e.textContent = text; };

  const title = get('.gbar-name');
  const titleIcon = get('.gbar-icon');
  let shownIcon = '';
  return {
    el,
    foot,
    msg: line,
    back: backBtn,
    setTitle(name, iconHtml = '') {
      set(title, name);
      if (iconHtml !== shownIcon) { shownIcon = iconHtml; titleIcon.innerHTML = iconHtml; titleIcon.hidden = !iconHtml; }
    },
    setBack(label) { backBtn.setLabel(label); },
    setDifficulty(rating) {
      const on = Math.ceil(rating / 2);
      cells.diff.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('');
      cells.diff.setAttribute('aria-label', difficultyWord(rating));
      cells.diff.title = difficultyWord(rating);
    },
    update(v, message) {
      if (!v) {
        set(cells.moves, NONE); set(cells.par, NONE);
      } else {
        const s = statsOf(v);
        set(cells.moves, String(v.moves));
        set(cells.parK, s.par.label); set(cells.par, s.par.value);
      }
      set(line, message);
      const a = v && !v.won ? v.action?.() ?? null : null;
      syncActions(a ? (Array.isArray(a) ? a : [a]) : []);
    },
  };
}

let dismissOffer: (() => void) | null = null;

/** The first time a game is played, a Learn to Play card floats under the status line, over the
 *  board (it never shrinks it): Rules opens them, Not now (or any other tap) lets the player start.
 *  Shown once per game, and not at all when Nu is off in Settings; the Info button always has the
 *  rules. */
export function offerRules(bar: GameBar, game: { id: string; name: string }, open: () => void): void {
  clearOffers(bar);
  const id = `rules-${game.id}`;
  if (!firstTimeDue(id)) return;
  const card = document.createElement('div');
  card.className = 'ui-callout ui-callout--float gbar-offer';
  card.setAttribute('role', 'status');
  card.innerHTML = '<span class="ui-callout-text"><small>Learn to Play</small><b></b></span><span class="ui-callout-acts"></span>';
  card.querySelector('b')!.textContent = game.name;
  const rules = document.createElement('button');
  rules.type = 'button';
  rules.className = 'ui-callout-go';
  rules.textContent = 'Rules';
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'ui-callout-skip';
  later.textContent = 'Not now';
  card.querySelector('.ui-callout-acts')!.append(rules, later);
  bar.foot.append(card);

  const shownAt = performance.now();
  const done = (seen: boolean) => {
    window.removeEventListener('pointerdown', away, true);
    window.removeEventListener('keydown', away, true);
    if (dismissOffer === drop) dismissOffer = null;
    if (seen) markSeen(id);
    card.remove();
  };
  const drop = () => done(false);
  // Any other tap or key lets the player start; the tap that opened the game doesn't count.
  function away(e: Event): void {
    if (card.contains(e.target as Node) || performance.now() - shownAt < 600) return;
    done(true);
  }
  rules.onclick = () => { done(true); open(); };
  later.onclick = () => done(true);
  window.addEventListener('pointerdown', away, true);
  window.addEventListener('keydown', away, true);
  dismissOffer = drop;
}

/** Takes away an offer still showing (the player left the game before acting on it), so it comes
 *  back the next time instead. */
export function clearOffers(bar: GameBar): void {
  if (dismissOffer) dismissOffer();
  bar.foot.querySelectorAll('.gbar-offer').forEach((e) => e.remove());
}
