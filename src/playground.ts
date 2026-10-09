// The Puzzles screen: every puzzle type on its own, any element, any deal,
// for playtesting and tuning. Temporary; the game proper reaches puzzles
// through each atom's Build mode.

import { elementAt as element } from './gallery/data';
import { loadSave } from './core/save';
import { PUZZLES, TIER_LABEL, type PuzzleType, type Tier } from './puzzles/catalogue';
import { PuzzleHost } from './puzzles/host';
import type { Area } from './puzzles/view';
import { MICROSCOPE } from './ui/icons';
import { closeModal, modalOpen, openModal } from './ui/modal';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TIERS: Tier[] = ['every', 'facet', 'gate', 'reserve'];

export class Playground {
  private host: PuzzleHost;
  private type: PuzzleType = PUZZLES[0];
  private z = 6;
  private deal = 0;
  private shownHint = '';
  private solved = false;

  constructor() {
    this.host = new PuzzleHost($('pg-canvas'), () => this.area());
    this.host.onFrame = (v) => this.tick(v.moves, v.par, v.hint());
    this.host.onWon = (v) => this.won(v.moves, v.par);
    this.renderTypes();
    $('pg-prev').onclick = () => this.setZ(this.z - 1);
    $('pg-next').onclick = () => this.setZ(this.z + 1);
    $<HTMLInputElement>('pg-range').oninput = (e) => this.setZ(Number((e.target as HTMLInputElement).value));
    $('pg-deal').onclick = () => this.load(this.deal + 1);
    $('pg-undo').onclick = () => this.host.undo();
    $('pg-restart').onclick = () => this.host.restart();
    $('pg-science').onclick = () => this.science();
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
    box.innerHTML = TIERS.map((tier) => `
      <div class="pg-tier">
        <span class="pg-tier-name">${TIER_LABEL[tier]}</span>
        ${PUZZLES.filter((p) => p.tier === tier).map((p) => `<button data-id="${p.id}" class="${p.make ? '' : 'planned'}" aria-pressed="false">${p.name}</button>`).join('')}
      </div>`).join('');
    box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.select(b.dataset.id!)));
  }

  private select(id: string): void {
    this.type = PUZZLES.find((p) => p.id === id)!;
    $('pg-types').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    $('pg-title').textContent = this.type.name;
    $('pg-role').textContent = this.type.role;
    $('pg-blurb').textContent = this.type.blurb;
    const [lo, hi] = this.type.zRange;
    const range = $<HTMLInputElement>('pg-range');
    range.min = String(lo);
    range.max = String(hi);
    this.z = Math.min(hi, Math.max(lo, this.z));
    this.deal = 0;
    $('pg-planned').hidden = Boolean(this.type.make);
    $('pg-play').hidden = !this.type.make;
    this.load(0);
  }

  private setZ(z: number): void {
    const [lo, hi] = this.type.zRange;
    if (z < lo || z > hi) return;
    this.z = z;
    this.load(0);
  }

  private load(deal: number): void {
    this.deal = deal;
    this.solved = false;
    $('pg-done').hidden = true;
    const el = element(this.z);
    const [lo, hi] = this.type.zRange;
    $('pg-el').innerHTML = `<b>${el.z}</b> ${el.symbol} <span>${el.name}</span>`;
    $<HTMLInputElement>('pg-range').value = String(this.z);
    $<HTMLButtonElement>('pg-prev').disabled = this.z <= lo;
    $<HTMLButtonElement>('pg-next').disabled = this.z >= hi;
    $<HTMLButtonElement>('pg-nextel').disabled = this.z >= hi;
    $('pg-dealno').textContent = `deal ${deal + 1}`;
    if (!this.type.make) {
      this.host.set(null);
      this.shownHint = '';
      $('pg-hint').innerHTML = '';
      $('pg-count').textContent = '';
      $<HTMLButtonElement>('pg-undo').disabled = true;
      return;
    }
    const reduced = loadSave().settings.reducedMotion;
    this.host.set(this.type.make(this.z, deal, reduced));
    this.shownHint = '';
  }

  private tick(moves: number, par: number | null, hint: string): void {
    $('pg-count').textContent = `${moves} move${moves === 1 ? '' : 's'}${par !== null ? ` · par ${par}` : ''}`;
    $<HTMLButtonElement>('pg-undo').disabled = !this.host.current?.canUndo();
    if (hint !== this.shownHint) {
      this.shownHint = hint;
      $('pg-hint').innerHTML = hint;
    }
  }

  private won(moves: number, par: number | null): void {
    this.solved = true;
    const under = par === null ? '' : moves <= par ? ' · at par or under' : ` · ${moves - par} over par`;
    $('pg-result').textContent = `Solved in ${moves} move${moves === 1 ? '' : 's'}${under}`;
    $('pg-done').hidden = false;
  }

  private science(): void {
    const html = this.type.science?.(this.z) ?? `<h2>${this.type.name}</h2><p>${this.type.blurb}</p><p class="muted">${this.type.role}</p>`;
    const sheet = openModal(`${html}<div class="actions"><button class="primary" id="sci-close">Back to the puzzle</button></div>`);
    sheet.querySelector<HTMLButtonElement>('#sci-close')!.onclick = () => closeModal();
  }

  private area(): Area {
    const r = $('pg-canvas').getBoundingClientRect();
    const w = r.width;
    const colW = w < 900 ? w - 24 : Math.min(560, w * 0.6);
    return { x: (w - colW) / 2, y: 8, w: colW, h: Math.max(200, r.height - 16) };
  }

  private key(e: KeyboardEvent): void {
    if ($('puzzles-screen').hidden || modalOpen()) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (this.solved && e.key === 'Enter') { this.load(this.deal + 1); return; }
    if (this.host.key(e)) e.preventDefault();
  }
}

export { MICROSCOPE };
