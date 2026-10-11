// Drawing and touch for Packing (Tessera): drag pieces from the tray onto the
// square board (its holes drawn as studs), tap a piece to turn it, drag a placed
// piece to move it or off the board to lift it. At the top of the table a flip button mirrors the chosen piece.
// The board and the tray are laid out from the area alone (tray below on a
// tall area, beside on a wide one), and the tray scales its pieces down until
// they all fit, so nothing ever spills.

import { applyMove, bounds, canPlace, cellsLeft, cellsOf, clonePacking, completion, nextPlacement, occupancy, oriented, solved, solvedState, type Cell, type PackingMove, type PackingState, type Piece, type Placement, type Rot } from './packing';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { C, shade, tile } from './palette';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Point, type PuzzleView, type RuleCard } from './view';

const TAP = 8;
const GLOW_MS = 520;
const SHAKE_MS = 240;
const MAX_CELL = 72;
const FLIP_SIZE = 44;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Tessera builds the isotopes in each atom's vault on its Build page: one board per isotope, opening once the atom is built. It runs for every element, z 1 to 118. The board is a square, 4 by 4 up to z 10, 5 by 5 up to z 36, 6 by 6 up to z 76 and 7 by 7 to the end of the table, with one to three single cells cut out of it, shown as studs. The tray holds exactly the pieces that fill the rest, every one is used, and every level has exactly one answer. A full square never could: any answer turned a quarter would be another. So each gap is cut where a second answer would otherwise go, never beside another gap and never splitting the board. The pieces are all different shapes of three to six cells, never dominoes, with at most one straight bar or 2 by 2 square on the larger boards. Six-cell pieces join the 6 by 6 from z 60 and make up most of the 7 by 7. Flipping arrives at z 90, and the single answer then holds with flips too. Within each board size, the heavier elements get the deals a solver takes longest to prove unique. Par is one placement per piece: every drop on the board counts as a move, so moving a piece twice costs one over par. Turning, flipping and lifting are free.</p>
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
  /** Each piece's stone, by id. */
  private readonly stones: string[];
  /** Look here: where one piece goes, for the board it was asked on. */
  private mark: { state: PackingState; place: Placement } | null = null;

  constructor(private readonly initial: PackingState, reducedMotion: boolean) {
    this.state = clonePacking(initial);
    this.reduced = reducedMotion;
    this.stones = stonesFor(initial);
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  /** The game bar's Progress column: cells filled out of all of them. */
  stats(): { progress: { label: string; value: string } } {
    const s = this.state;
    const total = s.outline.filter(Boolean).length;
    return { progress: { label: 'Filled', value: `${total - cellsLeft(s)}/${total}` } };
  }

  hint(): string {
    if (this.won) return 'The square is full';
    const n = cellsLeft(this.state);
    return n === 1 ? '1 cell to fill' : `${n} cells to fill`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const pl = nextPlacement(s);
    if (!pl) return this.backOnTrack();
    const q = this.piece(pl.piece);
    if (level === 2) {
      this.apply({ kind: 'place', piece: pl.piece, at: pl.at, rot: pl.rot, flip: pl.flip });
      this.selected = pl.piece;
      return { text: 'Placed a piece where it fits.', moved: true };
    }
    this.mark = { state: s, place: pl };
    this.selected = pl.piece;
    // Say whether it has to be turned or flipped first, by the shape it shows now, not its numbers.
    const want = oriented(q.shape, pl.rot, pl.flip);
    const turns = ([0, 1, 2, 3] as Rot[]).some((r) => same(oriented(q.shape, r, q.flip), want));
    const how = same(cellsOf(q), want) ? '' : turns ? ' once turned' : ' once flipped over';
    return { text: `This piece fits here${how}.` };
  }

  /** On a board that can no longer be filled: the fewest undos back to one that can. */
  private backOnTrack(): Help {
    const h = this.history;
    for (let k = 1; k <= h.length; k++) if (completion(h[h.length - k])) return undoHelp(k);
    // Only when the way back is older than the undo history keeps.
    return { text: 'Restart to get back on track.' };
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
        // Half a cell kept round the board for its frame.
        const cell = Math.min(MAX_CELL, Math.floor(Math.min((boardArea.w - margin * 2) / (s.w + 0.5), (boardArea.h - margin * 2) / (s.h + 0.5))));
        if (cell < 8) continue;
        const room = Math.ceil(cell * 0.25);
        const bw = cell * s.w, bh = cell * s.h;
        let tray: Area = below
          ? { x: area.x + margin, y: area.y + margin + bh + 2 * room + margin, w: area.w - margin * 2, h: area.h - bh - 2 * room - margin * 3 }
          : { x: area.x + margin + bw + 2 * room + margin * 2, y: area.y + margin, w: area.w - bw - 2 * room - margin * 4, h: area.h - margin * 2 };
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
          const bx = below ? area.x + (area.w - bw) / 2 : area.x + margin + room;
          const by = below ? area.y + margin + room : area.y + (area.h - bh) / 2;
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

    // The board: the shared frame round the square and a faint dot on each cell.
    drawBoard(ctx, s.w, s.h, bx, by, cell, shaking ? C.warn : won ? C.good : C.frame, s.outline);

    const d = this.drag && this.drag.moved ? this.drag : null;
    const t = d ? this.target(d) : null;

    // Placed pieces.
    const pulse = won && !this.reduced ? 1 - ease((now - this.wonAt) / 900) : 0;
    for (const p of s.pieces) {
      if (!p.at || (d && d.id === p.id)) continue;
      const g = this.glow && this.glow.id === p.id ? 1 - ease((now - this.glow.at) / GLOW_MS) : 0;
      drawPiece(ctx, p, bx + p.at.x * cell, by + p.at.y * cell, cell, Math.max(g, pulse), !won && !d && this.showSelected(p.id), this.stones[p.id]);
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
      tile(ctx, tr.x, tr.y, tr.w, tr.h, 12, C.plate);
      for (const sl of lay.slots) {
        const p = this.piece(sl.id);
        if (p.at || (d && d.id === sl.id)) continue;
        const o = this.slotOrigin(sl, p, lay.tc);
        drawPiece(ctx, p, o.x, o.y, lay.tc, 0, !d && this.showSelected(p.id), this.stones[p.id]);
      }
      if (lay.flip) this.drawFlip(ctx, lay.flip);
    }

    // Look here: the piece in the tray and the cells it goes on.
    const m = this.mark?.state === s && !won && !d ? this.mark : null;
    if (m) {
      const q = this.piece(m.place.piece);
      for (const c of oriented(q.shape, m.place.rot, m.place.flip)) {
        drawHelpMark(ctx, bx + (m.place.at.x + c.x) * cell + 4, by + (m.place.at.y + c.y) * cell + 4, cell - 8, cell - 8, now, this.reduced, cell * 0.16);
      }
      const sl = lay.slots.find((x) => x.id === q.id);
      if (sl && !q.at) drawHelpMark(ctx, sl.x, sl.y, sl.side, sl.side, now, this.reduced, 10);
    }

    // The piece in hand, at board size, under the finger.
    if (d) {
      const p = this.piece(d.id);
      const ox = d.p.x - (d.grab.x + 0.5) * cell, oy = d.p.y - (d.grab.y + 0.5) * cell;
      ctx.save();
      ctx.globalAlpha = t?.ok ? 0.55 : 0.9;
      drawPiece(ctx, p, ox, oy, cell, 0, true, this.stones[p.id]);
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

// ---- pieces ---------------------------------------------------------------------------

const same = (a: Cell[], b: Cell[]): boolean => a.length === b.length && a.every((c, i) => c.x === b[i].x && c.y === b[i].y);

/**
 * Mosaic stones, like the tesserae the game is named for: marble, terracotta, slate and sage.
 * Their own set, kept off the orbital, target, warning and Next colors: a piece is a shape, not
 * an orbital.
 */
const STONES = ['#ece6d8', '#d98a6c', '#8fa8c4', '#93bc9c'];

/**
 * A stone for each piece (by id), so that no two pieces that touch in the level's carved answer
 * share one and the finished square reads as a mosaic; the four stones are spread as evenly as
 * that allows. Most pieces are four or five cells, so a color by size would leave a board of one
 * color. Four colors always suffice for pieces on a plane; a short search finds them.
 */
export function stonesFor(s: PackingState): string[] {
  const done = solvedState(s);
  const occ = occupancy(done);
  const n = s.pieces.length;
  const touch: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < occ.length; i++) {
    const x = i % s.w;
    for (const j of [x < s.w - 1 ? i + 1 : -1, i + s.w < occ.length ? i + s.w : -1]) {
      if (j < 0 || occ[i] < 0 || occ[j] < 0 || occ[i] === occ[j]) continue;
      touch[occ[i]].add(occ[j]);
      touch[occ[j]].add(occ[i]);
    }
  }
  const order = [...Array(n).keys()].sort((a, b) => touch[b].size - touch[a].size || a - b);
  const pick = Array(n).fill(-1);
  const used = Array(STONES.length).fill(0);
  const go = (k: number): boolean => {
    if (k === n) return true;
    const id = order[k];
    const free = [...STONES.keys()].filter((c) => ![...touch[id]].some((o) => pick[o] === c)).sort((a, b) => used[a] - used[b] || a - b);
    for (const c of free) {
      pick[id] = c;
      used[c]++;
      if (go(k + 1)) return true;
      used[c]--;
      pick[id] = -1;
    }
    return false;
  };
  if (!go(0)) return s.pieces.map((p) => STONES[p.id % STONES.length]);
  return pick.map((c) => STONES[c]);
}

/**
 * A piece: a mosaic of its cells. The shape is laid in a darker grout of its stone, and each
 * cell is a slightly raised tessera on it: a rounded square in the stone's color with a thin
 * lighter top edge.
 */
function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, ox: number, oy: number, cell: number, glow: number, selected: boolean, stone = STONES[p.id % STONES.length]): void {
  const cells = cellsOf(p);
  const inset = Math.max(1, cell * 0.06);
  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = stone;
    ctx.shadowBlur = cell * 0.6 * glow;
  }
  tracePath(ctx, outlinePolygons(cells), ox, oy, cell, inset, cell * 0.18);
  ctx.fillStyle = shade(stone, -0.38);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (selected) {
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const g = cell * 0.13, side = cell - 2 * g, rad = cell * 0.12, lip = Math.max(1, cell * 0.05);
  for (const c of cells) {
    const x = ox + c.x * cell + g, y = oy + c.y * cell + g;
    tile(ctx, x, y, side, side, rad, shade(stone, 0.28));
    tile(ctx, x, y + lip, side, side - lip, rad, stone);
  }
  ctx.restore();
}

/** The board: the shared board frame round the square of w by h cells, standing off them by
 *  framePad, a faint dot at the center of each open cell, and a stud on each hole. `open` says
 *  which cells belong to the board (all of them when absent). */
function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, bx: number, by: number, cell: number, color: string, open?: boolean[]): void {
  if (!(w > 0 && h > 0 && cell > 0)) return;
  drawFrame(ctx, frameBox(bx, by, w * cell, h * cell, cell), { width: frameWidth(cell), radius: cell * 0.2 + framePad(cell), color });
  ctx.save();
  ctx.fillStyle = C.surface3;
  const r = Math.max(1.5, cell * 0.035);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (open && !open[y * w + x]) continue;
    ctx.beginPath();
    ctx.arc(bx + (x + 0.5) * cell, by + (y + 0.5) * cell, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (open) for (let i = 0; i < open.length; i++) if (!open[i]) drawHole(ctx, bx + (i % w) * cell, by + Math.floor(i / w) * cell, cell, color);
}

/**
 * A hole: a cell cut out of the board, drawn as a stud in the frame's own color and line, set
 * into the middle of the cell, so it reads as part of the board's edge rather than a piece.
 */
function drawHole(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, color: string): void {
  const side = cell * 0.44, r = side * 0.3;
  tile(ctx, x + (cell - side) / 2, y + (cell - side) / 2, side, side, r, color);
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

// ---- rules ------------------------------------------------------------------------

type Shape = [number, number][];
/** The demo square is 3 by 3, filled by an L of four at its left and a P of five at its right. */
const ELL: Shape = [[0, 0], [0, 1], [0, 2], [1, 2]];
const PEE: Shape = [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]];
/** The P mirrored: it fills the P's place only once flipped over. */
const QUE: Shape = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]];
const ELL_AT: Cell = { x: 0, y: 0 };
const PEE_AT: Cell = { x: 1, y: 0 };
/** With the bottom right corner cut out, the P's place is a 2 by 2 square. */
const SQ: Shape = [[0, 0], [1, 0], [0, 1], [1, 1]];
const CORNER: Shape = [[2, 2]];

const demoPiece = (id: number, shape: Shape, rot: Rot = 0, flip = false): Piece => ({ id, shape: shape.map(([x, y]) => ({ x, y })), rot, flip, at: null });

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Progress through [a, b], eased. */
const seg = (T: number, a: number, b: number): number => ease(clamp01((T - a) / (b - a)));

interface DemoTable { cell: number; bx: number; by: number; tray: Area; tc: number }

/** A demo table: a board of gw x gh cells on the left and a tray on the right. */
function demoTable(w: number, h: number, gw: number, gh: number, trayShare = 0.36): DemoTable {
  const trayW = w * trayShare;
  const cell = Math.min((w - trayW - 16) / (gw + 0.6), (h - 12) / (gh + 0.6), 26);
  const bx = 6 + (w - trayW - 16 - cell * gw) / 2, by = (h - cell * gh) / 2;
  return { cell, bx, by, tray: { x: w - trayW - 4, y: 6, w: trayW, h: h - 12 }, tc: Math.min(cell * 0.6, 14) };
}

/** The square as the board draws it: the frame round it and a dot on each cell. */
function demoBoard(ctx: CanvasRenderingContext2D, T: DemoTable, side: number, rim: string = C.frame, holes: Shape = []): void {
  const open = Array(side * side).fill(true);
  for (const [x, y] of holes) open[y * side + x] = false;
  drawBoard(ctx, side, side, T.bx, T.by, T.cell, rim, open);
}

function demoTray(ctx: CanvasRenderingContext2D, T: DemoTable): void {
  tile(ctx, T.tray.x, T.tray.y, T.tray.w, T.tray.h, 8, C.plate);
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

/** Where a carried piece is held, still in hand, at the end of a picture about its shadow. */
const HELD = 0.66;

export const RULES: RuleCard[] = [
  {
    title: 'Fill the square',
    text: 'Drag pieces from the tray into the square until every cell is filled. The tray holds exactly the pieces that fill it, so every piece is used, and they fit in only one way.',
    good: {
      duration: 2.6,
      caption: 'Every piece in, every cell filled',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 3);
        const a = demoPiece(0, ELL), b = demoPiece(1, PEE);
        demoBoard(ctx, T, 3, t > 2.1 ? C.good : C.frame);
        demoTray(ctx, T);
        const ka = seg(t, 0.3, 1.1), kb = seg(t, 1.2, 2.0);
        if (ka === 0) demoInTray(ctx, T, a, 0, 2);
        if (kb === 0) demoInTray(ctx, T, b, 1, 2);
        if (ka > 0) demoCarry(ctx, T, a, traySpot(T, a, 0, 2), T.tc, ELL_AT, ka);
        if (kb > 0) demoCarry(ctx, T, b, traySpot(T, b, 1, 2), T.tc, PEE_AT, kb);
      },
    },
    bad: {
      duration: 2,
      caption: 'Split up, the last piece fits nowhere',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 3);
        const a = demoPiece(0, ELL, 1), b = demoPiece(1, PEE);
        demoBoard(ctx, T, 3);
        demoTray(ctx, T);
        const ka = seg(t, 0.3, 1.1);
        if (ka === 0) demoInTray(ctx, T, a, 0, 2);
        else demoCarry(ctx, T, a, traySpot(T, a, 0, 2), T.tc, { x: 0, y: 1 }, ka);
        demoInTray(ctx, T, b, 1, 2);
        const k = seg(t, 1.3, 1.6);
        demoHole(ctx, T, [[0, 0], [1, 0], [2, 0]], k);
        demoHole(ctx, T, [[1, 2], [2, 2]], k);
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
        const T = demoTable(w, h, 3, 3, 0.3);
        const a = demoPiece(0, ELL), b = demoPiece(1, PEE);
        demoBoard(ctx, T, 3);
        demoTray(ctx, T);
        drawPiece(ctx, b, T.bx + PEE_AT.x * T.cell, T.by + PEE_AT.y * T.cell, T.cell, 0, false);
        const k = seg(t, 0.3, 1.5) * HELD;
        if (k === 0) demoInTray(ctx, T, a, 0, 1);
        else demoCarry(ctx, T, a, traySpot(T, a, 0, 1), T.tc, ELL_AT, k);
      },
    },
    bad: {
      duration: 2,
      caption: "Amber: it won't fit there",
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 3, 0.3);
        const a = demoPiece(0, ELL), b = demoPiece(1, PEE);
        demoBoard(ctx, T, 3);
        demoTray(ctx, T);
        drawPiece(ctx, b, T.bx + PEE_AT.x * T.cell, T.by + PEE_AT.y * T.cell, T.cell, 0, false);
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
        const T = demoTable(w, h, 3, 3, 0.3);
        const a = demoPiece(0, ELL);
        demoBoard(ctx, T, 3);
        demoTray(ctx, T);
        const spot = traySpot(T, a, 0, 1);
        const k = seg(t, 0.3, 1.2);
        if (k > 0) {
          demoGhost(ctx, a, T.bx, T.by, T.cell);
          demoTrail(ctx, T.bx + T.cell, T.by + T.cell * 1.5, spot.x - 3, spot.y + T.tc, seg(t, 1.2, 1.4));
        }
        const x = T.bx + (spot.x - T.bx) * k, y = T.by + (spot.y - T.by) * k, cell = T.cell + (T.tc - T.cell) * k;
        drawPiece(ctx, a, x, y, cell, 0, k > 0 && k < 1);
        if (k > 0 && k < 1) demoFinger(ctx, x + cell * 0.5, y + cell * 0.5, T.cell * 0.2);
      },
    },
  },
  {
    title: 'Gaps stay empty',
    text: 'Each square has one to three cells cut out of it, shown as studs. Nothing goes there: fill every other cell. They are why the pieces fit in only one way.',
    good: {
      duration: 2.6,
      caption: 'Filled round the gap',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 3);
        const a = demoPiece(0, ELL), b = demoPiece(1, SQ);
        demoBoard(ctx, T, 3, t > 2.1 ? C.good : C.frame, CORNER);
        demoTray(ctx, T);
        const ka = seg(t, 0.3, 1.1), kb = seg(t, 1.2, 2.0);
        if (ka === 0) demoInTray(ctx, T, a, 0, 2);
        if (kb === 0) demoInTray(ctx, T, b, 1, 2);
        if (ka > 0) demoCarry(ctx, T, a, traySpot(T, a, 0, 2), T.tc, ELL_AT, ka);
        if (kb > 0) demoCarry(ctx, T, b, traySpot(T, b, 1, 2), T.tc, PEE_AT, kb);
      },
    },
    bad: {
      duration: 2,
      caption: 'Nothing goes on a gap',
      draw: (ctx, w, h, t) => {
        const T = demoTable(w, h, 3, 3);
        const a = demoPiece(0, ELL), b = demoPiece(1, SQ);
        demoBoard(ctx, T, 3, C.frame, CORNER);
        demoTray(ctx, T);
        demoInTray(ctx, T, a, 0, 2);
        const k = seg(t, 0.3, 1.5) * HELD;
        if (k === 0) demoInTray(ctx, T, b, 1, 2);
        else demoCarry(ctx, T, b, traySpot(T, b, 1, 2), T.tc, { x: 1, y: 1 }, k, false);
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
 * The flip pictures: a 3 by 3 square with an L in place and a P-shaped space beside it, and the
 * mirrored P in the tray above the flip button. Flipped first, the piece drops in; carried over
 * as it is, its shadow shows it will not fit.
 */
function flipPicture(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, flip: boolean): void {
  const T = demoTable(w, h, 3, 3);
  demoBoard(ctx, T, 3, flip && t > 2.6 ? C.good : C.frame);
  drawPiece(ctx, demoPiece(1, ELL), T.bx + ELL_AT.x * T.cell, T.by + ELL_AT.y * T.cell, T.cell, 0, false);
  demoTray(ctx, T);
  const side = Math.min(32, T.tray.w * 0.62, T.tray.h * 0.42);
  const f = { x: T.tray.x + (T.tray.w - side) / 2, y: T.tray.y + T.tray.h - side - 6, w: side, h: side };
  const flipped = flip && t > 1.05;
  const p = demoPiece(0, QUE, 0, flipped);
  const b = bounds(cellsOf(p));
  const from = { x: T.tray.x + (T.tray.w - b.w * T.tc) / 2, y: T.tray.y + (f.y - T.tray.y - b.h * T.tc) / 2 };
  demoFlip(ctx, f, flip && t > 0.85 && t < 1.05);
  if (flip) {
    // Choose it, press flip, then carry it over.
    const k = seg(t, 1.4, 2.4);
    if (k === 0) drawPiece(ctx, p, from.x, from.y, T.tc, flipped && t < 1.4 ? 1 - seg(t, 1.05, 1.4) : 0, t > 0.45);
    else demoCarry(ctx, T, p, from, T.tc, PEE_AT, k);
    if (t > 0.25 && t < 0.55) demoFinger(ctx, from.x + T.tc * 0.5, from.y + T.tc * 1.5, T.cell * 0.2);
    if (t > 0.7 && t < 1.1) demoFinger(ctx, f.x + f.w * 0.66, f.y + f.h * 0.7, T.cell * 0.2);
  } else {
    const k = seg(t, 0.3, 1.5) * HELD;
    if (k === 0) drawPiece(ctx, p, from.x, from.y, T.tc, 0, false);
    else demoCarry(ctx, T, p, from, T.tc, PEE_AT, k, false);
  }
}
