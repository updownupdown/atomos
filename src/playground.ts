// The Puzzles screen: a home that lists every puzzle type, what it is for and
// whether the game uses it yet, and each puzzle on its own (any element, any
// deal) behind it, with Back to return. For playtesting and tuning; the game
// proper reaches puzzles through each atom's Build mode. How-to text lives in
// the Instructions sheet behind the "i"; the header microscope opens the science.

import { elementAt as element } from './gallery/data';
import { loadSave } from './core/save';
import { PUZZLES, TIER_LABEL, TIER_NOTE, type PuzzleType, type Tier } from './puzzles/catalogue';
import { PuzzleHost } from './puzzles/host';
import type { Area } from './puzzles/view';
import { createHoldButton, createSlider, iconButton, type Slider } from './ui/components';
import { icon } from './ui/icons';
import { setScienceHandler } from './ui/science';
import { modalOpen, openModal } from './ui/modal';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TIERS: Tier[] = ['every', 'facet', 'gate', 'reserve'];

export class Playground {
  private host: PuzzleHost;
  private type: PuzzleType = PUZZLES[0];
  private z = 6;
  private deal = 0;
  private shownHint = '';
  private solved = false;
  private slider: Slider;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private restartBtn: HTMLButtonElement;

  constructor() {
    this.host = new PuzzleHost($('pg-canvas'), () => this.area());
    this.host.onFrame = (v) => this.tick(v.moves, v.par, v.hint());
    this.host.onWon = (v) => this.won(v.moves, v.par, v.clean);
    this.renderHome();
    this.renderHead();

    // The element row: previous, the element, next, a slider across the range, a new deal.
    const bar = $('pg-bar');
    this.prev = iconButton({ icon: icon('prev'), label: 'Previous element', className: 'ui-icon-btn--ghost', onClick: () => this.setZ(this.z - 1) });
    this.next = iconButton({ icon: icon('next'), label: 'Next element', className: 'ui-icon-btn--ghost', onClick: () => this.setZ(this.z + 1) });
    const label = document.createElement('span');
    label.className = 'pg-el';
    label.id = 'pg-el';
    this.slider = createSlider({ min: 1, max: 118, value: this.z, label: 'Element', format: (v) => element(v).symbol, onInput: (v) => this.setZ(v) });
    const deal = document.createElement('div');
    deal.className = 'pg-deal';
    deal.append(iconButton({ icon: icon('shuffle'), label: 'New deal', className: 'ui-icon-btn--ghost', onClick: () => this.load(this.deal + 1) }));
    const dealNo = document.createElement('span');
    dealNo.className = 'pg-dealno';
    dealNo.id = 'pg-dealno';
    deal.append(dealNo);
    bar.append(this.prev, label, this.next, this.slider.el, deal);

    // The bottom row: undo, hold to restart, instructions, the science.
    this.undoBtn = iconButton({ icon: icon('undo'), label: 'Undo', onClick: () => this.host.undo() });
    this.restartBtn = createHoldButton({ icon: icon('restart'), label: 'Restart', doneLabel: 'Restarted', onConfirm: () => { this.host.restart(); this.solved = false; $('pg-done').hidden = true; } });
    $('pg-actions').append(
      this.undoBtn,
      this.restartBtn,
      iconButton({ icon: icon('info'), label: 'Instructions', onClick: () => this.instructions() }),
    );

    $('pg-again').onclick = () => this.load(this.deal + 1);
    $('pg-nextel').onclick = () => this.setZ(this.z + 1);
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
    this.host.wake();
    this.registerScience();
    window.dispatchEvent(new Event('resize'));
    $('pg-back').focus({ preventScroll: true });
  }

  /** Back to the list of puzzles. */
  back(): void {
    this.host.pause();
    $('pg-game').hidden = true;
    $('pg-home').hidden = false;
    this.registerScience();
    $('pg-list').querySelector<HTMLElement>(`[data-id="${this.type.id}"]`)?.focus({ preventScroll: false });
  }

  /** The header microscope: the science behind the open puzzle, or how puzzles fit the game. */
  private registerScience(): void {
    if (this.inPuzzle) setScienceHandler(() => this.science(), `The science behind ${this.type.name}`);
    else setScienceHandler(() => this.aboutPuzzles(), 'How puzzles fit the game');
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
    const status = p.live
      ? `<span class="pg-chip pg-chip--live">In the game</span>`
      : p.make ? `<span class="pg-chip">Playground only</span>` : `<span class="pg-chip pg-chip--planned">Not built</span>`;
    return `<button class="pg-card" data-id="${p.id}" type="button">
      <canvas class="pg-thumb" data-id="${p.id}" aria-hidden="true"></canvas>
      <span class="pg-card-text">
        <span class="pg-card-top"><b class="pg-card-name">${p.name}</b>${status}</span>
        <span class="pg-card-blurb">${p.blurb}</span>
        <span class="pg-card-use"><span class="pg-card-k">For</span> ${p.live ?? p.role}</span>
        ${p.live ? `<span class="pg-card-use pg-card-plan"><span class="pg-card-k">Plan</span> ${p.role}</span>` : ''}
        <span class="pg-card-range">${range}</span>
      </span>
    </button>`;
  }

  private renderHead(): void {
    const head = $('pg-head');
    const back = iconButton({ icon: icon('chevron-left'), label: 'Back to all puzzles', className: 'ui-icon-btn--ghost', onClick: () => this.back() });
    back.id = 'pg-back';
    const title = document.createElement('div');
    title.className = 'pg-title';
    title.innerHTML = '<b id="pg-name"></b><span id="pg-tier"></span>';
    head.append(back, title);
  }

  private select(id: string): void {
    this.type = PUZZLES.find((p) => p.id === id) ?? PUZZLES[0];
    $('pg-name').textContent = this.type.name;
    $('pg-tier').textContent = TIER_LABEL[this.type.tier];
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
    $('pg-done').hidden = true;
    const el = element(this.z);
    const [lo, hi] = this.type.zRange;
    $('pg-el').innerHTML = `<small>${el.z}</small><b>${el.symbol}</b><span>${el.name}</span>`;
    this.slider.set(this.z);
    this.prev.disabled = this.z <= lo;
    this.next.disabled = this.z >= hi;
    $<HTMLButtonElement>('pg-nextel').disabled = this.z >= hi;
    $('pg-dealno').textContent = `#${deal + 1}`;
    this.shownHint = '';
    $('pg-hint').textContent = '';
    if (!this.type.make) {
      this.host.set(null);
      $('pg-count').textContent = '';
      this.undoBtn.disabled = true;
      return;
    }
    const reduced = loadSave().settings.reducedMotion;
    this.host.set(this.type.make(this.z, deal, reduced));
  }

  private tick(moves: number, par: number | null, hint: string): void {
    $('pg-count').textContent = `${moves} move${moves === 1 ? '' : 's'}${par !== null ? ` · par ${par}` : ''}`;
    this.undoBtn.disabled = !this.host.current?.canUndo();
    // Status only: strip any markup a view still returns, and keep it to one line.
    const plain = hint.replace(/<[^>]+>/g, '');
    if (plain !== this.shownHint) {
      this.shownHint = plain;
      $('pg-hint').textContent = plain.length > 60 ? '' : plain;
    }
  }

  private won(moves: number, par: number | null, clean: boolean): void {
    this.solved = true;
    const under = par === null ? '' : moves <= par ? ' · at par or under' : ` · ${moves - par} over par`;
    $('pg-result').textContent = `Solved in ${moves} move${moves === 1 ? '' : 's'}${under}${clean ? '' : ' · not flawless'}`;
    $('pg-done').hidden = false;
  }

  private instructions(): void {
    const t = this.type;
    openModal(`<div class="how"><h2>${t.name}</h2><p>${t.blurb}</p>${t.instructions ?? ''}<h3>Where it sits</h3><p class="meta">${t.role}</p></div>`);
  }

  private science(): void {
    const html = this.type.science?.(this.z) ?? `<h2>${this.type.name}</h2><p>${this.type.blurb}</p>`;
    openModal(html);
  }

  private aboutPuzzles(): void {
    openModal(`<div class="how"><h2>Puzzles and atoms</h2>
      <p>Every atom in the collection is won by solving puzzles. Building an atom takes two: one gathers its nucleus, the next places its electrons. That is <b>Build</b> mode, and it uses Merge (helium to iron), Sliding Block (cobalt on) and Orbital Grid (every element).</p>
      <p><b>Facets</b> will unlock deeper layers of an atom you own, such as its isotopes or the shapes of its orbitals. <b>Gates</b> will open new parts of the game. <b>Reserve</b> puzzles are built to try out, without a place yet.</p>
      <p class="meta">Each puzzle is a game first. Where a mechanic bends the science for fun, its labels stay true, and the microscope above each puzzle says what is real and what is only a game rule.</p></div>`);
  }

  private area(): Area {
    const r = $('pg-canvas').getBoundingClientRect();
    const w = r.width;
    const colW = w < 700 ? w - 16 : Math.min(720, w * 0.7);
    return { x: (w - colW) / 2, y: 6, w: colW, h: Math.max(200, r.height - 12) };
  }

  private key(e: KeyboardEvent): void {
    if ($('puzzles-screen').hidden || modalOpen() || !this.inPuzzle) return;
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
