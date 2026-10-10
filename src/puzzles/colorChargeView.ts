// Drawing and touch for Color Charge: drag across tiles (or tap them one by
// one) to pick a group; a color-neutral group binds and turns white.

import { adjacent, bind, canFinish, cloneCharge, COLOR_LETTERS, groupKind, solved, type ColorChargeState } from './colorCharge';
import { C, fitGrid, font, tile } from './palette';
import type { Area, Point, PuzzleView } from './view';

/** The three charge colors from the palette, read at draw time; letters carry them too. */
export const chargeColor = (k: number): string => [C.bad, C.good, C.s][k];

const FAIL_MS = 380;

export const INSTRUCTIONS = `
<h3>How to play</h3>
<p>Every tile is a <b>quark</b> with a color charge: <b>r</b>ed, <b>g</b>reen or <b>b</b>lue. Only color-neutral groups can stand on their own, so bind the tiles into neutral groups until the grid is clear.</p>
<ul>
  <li><b>Baryon:</b> three tiles in a connected line or L, one red, one green, one blue. Drag across them (or tap them one after another) and they bind and turn white.</li>
  <li><b>Meson:</b> on heavier elements some tiles are hollow: <b>antiquarks</b>, carrying an anticolor (shown with a bar over the letter). A quark next to the antiquark of its own color, say r and r̄, binds as a pair.</li>
  <li>Every tile must end up in a group. Bind greedily and you may strand a tile with no partner; the status line says so, and Undo unbinds the last group.</li>
</ul>
<h3>In the game</h3>
<p>Reserve puzzle, kept simple so it can be judged; a candidate for a quarks chapter.</p>
<ul>
  <li>z 1-10: 3x3, three baryons. z 11-30: 4x3. z 31-54: 4x4 with two mesons. z 55-86: 4x5 with four mesons. z 87-118: 5x5 with five mesons.</li>
  <li>Each grid is dealt from a tiling into groups that work, and kept only if that is its one and only clearance: every grid has exactly one answer.</li>
  <li>Par is the number of groups in a clearance. Every bind counts as a move; Undo is free and takes the move back. Clean means clearing the grid within par.</li>
</ul>
<p>Science: color charge is a name, not a color, and quarks do not sit on a grid. That baryons are three quarks of all three colors and mesons a quark plus an antiquark, both color-neutral, is real.</p>`;

export class ColorChargeView implements PuzzleView {
  private state: ColorChargeState;
  private history: ColorChargeState[] = [];
  /** The tiles picked so far, in order. */
  private sel: number[] = [];
  private dragging = false;
  private changed = false;
  private pendingRemove = -1;
  private fail: { cells: number[]; at: number } | null = null;
  private finishable = true;
  private grid = { cell: 1, x: 0, y: 0 };
  private reduced: boolean;

  constructor(private readonly initial: ColorChargeState, reducedMotion: boolean) {
    this.state = cloneCharge(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'All color-neutral';
    if (!this.finishable) return 'A tile is stranded: undo a group';
    return `${this.state.groups.length} / ${this.state.par} bound`;
  }

  restart(): void {
    this.state = cloneCharge(this.initial);
    this.history = [];
    this.sel = [];
    this.finishable = true;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = { ...prev };
    this.sel = [];
    this.finishable = canFinish(this.state);
    return true;
  }

  private tryBind(): void {
    const next = bind(this.state, this.sel);
    if (next) {
      this.history.push(this.state);
      if (this.history.length > 50) this.history.shift();
      this.state = next;
      this.sel = [];
      this.finishable = canFinish(next);
      return;
    }
    if (this.sel.length >= 3) {
      this.fail = { cells: this.sel, at: performance.now() };
      this.sel = [];
    }
  }

  // ---- input ----------------------------------------------------------------------

  private tileAt(p: Point, strict: boolean): number {
    const { cell, x, y } = this.grid;
    const fc = (p.x - x) / cell, fr = (p.y - y) / cell;
    const c = Math.floor(fc), r = Math.floor(fr);
    if (c < 0 || r < 0 || c >= this.state.cols || r >= this.state.rows) return -1;
    // While dragging, only the middle of a tile counts, so cutting a corner does not pick a diagonal.
    if (strict && Math.hypot(fc - c - 0.5, fr - r - 0.5) > 0.42) return -1;
    return r * this.state.cols + c;
  }

  private free(i: number): boolean { return i >= 0 && this.state.bound[i] < 0; }

  down(p: Point): void {
    if (this.won) return;
    const t = this.tileAt(p, false);
    this.dragging = true;
    this.changed = false;
    this.pendingRemove = -1;
    if (!this.free(t)) { this.sel = []; return; }
    if (this.sel.includes(t)) { this.pendingRemove = t; return; }
    if (this.sel.length && this.sel.length < 3 && this.sel.some((j) => adjacent(this.state.cols, j, t))) this.sel = [...this.sel, t];
    else this.sel = [t];
    this.changed = true;
  }

  move(p: Point): void {
    if (!this.dragging || !this.sel.length) return;
    const t = this.tileAt(p, true);
    if (t < 0 || t === this.sel[this.sel.length - 1]) return;
    if (t === this.sel[this.sel.length - 2]) {
      this.sel = this.sel.slice(0, -1);
      this.changed = true;
      return;
    }
    if (this.free(t) && !this.sel.includes(t) && this.sel.length < 3 && adjacent(this.state.cols, this.sel[this.sel.length - 1], t)) {
      this.sel = [...this.sel, t];
      this.changed = true;
    }
  }

  up(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.pendingRemove >= 0 && !this.changed) {
      this.sel = this.sel.filter((i) => i !== this.pendingRemove);
      this.pendingRemove = -1;
      return;
    }
    this.tryBind();
  }

  cancel(): void {
    this.dragging = false;
    this.sel = [];
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.sel.length) { this.sel = []; return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const g = fitGrid(area, s.cols, s.rows, { margin: 10, maxCell: 72 });
    this.grid = { cell: g.cell, x: g.x, y: g.y };
    const c = g.cell, pad = Math.max(3, c * 0.08), w = c - pad * 2, rad = c * 0.18;
    const center = (i: number) => ({ x: g.x + (i % s.cols + 0.5) * c, y: g.y + (Math.floor(i / s.cols) + 0.5) * c });

    // Bound groups: a white bar under each pair of neighbors, so a group reads as one particle.
    ctx.save();
    ctx.lineCap = 'round';
    for (const grp of s.groups) {
      ctx.strokeStyle = C.silverDim;
      ctx.lineWidth = c * 0.42;
      ctx.beginPath();
      for (let a = 0; a < grp.length; a++) {
        for (let b = a + 1; b < grp.length; b++) {
          if (!adjacent(s.cols, grp[a], grp[b])) continue;
          const p = center(grp[a]), q = center(grp[b]);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();

    const failT = this.fail && !this.reduced ? (now - this.fail.at) / FAIL_MS : 1;
    if (failT >= 1) this.fail = null;

    for (let i = 0; i < s.tiles.length; i++) {
      const q = s.tiles[i];
      let { x, y } = center(i);
      if (this.fail?.cells.includes(i)) x += Math.sin(failT * Math.PI * 6) * c * 0.06 * (1 - failT);
      const tx = x - w / 2, ty = y - w / 2;
      const color = chargeColor(q.color);
      if (s.bound[i] >= 0) {
        const glow = this.won ? 1 : 0;
        ctx.save();
        if (glow) { ctx.shadowColor = C.silver; ctx.shadowBlur = c * 0.2; }
        tile(ctx, tx, ty, w, w, rad, C.tile);
        ctx.restore();
        // A small mark of the color it brought, so a finished board still reads.
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, c * 0.08, 0, Math.PI * 2);
        if (q.anti) { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
        else ctx.fill();
        continue;
      }
      if (q.anti) {
        tile(ctx, tx + 1.25, ty + 1.25, w - 2.5, w - 2.5, rad, C.surface2, color, 2.5);
        letter(ctx, x, y, w, COLOR_LETTERS[q.color], color, true);
      } else {
        tile(ctx, tx, ty, w, w, rad, color);
        letter(ctx, x, y, w, COLOR_LETTERS[q.color], C.tileInk, false);
      }
    }

    // The pick: the selection outline and a line through the picked tiles in order.
    if (this.sel.length) {
      ctx.save();
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.sel.forEach((i, k) => {
        const p = center(i);
        if (k === 0) ctx.moveTo(p.x, p.y + w * 0.32);
        else ctx.lineTo(p.x, p.y + w * 0.32);
      });
      if (this.sel.length > 1) ctx.stroke();
      for (const i of this.sel) {
        const p = center(i);
        tile(ctx, p.x - w / 2 - 2.5, p.y - w / 2 - 2.5, w + 5, w + 5, rad * 1.1, null, C.accent, 2);
      }
      // A pair that can never become neutral gets a soft amber ring.
      if (hopeless(s, this.sel)) {
        for (const i of this.sel) {
          const p = center(i);
          tile(ctx, p.x - w / 2 - 2.5, p.y - w / 2 - 2.5, w + 5, w + 5, rad * 1.1, null, C.warn, 2);
        }
      }
      ctx.restore();
    }
  }
}

/** Two picked tiles that no third tile could make neutral. */
function hopeless(s: ColorChargeState, sel: number[]): boolean {
  if (sel.length !== 2) return false;
  const [a, b] = sel.map((i) => s.tiles[i]);
  if (groupKind(s.tiles, sel)) return false;
  return a.anti !== b.anti || a.color === b.color;
}

function letter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, text: string, color: string, bar: boolean): void {
  ctx.fillStyle = color;
  ctx.font = font(w * 0.46, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + w * 0.02);
  if (bar) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, w * 0.045);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.12, y - w * 0.2);
    ctx.lineTo(x + w * 0.12, y - w * 0.2);
    ctx.stroke();
  }
}
