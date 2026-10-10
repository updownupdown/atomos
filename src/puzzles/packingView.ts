// Drawing and touch for Packing: drag pieces from the tray onto the outline,
// tap a piece to turn it, drag a placed piece to move it or off the board to
// lift it. At the top of the table a flip button mirrors the chosen piece.
// The board and the tray are laid out from the area alone (tray below on a
// tall area, beside on a wide one), and the tray scales its pieces down until
// they all fit, so nothing ever spills.

import { applyMove, bounds, canPlace, cellsLeft, cellsOf, clonePacking, occupancy, solved, type Cell, type PackingMove, type PackingState, type Piece, type Rot } from './packing';
import { C, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView, type RuleCard } from './view';

const TAP = 8;
const GLOW_MS = 520;
const SHAKE_MS = 240;
const MAX_CELL = 72;
const FLIP_SIZE = 44;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Packing builds the isotopes in each atom's vault on its Build page: one board per isotope, opening once the atom is built. It runs for every element, z 1 to 118. The outline grows from 10 cells at hydrogen to 34 at the end of the table, on a grid of up to 7 by 7, and comes in four kinds: compact, mirror-symmetric, with a hole through it, and loose with arms (from z 50). Filled blocks arrive at z 12 (one), 40 (two) and 80 (three). The spare piece arrives at z 30 and is never the same shape as a real one. Flipping arrives at z 90. Each level is carved from its own answer, so it is always solvable; other answers may exist and count too. Par is one placement per piece that belongs: every drop on the board counts as a move, so moving a piece twice costs one over par. Turning, flipping and lifting are free.</p>
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

  /** Rows of square slots, centerd in the tray; null when they do not fit. */
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

  /** Pixel origin of a piece drawn in its tray slot, centerd. */
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
    ctx.strokeStyle = shaking ? C.warn : won ? C.line3 : C.line2;
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
      ctx.fillStyle = t.ok ? C.accent : C.warn;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = t.ok ? C.accent : C.warn;
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

/** Color by size: a quick way to tell the pieces apart on the board. */
function colorOf(p: Piece): string {
  const n = p.shape.length;
  // Their own palette, not the orbital colors: a piece is a shape, not an s, p, d or f orbital.
  return n <= 2 ? C.piece1 : n === 3 ? C.piece2 : n === 4 ? C.piece3 : C.piece4;
}

/** A piece: one flat rounded shape with a faint dot per cell. */
function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, ox: number, oy: number, cell: number, glow: number, selected: boolean): void {
  const cells = cellsOf(p);
  const inset = Math.max(1, cell * 0.06);
  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = colorOf(p);
    ctx.shadowBlur = cell * 0.6 * glow;
  }
  tracePath(ctx, outlinePolygons(cells), ox, oy, cell, inset, cell * 0.18);
  ctx.fillStyle = colorOf(p);
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

// ---- rules ------------------------------------------------------------------------

type Shape = [number, number][];
const DOMINO: Shape = [[0, 0], [0, 1]];
const SQUARE: Shape = [[0, 0], [1, 0], [0, 1], [1, 1]];
const BAR3: Shape = [[0, 0], [1, 0], [2, 0]];
const ELL: Shape = [[0, 0], [0, 1], [0, 2], [1, 2]];
const ZIG: Shape = [[0, 0], [1, 0], [1, 1], [2, 1]];

const demoPiece = (id: number, shape: Shape, rot: Rot = 0, flip = false): Piece => ({ id, shape: shape.map(([x, y]) => ({ x, y })), rot, flip, at: null });

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Progress through [a, b], eased. */
const seg = (T: number, a: number, b: number): number => ease(clamp01((T - a) / (b - a)));

interface DemoTable { cell: number; bx: number; by: number; tray: Area; tc: number }

/** A demo table: an outline of gw x gh cells on the left and a tray on the right. */
function demoTable(w: number, h: number, gw: number, gh: number, trayShare = 0.36): DemoTable {
  const trayW = w * trayShare;
  const cell = Math.min((w - trayW - 16) / gw, (h - 12) / gh, 26);
  const bx = 6 + (w - trayW - 16 - cell * gw) / 2, by = (h - cell * gh) / 2;
  return { cell, bx, by, tray: { x: w - trayW - 4, y: 6, w: trayW, h: h - 12 }, tc: Math.min(cell * 0.6, 14) };
}

/** The outline as the board draws it: a flat plate with a dashed rim, sockets on open cells and hatched blocks. */
function demoOutline(ctx: CanvasRenderingContext2D, T: DemoTable, open: Shape, blocks: Shape = [], rim: string = C.line2): void {
  const cells = [...open, ...blocks].map(([x, y]) => ({ x, y }));
  const { bx, by, cell } = T;
  tracePath(ctx, outlinePolygons(cells), bx, by, cell, 0, cell * 0.18);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();
  for (const [x, y] of open) tile(ctx, bx + x * cell + cell * 0.14, by + y * cell + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.12, null, C.line, 1);
  for (const [x, y] of blocks) drawBlock(ctx, bx + x * cell, by + y * cell, cell);
}

function demoTray(ctx: CanvasRenderingContext2D, T: DemoTable): void {
  tile(ctx, T.tray.x, T.tray.y, T.tray.w, T.tray.h, 8, null, C.line, 1);
}

/** Where a piece sits in the tray: slot k of n, stacked top to bottom and centered. */
function traySpot(T: DemoTable, p: Piece, k: number, n: number): Point {
  const b = bounds(cellsOf(p));
  const slotH = T.tray.h / n;
  return { x: T.tray.x + (T.tray.w - b.w * T.tc) / 2, y: T.tray.y + slotH * k + (slotH - b.h * T.tc) / 2 };
}

/** The landing shadow the board shows under a dragged piece: accent where it fits, amber and dashed where it does not. */
function demoShadow(ctx: CanvasRenderingContext2D, T: DemoTable, p: Piece, at: Cell, ok: boolean, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  tracePath(ctx, outlinePolygons(cellsOf(p)), T.bx + at.x * T.cell, T.by + at.y * T.cell, T.cell, T.cell * 0.05, T.cell * 0.16);
  ctx.globalAlpha = alpha * 0.28;
  ctx.fillStyle = ok ? C.accent : C.warn;
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = ok ? C.accent : C.warn;
  ctx.lineWidth = 2;
  if (!ok) ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.restore();
}

/**
 * A piece carried from one spot to another over k (0 to 1): it grows from
 * tray size to board size, shows its landing shadow on the way and drops.
 */
function demoCarry(ctx: CanvasRenderingContext2D, T: DemoTable, p: Piece, from: Point, fromCell: number, to: Cell, k: number, ok = true): void {
  const tx = T.bx + to.x * T.cell, ty = T.by + to.y * T.cell;
  if (k >= 1) { drawPiece(ctx, p, tx, ty, T.cell, 0, false); return; }
  if (k > 0.45) demoShadow(ctx, T, p, to, ok, clamp01((k - 0.45) / 0.2));
  const cell = fromCell + (T.cell - fromCell) * clamp01(k * 2.2);
  const x = from.x + (tx - from.x) * k, y = from.y + (ty - from.y) * k;
  ctx.save();
  ctx.globalAlpha = k > 0.6 && ok ? 0.55 : 0.9;
  drawPiece(ctx, p, x, y, cell, 0, true);
  ctx.restore();
  demoFinger(ctx, x + cell * 0.5, y + cell * 0.5, T.cell * 0.2);
}

/** A fingertip, for the demos only. */
function demoFinger(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.globalAlpha *= 0.85;
  ctx.fillStyle = C.text;
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(4, r), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The board's flip button, drawn by the board's own code. */
function demoFlip(ctx: CanvasRenderingContext2D, f: Area, down: boolean): void {
  const draw = (PackingView.prototype as unknown as { drawFlip(this: { flipDown: boolean }, c: CanvasRenderingContext2D, a: Area): void }).drawFlip;
  draw.call({ flipDown: down }, ctx, f);
}

/** A faint copy of a piece where it was before a move. */
function demoGhost(ctx: CanvasRenderingContext2D, p: Piece, x: number, y: number, cell: number, alpha = 0.22): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawPiece(ctx, p, x, y, cell, 0, false);
  ctx.restore();
}

/** A thin arrow for a move made. */
function demoTrail(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, alpha = 1): void {
  if (alpha <= 0) return;
  const a = Math.atan2(y2 - y1, x2 - x1), hd = 4;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.line3;
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

/** Open cells no piece can fill, flagged in amber: a dashed rim around them. */
function demoHole(ctx: CanvasRenderingContext2D, T: DemoTable, cells: Shape, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  tracePath(ctx, outlinePolygons(cells.map(([x, y]) => ({ x, y }))), T.bx, T.by, T.cell, T.cell * 0.08, T.cell * 0.16);
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** A piece resting in the tray. */
function demoInTray(ctx: CanvasRenderingContext2D, T: DemoTable, p: Piece, k: number, n: number, selected = false): void {
  const s = traySpot(T, p, k, n);
  drawPiece(ctx, p, s.x, s.y, T.tc, 0, selected);
}

const OPEN_3X2: Shape = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];
const OPEN_4X2: Shape = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]];
/** Where a carried piece is held, still in hand, at the end of a picture about its shadow. */
const HELD = 0.66;

export const RULES: RuleCard[] = [
  {
    title: 'Fill the outline',
    text: 'Drag pieces from the tray onto the dotted outline until every open cell is filled. Pieces are tinted by size.',
    good: {
      duration: 2.6,
      caption: 'Every cell filled',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 4, 2);
        const a = demoPiece(0, SQUARE), b = demoPiece(1, SQUARE);
        demoOutline(ctx, T, OPEN_4X2, [], t > 2.1 ? C.line3 : C.line2);
        demoTray(ctx, T);
        const ka = seg(t, 0.3, 1.1), kb = seg(t, 1.2, 2.0);
        if (ka === 0) demoInTray(ctx, T, a, 0, 2);
        if (kb === 0) demoInTray(ctx, T, b, 1, 2);
        if (ka > 0) demoCarry(ctx, T, a, traySpot(T, a, 0, 2), T.tc, { x: 0, y: 0 }, ka);
        if (kb > 0) demoCarry(ctx, T, b, traySpot(T, b, 1, 2), T.tc, { x: 2, y: 0 }, kb);
      },
    },
    bad: {
      duration: 2,
      caption: 'Gaps too thin for any piece',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 4, 2);
        const a = demoPiece(0, SQUARE), b = demoPiece(1, SQUARE);
        demoOutline(ctx, T, OPEN_4X2);
        demoTray(ctx, T);
        const ka = seg(t, 0.3, 1.1);
        if (ka === 0) demoInTray(ctx, T, a, 0, 2);
        else demoCarry(ctx, T, a, traySpot(T, a, 0, 2), T.tc, { x: 1, y: 0 }, ka);
        demoInTray(ctx, T, b, 1, 2);
        const k = seg(t, 1.3, 1.6);
        demoHole(ctx, T, [[0, 0], [0, 1]], k);
        demoHole(ctx, T, [[3, 0], [3, 1]], k);
      },
    },
  },
  {
    title: 'Landing shadow',
    text: 'While you drag, a bright shadow shows exactly where the piece will land. An amber dashed shadow means it will not fit there.',
    good: {
      duration: 2,
      caption: 'Bright: it lands here',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 2, 0.3);
        const a = demoPiece(0, DOMINO), b = demoPiece(1, SQUARE);
        demoOutline(ctx, T, OPEN_3X2);
        demoTray(ctx, T);
        drawPiece(ctx, b, T.bx + T.cell, T.by, T.cell, 0, false);
        const k = seg(t, 0.3, 1.5) * HELD;
        if (k === 0) demoInTray(ctx, T, a, 0, 1);
        else demoCarry(ctx, T, a, traySpot(T, a, 0, 1), T.tc, { x: 0, y: 0 }, k);
      },
    },
    bad: {
      duration: 2,
      caption: "Amber: it won't fit there",
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 2, 0.3);
        const a = demoPiece(0, DOMINO), b = demoPiece(1, SQUARE);
        demoOutline(ctx, T, OPEN_3X2);
        demoTray(ctx, T);
        drawPiece(ctx, b, T.bx + T.cell, T.by, T.cell, 0, false);
        const k = seg(t, 0.3, 1.5) * HELD;
        if (k === 0) demoInTray(ctx, T, a, 0, 1);
        else demoCarry(ctx, T, a, traySpot(T, a, 0, 1), T.tc, { x: 1, y: 0 }, k, false);
      },
    },
  },
  {
    title: 'Turn',
    text: 'Tap a piece to turn it a quarter turn, in the tray or on the board. Turning is free.',
    good: {
      duration: 1.8,
      caption: 'A tap turns it a quarter',
      draw: (ctx, w, h, t) => {
        const cell = Math.min(w / 7, h / 4.4, 20);
        const before = demoPiece(0, ELL, 0), after = demoPiece(0, ELL, t < 0.8 ? 0 : 1);
        const bb = bounds(cellsOf(before)), ba = bounds(cellsOf(after));
        const lx = w * 0.27 - (bb.w * cell) / 2, ly = (h - bb.h * cell) / 2;
        const rx = w * 0.7 - (ba.w * cell) / 2, ry = (h - ba.h * cell) / 2;
        demoGhost(ctx, before, lx, ly, cell, 0.4);
        // A quarter-turn arrow between them.
        const cx = w * 0.48, cy = h / 2, r = cell * 0.55;
        ctx.save();
        ctx.strokeStyle = C.line3;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI * 0.9, Math.PI * 0.1);
        const ex = cx + Math.cos(Math.PI * 0.1) * r, ey = cy + Math.sin(Math.PI * 0.1) * r;
        ctx.moveTo(ex - 4, ey - 3);
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex + 3, ey - 4);
        ctx.stroke();
        ctx.restore();
        const glow = t > 0.8 ? 1 - seg(t, 0.8, 1.5) : 0;
        drawPiece(ctx, after, rx, ry, cell, glow, false);
        if (t > 0.45 && t < 0.95) {
          const c = cellsOf(after)[0];
          demoFinger(ctx, rx + (c.x + 0.5) * cell, ry + (c.y + 0.5) * cell, cell * 0.22);
        }
      },
    },
  },
  {
    title: 'Move or lift',
    text: 'Drag a placed piece to move it, or drag it off the board to put it back in the tray.',
    good: {
      duration: 2,
      caption: 'Dragged off, it goes back',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 2, 0.3);
        const a = demoPiece(0, DOMINO);
        demoOutline(ctx, T, OPEN_3X2);
        demoTray(ctx, T);
        const spot = traySpot(T, a, 0, 1);
        const k = seg(t, 0.3, 1.2);
        if (k > 0) {
          demoGhost(ctx, a, T.bx, T.by, T.cell);
          demoTrail(ctx, T.bx + T.cell, T.by + T.cell, spot.x - 3, spot.y + T.tc, seg(t, 1.2, 1.4));
        }
        const x = T.bx + (spot.x - T.bx) * k, y = T.by + (spot.y - T.by) * k, cell = T.cell + (T.tc - T.cell) * k;
        drawPiece(ctx, a, x, y, cell, 0, k > 0 && k < 1);
        if (k > 0 && k < 1) demoFinger(ctx, x + cell * 0.5, y + cell * 0.5, T.cell * 0.2);
      },
    },
  },
  {
    title: 'Filled blocks',
    text: 'Hatched squares are already filled: nothing goes on them, so pack around them.',
    good: {
      duration: 2.6,
      caption: 'Packed around the block',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 2);
        const a = demoPiece(0, BAR3), b = demoPiece(1, [[0, 0], [1, 0]]);
        demoOutline(ctx, T, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]], [[2, 1]], t > 2.1 ? C.line3 : C.line2);
        demoTray(ctx, T);
        const ka = seg(t, 0.3, 1.1), kb = seg(t, 1.2, 2.0);
        if (ka === 0) demoInTray(ctx, T, a, 0, 2);
        if (kb === 0) demoInTray(ctx, T, b, 1, 2);
        if (ka > 0) demoCarry(ctx, T, a, traySpot(T, a, 0, 2), T.tc, { x: 0, y: 0 }, ka);
        if (kb > 0) demoCarry(ctx, T, b, traySpot(T, b, 1, 2), T.tc, { x: 0, y: 1 }, kb);
      },
    },
    bad: {
      duration: 2,
      caption: 'Nothing goes on a block',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 2);
        const a = demoPiece(0, BAR3), b = demoPiece(1, [[0, 0], [1, 0]]);
        demoOutline(ctx, T, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]], [[2, 1]]);
        demoTray(ctx, T);
        demoInTray(ctx, T, b, 1, 2);
        const k = seg(t, 0.3, 1.5) * HELD;
        if (k === 0) demoInTray(ctx, T, a, 0, 2);
        else demoCarry(ctx, T, a, traySpot(T, a, 0, 2), T.tc, { x: 0, y: 1 }, k, false);
      },
    },
  },
  {
    title: 'Spare piece',
    text: 'From the middle of the table one piece in the tray belongs nowhere. Work out which one to leave out.',
    good: {
      duration: 2.6,
      caption: 'The 3-bar was the spare',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 2);
        const a = demoPiece(0, DOMINO), b = demoPiece(1, SQUARE), spare = demoPiece(2, BAR3);
        demoOutline(ctx, T, OPEN_3X2, [], t > 2.1 ? C.line3 : C.line2);
        demoTray(ctx, T);
        const ka = seg(t, 0.3, 1.1), kb = seg(t, 1.2, 2.0);
        if (ka === 0) demoInTray(ctx, T, a, 0, 3);
        if (kb === 0) demoInTray(ctx, T, b, 1, 3);
        demoInTray(ctx, T, spare, 2, 3);
        if (ka > 0) demoCarry(ctx, T, a, traySpot(T, a, 0, 3), T.tc, { x: 0, y: 0 }, ka);
        if (kb > 0) demoCarry(ctx, T, b, traySpot(T, b, 1, 3), T.tc, { x: 1, y: 0 }, kb);
      },
    },
    bad: {
      duration: 2.6,
      caption: 'Use the spare and a hole is left',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 2);
        const a = demoPiece(0, DOMINO, 1), b = demoPiece(1, SQUARE), spare = demoPiece(2, BAR3);
        demoOutline(ctx, T, OPEN_3X2);
        demoTray(ctx, T);
        const ks = seg(t, 0.3, 1.1), ka = seg(t, 1.2, 2.0);
        if (ks === 0) demoInTray(ctx, T, spare, 2, 3);
        if (ka === 0) demoInTray(ctx, T, a, 0, 3);
        demoInTray(ctx, T, b, 1, 3);
        if (ks > 0) demoCarry(ctx, T, spare, traySpot(T, spare, 2, 3), T.tc, { x: 0, y: 0 }, ks);
        if (ka > 0) demoCarry(ctx, T, a, traySpot(T, a, 0, 3), T.tc, { x: 0, y: 1 }, ka);
        demoHole(ctx, T, [[2, 1]], seg(t, 2.1, 2.4));
      },
    },
  },
  {
    title: 'Flip',
    text: 'Near the end of the table some pieces arrive mirrored. Tap a piece to choose it, then the flip button to mirror it left to right.',
    good: {
      duration: 3,
      caption: 'Flipped, it fits',
      draw: (ctx, w, h, t) => flipPicture(ctx, w, h, t, true),
    },
    bad: {
      duration: 2,
      caption: "Unflipped, it won't fit",
      draw: (ctx, w, h, t) => flipPicture(ctx, w, h, t, false),
    },
  },
  {
    title: 'Keyboard',
    text: 'Tab or 1 to 9 picks a piece, R or Space turns it, F flips it, Enter drops it where it first fits, the arrows nudge it and Backspace lifts it.',
  },
];

/**
 * The flip pictures: an S-shaped outline and a Z-shaped piece in the tray above the flip button.
 * Flipped first, the piece drops in; carried over as it is, its shadow shows it will not fit.
 */
function flipPicture(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, flip: boolean): void {
  const T = demoTable(w, h, 3, 2);
  demoOutline(ctx, T, [[1, 0], [2, 0], [0, 1], [1, 1]], [], flip && t > 2.6 ? C.line3 : C.line2);
  demoTray(ctx, T);
  const side = Math.min(32, T.tray.w * 0.62, T.tray.h * 0.42);
  const f = { x: T.tray.x + (T.tray.w - side) / 2, y: T.tray.y + T.tray.h - side - 6, w: side, h: side };
  const flipped = flip && t > 1.05;
  const p = demoPiece(0, ZIG, 0, flipped);
  const b = bounds(cellsOf(p));
  const from = { x: T.tray.x + (T.tray.w - b.w * T.tc) / 2, y: T.tray.y + (f.y - T.tray.y - b.h * T.tc) / 2 };
  demoFlip(ctx, f, flip && t > 0.85 && t < 1.05);
  if (flip) {
    // Choose it, press flip, then carry it over.
    const k = seg(t, 1.4, 2.4);
    if (k === 0) drawPiece(ctx, p, from.x, from.y, T.tc, flipped && t < 1.4 ? 1 - seg(t, 1.05, 1.4) : 0, t > 0.45);
    else demoCarry(ctx, T, p, from, T.tc, { x: 0, y: 0 }, k);
    if (t > 0.25 && t < 0.55) demoFinger(ctx, from.x + T.tc * 1.5, from.y + T.tc * 0.5, T.cell * 0.2);
    if (t > 0.7 && t < 1.1) demoFinger(ctx, f.x + f.w * 0.66, f.y + f.h * 0.7, T.cell * 0.2);
  } else {
    const k = seg(t, 0.3, 1.5) * HELD;
    if (k === 0) drawPiece(ctx, p, from.x, from.y, T.tc, 0, false);
    else demoCarry(ctx, T, p, from, T.tc, { x: 0, y: 0 }, k, false);
  }
}
