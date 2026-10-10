// Drawing and touch for Orbital Grid. Each symbol has a stack under (or beside)
// the grid: drag from a stack onto a cell, or tap a cell and then a stack.
// Tapping the chosen cell again cycles it; dragging a placed tile moves it, and
// dragging it off the board clears it. Keys: arrows move, 1-8 or s/p/d/f place,
// Backspace clears.
//
// Every symbol is a tile in its orbital's color with a shape after the real
// orbital (s a round blob, p two lobes, d four, f six). On spin grids spin up is
// a deep tile with an up arrow and spin down a pale tile with a down arrow, so
// the pair differs in shade as well as in the arrow.

import { conflicts, cycleValue, EMPTY, filledCount, moveTile, place, remaining, solved, symbolOf, type Orbital, type OrbitalGridState } from './orbitalGrid';
import { C, font, tile } from './palette';
import type { Area, Point, PuzzleView, RuleCard } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">The electron stage of building every element, z 1 to 118. Periods 1-3 play a 4x4 with s p d f (6 to 10 empty cells); periods 4-5 a 6x6 with 2x3 blocks and s p d in spin up and spin down (14 to 22 empty); periods 6-7, where the f block arrives, an 8x8 with 2x4 blocks and s p d f in both spins (24 to 36 empty). Par is one placement per empty cell: editing or moving the tile you just placed is free, going back to an older cell costs another, and undo takes a placement back. Clean means finishing within par. Each grid is carved from a full random grid so that it always finishes by deduction alone, with one answer. The symbols are only orbital labels: a cell is not a place in the atom.</p>`;

/** Pixels a press must travel before it becomes a drag. */
const DRAG_PX = 9;

// ---- symbols --------------------------------------------------------------------

type TileStyle = 'given' | 'placed' | 'key';

/** One lobe: a teardrop from the center out to length l along angle a, w wide. */
function lobe(ctx: CanvasRenderingContext2D, cx: number, cy: number, l: number, w: number, a: number): void {
  const ca = Math.cos(a), sa = Math.sin(a);
  // Local (u along the lobe, v across it) to canvas.
  const P = (u: number, v: number): [number, number] => [cx + u * ca - v * sa, cy + u * sa + v * ca];
  ctx.moveTo(...P(0, 0));
  ctx.bezierCurveTo(...P(l * 0.2, -w * 0.9), ...P(l * 1.02, -w * 0.95), ...P(l, 0));
  ctx.bezierCurveTo(...P(l * 1.02, w * 0.95), ...P(l * 0.2, w * 0.9), ...P(0, 0));
}

/**
 * The orbital's shape, after the real orbitals: s a round blob, p two lobes,
 * d a four-lobed clover, f six petals. r is the reach from the center.
 */
export function orbitalShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, orbital: Orbital, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (orbital === 's') ctx.arc(cx, cy, r * 0.66, 0, Math.PI * 2);
  else {
    const count = orbital === 'p' ? 2 : orbital === 'd' ? 4 : 6;
    const wide = orbital === 'p' ? 0.46 : orbital === 'd' ? 0.4 : 0.3;
    for (let i = 0; i < count; i++) lobe(ctx, cx, cy, r, r * wide, -Math.PI / 2 + (i * Math.PI * 2) / count);
  }
  ctx.fill();
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, x: number, cy: number, h: number, up: boolean, color: string, lw: number): void {
  const top = cy - h / 2, bot = cy + h / 2, head = h * 0.28;
  const tip = up ? top : bot, dir = up ? 1 : -1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bot);
  ctx.moveTo(x - head, tip + head * dir);
  ctx.lineTo(x, tip);
  ctx.lineTo(x + head, tip + head * dir);
  ctx.stroke();
  ctx.restore();
}

/**
 * A symbol tile, w square at (x, y): deep in its orbital color for spin up and
 * plain symbols, pale for spin down; its orbital's shape, the spin arrow and a
 * small letter in ink. Dealt tiles are squarer with a fine inset frame; placed
 * ones are rounder.
 */
export function drawSymbolTile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, spin: boolean, k: number, style: TileStyle = 'placed', alpha = 1): void {
  const { orbital, up } = symbolOf(spin, k);
  const hue = C[orbital];
  const rad = w * (style === 'given' ? 0.12 : style === 'placed' ? 0.3 : 0.22);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (up === false) {
    // Pale: the light tile washed with the hue, ringed in the deep hue.
    tile(ctx, x, y, w, w, rad, C.tile);
    ctx.globalAlpha = alpha * 0.4;
    tile(ctx, x, y, w, w, rad, hue);
    ctx.globalAlpha = alpha;
    tile(ctx, x + 1, y + 1, w - 2, w - 2, rad, null, hue, 2);
  } else tile(ctx, x, y, w, w, rad, hue);
  if (style === 'given') {
    ctx.globalAlpha = alpha * 0.4;
    const g = Math.max(2, w * 0.08);
    tile(ctx, x + g, y + g, w - 2 * g, w - 2 * g, rad * 0.6, null, C.tileInk, 1);
    ctx.globalAlpha = alpha;
  }
  const ink = C.tileInk;
  const cx = x + w / 2, cy = y + w / 2;
  if (up === null) orbitalShape(ctx, cx + w * 0.04, cy + w * 0.04, w * 0.34, orbital, ink);
  else {
    orbitalShape(ctx, cx - w * 0.08, cy + w * 0.04, w * 0.3, orbital, ink);
    arrow(ctx, cx + w * 0.3, cy + w * 0.04, w * 0.5, up, ink, Math.max(1.5, w * 0.065));
  }
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(Math.max(8, w * 0.22), 700);
  ctx.fillText(orbital, x + w * 0.17, y + w * 0.18);
  ctx.restore();
}

/** An empty cell. */
function drawEmpty(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rad: number): void {
  tile(ctx, x, y, w, w, rad, C.surface2, C.line, 1);
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

/** A stack of one symbol with the count still needed under it. The box is k wide; the count sits below. */
function drawStack(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, countH: number, spin: boolean, sym: number, left: number, ring: boolean): void {
  const off = Math.max(2, k * 0.06);
  const t = k - 2 * off;
  const done = left <= 0;
  if (!done) {
    // Two tiles peeking out behind: the stack goes on as long as you need.
    for (const layer of [2, 1]) {
      ctx.save();
      ctx.globalAlpha = layer === 2 ? 0.35 : 0.6;
      drawStackBack(ctx, x + off * layer, y + off * (2 - layer), t, spin, sym);
      ctx.restore();
    }
  }
  drawSymbolTile(ctx, x, y + 2 * off, t, spin, sym, 'key', done ? 0.4 : 1);
  if (ring) tile(ctx, x - 3, y + 2 * off - 3, t + 6, t + 6, t * 0.26, null, C.silver, 1.5);
  ctx.save();
  ctx.fillStyle = done ? C.text3 : C.text2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(Math.max(11, Math.min(16, countH * 0.8)), done ? 500 : 600);
  ctx.fillText(String(Math.max(0, left)), x + t / 2, y + k + countH / 2 + 1);
  ctx.restore();
}

/** The edge of a tile further down a stack: its color, without the symbol. */
function drawStackBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, spin: boolean, sym: number): void {
  const { orbital, up } = symbolOf(spin, sym);
  const rad = w * 0.22;
  if (up === false) {
    tile(ctx, x, y, w, w, rad, C.tile);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.4;
    tile(ctx, x, y, w, w, rad, C[orbital]);
    ctx.globalAlpha = a;
  } else tile(ctx, x, y, w, w, rad, C[orbital]);
  tile(ctx, x, y, w, w, rad, null, C.bg, 1);
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

  constructor(private readonly initial: OrbitalGridState, reducedMotion: boolean) {
    this.state = initial;
    void reducedMotion;
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

  restart(): void {
    this.state = this.initial;
    this.history = [];
    this.drag = null;
    this.pressed = null;
    this.selected = this.initial.cells.indexOf(EMPTY);
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    // Undo is free: the board and the placement count both go back.
    this.state = { ...prev };
    this.drag = null;
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

  private cellAt(p: Point): number {
    const L = this.lay!, n = this.state.size;
    const c = Math.floor((p.x - L.gx) / L.cell), r = Math.floor((p.y - L.gy) / L.cell);
    return c >= 0 && r >= 0 && c < n && r < n ? r * n + c : -1;
  }

  /** How far above the finger the dragged tile rides, so the finger never hides it. */
  private lift(): number {
    const L = this.lay!;
    return Math.max(L.cell, 40) * 0.85;
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
      if (i === this.selected && !this.state.givens[i]) this.set(i, cycleValue(this.state, i));
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
    const margin = 8, gap = 12, padX = 8, padY = 4;
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
          cell = Math.min(72, side ? (availW - cols * slotW - gap) / n : availW / n, side ? availH / n : (availH - rows * slotH - gap) / n);
          // Stacks a little bigger than a cell, 38 to 60 px, as far as they fit.
          key = Math.min(maxKey, Math.max(38, Math.min(60, cell * 1.1)));
        }
        if (cell <= 4) continue;
        const countH = countOf(key), slotW = key + padX, slotH = key + countH + padY;
        const score = cell + (side ? 0 : 0.5) + Math.min(0, key - 40);
        if (score <= bestScore) continue;
        bestScore = score;
        const kW = cols * slotW, kH = rows * slotH;
        const g = cell * n;
        const totalW = side ? g + gap + kW : Math.max(g, kW), totalH = side ? Math.max(g, kH) : g + gap + kH;
        const ox = area.x + (area.w - totalW) / 2, oy = area.y + (area.h - totalH) / 2;
        best = side
          ? { cell, gx: ox, gy: oy + (totalH - g) / 2, key, countH, slotW, slotH, cols, px: ox + g + gap, py: oy + (totalH - kH) / 2 }
          : { cell, gx: area.x + (area.w - g) / 2, gy: oy, key, countH, slotW, slotH, cols, px: area.x + (area.w - kW) / 2, py: oy + g + gap };
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
    void now; // nothing here animates by time
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

    // Blocks: a fine outline round each region.
    for (let br = 0; br < n; br += s.rh) {
      for (let bc = 0; bc < n; bc += s.rw) {
        const x = L.gx + bc * c, y = L.gy + br * c;
        tile(ctx, x + 1, y + 1, s.rw * c - 2, s.rh * c - 2, c * 0.18, C.plate, won ? C.good : C.line3, 1.25);
      }
    }

    for (let i = 0; i < n * n; i++) {
      const x = L.gx + (i % n) * c + pad, y = L.gy + Math.floor(i / n) * c + pad;
      const v = s.cells[i];
      const lifted = d !== null && d.from === i;
      if (v === EMPTY || lifted) drawEmpty(ctx, x, y, w, w * 0.14);
      else drawSymbolTile(ctx, x, y, w, s.spin, v, s.givens[i] ? 'given' : 'placed');
      if (clash[i] && !s.givens[i] && !lifted) drawClash(ctx, x, y, w, w * (s.givens[i] ? 0.12 : 0.3));
      if (i === this.selected && !won && !d) tile(ctx, x - 2, y - 2, w + 4, w + 4, w * 0.3, null, C.accent, 2);
    }

    // The drop target: cyan, under the dragged tile.
    if (d && target >= 0 && !s.givens[target]) {
      const x = L.gx + (target % n) * c + pad, y = L.gy + Math.floor(target / n) * c + pad;
      ctx.save();
      ctx.globalAlpha = 0.22;
      tile(ctx, x - 2, y - 2, w + 4, w + 4, w * 0.3, C.accent);
      ctx.restore();
      tile(ctx, x - 2.5, y - 2.5, w + 5, w + 5, w * 0.3, null, C.accent, 3);
    }

    // The stacks.
    const left = remaining(s);
    const sel = this.selected;
    const live = !won && sel >= 0 && !s.givens[sel];
    for (let k = 0; k < n; k++) {
      const { x, y } = this.slotPos(k);
      drawStack(ctx, x + (L.slotW - L.key) / 2, y + 2, L.key, L.countH, s.spin, k, left[k], live && s.cells[sel] === k);
    }

    // The tile being dragged rides above the finger.
    if (d) {
      const g = this.ghostCenter(d.at), size = this.ghostSize();
      // A soft shadow plate first, so the tile's own layers don't cast shadows on each other.
      ctx.save();
      ctx.shadowColor = C.bg;
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;
      tile(ctx, g.x - size / 2, g.y - size / 2, size, size, size * 0.3, C.bg);
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
    if (v === EMPTY) drawEmpty(ctx, x, y, w, w * 0.14);
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

export const RULES: RuleCard[] = [
  {
    title: 'Once each',
    text: 'Fill the grid so every row, every column and every outlined block holds each symbol exactly once.',
    demo: (ctx, w, h, t) => {
      const { c, x, y } = demoBoard(w, h, 4, 4, 0.92);
      for (let br = 0; br < 4; br += 2) for (let bc = 0; bc < 4; bc += 2) tile(ctx, x + bc * c + 0.5, y + br * c + 0.5, 2 * c - 1, 2 * c - 1, c * 0.18, C.plate, C.line3, 1);
      demoCells(ctx, x, y, c, 4, false, DEMO_GRID, DEMO_GRID.map(() => true));
      // Sweep a row, then a column, then a block.
      const phase = Math.floor((t % 4.5) / 1.5);
      ctx.save();
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (phase === 0) ctx.roundRect(x - 1, y + c - 1, 4 * c + 2, c + 2, c * 0.2);
      else if (phase === 1) ctx.roundRect(x + 2 * c - 1, y - 1, c + 2, 4 * c + 2, c * 0.2);
      else ctx.roundRect(x + 2 * c - 1, y + 2 * c - 1, 2 * c + 2, 2 * c + 2, c * 0.2);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    title: 'The orbitals',
    text: 'Each symbol is an orbital with its own color and a shape after the real one: s a round blob, p two lobes, d four, f six.',
    demo: (ctx, w, h, t) => {
      const size = Math.min((w * 0.9) / 4.4, h * 0.6);
      const gap = size * 0.13, x0 = (w - 4 * size - 3 * gap) / 2, y0 = (h - size) / 2;
      const on = Math.floor((t % 4) / 1);
      for (let k = 0; k < 4; k++) {
        const lift = k === on ? size * 0.08 : 0;
        drawSymbolTile(ctx, x0 + k * (size + gap), y0 - lift, size, false, k, 'placed');
      }
    },
  },
  {
    title: 'Spin up, spin down',
    text: 'On the bigger grids each orbital comes twice: a deep tile with an up arrow and a pale tile with a down arrow. They count as different symbols.',
    demo: (ctx, w, h, t) => {
      const size = Math.min((w * 0.86) / 2.3, h * 0.7);
      const gap = size * 0.3, x0 = (w - 2 * size - gap) / 2, y0 = (h - size) / 2;
      // Each orbital's pair in turn.
      const o = Math.floor((t % 6) / 1.5);
      drawSymbolTile(ctx, x0, y0, size, true, o * 2, 'placed');
      drawSymbolTile(ctx, x0 + size + gap, y0, size, true, o * 2 + 1, 'placed');
    },
  },
  {
    title: 'Drag from a stack',
    text: 'Drag a symbol from its stack onto a cell. Stacks never run out, and the cell lights up where it will land.',
    demo: (ctx, w, h, t) => {
      const T = t % 3.2;
      const c = Math.min(w / 4.6, h / 2.6);
      const x0 = (w - 4 * c) / 2, y0 = h * 0.06;
      const row = [1, EMPTY, 3, 0];
      const placed = T > 2.1;
      demoCells(ctx, x0, y0, c, 4, false, placed ? [1, 2, 3, 0] : row, [true, false, true, true]);
      const k = c * 0.95, countH = Math.max(11, c * 0.3);
      const kx = w / 2 - k / 2, ky = y0 + c + h * 0.08;
      drawStack(ctx, kx, ky, k, countH, false, 2, placed ? 3 : 4, false);
      const target = cellBox(x0, y0, c, 4, 1);
      if (T > 0.4 && T < 2.1) {
        const m = smooth(Math.min(1, (T - 0.6) / 1.2));
        const fx = lerp(kx + k / 2, target.x + target.w / 2, m), fy = lerp(ky + k / 2 + c * 0.6, target.y + target.w / 2 + c * 0.7, m);
        if (m > 0.75) {
          ctx.save();
          ctx.globalAlpha = 0.22;
          tile(ctx, target.x - 2, target.y - 2, target.w + 4, target.w + 4, target.w * 0.3, C.accent);
          ctx.restore();
          tile(ctx, target.x - 2, target.y - 2, target.w + 4, target.w + 4, target.w * 0.3, null, C.accent, 2);
        }
        const gs = c * 0.84;
        drawSymbolTile(ctx, fx - gs / 2, fy - c * 0.7 - gs / 2, gs, false, 2, 'placed', 0.95);
        finger(ctx, fx, fy, c * 0.28, true);
      } else if (T <= 0.4) finger(ctx, kx + k / 2, ky + k / 2 + c * 0.6, c * 0.28, false);
    },
  },
  {
    title: 'Or tap',
    text: 'Tap a cell to choose it, then tap a stack. Tap the cell again to step it through the symbols.',
    demo: (ctx, w, h, t) => {
      const T = t % 3.6;
      const c = Math.min(w / 4.6, h / 2.6);
      const x0 = (w - 4 * c) / 2, y0 = h * 0.06;
      const sym = T < 1.6 ? EMPTY : T < 2.6 ? 1 : 2;
      demoCells(ctx, x0, y0, c, 4, false, [0, sym, 3, EMPTY], [true, false, true, false]);
      const cell = cellBox(x0, y0, c, 4, 1);
      if (T > 0.5) tile(ctx, cell.x - 2, cell.y - 2, cell.w + 4, cell.w + 4, cell.w * 0.3, null, C.accent, 2);
      const k = c * 0.85, countH = Math.max(11, c * 0.3);
      const sx = (w - 4 * (k + c * 0.15)) / 2, ky = y0 + c + h * 0.08;
      for (let s = 0; s < 4; s++) drawStack(ctx, sx + s * (k + c * 0.15), ky, k, countH, false, s, 2, sym === s);
      // Tap the cell, tap the p stack, then tap the cell again.
      const taps: [number, number, number][] = [[0.3, cell.x + cell.w / 2, cell.y + cell.w / 2], [1.3, sx + 1 * (k + c * 0.15) + k / 2, ky + k / 2], [2.3, cell.x + cell.w / 2, cell.y + cell.w / 2]];
      for (const [at, fx, fy] of taps) if (T > at && T < at + 0.45) finger(ctx, fx, fy, c * 0.26, T < at + 0.25);
    },
  },
  {
    title: 'Counts',
    text: 'The number under each stack is how many more of that symbol the grid needs. At 0 the stack dims: that symbol is done.',
    demo: (ctx, w, h, t) => {
      const T = t % 4;
      const left = T < 1 ? 2 : T < 2 ? 1 : 0;
      const k = Math.min(w * 0.36, h * 0.62), countH = Math.max(12, k * 0.3);
      const x = w * 0.18, y = (h - k - countH) / 2;
      drawStack(ctx, x, y, k, countH, false, 1, left, false);
      // The tiles already out on the board, beside the stack.
      const c = k * 0.5, bx = w * 0.62, by = y + 2;
      for (let i = 0; i < 4; i++) {
        const yy = by + (i % 2) * c * 1.1, xx = bx + Math.floor(i / 2) * c * 1.1;
        if (i < 4 - left) drawSymbolTile(ctx, xx, yy, c, false, 1, i < 2 ? 'given' : 'placed');
        else drawEmpty(ctx, xx, yy, c, c * 0.14);
      }
    },
  },
  {
    title: 'Dealt tiles',
    text: 'Squarer tiles with a fine frame were dealt and never change. Your tiles are rounder: drag one to move it, or off the board to clear it.',
    demo: (ctx, w, h, t) => {
      const T = t % 3.4;
      const c = Math.min(w / 3.6, h / 1.9);
      const x0 = (w - 3 * c) / 2, y0 = h * 0.12;
      const gone = T > 2.2;
      demoCells(ctx, x0, y0, c, 3, false, [3, gone ? EMPTY : 0, 1], [true, false, true]);
      const cell = cellBox(x0, y0, c, 3, 1);
      if (T > 0.6 && T <= 2.2) {
        // Lift the placed tile and carry it off the board.
        drawEmpty(ctx, cell.x, cell.y, cell.w, cell.w * 0.14);
        const m = smooth(Math.min(1, (T - 0.7) / 1.3));
        const fx = cell.x + cell.w / 2 + m * c * 0.2, fy = cell.y + cell.w / 2 + c * 0.7 + m * (h - cell.y - cell.w / 2 - c);
        ctx.save();
        ctx.globalAlpha = 1 - m * 0.8;
        drawSymbolTile(ctx, fx - cell.w / 2, fy - c * 0.7 - cell.w / 2, cell.w, false, 0, 'placed');
        ctx.restore();
        finger(ctx, fx, fy, c * 0.24, true);
      }
    },
  },
  {
    title: 'Keyboard',
    text: 'Arrow keys move the cyan cursor; 1-8 or s p d f place a symbol (press a letter twice for spin down), and Backspace clears.',
    demo: (ctx, w, h, t) => {
      const T = t % 4;
      const c = Math.min(w / 4.4, h / 1.5);
      const x0 = (w - 4 * c) / 2, y0 = (h - c) / 2;
      // The cursor steps right, then p, then p again for spin down.
      const at = T < 0.8 ? 0 : 1;
      const v = T < 1.6 || at === 0 ? EMPTY : T < 2.6 ? 2 : 3;
      demoCells(ctx, x0, y0, c, 4, true, [EMPTY, v, 0, 5], [false, false, true, true]);
      const b = cellBox(x0, y0, c, 4, at);
      tile(ctx, b.x - 2, b.y - 2, b.w + 4, b.w + 4, b.w * 0.3, null, C.accent, 2);
    },
  },
  {
    title: 'Clashes',
    text: 'A tile whose symbol already sits in its row, column or block gets an amber ring. Move it or change it.',
    demo: (ctx, w, h, t) => {
      const T = t % 4;
      const c = Math.min(w / 4.4, h / 1.5);
      const x0 = (w - 4 * c) / 2, y0 = (h - c) / 2;
      // First a clashing p↑, then the right p↓.
      const v = T < 0.6 ? EMPTY : T < 2.8 ? 2 : 3;
      demoCells(ctx, x0, y0, c, 4, true, [2, 0, v, 1], [true, true, false, true]);
      if (v === 2) {
        const a = cellBox(x0, y0, c, 4, 2);
        drawClash(ctx, a.x, a.y, a.w, a.w * 0.3);
      }
    },
  },
];
