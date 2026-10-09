// Drawing and touch for Sliding Block: drag a bar along its axis; the red key
// bar leaves through the gap on the right.

import { applySlide, slack, solved, type Block, type SlidingState } from './sliding';
import { ease, MONO, type Area, type Point, type PuzzleView } from './view';

const SNAP_MS = 120;
const EXIT_MS = 500;

interface Drag {
  id: number;
  start: Point;
  /** Cells the bar has been pulled along its axis so far (fractional). */
  offset: number;
  back: number;
  fwd: number;
}

export class SlidingView implements PuzzleView {
  private state: SlidingState;
  private history: SlidingState[] = [];
  private drag: Drag | null = null;
  private snap: { id: number; from: number; at: number } | null = null;
  private wonAt = 0;
  private reduced: boolean;
  private cell = 1;
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
    if (this.won) return 'The key piece is out.';
    if (this.state.moves === 0) return '<span class="hl">Drag a bar</span> along its length. Clear the way so the <span class="hl">red bar</span> can slide out through the gap.';
    const s = slack(this.state, 0);
    if (s.fwd > 0 && this.state.blocks[0].x + this.state.blocks[0].len + s.fwd >= this.state.size) return 'The way is clear: slide the red bar out.';
    return 'Bars only move along their own length. Every slide counts as one move.';
  }

  restart(): void {
    this.state = this.initial;
    this.history = [];
    this.drag = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    return true;
  }

  private commit(next: SlidingState): void {
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    if (solved(next)) this.wonAt = performance.now();
  }

  private blockAt(p: Point): Block | null {
    const cx = (p.x - this.origin.x) / this.cell, cy = (p.y - this.origin.y) / this.cell;
    for (const b of this.state.blocks) {
      const w = b.horiz ? b.len : 1, h = b.horiz ? 1 : b.len;
      if (cx >= b.x && cx < b.x + w && cy >= b.y && cy < b.y + h) return b;
    }
    return null;
  }

  down(p: Point): void {
    if (this.won) return;
    const b = this.blockAt(p);
    if (!b) return;
    const { back, fwd } = slack(this.state, b.id);
    this.drag = { id: b.id, start: p, offset: 0, back, fwd };
  }

  move(p: Point): void {
    const d = this.drag;
    if (!d) return;
    const b = this.state.blocks.find((x) => x.id === d.id)!;
    const raw = (b.horiz ? p.x - d.start.x : p.y - d.start.y) / this.cell;
    d.offset = Math.max(-d.back, Math.min(d.fwd, raw));
  }

  up(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const by = Math.round(d.offset);
    const next = applySlide(this.state, { id: d.id, by });
    this.snap = { id: d.id, from: d.offset - by, at: performance.now() };
    if (next) this.commit(next);
  }

  cancel(): void { this.drag = null; }

  key(e: KeyboardEvent): boolean {
    // Arrow keys nudge the key bar; digits pick other bars rarely matter on a phone.
    if (e.key === 'ArrowRight') { const n = applySlide(this.state, { id: 0, by: 1 }); if (n) this.commit(n); return true; }
    if (e.key === 'ArrowLeft') { const n = applySlide(this.state, { id: 0, by: -1 }); if (n) this.commit(n); return true; }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const n = this.state.size;
    const side = Math.min(area.w, area.h - 40) * 0.92;
    this.cell = side / n;
    this.origin = { x: area.x + (area.w - side) / 2, y: area.y + 30 + (area.h - 30 - side) / 2 };
    const { x: x0, y: y0 } = this.origin;
    const c = this.cell;

    // The tray: a ruled board with a gap in the right wall on the exit row.
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    for (let i = 0; i < n * n; i++) ctx.strokeRect(x0 + (i % n) * c + 3, y0 + Math.floor(i / n) * c + 3, c - 6, c - 6);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + side, y0);
    ctx.lineTo(x0 + side, y0 + this.state.exitRow * c);
    ctx.moveTo(x0 + side, y0 + (this.state.exitRow + 1) * c);
    ctx.lineTo(x0 + side, y0 + side);
    ctx.lineTo(x0, y0 + side);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + side, y0);
    ctx.stroke();
    // The exit marker.
    ctx.fillStyle = '#e0503a';
    ctx.beginPath();
    ctx.moveTo(x0 + side + 6, y0 + (this.state.exitRow + 0.35) * c);
    ctx.lineTo(x0 + side + 16, y0 + (this.state.exitRow + 0.5) * c);
    ctx.lineTo(x0 + side + 6, y0 + (this.state.exitRow + 0.65) * c);
    ctx.fill();

    const exitT = this.won && !this.reduced ? Math.min(1, (now - this.wonAt) / EXIT_MS) : this.won ? 1 : 0;
    for (const b of this.state.blocks) {
      let off = 0;
      if (this.drag?.id === b.id) off = this.drag.offset;
      else if (this.snap?.id === b.id && !this.reduced) {
        const t = (now - this.snap.at) / SNAP_MS;
        off = t < 1 ? this.snap.from * (1 - ease(t)) : 0;
      }
      if (b.id === 0 && this.won) off += exitT * 3;
      const bx = x0 + (b.x + (b.horiz ? off : 0)) * c;
      const by = y0 + (b.y + (b.horiz ? 0 : off)) * c;
      this.drawBlock(ctx, b, bx, by, c, b.id === 0 ? 1 - exitT * 0.8 : 1);
    }
  }

  private drawBlock(ctx: CanvasRenderingContext2D, b: Block, x: number, y: number, c: number, alpha: number): void {
    const w = (b.horiz ? b.len : 1) * c - 8, h = (b.horiz ? 1 : b.len) * c - 8;
    const key = b.id === 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    if (key) { g.addColorStop(0, '#f0735e'); g.addColorStop(1, '#b4392a'); }
    else { g.addColorStop(0, '#ece6d8'); g.addColorStop(1, '#9a9284'); }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, w, h, c * 0.3);
    ctx.fill();
    // Nucleon dots along the bar.
    const count = b.len * 2;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const px = b.horiz ? x + 4 + w * t : x + c / 2;
      const py = b.horiz ? y + c / 2 : y + 4 + h * t;
      ctx.fillStyle = key ? 'rgba(60, 20, 14, 0.5)' : i % 2 ? 'rgba(120, 114, 104, 0.8)' : 'rgba(214, 150, 60, 0.8)';
      ctx.beginPath();
      ctx.arc(px, py, c * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    if (key) {
      ctx.fillStyle = 'rgba(255, 240, 230, 0.9)';
      ctx.font = `700 ${Math.round(c * 0.34)}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('key', x + 4 + w / 2, y + 4 + h / 2 + 1);
    }
    ctx.restore();
  }
}
