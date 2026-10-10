// Drawing and touch for Orbital Grid. Each symbol has a stack under (or beside)
// the grid: drag from a stack onto a cell, or tap a cell and then a stack.
// Tapping the chosen cell again cycles it; dragging a placed tile moves it, and
// dragging it off the board clears it. Keys: arrows move, 1-8 or s/p/d/f place,
// Backspace clears.
//
// Every symbol is a flat tile in its orbital's color with a centered glyph of
// dots, after the mark's electrons: s one dot, p two on one axis, d four, f six
// in a ring. On spin grids spin up is the solid tile with the glyph in dark ink
// and spin down its negative: a dark tile ringed in the hue with the glyph in
// the hue, like the mark's solid and hollow nucleons. Dealt tiles are squares
// with softened corners, yours (and the stacks) are round; the letters live
// under the stacks. Each block sits in the shared board frame.

import { conflicts, cycleValue, EMPTY, filledCount, moveTile, nextForced, place, remaining, solved, symbolName, symbolOf, type Orbital, type OrbitalGridState } from './orbitalGrid';
import { C, font, socket, tile } from './palette';
import { drawFrame, frameWidth } from './frame';
import { drawHelpMark, type Area, type Help, type Point, type PuzzleView, type RuleCard } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">The electron stage of building every element, z 1 to 118. Periods 1-3 play a 4x4 with s p d f (6 to 10 empty cells); periods 4-5 a 6x6 with 2x3 blocks and s p d in spin up and spin down (14 to 22 empty); periods 6-7, where the f block arrives, an 8x8 with 2x4 blocks and s p d f in both spins (24 to 36 empty). Par is one placement per empty cell: editing or moving the tile you just placed is free, going back to an older cell costs another, and undo takes a placement back. Clean means finishing within par. Each grid is carved from a full random grid so that it always finishes by deduction alone, with one answer. The symbols are only orbital labels: a cell is not a place in the atom.</p>`;

/** The kind of pointer last pressed anywhere, so a drag can tell a mouse from a finger. */
let lastPointer = 'mouse';
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);

/** Pixels a press must travel before it becomes a drag. */
const DRAG_PX = 9;

// ---- symbols --------------------------------------------------------------------

type TileStyle = 'given' | 'placed' | 'key';

/** Corner radius as a share of the tile: dealt tiles square with soft corners, yours (and the stacks you take them from) perfect circles. */
const RADIUS: Record<TileStyle, number> = { given: 0.12, placed: 0.5, key: 0.5 };
/** The spin-down ring's width as a share of the tile. */
const RING = 0.08;
/** Kept for the empty-cell calls; an empty cell is now only a faint dot. */
const EMPTY_RADIUS = 0.5;
/** Space between blocks, and round the grid for the frames, in cells. */
const BLOCK_GAP = 0.42;
const OUTER = 0.22;
/** How far each block's frame line sits outside its cells, in cells. */
const FRAME_OUT = 0.14;
/** Tap-to-cycle: the tile stays at this opacity until the taps stop for CYCLE_HOLD ms, then fades up over CYCLE_FADE ms. */
const CYCLE_ALPHA = 0.6;
const CYCLE_HOLD = 2000;
const CYCLE_FADE = 250;

/**
 * Quanta's tile colors. They are the orbital colors of the 3D atom (s blue, p green, d gold,
 * f violet), lifted for small flat tiles on black: the same hues, brighter and cleaner, with d
 * moved from ochre to a clear copper so it no longer reads as drab or as the amber warning.
 */
export const QUANTA_HUE: Record<Orbital, string> = { s: '#6e9cff', p: '#37c994', d: '#ec8a4a', f: '#b884f2' };

/** Each orbital's dots: how many, the first one's bearing, how far out (as a share of the reach) and how big. */
const GLYPH: Record<Orbital, { count: number; start: number; dist: number; dot: number }> = {
  s: { count: 1, start: 0, dist: 0, dot: 0.5 },
  p: { count: 2, start: -Math.PI / 2, dist: 0.6, dot: 0.34 },
  d: { count: 4, start: -Math.PI / 2, dist: 0.68, dot: 0.29 },
  f: { count: 6, start: -Math.PI / 2, dist: 0.78, dot: 0.23 },
};

/**
 * The orbital's glyph: solid dots round (cx, cy) within reach r, like the
 * mark's electrons, one per lobe of the real orbital. s one dot, p two on the
 * vertical axis, d four in a cross, f six in a ring.
 */
export function orbitalShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, orbital: Orbital, color: string): void {
  const g = GLYPH[orbital];
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < g.count; i++) {
    const a = g.start + (i * Math.PI * 2) / g.count;
    const x = cx + Math.cos(a) * r * g.dist, y = cy + Math.sin(a) * r * g.dist;
    ctx.moveTo(x + r * g.dot, y);
    ctx.arc(x, y, r * g.dot, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

/**
 * A tile's ground with no glyph. Spin up and plain symbols are solid in the hue;
 * spin down is the negative, a dark ground washed with the hue inside a thick
 * ring of it. Returns the ink the glyph goes in.
 */
function tileGround(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rad: number, orbital: Orbital, up: boolean | null): string {
  const hue = QUANTA_HUE[orbital];
  if (up !== false) {
    tile(ctx, x, y, w, w, rad, hue);
    return C.tileInk;
  }
  const a = ctx.globalAlpha;
  const ring = Math.max(2, w * RING);
  tile(ctx, x, y, w, w, rad, hue);
  tile(ctx, x + ring, y + ring, w - 2 * ring, w - 2 * ring, Math.max(0, rad - ring), C.bg);
  ctx.globalAlpha = a * 0.16;
  tile(ctx, x + ring, y + ring, w - 2 * ring, w - 2 * ring, Math.max(0, rad - ring), hue);
  ctx.globalAlpha = a;
  return hue;
}

/**
 * A symbol tile, w square at (x, y): its ground (see tileGround) and the
 * orbital's dots, centered. Dealt tiles are squares with soft corners, placed
 * ones and the stacks circles; no outline on either.
 */
export function drawSymbolTile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, spin: boolean, k: number, style: TileStyle = 'placed', alpha = 1): void {
  const { orbital, up } = symbolOf(spin, k);
  ctx.save();
  ctx.globalAlpha = alpha;
  const ink = tileGround(ctx, x, y, w, w * RADIUS[style], orbital, up);
  // A circle has less room for the f ring than a square.
  orbitalShape(ctx, x + w / 2, y + w / 2, w * (style === 'given' ? 0.25 : 0.23), orbital, ink);
  ctx.restore();
}

/** An empty cell: only a faint dot at its center, so the eye can find the gaps. */
function drawEmpty(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, _rad?: number): void {
  ctx.save();
  ctx.fillStyle = C.surface3;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + w / 2, Math.max(1.5, w * 0.05), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A symbol's label under its stack: its letter, with an arrow for its spin on spin grids. */
export function symbolLabel(spin: boolean, k: number): string {
  const { orbital, up } = symbolOf(spin, k);
  return up === null ? orbital : `${orbital}${up ? '\u2191' : '\u2193'}`;
}

/** The clash mark: a dark gap, then an amber ring just outside the tile, so it reads on any hue. */
function drawClash(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rad: number): void {
  tile(ctx, x - 1, y - 1, w + 2, w + 2, rad + 1, null, C.bg, 3);
  tile(ctx, x - 2.5, y - 2.5, w + 5, w + 5, rad + 2.5, null, C.warn, 2);
  // A small amber notch in the corner, a second cue besides the ring.
  const d = Math.max(3, w * 0.11);
  ctx.save();
  ctx.fillStyle = C.warn;
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x + w - d * 0.4, y + d * 0.4, d, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * A stack of one symbol: a single round tile (the stack never runs out), with its letter and the
 * count still needed under it. While a tile is dragged off it, a dotted placeholder holds its
 * place. The box is k wide; the label sits below.
 */
function drawStack(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, countH: number, spin: boolean, sym: number, left: number, ring: boolean, lifted = false): void {
  const off = Math.max(2, k * 0.06);
  const t = k - 2 * off;
  const done = left <= 0;
  const tx = x + off, ty = y + off;
  if (lifted) socket(ctx, tx, ty, t, t, t / 2, C.line3);
  else drawSymbolTile(ctx, tx, ty, t, spin, sym, 'key', done ? 0.35 : 1);
  if (ring) tile(ctx, tx - 3.5, ty - 3.5, t + 7, t + 7, t / 2 + 3.5, null, C.silver, 2);
  ctx.save();
  ctx.textBaseline = 'middle';
  // Readable labels: at least 13 px, never dimmer than the second text color.
  const fs = Math.max(13, Math.min(17, countH * 0.85));
  const label = symbolLabel(spin, sym), count = String(Math.max(0, left));
  ctx.font = font(fs, 600);
  const lw = ctx.measureText(label).width;
  const cfs = Math.max(13, fs * 0.82);
  ctx.font = font(cfs, 500);
  const cw = ctx.measureText(count).width;
  const gap = fs * 0.4, cx = x + k / 2, cy = y + k + countH / 2 + 1;
  const x0 = cx - (lw + gap + cw) / 2;
  ctx.textAlign = 'left';
  ctx.font = font(fs, 600);
  ctx.fillStyle = done ? C.text2 : C.text;
  ctx.fillText(label, x0, cy);
  ctx.font = font(cfs, 500);
  ctx.fillStyle = C.text2;
  ctx.fillText(count, x0 + lw + gap, cy + fs * 0.04);
  ctx.restore();
}

/** The finger in the rule demos. */
function finger(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pressed: boolean): void {
  ctx.save();
  ctx.globalAlpha = pressed ? 0.55 : 0.3;
  ctx.fillStyle = C.silver;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- the view ---------------------------------------------------------------------

interface Layout {
  cell: number;
  gx: number;
  gy: number;
  /** Stack tile box size, the count's height under it, and the slot each stack owns (its touch area). */
  key: number;
  countH: number;
  slotW: number;
  slotH: number;
  cols: number;
  px: number;
  py: number;
}

interface Drag {
  /** The cell the tile came from, or -1 for a stack. */
  from: number;
  sym: number;
  start: Point;
  at: Point;
  live: boolean;
}

export class OrbitalGridView implements PuzzleView {
  private state: OrbitalGridState;
  private history: OrbitalGridState[] = [];
  private selected = -1;
  private pressed: Point | null = null;
  private drag: Drag | null = null;
  private lay: Layout | null = null;
  private area: Area = { x: 0, y: 0, w: 1, h: 1 };
  /** Look here: the cells to ring, for the board it was asked on. */
  private mark: { state: OrbitalGridState; unit: number[]; cell: number } | null = null;
  private reduced: boolean;
  /** The cell last stepped by tapping it, and when: it shows faint until the taps stop. */
  private cycled: { cell: number; at: number } | null = null;

  constructor(private readonly initial: OrbitalGridState, reducedMotion: boolean) {
    this.state = initial;
    this.reduced = reducedMotion;
    this.selected = initial.cells.indexOf(EMPTY);
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'Grid complete';
    const clash = conflicts(this.state).filter(Boolean).length;
    if (clash) return `${clash} cells clash`;
    return `${filledCount(this.state)} / ${this.state.par} placed`;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (this.won) return null;
    // A tile in the wrong place comes first: nothing else can be trusted while it is there.
    const wrong = s.cells.findIndex((v, i) => v !== EMPTY && !s.givens[i] && v !== s.solution[i]);
    if (wrong >= 0) {
      if (level === 2) {
        this.set(wrong, s.solution[wrong]);
        this.selected = wrong;
        return { text: `That cell takes ${symbolName(s.spin, s.solution[wrong])}.`, moved: true };
      }
      this.mark = { state: s, unit: [wrong], cell: wrong };
      this.selected = wrong;
      return { text: "This tile doesn't belong here." };
    }
    const f = nextForced(s);
    if (!f) return null;
    const name = symbolName(s.spin, f.value);
    if (level === 2) {
      this.set(f.cell, f.value);
      this.selected = f.cell;
      return { text: `Placed ${name}.`, moved: true };
    }
    this.mark = { state: s, unit: f.unit, cell: f.cell };
    this.selected = f.cell;
    const n = s.size;
    const where = f.unit.every((i) => Math.floor(i / n) === Math.floor(f.cell / n)) ? 'row'
      : f.unit.every((i) => i % n === f.cell % n) ? 'column' : 'block';
    const text = f.kind === 'last' ? `This ${where} has one gap left.`
      : f.kind === 'cell' ? 'Only one symbol fits this cell. Check its row, column and block.'
      : `Only one cell in this ${where} can take ${name}.`;
    return { text };
  }

  restart(): void {
    this.state = this.initial;
    this.history = [];
    this.drag = null;
    this.pressed = null;
    this.selected = this.initial.cells.indexOf(EMPTY);
    this.cycled = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    // Undo is free: the board and the placement count both go back.
    this.state = { ...prev };
    this.drag = null;
    this.cycled = null;
    return true;
  }

  private commit(next: OrbitalGridState | null): void {
    if (!next || this.won) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
  }

  private set(i: number, v: number): void {
    this.commit(place(this.state, i, v));
  }

  /** Places a stack's symbol in the chosen cell, or clears it when it already holds that symbol. */
  private choose(v: number): void {
    const i = this.selected;
    if (i < 0 || this.state.givens[i]) return;
    this.set(i, this.state.cells[i] === v ? EMPTY : v);
  }

  // ---- input ----------------------------------------------------------------------

  /** A column's or row's left or top edge: cells step by one cell, plus a gap between blocks. */
  private colX(col: number): number {
    const L = this.lay!;
    return L.gx + (col + Math.floor(col / this.state.rw) * BLOCK_GAP) * L.cell;
  }

  private rowY(row: number): number {
    const L = this.lay!;
    return L.gy + (row + Math.floor(row / this.state.rh) * BLOCK_GAP) * L.cell;
  }

  /** The cell under a point: the nearest one anywhere inside the grid's frames (so the gaps
   *  between blocks still count), -1 outside. */
  private cellAt(p: Point): number {
    const L = this.lay!, n = this.state.size, c = L.cell, out = OUTER * c;
    if (p.x < this.colX(0) - out || p.x > this.colX(n - 1) + c + out || p.y < this.rowY(0) - out || p.y > this.rowY(n - 1) + c + out) return -1;
    const near = (pos: (i: number) => number, v: number) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.abs(pos(i) + c / 2 - v); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    return near((r) => this.rowY(r), p.y) * n + near((k) => this.colX(k), p.x);
  }

  /** How far above the pointer the dragged tile rides. A mouse needs none; on touch the tile
   *  sits just above the fingertip, so the finger never hides it. */
  private lift(): number {
    if (lastPointer !== 'touch' && lastPointer !== 'pen') return 0;
    const L = this.lay!;
    return Math.max(L.cell, 40) * 0.6;
  }

  private ghostSize(): number {
    const L = this.lay!;
    // A little smaller than a cell, so the cyan ring round the target shows past it.
    return Math.max(L.cell * 0.84, 30);
  }

  /** Where the dragged tile is drawn: above the finger, kept inside the area. */
  private ghostCenter(at: Point): Point {
    const a = this.area, g = this.ghostSize() / 2 + 2;
    return {
      x: Math.max(a.x + g, Math.min(a.x + a.w - g, at.x)),
      y: Math.max(a.y + g, Math.min(a.y + a.h - g, at.y - this.lift())),
    };
  }

  /** The cell a drag would drop onto: the one under the dragged tile. */
  private dropCell(d: Drag): number {
    return this.cellAt(this.ghostCenter(d.at));
  }

  down(p: Point): void {
    this.pressed = p;
    this.drag = null;
    if (!this.lay || this.won) return;
    const k = this.keyAt(p);
    if (k >= 0) { this.drag = { from: -1, sym: k, start: p, at: p, live: false }; return; }
    const i = this.cellAt(p);
    if (i >= 0 && !this.state.givens[i] && this.state.cells[i] !== EMPTY) this.drag = { from: i, sym: this.state.cells[i], start: p, at: p, live: false };
  }

  move(p: Point): void {
    const d = this.drag;
    if (!d) return;
    d.at = p;
    if (!d.live && Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_PX) d.live = true;
  }

  cancel(): void {
    this.pressed = null;
    this.drag = null;
  }

  up(p: Point): void {
    const s = this.pressed, d = this.drag;
    this.pressed = null;
    this.drag = null;
    if (!s || !this.lay) return;
    if (d) {
      d.at = p;
      if (!d.live && Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_PX) d.live = true;
      if (d.live) { this.drop(d); return; }
    }
    if (Math.hypot(p.x - s.x, p.y - s.y) > 16) return;
    const i = this.cellAt(p);
    if (i >= 0) {
      if (i === this.selected && !this.state.givens[i]) {
        this.set(i, cycleValue(this.state, i));
        this.cycled = { cell: i, at: performance.now() };
      }
      this.selected = i;
      return;
    }
    const k = this.keyAt(p);
    if (k >= 0) this.choose(k);
  }

  private drop(d: Drag): void {
    const to = this.dropCell(d);
    if (d.from < 0) {
      // From a stack: onto any cell that can change.
      if (to >= 0 && !this.state.givens[to]) {
        this.set(to, d.sym);
        this.selected = to;
      }
      return;
    }
    // A placed tile: off the board clears it, onto another free cell moves it.
    if (to < 0) this.set(d.from, EMPTY);
    else if (to !== d.from && !this.state.givens[to]) {
      this.commit(moveTile(this.state, d.from, to));
      this.selected = to;
    }
  }

  private keyAt(p: Point): number {
    const L = this.lay!;
    for (let k = 0; k < this.state.size; k++) {
      const { x, y } = this.slotPos(k);
      if (p.x >= x && p.x < x + L.slotW && p.y >= y && p.y < y + L.slotH) return k;
    }
    return -1;
  }

  key(e: KeyboardEvent): boolean {
    const n = this.state.size;
    const moveBy = (dr: number, dc: number) => {
      const i = this.selected < 0 ? 0 : this.selected;
      const r = (Math.floor(i / n) + dr + n) % n, c = ((i % n) + dc + n) % n;
      this.selected = r * n + c;
    };
    if (e.key === 'ArrowUp') { moveBy(-1, 0); return true; }
    if (e.key === 'ArrowDown') { moveBy(1, 0); return true; }
    if (e.key === 'ArrowLeft') { moveBy(0, -1); return true; }
    if (e.key === 'ArrowRight') { moveBy(0, 1); return true; }
    if (this.selected < 0) return false;
    const i = this.selected;
    if (/^[1-8]$/.test(e.key) && Number(e.key) <= n) {
      const v = Number(e.key) - 1;
      if (!this.state.givens[i] && this.state.cells[i] !== v) this.set(i, v);
      return true;
    }
    const letter = 'spdf'.indexOf(e.key.toLowerCase());
    if (letter >= 0 && e.key.length === 1) {
      let v = letter;
      if (this.state.spin) {
        v = letter * 2;
        if (this.state.cells[i] === v) v += 1;
      }
      if (v < n && !this.state.givens[i] && this.state.cells[i] !== v) this.set(i, v);
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { this.set(i, EMPTY); return true; }
    if (e.key === ' ') { if (!this.state.givens[i]) this.set(i, cycleValue(this.state, i)); return true; }
    return false;
  }

  // ---- layout and drawing ---------------------------------------------------------

  private layout(area: Area): Layout {
    const n = this.state.size;
    // The grid's span in cells: the cells, the gaps between blocks and room for the frames.
    const spanX = n + (n / this.state.rw - 1) * BLOCK_GAP + 2 * OUTER;
    const spanY = n + (n / this.state.rh - 1) * BLOCK_GAP + 2 * OUTER;
    const margin = 8, gap = 14, padX = 10, padY = 6;
    const availW = Math.max(1, area.w - margin * 2), availH = Math.max(1, area.h - margin * 2);
    const countOf = (k: number) => Math.round(Math.max(13, Math.min(18, k * 0.3)));
    let best: Layout | null = null;
    let bestScore = -Infinity;
    // The stacks go under the grid in one or two rows, or beside it in one or two columns.
    for (const side of [false, true]) {
      for (const lines of [1, 2]) {
        const across = Math.ceil(n / lines);
        const cols = side ? lines : across, rows = side ? across : lines;
        // The biggest stack that fits the area across the stacks' run.
        const maxKey = side ? availH / rows - padY - countOf(40) : availW / cols - padX;
        if (maxKey < 32) continue;
        let key = Math.min(60, maxKey), cell = 0;
        for (let pass = 0; pass < 5; pass++) {
          const slotW = key + padX, slotH = key + countOf(key) + padY;
          cell = Math.min(72, side ? (availW - cols * slotW - gap) / spanX : availW / spanX, side ? availH / spanY : (availH - rows * slotH - gap) / spanY);
          // Stacks a little bigger than a cell, 38 to 60 px, as far as they fit.
          key = Math.min(maxKey, Math.max(38, Math.min(60, cell * 1.1)));
        }
        if (cell <= 4) continue;
        const countH = countOf(key), slotW = key + padX, slotH = key + countH + padY;
        const score = cell + (side ? 0 : 0.5) + Math.min(0, key - 40);
        if (score <= bestScore) continue;
        bestScore = score;
        const kW = cols * slotW, kH = rows * slotH;
        const gW = cell * spanX, gH = cell * spanY, o = OUTER * cell;
        const totalW = side ? gW + gap + kW : Math.max(gW, kW), totalH = side ? Math.max(gH, kH) : gH + gap + kH;
        const ox = area.x + (area.w - totalW) / 2, oy = area.y + (area.h - totalH) / 2;
        best = side
          ? { cell, gx: ox + o, gy: oy + (totalH - gH) / 2 + o, key, countH, slotW, slotH, cols, px: ox + gW + gap, py: oy + (totalH - kH) / 2 }
          : { cell, gx: area.x + (area.w - gW) / 2 + o, gy: oy + o, key, countH, slotW, slotH, cols, px: area.x + (area.w - kW) / 2, py: oy + gH + gap };
      }
    }
    return best!;
  }

  /** The top left of stack k's slot (its whole touch area). */
  private slotPos(k: number): { x: number; y: number } {
    const L = this.lay!;
    const row = Math.floor(k / L.cols), col = k % L.cols;
    // A short last row is centered under the first.
    const inRow = Math.min(L.cols, this.state.size - row * L.cols);
    const shift = ((L.cols - inRow) * L.slotW) / 2;
    return { x: L.px + shift + col * L.slotW, y: L.py + row * L.slotH };
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now = 0): void {
    this.area = area;
    const s = this.state;
    const L = (this.lay = this.layout(area));
    const n = s.size, c = L.cell;
    const pad = Math.max(2, c * 0.06);
    const w = c - pad * 2;
    const clash = conflicts(s);
    const won = this.won;
    const d = this.drag?.live ? this.drag : null;
    const target = d ? this.dropCell(d) : -1;

    // Blocks: each in its own board frame, with room between them so no frame crowds a tile.
    const fo = FRAME_OUT * c;
    for (let br = 0; br < n; br += s.rh) {
      for (let bc = 0; bc < n; bc += s.rw) {
        const x = this.colX(bc), y = this.rowY(br);
        drawFrame(ctx, { x: x - fo, y: y - fo, w: s.rw * c + 2 * fo, h: s.rh * c + 2 * fo }, { width: frameWidth(c), radius: c * 0.22 + fo, color: won ? C.good : C.frame });
      }
    }

    const fade = (i: number): number => {
      const cy = this.cycled;
      if (!cy || cy.cell !== i) return 1;
      const age = now - cy.at;
      if (age < CYCLE_HOLD) return CYCLE_ALPHA;
      if (age >= CYCLE_HOLD + CYCLE_FADE || this.reduced) { this.cycled = null; return 1; }
      return CYCLE_ALPHA + (1 - CYCLE_ALPHA) * ((age - CYCLE_HOLD) / CYCLE_FADE);
    };
    for (let i = 0; i < n * n; i++) {
      const x = this.colX(i % n) + pad, y = this.rowY(Math.floor(i / n)) + pad;
      const v = s.cells[i];
      const lifted = d !== null && d.from === i;
      if (v === EMPTY || lifted) drawEmpty(ctx, x, y, w);
      else drawSymbolTile(ctx, x, y, w, s.spin, v, s.givens[i] ? 'given' : 'placed', fade(i));
      if (clash[i] && !s.givens[i] && !lifted) drawClash(ctx, x, y, w, w * RADIUS.placed);
      if (i === this.selected && !won && !d) tile(ctx, x - 3, y - 3, w + 6, w + 6, (s.givens[i] ? w * RADIUS.given : w / 2) + 3, null, C.accent, 2);
    }

    // Look here: the unit that decides it, and the cell.
    const m = this.mark?.state === s && !won ? this.mark : null;
    if (m) {
      const box = (cells: number[]) => {
        const rs = cells.map((i) => Math.floor(i / n)), cs = cells.map((i) => i % n);
        const r0 = Math.min(...rs), r1 = Math.max(...rs), c0 = Math.min(...cs), c1 = Math.max(...cs);
        const x = this.colX(c0), y = this.rowY(r0);
        return { x, y, w: this.colX(c1) + c - x, h: this.rowY(r1) + c - y };
      };
      if (m.unit.length > 1) { const b = box(m.unit); drawHelpMark(ctx, b.x, b.y, b.w, b.h, now, this.reduced, c * 0.2); }
      const b = box([m.cell]);
      drawHelpMark(ctx, b.x + pad, b.y + pad, w, w, now, this.reduced, w / 2);
    }

    // The drop target: cyan, under the dragged tile.
    if (d && target >= 0 && !s.givens[target]) {
      const x = this.colX(target % n) + pad, y = this.rowY(Math.floor(target / n)) + pad;
      ctx.save();
      ctx.globalAlpha = 0.22;
      tile(ctx, x - 2, y - 2, w + 4, w + 4, w / 2 + 2, C.accent);
      ctx.restore();
      tile(ctx, x - 2.5, y - 2.5, w + 5, w + 5, w / 2 + 2.5, null, C.accent, 3);
    }

    // The stacks.
    const left = remaining(s);
    const sel = this.selected;
    const live = !won && sel >= 0 && !s.givens[sel];
    for (let k = 0; k < n; k++) {
      const { x, y } = this.slotPos(k);
      drawStack(ctx, x + (L.slotW - L.key) / 2, y + 2, L.key, L.countH, s.spin, k, left[k], live && s.cells[sel] === k, d !== null && d.from < 0 && d.sym === k);
    }

    // The tile being dragged rides above the finger.
    if (d) {
      const g = this.ghostCenter(d.at), size = this.ghostSize();
      // A soft shadow plate first, so the tile's own layers don't cast shadows on each other.
      ctx.save();
      ctx.shadowColor = C.bg;
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;
      tile(ctx, g.x - size / 2, g.y - size / 2, size, size, size / 2, C.bg);
      ctx.restore();
      drawSymbolTile(ctx, g.x - size / 2, g.y - size / 2, size, s.spin, d.sym, 'placed', 0.94);
    }
  }
}

// ---- rules ------------------------------------------------------------------------

/** A square board of `n` cells fitted in the demo box, centered; returns its cell size and origin. */
function demoBoard(w: number, h: number, cols: number, rows: number, fill = 0.86): { c: number; x: number; y: number } {
  const c = Math.min((w * fill) / cols, (h * fill) / rows);
  return { c, x: (w - c * cols) / 2, y: (h - c * rows) / 2 };
}

/** Draws demo cells: a symbol index, EMPTY, with given flags. */
function demoCells(ctx: CanvasRenderingContext2D, x0: number, y0: number, c: number, cols: number, spin: boolean, cells: number[], givens: boolean[] = []): void {
  const pad = Math.max(1.5, c * 0.06), w = c - pad * 2;
  cells.forEach((v, i) => {
    const x = x0 + (i % cols) * c + pad, y = y0 + Math.floor(i / cols) * c + pad;
    if (v === EMPTY) drawEmpty(ctx, x, y, w, w * EMPTY_RADIUS);
    else drawSymbolTile(ctx, x, y, w, spin, v, givens[i] ? 'given' : 'placed');
  });
}

const cellBox = (x0: number, y0: number, c: number, cols: number, i: number) => {
  const pad = Math.max(1.5, c * 0.06);
  return { x: x0 + (i % cols) * c + pad, y: y0 + Math.floor(i / cols) * c + pad, w: c - pad * 2 };
};

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A 4x4 solution for the demos. */
const DEMO_GRID = [0, 1, 2, 3, 2, 3, 0, 1, 1, 0, 3, 2, 3, 2, 1, 0];

/** A unit outline in the demos: a row, a column or a block of cells, in cyan or amber. */
function demoUnit(ctx: CanvasRenderingContext2D, x0: number, y0: number, c: number, col: number, row: number, cols: number, rows: number, color: string, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  tile(ctx, x0 + col * c - 1, y0 + row * c - 1, cols * c + 2, rows * c + 2, c * 0.22, null, color, 2);
  ctx.restore();
}

/** The demo 4x4 board: block plates, then the cells. */
function demoGrid(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, cells: number[], givens: boolean[]): void {
  for (let br = 0; br < 4; br += 2) for (let bc = 0; bc < 4; bc += 2) drawFrame(ctx, { x: x + bc * c + 1.5, y: y + br * c + 1.5, w: 2 * c - 3, h: 2 * c - 3 }, { width: 2.5, radius: c * 0.24, color: C.frame });
  demoCells(ctx, x, y, c, 4, false, cells, givens);
}

/** A tile settling into a cell: it fades and grows in over the first 40% of m. */
function demoArrive(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number }, spin: boolean, sym: number, m: number): void {
  const k = smooth(Math.min(1, Math.max(0, m)));
  if (k <= 0) return;
  const w = b.w * (0.8 + 0.2 * k);
  drawSymbolTile(ctx, b.x + (b.w - w) / 2, b.y + (b.w - w) / 2, w, spin, sym, 'placed', k);
}

/** Cell 10's place in DEMO_GRID: the one the player fills in "Once each". */
const DEMO_HOLE = 10;
/** Every DEMO_GRID cell dealt except the hole. */
const DEMO_GIVENS = DEMO_GRID.map((_, i) => i !== DEMO_HOLE);

/** A row of four cells across the demo box: its cell size and origin. */
function demoRow(w: number, h: number, rows = 1): { c: number; x: number; y: number } {
  const c = Math.min(w / 4.5, h / (rows + 0.6));
  return { c, x: (w - 4 * c) / 2, y: (h - rows * c) / 2 };
}

/**
 * Pictures for the Instructions modal. Each still is its last frame (t = duration); Play runs
 * good, then bad. Captions are a few words.
 */
export const RULES: RuleCard[] = [
  {
    title: 'Once each',
    text: 'Fill the grid so every row, every column and every outlined block holds each symbol exactly once.',
    good: {
      duration: 3,
      caption: 'One of each per row',
      draw: (ctx, w, h, t) => {
        const { c, x, y } = demoBoard(w, h, 4, 4, 0.94);
        const cells = DEMO_GRID.map((v, i) => (i === DEMO_HOLE ? EMPTY : v));
        demoGrid(ctx, x, y, c, cells, DEMO_GIVENS);
        demoArrive(ctx, cellBox(x, y, c, 4, DEMO_HOLE), false, DEMO_GRID[DEMO_HOLE], (t - 0.2) / 0.6);
        // Its column, its block, then its row: f once in each.
        if (t > 1 && t < 1.7) demoUnit(ctx, x, y, c, 2, 0, 1, 4, C.accent);
        else if (t >= 1.7 && t < 2.4) demoUnit(ctx, x, y, c, 2, 2, 2, 2, C.accent);
        else if (t >= 2.4) demoUnit(ctx, x, y, c, 0, 2, 4, 1, C.accent);
      },
    },
    bad: {
      duration: 2.4,
      caption: 'Two p in one block',
      draw: (ctx, w, h, t) => {
        const { c, x, y } = demoBoard(w, h, 4, 4, 0.94);
        const cells = DEMO_GRID.map((v, i) => (i === DEMO_HOLE ? EMPTY : v));
        demoGrid(ctx, x, y, c, cells, DEMO_GIVENS);
        const b = cellBox(x, y, c, 4, DEMO_HOLE);
        demoArrive(ctx, b, false, 1, (t - 0.2) / 0.6);
        if (t > 1.1) {
          // The block already has its p (bottom left of it): the new one clashes.
          demoUnit(ctx, x, y, c, 2, 2, 2, 2, C.warn, 0.8);
          drawClash(ctx, b.x, b.y, b.w, b.w * RADIUS.placed);
        }
      },
    },
  },
  {
    title: 'The orbitals',
    text: 'Each symbol is an orbital, in the same color as in the atom, with one dot for each lobe of the real orbital: s one, p two, d four, f six. Its letter sits under its stack.',
    good: {
      duration: 2,
      caption: 's p d f: 1, 2, 4, 6 dots',
      draw: (ctx, w, h, t) => {
        const size = Math.min((w * 0.92) / 4.45, h * 0.62);
        const gap = size * 0.15, x0 = (w - 4 * size - 3 * gap) / 2, y0 = (h - size) / 2;
        for (let k = 0; k < 4; k++) demoArrive(ctx, { x: x0 + k * (size + gap), y: y0, w: size }, false, k, (t - k * 0.4) / 0.5);
      },
    },
  },
  {
    title: 'Spin up, spin down',
    text: 'On the bigger grids each orbital comes twice: spin up is a solid tile, spin down its hollow twin, dark inside a ring of the same color. They count as different symbols.',
    good: {
      duration: 2.4,
      caption: 'Solid up, hollow down',
      draw: (ctx, w, h, t) => {
        const size = Math.min((w * 0.9) / 4.45, (h * 0.9) / 2.15);
        const gap = size * 0.15, x0 = (w - 4 * size - 3 * gap) / 2, y0 = (h - 2 * size - gap) / 2;
        for (let k = 0; k < 8; k++) {
          const col = k >> 1, row = k & 1;
          demoArrive(ctx, { x: x0 + col * (size + gap), y: y0 + row * (size + gap), w: size }, true, k, (t - row * 1 - col * 0.2) / 0.5);
        }
      },
    },
  },
  {
    title: 'Drag from a stack',
    text: 'Drag a symbol from its stack onto a cell. Stacks never run out, and the cell lights up where it will land.',
    good: {
      duration: 2.4,
      caption: 'Stack to empty cell',
      draw: (ctx, w, h, t) => {
        const c = Math.min(w / 4.6, h / 2.6);
        const x0 = (w - 4 * c) / 2, y0 = h * 0.06;
        const placed = t >= 2;
        demoCells(ctx, x0, y0, c, 4, false, placed ? [1, 2, 3, 0] : [1, EMPTY, 3, 0], [true, false, true, true]);
        const k = c * 0.95, countH = Math.max(11, c * 0.3);
        const kx = w / 2 - k / 2, ky = y0 + c + h * 0.08;
        drawStack(ctx, kx, ky, k, countH, false, 2, placed ? 3 : 4, false);
        const target = cellBox(x0, y0, c, 4, 1);
        if (placed) return;
        const m = smooth(Math.min(1, Math.max(0, (t - 0.3) / 1.3)));
        const fx = lerp(kx + k / 2, target.x + target.w / 2, m), fy = lerp(ky + k / 2 + c * 0.6, target.y + target.w / 2 + c * 0.7, m);
        if (m > 0.75) {
          ctx.save();
          ctx.globalAlpha = 0.22;
          tile(ctx, target.x - 2, target.y - 2, target.w + 4, target.w + 4, target.w / 2 + 2, C.accent);
          ctx.restore();
          tile(ctx, target.x - 2, target.y - 2, target.w + 4, target.w + 4, target.w / 2 + 2, null, C.accent, 2);
        }
        if (t > 0.3) {
          const gs = c * 0.84;
          drawSymbolTile(ctx, fx - gs / 2, fy - c * 0.7 - gs / 2, gs, false, 2, 'placed', 0.95);
        }
        finger(ctx, fx, fy, c * 0.28, t > 0.3);
      },
    },
  },
  {
    title: 'Or tap',
    text: 'Tap a cell to choose it, then tap a stack. Tap the cell again to step it through the symbols; the tile stays faint until you stop tapping.',
    good: {
      duration: 2.6,
      caption: 'Cell, then stack',
      draw: (ctx, w, h, t) => {
        const c = Math.min(w / 4.6, h / 2.6);
        const x0 = (w - 4 * c) / 2, y0 = h * 0.06;
        const sym = t < 1.5 ? EMPTY : t < 2.3 ? 1 : 2;
        demoCells(ctx, x0, y0, c, 4, false, [0, sym, 3, EMPTY], [true, false, true, false]);
        const cell = cellBox(x0, y0, c, 4, 1);
        if (t > 0.5) tile(ctx, cell.x - 2, cell.y - 2, cell.w + 4, cell.w + 4, cell.w / 2 + 2, null, C.accent, 2);
        // A tall count row, so the ring round the chosen stack clears its number.
        const k = c * 0.85, countH = Math.max(14, c * 0.45);
        const sx = (w - 4 * (k + c * 0.15)) / 2, ky = y0 + c + h * 0.08;
        for (let s = 0; s < 4; s++) drawStack(ctx, sx + s * (k + c * 0.15), ky, k, countH, false, s, 2, sym === s);
        // Tap the cell, tap the p stack, then tap the cell again to step p to d.
        const taps: [number, number, number][] = [[0.3, cell.x + cell.w / 2, cell.y + cell.w / 2], [1.2, sx + 1 * (k + c * 0.15) + k / 2, ky + k / 2], [2, cell.x + cell.w / 2, cell.y + cell.w / 2]];
        for (const [at, fx, fy] of taps) if (t > at && t < at + 0.45) finger(ctx, fx, fy, c * 0.26, t < at + 0.25);
      },
    },
  },
  {
    title: 'Counts',
    text: 'The number beside each stack\'s letter is how many more of that symbol the grid needs. At 0 the stack dims: that symbol is done.',
    good: {
      duration: 2.4,
      caption: 'At 0, p is done',
      draw: (ctx, w, h, t) => {
        const left = t < 0.8 ? 2 : t < 1.6 ? 1 : 0;
        const k = Math.min(w * 0.36, h * 0.62), countH = Math.max(12, k * 0.3);
        const x = w * 0.18, y = (h - k - countH) / 2;
        drawStack(ctx, x, y, k, countH, false, 1, left, false);
        // The tiles already out on the board, beside the stack.
        const c = k * 0.5, bx = w * 0.62, by = y + 2;
        for (let i = 0; i < 4; i++) {
          const yy = by + (i % 2) * c * 1.1, xx = bx + Math.floor(i / 2) * c * 1.1;
          if (i < 4 - left) drawSymbolTile(ctx, xx, yy, c, false, 1, i < 2 ? 'given' : 'placed');
          else drawEmpty(ctx, xx, yy, c, c * EMPTY_RADIUS);
        }
      },
    },
  },
  {
    title: 'Dealt tiles',
    text: 'Square tiles were dealt and never change. Your tiles are round: drag one to move it, or off the board to clear it.',
    good: {
      duration: 2.6,
      caption: 'Round tiles are yours',
      draw: (ctx, w, h, t) => {
        const c = Math.min(w / 4.5, h / 1.9);
        const x0 = (w - 4 * c) / 2, y0 = (h - c) / 2 - c * 0.15;
        const moved = t >= 2;
        demoCells(ctx, x0, y0, c, 4, false, [3, moved ? EMPTY : 0, 1, moved ? 0 : EMPTY], [true, false, true, false]);
        if (t <= 0.4 || moved) return;
        // Lift your tile and carry it past the dealt one to the free cell.
        const from = cellBox(x0, y0, c, 4, 1), to = cellBox(x0, y0, c, 4, 3);
        drawEmpty(ctx, from.x, from.y, from.w, from.w * EMPTY_RADIUS);
        const m = smooth(Math.min(1, (t - 0.5) / 1.3));
        const tx = lerp(from.x, to.x, m), ty = from.y - Math.sin(m * Math.PI) * c * 0.35;
        drawSymbolTile(ctx, tx, ty, from.w, false, 0, 'placed', 0.95);
        finger(ctx, tx + from.w / 2, ty + from.w / 2 + c * 0.55, c * 0.24, true);
      },
    },
  },
  {
    title: 'Keyboard',
    text: 'Arrow keys move the cyan cursor; 1-8 or s p d f place a symbol (press a letter twice for spin down), and Backspace clears.',
    good: {
      duration: 2.4,
      caption: 'Right, then p, p again',
      draw: (ctx, w, h, t) => {
        const { c, x, y } = demoRow(w, h);
        // The cursor steps right, then p, then p again for spin down.
        const at = t < 0.6 ? 0 : 1;
        const v = t < 1.2 || at === 0 ? EMPTY : t < 1.9 ? 2 : 3;
        demoCells(ctx, x, y, c, 4, true, [EMPTY, v, 0, 5], [false, false, true, true]);
        const b = cellBox(x, y, c, 4, at);
        tile(ctx, b.x - 2, b.y - 2, b.w + 4, b.w + 4, b.w / 2 + 2, null, C.accent, 2);
      },
    },
  },
  {
    title: 'Clashes',
    text: 'A tile whose symbol already sits in its row, column or block gets an amber ring. Move it or change it.',
    good: {
      duration: 1.6,
      caption: 'p down: no clash',
      draw: (ctx, w, h, t) => {
        const { c, x, y } = demoRow(w, h);
        demoCells(ctx, x, y, c, 4, true, [2, 0, EMPTY, 1], [true, true, false, true]);
        demoArrive(ctx, cellBox(x, y, c, 4, 2), true, 3, (t - 0.3) / 0.6);
      },
    },
    bad: {
      duration: 2,
      caption: 'Two p up: amber',
      draw: (ctx, w, h, t) => {
        const { c, x, y } = demoRow(w, h);
        demoCells(ctx, x, y, c, 4, true, [2, 0, EMPTY, 1], [true, true, false, true]);
        const a = cellBox(x, y, c, 4, 2);
        demoArrive(ctx, a, true, 2, (t - 0.3) / 0.6);
        if (t > 1.1) drawClash(ctx, a.x, a.y, a.w, a.w * RADIUS.placed);
      },
    },
  },
];
