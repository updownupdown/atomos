// Drawing and touch for Light Routing: tap a turnable piece to flip it; the
// beam redraws at once, growing out from the lamp. Arrows move a cursor,
// space or Enter flips under it, Tab jumps between turnable pieces.

import { cloneLight, DELTA, filterHue, flip, isSplitter, slant, status, targetLit, trace, turnable, type Cell, type Hue, type LightState } from './light';
import { bead, C, fitGrid, font, tile } from './palette';
import { type Area, type Point, type PuzzleView } from './view';

/** Milliseconds for the light to cross one cell as it grows after a flip. */
const STEP_MS = 40;

export const INSTRUCTIONS = `
<h3>How to play</h3>
<p>A lamp at the rim shines a beam into the grid. <b>Tap a mirror</b> to flip it between / and \\; the beam redraws at once. Light every <b>red ring</b> to win.</p>
<ul>
  <li><b>Mirrors</b> on a raised tile with a pivot bead turn when tapped. They bounce the beam through a right angle.</li>
  <li><b>Fixed mirrors</b> are darker, hatched on the back and sit flat. They bounce the beam too, but cannot be turned.</li>
  <li><b>Splitters</b> are dashed panes on a raised tile: half-silvered glass. The beam goes straight through <i>and</i> bounces off, so one beam becomes two. Tap to flip them like mirrors.</li>
  <li><b>Colour filters</b> are tinted squares. White light leaves them tinted that colour. Light already of that colour passes; light of any other colour is absorbed and stops.</li>
  <li><b>Coloured rings</b> need light of their own colour; a plain red ring takes any light.</li>
  <li><b>Dark sensors</b> (dark discs with a bar) must stay unlit. A lit one flares amber and the puzzle is not solved.</li>
  <li>Grey blocks stop the beam.</li>
</ul>
<p>Keyboard: arrows move the cursor, Space or Enter flips under it, Tab jumps to the next turnable piece.</p>
<h3>In the game</h3>
<p>A gate puzzle. The grid grows from 5×5 (H to Cu, z 1–29) to 6×6 (Zn to Au, 30–79) and 7×7 (from Hg, 80). Pieces arrive in bands, each one always present in its own band and mixed in later: fixed mirrors from Na (11), dark sensors from Fe (26), splitters from Nb (41), colour filters from Pm (61); from Tl (81) each level draws two or three of the four. Rings go from two to three at Sn (50); dark sensors from one to two at Yb (70); coloured rings appear only with filters.</p>
<p>Every level is built from a solved layout whose beam is walked out piece by piece, then scrambled by flipping 1 to 4 turnable pieces the beam uses (1 + z/30). Par is that number of flips, and the generator checks no smaller set of taps solves it, so par is the true minimum. Each flip is one move; dark sensors are placed only where a wrong flip would send light.</p>
`;

const hueColour = (h: Hue): string => (h === 'w' ? C.silver : C[h]);

export class LightView implements PuzzleView {
  private state: LightState;
  private history: LightState[] = [];
  private pressed: Point | null = null;
  private cursor: number;
  private showCursor = false;
  private flashAt = -1e9;
  private bump: { cell: number; at: number } | null = null;
  private origin: Point = { x: 0, y: 0 };
  private cell = 40;
  private reduced: boolean;

  constructor(private readonly initial: LightState, reducedMotion: boolean) {
    this.state = cloneLight(initial);
    this.reduced = reducedMotion;
    this.cursor = Math.max(0, initial.cells.findIndex(turnable));
  }

  get won(): boolean { return status(this.state).won; }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    const st = status(this.state);
    if (st.won) return 'Every ring is lit';
    if (st.darkLit.length) return st.darkLit.length === 1 ? 'A dark sensor is lit' : `${st.darkLit.length} dark sensors are lit`;
    if (st.wrongHue.length) return st.wrongHue.length === 1 ? 'A ring has the wrong colour' : `${st.wrongHue.length} rings have the wrong colour`;
    return '';
  }

  restart(): void {
    this.state = cloneLight(this.initial);
    this.history = [];
    this.flashAt = performance.now();
    this.bump = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.flashAt = performance.now();
    return true;
  }

  private tryFlip(i: number): void {
    if (this.won || i < 0) return;
    const next = flip(this.state, i);
    if (!next) {
      if (this.state.cells[i] !== '.') this.bump = { cell: i, at: performance.now() };
      return;
    }
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    this.cursor = i;
    this.flashAt = performance.now();
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): { statusY: number } {
    const n = this.state.size;
    // Half a cell round the grid for the lamp and the beam's exit stubs; a line below for the count.
    const fit = fitGrid(area, n + 1.1, n + 1.1, { margin: 6, bottom: 18, maxCell: 72 });
    this.cell = fit.cell;
    this.origin = { x: fit.x + 0.55 * fit.cell, y: fit.y + 0.55 * fit.cell };
    return { statusY: fit.y + fit.h + 2 };
  }

  private cellAt(p: Point): number {
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.state.size || cy >= this.state.size) return -1;
    return cy * this.state.size + cx;
  }

  private centre(i: number): Point {
    const n = this.state.size;
    return { x: this.origin.x + ((i % n) + 0.5) * this.cell, y: this.origin.y + (Math.floor(i / n) + 0.5) * this.cell };
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s || Math.hypot(p.x - s.x, p.y - s.y) > Math.max(14, this.cell * 0.35)) return;
    this.showCursor = false;
    this.tryFlip(this.cellAt(s));
  }

  key(e: KeyboardEvent): boolean {
    const n = this.state.size;
    const d: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (d[e.key]) {
      e.preventDefault();
      if (this.showCursor) {
        const x = Math.max(0, Math.min(n - 1, (this.cursor % n) + d[e.key][0]));
        const y = Math.max(0, Math.min(n - 1, Math.floor(this.cursor / n) + d[e.key][1]));
        this.cursor = y * n + x;
      }
      this.showCursor = true;
      return true;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.showCursor = true;
      this.tryFlip(this.cursor);
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const pieces = this.state.cells.map((c, i) => (turnable(c) ? i : -1)).filter((i) => i >= 0);
      if (pieces.length) {
        const after = pieces.find((i) => i > this.cursor);
        const before = [...pieces].reverse().find((i) => i < this.cursor);
        this.cursor = e.shiftKey ? (before ?? pieces[pieces.length - 1]) : (after ?? pieces[0]);
      }
      this.showCursor = true;
      return true;
    }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const { statusY } = this.layout(area);
    const s = this.state;
    const n = s.size;
    const c = this.cell;
    const half = c / 2;
    const beam = trace(s);
    const st = status(s);
    const won = st.won;
    ctx.save();

    // Tiles: raised where a tap does something.
    for (let i = 0; i < n * n; i++) {
      const p = this.centre(i);
      const raised = turnable(s.cells[i]);
      const inset = c * 0.05;
      tile(ctx, p.x - half + inset, p.y - half + inset, c - inset * 2, c - inset * 2, c * 0.18, raised ? C.surface3 : C.surface, raised ? C.line2 : null, 1);
    }

    // The beam, grown out from the lamp by steps since the last change.
    const progress = this.reduced ? Infinity : (now - this.flashAt) / STEP_MS;
    const paths = new Map<Hue, Path2D>();
    const pathFor = (h: Hue) => paths.get(h) ?? paths.set(h, new Path2D()).get(h)!;
    const seg = (h: Hue, a: Point, b: Point, f: number) => {
      if (f <= 0) return;
      const p = pathFor(h);
      p.moveTo(a.x, a.y);
      p.lineTo(a.x + (b.x - a.x) * Math.min(1, f), a.y + (b.y - a.y) * Math.min(1, f));
    };
    const e = this.centre(s.entry);
    const [edx, edy] = DELTA[s.entryDir];
    const lamp = { x: e.x - edx * c * 0.85, y: e.y - edy * c * 0.85 };
    seg('w', lamp, { x: e.x - edx * half, y: e.y - edy * half }, 1);
    for (const v of beam.visits) {
      const f = progress - v.depth;
      if (f <= 0) continue;
      const p = this.centre(v.cell);
      const [dx, dy] = DELTA[v.dir];
      const edge = { x: p.x - dx * half, y: p.y - dy * half };
      if (v.stop === 'edge') { seg(v.hue, edge, { x: edge.x + dx * c * 0.12, y: edge.y + dy * c * 0.12 }, f * 2); continue; }
      seg(v.hue, edge, p, f * 2);
      for (const o of v.outs) {
        const [ox, oy] = DELTA[o];
        const reach = v.exits.includes(o) ? half + c * 0.4 : half;
        seg(v.outHue, p, { x: p.x + ox * reach, y: p.y + oy * reach }, f * 2 - 1);
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [h, p] of paths) {
      const col = hueColour(h);
      ctx.save();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = Math.max(5, c * 0.14);
      if (!this.reduced) { ctx.shadowColor = col; ctx.shadowBlur = c * 0.18; }
      ctx.stroke(p);
      ctx.restore();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(2, c * 0.045);
      ctx.stroke(p);
    }

    // Pieces.
    const lit = beam.lit;
    for (let i = 0; i < n * n; i++) this.piece(ctx, s.cells[i], this.centre(i), lit.has(i));

    // Sensors: target rings and dark discs.
    for (const t of s.targets) {
      const p = this.centre(t.cell);
      const on = targetLit(t, lit);
      const col = t.hue === 'w' ? C.target : C[t.hue];
      const r = half * 0.44;
      ctx.save();
      if (on) {
        if (!this.reduced) { ctx.shadowColor = col; ctx.shadowBlur = c * 0.3; }
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(2, c * 0.05);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // A coloured ring keeps a small red heart, so it still reads as a goal.
      if (t.hue !== 'w') bead(ctx, p.x, p.y, Math.max(2, c * 0.05), C.target, { alpha: on ? 1 : 0.7 });
    }
    for (const d of s.darks) {
      const p = this.centre(d);
      const bad = lit.has(d);
      const r = half * 0.4;
      const pulse = this.reduced ? 1 : 0.7 + 0.3 * Math.sin(now / 160);
      ctx.save();
      ctx.fillStyle = C.bg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (bad) {
        if (!this.reduced) { ctx.shadowColor = C.warn; ctx.shadowBlur = c * 0.3; }
        ctx.fillStyle = C.warn;
        ctx.globalAlpha = 0.3 * pulse;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = bad ? C.warn : C.line3;
      ctx.lineWidth = Math.max(1.5, c * 0.04);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = bad ? C.warn : C.text3;
      ctx.lineWidth = Math.max(2, c * 0.05);
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.45, p.y);
      ctx.lineTo(p.x + r * 0.45, p.y);
      ctx.stroke();
      ctx.restore();
    }

    // The lamp.
    bead(ctx, lamp.x, lamp.y, Math.max(4, c * 0.13), C.silver, { glow: this.reduced ? undefined : C.silver });

    // Keyboard cursor and a nudge on a piece that does not turn.
    if (this.showCursor && !won) {
      const p = this.centre(this.cursor);
      tile(ctx, p.x - half + 1.5, p.y - half + 1.5, c - 3, c - 3, c * 0.18, null, C.accent, 2);
    }
    const bumpT = this.bump ? Math.max(0, 1 - (now - this.bump.at) / 350) : 0;
    if (this.bump && bumpT > 0) {
      const p = this.centre(this.bump.cell);
      const wob = this.reduced ? 0 : Math.sin(bumpT * Math.PI * 4) * c * 0.04;
      ctx.save();
      ctx.globalAlpha = bumpT;
      tile(ctx, p.x - half + 2 + wob, p.y - half + 2, c - 4, c - 4, c * 0.18, null, C.text3, 1.5);
      ctx.restore();
    }

    // One small counter under the grid.
    ctx.font = font(12);
    ctx.fillStyle = C.text2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${st.lit} / ${st.total} lit`, area.x + area.w / 2, statusY);
    ctx.restore();
  }

  /** One piece, centred on p. */
  private piece(ctx: CanvasRenderingContext2D, cell: Cell, p: Point, lit: boolean): void {
    const c = this.cell;
    const half = c / 2;
    if (cell === '.') return;
    ctx.save();
    if (cell === '#') {
      const side = c * 0.56;
      tile(ctx, p.x - side / 2, p.y - side / 2, side, side, c * 0.14, C.neutron, null);
      tile(ctx, p.x - side / 2 + c * 0.06, p.y - side / 2 + c * 0.06, side - c * 0.12, side - c * 0.12, c * 0.1, null, C.line, 1);
      ctx.restore();
      return;
    }
    const hue = filterHue(cell);
    if (hue) {
      const side = c * 0.58;
      ctx.globalAlpha = lit ? 0.38 : 0.24;
      tile(ctx, p.x - side / 2, p.y - side / 2, side, side, c * 0.14, C[hue], null);
      ctx.globalAlpha = 1;
      tile(ctx, p.x - side / 2, p.y - side / 2, side, side, c * 0.14, null, C[hue], Math.max(1.5, c * 0.04));
      ctx.restore();
      return;
    }
    const sl = slant(cell);
    if (!sl) { ctx.restore(); return; }
    const sign = sl === '/' ? -1 : 1;
    const len = half * 0.74;
    const a = { x: p.x - len, y: p.y - sign * len }, b = { x: p.x + len, y: p.y + sign * len };
    if (cell[0] === 'F') {
      // Fixed: a heavier pewter bar, hatched on its back, no pivot.
      const nx = sign / Math.SQRT2, ny = -1 / Math.SQRT2; // a normal to the bar
      ctx.strokeStyle = C.text3;
      ctx.lineWidth = Math.max(1, c * 0.025);
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        const t = k / 2.6;
        const q = { x: p.x + (b.x - p.x) * t, y: p.y + (b.y - p.y) * t };
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x + nx * c * 0.12 - (b.x - a.x) * 0.04, q.y + ny * c * 0.12 - (b.y - a.y) * 0.04);
      }
      ctx.stroke();
      ctx.strokeStyle = lit ? C.silverDim : C.pewter;
      ctx.lineWidth = Math.max(3.5, c * 0.085);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.lineCap = 'round';
    if (isSplitter(cell)) {
      // Half-silvered: a faint pane under a dashed silver face.
      ctx.strokeStyle = C.line2;
      ctx.lineWidth = Math.max(3, c * 0.07);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([c * 0.07, c * 0.06]);
      ctx.strokeStyle = lit ? C.silver : C.silverDim;
      ctx.lineWidth = Math.max(2, c * 0.05);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = lit ? C.silver : C.silverDim;
      ctx.lineWidth = Math.max(2.5, c * 0.06);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // The pivot: this one turns.
    bead(ctx, p.x, p.y, Math.max(2.5, c * 0.06), C.surface3, { rim: lit ? C.silver : C.silverDim });
    ctx.restore();
  }
}
