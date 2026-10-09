// Drawing and touch for Packing: drag pieces from the tray onto the outline,
// tap a piece to turn it, drag a placed piece to move it or lift it off.

import { applyMove, bounds, canPlace, cellsOf, clonePacking, occupancy, solved, type Cell, type PackingMove, type PackingState, type Piece } from './packing';
import { droplet, ease, MONO, type Area, type Point, type PuzzleView } from './view';

const TAP = 8;
const GLOW_MS = 520;

interface Slot { id: number; x: number; y: number; side: number; tc: number }

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
  private glow: { id: number; at: number } | null = null;
  private shake = 0;
  private area: Area = { x: 0, y: 0, w: 1, h: 1 };
  private board = { x: 0, y: 0, cell: 40 };
  private slots: Slot[] = [];
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
    const left = this.state.pieces.filter((p) => !p.at).length;
    if (this.won) return 'Nothing sticks out: the outline is full.';
    if (this.state.moves === 0) return '<span class="hl">Drag</span> a piece onto the dotted outline. <span class="hl">Tap</span> a piece to turn it a quarter.';
    if (left === 1) return 'One piece left. If it will not fit, lift another and try a different turn.';
    if (left === 0) return 'Every piece is down but a gap remains: lift one and try again.';
    return `${left} pieces to go. Drag a placed piece to move it, or back to the tray to lift it.`;
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
    return true;
  }

  private apply(m: PackingMove): boolean {
    const next = applyMove(this.state, m);
    if (!next) return false;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    if (m.kind === 'place' && !this.reduced) this.glow = { id: m.piece, at: performance.now() };
    return true;
  }

  private piece(id: number): Piece {
    return this.state.pieces.find((p) => p.id === id)!;
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): void {
    this.area = area;
    const s = this.state;
    const cell = Math.max(26, Math.min(72, Math.floor(Math.min((area.w - 32) / s.w, (area.h * 0.56 - 24) / s.h))));
    this.board = { x: Math.round(area.x + (area.w - cell * s.w) / 2), y: Math.round(area.y + 18), cell };
    const trayTop = this.board.y + cell * s.h + 26;
    let tc = Math.max(16, Math.min(40, Math.round(cell * 0.62)));
    for (let pass = 0; pass < 4; pass++) {
      this.slots = this.flow(trayTop, tc);
      const bottom = Math.max(trayTop, ...this.slots.map((sl) => sl.y + sl.side));
      if (bottom <= area.y + area.h - 4 || tc <= 16) break;
      tc = Math.max(16, Math.round(tc * 0.84));
    }
  }

  /** Tray slots: one square per unplaced piece, sized by its longest side so a turn never reflows the tray. */
  private flow(top: number, tc: number): Slot[] {
    const gap = 10;
    const left = this.area.x + 16, right = this.area.x + this.area.w - 16;
    const out: Slot[] = [];
    let x = left, y = top, rowH = 0;
    for (const p of this.state.pieces) {
      if (p.at) continue;
      const b = bounds(p.shape);
      const side = Math.max(40, Math.max(b.w, b.h) * tc);
      if (x + side > right && x > left) { x = left; y += rowH + gap; rowH = 0; }
      out.push({ id: p.id, x, y, side, tc });
      x += side + gap;
      rowH = Math.max(rowH, side);
    }
    return out;
  }

  private slotOf(id: number): Slot | undefined {
    return this.slots.find((sl) => sl.id === id);
  }

  /** Pixel origin of a piece drawn in its tray slot, centred. */
  private slotOrigin(sl: Slot, p: Piece): Point {
    const b = bounds(cellsOf(p));
    return { x: sl.x + (sl.side - b.w * sl.tc) / 2, y: sl.y + (sl.side - b.h * sl.tc) / 2 };
  }

  private boardCell(p: Point): Cell {
    const { x, y, cell } = this.board;
    return { x: Math.floor((p.x - x) / cell), y: Math.floor((p.y - y) / cell) };
  }

  private onBoard(p: Point): boolean {
    const c = this.boardCell(p);
    return c.x >= 0 && c.y >= 0 && c.x < this.state.w && c.y < this.state.h;
  }

  /** The piece's grid corner implied by the drag position, with the grabbed cell under the finger. */
  private dropCorner(d: Drag): Cell {
    const { x, y, cell } = this.board;
    return { x: Math.round((d.p.x - x) / cell - d.grab.x - 0.5), y: Math.round((d.p.y - y) / cell - d.grab.y - 0.5) };
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void {
    if (this.won) return;
    const s = this.state;
    if (this.onBoard(p)) {
      const c = this.boardCell(p);
      const id = occupancy(s)[c.y * s.w + c.x];
      if (id >= 0) {
        const q = this.piece(id);
        this.selected = id;
        this.drag = { id, start: p, p, grab: { x: c.x - q.at!.x, y: c.y - q.at!.y }, moved: false, fromBoard: true };
        return;
      }
    }
    for (const sl of this.slots) {
      if (p.x < sl.x || p.y < sl.y || p.x > sl.x + sl.side || p.y > sl.y + sl.side) continue;
      const q = this.piece(sl.id);
      const o = this.slotOrigin(sl, q);
      const cells = cellsOf(q);
      const b = bounds(cells);
      const gx = Math.max(0, Math.min(b.w - 1, Math.floor((p.x - o.x) / sl.tc)));
      const gy = Math.max(0, Math.min(b.h - 1, Math.floor((p.y - o.y) / sl.tc)));
      // Grab the nearest cell of the shape, so the finger stays on the piece while it grows to board size.
      const grab = cells.reduce((best, c) => (Math.hypot(c.x - gx, c.y - gy) < Math.hypot(best.x - gx, best.y - gy) ? c : best), cells[0]);
      this.selected = sl.id;
      this.drag = { id: sl.id, start: p, p, grab, moved: false, fromBoard: false };
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
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.p = p;
    if (!d.moved) {
      this.apply({ kind: 'rotate', piece: d.id });
      return;
    }
    const corner = this.dropCorner(d);
    if (this.onBoard(p) && canPlace(this.state, d.id, corner)) {
      this.apply({ kind: 'place', piece: d.id, at: corner });
      return;
    }
    if (d.fromBoard) this.apply({ kind: 'lift', piece: d.id });
    else if (this.onBoard(p)) this.shake = performance.now();
  }

  cancel(): void {
    this.drag = null;
  }

  key(e: KeyboardEvent): boolean {
    if (this.won) return false;
    const s = this.state;
    const n = s.pieces.length;
    if (e.key === 'Tab') {
      e.preventDefault();
      this.selected = (this.selected + (e.shiftKey ? n - 1 : 1)) % n;
      return true;
    }
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) { this.selected = Number(e.key) - 1; return true; }
    const q = this.piece(this.selected);
    if (e.key === ' ' || e.key === 'r' || e.key === 'R') { this.apply({ kind: 'rotate', piece: q.id }); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.apply({ kind: 'lift', piece: q.id }); return true; }
    if (e.key === 'Enter') {
      if (q.at) return true;
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        if (canPlace(s, q.id, { x, y })) { this.apply({ kind: 'place', piece: q.id, at: { x, y } }); return true; }
      }
      this.shake = performance.now();
      return true;
    }
    const dir: Record<string, Cell> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const dv = dir[e.key];
    if (!dv) return false;
    if (!q.at) {
      // From the tray, an arrow drops the piece on the first free spot it fits.
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        if (canPlace(s, q.id, { x, y })) { this.apply({ kind: 'place', piece: q.id, at: { x, y } }); return true; }
      }
      return true;
    }
    const at = { x: q.at.x + dv.x, y: q.at.y + dv.y };
    if (!this.apply({ kind: 'place', piece: q.id, at })) this.shake = performance.now();
    return true;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.layout(area);
    const s = this.state;
    const { x: bx, y: by, cell } = this.board;
    const won = this.won;
    const shaking = now - this.shake < 220;

    // The outline: dashed sockets per cell and a dashed rim round the whole blob.
    const outlineCells: Cell[] = [];
    s.outline.forEach((on, i) => { if (on) outlineCells.push({ x: i % s.w, y: Math.floor(i / s.w) }); });
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = shaking ? 'rgba(224, 80, 58, 0.7)' : 'rgba(226, 220, 207, 0.22)';
    for (const c of outlineCells) {
      roundRect(ctx, bx + c.x * cell + 4, by + c.y * cell + 4, cell - 8, cell - 8, 4);
      ctx.stroke();
    }
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = shaking ? 'rgba(224, 80, 58, 0.9)' : won ? 'rgba(243, 238, 226, 0.6)' : 'rgba(226, 220, 207, 0.4)';
    ctx.lineWidth = won ? 1.5 : 1;
    tracePath(ctx, outlinePolygons(outlineCells), bx, by, cell, 0, 3);
    ctx.stroke();
    ctx.restore();

    // Snap preview under a dragged piece.
    const d = this.drag;
    if (d && d.moved) {
      const corner = this.dropCorner(d);
      const ok = this.onBoard(d.p) && canPlace(s, d.id, corner);
      if (this.onBoard(d.p)) {
        ctx.fillStyle = ok ? 'rgba(226, 220, 207, 0.14)' : 'rgba(224, 80, 58, 0.12)';
        for (const c of cellsOf(this.piece(d.id))) {
          const x = corner.x + c.x, y = corner.y + c.y;
          if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
          roundRect(ctx, bx + x * cell + 2, by + y * cell + 2, cell - 4, cell - 4, 5);
          ctx.fill();
        }
      }
    }

    // Placed pieces.
    for (const p of s.pieces) {
      if (!p.at || (d && d.moved && d.id === p.id)) continue;
      const g = this.glow && this.glow.id === p.id ? 1 - ease((now - this.glow.at) / GLOW_MS) : 0;
      this.drawPiece(ctx, p, bx + p.at.x * cell, by + p.at.y * cell, cell, won ? 0.6 : g, !d && this.selected === p.id);
    }

    // Tray.
    if (!won) {
      const trayY = this.slots.length ? Math.min(...this.slots.map((sl) => sl.y)) : by + cell * s.h + 26;
      ctx.strokeStyle = 'rgba(226, 220, 207, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(area.x + 16, trayY - 12);
      ctx.lineTo(area.x + area.w - 16, trayY - 12);
      ctx.stroke();
      ctx.font = `11px ${MONO}`;
      ctx.fillStyle = 'rgba(226, 220, 207, 0.45)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      const placed = s.pieces.filter((p) => p.at).length;
      ctx.fillText(`${placed}/${s.pieces.length}`, area.x + 16, trayY - 16);
      for (const sl of this.slots) {
        if (d && d.moved && d.id === sl.id) continue;
        const p = this.piece(sl.id);
        const o = this.slotOrigin(sl, p);
        this.drawPiece(ctx, p, o.x, o.y, sl.tc, 0, !d && this.selected === p.id);
      }
    }

    // The piece in hand, drawn last and at board size.
    if (d && d.moved) {
      const p = this.piece(d.id);
      const ox = d.p.x - (d.grab.x + 0.5) * cell, oy = d.p.y - (d.grab.y + 0.5) * cell;
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      this.drawPiece(ctx, p, ox, oy, cell, 0.35, false);
      ctx.restore();
    }
  }

  /** A piece: droplets on each cell, joined by one soft rounded outline. */
  private drawPiece(ctx: CanvasRenderingContext2D, p: Piece, ox: number, oy: number, cell: number, glow: number, selected: boolean): void {
    const cells = cellsOf(p);
    const inset = Math.max(2, cell * 0.08);
    ctx.save();
    if (glow > 0) {
      ctx.shadowColor = `rgba(243, 238, 226, ${0.9 * glow})`;
      ctx.shadowBlur = cell * 0.5 * glow;
    }
    tracePath(ctx, outlinePolygons(cells), ox, oy, cell, inset, cell * 0.22);
    ctx.fillStyle = `rgba(226, 220, 207, ${0.09 + 0.12 * glow})`;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = selected ? 'rgba(243, 238, 226, 0.7)' : `rgba(226, 220, 207, ${0.4 + 0.4 * glow})`;
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.stroke();
    ctx.restore();
    const r = Math.max(3, Math.min(cell * 0.26, 14));
    for (const c of cells) droplet(ctx, ox + (c.x + 0.5) * cell, oy + (c.y + 0.5) * cell, r, glow > 0.2);
  }
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

/** Strokes the loops as a path, inset by `inset` pixels with corners rounded by `radius`. */
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
