// Drawing and touch for Sliding Block: drag a piece along its track (it
// follows the finger up to whatever stops it, then snaps to the nearest cell);
// the red key bar leaves through the gap in the right wall.

import { applySlide, cellsOf, reach, slidingPath, solved, type Block, type Reach, type SlideMove, type SlidingState } from './sliding';
import { C, fitGrid, tile } from './palette';
import { drawFrame, frameBox, frameWidth, framePad } from './frame';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Point, type PuzzleView, type RuleCard } from './view';

const SNAP_MS = 140;
const EXIT_MS = 520;
/** Pixels a free block's drag must travel before its axis is chosen. */
const AXIS_PX = 6;
/** Board width, in cells, kept free each side of the cells for the frame; the key bar leaves through the frame's gap. */
const LANE = 0.3;
const LEFT = 0.3;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Nova builds the nucleus of every element past iron (z 27 to 118). The board is 6 by 6, with one extra row from z 106. Par is the solver's fewest moves for the deal: about 4 at cobalt rising steadily to about 21 at the end of the table, and finishing within par counts as clean. Walls appear from z 45 (two from z 92), loose round pieces from z 75. Below z 60 each board is dealt fresh: the generator deals boards around a solved position, explores every position each one can reach and starts you from the one farthest from any solution. From z 60 it starts from a bank of deep boards found offline the same way, flips it at random and remixes it with a few changes that keep it deep enough, so every deal is different.</p>`;

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
  /** Look here: the piece to move next, for the board it was asked on. */
  private mark: { state: SlidingState; id: number } | null = null;

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

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (this.won) return null;
    const path = slidingPath(s);
    // Slides can always be slid back, so a dealt board never stops being solvable; this is only a safety net.
    if (!path) return this.backOnTrack();
    const m = path[0];
    const b = s.blocks.find((x) => x.id === m.id)!;
    const way = m.dx < 0 ? 'left' : m.dx > 0 ? 'right' : m.dy < 0 ? 'up' : 'down';
    const by = Math.abs(m.dx || m.dy);
    const what = m.id === 0 ? 'key bar' : b.free ? 'block' : 'bar';
    if (level === 2) {
      this.selected = m.id;
      this.play(m);
      if (this.won) return { text: 'Slid the key bar out through the gap.', moved: true };
      return { text: `Slid ${m.id === 0 ? 'the' : 'a'} ${what} ${way} ${by === 1 ? 'one cell' : `${by} cells`}.`, moved: true };
    }
    this.mark = { state: s, id: m.id };
    this.selected = m.id;
    if (m.id === 0 && path.length === 1) return { text: 'The way is clear, so slide the key bar out.' };
    return { text: `Slide this ${what} ${way} next.` };
  }

  /** The fewest undos back to a board that can still be solved. */
  private backOnTrack(): Help | null {
    const h = this.history;
    for (let n = 1; n <= h.length; n++) if (slidingPath(h[h.length - n])) return undoHelp(n);
    return null;
  }

  restart(): void {
    this.state = this.initial;
    this.history = [];
    this.mark = null;
    this.drag = null;
    this.snap = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.drag = null;
    // Undo hands back the very board a Look here may have been asked on; the mark stays cleared.
    this.mark = null;
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
    this.play({ id: this.selected, dx: v[0], dy: v[1] });
    return true;
  }

  /** One slide from the keyboard or Show me: the piece glides from where it was. */
  private play(m: SlideMove): void {
    const next = applySlide(this.state, m);
    if (!next) return;
    this.snap = { id: m.id, horiz: m.dx !== 0, from: -(m.dx || m.dy), at: performance.now() };
    this.commit(next);
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const fit = fitGrid(area, s.w + LANE + LEFT, s.h + LANE + LEFT, { margin: 6, maxCell: 88 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x + LEFT * c, y: fit.y + LEFT * c };
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
        // The key bar slides out through the gap and fades past the frame.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, W + (LANE + 1) * c, H);
        ctx.clip();
        ctx.globalAlpha = 1 - exitT;
        drawBlock(ctx, b, bx + exitT * (b.len + LANE) * c, by, c, false);
        ctx.restore();
        continue;
      }
      const active = !this.won && (d ? d.id === b.id : this.selected === b.id && this.keyboard);
      drawBlock(ctx, b, bx, by, c, active);
    }

    // Look here: the piece to move next, until the board changes.
    if (this.mark?.state === s && !this.won && !this.drag) {
      const b = s.blocks.find((x) => x.id === this.mark!.id)!, g = c * 0.07;
      const bw = (!b.free && b.horiz ? b.len : 1) * c - 2 * g, bh = (!b.free && !b.horiz ? b.len : 1) * c - 2 * g;
      drawHelpMark(ctx, x0 + b.x * c + g, y0 + b.y * c + g, bw, bh, now, this.reduced, b.free ? bw / 2 : c * 0.18);
    }
  }


}

/** The tray: the shared board frame, with a gap at the exit row marked by a small red dot, and
 *  a faint dot at the center of every cell. */
export function drawTray(ctx: CanvasRenderingContext2D, x0: number, y0: number, cols: number, rows: number, c: number, exitRow: number, _lane = LANE): void {
  const W = cols * c, H = rows * c;
  ctx.save();
  ctx.fillStyle = C.surface2;
  const dr = Math.max(1.5, c * 0.035);
  for (let i = 0; i < cols * rows; i++) {
    ctx.beginPath();
    ctx.arc(x0 + (i % cols + 0.5) * c, y0 + (Math.floor(i / cols) + 0.5) * c, dr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const lw = frameWidth(c);
  const box = frameBox(x0, y0, W, H, c);
  drawFrame(ctx, box, {
    width: lw,
    radius: c * 0.2 + framePad(c),
    gaps: [{ side: 'right', at: y0 + (exitRow + 0.5) * c, size: c * 0.8, dot: C.target }],
  });
}

/** A wall cell: a solid square in the frame's color, part of the board itself. */
export function drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, c: number): void {
  const g = c * 0.07;
  tile(ctx, x + g, y + g, c - 2 * g, c - 2 * g, c * 0.18, C.frame);
}

/** A piece: a bar with a groove along its axis (the key bar red), or a round loose piece with a four-way mark. */
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
  ctx.restore();
}

// ---- rules ------------------------------------------------------------------------
//
// Each rule's pictures are stills of their last frame until the player taps Play. A move leaves
// a faint copy of the piece where it started and a thin arrow to where it went, so the still
// says what happened; what cannot happen is flagged in amber.

/** Fits a cols x rows tray (with the exit lane) in a demo box; returns the cell size and the tray's top left. */
function demoTray(w: number, h: number, cols: number, rows: number): { c: number; x: number; y: number } {
  const c = Math.min((w * 0.9) / (cols + LANE + LEFT), (h * 0.9) / (rows + LANE + LEFT));
  return { c, x: (w - (cols + LANE + LEFT) * c) / 2 + LEFT * c, y: (h - rows * c) / 2 };
}

type Tray = { c: number; x: number; y: number };

const bar = (id: number, x: number, y: number, len: number, horiz: boolean): Block => ({ id, x, y, len, horiz, free: false });
const loose = (x: number, y: number): Block => ({ id: 1, x, y, len: 1, horiz: true, free: true });

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Progress through [a, b] seconds, eased. */
const seg = (t: number, a: number, b: number) => ease(clamp01((t - a) / (b - a)));

/** A piece at cell (bx, by), possibly between cells. */
function piece(ctx: CanvasRenderingContext2D, T: Tray, b: Block, bx = b.x, by = b.y, active = false): void {
  drawBlock(ctx, b, T.x + bx * T.c, T.y + by * T.c, T.c, active);
}

/** Where a piece started: a faint copy. */
function ghost(ctx: CanvasRenderingContext2D, T: Tray, b: Block): void {
  ctx.save();
  ctx.globalAlpha = 0.22;
  piece(ctx, T, b);
  ctx.restore();
}

/** The center of a piece's footprint at cell (bx, by). */
function mid(T: Tray, b: Block, bx = b.x, by = b.y): { x: number; y: number } {
  const w = b.free || !b.horiz ? 1 : b.len, h = b.free || b.horiz ? 1 : b.len;
  return { x: T.x + (bx + w / 2) * T.c, y: T.y + (by + h / 2) * T.c };
}

/** A thin arrow for a move made, from one point to another. */
function trail(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string = C.line3, alpha = 1): void {
  if (alpha <= 0) return;
  const a = Math.atan2(y2 - y1, x2 - x1), hd = 4;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.moveTo(x2 - hd * Math.cos(a - 0.6), y2 - hd * Math.sin(a - 0.6));
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - hd * Math.cos(a + 0.6), y2 - hd * Math.sin(a + 0.6));
  ctx.stroke();
  ctx.restore();
}

/** A way a piece cannot go: an amber arrow struck through. */
function noWay(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, alpha: number): void {
  if (alpha <= 0) return;
  trail(ctx, x1, y1, x2, y2, C.warn, alpha);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, k = 4;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mx - k, my - k); ctx.lineTo(mx + k, my + k);
  ctx.moveTo(mx + k, my - k); ctx.lineTo(mx - k, my + k);
  ctx.stroke();
  ctx.restore();
}

/** An amber outline around a piece's footprint at cell (bx, by): the piece that is stuck or in the way. */
function warnOutline(ctx: CanvasRenderingContext2D, T: Tray, b: Block, bx: number, by: number, alpha: number, dashed = false): void {
  if (alpha <= 0) return;
  const w = b.free || !b.horiz ? 1 : b.len, h = b.free || b.horiz ? 1 : b.len, g = T.c * 0.03;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (dashed) ctx.setLineDash([4, 3]);
  tile(ctx, T.x + bx * T.c + g, T.y + by * T.c + g, w * T.c - 2 * g, h * T.c - 2 * g, T.c * (b.free ? 0.5 : 0.2), null, C.warn, 2);
  ctx.restore();
}

/** Where a sliding piece hit something: a short amber bar on the face it met, along x = const or y = const. */
function stopLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** A fingertip dragging, while k runs from 0 to 1. */
function finger(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, k: number): void {
  if (k <= 0 || k >= 1) return;
  ctx.save();
  ctx.globalAlpha = 0.55 * Math.sin(Math.PI * k);
  ctx.fillStyle = C.silver;
  ctx.beginPath();
  ctx.arc(x1 + (x2 - x1) * ease(k), y1 + (y2 - y1) * ease(k), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The key bar on its way out through the gap, as the board draws it: clipped at the lane's end and fading. */
function keyOut(ctx: CanvasRenderingContext2D, T: Tray, cols: number, rows: number, key: Block, k: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(T.x, T.y, (cols + LANE + 0.15) * T.c, rows * T.c);
  ctx.clip();
  ctx.globalAlpha = 1 - 0.65 * k;
  piece(ctx, T, key, key.x + k * (LANE + 0.6));
  ctx.restore();
}

export const RULES: RuleCard[] = [
  {
    title: 'The key bar',
    text: 'Get the red key bar out through the gap in the frame, marked by a red dot.',
    good: {
      duration: 2.4,
      caption: 'Out through the gap',
      draw: (ctx, w, h, t) => {
        const cols = 4, rows = 2, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 0, LANE);
        piece(ctx, T, bar(1, 1, 1, 3, true));
        const key = bar(0, 0, 0, 2, true);
        ghost(ctx, T, key);
        const a = mid(T, key);
        trail(ctx, a.x, a.y, T.x + (cols + LANE * 0.9) * T.c, a.y, C.line3, seg(t, 0.3, 0.6));
        if (t < 1.1) piece(ctx, T, key, seg(t, 0.4, 1.0) * 2, 0, t > 0.4);
        else keyOut(ctx, T, cols, rows, { ...key, x: 2 }, seg(t, 1.1, 2.2) * 0.5);
      },
    },
  },
  {
    title: 'Bars slide lengthwise',
    text: 'Drag a bar along its length: bars lying across slide left and right, standing bars slide up and down. One slide is one move, however far it goes.',
    good: {
      duration: 2.4,
      caption: 'Along its length, any distance',
      draw: (ctx, w, h, t) => {
        const cols = 4, rows = 3, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 0, LANE);
        const lying = bar(1, 0, 2, 2, true), standing = bar(2, 0, 0, 2, false);
        ghost(ctx, T, lying);
        ghost(ctx, T, standing);
        const a = mid(T, lying), b = mid(T, lying, 2), c = mid(T, standing), d = mid(T, standing, 0, 1);
        trail(ctx, a.x, a.y, b.x, b.y, C.line3, seg(t, 1, 1.2));
        trail(ctx, c.x, c.y, d.x, d.y, C.line3, seg(t, 2, 2.2));
        const k1 = seg(t, 0.3, 0.9), k2 = seg(t, 1.3, 1.9);
        piece(ctx, T, lying, k1 * 2, 2, t > 0.3 && t < 0.95);
        piece(ctx, T, standing, 0, k2, t > 1.3 && t < 1.95);
      },
    },
    bad: {
      duration: 2,
      caption: 'Never sideways',
      draw: (ctx, w, h, t) => {
        const cols = 4, rows = 3, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 0, LANE);
        const lying = bar(1, 1, 1, 2, true);
        const c = mid(T, lying);
        // Tugged upward, it does not budge.
        piece(ctx, T, lying, 1, 1, t > 0.3 && t < 1.2);
        finger(ctx, c.x, c.y, c.x, c.y - T.c, (t - 0.3) / 0.9);
        warnOutline(ctx, T, lying, 1, 1, seg(t, 1.1, 1.4));
        noWay(ctx, c.x, c.y - T.c * 0.55, c.x, c.y - T.c * 1.4, seg(t, 1.1, 1.4));
      },
    },
  },
  {
    title: 'Walls',
    text: 'Solid gray squares are walls. They never move, and nothing slides through them.',
    good: {
      duration: 2,
      caption: 'It stops beside the wall',
      draw: (ctx, w, h, t) => {
        const cols = 4, rows = 2, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 0, LANE);
        drawWall(ctx, T.x + 3 * T.c, T.y + T.c, T.c);
        const b = bar(1, 0, 1, 2, true);
        ghost(ctx, T, b);
        const a = mid(T, b), z = mid(T, b, 1);
        trail(ctx, a.x, a.y, z.x, z.y, C.line3, seg(t, 1.1, 1.3));
        piece(ctx, T, b, seg(t, 0.3, 0.9), 1, t > 0.3 && t < 0.95);
      },
    },
    bad: {
      duration: 2.2,
      caption: 'Never through it',
      draw: (ctx, w, h, t) => {
        const cols = 4, rows = 2, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 0, LANE);
        drawWall(ctx, T.x + 3 * T.c, T.y + T.c, T.c);
        const b = bar(1, 1, 1, 2, true);
        // Pulled hard to the right, the bar leans into the wall and settles back.
        const lean = t < 0.3 ? 0 : t < 0.8 ? 0.12 * seg(t, 0.3, 0.8) : 0.12 * (1 - seg(t, 1.0, 1.25));
        piece(ctx, T, b, 1 + lean, 1, t > 0.3 && t < 1.2);
        finger(ctx, mid(T, b).x, mid(T, b).y, mid(T, b, 2.2).x, mid(T, b).y, (t - 0.3) / 0.8);
        const k = seg(t, 1.2, 1.5);
        warnOutline(ctx, T, b, 2, 1, k * 0.9, true);
        stopLine(ctx, T.x + 3 * T.c, T.y + T.c + T.c * 0.15, T.x + 3 * T.c, T.y + 2 * T.c - T.c * 0.15, k);
      },
    },
  },
  {
    title: 'Loose pieces',
    text: 'Round pieces are loose: they slide any of the four ways, one way per move.',
    good: {
      duration: 2.4,
      caption: 'Any of four ways, one per move',
      draw: (ctx, w, h, t) => {
        const cols = 3, rows = 3, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 1, LANE);
        drawWall(ctx, T.x + T.c, T.y + T.c, T.c);
        const p = loose(0, 0);
        ghost(ctx, T, p);
        const k1 = seg(t, 0.3, 0.8), k2 = seg(t, 1.1, 1.6);
        const a = mid(T, p), b = mid(T, p, 2, 0), c = mid(T, p, 2, 2);
        trail(ctx, a.x + T.c * 0.3, a.y, b.x - T.c * 0.3, b.y, C.line3, seg(t, 0.8, 1));
        trail(ctx, b.x, b.y + T.c * 0.3, c.x, c.y - T.c * 0.3, C.line3, seg(t, 1.6, 1.8));
        if (t > 0.8) { ctx.save(); ctx.globalAlpha = 0.22; piece(ctx, T, p, 2, 0); ctx.restore(); }
        piece(ctx, T, p, 2 * k1, 2 * k2, (t > 0.3 && t < 0.85) || (t > 1.1 && t < 1.65));
      },
    },
    bad: {
      duration: 2,
      caption: 'Never diagonally',
      draw: (ctx, w, h, t) => {
        const cols = 3, rows = 3, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 1, LANE);
        const p = loose(0, 0);
        const a = mid(T, p), z = mid(T, p, 1, 1);
        piece(ctx, T, p, 0, 0, t > 0.3 && t < 1.2);
        finger(ctx, a.x, a.y, z.x, z.y, (t - 0.3) / 0.8);
        const k = seg(t, 1.1, 1.4);
        warnOutline(ctx, T, p, 1, 1, k * 0.9, true);
        noWay(ctx, a.x + T.c * 0.3, a.y + T.c * 0.3, z.x - T.c * 0.3, z.y - T.c * 0.3, k);
      },
    },
  },
  {
    title: 'Clear the way',
    text: 'Slide whatever stands in the key bar\'s row out of its way, then drag the key bar to the gap and it slides out.',
    good: {
      duration: 3,
      caption: 'Out of its row, then the key leaves',
      draw: (ctx, w, h, t) => {
        const cols = 4, rows = 4, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 1, LANE);
        const blocker = bar(1, 3, 0, 2, false), key = bar(0, 0, 1, 2, true);
        ghost(ctx, T, blocker);
        const a = mid(T, blocker), b = mid(T, blocker, 3, 2);
        trail(ctx, a.x, a.y, b.x, b.y, C.line3, seg(t, 0.9, 1.1));
        piece(ctx, T, blocker, 3, 2 * seg(t, 0.3, 0.8), t > 0.3 && t < 0.85);
        if (t < 1.8) piece(ctx, T, key, 2 * seg(t, 1.2, 1.7), 1, t > 1.2);
        else keyOut(ctx, T, cols, rows, { ...key, x: 2 }, seg(t, 1.8, 2.8) * 0.5);
      },
    },
    bad: {
      duration: 2.4,
      caption: 'One cell down still blocks it',
      draw: (ctx, w, h, t) => {
        const cols = 4, rows = 4, T = demoTray(w, h, cols, rows);
        drawTray(ctx, T.x, T.y, cols, rows, T.c, 1, LANE);
        const blocker = bar(1, 3, 0, 2, false), key = bar(0, 0, 1, 2, true);
        ghost(ctx, T, blocker);
        const a = mid(T, blocker), b = mid(T, blocker, 3, 1);
        trail(ctx, a.x, a.y, b.x, b.y, C.line3, seg(t, 0.9, 1.1));
        piece(ctx, T, blocker, 3, seg(t, 0.3, 0.8), t > 0.3 && t < 0.85);
        piece(ctx, T, key, seg(t, 1.2, 1.6), 1, t > 1.2 && t < 1.7);
        const k = seg(t, 1.7, 2);
        warnOutline(ctx, T, blocker, 3, 1, k);
        stopLine(ctx, T.x + 3 * T.c, T.y + T.c * 1.15, T.x + 3 * T.c, T.y + T.c * 1.85, k);
      },
    },
  },
  {
    title: 'Keyboard',
    text: 'Tab picks a piece, ringed in cyan; the arrow keys slide it one cell.',
  },
];
