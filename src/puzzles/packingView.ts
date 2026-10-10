// Drawing and touch for Packing: drag pieces from the tray onto the outline,
// tap a piece to turn it, drag a placed piece to move it or off the board to
// lift it. At the top of the table a flip button mirrors the chosen piece.
// The board and the tray are laid out from the area alone (tray below on a
// tall area, beside on a wide one), and the tray scales its pieces down until
// they all fit, so nothing ever spills.

import { applyMove, bounds, canPlace, cellsLeft, cellsOf, clonePacking, occupancy, solved, type Cell, type PackingMove, type PackingState, type Piece } from './packing';
import { C, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView } from './view';

const TAP = 8;
const GLOW_MS = 520;
const SHAKE_MS = 240;
const MAX_CELL = 72;
const FLIP_SIZE = 44;

export const INSTRUCTIONS = `
<h3>How to play</h3>
<p>Fill every open cell of the dotted outline with pieces from the tray.</p>
<ul>
  <li><b>Drag a piece</b> onto the outline. A bright shadow shows exactly where it will land; it drops there when you let go. A red shadow means it will not fit there.</li>
  <li><b>Tap a piece</b> to turn it a quarter turn, in the tray or on the board.</li>
  <li><b>Hatched squares are already filled</b>: nothing goes on them.</li>
  <li>Drag a placed piece to move it, or drag it off the board to put it back in the tray.</li>
  <li>From the middle of the table <b>one piece in the tray is spare</b>: it fits nowhere in the answer. Work out which one to leave out.</li>
  <li>Near the end of the table some pieces arrive mirrored. Tap a piece to choose it, then the <b>flip button</b> beside the tray to mirror it left to right.</li>
</ul>
<p>Keyboard: Tab or 1 to 9 picks a piece, R or Space turns it, F flips it, Enter drops it on the first spot it fits, the arrows nudge it, Backspace lifts it.</p>
<h3>In the game</h3>
<p>Packing opens each element's isotope vault, and later isotopes rotate it with Merge and Sliding Block. It runs for every element, z 1 to 118.</p>
<p>The outline grows from 10 cells at hydrogen to 34 at the end of the table, on a grid of up to 7 by 7, and comes in four kinds: compact, mirror-symmetric, with a hole through it, and loose with arms (from z 50). Filled blocks arrive at z 12 (one), 40 (two) and 80 (three). The spare piece arrives at z 30 and is never the same shape as a real one. Flipping arrives at z 90.</p>
<p>Each level is carved from its own answer, so it is always solvable; other answers may exist and count too. Par is one placement per piece that belongs: every drop on the board counts as a move, so moving a piece twice costs one over par. Turning, flipping and lifting are free.</p>
`;

interface Slot { id: number; x: number; y: number; side: number }

interface Layout {
  key: string;
  board: { x: number; y: number; cell: number };
  tray: Area;
  /** Tray cell size. */
  tc: number;
  /** One slot per piece, kept even while the piece is on the board, so the tray never jumps. */
  slots: Slot[];
  flip: Area | null;
}

interface Drag {
  id: number;
  start: Point;
  p: Point;
  /** Which cell of the piece sits under the finger. */
  grab: Cell;
  moved: boolean;
  fromBoard: boolean;
}

export class PackingView implements PuzzleView {
  private state: PackingState;
  private history: PackingState[] = [];
  private drag: Drag | null = null;
  private selected = 0;
  /** The selection ring shows when it matters: for the flip button, or once the keyboard is used. */
  private keyboard = false;
  private flipDown = false;
  private glow: { id: number; at: number } | null = null;
  private shake = -1e9;
  private wonAt = 0;
  private lay: Layout | null = null;
  private reduced: boolean;

  constructor(private readonly initial: PackingState, reducedMotion: boolean) {
    this.state = clonePacking(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'The outline is full';
    const n = cellsLeft(this.state);
    return n === 1 ? '1 cell to fill' : `${n} cells to fill`;
  }

  restart(): void {
    this.state = clonePacking(this.initial);
    this.history = [];
    this.drag = null;
    this.glow = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.glow = null;
    this.drag = null;
    return true;
  }

  private apply(m: PackingMove): boolean {
    const next = applyMove(this.state, m);
    if (!next) return false;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    if (m.kind === 'place' && !this.reduced) this.glow = { id: m.piece, at: performance.now() };
    if (solved(next)) this.wonAt = performance.now();
    return true;
  }

  private piece(id: number): Piece {
    return this.state.pieces.find((p) => p.id === id)!;
  }

  // ---- layout -----------------------------------------------------------------------

  private layout(area: Area): Layout {
    const s = this.state;
    const k = `${area.x},${area.y},${area.w},${area.h}`;
    if (this.lay && this.lay.key === k) return this.lay;
    const sides = s.pieces.map((p) => { const b = bounds(p.shape); return Math.max(b.w, b.h); });
    const margin = 8;
    let best: { score: number; lay: Layout } | null = null;
    for (const below of [true, false]) {
      for (let f = 0.38; f <= 0.76; f += 0.02) {
        const boardArea: Area = below
          ? { x: area.x, y: area.y, w: area.w, h: area.h * f }
          : { x: area.x, y: area.y, w: area.w * f, h: area.h };
        const cell = Math.min(MAX_CELL, Math.floor(Math.min((boardArea.w - margin * 2) / s.w, (boardArea.h - margin * 2) / s.h)));
        if (cell < 8) continue;
        const bw = cell * s.w, bh = cell * s.h;
        let tray: Area = below
          ? { x: area.x + margin, y: area.y + margin + bh + margin, w: area.w - margin * 2, h: area.h - bh - margin * 3 }
          : { x: area.x + margin + bw + margin * 2, y: area.y + margin, w: area.w - bw - margin * 4, h: area.h - margin * 2 };
        if (tray.w < 40 || tray.h < 40) continue;
        let flip: Area | null = null;
        if (s.flips) {
          // The flip button gets its own strip at the tray's right (below) or top (beside).
          if (below) {
            flip = { x: tray.x + tray.w - FLIP_SIZE, y: tray.y + 4, w: FLIP_SIZE, h: FLIP_SIZE };
            tray = { ...tray, w: tray.w - FLIP_SIZE - 8 };
          } else {
            flip = { x: tray.x + tray.w - FLIP_SIZE, y: tray.y, w: FLIP_SIZE, h: FLIP_SIZE };
            tray = { ...tray, y: tray.y + FLIP_SIZE + 8, h: tray.h - FLIP_SIZE - 8 };
          }
          if (tray.w < 40 || tray.h < 40) continue;
        }
        // The largest tray cell at which every piece fits.
        let lo = 4, hi = Math.min(cell * 0.85, 46);
        if (!this.flow(sides, tray, lo)) continue;
        for (let it = 0; it < 14; it++) {
          const mid = (lo + hi) / 2;
          if (this.flow(sides, tray, mid)) lo = mid; else hi = mid;
        }
        const tc = Math.floor(lo * 10) / 10;
        const slots = this.flow(sides, tray, tc)!;
        // Balance a big board against tray pieces big enough to grab (about half a board cell).
        const score = Math.min(cell, tc / 0.5) + cell * 0.3;
        if (!best || score > best.score) {
          const bx = below ? area.x + (area.w - bw) / 2 : area.x + margin;
          const by = below ? area.y + margin : area.y + (area.h - bh) / 2;
          best = { score, lay: { key: k, board: { x: Math.round(bx), y: Math.round(by), cell }, tray, tc, slots, flip } };
        }
      }
    }
    const lay = best?.lay ?? { key: k, board: { x: area.x, y: area.y, cell: 8 }, tray: { ...area, h: 0 }, tc: 4, slots: [], flip: null };
    this.lay = lay;
    return lay;
  }

  /** Rows of square slots, centred in the tray; null when they do not fit. */
  private flow(sides: number[], tray: Area, tc: number): Slot[] | null {
    const pad = Math.max(3, tc * 0.3);
    const gap = Math.max(4, tc * 0.2);
    const rows: Slot[][] = [[]];
    let x = 0, y = 0, rowH = 0;
    const widths: number[] = [];
    sides.forEach((n, id) => {
      const side = n * tc + pad * 2;
      if (side > tray.w) { y = Infinity; return; }
      if (x > 0 && x + side > tray.w) {
        widths.push(x - gap);
        rows.push([]);
        y += rowH + gap;
        x = 0;
        rowH = 0;
      }
      rows[rows.length - 1].push({ id, x, y, side });
      x += side + gap;
      rowH = Math.max(rowH, side);
    });
    widths.push(x - gap);
    if (y + rowH > tray.h) return null;
    const total = y + rowH;
    const out: Slot[] = [];
    rows.forEach((row, r) => {
      const dx = tray.x + (tray.w - widths[r]) / 2;
      const rh = Math.max(...row.map((sl) => sl.side));
      for (const sl of row) out.push({ id: sl.id, x: dx + sl.x, y: tray.y + (tray.h - total) / 2 + sl.y + (rh - sl.side) / 2, side: sl.side });
    });
    return out;
  }

  /** Pixel origin of a piece drawn in its tray slot, centred. */
  private slotOrigin(sl: Slot, p: Piece, tc: number): Point {
    const b = bounds(cellsOf(p));
    return { x: sl.x + (sl.side - b.w * tc) / 2, y: sl.y + (sl.side - b.h * tc) / 2 };
  }

  private boardCell(p: Point): Cell {
    const { x, y, cell } = this.lay!.board;
    return { x: Math.floor((p.x - x) / cell), y: Math.floor((p.y - y) / cell) };
  }

  private onBoard(p: Point): boolean {
    if (!this.lay) return false;
    const { x, y, cell } = this.lay.board;
    return p.x >= x - cell * 0.5 && p.y >= y - cell * 0.5 && p.x < x + (this.state.w + 0.5) * cell && p.y < y + (this.state.h + 0.5) * cell;
  }

  /**
   * Where a dragged piece would land: the corner under the finger, or the
   * nearest corner within one cell where it fits. `ok` says whether it fits.
   */
  private target(d: Drag): { at: Cell; ok: boolean } | null {
    if (!this.onBoard(d.p)) return null;
    const { x, y, cell } = this.lay!.board;
    const fx = (d.p.x - x) / cell - d.grab.x - 0.5, fy = (d.p.y - y) / cell - d.grab.y - 0.5;
    const at = { x: Math.round(fx), y: Math.round(fy) };
    if (canPlace(this.state, d.id, at)) return { at, ok: true };
    let best: { at: Cell; dist: number } | null = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = { x: at.x + dx, y: at.y + dy };
      const dist = Math.hypot(c.x - fx, c.y - fy);
      if (dist < 1.05 && canPlace(this.state, d.id, c) && (!best || dist < best.dist)) best = { at: c, dist };
    }
    return best ? { at: best.at, ok: true } : { at, ok: false };
  }

  private inFlip(p: Point): boolean {
    const f = this.lay?.flip;
    return !!f && p.x >= f.x && p.y >= f.y && p.x <= f.x + f.w && p.y <= f.y + f.h;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void {
    if (this.won || !this.lay) return;
    if (this.inFlip(p)) { this.flipDown = true; return; }
    const s = this.state;
    const c = this.boardCell(p);
    if (c.x >= 0 && c.y >= 0 && c.x < s.w && c.y < s.h) {
      const id = occupancy(s)[c.y * s.w + c.x];
      if (id >= 0) {
        const q = this.piece(id);
        this.selected = id;
        this.drag = { id, start: p, p, grab: { x: c.x - q.at!.x, y: c.y - q.at!.y }, moved: false, fromBoard: true };
        return;
      }
    }
    const tc = this.lay.tc;
    for (const sl of this.lay.slots) {
      const q = this.piece(sl.id);
      if (q.at || p.x < sl.x || p.y < sl.y || p.x > sl.x + sl.side || p.y > sl.y + sl.side) continue;
      const o = this.slotOrigin(sl, q, tc);
      const cells = cellsOf(q);
      const gx = (p.x - o.x) / tc - 0.5, gy = (p.y - o.y) / tc - 0.5;
      // Grab the nearest cell of the shape, so the finger stays on the piece while it grows to board size.
      const grab = cells.reduce((b, cc) => (Math.hypot(cc.x - gx, cc.y - gy) < Math.hypot(b.x - gx, b.y - gy) ? cc : b), cells[0]);
      this.selected = sl.id;
      this.drag = { id: sl.id, start: p, p, grab: { ...grab }, moved: false, fromBoard: false };
      return;
    }
  }

  move(p: Point): void {
    const d = this.drag;
    if (!d) return;
    d.p = p;
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > TAP) d.moved = true;
  }

  up(p: Point): void {
    if (this.flipDown) {
      this.flipDown = false;
      if (this.inFlip(p)) this.apply({ kind: 'flip', piece: this.selected });
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.p = p;
    if (!d.moved) {
      this.apply({ kind: 'rotate', piece: d.id });
      return;
    }
    const t = this.target(d);
    if (t?.ok) {
      const q = this.piece(d.id);
      if (q.at && q.at.x === t.at.x && q.at.y === t.at.y) return;
      this.apply({ kind: 'place', piece: d.id, at: t.at });
      return;
    }
    if (d.fromBoard && !t) this.apply({ kind: 'lift', piece: d.id });
    else if (t) this.shake = performance.now();
  }

  cancel(): void {
    this.drag = null;
    this.flipDown = false;
  }

  private firstFit(q: Piece): Cell | null {
    const s = this.state;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (canPlace(s, q.id, { x, y })) return { x, y };
    return null;
  }

  key(e: KeyboardEvent): boolean {
    if (this.won) return false;
    const s = this.state;
    const n = s.pieces.length;
    this.keyboard = true;
    if (e.key === 'Tab') {
      e.preventDefault();
      this.selected = (this.selected + (e.shiftKey ? n - 1 : 1)) % n;
      return true;
    }
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) { this.selected = Number(e.key) - 1; return true; }
    const q = this.piece(this.selected);
    if (e.key === ' ' || e.key === 'r' || e.key === 'R') { this.apply({ kind: 'rotate', piece: q.id }); return true; }
    if ((e.key === 'f' || e.key === 'F') && s.flips) { this.apply({ kind: 'flip', piece: q.id }); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.apply({ kind: 'lift', piece: q.id }); return true; }
    const dir: Record<string, Cell> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const dv = dir[e.key];
    if (e.key === 'Enter' || (dv && !q.at)) {
      if (q.at) return true;
      const at = this.firstFit(q);
      if (at) this.apply({ kind: 'place', piece: q.id, at });
      else this.shake = performance.now();
      return true;
    }
    if (!dv || !q.at) return false;
    if (!this.apply({ kind: 'place', piece: q.id, at: { x: q.at.x + dv.x, y: q.at.y + dv.y } })) this.shake = performance.now();
    return true;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const lay = this.layout(area);
    const s = this.state;
    const { x: bx, y: by, cell } = lay.board;
    const won = this.won;
    const shaking = now - this.shake < SHAKE_MS;

    // The outline: a flat plate with a fine rim, faint sockets on open cells, hatched blocks.
    const outlineCells: Cell[] = [];
    s.outline.forEach((on, i) => { if (on) outlineCells.push({ x: i % s.w, y: Math.floor(i / s.w) }); });
    const loops = outlinePolygons(outlineCells);
    tracePath(ctx, loops, bx, by, cell, 0, cell * 0.18);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = shaking ? C.bad : won ? C.line3 : C.line2;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.restore();
    for (const c of outlineCells) {
      const i = c.y * s.w + c.x;
      const x = bx + c.x * cell, y = by + c.y * cell;
      if (s.blocked[i]) drawBlock(ctx, x, y, cell);
      else tile(ctx, x + cell * 0.14, y + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.12, null, C.line, 1);
    }

    const d = this.drag && this.drag.moved ? this.drag : null;
    const t = d ? this.target(d) : null;

    // Placed pieces.
    const pulse = won && !this.reduced ? 1 - ease((now - this.wonAt) / 900) : 0;
    for (const p of s.pieces) {
      if (!p.at || (d && d.id === p.id)) continue;
      const g = this.glow && this.glow.id === p.id ? 1 - ease((now - this.glow.at) / GLOW_MS) : 0;
      drawPiece(ctx, p, bx + p.at.x * cell, by + p.at.y * cell, cell, Math.max(g, pulse), !won && !d && this.showSelected(p.id));
    }

    // The landing shadow: where the piece in hand will drop.
    if (d && t) {
      const cells = cellsOf(this.piece(d.id));
      const loopsG = outlinePolygons(cells);
      ctx.save();
      tracePath(ctx, loopsG, bx + t.at.x * cell, by + t.at.y * cell, cell, cell * 0.05, cell * 0.16);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = t.ok ? C.accent : C.bad;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = t.ok ? C.accent : C.bad;
      ctx.lineWidth = 2;
      if (!t.ok) ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }

    // The tray.
    if (!won) {
      const tr = lay.tray;
      tile(ctx, tr.x, tr.y, tr.w, tr.h, 12, null, C.line, 1);
      for (const sl of lay.slots) {
        const p = this.piece(sl.id);
        if (p.at || (d && d.id === sl.id)) continue;
        const o = this.slotOrigin(sl, p, lay.tc);
        drawPiece(ctx, p, o.x, o.y, lay.tc, 0, !d && this.showSelected(p.id));
      }
      if (lay.flip) this.drawFlip(ctx, lay.flip);
    }

    // The piece in hand, at board size, under the finger.
    if (d) {
      const p = this.piece(d.id);
      const ox = d.p.x - (d.grab.x + 0.5) * cell, oy = d.p.y - (d.grab.y + 0.5) * cell;
      ctx.save();
      ctx.globalAlpha = t?.ok ? 0.55 : 0.9;
      drawPiece(ctx, p, ox, oy, cell, 0, true);
      ctx.restore();
    }
  }

  private showSelected(id: number): boolean {
    return this.selected === id && (this.state.flips || this.keyboard);
  }

  private drawFlip(ctx: CanvasRenderingContext2D, f: Area): void {
    tile(ctx, f.x, f.y, f.w, f.h, f.w * 0.22, this.flipDown ? C.surface3 : C.surface2, C.accent, 1.25);
    // Two mirrored triangles either side of a dashed axis.
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2, k = f.w * 0.2;
    ctx.save();
    ctx.strokeStyle = C.text2;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(cx, cy - k * 1.3);
    ctx.lineTo(cx, cy + k * 1.3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.text;
    ctx.beginPath();
    ctx.moveTo(cx - k * 0.3, cy - k); ctx.lineTo(cx - k * 0.3, cy + k); ctx.lineTo(cx - k * 1.4, cy + k);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(cx + k * 0.3, cy - k); ctx.lineTo(cx + k * 0.3, cy + k); ctx.lineTo(cx + k * 1.4, cy + k);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

// ---- pieces and blocks ----------------------------------------------------------------

/** Colour by size: a quick way to tell the pieces apart on the board. */
function colourOf(p: Piece): string {
  const n = p.shape.length;
  // Their own palette, not the orbital colours: a piece is a shape, not an s, p, d or f orbital.
  return n <= 2 ? C.piece1 : n === 3 ? C.piece2 : n === 4 ? C.piece3 : C.piece4;
}

/** A piece: one flat rounded shape with a faint dot per cell. */
function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, ox: number, oy: number, cell: number, glow: number, selected: boolean): void {
  const cells = cellsOf(p);
  const inset = Math.max(1, cell * 0.06);
  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = colourOf(p);
    ctx.shadowBlur = cell * 0.6 * glow;
  }
  tracePath(ctx, outlinePolygons(cells), ox, oy, cell, inset, cell * 0.18);
  ctx.fillStyle = colourOf(p);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (selected) {
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = C.tileInk;
  ctx.globalAlpha *= 0.28;
  const r = Math.max(1, cell * 0.07);
  for (const c of cells) {
    ctx.beginPath();
    ctx.arc(ox + (c.x + 0.5) * cell, oy + (c.y + 0.5) * cell, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A filled block: a fixed square with fine hatching. */
function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, c: number): void {
  const g = c * 0.06;
  tile(ctx, x + g, y + g, c - 2 * g, c - 2 * g, c * 0.12, C.surface3, C.line2, 1);
  hatch(ctx, x + g, y + g, c - 2 * g, c * 0.22);
}

// ---- outline tracing ------------------------------------------------------------

type Loop = Cell[];

/** The boundary of a set of cells as closed loops of grid vertices, clockwise in screen space. */
function outlinePolygons(cells: Cell[]): Loop[] {
  const has = new Set(cells.map((c) => `${c.x},${c.y}`));
  const edges = new Map<string, Cell[]>();
  const add = (a: Cell, b: Cell) => {
    const k = `${a.x},${a.y}`;
    (edges.get(k) ?? edges.set(k, []).get(k)!).push(b);
  };
  for (const c of cells) {
    if (!has.has(`${c.x},${c.y - 1}`)) add({ x: c.x, y: c.y }, { x: c.x + 1, y: c.y });
    if (!has.has(`${c.x + 1},${c.y}`)) add({ x: c.x + 1, y: c.y }, { x: c.x + 1, y: c.y + 1 });
    if (!has.has(`${c.x},${c.y + 1}`)) add({ x: c.x + 1, y: c.y + 1 }, { x: c.x, y: c.y + 1 });
    if (!has.has(`${c.x - 1},${c.y}`)) add({ x: c.x, y: c.y + 1 }, { x: c.x, y: c.y });
  }
  const loops: Loop[] = [];
  for (const [k, outs] of edges) {
    if (!outs.length) continue;
    const [sx, sy] = k.split(',').map(Number);
    const loop: Loop = [];
    let cur: Cell = { x: sx, y: sy };
    for (let guard = 0; guard < 400; guard++) {
      const list = edges.get(`${cur.x},${cur.y}`);
      if (!list || !list.length) break;
      loop.push(cur);
      cur = list.shift()!;
      if (cur.x === sx && cur.y === sy) break;
    }
    // Drop collinear vertices so corners round cleanly.
    const trimmed = loop.filter((v, i) => {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
      return !((a.x === v.x && v.x === b.x) || (a.y === v.y && v.y === b.y));
    });
    if (trimmed.length >= 4) loops.push(trimmed);
  }
  return loops;
}

/** Builds the loops as a path, inset by `inset` pixels with corners rounded by `radius`. */
function tracePath(ctx: CanvasRenderingContext2D, loops: Loop[], ox: number, oy: number, cell: number, inset: number, radius: number): void {
  ctx.beginPath();
  for (const loop of loops) {
    const n = loop.length;
    const pts = loop.map((v, i) => {
      const prev = loop[(i + n - 1) % n], next = loop[(i + 1) % n];
      const d1 = { x: Math.sign(v.x - prev.x), y: Math.sign(v.y - prev.y) };
      const d2 = { x: Math.sign(next.x - v.x), y: Math.sign(next.y - v.y) };
      // Interior lies to the right of travel for a clockwise loop in screen space.
      const n1 = { x: -d1.y, y: d1.x }, n2 = { x: -d2.y, y: d2.x };
      return { x: ox + v.x * cell + inset * (n1.x + n2.x), y: oy + v.y * cell + inset * (n1.y + n2.y) };
    });
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
      const r = Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
      const ma = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (i === 0) ctx.moveTo(ma.x, ma.y);
      else ctx.lineTo(ma.x, ma.y);
      ctx.arcTo(b.x, b.y, c.x, c.y, r);
    }
    ctx.closePath();
  }
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
