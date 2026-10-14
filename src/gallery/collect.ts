// Collect: one atom large, everything about it in one block, and its period in a drawer that
// opens to the whole table.
//
//   header                         COLLECT                 [⚛ Atoms v]  (atomlist.ts)
//                 (the atom, as its gem)                   swipe sideways for the atom before or
//                                                          after, down for the period above, up
//                                                          for the one below, looping
//   [46 Pd] Palladium                       [Build]        the atom's block, on black; a win's
//           Period 5 · transition metal                    news takes the bars' place for 3 s
//   Stable          8/8    Fleeting       18/35
//   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬    ▬▬▬▬▬▬▬▬▬▬▬
//   ╭──────────────────── ─── ─────────────────────╮      the drawer: the period's row of the
//   │ Period 5  10 of 18 built              Table ⌃ │      table. Swiped up (or Table), the block
//   │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪                           │      rises to the top, the row slides into
//   │                  (dock)                       │      its place in the whole table and the
//                                                          rest fades in; under the table, the
//                                                          collection's three bars, then a chip
//                                                          per period. A pinch zooms the table.

import { MAX_Z, elementAt, placeColour } from './data';
import { atomPicture, toneOf, type Tone } from './thumbs';
import { GemAtom } from './gem';
import { atomBuilt, fleetingCount, rowOf, rowOpen, rowSpan, segmentsOf } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import { nextStep } from '../core/next';
import { fleetingOpen, periodNeed } from './locks';
import type { TrackRow } from '../ui/tracks';
import { tableCell } from '../ui/picker';
import { inkOn } from './looks';
import { seriesOne } from './table';
import { icon } from '../ui/icons';
import { reducedMotion } from '../ui/nu';
import './progressbox.css';
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

/** What an atom has, to tell what a win just added: the stable parts done and the fleeting
 *  isotopes built. */
interface Held { parts: string[]; fleeting: number; status: Status }

/** The line shown for a moment when Collect opens on an atom that just gained something:
 *  "+ Electrons" and "Iron is now stable collected", or how far it has come. */
export function newsLine(name: string, before: Held, after: Held, stableTotal: number): { added: string; note: string } | null {
  const parts = after.parts.filter((p) => !before.parts.includes(p));
  const fl = after.fleeting - before.fleeting;
  if (!parts.length && fl <= 0) return null;
  const added = [...parts, ...(fl > 0 ? [fl === 1 ? '1 fleeting isotope' : `${fl} fleeting isotopes`] : [])].join(', ');
  const note = after.status !== before.status && (after.status === 'stable' || after.status === 'complete')
    ? `${name} is now ${after.status === 'complete' ? 'all collected' : 'stable collected'}`
    : parts.length ? `${name}: ${after.parts.length} of ${stableTotal} stable parts` : `${name}: ${after.fleeting} fleeting built`;
  return { added: `+ ${added}`, note };
}

/** Nu's rhythm, in seconds: a turn round the cell, the whole cycle, and the circling part of it
 *  (two turns) before it strays. */
export const NU_TURN = 2.8, NU_CYCLE = 10, NU_ORBIT = 5.6;

/** Where Nu is `t` seconds in, from the center of the cell it circles: on a circle of radius
 *  `r`, then, for the end of each cycle, out along `away` (radians) as far as `reach`, curling
 *  as it goes, and smoothly back onto its circle. */
export function nuOffset(t: number, r: number, reach: number, away: number): { x: number; y: number } {
  const th = (2 * Math.PI * t) / NU_TURN;
  const ox = r * Math.cos(th), oy = r * Math.sin(th);
  const c = ((t % NU_CYCLE) + NU_CYCLE) % NU_CYCLE;
  if (c < NU_ORBIT) return { x: ox, y: oy };
  const v = (c - NU_ORBIT) / (NU_CYCLE - NU_ORBIT);
  // Out and back with no jolt at either end, sweeping an arc while away.
  const s = (1 - Math.cos(2 * Math.PI * v)) / 2;
  const phi = away + 1.6 * (v - 0.5);
  const fx = reach * Math.cos(phi) + 0.5 * r * Math.cos(2 * th), fy = reach * Math.sin(phi) + 0.5 * r * Math.sin(2 * th);
  return { x: (1 - s) * ox + s * fx, y: (1 - s) * oy + s * fy };
}

/** The periods, top to bottom. */
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

/** The atom `dir` steps from `z`: the next or the one before, on from a period's last atom to
 *  the next period's first, and looping from 118 round to 1. */
export function stepAtom(z: number, dir: 1 | -1): number {
  const n = z + dir;
  return n > MAX_Z ? 1 : n < 1 ? MAX_Z : n;
}

/** The atom of `period` nearest `z`'s place in the table: the one in the same column, else the
 *  nearest (the left one on a tie). From an f-block row, the period's own f-block row if it has
 *  one. */
export function periodPick(z: number, period: number): number {
  const at = tableCell(elementAt(z));
  const [first, last] = rowSpan(period);
  const cells: { z: number; row: number; col: number }[] = [];
  for (let n = first; n <= last; n++) cells.push({ z: n, ...tableCell(elementAt(n)) });
  const fRow = cells.filter((c) => c.row >= 9);
  const pool = at.row >= 9 && fRow.length ? fRow : cells.filter((c) => c.row < 9);
  return pool.sort((a, b) => Math.abs(a.col - at.col) - Math.abs(b.col - at.col) || a.col - b.col)[0].z;
}

/** The atom a period up (-1) or down (1) from `z`'s, looping from Period 7 round to Period 1. */
export function periodNeighbour(z: number, dir: 1 | -1): number {
  return periodPick(z, ((rowOf(z) - 1 + dir + 7) % 7) + 1);
}

const fmt = (n: number) => n.toLocaleString('en-US');
const width = (share: number) => `${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%`;

/** A bar with its word and count over it: one atom's stable parts or fleeting isotopes. */
function lbar(word: string, figure: string, share: number, done: boolean, off = false): string {
  return `<div class="co-lbar${done ? ' is-done' : ''}${off ? ' is-off' : ''}"><span class="co-lbar-top"><span>${word}</span><b>${figure}</b></span><span class="co-trk"><i style="width:${width(off ? 0 : share)}"></i></span></div>`;
}

/** One of the collection's totals: the word, built of all, and a bar. */
function stat(word: string, n: number, total: number): string {
  const done = total > 0 && n >= total;
  return `<div class="co-stat${done ? ' is-done' : ''}"><span class="co-stat-k">${word}</span><span class="co-stat-v">${fmt(n)}<small> / ${fmt(total)}</small></span><span class="co-trk"><i style="width:${width(total ? n / total : 0)}"></i></span></div>`;
}

type PeriodCounts = ReturnType<typeof periodProgress>;

export class Collect {
  readonly el: HTMLElement;
  private save: SaveData = loadSave();
  private current = 1;
  private live = new GemAtom();
  private stage: HTMLElement;
  private gem: HTMLElement;
  private atom: HTMLElement;
  private who: HTMLButtonElement;
  private build: HTMLButtonElement;
  private bars: HTMLElement;
  private newsEl: HTMLElement;
  private drawer: HTMLElement;
  private line: HTMLElement;
  private more: HTMLButtonElement;
  private zoom: HTMLElement;
  private table: HTMLElement;
  private nu: HTMLElement;
  private extras: HTMLElement[];
  private coll: HTMLElement;
  private chips: HTMLElement;
  private nextZ: number | null = null;
  private shown = false;
  /** The drawer is open on the whole table. */
  private open = false;
  /** The period the table is laid out for. */
  private laid = 0;
  /** How far the table is zoomed in, from 1. */
  private scale = 1;
  /** A swipe or a pan just ended: the click that follows it is not a tap. */
  private swiped = false;
  private newsTimer = 0;
  /** Each period's counts, as of the last paint. */
  private per: PeriodCounts[] = [];
  /** What each atom had when Collect last painted, to spot what a win added. */
  private held = new Map<number, Held>();
  /** Nu's flight: where it circles (the next atom's cell, in the table's own pixels) and the
   *  frame that moves it. */
  private nuAt: { x: number; y: number; r: number; cell: number } | null = null;
  private nuFrame = 0;

  constructor(host: HTMLElement, private handlers: CollectHandlers) {
    this.el = host;
    host.innerHTML = `
      <div class="co-stage"><button type="button" class="co-gem-btn"><span class="co-gem"></span></button></div>
      <div class="co-atom">
        <div class="co-atom-row">
          <button type="button" class="co-who"><span class="co-plate"><small></small><b></b></span><span class="co-name"><b></b><small></small></span></button>
          <button type="button" class="co-build">${icon('mode-build', { size: 20 })}<span>Build</span></button>
        </div>
        <div class="co-slot"><div class="co-bars"></div><div class="pb-news co-news" role="status" hidden></div></div>
      </div>
      <div class="co-drawer">
        <div class="co-head"><span class="co-handle" aria-hidden="true"></span><div class="co-line"><span class="co-line-txt" role="status"></span><button type="button" class="co-more" aria-expanded="false"></button></div></div>
        <div class="co-zoom"><div class="co-table" aria-label="Periodic table"><span class="co-nu" aria-hidden="true" hidden><i></i></span></div></div>
        <p class="co-pinch co-extra">Pinch the table to zoom in</p>
        <div class="co-coll co-extra"></div>
        <div class="co-chips co-extra" role="group" aria-label="Periods"></div>
      </div>`;
    const $ = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!;
    this.stage = $('.co-stage');
    this.gem = $('.co-gem');
    this.atom = $('.co-atom');
    this.who = $('.co-who');
    this.build = $('.co-build');
    this.bars = $('.co-bars');
    this.newsEl = $('.co-news');
    this.drawer = $('.co-drawer');
    this.line = $('.co-line-txt');
    this.more = $('.co-more');
    this.zoom = $('.co-zoom');
    this.table = $('.co-table');
    this.nu = $('.co-nu');
    this.coll = $('.co-coll');
    this.chips = $('.co-chips');
    this.extras = [...host.querySelectorAll<HTMLElement>('.co-extra')];
    if (this.live.ok) this.gem.append(this.live.canvas);
    for (let z = 1; z <= MAX_Z; z++) {
      const e = elementAt(z);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'co-cell';
      cell.dataset.z = String(z);
      cell.style.gridColumn = String(tableCell(e).col);
      const blk = placeColour(e);
      cell.style.setProperty('--blk', blk);
      cell.style.setProperty('--ink', inkOn(blk));
      cell.innerHTML = `<span class="co-sym" aria-hidden="true">${e.symbol}</span>`;
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
    this.count();
    const target = z ?? nextStep(this.save)?.z ?? 1;
    this.focus(target);
    this.paintTable(target);
    this.fitCells();
  }

  hide(): void {
    this.el.hidden = true;
    this.shown = false;
    this.live.stop();
    this.hideNews();
    cancelAnimationFrame(this.nuFrame);
    this.nuFrame = 0;
  }

  /** Progress changed: repaint in place, keeping the atom in the lens. */
  refresh(): void {
    this.save = loadSave();
    this.count();
    this.focus(this.current);
    this.paintTable(this.current);
  }

  /** Each period's counts, and the collection's under the table. */
  private count(): void {
    this.per = PERIODS.map((p) => periodProgress(p, this.save));
    const sum = (k: 'built' | 'atoms' | 'stableBuilt' | 'stableTotal' | 'fleetingBuilt' | 'fleetingTotal') => this.per.reduce((n, p) => n + p[k], 0);
    this.coll.innerHTML = stat('Atoms', sum('built'), sum('atoms')) + stat('Stable parts', sum('stableBuilt'), sum('stableTotal')) + stat('Fleeting', sum('fleetingBuilt'), sum('fleetingTotal'));
  }

  /** Put atom `z` in the lens. */
  focus(z: number): void {
    z = Math.max(1, Math.min(MAX_Z, z));
    if (z !== this.current) this.hideNews();
    this.current = z;
    const e = elementAt(z);
    const period = rowOf(z);
    const open = rowOpen(period, this.save);
    for (const c of this.table.querySelectorAll<HTMLElement>('.co-cell.is-current')) c.classList.remove('is-current');
    this.table.querySelector<HTMLElement>(`.co-cell[data-z="${z}"]`)?.classList.add('is-current');
    const plate = this.who.querySelector<HTMLElement>('.co-plate')!;
    const blk = placeColour(e);
    plate.style.background = blk;
    plate.style.color = inkOn(blk);
    plate.querySelector('small')!.textContent = String(z);
    plate.querySelector('b')!.textContent = e.symbol;
    this.who.querySelector('.co-name b')!.textContent = e.name;
    this.who.querySelector('.co-name small')!.textContent = `Period ${period} · ${seriesOne(e).toLowerCase()}`;
    this.who.setAttribute('aria-label', `${e.name}, ${z}: ${STATUS_WORD[statusOf(z, this.save)].toLowerCase()}. Open it`);
    this.stage.querySelector('.co-gem-btn')!.setAttribute('aria-label', `Open ${e.name}`);
    this.build.disabled = !open;
    this.build.setAttribute('aria-label', open ? `Build ${e.name}` : `${e.name} is locked`);
    this.paintBars(z);
    if (period !== this.laid) this.layoutTable();
    this.paintLine();
    this.paintChips();
    if (this.shown && !this.open) this.showGem(z);
  }

  /** The atom's two bars: its stable parts, and its fleeting isotopes once they are open. */
  private paintBars(z: number): void {
    const segs = segmentsOf(z, this.save);
    const done = segs.filter((s) => s.done).length;
    const f = fleetingCount(z, this.save);
    const fleetOn = fleetingOpen(this.save);
    this.bars.innerHTML = lbar('Stable', `${done}/${segs.length}`, segs.length ? done / segs.length : 0, segs.length > 0 && done >= segs.length)
      + (!f.total ? lbar('Fleeting', 'None', 0, false, true)
        : fleetOn ? lbar('Fleeting', `${f.built}/${f.total}`, f.built / f.total, f.built >= f.total)
          : lbar('Fleeting', `0/${f.total}`, 0, false, true));
  }

  /** The atom, large, as its gem: live where WebGL runs, else its picture. */
  private showGem(z: number): void {
    const tone = toneOf(z, this.save);
    if (this.live.ok) {
      this.live.show(z, tone, reducedMotion());
      this.live.start();
    } else if (!this.gem.querySelector('img') || this.gem.dataset.z !== String(z)) {
      this.gem.dataset.z = String(z);
      void atomPicture(z, tone).then((url) => {
        if (!url || this.current !== z) return;
        const img = new Image();
        img.alt = '';
        img.src = url;
        this.gem.replaceChildren(img);
      });
    }
  }

  /** The drawer's line: closed, the period (how many of its atoms are built, or what opens it)
   *  and Table; open, Collection and Close. */
  private paintLine(): void {
    this.more.innerHTML = this.open ? `${icon('chevron-down', { size: 18 })}<span>Close</span>` : `<span>Table</span>${icon('chevron-up', { size: 18 })}`;
    this.more.setAttribute('aria-label', this.open ? 'Close the table' : 'Open the whole table');
    if (this.open) {
      this.line.className = 'co-line-txt';
      this.line.innerHTML = '<b>Collection</b>';
      return;
    }
    const period = rowOf(this.current);
    if (!rowOpen(period, this.save)) {
      const need = periodNeed(this.current, this.save);
      this.line.className = 'co-line-txt is-locked';
      this.line.innerHTML = `${icon('lock', { size: 16 })}<b>Period ${period}</b><span>${need ? `Build ${need.more} more in Period ${period - 1}` : 'Locked'}</span>`;
      return;
    }
    const p = this.per[period - 1];
    const done = p.built >= p.atoms;
    this.line.className = `co-line-txt${done ? ' is-done' : ''}`;
    this.line.innerHTML = `${done ? icon('check', { size: 16 }) : ''}<b>Period ${period}</b><span>${p.built} of ${p.atoms} built</span>`;
  }

  /** A chip per period: its atoms built, a check once all are, a lock until it opens. */
  private paintChips(): void {
    const on = rowOf(this.current);
    this.chips.innerHTML = PERIODS.map((p) => {
      const c = this.per[p - 1];
      const locked = !rowOpen(p, this.save);
      const done = !locked && c.built >= c.atoms;
      const what = locked ? 'locked' : `${c.built} of ${c.atoms} built`;
      const mark = locked ? icon('lock', { size: 14 }) : done ? icon('check', { size: 14 }) : `<span>${c.built}/${c.atoms}</span>`;
      return `<button type="button" class="co-chip${done ? ' is-done' : ''}${locked ? ' is-locked' : ''}${p === on ? ' is-on' : ''}" data-p="${p}" aria-label="Period ${p}: ${what}"${p === on ? ' aria-current="true"' : ''}><b>${p}</b>${mark}</button>`;
    }).join('');
  }

  /** Closed, the table is the lens atom's period alone: its row, and its f-block row under it
   *  for Periods 6 and 7. Open, the whole table, the period on a band. */
  private layoutTable(): void {
    const period = rowOf(this.current);
    const [first, last] = rowSpan(period);
    this.laid = period;
    let fRow = false;
    for (const cell of this.table.querySelectorAll<HTMLElement>('.co-cell')) {
      const n = Number(cell.dataset.z);
      const row = tableCell(elementAt(n)).row;
      const inP = n >= first && n <= last;
      cell.classList.toggle('in-period', inP);
      if (this.open) cell.style.gridRow = String(row);
      else {
        cell.style.gridRow = inP ? (row >= 9 ? '2' : '1') : '';
        if (inP && row >= 9) fRow = true;
      }
    }
    this.table.classList.toggle('is-strip', !this.open);
    this.table.style.gridTemplateRows = this.open ? '' : fRow ? 'auto auto' : 'auto';
    this.placeBands();
    this.placeNu();
  }

  /** Behind the lens atom's period in the whole table, a band for each of its rows. */
  private placeBands(): void {
    for (const b of this.table.querySelectorAll('.co-band')) b.remove();
    if (!this.open) return;
    const rows = new Map<number, HTMLElement>();
    for (const cell of this.table.querySelectorAll<HTMLElement>('.co-cell.in-period')) {
      const top = cell.offsetTop;
      if (!rows.has(top)) rows.set(top, cell);
    }
    for (const cell of rows.values()) {
      const band = document.createElement('span');
      band.className = 'co-band';
      band.setAttribute('aria-hidden', 'true');
      band.style.top = `${cell.offsetTop - 3}px`;
      band.style.height = `${cell.offsetHeight + 6}px`;
      this.table.prepend(band);
    }
  }

  /** The cells' size, for the symbols they carry once large enough to read. */
  private fitCells(): void {
    const cell = this.table.querySelector<HTMLElement>('.co-cell.in-period');
    const w = cell?.offsetWidth ?? 0;
    if (!w) return;
    this.table.style.setProperty('--cw', `${w}px`);
    this.table.classList.toggle('is-labeled', w >= 24);
  }

  /** Open the drawer on the whole table, or close it on the period. The atom's block rises to
   *  the top (or back), and the period's own cells slide between their row in the drawer and
   *  their place in the table while the rest fade in. */
  setOpen(open: boolean): void {
    if (open === this.open) return;
    const motion = this.shown && !reducedMotion() && typeof this.atom.animate === 'function';
    if (!open) { this.setZoom(1); this.drawer.scrollTop = 0; }
    const before = motion ? this.snap() : null;
    this.open = open;
    this.el.classList.toggle('is-open', open);
    this.more.setAttribute('aria-expanded', String(open));
    this.layoutTable();
    this.fitCells();
    this.paintLine();
    if (open) this.live.stop();
    else if (this.shown) this.showGem(this.current);
    if (before) this.flip(before, open);
  }

  private snap(): { atom: number; drawer: number; cells: Map<number, DOMRect> } {
    const cells = new Map<number, DOMRect>();
    for (const c of this.table.querySelectorAll<HTMLElement>('.co-cell.in-period')) cells.set(Number(c.dataset.z), c.getBoundingClientRect());
    return { atom: this.atom.getBoundingClientRect().top, drawer: this.drawer.getBoundingClientRect().top, cells };
  }

  private flip(was: ReturnType<Collect['snap']>, open: boolean): void {
    const now = this.snap();
    const o: KeyframeAnimationOptions = { duration: 440, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };
    const slide = (el: Element, dx: number, dy: number) => {
      if (Math.abs(dx) + Math.abs(dy) > 0.5) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], o);
    };
    slide(this.atom, 0, was.atom - now.atom);
    const dd = was.drawer - now.drawer;
    slide(this.drawer, 0, dd);
    for (const [z, r] of now.cells) {
      const b = was.cells.get(z);
      const cell = this.table.querySelector(`.co-cell[data-z="${z}"]`);
      if (b && cell) slide(cell, b.left - r.left, b.top - r.top - dd);
    }
    const fade: KeyframeAnimationOptions = { duration: 320, delay: 160, easing: 'ease-out', fill: 'backwards' };
    const fades = open
      ? [...this.table.querySelectorAll('.co-cell:not(.in-period), .co-band'), ...this.extras]
      : [this.stage];
    for (const el of fades) el.animate([{ opacity: 0 }, { opacity: 1 }], fade);
  }

  /** Zoom the table to `s` (1 to 4), keeping the point `at` (in the zoom box's pixels) still. */
  private setZoom(s: number, at?: { x: number; y: number }): void {
    s = Math.max(1, Math.min(4, s));
    const box = this.zoom, old = this.scale;
    if (Math.abs(s - old) < 0.001) return;
    if (old === 1) box.style.height = `${box.clientHeight}px`;
    // The point under the fingers, in the table's own unzoomed pixels (the table sits centered
    // in its box until it outgrows it).
    const ax = at?.x ?? box.clientWidth / 2, ay = at?.y ?? box.clientHeight / 2;
    const cx = (box.scrollLeft + ax - this.table.offsetLeft) / old, cy = (box.scrollTop + ay - this.table.offsetTop) / old;
    this.scale = s;
    this.table.style.width = s === 1 ? '' : `${s * 100}%`;
    this.table.style.maxWidth = s === 1 ? '' : `${720 * s}px`;
    if (s === 1) box.style.height = '';
    box.scrollLeft = cx * s + this.table.offsetLeft - ax;
    box.scrollTop = cy * s + this.table.offsetTop - ay;
    this.el.classList.toggle('is-zoomed', s > 1);
    this.fitCells();
    this.placeBands();
    this.placeNu();
  }

  /** For a moment, in place of the bars: a green line of what the atom just gained. */
  private news(n: { added: string; note: string }): void {
    window.clearTimeout(this.newsTimer);
    this.newsEl.innerHTML = `<b>${esc(n.added)}</b><span>${esc(n.note)}</span>`;
    this.newsEl.hidden = false;
    this.bars.classList.add('is-hidden');
    this.newsTimer = window.setTimeout(() => this.hideNews(), 3000);
  }

  private hideNews(): void {
    window.clearTimeout(this.newsTimer);
    this.newsEl.hidden = true;
    this.bars.classList.remove('is-hidden');
  }

  /** Each cell lit by how far its atom is collected: gray until a part is built, a square of
   *  its color growing in the middle while under way, the whole cell in color once its stable
   *  parts are collected and glowing once everything is. A white dot marks an atom with fleeting
   *  isotopes still to build. Nu circles the next atom. Notes what each atom has, and, for the
   *  atom `z` about to show, what was just added. */
  private paintTable(z: number): void {
    const fleetOn = fleetingOpen(this.save);
    const fresh = new Map<number, Held>();
    for (const cell of this.table.querySelectorAll<HTMLElement>('.co-cell')) {
      const n = Number(cell.dataset.z);
      const e = elementAt(n);
      const status = statusOf(n, this.save);
      const segs = segmentsOf(n, this.save);
      const doneParts = segs.filter((s) => s.done);
      const share = segs.length ? doneParts.length / segs.length : 0;
      const f = fleetingCount(n, this.save);
      cell.dataset.tone = status;
      cell.style.setProperty('--k', String(0.3 + share * 0.45));
      cell.classList.toggle('is-locked', !rowOpen(rowOf(n), this.save));
      cell.classList.toggle('has-fleeting', fleetOn && status !== 'unbuilt' && f.total > 0 && f.built < f.total);
      cell.setAttribute('aria-label', `${e.name}, ${n}: ${STATUS_WORD[status].toLowerCase()}`);
      fresh.set(n, { parts: doneParts.map((s) => s.label), fleeting: f.built, status });
    }
    const before = this.held.get(z), after = fresh.get(z);
    if (this.shown && before && after) {
      const news = newsLine(elementAt(z).name, before, after, segmentsOf(z, this.save).length);
      if (news) this.news(news);
    }
    this.held = fresh;
    this.nextZ = nextStep(this.save)?.z ?? null;
    requestAnimationFrame(() => this.placeNu());
  }

  /** Nu circles the next atom's cell (in the table's own pixels) and, now and then, strays.
   *  Closed on another period, Nu waits off the table. */
  private placeNu(): void {
    const cell = this.nextZ ? this.table.querySelector<HTMLElement>(`.co-cell[data-z="${this.nextZ}"]`) : null;
    const seen = !!cell && cell.offsetWidth > 0;
    this.nu.hidden = !seen;
    if (!cell || !seen) { this.nuAt = null; return; }
    this.nuAt = { x: cell.offsetLeft + cell.offsetWidth / 2, y: cell.offsetTop + cell.offsetHeight / 2, r: Math.max(9, cell.offsetWidth * 0.85), cell: cell.offsetWidth };
    this.nu.style.left = `${this.nuAt.x}px`;
    this.nu.style.top = `${this.nuAt.y}px`;
    if (reducedMotion()) { this.nu.style.transform = `translate(${this.nuAt.r * 0.7}px, ${-this.nuAt.r * 0.7}px)`; return; }
    if (!this.nuFrame && this.shown) this.nuFrame = requestAnimationFrame(this.flyNu);
  }

  /** One frame of Nu's flight. Each stray heads into the table, a little differently each time. */
  private flyNu = (now: number): void => {
    this.nuFrame = 0;
    const at = this.nuAt;
    if (!at || !this.shown || this.nu.hidden) return;
    const t = now / 1000;
    const w = this.table.clientWidth, h = this.table.clientHeight;
    const inward = Math.atan2(h / 2 - at.y, w / 2 - at.x);
    const k = Math.floor(t / NU_CYCLE);
    const away = inward + (((k * 0.618) % 1) - 0.5) * 2;
    const o = nuOffset(t, at.r, at.cell * 5, away);
    const x = Math.max(4, Math.min(w - 4, at.x + o.x)) - at.x;
    const y = Math.max(4, Math.min(h - 4, at.y + o.y)) - at.y;
    this.nu.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.nuFrame = requestAnimationFrame(this.flyNu);
  };

  /** To the atom after or before, across the periods. */
  private step(dir: 1 | -1): void {
    this.focus(stepAtom(this.current, dir));
  }

  /** To the period above or below, looping. */
  private stepPeriod(dir: 1 | -1): void {
    this.focus(periodNeighbour(this.current, dir));
  }

  private bind(): void {
    const openAtom = () => { if (!this.swiped) this.handlers.onOpen(this.current); };
    this.stage.querySelector<HTMLElement>('.co-gem-btn')!.onclick = openAtom;
    this.who.onclick = () => this.handlers.onOpen(this.current);
    this.build.onclick = () => this.handlers.onOpen(this.current);
    // Its label is redrawn as it opens: the click must not reach the head as well.
    this.more.onclick = (e) => { e.stopPropagation(); this.setOpen(!this.open); };
    this.table.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.co-cell');
      if (cell && !this.swiped) this.focus(Number(cell.dataset.z));
    });
    this.chips.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('.co-chip');
      if (chip) this.focus(periodPick(this.current, Number(chip.dataset.p)));
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) { e.preventDefault(); this.setOpen(false); this.more.focus(); return; }
      const dirs: Record<string, () => void> = { ArrowLeft: () => this.step(-1), ArrowRight: () => this.step(1), ArrowUp: () => this.stepPeriod(-1), ArrowDown: () => this.stepPeriod(1) };
      const go = dirs[e.key];
      if (!go || (e.target as HTMLElement).closest('.co-chips')) return;
      e.preventDefault();
      go();
      if ((e.target as HTMLElement).closest('.co-table')) this.table.querySelector<HTMLElement>('.co-cell.is-current')?.focus();
    });

    // A swipe: sideways or up and down, far enough and mostly one way.
    const swipe = (el: HTMLElement, ok: (e: PointerEvent) => boolean, act: (dx: number, dy: number) => boolean) => {
      let start: { x: number; y: number; id: number } | null = null;
      el.addEventListener('pointerdown', (e) => {
        if (!ok(e)) return;
        start = { x: e.clientX, y: e.clientY, id: e.pointerId };
        this.swiped = false;
      });
      // The finger may lift anywhere: a drawer swiped up ends over the atom.
      window.addEventListener('pointerup', (e) => {
        if (!start || e.pointerId !== start.id) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        start = null;
        if (act(dx, dy)) {
          this.swiped = true;
          window.setTimeout(() => { this.swiped = false; }, 0);
        }
      });
      window.addEventListener('pointercancel', () => { start = null; });
    };
    const sideways = (dx: number, dy: number) => Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4;
    const upDown = (dx: number, dy: number) => Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx) * 1.4;
    // On the atom: sideways to the atom after or before; down to the period above, up to the
    // one below, as if pulling the table past.
    swipe(this.stage, () => true, (dx, dy) => {
      if (sideways(dx, dy)) { this.step(dx < 0 ? 1 : -1); return true; }
      if (upDown(dx, dy)) { this.stepPeriod(dy > 0 ? -1 : 1); return true; }
      return false;
    });
    // On the drawer (open, on its head): up opens it, down closes it.
    swipe(this.drawer, (e) => !this.open || !!(e.target as HTMLElement).closest('.co-head'), (dx, dy) => {
      if (!upDown(dx, dy)) return false;
      this.setOpen(dy < 0);
      return true;
    });
    this.drawer.querySelector<HTMLElement>('.co-head')!.addEventListener('click', (e) => {
      if (!this.swiped) this.setOpen(!this.open);
    });
    this.bindZoom();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => { this.fitCells(); this.placeBands(); this.placeNu(); }).observe(this.table);
    }
  }

  /** Open, the table zooms with a pinch (or a trackpad's, or Ctrl and the wheel) and pans with a
   *  finger once zoomed; at its own size a finger's drag scrolls the drawer. */
  private bindZoom(): void {
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; s: number } | null = null;
    let last: { x: number; y: number } | null = null;
    let travel = 0;
    const local = (p: { x: number; y: number }) => {
      const r = this.zoom.getBoundingClientRect();
      return { x: p.x - r.left, y: p.y - r.top };
    };
    const spread = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    this.zoom.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; travel = 0; }
      if (pts.size === 2) { pinch = { d: Math.max(1, spread().d), s: this.scale }; travel = 99; }
    });
    this.zoom.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const { d, mid } = spread();
        this.setZoom(pinch.s * (d / pinch.d), local(mid));
        return;
      }
      if (!last || pts.size !== 1) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      travel += Math.abs(dx) + Math.abs(dy);
      if (this.scale > 1) { this.zoom.scrollLeft -= dx; this.zoom.scrollTop -= dy; }
      else this.drawer.scrollTop -= dy;
    });
    const end = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size < 2) pinch = null;
      const rest = [...pts.values()][0];
      last = rest ? { ...rest } : null;
      if (!pts.size && travel > 8) {
        this.swiped = true;
        window.setTimeout(() => { this.swiped = false; }, 0);
      }
    };
    this.zoom.addEventListener('pointerup', end);
    this.zoom.addEventListener('pointercancel', end);
    this.zoom.addEventListener('wheel', (e) => {
      if (!this.open) return;
      if (e.ctrlKey) {
        e.preventDefault();
        this.setZoom(this.scale * Math.exp(-e.deltaY / 200), local({ x: e.clientX, y: e.clientY }));
      } else if (this.scale > 1) {
        e.preventDefault();
        this.zoom.scrollLeft += e.deltaX;
        this.zoom.scrollTop += e.deltaY;
      }
    }, { passive: false });
  }

  /** For checks: the period, the atom in the lens, and whether the table is open. */
  get state(): { period: number; z: number; open: boolean; scale: number; live: { z: number; tone: string; ready: boolean } } {
    return { period: rowOf(this.current), z: this.current, open: this.open, scale: this.scale, live: this.live.state };
  }
}
