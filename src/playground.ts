// The Practice screen: a home that lists every puzzle type and what it builds in the game, and
// each puzzle on its own (any element, any deal) behind it, with Back to return. Practice never
// builds atoms; the game proper reaches puzzles through each atom's Build mode. How-to text lives in
// the Instructions sheet behind the "i"; the header microscope opens the science.

import { elementAt as element } from './gallery/data';
import { loadSave } from './core/save';
import { PUZZLES, puzzleIcon, TIER_LABEL, TIER_NOTE, type PuzzleType, type Tier } from './puzzles/catalog';
import { PuzzleHost } from './puzzles/host';
import { openRules } from './puzzles/rulesModal';
import { showWin } from './puzzles/winPanel';
import type { Area } from './puzzles/view';
import { createSlider, iconButton, type Slider } from './ui/components';
import { countPlay, GOAL_PLAYS } from './core/plays';
import { clearOffers, createGameBar, offerRules, type GameBar } from './puzzles/gamebar';
import { difficulty } from './puzzles/difficulty';
import { askRestart, confirming, restartButton } from './puzzles/restart';
import { icon } from './ui/icons';
import { scienceButton, setScienceHandler } from './ui/science';
import { modalOpen, openModal } from './ui/modal';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TIERS: Tier[] = ['every', 'facet', 'gate', 'reserve'];

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

    // The tools beside Back: undo, restart, hint, instructions, the science.
    this.undoBtn = iconButton({ icon: icon('undo'), label: 'Undo', onClick: () => this.host.undo() });
    this.restartBtn = restartButton(this.restartOptions());
    this.host.onRestartKey = () => void askRestart(this.restartOptions());
    this.gbar = createGameBar([
      this.undoBtn,
      this.restartBtn,
      this.host.hints.button,
      iconButton({ icon: icon('info'), label: 'Instructions', onClick: () => this.instructions() }),
    ], { label: 'All games', onClick: () => this.back() }, [scienceButton('ui-icon-btn science-btn')]);
    $('pg-gbar').append(this.gbar.el);
    // The board settings sit at the left of the status line; open, they cover the rest of it.
    this.gbar.foot.classList.add('has-gen');
    this.gbar.foot.querySelector('.gfoot-line')!.prepend(gen);
    $('pg-home-head').append(scienceButton());

    window.addEventListener('keydown', (e) => this.key(e));
  }

  private get inPuzzle(): boolean {
    return !$('pg-game').hidden;
  }

  show(): void {
    $('puzzles-screen').hidden = false;
    if (this.inPuzzle) this.host.wake();
    this.registerScience();
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
    this.registerScience();
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
    this.registerScience();
    $('pg-list').querySelector<HTMLElement>(`[data-id="${this.type.id}"]`)?.focus({ preventScroll: false });
  }

  /** The header microscope: the science behind the open puzzle, or how puzzles fit the game. */
  private registerScience(): void {
    if (this.inPuzzle) setScienceHandler(() => this.science(), `The science behind ${this.type.name}`);
    else setScienceHandler(() => this.aboutPuzzles(), 'How practice fits the game');
  }

  private renderHome(): void {
    const list = $('pg-list');
    list.innerHTML = TIERS.map((tier) => {
      const items = PUZZLES.filter((p) => p.tier === tier);
      if (!items.length) return '';
      return `<section class="pg-group">
        <h2 class="pg-group-name">${TIER_LABEL[tier]}</h2>
        <p class="pg-group-note">${TIER_NOTE[tier]}</p>
        <div class="pg-cards">${items.map((p) => this.card(p)).join('')}</div>
      </section>`;
    }).join('');
    list.querySelectorAll<HTMLButtonElement>('.pg-card').forEach((b) => (b.onclick = () => this.open(b.dataset.id!)));
    list.querySelectorAll<HTMLCanvasElement>('canvas.pg-thumb').forEach((c) => drawThumb(c, PUZZLES.find((p) => p.id === c.dataset.id)!));
  }

  private card(p: PuzzleType): string {
    const [lo, hi] = p.zRange;
    const range = lo === hi ? `Element ${lo}, ${element(lo).name}` : `Elements ${lo} to ${hi} · ${element(lo).symbol} to ${element(hi).symbol}`;
    return `<button class="pg-card" data-id="${p.id}" type="button">
      <canvas class="pg-thumb" data-id="${p.id}" aria-hidden="true"></canvas>
      <span class="pg-card-text">
        <span class="pg-card-top"><span class="pg-card-icon" aria-hidden="true">${puzzleIcon(p.id, 20)}</span><b class="pg-card-name">${p.name}</b></span>
        <span class="pg-card-blurb">${p.blurb}</span>
        <span class="pg-card-range">${range}</span>
      </span>
    </button>`;
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
    const [, hi] = t.zRange;
    const flawless = clean && (par === null || moves <= par);
    const parText = par === null ? 'none' : moves <= par ? `${par} ✓` : `${par}`;
    this.closeWin = showWin($('pg-play'), {
      kicker: flawless ? 'Flawless' : 'Solved',
      title: `${t.name} · ${el.name}`,
      flawless,
      stats: [
        { label: 'Moves', value: String(moves) },
        { label: 'Par', value: parText },
        { label: 'Deal', value: `#${this.deal + 1}` },
      ],
      note: flawless
        ? (par === null ? 'Not a single slip.' : moves < par ? `${par - moves} under par. Beautifully done.` : 'Right on par, with nothing spoiled.')
        : (!clean ? 'Solved, with a slip along the way. A clean run earns flawless.' : `${moves - (par ?? moves)} over par. Try for par on this deal or a new one.`),
      actions: [
        ...(this.z < hi ? [{ label: `Next: ${element(this.z + 1).name}`, primary: true, onClick: () => this.setZ(this.z + 1) }] : []),
        { label: 'New deal', primary: this.z >= hi, onClick: () => this.load(this.deal + 1) },
        { label: 'All puzzles', onClick: () => this.back() },
      ],
    }, loadSave().settings.reducedMotion);
  }

  private instructions(): void {
    const t = this.type;
    openRules(t, { reducedMotion: loadSave().settings.reducedMotion });
  }

  private science(): void {
    const html = this.type.science?.(this.z) ?? `<h2>${this.type.name}</h2><p>${this.type.blurb}</p>`;
    openModal(html);
  }

  private aboutPuzzles(): void {
    openModal(`<h2>Practice and atoms</h2><div class="how">
      <p>Atoms are built on their own Build pages. Each takes two puzzles, in any order: Tokamak gathers its nucleus and Quanta settles its electrons. Once it is built, its isotopes open: each lasting one has its own puzzle, and for a fleeting one you pick any isotope puzzle. Glyph opens new ways to see the collection.</p>
      <p>Practice lets you play any of them on any atom, as often as you like. Nothing here builds an atom.</p>
      <p class="meta">Each puzzle is a game first. Where a mechanic bends the science for fun, its labels stay true, and the microscope above each puzzle says what is real and what is only a game rule.</p></div>`);
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
      restart: () => { this.host.restart(); this.solved = false; this.closeWin(); },
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

/** A still of the puzzle on carbon (or its first element), drawn once for its card. */
function drawThumb(c: HTMLCanvasElement, p: PuzzleType): void {
  if (!p.make) return;
  const css = 88;
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
