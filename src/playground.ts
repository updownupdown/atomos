// The Puzzles screen: every puzzle type on its own, any element, any deal,
// for playtesting and tuning. Temporary; the game proper reaches puzzles
// through each atom's Build mode. How-to text lives in the Instructions sheet
// behind the "i", so the board gets the whole screen.

import { elementAt as element } from './gallery/data';
import { loadSave } from './core/save';
import { PUZZLES, TIER_LABEL, type PuzzleType, type Tier } from './puzzles/catalogue';
import { PuzzleHost } from './puzzles/host';
import type { Area } from './puzzles/view';
import { createHoldButton, createSlider, iconButton, type Slider } from './ui/components';
import { MICROSCOPE, icon } from './ui/icons';
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
    this.renderTypes();

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
      iconButton({ icon: MICROSCOPE, label: 'The science behind this puzzle', onClick: () => this.science() }),
    );

    $('pg-again').onclick = () => this.load(this.deal + 1);
    $('pg-nextel').onclick = () => this.setZ(this.z + 1);
    window.addEventListener('keydown', (e) => this.key(e));
    this.select(this.type.id);
  }

  show(): void {
    $('puzzles-screen').hidden = false;
    this.host.wake();
    window.dispatchEvent(new Event('resize'));
  }

  hide(): void {
    $('puzzles-screen').hidden = true;
    this.host.pause();
  }

  private renderTypes(): void {
    const box = $('pg-types');
    box.innerHTML = TIERS.map((tier) => {
      const items = PUZZLES.filter((p) => p.tier === tier);
      if (!items.length) return '';
      return `<div class="pg-tier"><span class="pg-tier-name">${TIER_LABEL[tier]}</span>${items.map((p) => `<button role="tab" data-id="${p.id}" class="${p.make ? '' : 'planned'}" aria-selected="false">${p.name}</button>`).join('')}</div>`;
    }).join('');
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.select(b.dataset.id!)));
  }

  private select(id: string): void {
    this.type = PUZZLES.find((p) => p.id === id) ?? PUZZLES[0];
    $('pg-types').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const on = b.dataset.id === this.type.id;
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
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

  private area(): Area {
    const r = $('pg-canvas').getBoundingClientRect();
    const w = r.width;
    const colW = w < 700 ? w - 16 : Math.min(720, w * 0.7);
    return { x: (w - colW) / 2, y: 6, w: colW, h: Math.max(200, r.height - 12) };
  }

  private key(e: KeyboardEvent): void {
    if ($('puzzles-screen').hidden || modalOpen()) return;
    const t = e.target as HTMLElement | null;
    if (t?.tagName === 'INPUT' || t?.closest?.('.ui-slider')) return;
    if (this.solved && e.key === 'Enter') { this.load(this.deal + 1); return; }
    if (this.host.key(e)) e.preventDefault();
  }
}
