// Drawing and touch for Sliding Block: drag a piece along its track (it
// follows the finger up to whatever stops it, then snaps to the nearest cell);
// the red key bar leaves through the gap in the right wall.

import { applySlide, cellsOf, reach, solved, type Block, type Reach, type SlidingState } from './sliding';
import { C, fitGrid, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView, type RuleCard } from './view';

const SNAP_MS = 140;
const EXIT_MS = 520;
/** Pixels a free block's drag must travel before its axis is chosen. */
const AXIS_PX = 6;
/** Extra board width, in cells, kept free right of the board for the exit marker and the leaving key bar, and left of it for balance. */
const LANE = 0.7;
const LEFT = 0.15;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Sliding Block builds the nucleus of every element past iron (z 27 to 118). The board is 6 by 6, with one extra row from z 106. Par is the solver's fewest moves for the deal: about 4 at cobalt rising steadily to about 21 at the end of the table, and finishing within par counts as clean. Walls appear from z 45 (two from z 92), loose round pieces from z 75. Below z 60 each board is dealt fresh: the generator deals boards around a solved position, explores every position each one can reach and starts you from the one farthest from any solution. From z 60 it starts from a bank of deep boards found offline the same way, flips it at random and remixes it with a few changes that keep it deep enough, so every deal is different.</p>`;

interface Drag {
  id: number;
  start: Point;
  /** Cells pulled so far along the chosen axis (fractional, clamped to the slack). */
  offset: number;
  /** Null until a free block's drag picks a direction. */
  horiz: boolean | null;
  r: Reach;
}

interface Snap { id: number; horiz: boolean; from: number; at: number }

export class SlidingView implements PuzzleView {
  private state: SlidingState;
  private history: SlidingState[] = [];
  private drag: Drag | null = null;
  private snap: Snap | null = null;
  private selected = 0;
  /** The selection ring shows once the keyboard has been used. */
  private keyboard = false;
  private wonAt = 0;
  private reduced: boolean;
  private cell = 0;
  private origin: Point = { x: 0, y: 0 };

  constructor(private readonly initial: SlidingState, reducedMotion: boolean) {
    this.state = initial;
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'The key bar is out';
    const n = this.blockers();
    return n === 0 ? 'The way is clear' : `${n} in the key bar's way`;
  }

  /** Pieces and walls between the key bar and the exit. */
  private blockers(): number {
    const s = this.state, key = s.blocks[0];
    const seen = new Set<number>();
    for (let x = key.x + key.len; x < s.w; x++) {
      const i = s.exitRow * s.w + x;
      if (s.walls.includes(i)) seen.add(-1 - i);
      for (const b of s.blocks) if (cellsOf(b).some((c) => c.x === x && c.y === s.exitRow)) seen.add(b.id);
    }
    return seen.size;
  }

  restart(): void {
    this.state = this.initial;
    this.history = [];
    this.drag = null;
    this.snap = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.drag = null;
    this.snap = null;
    return true;
  }

  private commit(next: SlidingState): void {
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    if (solved(next)) this.wonAt = performance.now();
  }

  private blockAt(p: Point): Block | null {
    if (!this.cell) return null;
    const cx = (p.x - this.origin.x) / this.cell, cy = (p.y - this.origin.y) / this.cell;
    for (const b of this.state.blocks) {
      if (cellsOf(b).some((c) => cx >= c.x && cx < c.x + 1 && cy >= c.y && cy < c.y + 1)) return b;
    }
    return null;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void {
    if (this.won) return;
    const b = this.blockAt(p);
    if (!b) return;
    this.selected = b.id;
    this.snap = null;
    this.drag = { id: b.id, start: p, offset: 0, horiz: b.free ? null : b.horiz, r: reach(this.state, b.id) };
  }

  move(p: Point): void {
    const d = this.drag;
    if (!d) return;
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (d.horiz === null) {
      if (Math.hypot(dx, dy) < AXIS_PX) return;
      d.horiz = Math.abs(dx) >= Math.abs(dy);
    }
    const raw = (d.horiz ? dx : dy) / this.cell;
    const back = d.horiz ? d.r.left : d.r.up, fwd = d.horiz ? d.r.right : d.r.down;
    // Past a stop the piece leans a little further, so the limit is felt rather than hit.
    const over = (v: number) => Math.sign(v) * Math.min(0.12, Math.abs(v) * 0.15);
    d.offset = raw < -back ? -back + over(raw + back) : raw > fwd ? fwd + over(raw - fwd) : raw;
  }

  up(p: Point): void {
    const d = this.drag;
    if (!d) return;
    this.move(p);
    this.drag = null;
    if (d.horiz === null) return;
    const back = d.horiz ? d.r.left : d.r.up, fwd = d.horiz ? d.r.right : d.r.down;
    const by = Math.max(-back, Math.min(fwd, Math.round(d.offset)));
    this.snap = { id: d.id, horiz: d.horiz, from: d.offset - by, at: performance.now() };
    if (by === 0) return;
    const next = applySlide(this.state, { id: d.id, dx: d.horiz ? by : 0, dy: d.horiz ? 0 : by });
    if (next) this.commit(next);
  }

  cancel(): void {
    const d = this.drag;
    this.drag = null;
    if (d && d.horiz !== null) this.snap = { id: d.id, horiz: d.horiz, from: d.offset, at: performance.now() };
  }

  key(e: KeyboardEvent): boolean {
    if (this.won) return false;
    const n = this.state.blocks.length;
    if (e.key === 'Tab' || e.key.startsWith('Arrow')) this.keyboard = true;
    if (e.key === 'Tab') {
      e.preventDefault();
      this.selected = (this.selected + (e.shiftKey ? n - 1 : 1)) % n;
      return true;
    }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const v = dirs[e.key];
    if (!v) return false;
    const next = applySlide(this.state, { id: this.selected, dx: v[0], dy: v[1] });
    if (next) {
      this.snap = { id: this.selected, horiz: v[0] !== 0, from: -(v[0] || v[1]), at: performance.now() };
      this.commit(next);
    }
    return true;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const fit = fitGrid(area, s.w + LANE + LEFT, s.h, { margin: 8, maxCell: 72 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x + LEFT * c, y: fit.y };
    const { x: x0, y: y0 } = this.origin;
    const W = s.w * c, H = s.h * c;

    drawTray(ctx, x0, y0, s.w, s.h, c, s.exitRow, LANE);

    for (const i of s.walls) drawWall(ctx, x0 + (i % s.w) * c, y0 + Math.floor(i / s.w) * c, c);

    const exitT = this.won ? (this.reduced ? 1 : ease((now - this.wonAt) / EXIT_MS)) : 0;
    for (const b of s.blocks) {
      let ox = 0, oy = 0;
      const d = this.drag;
      if (d && d.id === b.id && d.horiz !== null) {
        if (d.horiz) ox = d.offset; else oy = d.offset;
      } else if (this.snap && this.snap.id === b.id && !this.reduced) {
        const t = (now - this.snap.at) / SNAP_MS;
        const off = t < 1 ? this.snap.from * (1 - ease(t)) : 0;
        if (this.snap.horiz) ox = off; else oy = off;
        if (t >= 1) this.snap = null;
      }
      const bx = x0 + (b.x + ox) * c, by = y0 + (b.y + oy) * c;
      if (b.id === 0 && this.won) {
        // The key bar slides out through the gap, clipped at the edge of the lane.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, W + LANE * c, H);
        ctx.clip();
        ctx.globalAlpha = 1 - exitT;
        drawBlock(ctx, b, bx + exitT * (b.len + LANE) * c, by, c, false);
        ctx.restore();
        continue;
      }
      const active = !this.won && (d ? d.id === b.id : this.selected === b.id && this.keyboard);
      drawBlock(ctx, b, bx, by, c, active);
    }
  }


}

/** The tray: a plate with faint cell sockets, a frame broken at the exit and a red chevron just outside the gap. */
export function drawTray(ctx: CanvasRenderingContext2D, x0: number, y0: number, cols: number, rows: number, c: number, exitRow: number, lane: number): void {
  const W = cols * c, H = rows * c;
  const rad = c * 0.18;
  tile(ctx, x0, y0, W, H, rad, C.surface);
  ctx.save();
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < cols * rows; i++) {
    tile(ctx, x0 + (i % cols) * c + c * 0.12, y0 + Math.floor(i / cols) * c + c * 0.12, c * 0.76, c * 0.76, c * 0.14, null, C.line, 1);
  }
  ctx.restore();
  const ey = y0 + exitRow * c;
  ctx.save();
  ctx.strokeStyle = C.line3;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0 + W, ey);
  ctx.lineTo(x0 + W, y0 + rad);
  ctx.arcTo(x0 + W, y0, x0 + W - rad, y0, rad);
  ctx.arcTo(x0, y0, x0, y0 + rad, rad);
  ctx.arcTo(x0, y0 + H, x0 + rad, y0 + H, rad);
  ctx.arcTo(x0 + W, y0 + H, x0 + W, y0 + H - rad, rad);
  ctx.lineTo(x0 + W, ey + c);
  ctx.stroke();
  const mx = x0 + W + lane * c * 0.45, my = ey + c / 2, mk = c * 0.13;
  ctx.strokeStyle = C.target;
  ctx.lineWidth = Math.max(1.5, c * 0.045);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(mx - mk * 0.6, my - mk);
  ctx.lineTo(mx + mk * 0.4, my);
  ctx.lineTo(mx - mk * 0.6, my + mk);
  ctx.stroke();
  ctx.restore();
}

/** A wall cell: a hatched square. */
export function drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, c: number): void {
  const g = c * 0.06;
  tile(ctx, x + g, y + g, c - 2 * g, c - 2 * g, c * 0.1, C.surface3, C.line2, 1);
  hatch(ctx, x + g, y + g, c - 2 * g, c * 0.22);
}

/** A piece: a bar with a groove along its axis (the key bar red, with a chevron), or a round loose piece with a four-way mark. */
export function drawBlock(ctx: CanvasRenderingContext2D, b: Block, x: number, y: number, c: number, active: boolean): void {
  const g = c * 0.07;
  const key = b.id === 0;
  if (b.free) {
    // A loose piece: a round tile with a small four-way mark.
    const cx = x + c / 2, cy = y + c / 2, r = c / 2 - g;
    ctx.fillStyle = C.silverDim;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    if (active) { ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = C.tileInk;
    ctx.lineWidth = Math.max(1, c * 0.035);
    const k = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(cx - k, cy); ctx.lineTo(cx + k, cy);
    ctx.moveTo(cx, cy - k); ctx.lineTo(cx, cy + k);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const w = (b.horiz ? b.len : 1) * c - 2 * g, h = (b.horiz ? 1 : b.len) * c - 2 * g;
  const bx = x + g, by = y + g;
  tile(ctx, bx, by, w, h, c * 0.18, key ? C.target : C.tile, active ? C.accent : null, 2);
  // A groove along the bar shows which way it slides.
  ctx.save();
  ctx.globalAlpha = key ? 0.5 : 0.28;
  ctx.strokeStyle = C.tileInk;
  ctx.lineWidth = Math.max(1.5, c * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const inset = c * 0.32;
  if (b.horiz) { ctx.moveTo(bx + inset, by + h / 2); ctx.lineTo(bx + w - inset, by + h / 2); }
  else { ctx.moveTo(bx + w / 2, by + inset); ctx.lineTo(bx + w / 2, by + h - inset); }
  ctx.stroke();
  if (key) {
    // The key bar points the way out.
    const tx = bx + w - inset * 0.55, ty = by + h / 2, k = c * 0.1;
    ctx.beginPath();
    ctx.moveTo(tx - k, ty - k);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - k, ty + k);
    ctx.stroke();
  }
  ctx.restore();
}

/** Fine diagonal hatching inside a square, computed to stay inside it. */
function hatch(ctx: CanvasRenderingContext2D, x0: number, y0: number, side: number, step: number): void {
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let t = step; t < side * 2; t += step) {
    ctx.moveTo(x0 + Math.max(0, t - side), y0 + Math.min(t, side));
    ctx.lineTo(x0 + Math.min(t, side), y0 + Math.max(0, t - side));
  }
  ctx.stroke();
}

// ---- rules ------------------------------------------------------------------------

/** Fits a cols x rows tray (with the exit lane) in a demo box; returns the cell size and the tray's top left. */
function demoTray(w: number, h: number, cols: number, rows: number): { c: number; x: number; y: number } {
  const c = Math.min((w * 0.9) / (cols + LANE + LEFT), (h * 0.88) / rows);
  return { c, x: (w - (cols + LANE + LEFT) * c) / 2 + LEFT * c, y: (h - rows * c) / 2 };
}

const bar = (id: number, x: number, y: number, len: number, horiz: boolean): Block => ({ id, x, y, len, horiz, free: false });

/** 0 to 1 and back over a loop: rest, go, rest, return. */
function shuttle(T: number, loop: number): number {
  const k = (T % loop) / loop;
  return k < 0.15 ? 0 : k < 0.4 ? ease((k - 0.15) / 0.25) : k < 0.65 ? 1 : k < 0.9 ? 1 - ease((k - 0.65) / 0.25) : 0;
}

/** The key bar leaving through the gap into the lane, fading as it goes. */
function keyOut(ctx: CanvasRenderingContext2D, x0: number, y0: number, cols: number, rows: number, c: number, key: Block, k: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, (cols + LANE) * c, rows * c);
  ctx.clip();
  ctx.globalAlpha = 1 - k;
  drawBlock(ctx, key, x0 + (key.x + k * LANE) * c, y0 + key.y * c, c, false);
  ctx.restore();
}

export const RULES: RuleCard[] = [
  {
    title: 'The key bar',
    text: 'Get the red key bar out through the gap in the right wall, marked by a red chevron.',
    demo: (ctx, w, h, t) => {
      const T = t % 3.2;
      const cols = 4, rows = 2, { c, x, y } = demoTray(w, h, cols, rows);
      drawTray(ctx, x, y, cols, rows, c, 0, LANE);
      drawBlock(ctx, bar(1, 1, 1, 3, true), x + c, y + c, c, false);
      const key = bar(0, 0, 0, 2, true);
      if (T < 1.6) drawBlock(ctx, key, x + ease(Math.max(0, (T - 0.5) / 0.6)) * 2 * c, y, c, T > 0.5 && T < 1.1);
      else if (T < 2.4) keyOut(ctx, x, y, cols, rows, c, { ...key, x: 2 }, ease((T - 1.6) / 0.8));
    },
  },
  {
    title: 'Bars slide lengthwise',
    text: 'Drag a bar along its length: bars lying across slide left and right, standing bars slide up and down. One slide is one move, however far it goes.',
    demo: (ctx, w, h, t) => {
      const cols = 5, rows = 3, { c, x, y } = demoTray(w, h, cols, rows);
      drawTray(ctx, x, y, cols, rows, c, 0, LANE);
      const a = shuttle(t, 4), b = shuttle(t + 2, 4);
      drawBlock(ctx, bar(1, 0, 2, 2, true), x + a * 2 * c, y + 2 * c, c, a > 0 && a < 1);
      drawBlock(ctx, bar(2, 4, 0, 2, false), x + 4 * c, y + b * c, c, b > 0 && b < 1);
    },
  },
  {
    title: 'Walls',
    text: 'Hatched squares are walls. They never move, and nothing slides through them.',
    demo: (ctx, w, h, t) => {
      const T = t % 3;
      const cols = 4, rows = 2, { c, x, y } = demoTray(w, h, cols, rows);
      drawTray(ctx, x, y, cols, rows, c, 0, LANE);
      drawWall(ctx, x + 3 * c, y + c, c);
      // Pulled hard to the right, the bar stops at the wall and leans a little.
      const k = T < 0.4 ? 0 : T < 1.2 ? ease((T - 0.4) / 0.8) * 1.12 : T < 1.6 ? 1.12 : T < 1.8 ? 1.12 - 0.12 * ease((T - 1.6) / 0.2) : T < 2.4 ? 1 - ease((T - 1.8) / 0.6) : 0;
      drawBlock(ctx, bar(1, 0, 1, 2, true), x + k * c, y + c, c, T > 0.4 && T < 1.6);
    },
  },
  {
    title: 'Loose pieces',
    text: 'Round pieces are loose: they slide any of the four ways, one way per move.',
    demo: (ctx, w, h, t) => {
      const cols = 3, rows = 3, { c, x, y } = demoTray(w, h, cols, rows);
      drawTray(ctx, x, y, cols, rows, c, 1, LANE);
      // Round the edge: right, down, left, up.
      const T = (t % 4) / 4, side = Math.floor(T * 4), k = ease(Math.min(1, ((T * 4) % 1) / 0.6));
      const corners = [[0, 0], [2, 0], [2, 2], [0, 2]];
      const [ax, ay] = corners[side], [bx, by] = corners[(side + 1) % 4];
      drawWall(ctx, x + c, y + c, c);
      const loose: Block = { id: 1, x: 0, y: 0, len: 1, horiz: true, free: true };
      drawBlock(ctx, loose, x + (ax + (bx - ax) * k) * c, y + (ay + (by - ay) * k) * c, c, k > 0 && k < 1);
    },
  },
  {
    title: 'Clear the way',
    text: 'Slide whatever stands in the key bar\'s row out of its way, then drag the key bar to the gap and it slides out.',
    demo: (ctx, w, h, t) => {
      const T = t % 5;
      const cols = 4, rows = 4, { c, x, y } = demoTray(w, h, cols, rows);
      drawTray(ctx, x, y, cols, rows, c, 1, LANE);
      const down = T < 0.5 ? 0 : T < 1.1 ? ease((T - 0.5) / 0.6) * 2 : T < 4.4 ? 2 : 2 - ease((T - 4.4) / 0.5) * 2;
      drawBlock(ctx, bar(1, 2, 0, 2, false), x + 2 * c, y + down * c, c, T > 0.5 && T < 1.1);
      const key = bar(0, 0, 1, 2, true);
      if (T < 2.1) drawBlock(ctx, key, x + ease(Math.max(0, (T - 1.5) / 0.6)) * 2 * c, y + c, c, T > 1.5);
      else if (T < 2.9) keyOut(ctx, x, y, cols, rows, c, { ...key, x: 2 }, ease((T - 2.1) / 0.8));
      else if (T > 4.4) {
        ctx.save();
        ctx.globalAlpha = ease((T - 4.4) / 0.5);
        drawBlock(ctx, key, x, y + c, c, false);
        ctx.restore();
      }
    },
  },
  {
    title: 'Keyboard',
    text: 'Tab picks a piece, ringed in cyan; the arrow keys slide it one cell.',
    demo: (ctx, w, h, t) => {
      const T = t % 4;
      const cols = 4, rows = 3, { c, x, y } = demoTray(w, h, cols, rows);
      drawTray(ctx, x, y, cols, rows, c, 1, LANE);
      const pick = T < 1.2 ? 0 : 1;
      const shift = pick === 1 ? (T < 1.8 ? 0 : T < 2.1 ? ease((T - 1.8) / 0.3) : T < 3.4 ? 1 : 1 - ease((T - 3.4) / 0.3)) : 0;
      drawBlock(ctx, bar(0, 0, 1, 2, true), x, y + c, c, pick === 0);
      drawBlock(ctx, bar(1, 3, 0, 2, false), x + 3 * c, y + shift * c, c, pick === 1);
    },
  },
];
