// Collect: the whole table at once, and one atom large.
//
//   header                         COLLECT                 [⚛ Atoms v]  (atomlist.ts)
//   ┌ the periodic table ┐   ◎ Stable   13%                 the progress, on the right;
//   │ ▪ . . . . . . . ▪  │   ◎ Fleeting  3%                 Next selects the next atom to
//   └────────────────────┘   [▸ Next]                        build, which Nu circles in the table
//              v                                            the chevron widens the table a while
//            (the atom, as its gem)                         the lens: tap to open the atom,
//         ‹    26 Fe · Stable collected    ›                swipe or the chevrons to step
//                   Iron
//          Stable ▬▬  Fleeting ▬   [Build]
//
// Each cell's tone (thumbs.ts Tone): not started (gray), started or built (its block's color,
// pale), stable collected (in full) and all collected (in full, glowing). The atom in the lens
// wears a still white ring.

import { MAX_Z, elementAt, placeColour } from './data';
import { atomPicture, toneOf, type Tone } from './thumbs';
import { GemAtom } from './gem';
import { atomBuilt, fleetingCount, rowOf, rowOpen, rowSpan, segmentsOf } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import { nextStep } from '../core/next';
import { fleetingOpen, periodSentence } from './locks';
import type { TrackRow } from '../ui/tracks';
import { tableCell } from '../ui/picker';
import { atomShares, collectionProgress, shareBar, shareRing } from './atomlist';
import { nextButton } from '../ui/components';
import { icon } from '../ui/icons';
import { reducedMotion } from '../ui/nu';
import './collect.css';

export interface CollectHandlers {
  /** The lens was tapped: open the atom. */
  onOpen: (z: number) => void;
}

/** One period's progress: atoms built, the stable parts built (every atom's nucleus, electrons
 *  and lasting isotopes) and the fleeting isotopes built, as counts and as shares from 0 to 1. */
export function periodProgress(period: number, save: SaveData): { atoms: number; built: number; stable: number; stableBuilt: number; stableTotal: number; fleeting: number; fleetingBuilt: number; fleetingTotal: number } {
  const [first, last] = rowSpan(period);
  let built = 0, sb = 0, st = 0, fb = 0, ft = 0;
  for (let z = first; z <= last; z++) {
    if (atomBuilt(z, save)) built++;
    const segs = segmentsOf(z, save);
    sb += segs.filter((x) => x.done).length;
    st += segs.length;
    const f = fleetingCount(z, save);
    fb += f.built;
    ft += f.total;
  }
  const atoms = last - first + 1;
  return { atoms, built, stable: st ? sb / st : 0, stableBuilt: sb, stableTotal: st, fleeting: ft ? fb / ft : 0, fleetingBuilt: fb, fleetingTotal: ft };
}

/** The two tracks' stops for each atom of a period: its stable share as a bar, and its fleeting
 *  share as a bar beside it (none for an atom without fleeting isotopes). */
export function periodTracks(period: number, save: SaveData): TrackRow[] {
  const [first, last] = rowSpan(period);
  const locked = !rowOpen(period, save);
  const fleetOn = fleetingOpen(save);
  const rows: TrackRow[] = [];
  for (let z = first; z <= last; z++) {
    const segs = segmentsOf(z, save);
    const share = segs.length ? segs.filter((s) => s.done).length / segs.length : 0;
    const f = fleetingCount(z, save);
    const fshare = f.total ? f.built / f.total : 0;
    rows.push({
      stable: { kind: 'bar', share, done: share >= 1, locked },
      fleeting: f.total ? { kind: 'bar', share: fleetOn ? fshare : 0, done: fleetOn && fshare >= 1, locked: locked || !fleetOn } : null,
    });
  }
  return rows;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The share as a whole percent, never rounding a start up to nothing or a near miss up to all. */
export function pctLabel(v: number): string {
  if (v <= 0) return '0%';
  if (v >= 1) return '100%';
  return `${Math.min(99, Math.max(1, Math.round(v * 100)))}%`;
}


/** How far an atom is collected, in words; `started` is an atom with a part built but not all. */
type Status = Tone | 'started';
const STATUS_WORD: Record<Status, string> = { unbuilt: 'Not started', started: 'Started', built: 'Built', stable: 'Stable collected', complete: 'All collected' };

function statusOf(z: number, save: SaveData): Status {
  const tone = toneOf(z, save);
  if (tone === 'unbuilt' && segmentsOf(z, save).some((s) => s.done)) return 'started';
  return tone;
}

export class Collect {
  readonly el: HTMLElement;
  private save: SaveData = loadSave();
  private current = 1;
  private live = new GemAtom();
  private map: HTMLElement;
  private table: HTMLElement;
  private side: HTMLElement;
  private nu: HTMLElement;
  private expand: HTMLButtonElement;
  private lens: HTMLElement;
  private gem: HTMLElement;
  private title: HTMLButtonElement;
  private bars: HTMLElement;
  private lockEl: HTMLElement;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private nextZ: number | null = null;
  private shown = false;

  constructor(host: HTMLElement, private handlers: CollectHandlers) {
    this.el = host;
    host.innerHTML = `
      <div class="co-map">
        <div class="co-table" aria-label="Periodic table"><span class="co-nu" aria-hidden="true" hidden><i></i></span></div>
        <div class="co-side"></div>
      </div>
      <button type="button" class="co-expand" aria-expanded="false" aria-label="Show the table wider">${icon('chevron-down', { size: 24 })}</button>
      <div class="co-lens">
        <button type="button" class="co-gem-btn"><span class="co-gem"></span></button>
        <div class="co-lens-row">
          <button type="button" class="co-step" data-dir="-1" aria-label="Previous atom">${icon('chevron-left', { size: 28 })}</button>
          <button type="button" class="co-title"><span class="co-id"><small></small><span class="co-status"></span></span><b></b></button>
          <button type="button" class="co-step" data-dir="1" aria-label="Next atom">${icon('chevron-right', { size: 28 })}</button>
        </div>
        <div class="co-act"><div class="co-bars"></div><button type="button" class="co-build">${icon('mode-build', { size: 20 })}<span>Build</span></button></div>
        <div class="co-lock" hidden></div>
      </div>`;
    this.map = host.querySelector('.co-map')!;
    this.table = host.querySelector('.co-table')!;
    this.side = host.querySelector('.co-side')!;
    this.nu = host.querySelector('.co-nu')!;
    this.expand = host.querySelector('.co-expand')!;
    this.lens = host.querySelector('.co-lens')!;
    this.gem = host.querySelector('.co-gem')!;
    this.title = host.querySelector('.co-title')!;
    this.bars = host.querySelector('.co-bars')!;
    this.lockEl = host.querySelector('.co-lock')!;
    [this.prev, this.next] = [...host.querySelectorAll<HTMLButtonElement>('.co-step')];
    if (this.live.ok) this.gem.append(this.live.canvas);
    for (let z = 1; z <= MAX_Z; z++) {
      const e = elementAt(z);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'co-cell';
      cell.dataset.z = String(z);
      const at = tableCell(e);
      cell.style.gridRow = String(at.row);
      cell.style.gridColumn = String(at.col);
      cell.style.setProperty('--blk', placeColour(e));
      this.table.append(cell);
    }
    this.bind();
    window.addEventListener('atomos:progress', () => { if (this.shown) this.refresh(); });
  }

  /** Show Collect with atom `z` in the lens, or the next atom to build. */
  show(z?: number | null): void {
    this.el.hidden = false;
    this.shown = true;
    this.save = loadSave();
    this.setWide(false);
    this.paintTable();
    this.paintSide();
    this.focus(z ?? nextStep(this.save)?.z ?? 1);
  }

  hide(): void {
    this.el.hidden = true;
    this.shown = false;
    this.live.stop();
  }

  /** Progress changed: repaint in place, keeping the atom in the lens. */
  refresh(): void {
    this.save = loadSave();
    this.paintTable();
    this.paintSide();
    this.focus(this.current);
  }

  /** Put atom `z` in the lens. */
  focus(z: number): void {
    z = Math.max(1, Math.min(MAX_Z, z));
    const moved = z !== this.current;
    this.current = z;
    const e = elementAt(z);
    const tone = toneOf(z, this.save);
    const status = statusOf(z, this.save);
    for (const c of this.table.querySelectorAll<HTMLElement>('.co-cell.is-current')) c.classList.remove('is-current');
    this.table.querySelector<HTMLElement>(`.co-cell[data-z="${z}"]`)?.classList.add('is-current');
    this.lens.dataset.status = status;
    this.title.querySelector('small')!.textContent = `${z} ${e.symbol}`;
    this.title.querySelector('.co-status')!.textContent = STATUS_WORD[status];
    this.title.querySelector('b')!.textContent = e.name;
    this.title.setAttribute('aria-label', `${e.name}, ${z}: ${STATUS_WORD[status].toLowerCase()}. Open it`);
    this.lens.querySelector('.co-gem-btn')!.setAttribute('aria-label', `Open ${e.name}`);
    this.lens.querySelector('.co-build')!.setAttribute('aria-label', `Build ${e.name}`);
    this.prev.disabled = z === 1;
    this.next.disabled = z === MAX_Z;
    this.prev.title = z > 1 ? elementAt(z - 1).name : '';
    this.next.title = z < MAX_Z ? elementAt(z + 1).name : '';
    const fleetOn = fleetingOpen(this.save);
    const s = atomShares(z, this.save, fleetOn);
    const segs = segmentsOf(z, this.save);
    const f = fleetingCount(z, this.save);
    const bar = (word: string, share: number | null, count: string) => `<div class="co-bar"><span class="co-bar-word">${word}</span>${shareBar(share)}<span class="co-bar-n">${count}</span></div>`;
    this.bars.innerHTML = bar('Stable', s.stable, `${segs.filter((x) => x.done).length}/${segs.length}`)
      + (f.total ? bar('Fleeting', s.fleeting, fleetOn ? `${f.built}/${f.total}` : '–') : '');
    const open = rowOpen(rowOf(z), this.save);
    this.lockEl.hidden = open;
    if (!open) this.lockEl.innerHTML = `<span class="co-lock-ico">${icon('lock', { size: 20 })}</span><span>${esc(periodSentence(z, this.save) ?? '')}</span>`;
    if (!this.shown) return;
    if (this.live.ok) {
      this.live.show(z, tone, reducedMotion());
      this.live.start();
    } else if (moved || !this.gem.querySelector('img')) {
      void atomPicture(z, tone).then((url) => {
        if (!url || this.current !== z) return;
        const img = new Image();
        img.alt = '';
        img.src = url;
        this.gem.replaceChildren(img);
      });
    }
  }

  /** Each cell's tone, whether its period is open, and Nu circling the next atom to build. */
  private paintTable(): void {
    for (const cell of this.table.querySelectorAll<HTMLElement>('.co-cell')) {
      const z = Number(cell.dataset.z);
      const e = elementAt(z);
      const status = statusOf(z, this.save);
      cell.dataset.tone = status;
      cell.classList.toggle('is-locked', !rowOpen(rowOf(z), this.save));
      cell.setAttribute('aria-label', `${e.name}, ${z}: ${STATUS_WORD[status].toLowerCase()}`);
    }
    this.nextZ = nextStep(this.save)?.z ?? null;
    this.placeNu();
  }

  /** Nu goes round the next atom's cell (placed in the table's own coordinates). */
  private placeNu(): void {
    const cell = this.nextZ ? this.table.querySelector<HTMLElement>(`.co-cell[data-z="${this.nextZ}"]`) : null;
    this.nu.hidden = !cell;
    if (!cell) return;
    this.nu.style.left = `${cell.offsetLeft + cell.offsetWidth / 2}px`;
    this.nu.style.top = `${cell.offsetTop + cell.offsetHeight / 2}px`;
    this.nu.style.setProperty('--r', `${Math.max(9, cell.offsetWidth * 0.85)}px`);
  }

  /** The side: the whole collection's stable and fleeting shares as rings, then Next. */
  private paintSide(): void {
    const all = collectionProgress(this.save);
    const fleetOn = fleetingOpen(this.save);
    const stat = (share: number, ico: string, word: string, off: boolean) =>
      `<div class="co-stat${off ? ' is-off' : ''}${!off && share >= 1 ? ' is-done' : ''}">${shareRing(off ? 0 : share, ico, 40)}<span><b>${off ? '–' : pctLabel(share)}</b><small>${word}</small></span></div>`;
    this.side.innerHTML = stat(all.stable, 'isotope-stable', 'Stable', false) + stat(all.fleeting, 'isotope-fleeting', 'Fleeting', !fleetOn);
    this.side.setAttribute('aria-label', `Your collection: ${pctLabel(all.stable)} stable${fleetOn ? `, ${pctLabel(all.fleeting)} fleeting` : ''}`);
    const step = nextStep(this.save);
    if (step) this.side.append(nextButton({ label: 'Next', compact: true, landKey: 'collect-next', onClick: () => this.focus(step.z) }));
  }

  /** The table at full width for a while (easier to tap a cell), or back beside the progress. */
  private setWide(wide: boolean): void {
    this.map.classList.toggle('is-wide', wide);
    this.expand.setAttribute('aria-expanded', String(wide));
    this.expand.setAttribute('aria-label', wide ? 'Show the table smaller' : 'Show the table wider');
    requestAnimationFrame(() => this.placeNu());
  }

  private step(dir: 1 | -1): void {
    const z = this.current + dir;
    if (z < 1 || z > MAX_Z) return;
    this.focus(z);
  }

  private bind(): void {
    this.table.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.co-cell');
      if (!cell) return;
      this.focus(Number(cell.dataset.z));
      // A wide table was for picking: once picked, it goes back beside the progress.
      if (this.map.classList.contains('is-wide')) this.setWide(false);
    });
    this.expand.onclick = () => this.setWide(!this.map.classList.contains('is-wide'));
    const open = () => { if (!this.swiped) this.handlers.onOpen(this.current); };
    this.lens.querySelector<HTMLElement>('.co-gem-btn')!.onclick = open;
    this.lens.querySelector<HTMLElement>('.co-build')!.onclick = () => this.handlers.onOpen(this.current);
    this.title.onclick = open;
    this.prev.onclick = () => this.step(-1);
    this.next.onclick = () => this.step(1);
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      this.step(e.key === 'ArrowRight' ? 1 : -1);
      if ((e.target as HTMLElement).closest('.co-table')) this.table.querySelector<HTMLElement>('.co-cell.is-current')?.focus();
    });
    // A swipe sideways on the lens steps to the atom after or before.
    let start: { x: number; y: number; id: number } | null = null;
    this.lens.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; this.swiped = false; });
    this.lens.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { this.swiped = true; this.step(dx < 0 ? 1 : -1); }
    });
    this.lens.addEventListener('pointercancel', () => { start = null; });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.placeNu()).observe(this.table);
  }
  private swiped = false;

  /** For checks: the period and the atom in the lens. */
  get state(): { period: number; z: number; live: { z: number; tone: string; ready: boolean } } {
    return { period: rowOf(this.current), z: this.current, live: this.live.state };
  }
}
