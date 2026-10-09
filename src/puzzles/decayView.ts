// Drawing and touch for Decay Path: a window of the chart of nuclides, a lit
// droplet on the current nucleus, and up to three labelled arrows for the steps
// it can take. Tap an arrow or its destination tile to step.

import { allowedMoves, applyDecay, cloneDecay, COLS, destination, MOVE_LABEL, MOVES, ROWS, shortestPath, solved, stuck, symbolOf, type DecayMove, type DecayState, type Nuclide } from './decay';
import { droplet, ease, MONO, type Area, type Point, type PuzzleView } from './view';

const STEP_MS = 220;
const TAP = 12;

export class DecayView implements PuzzleView {
  private state: DecayState;
  private history: DecayState[] = [];
  private pressed: Point | null = null;
  /** Where the droplet is coming from, for the step animation. */
  private from: Nuclide | null = null;
  private animAt = 0;
  private flash = 0;
  private reduced: boolean;
  // Layout, refreshed every frame.
  private origin: Point = { x: 0, y: 0 };
  private cell = 40;

  constructor(private readonly initial: DecayState, reducedMotion: boolean) {
    this.state = cloneDecay(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return stuck(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    const s = this.state;
    if (this.won) return `A solid tile: this ${symbolOf(s.pos.z)} nucleus is stable. The walk is over.`;
    if (this.stuck) return 'No known nuclide lies that way. Undo a step, or restart.';
    if (s.moves === 0) return 'Tap an <span class="hl">arrow</span> to step: α sheds two protons and two neutrons, β⁻ turns a neutron into a proton, β⁺ the reverse. Reach a <span class="hl">solid tile</span>.';
    const path = shortestPath(s);
    if (path && path.length === 1) return 'One more step lands on a stable tile.';
    return 'Dashed tiles are unstable, solid ones stable, blanks unknown. Keys 1, 2, 3 take α, β⁻, β⁺.';
  }

  restart(): void {
    this.state = cloneDecay(this.initial);
    this.history = [];
    this.from = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.from = this.state.pos;
    this.state = prev;
    this.animAt = performance.now();
    return true;
  }

  private step(m: DecayMove): boolean {
    const next = applyDecay(this.state, m);
    if (!next) {
      this.flash = performance.now();
      return false;
    }
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.from = this.state.pos;
    this.state = next;
    this.animAt = performance.now();
    return true;
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): void {
    const labelW = 34;
    const cell = Math.floor(Math.min((area.w - labelW - 24) / COLS, (area.h - 44) / ROWS));
    this.cell = Math.max(24, cell);
    const bw = this.cell * COLS, bh = this.cell * ROWS;
    this.origin = { x: area.x + labelW + (area.w - labelW - bw) / 2, y: area.y + 18 + (area.h - 36 - bh) / 2 };
  }

  /** Centre of a nuclide's tile; proton count grows upward. */
  private centre(q: Nuclide): Point {
    const c = q.n - this.state.n0, r = q.z - this.state.z0;
    return { x: this.origin.x + (c + 0.5) * this.cell, y: this.origin.y + (ROWS - 1 - r + 0.5) * this.cell };
  }

  private moveAt(p: Point): DecayMove | null {
    const s = this.state;
    let best: DecayMove | null = null, bestD = Infinity;
    for (const m of allowedMoves(s)) {
      const dest = this.centre(destination(s.pos, m));
      const label = this.labelPoint(m);
      const d = Math.min(Math.hypot(p.x - dest.x, p.y - dest.y), Math.hypot(p.x - label.x, p.y - label.y));
      if (d < Math.max(20, this.cell * 0.55) && d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  private labelPoint(m: DecayMove): Point {
    const a = this.centre(this.state.pos), b = this.centre(destination(this.state.pos, m));
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s || this.won) return;
    if (Math.hypot(p.x - s.x, p.y - s.y) > TAP) return;
    const m = this.moveAt(p);
    if (m) this.step(m);
    else this.flash = performance.now();
  }

  key(e: KeyboardEvent): boolean {
    if (/^[1-3]$/.test(e.key)) { this.step(MOVES[Number(e.key) - 1]); return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.layout(area);
    const s = this.state;
    const cs = this.cell;
    const flash = now - this.flash < 220;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Axis captions: letters only, no counts.
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(226, 220, 207, 0.4)';
    ctx.fillText('neutrons →', this.origin.x + cs * COLS - 34, this.origin.y + cs * ROWS + 12);
    ctx.save();
    ctx.translate(this.origin.x - 28, this.origin.y + 24);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('protons →', 0, 0);
    ctx.restore();

    // Tiles.
    for (let r = 0; r < ROWS; r++) {
      const z = s.z0 + r;
      const y = this.origin.y + (ROWS - 1 - r) * cs;
      // Row label: the element's symbol.
      ctx.font = `${Math.max(10, Math.min(13, cs * 0.3))}px ${MONO}`;
      ctx.fillStyle = z === s.pos.z ? 'rgba(226, 220, 207, 0.85)' : 'rgba(226, 220, 207, 0.4)';
      ctx.textAlign = 'right';
      if (z >= 1) ctx.fillText(symbolOf(z), this.origin.x - 8, y + cs / 2);
      ctx.textAlign = 'center';
      for (let c = 0; c < COLS; c++) {
        const kind = s.cells[r][c];
        const x = this.origin.x + c * cs;
        const pad = Math.max(3, cs * 0.1);
        if (kind === 'none') {
          ctx.fillStyle = 'rgba(226, 220, 207, 0.1)';
          ctx.beginPath();
          ctx.arc(x + cs / 2, y + cs / 2, 1, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        if (kind === 'stable') {
          const g = ctx.createLinearGradient(x, y, x + cs, y + cs);
          g.addColorStop(0, 'rgba(226, 220, 207, 0.82)');
          g.addColorStop(1, 'rgba(170, 164, 152, 0.82)');
          ctx.fillStyle = g;
          ctx.fillRect(x + pad, y + pad, cs - 2 * pad, cs - 2 * pad);
        } else {
          ctx.strokeStyle = 'rgba(226, 220, 207, 0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x + pad + 0.5, y + pad + 0.5, cs - 2 * pad - 1, cs - 2 * pad - 1);
          ctx.setLineDash([]);
        }
      }
    }

    // The trail: a thin line through every tile visited so far.
    if (s.path.length > 1) {
      ctx.strokeStyle = 'rgba(226, 220, 207, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      s.path.forEach((q, i) => {
        const p = this.centre(q);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      for (const q of s.path.slice(0, -1)) {
        const p = this.centre(q);
        droplet(ctx, p.x, p.y, Math.max(3, cs * 0.09), false, 0.6);
      }
    }

    // Where the droplet is now, easing in from the last tile.
    const t = this.reduced || !this.from ? 1 : ease((now - this.animAt) / STEP_MS);
    const to = this.centre(s.pos);
    const fr = this.from ? this.centre(this.from) : to;
    const d = { x: fr.x + (to.x - fr.x) * t, y: fr.y + (to.y - fr.y) * t };

    // Arrows for the steps on offer, each with its Greek letter.
    if (!this.won && t >= 1) {
      for (const m of allowedMoves(s)) {
        const b = this.centre(destination(s.pos, m));
        const ang = Math.atan2(b.y - to.y, b.x - to.x);
        const r0 = cs * 0.32, r1 = Math.hypot(b.x - to.x, b.y - to.y) - cs * 0.3;
        ctx.strokeStyle = flash ? 'rgba(224, 80, 58, 0.9)' : 'rgba(243, 238, 226, 0.75)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(to.x + Math.cos(ang) * r0, to.y + Math.sin(ang) * r0);
        ctx.lineTo(to.x + Math.cos(ang) * r1, to.y + Math.sin(ang) * r1);
        ctx.stroke();
        const tip = { x: to.x + Math.cos(ang) * (r1 + 5), y: to.y + Math.sin(ang) * (r1 + 5) };
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - Math.cos(ang - 0.5) * 8, tip.y - Math.sin(ang - 0.5) * 8);
        ctx.lineTo(tip.x - Math.cos(ang + 0.5) * 8, tip.y - Math.sin(ang + 0.5) * 8);
        ctx.closePath();
        ctx.fill();
        // The label sits in a small chip beside the arrow's middle.
        const lp = this.labelPoint(m);
        const off = { x: -Math.sin(ang) * cs * 0.3, y: Math.cos(ang) * cs * 0.3 };
        const chip = { x: lp.x + off.x, y: lp.y + off.y };
        ctx.fillStyle = 'rgba(16, 16, 16, 0.9)';
        ctx.beginPath();
        ctx.arc(chip.x, chip.y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(226, 220, 207, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = `12px ${MONO}`;
        ctx.fillStyle = 'rgba(243, 238, 226, 0.95)';
        ctx.fillText(MOVE_LABEL[m], chip.x, chip.y + 1);
      }
    }

    // The goal ring on the stable tile reached.
    if (this.won && t >= 1) {
      ctx.strokeStyle = '#e0503a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(to.x, to.y, cs * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }

    droplet(ctx, d.x, d.y, Math.max(6, cs * 0.22), true);
  }
}
