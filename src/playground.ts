// The Puzzles screen: a home that lists every game, one section each (its game card, the
// player's wins at each difficulty level, a still of the board and what the game is), and each
// game on its own (any element, any deal) behind it, with Back to return. Nothing here builds
// atoms; the game proper reaches puzzles through each atom's Build mode. How-to text lives in the
// Instructions sheet behind the "i".

import { elementAt as element } from './gallery/data';
import { loadSave } from './core/save';
import { PUZZLES, puzzleIcon, type PuzzleType } from './puzzles/catalog';
import { gameCard } from './puzzles/gameCard';
import { PuzzleHost } from './puzzles/host';
import { openRules } from './puzzles/rulesModal';
import { showWin, type WinLevels } from './puzzles/winPanel';
import type { Area } from './puzzles/view';
import { createSlider, iconButton, type Slider } from './ui/components';
import { countPlay, GOAL_PLAYS } from './core/plays';
import { clearOffers, createGameBar, offerRules, type GameBar } from './puzzles/gamebar';
import { difficulty, difficultyLevel, difficultyRange, elementsAtLevel, LEVELS, levelWord } from './puzzles/difficulty';
import { recordWin, winsOf } from './core/wins';
import { askRestart, confirming, restartButton } from './puzzles/restart';
import { icon } from './ui/icons';
import { modalOpen } from './ui/modal';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Playground {
  private host: PuzzleHost;
  private type: PuzzleType = PUZZLES[0];
  private z = 6;
  private deal = 0;
  private shownHint = '';
  /** The game's goal, shown before the first move of its first plays. */
  private goal = '';
  private solved = false;
  private slider: Slider;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private restartBtn: HTMLButtonElement;
  private gbar: GameBar;

  constructor() {
    this.host = new PuzzleHost($('pg-canvas'), () => this.area());
    this.host.onFrame = () => this.tick(this.host.status());
    this.host.onWon = (v) => this.won(v.moves, v.par, v.clean);
    this.host.onLost = (v) => this.lost(v.moves);
    this.renderHome();

    // The board maker, folded into a settings button at the left of the status line (the X folds
    // it again): previous, the element, next, a slider across the range, a new deal.
    const bar = $('pg-bar');
    const gen = $('pg-gen');
    const fold = iconButton({ icon: icon('settings'), label: 'Board settings', className: 'pg-fold', onClick: () => setOpen(Boolean(bar.hidden)) });
    fold.setAttribute('aria-controls', 'pg-bar');
    const setOpen = (open: boolean) => {
      bar.hidden = !open;
      gen.classList.toggle('is-open', open);
      fold.innerHTML = icon(open ? 'close' : 'settings');
      fold.setAttribute('aria-expanded', String(open));
      const label = open ? 'Close board settings' : 'Board settings';
      fold.setAttribute('aria-label', label);
      fold.title = label;
    };
    gen.prepend(fold);
    setOpen(false);
    this.prev = iconButton({ icon: icon('chevron-left'), label: 'Previous element', className: 'ui-icon-btn--ghost', onClick: () => this.setZ(this.z - 1) });
    this.next = iconButton({ icon: icon('chevron-right'), label: 'Next element', className: 'ui-icon-btn--ghost', onClick: () => this.setZ(this.z + 1) });
    const label = document.createElement('span');
    label.className = 'pg-el';
    label.id = 'pg-el';
    this.slider = createSlider({ min: 1, max: 118, value: this.z, label: 'Element', format: (v) => element(v).symbol, onInput: (v) => this.setZ(v) });
    // A new deal: the shuffle and its number are one button.
    const deal = document.createElement('button');
    deal.type = 'button';
    deal.className = 'pg-deal';
    deal.setAttribute('aria-label', 'New deal');
    deal.title = 'New deal';
    deal.innerHTML = `${icon('shuffle')}<span class="pg-dealno" id="pg-dealno"></span>`;
    deal.onclick = () => this.load(this.deal + 1);
    bar.append(this.prev, label, this.next, this.slider.el, deal);

    // The tools beside Back: undo, restart, hint, instructions.
    this.undoBtn = iconButton({ icon: icon('undo'), label: 'Undo', onClick: () => this.host.undo() });
    this.restartBtn = restartButton(this.restartOptions());
    this.host.onRestartKey = () => void askRestart(this.restartOptions());
    this.gbar = createGameBar([
      this.undoBtn,
      this.restartBtn,
      this.host.hints.button,
      iconButton({ icon: icon('info'), label: 'Instructions', onClick: () => this.instructions() }),
    ], { label: 'All games', onClick: () => this.back() });
    $('pg-gbar').append(this.gbar.el);
    // The board settings sit at the left of the status line; open, they cover the rest of it.
    this.gbar.foot.classList.add('has-gen');
    this.gbar.foot.querySelector('.gfoot-line')!.prepend(gen);

    window.addEventListener('keydown', (e) => this.key(e));
  }

  /** A puzzle is open (not the list of puzzles). */
  get inPuzzle(): boolean {
    return !$('pg-game').hidden;
  }

  show(): void {
    $('puzzles-screen').hidden = false;
    if (this.inPuzzle) this.host.wake();
    window.dispatchEvent(new Event('resize'));
  }

  hide(): void {
    $('puzzles-screen').hidden = true;
    this.host.pause();
  }

  /** Opens one puzzle from the home list. */
  open(id: string): void {
    $('pg-home').hidden = true;
    $('pg-game').hidden = false;
    this.select(id);
    // Nu offers a game's rules the first time it is played, and its goal leads for three.
    const before = countPlay(this.type.id);
    this.goal = before < GOAL_PLAYS ? this.type.goal : '';
    if (this.type.make) offerRules(this.gbar, this.type, () => this.instructions());
    this.host.wake();
    window.dispatchEvent(new Event('resize'));
    this.gbar.back.focus({ preventScroll: true });
  }

  /** Back to the list of puzzles. */
  back(): void {
    this.closeWin();
    clearOffers(this.gbar);
    this.host.pause();
    $('pg-game').hidden = true;
    $('pg-home').hidden = false;
    this.paintWins(this.type);
    $('pg-list').querySelector<HTMLElement>(`[data-game="${this.type.id}"] .gcard-go`)?.focus({ preventScroll: false });
  }

  /** One section per game, playable ones first: its card, its wins, a still and its blurb. */
  private renderHome(): void {
    const list = $('pg-list');
    list.replaceChildren();
    const games = [...PUZZLES.filter((p) => p.make), ...PUZZLES.filter((p) => !p.make)];
    for (const p of games) {
      const sec = document.createElement('section');
      sec.className = 'pg-sec';
      sec.dataset.id = p.id;
      sec.setAttribute('aria-label', p.name);
      sec.append(gameCard({
        id: p.id,
        name: p.name,
        difficulty: difficultyRange(p.id),
        action: p.make ? { label: 'Play', onClick: () => this.open(p.id) } : undefined,
        extra: p.make ? undefined : 'Not built yet',
      }));
      const wins = document.createElement('div');
      wins.className = 'pg-wins';
      wins.setAttribute('role', 'list');
      wins.setAttribute('aria-label', `${p.name} wins by difficulty`);
      sec.append(wins);
      const about = document.createElement('div');
      about.className = 'pg-about';
      about.innerHTML = `${p.make ? `<canvas class="pg-thumb" aria-hidden="true"></canvas>` : ''}<p class="pg-blurb"></p>`;
      about.querySelector('.pg-blurb')!.textContent = p.blurb;
      sec.append(about);
      list.append(sec);
      this.paintWins(p);
      const thumb = about.querySelector<HTMLCanvasElement>('canvas.pg-thumb');
      if (thumb) drawThumb(thumb, p);
    }
  }

  /** A game's wins at each of the five levels: the solved count and the flawless stars. Levels
   *  its boards never reach are an empty outline; levels not yet won show a dash. */
  private paintWins(p: PuzzleType): void {
    const row = $('pg-list').querySelector<HTMLElement>(`.pg-sec[data-id="${p.id}"] .pg-wins`);
    if (!row) return;
    const { lo, hi } = difficultyRange(p.id);
    const from = difficultyLevel(lo);
    const to = difficultyLevel(hi);
    const wins = winsOf(p.id);
    row.innerHTML = Array.from({ length: LEVELS }, (_, i) => {
      const level = i + 1;
      const word = levelWord(level);
      if (level < from || level > to) {
        return `<div class="pg-lvl is-off" role="listitem" title="${word}: not dealt in ${p.name}"><span class="pg-lvl-word">${word}</span><span class="pg-lvl-none"></span><span class="sr-only">: not dealt</span></div>`;
      }
      const w = wins[i];
      if (!w.solved) {
        return `<div class="pg-lvl" role="listitem" title="${word}: not solved yet"><span class="pg-lvl-word">${word}</span><span class="pg-lvl-val"><span class="pg-lvl-dash" aria-hidden="true">–</span><span class="sr-only">: not solved yet</span></span></div>`;
      }
      const say = `${word}: ${w.solved} solved, ${w.flawless} flawless`;
      return `<div class="pg-lvl is-won" role="listitem" title="${say}"><span class="sr-only">${say}</span><span class="pg-lvl-word" aria-hidden="true">${word}</span><span class="pg-lvl-val" aria-hidden="true">`
        + `<span class="pg-lvl-n">${icon('check', { size: 12 })}${w.solved}</span>`
        + (w.flawless ? `<span class="pg-lvl-star">${icon('star', { size: 12 })}${w.flawless}</span>` : '')
        + `</span></div>`;
    }).join('');
  }

  private select(id: string): void {
    this.type = PUZZLES.find((p) => p.id === id) ?? PUZZLES[0];
    this.gbar.setTitle(this.type.name, puzzleIcon(this.type.id, 22));
    const [lo, hi] = this.type.zRange;
    this.z = Math.min(hi, Math.max(lo, this.z));
    this.rebuildSlider();
    $('pg-planned').hidden = Boolean(this.type.make);
    $('pg-play').hidden = !this.type.make;
    this.load(0);
  }

  /** The slider's range follows the puzzle type; rebuilt when it changes. */
  private rebuildSlider(): void {
    const [lo, hi] = this.type.zRange;
    const fresh = createSlider({ min: lo, max: Math.max(hi, lo + 1), value: this.z, label: 'Element', format: (v) => element(v).symbol, onInput: (v) => this.setZ(v) });
    this.slider.el.replaceWith(fresh.el);
    this.slider = fresh;
    fresh.el.style.visibility = lo === hi ? 'hidden' : '';
  }

  private setZ(z: number): void {
    const [lo, hi] = this.type.zRange;
    if (z < lo || z > hi || z === this.z) return;
    this.z = z;
    this.load(0);
  }

  private load(deal: number): void {
    this.deal = deal;
    this.solved = false;
    this.closeWin();
    const el = element(this.z);
    const [lo, hi] = this.type.zRange;
    $('pg-el').innerHTML = `<small>${el.z}</small><b>${el.symbol}</b>`;
    $('pg-el').title = el.name;
    this.slider.set(this.z);
    this.prev.disabled = this.z <= lo;
    this.next.disabled = this.z >= hi;
    $('pg-dealno').textContent = `#${deal + 1}`;
    this.shownHint = '';
    this.gbar.setDifficulty(difficulty(this.type.id, this.z));
    this.gbar.update(null, '');
    if (!this.type.make) {
      this.host.set(null);
      this.undoBtn.disabled = true;
      this.restartBtn.disabled = true;
      return;
    }
    const reduced = loadSave().settings.reducedMotion;
    this.host.reducedMotion = reduced;
    this.host.set(this.type.make(this.z, deal, reduced));
  }

  private tick(hint: string): void {
    const v = this.host.current;
    this.undoBtn.disabled = !v?.canUndo();
    this.restartBtn.disabled = !this.restartOptions().canRestart();
    // The goal before the first move of a game's first plays; then the Hint button's line or the
    // game's short status.
    const help = this.host.hints.line(v);
    const text = this.goal && v?.moves === 0 && !help ? this.goal : help ?? (hint.length > 60 ? '' : hint);
    this.shownHint = text;
    this.gbar.update(v, text);
  }

  private closeWin: () => void = () => {};

  private won(moves: number, par: number | null, clean: boolean): void {
    this.solved = true;
    const t = this.type;
    const el = element(this.z);
    const flawless = clean && (par === null || moves <= par);
    recordWin(t.id, difficulty(t.id, this.z), flawless);
    this.closeWin = showWin({
      outcome: flawless ? 'flawless' : 'won',
      headline: flawless ? 'Flawless' : 'Solved',
      title: `${t.name} · ${el.name}`,
      game: t.id,
      stats: [
        { label: 'Moves', value: String(moves) },
        { label: 'Par', value: par === null ? '–' : moves <= par ? `${par} ✓` : `${par}` },
        { label: 'Deal', value: `#${this.deal + 1}` },
      ],
      actions: [
        { label: 'New deal', primary: true, onClick: () => this.load(this.deal + 1) },
        { label: 'All puzzles', onClick: () => this.back() },
      ],
      levels: this.levels(),
    }, loadSave().settings.reducedMotion);
  }

  /** Out of guesses: the same board again, a new deal, or back to the list. Tapping outside
   *  leaves the board to look over. */
  private lost(moves: number): void {
    const t = this.type;
    this.closeWin = showWin({
      outcome: 'lost',
      headline: 'Out of guesses',
      title: `${t.name} · ${element(this.z).name}`,
      game: t.id,
      stats: [{ label: 'Moves', value: String(moves) }, { label: 'Deal', value: `#${this.deal + 1}` }],
      actions: [
        { label: 'Try again', primary: true, onClick: () => this.host.restart() },
        { label: 'New deal', onClick: () => this.load(this.deal + 1) },
        { label: 'All puzzles', onClick: () => this.back() },
      ],
    }, loadSave().settings.reducedMotion);
  }

  /** The levels row on the win sheet: another board of this game at any level it reaches. */
  private levels(): WinLevels {
    const [lo, hi] = this.type.zRange;
    const id = this.type.id;
    const at = (level: number) => elementsAtLevel(id, level, lo, hi);
    return {
      current: difficultyLevel(difficulty(id, this.z)),
      reachable: [1, 2, 3, 4, 5].filter((l) => at(l).length > 0),
      pick: (level) => {
        const zs = at(level);
        const z = zs[Math.floor(Math.random() * zs.length)];
        if (z === this.z) this.load(this.deal + 1);
        else { this.z = z; this.load(0); }
      },
    };
  }

  private instructions(): void {
    const t = this.type;
    openRules(t, { reducedMotion: loadSave().settings.reducedMotion });
  }

  private area(): Area {
    const r = $('pg-canvas').getBoundingClientRect();
    const w = r.width;
    const colW = w < 700 ? w - 16 : Math.min(720, w * 0.7);
    return { x: (w - colW) / 2, y: 6, w: colW, h: Math.max(200, r.height - 12) };
  }

  /** Restart asks first; Nu streaks across the board as it clears. */
  private restartOptions() {
    return {
      canRestart: () => (this.host.current?.moves ?? 0) > 0,
      sweepOver: () => $('pg-canvas'),
      restart: () => { this.closeWin(); this.host.restart(); this.solved = false; },
    };
  }

  private key(e: KeyboardEvent): void {
    if ($('puzzles-screen').hidden || modalOpen() || confirming() || !this.inPuzzle) return;
    if (e.key === 'Escape') { this.back(); e.preventDefault(); return; }
    const t = e.target as HTMLElement | null;
    if (t?.tagName === 'INPUT' || t?.closest?.('.ui-slider')) return;
    if (this.solved && e.key === 'Enter') { this.load(this.deal + 1); return; }
    if (this.host.key(e)) e.preventDefault();
  }
}

/** A still of the puzzle on carbon (or its first element), drawn once for its section. */
function drawThumb(c: HTMLCanvasElement, p: PuzzleType): void {
  if (!p.make) return;
  const css = 112;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = css * dpr;
  c.height = css * dpr;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  // Lay the board out at a phone-sized area, then shrink it into the thumbnail.
  const L = 340;
  const [lo, hi] = p.zRange;
  const z = Math.min(hi, Math.max(lo, 6));
  try {
    const view = p.make(z, 0, true);
    ctx.scale((css * dpr) / L, (css * dpr) / L);
    view.draw(ctx, { x: 6, y: 6, w: L - 12, h: L - 12 }, performance.now() + 60_000);
  } catch {
    // A thumbnail is decoration; a view that cannot draw small just leaves its card plain.
  }
}
