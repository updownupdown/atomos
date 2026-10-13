// Collect: the whole table at once, and one atom large.
//
//   header                                   COLLECT            [27/118 v]  (atomlist.ts)
//   Stable  ┌ the periodic table, 80% wide ┐  Fleeting   each cell colored by how far that
//     ▮     │ ▪ . . . . . . . . . . . . ▪  │     ▮       atom is collected; the atom in the
//     ▮     │ ...                          │     ▮       lens below wears the ring
//    9%     └──────────────────────────────┘    2%
//            (the atom, as its gem)             the lens: tap to open the atom, swipe
//         ‹       26 · Fe   Iron  ›       ›     or the chevrons to step along the table
//            Stable ▬▬▬    Fleeting ▬▬
//   [ Up next card ]                          floats over the foot
//
// The sides are the whole collection's progress: its stable parts (nucleus, electrons and
// lasting isotopes of every atom) on the left and its fleeting isotopes on the right. Each cell's
// tone (thumbs.ts Tone): not built, built (its block's color, muted), stable collected (in full)
// and all collected (brighter).

import { BLOCK_COLOUR, MAX_Z, elementAt } from './data';
import { atomPicture, toneOf, type Tone } from './thumbs';
import { GemAtom } from './gem';
import { atomBuilt, fleetingCount, rowOf, rowOpen, rowSpan, segmentsOf } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import { nextStep, openStep, type NextStep } from '../core/next';
import { fleetingOpen, periodSentence } from './locks';
import type { TrackRow } from '../ui/tracks';
import { tableCell } from '../ui/picker';
import { atomShares, collectionProgress, shareBar } from './atomlist';
import { createCallout, nextButton, swipeToDismiss } from '../ui/components';
import { puzzleIcon } from '../puzzles/catalog';
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


/** The cells' tones, for the sides' wording too. */
const TONE_WORD: Record<Tone, string> = { unbuilt: 'Not built yet', built: 'Built', stable: 'Stable collected', complete: 'All collected' };

export class Collect {
  readonly el: HTMLElement;
  private save: SaveData = loadSave();
  private current = 1;
  private live = new GemAtom();
  private table: HTMLElement;
  private sides: HTMLElement[];
  private lens: HTMLElement;
  private gem: HTMLElement;
  private title: HTMLButtonElement;
  private bars: HTMLElement;
  private lockEl: HTMLElement;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private shown = false;
  private upNext = Object.assign(createCallout({ kicker: '', title: '', pic: '', className: 'ui-callout--float up-next co-upnext' }), { hidden: true });
  private upNextGone: string | null = null;

  constructor(host: HTMLElement, private handlers: CollectHandlers) {
    this.el = host;
    const side = (cls: string, ico: string, word: string) => `<div class="co-side ${cls}"><span class="co-side-ico">${icon(ico as never, { size: 20 })}</span><span class="co-side-track"><i></i></span><b class="co-side-pct"></b><span class="co-side-word">${word}</span></div>`;
    host.innerHTML = `
      <div class="co-map">
        ${side('co-side--stable', 'isotope-stable', 'Stable')}
        <div class="co-table" aria-label="Periodic table"></div>
        ${side('co-side--fleeting', 'isotope-fleeting', 'Fleeting')}
      </div>
      <div class="co-lens">
        <button type="button" class="co-gem-btn"><span class="co-gem"></span></button>
        <div class="co-lens-row">
          <button type="button" class="co-step" data-dir="-1" aria-label="Previous atom">${icon('chevron-left', { size: 28 })}</button>
          <button type="button" class="co-title"><small></small><b></b></button>
          <button type="button" class="co-step" data-dir="1" aria-label="Next atom">${icon('chevron-right', { size: 28 })}</button>
        </div>
        <div class="co-bars"></div>
        <div class="co-lock" hidden></div>
      </div>`;
    this.table = host.querySelector('.co-table')!;
    this.sides = [...host.querySelectorAll<HTMLElement>('.co-side')];
    this.lens = host.querySelector('.co-lens')!;
    this.gem = host.querySelector('.co-gem')!;
    this.title = host.querySelector('.co-title')!;
    this.bars = host.querySelector('.co-bars')!;
    this.lockEl = host.querySelector('.co-lock')!;
    [this.prev, this.next] = [...host.querySelectorAll<HTMLButtonElement>('.co-step')];
    host.append(this.upNext);
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
      cell.style.setProperty('--blk', BLOCK_COLOUR[e.block]);
      this.table.append(cell);
    }
    swipeToDismiss(this.upNext, () => { this.upNextGone = this.upNext.dataset.key ?? null; this.upNext.hidden = true; this.fitFoot(); });
    this.bind();
    window.addEventListener('atomos:progress', () => { if (this.shown) this.refresh(); });
  }

  /** Show Collect with atom `z` in the lens, or the Up next atom. */
  show(z?: number | null): void {
    this.el.hidden = false;
    this.shown = true;
    this.save = loadSave();
    this.paintUpNext();
    this.paintTable();
    this.paintSides();
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
    this.paintSides();
    this.paintUpNext();
    this.focus(this.current);
  }

  /** Put atom `z` in the lens. */
  focus(z: number): void {
    z = Math.max(1, Math.min(MAX_Z, z));
    const moved = z !== this.current;
    this.current = z;
    const e = elementAt(z);
    const tone = toneOf(z, this.save);
    for (const c of this.table.querySelectorAll<HTMLElement>('.co-cell.is-current')) c.classList.remove('is-current', 'ui-ring');
    const cell = this.table.querySelector<HTMLElement>(`.co-cell[data-z="${z}"]`);
    cell?.classList.add('is-current', 'ui-ring');
    this.lens.dataset.tone = tone;
    this.title.querySelector('small')!.textContent = `${z} · ${e.symbol} · ${TONE_WORD[tone]}`;
    this.title.querySelector('b')!.textContent = e.name;
    this.title.setAttribute('aria-label', `Open ${e.name}`);
    this.lens.querySelector('.co-gem-btn')!.setAttribute('aria-label', `Open ${e.name}`);
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

  /** Each cell's tone, and whether its period is open. */
  private paintTable(): void {
    for (const cell of this.table.querySelectorAll<HTMLElement>('.co-cell')) {
      const z = Number(cell.dataset.z);
      const e = elementAt(z);
      const tone = toneOf(z, this.save);
      cell.dataset.tone = tone;
      cell.classList.toggle('is-locked', !rowOpen(rowOf(z), this.save));
      cell.setAttribute('aria-label', `${e.name}, ${z}: ${TONE_WORD[tone].toLowerCase()}`);
    }
  }

  /** The sides: the whole collection's stable and fleeting shares, as bars filling upward. */
  private paintSides(): void {
    const all = collectionProgress(this.save);
    const fleetOn = fleetingOpen(this.save);
    const paint = (side: HTMLElement, share: number, off: boolean, aria: string) => {
      side.querySelector<HTMLElement>('.co-side-track i')!.style.height = `${Math.round((off ? 0 : share) * 100)}%`;
      side.querySelector('.co-side-pct')!.textContent = off ? '–' : pctLabel(share);
      side.classList.toggle('is-done', !off && share >= 1);
      side.classList.toggle('is-off', off);
      side.setAttribute('aria-label', aria);
    };
    paint(this.sides[0], all.stable, false, `Stable: ${pctLabel(all.stable)} of the whole collection`);
    paint(this.sides[1], all.fleeting, !fleetOn, fleetOn ? `Fleeting: ${pctLabel(all.fleeting)} of the whole collection` : 'Fleeting isotopes open once an atom is built');
  }

  /** Room at the foot for the Up next card, so the lens never sits under it. */
  private fitFoot(): void {
    const card = this.el.classList.contains('has-upnext') && !this.upNext.hidden ? this.upNext.offsetHeight + 12 : 0;
    this.el.style.setProperty('--co-foot', `${card}px`);
  }

  private step(dir: 1 | -1): void {
    const z = this.current + dir;
    if (z < 1 || z > MAX_Z) return;
    this.focus(z);
  }

  private bind(): void {
    this.table.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.co-cell');
      if (cell) this.focus(Number(cell.dataset.z));
    });
    const open = () => { if (!this.swiped) this.handlers.onOpen(this.current); };
    this.lens.querySelector<HTMLElement>('.co-gem-btn')!.onclick = open;
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
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.fitFoot()).observe(this.upNext);
  }
  private swiped = false;

  /** The Up next card at the foot: the one next thing to do (nextStep), with its Next button. It
   *  doubles as Continue for a returning player: a half-done puzzle comes first. */
  private paintUpNext(): void {
    const step: NextStep | null = nextStep(this.save);
    const card = this.upNext;
    card.hidden = !step;
    this.el.classList.toggle('has-upnext', Boolean(step));
    requestAnimationFrame(() => this.fitFoot());
    if (!step) { card.replaceChildren(); return; }
    const key = `${step.kind}/${step.z}/${step.stage}`;
    // Swiped away: it stays away until there is a different next step.
    if (this.upNextGone === key) { card.hidden = true; this.el.classList.remove('has-upnext'); return; }
    if (card.dataset.key === key) return;
    card.dataset.key = key;
    const resume = step.kind === 'resume';
    card.querySelector('small')!.textContent = `${resume ? 'Continue' : 'Up next'}: ${step.gameName}`;
    card.querySelector('b')!.textContent = resume ? step.label.replace(/^Resume [^·]*·\s*/, '') : step.label;
    card.querySelector<HTMLElement>('.ui-callout-pic')!.innerHTML = puzzleIcon(step.game, 32);
    card.querySelector('.ui-callout-acts')!.replaceChildren(nextButton({ label: resume ? 'Resume' : 'Play', compact: true, landKey: 'collect-upnext', onClick: () => openStep(step) }));
  }

  /** For checks: the period and the atom in focus. */
  get state(): { period: number; z: number; live: { z: number; tone: string; ready: boolean } } {
    return { period: rowOf(this.current), z: this.current, live: this.live.state };
  }
}
