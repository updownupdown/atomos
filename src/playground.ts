// The Puzzles screen: a home that lists every game, and each game on its own (any difficulty on
// the 1 to 100 dial, any deal) behind it, with Back to return. Nothing here builds atoms; the
// game proper reaches puzzles through each atom's Build mode. How-to text lives in the
// Instructions sheet behind the "i".
//
// The home: a box pinned to the top of the list tells about the game in focus (the top card
// under it, its border coming and going in the color of the level it is set to, its Play
// filled in that color and its pips showing that level): the game playing itself, its goal,
// and its five difficulty levels with the wins at each, which pick the level Play deals at
// (remembered per game). The other cards show the levels their game reaches in white pips and a
// white-ringed Play. Scrolling brings the next card up into focus; tapping a card brings it
// there; a long press pins a game to the top of the list (a pin by its name) or unpins it.

import { loadSave } from './core/save';
import { PUZZLES, puzzleIcon, type PuzzleType } from './puzzles/catalog';
import { gameCard, setCardDifficulty } from './puzzles/gameCard';
import { PuzzleHost } from './puzzles/host';
import { openRules } from './puzzles/rulesModal';
import { showWin, type WinLevels } from './puzzles/winPanel';
import type { Area, PuzzleView } from './puzzles/view';
import { createSlider, iconButton, ringOn, showToast, type Slider } from './ui/components';
import { countPlay, GOAL_PLAYS } from './core/plays';
import { clearOffers, createGameBar, offerRules, type GameBar } from './puzzles/gamebar';
import { dialFor, difficultyLevel, difficultyRange, difficultyWord, elementForDial, LEVELS, levelInGame, levelWord } from './puzzles/difficulty';
import { lastDial, pinnedGames, recordWin, rememberDial, setPinned, winsOf } from './core/wins';
import { GameDemo } from './puzzles/demo';
import { askRestart, confirming, restartButton } from './puzzles/restart';
import { icon } from './ui/icons';
import { modalOpen } from './ui/modal';
import { reducedMotion } from './ui/nu';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Playground {
  private host: PuzzleHost;
  private type: PuzzleType = PUZZLES[0];
  /** The difficulty dial, 1 to 100, the board is dealt at. */
  private dial = 30;
  private deal = 0;
  private shownHint = '';
  /** The game's goal, shown before the first move of its first plays. */
  private goal = '';
  private solved = false;
  private slider: Slider;
  private undoBtn: HTMLButtonElement;
  private restartBtn: HTMLButtonElement;
  private gbar: GameBar;
  /** The board settings' button, and its pill's open state. */
  private fold: HTMLButtonElement;
  private foldTimer = 0;
  /** The game in focus on the home: the top card, told about in the pinned box. */
  private focusId = '';
  private demo: GameDemo;

  constructor() {
    this.host = new PuzzleHost($('pg-canvas'), () => this.area());
    this.host.onFrame = () => this.tick(this.host.status());
    this.host.onWon = (v) => this.won(v.moves, v.par, v.clean);
    this.host.onLost = (v) => this.lost(v);
    this.demo = new GameDemo($('pg-demo') as HTMLCanvasElement, () => reducedMotion());
    this.renderHome();

    // The board maker, folded into a settings button at the left of the status line (the X folds
    // it again): "Difficulty: 60%", a slider across the dial, filled in the level's color, and a
    // new deal. The slider runs 1 to 100 for every game; the ends a game cannot deal show white.
    // A game opens with it unfolded; three seconds later it folds itself back into the button.
    const bar = $('pg-bar');
    const gen = $('pg-gen');
    this.fold = iconButton({ icon: icon('settings'), label: 'Board settings', className: 'pg-fold', onClick: () => this.setOpen(Boolean(bar.hidden)) });
    this.fold.setAttribute('aria-controls', 'pg-bar');
    gen.prepend(this.fold);
    this.setOpen(false);
    const label = document.createElement('span');
    label.className = 'pg-el';
    label.id = 'pg-el';
    this.slider = createSlider({ min: 1, max: 100, value: this.dial, label: 'Difficulty', format: dialText, onInput: (v) => this.setDial(v) });
    // A new deal: the shuffle and its number are one button.
    const deal = document.createElement('button');
    deal.type = 'button';
    deal.className = 'pg-deal';
    deal.setAttribute('aria-label', 'New deal');
    deal.title = 'New deal';
    deal.innerHTML = `${icon('shuffle')}<span class="pg-dealno" id="pg-dealno"></span>`;
    deal.onclick = () => this.load(this.deal + 1);
    bar.append(label, this.slider.el, deal);
    // Touching the pill keeps it open.
    const keep = () => this.keepOpen();
    bar.addEventListener('pointerdown', keep);
    bar.addEventListener('focusin', keep);

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

    // The home: the card under the pinned box is the one in focus.
    let pending = 0;
    $('pg-home').addEventListener('scroll', () => {
      if (!pending) pending = requestAnimationFrame(() => { pending = 0; this.findFocus(); });
    }, { passive: true });
    new ResizeObserver(() => this.layoutHome()).observe($('pg-home'));

    window.addEventListener('keydown', (e) => this.key(e));
  }

  /** A puzzle is open (not the list of puzzles). */
  get inPuzzle(): boolean {
    return !$('pg-game').hidden;
  }

  show(): void {
    $('puzzles-screen').hidden = false;
    document.body.classList.toggle('pg-playing', this.inPuzzle);
    if (this.inPuzzle) this.host.wake();
    else this.demo.start();
    window.dispatchEvent(new Event('resize'));
    this.layoutHome();
  }

  hide(): void {
    $('puzzles-screen').hidden = true;
    document.body.classList.remove('pg-playing');
    this.host.pause();
    this.demo.stop();
  }

  /** Opens one puzzle from the home list, at the dial it was last played or picked at. */
  open(id: string): void {
    this.demo.stop();
    $('pg-home').hidden = true;
    $('pg-game').hidden = false;
    // A puzzle gets the whole screen: the dock steps away while it is open.
    document.body.classList.add('pg-playing');
    this.select(id);
    // Nu offers a game's rules the first time it is played, and its goal leads for three.
    const before = countPlay(this.type.id);
    this.goal = before < GOAL_PLAYS ? this.type.goal : '';
    if (this.type.make) offerRules(this.gbar, this.type, () => this.instructions());
    this.host.wake();
    window.dispatchEvent(new Event('resize'));
    this.gbar.back.focus({ preventScroll: true });
    // The board settings show open for a few seconds, then fold into their button.
    this.setOpen(true);
    this.foldTimer = window.setTimeout(() => this.foldAway(), 3000);
  }

  /** Back to the list of puzzles. */
  back(): void {
    this.closeWin();
    clearOffers(this.gbar);
    this.keepOpen();
    this.setOpen(false);
    this.host.pause();
    $('pg-game').hidden = true;
    $('pg-home').hidden = false;
    document.body.classList.remove('pg-playing');
    this.paintCard(this.type.id);
    this.paintWins(this.type);
    this.paintFocus(true);
    this.demo.start();
    $('pg-list').querySelector<HTMLElement>(`[data-game="${this.type.id}"] .gcard-go`)?.focus({ preventScroll: false });
  }

  /** Opens or folds the board settings pill. */
  private setOpen(open: boolean): void {
    const bar = $('pg-bar');
    bar.hidden = !open;
    $('pg-gen').classList.toggle('is-open', open);
    this.fold.innerHTML = icon(open ? 'close' : 'settings');
    this.fold.setAttribute('aria-expanded', String(open));
    const label = open ? 'Close board settings' : 'Board settings';
    this.fold.setAttribute('aria-label', label);
    this.fold.title = label;
    if (!open) this.keepOpen();
  }

  /** Cancels the pill's fold on its own (the player has reached for it, or left). */
  private keepOpen(): void {
    window.clearTimeout(this.foldTimer);
    this.foldTimer = 0;
  }

  /** The pill shrinks into its settings button, which then rings once. */
  private foldAway(): void {
    this.foldTimer = 0;
    const bar = $('pg-bar');
    if (bar.hidden || !this.inPuzzle) return;
    const land = () => {
      this.setOpen(false);
      this.fold.classList.remove('is-landed');
      void this.fold.offsetWidth;
      this.fold.classList.add('is-landed');
      window.setTimeout(() => this.fold.classList.remove('is-landed'), 1000);
    };
    if (reducedMotion() || typeof bar.animate !== 'function') { land(); return; }
    const a = bar.getBoundingClientRect();
    const b = this.fold.getBoundingClientRect();
    bar.animate([
      { transform: 'translateX(0) scaleX(1)', opacity: 1 },
      { transform: `translateX(${b.left + b.width / 2 - a.left}px) scaleX(${Math.max(0.04, b.width / a.width)})`, opacity: 0 },
    ], { duration: 420, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' }).finished.then(land, land);
  }

  /** The home: the pinned box about the game in focus, then one card per game: pinned games
   *  first, then the rest, each part in alphabetical order with playable games first; a line on
   *  pinning at the end. Tapping a card (not its Play) brings it into focus; a long press (or a
   *  right click) pins or unpins it. */
  private renderHome(keep = ''): void {
    const list = $('pg-list');
    list.replaceChildren();
    const pins = new Set(pinnedGames());
    const az = [...PUZZLES].sort((a, b) => a.name.localeCompare(b.name));
    const order = (ps: PuzzleType[]) => [...ps.filter((p) => p.make), ...ps.filter((p) => !p.make)];
    const games = [...order(az.filter((p) => pins.has(p.id))), ...order(az.filter((p) => !pins.has(p.id)))];
    for (const p of games) {
      const sec = document.createElement('section');
      sec.className = 'pg-sec';
      sec.dataset.id = p.id;
      sec.setAttribute('aria-label', pins.has(p.id) ? `${p.name}, pinned` : p.name);
      sec.append(gameCard({
        id: p.id,
        name: p.name,
        difficulty: difficultyRange(p.id),
        pipsBeside: true,
        pinned: pins.has(p.id),
        action: p.make ? { label: 'Play', onClick: () => this.open(p.id) } : undefined,
        extra: p.make ? undefined : 'Not built yet',
      }));
      this.longPress(sec, () => this.togglePin(p));
      sec.addEventListener('click', (e) => {
        if (this.pressed) { this.pressed = false; e.preventDefault(); e.stopPropagation(); return; }
        if ((e.target as HTMLElement).closest('button')) return;
        this.bringToFocus(p.id);
      }, true);
      list.append(sec);
    }
    const hint = document.createElement('p');
    hint.className = 'pg-pin-hint';
    hint.textContent = 'Long-press to pin and unpin games';
    list.append(hint);
    this.focusId = games.some((g) => g.id === keep) ? keep : games[0]?.id ?? '';
    this.paintFocus(true);
  }

  /** A long press just fired: the click that ends it is swallowed. */
  private pressed = false;

  /** Runs `fire` when the element is held still for half a second, or right-clicked. */
  private longPress(el: HTMLElement, fire: () => void): void {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let firedAt = 0;
    const stop = () => { window.clearTimeout(timer); timer = 0; start = null; };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        timer = 0;
        firedAt = performance.now();
        this.pressed = true;
        fire();
      }, 500);
    });
    el.addEventListener('pointermove', (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) stop();
    });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('pointerleave', stop);
    // Phones raise a context menu on a long press: the press has done the job. A right click on
    // a computer pins too.
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (performance.now() - firedAt < 1000) return;
      stop();
      fire();
    });
  }

  /** Pins or unpins a game: the list sorts again with that game kept in focus. */
  private togglePin(p: PuzzleType): void {
    const on = !pinnedGames().includes(p.id);
    setPinned(p.id, on);
    navigator.vibrate?.(12);
    this.renderHome(p.id);
    this.layoutHome();
    this.bringToFocus(p.id, true);
    showToast(on ? `${p.name} pinned to the top` : `${p.name} unpinned`);
  }

  /** Room under the last card, so that it too can scroll up under the box. */
  private layoutHome(): void {
    const home = $('pg-home');
    if (home.hidden || !home.clientHeight) return;
    const box = $('pg-focus');
    home.style.setProperty('--focus-h', `${box.offsetHeight}px`);
    const secs = $('pg-list').querySelectorAll<HTMLElement>('.pg-sec');
    const last = secs[secs.length - 1];
    const hint = $('pg-list').querySelector<HTMLElement>('.pg-pin-hint');
    // The home's own padding at the foot keeps clear of the dock; the room goes above it.
    const foot = parseFloat(getComputedStyle(home).paddingBottom) || 0;
    const room = home.clientHeight - foot - box.offsetHeight - (last?.offsetHeight ?? 0) - (hint?.offsetHeight ?? 0) - 46;
    $('pg-list').style.paddingBottom = `${Math.max(0, room)}px`;
    this.findFocus();
  }

  /** The card in focus: the first whose middle is below the pinned box. */
  private findFocus(): void {
    const line = $('pg-focus').getBoundingClientRect().bottom;
    const secs = [...$('pg-list').querySelectorAll<HTMLElement>('.pg-sec')];
    const hit = secs.find((sec) => { const r = sec.getBoundingClientRect(); return r.top + r.height / 2 > line; }) ?? secs[secs.length - 1];
    const id = hit?.dataset.id ?? '';
    if (id && id !== this.focusId) {
      this.focusId = id;
      this.paintFocus(false);
    }
  }

  /** Scrolls a game's card up under the box. */
  private bringToFocus(id: string, now = false): void {
    const sec = $('pg-list').querySelector<HTMLElement>(`.pg-sec[data-id="${id}"]`);
    if (!sec) return;
    const home = $('pg-home');
    // Where the card sits in the list, less the box that will be pinned over the top.
    const at = sec.getBoundingClientRect().top - home.getBoundingClientRect().top + home.scrollTop;
    home.scrollTo({ top: Math.max(0, at - $('pg-focus').offsetHeight - 14), behavior: now || reducedMotion() ? 'auto' : 'smooth' });
  }

  /** The box and the rings for the game in focus. */
  private paintFocus(force: boolean): void {
    const p = PUZZLES.find((g) => g.id === this.focusId);
    if (!p) return;
    $('pg-list').querySelectorAll<HTMLElement>('.pg-sec').forEach((sec) => {
      const on = sec.dataset.id === p.id;
      sec.classList.toggle('is-focus', on);
      if (on) sec.style.setProperty('--lvl', `var(--c-lvl-${difficultyLevel(this.dialOf(p.id))})`);
      // The pips show the levels the game reaches in white; in focus, the one Play deals at is in
      // its level's color.
      setCardDifficulty(sec, difficultyRange(sec.dataset.id!), on ? this.dialOf(sec.dataset.id!) : undefined);
      const card = sec.querySelector<HTMLElement>('.gcard');
      if (card) ringOn(card, on ? 'focus' : null);
    });
    const box = $('pg-focus');
    if (!force && box.dataset.id === p.id) return;
    box.dataset.id = p.id;
    box.setAttribute('aria-label', p.name);
    $('pg-focus-name').textContent = p.name;
    $('pg-focus-goal').textContent = p.goal || p.blurb;
    this.paintWins(p);
    this.demo.show(p);
  }

  /** The focused game's five levels: its wins at each (the solved count and the flawless stars),
   *  and the one Play deals at, filled in its color. Tapping a level picks it. Levels its boards
   *  never reach are an empty outline; levels not yet won show a dash. */
  private paintWins(p: PuzzleType): void {
    const row = $('pg-levels');
    if ($('pg-focus').dataset.id !== p.id) return;
    const { lo, hi } = difficultyRange(p.id);
    const from = difficultyLevel(lo);
    const to = difficultyLevel(hi);
    const wins = winsOf(p.id);
    const picked = difficultyLevel(this.dialOf(p.id));
    row.setAttribute('aria-label', `${p.name} difficulty, with wins at each level`);
    row.innerHTML = Array.from({ length: LEVELS }, (_, i) => {
      const level = i + 1;
      const word = levelWord(level);
      if (level < from || level > to) {
        return `<button type="button" class="pg-lvl is-off" role="radio" aria-checked="false" disabled title="${word}: not dealt in ${p.name}"><span class="pg-lvl-word">${word}</span><span class="pg-lvl-none"></span><span class="sr-only">: not dealt</span></button>`;
      }
      const w = wins[i];
      const on = level === picked;
      const say = w.solved ? `${word}: ${w.solved} solved, ${w.flawless} flawless` : `${word}: not solved yet`;
      const val = w.solved
        ? `<span class="pg-lvl-n">${icon('check', { size: 12 })}${w.solved}</span>` + (w.flawless ? `<span class="pg-lvl-star">${icon('star', { size: 12 })}${w.flawless}</span>` : '')
        : `<span class="pg-lvl-dash">–</span>`;
      return `<button type="button" class="pg-lvl lvl-${level}${on ? ' is-on' : ''}${w.solved ? ' is-won' : ''}" role="radio" aria-checked="${on}" data-level="${level}" title="${say}" aria-label="${say}">`
        + `<span class="pg-lvl-word" aria-hidden="true">${word}</span><span class="pg-lvl-val" aria-hidden="true">${val}</span></button>`;
    }).join('');
    row.querySelectorAll<HTMLButtonElement>('.pg-lvl[data-level]').forEach((b) => {
      b.onclick = () => this.pickLevel(p.id, Number(b.dataset.level));
    });
  }

  /** A card's pips, and the focus color, after its dial has changed. */
  private paintCard(id: string): void {
    const sec = $('pg-list').querySelector<HTMLElement>(`.pg-sec[data-id="${id}"]`);
    if (!sec) return;
    const on = sec.classList.contains('is-focus');
    setCardDifficulty(sec, difficultyRange(id), on ? this.dialOf(id) : undefined);
    sec.style.setProperty('--lvl', `var(--c-lvl-${difficultyLevel(this.dialOf(id))})`);
  }

  /** The dial a game opens at: where it was last played or picked, or an easy board. */
  private dialOf(id: string): number {
    return dialFor(id, lastDial(id) ?? 30);
  }

  /** Picks a level on the home: the remembered dial if it is in that level, else its middle. */
  private pickLevel(id: string, level: number): void {
    const span = levelInGame(id, level);
    if (!span) return;
    const now = this.dialOf(id);
    if (difficultyLevel(now) !== level) rememberDial(id, Math.round((span.lo + span.hi) / 2));
    this.paintCard(id);
    const p = PUZZLES.find((g) => g.id === id);
    if (p) this.paintWins(p);
    $('pg-levels').querySelector<HTMLElement>(`[data-level="${level}"]`)?.focus({ preventScroll: true });
  }

  private select(id: string): void {
    this.type = PUZZLES.find((p) => p.id === id) ?? PUZZLES[0];
    this.gbar.setTitle(this.type.name, puzzleIcon(this.type.id, 22));
    this.dial = this.dialOf(this.type.id);
    this.rebuildSlider();
    $('pg-planned').hidden = Boolean(this.type.make);
    $('pg-play').hidden = !this.type.make;
    this.load(0);
  }

  /** The slider always spans the whole dial; the part the game cannot deal follows the puzzle
   *  type, so it is rebuilt when that changes. */
  private rebuildSlider(): void {
    const { lo, hi } = difficultyRange(this.type.id);
    const fresh = createSlider({ min: 1, max: 100, value: this.dial, label: 'Difficulty', format: dialText, allowed: [lo, hi], onInput: (v) => this.setDial(v) });
    this.slider.el.replaceWith(fresh.el);
    this.slider = fresh;
  }

  private setDial(d: number): void {
    const next = dialFor(this.type.id, d);
    if (next === this.dial) return;
    this.dial = next;
    this.load(0);
  }

  /** The element the board is dealt for, which a few games show (Tokamak's nucleus). */
  private get z(): number {
    return elementForDial(this.type.id, this.dial);
  }

  private load(deal: number): void {
    this.deal = deal;
    this.solved = false;
    this.closeWin();
    $('pg-el').textContent = `Difficulty: ${this.dial}%`;
    $('pg-el').title = dialText(this.dial);
    this.slider.set(this.dial);
    this.slider.el.style.setProperty('--slider-fill', `var(--c-lvl-${difficultyLevel(this.dial)})`);
    $('pg-dealno').textContent = `#${deal + 1}`;
    rememberDial(this.type.id, this.dial);
    this.shownHint = '';
    this.gbar.setDifficulty(this.dial);
    this.gbar.update(null, '');
    if (!this.type.make) {
      this.host.set(null);
      this.undoBtn.disabled = true;
      this.restartBtn.disabled = true;
      return;
    }
    const reduced = loadSave().settings.reducedMotion;
    this.host.reducedMotion = reduced;
    this.host.set(this.type.makeAt!(this.dial, deal, reduced));
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
    const flawless = clean && (par === null || moves <= par);
    recordWin(t.id, this.dial, flawless);
    this.closeWin = showWin({
      outcome: flawless ? 'flawless' : 'won',
      headline: flawless ? 'Flawless' : 'Solved',
      title: `${t.name} · ${dialText(this.dial)}`,
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
  private lost(v: PuzzleView): void {
    const t = this.type;
    const undo = Boolean(v.loss?.undo && v.canUndo());
    this.closeWin = showWin({
      outcome: 'lost',
      headline: v.loss?.headline ?? 'Out of guesses',
      title: `${t.name} · ${dialText(this.dial)}`,
      game: t.id,
      stats: [{ label: 'Moves', value: String(v.moves) }, { label: 'Deal', value: `#${this.deal + 1}` }],
      actions: [
        ...(undo ? [{ label: 'Undo', primary: true, onClick: () => this.host.undo() }] : []),
        { label: 'Try again', primary: !undo, onClick: () => this.host.restart() },
        { label: 'New deal', onClick: () => this.load(this.deal + 1) },
        { label: 'All puzzles', onClick: () => this.back() },
      ],
    }, loadSave().settings.reducedMotion);
  }

  /** The levels row on the win sheet: another board of this game at any level it reaches, at a
   *  fresh dial inside that level. */
  private levels(): WinLevels {
    const id = this.type.id;
    return {
      current: difficultyLevel(this.dial),
      reachable: [1, 2, 3, 4, 5].filter((l) => levelInGame(id, l)),
      pick: (level) => {
        const span = levelInGame(id, level);
        if (!span) return;
        const d = span.lo + Math.floor(Math.random() * (span.hi - span.lo + 1));
        if (d === this.dial) this.load(this.deal + 1);
        else { this.dial = d; this.load(0); }
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

/** The dial as the slider and the win sheet say it: "Hard · 68%". */
function dialText(d: number): string {
  return `${difficultyWord(d)} · ${d}%`;
}
