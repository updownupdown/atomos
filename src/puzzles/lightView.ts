// Drawing and touch for Light Routing: tap a turnable piece to flip it; the
// beam redraws at once, growing out from the lamp. Arrows move a cursor,
// space or Enter flips under it, Tab jumps between turnable pieces.

import { cloneLight, DELTA, filterHue, flip, isSplitter, slant, status, targetLit, trace, turnable, type Cell, type Dir, type Hue, type LightState, type Target } from './light';
import { bead, C, fitGrid, font, tile } from './palette';
import { type Area, type Point, type PuzzleView, type RuleCard } from './view';

/** Milliseconds for the light to cross one cell as it grows after a flip. */
const STEP_MS = 40;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">A gate puzzle. The grid grows from 5×5 (H to Cu, z 1–29) to 6×6 (Zn to Au, 30–79) and 7×7 (from Hg, 80). Pieces arrive in bands, each one always present in its own band and mixed in later: fixed mirrors from Na (11), dark sensors from Fe (26), splitters from Nb (41), color filters from Pm (61); from Tl (81) each level draws two or three of the four. Rings go from two to three at Sn (50); dark sensors from one to two at Yb (70); colored rings appear only with filters.</p>
<p class="meta">Every level is built from a solved layout whose beam is walked out piece by piece, then scrambled by flipping 1 to 4 turnable pieces the beam uses (1 + z/30). Par is that number of flips, and the generator checks no smaller set of taps solves it, so par is the true minimum. Each flip is one move; dark sensors are placed only where a wrong flip would send light. Keyboard: arrows move a cursor, Space or Enter flips under it, Tab jumps to the next turnable piece.</p>
`;

const hueColor = (h: Hue): string => (h === 'w' ? C.silver : C[h]);

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
    if (st.wrongHue.length) return st.wrongHue.length === 1 ? 'A ring has the wrong color' : `${st.wrongHue.length} rings have the wrong color`;
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

  private center(i: number): Point {
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
    const c = this.cell;
    const half = c / 2;
    const st = status(s);
    ctx.save();
    paintLight(ctx, s, { x: this.origin.x, y: this.origin.y, c, rows: s.size }, this.reduced ? Infinity : (now - this.flashAt) / STEP_MS, now, !this.reduced);

    // Keyboard cursor and a nudge on a piece that does not turn.
    if (this.showCursor && !st.won) {
      const p = this.center(this.cursor);
      tile(ctx, p.x - half + 1.5, p.y - half + 1.5, c - 3, c - 3, c * 0.18, null, C.accent, 2);
    }
    const bumpT = this.bump ? Math.max(0, 1 - (now - this.bump.at) / 350) : 0;
    if (this.bump && bumpT > 0) nudge(ctx, this.center(this.bump.cell), c, bumpT, !this.reduced);

    // One small counter under the grid.
    ctx.font = font(12);
    ctx.fillStyle = C.text2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${st.lit} / ${st.total} lit`, area.x + area.w / 2, statusY);
    ctx.restore();
  }
}

// ---- the shared painter ----------------------------------------------------------------

/** Where the grid sits: its top-left corner, the cell size and how many rows show. */
interface Geo { x: number; y: number; c: number; rows: number }

/** A refused tap: a faint outline that wobbles and fades. */
function nudge(ctx: CanvasRenderingContext2D, p: Point, c: number, k: number, motion: boolean): void {
  const half = c / 2;
  const wob = motion ? Math.sin(k * Math.PI * 4) * c * 0.04 : 0;
  ctx.save();
  ctx.globalAlpha = k;
  tile(ctx, p.x - half + 2 + wob, p.y - half + 2, c - 4, c - 4, c * 0.18, null, C.text3, 1.5);
  ctx.restore();
}

/**
 * Paints the tiles, the beam grown `progress` cells out from the lamp, the
 * pieces, the sensors and the lamp. Rows past `g.rows` are hidden (the rule
 * cards' boards are cut short): light running into them leaves as at the rim.
 */
function paintLight(ctx: CanvasRenderingContext2D, s: LightState, g: Geo, progress: number, now: number, motion: boolean): void {
  const n = s.size;
  const c = g.c;
  const half = c / 2;
  const shown = (i: number) => Math.floor(i / n) < g.rows;
  const center = (i: number): Point => ({ x: g.x + ((i % n) + 0.5) * c, y: g.y + (Math.floor(i / n) + 0.5) * c });
  const beam = trace(s);
  ctx.save();

  // Tiles: raised where a tap does something.
  for (let i = 0; i < n * g.rows; i++) {
    const p = center(i);
    const raised = turnable(s.cells[i]);
    const inset = c * 0.05;
    tile(ctx, p.x - half + inset, p.y - half + inset, c - inset * 2, c - inset * 2, c * 0.18, raised ? C.surface3 : C.surface, raised ? C.line2 : null, 1);
  }

  // The beam, grown out from the lamp by steps since the last change, one stroke per color.
  const segs = new Map<Hue, number[]>();
  const seg = (h: Hue, a: Point, b: Point, f: number) => {
    if (f <= 0) return;
    const k = Math.min(1, f);
    (segs.get(h) ?? segs.set(h, []).get(h)!).push(a.x, a.y, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
  };
  const e = center(s.entry);
  const [edx, edy] = DELTA[s.entryDir];
  const lamp = { x: e.x - edx * c * 0.85, y: e.y - edy * c * 0.85 };
  seg('w', lamp, { x: e.x - edx * half, y: e.y - edy * half }, 1);
  for (const v of beam.visits) {
    const f = progress - v.depth;
    if (f <= 0 || !shown(v.cell)) continue;
    const p = center(v.cell);
    const [dx, dy] = DELTA[v.dir];
    const edge = { x: p.x - dx * half, y: p.y - dy * half };
    if (v.stop === 'edge') { seg(v.hue, edge, { x: edge.x + dx * c * 0.12, y: edge.y + dy * c * 0.12 }, f * 2); continue; }
    seg(v.hue, edge, p, f * 2);
    for (const o of v.outs) {
      const [ox, oy] = DELTA[o];
      const out = v.exits.includes(o) || !shown(v.cell + oy * n + ox);
      const reach = out ? half + c * 0.4 : half;
      seg(v.outHue, p, { x: p.x + ox * reach, y: p.y + oy * reach }, f * 2 - 1);
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [h, pts] of segs) {
    const col = hueColor(h);
    const trace = () => {
      ctx.beginPath();
      for (let k = 0; k < pts.length; k += 4) { ctx.moveTo(pts[k], pts[k + 1]); ctx.lineTo(pts[k + 2], pts[k + 3]); }
    };
    ctx.save();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = Math.max(5, c * 0.14);
    if (motion) { ctx.shadowColor = col; ctx.shadowBlur = c * 0.18; }
    trace();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, c * 0.045);
    trace();
    ctx.stroke();
  }

  // Pieces.
  const lit = beam.lit;
  for (let i = 0; i < n * g.rows; i++) piece(ctx, s.cells[i], center(i), c, lit.has(i));

  // Sensors: target rings and dark discs.
  for (const t of s.targets) if (shown(t.cell)) targetRing(ctx, t, center(t.cell), c, targetLit(t, lit), motion);
  for (const d of s.darks) if (shown(d)) darkSensor(ctx, center(d), c, lit.has(d), now, motion);

  // The lamp.
  bead(ctx, lamp.x, lamp.y, Math.max(4, c * 0.13), C.silver, { glow: motion ? C.silver : undefined });
  ctx.restore();
}

/** A target ring: red, or its light's color with a small red heart; filled while lit. */
function targetRing(ctx: CanvasRenderingContext2D, t: Target, p: Point, c: number, on: boolean, motion: boolean): void {
  const col = t.hue === 'w' ? C.target : C[t.hue];
  const r = c * 0.22;
  ctx.save();
  if (on) {
    if (motion) { ctx.shadowColor = col; ctx.shadowBlur = c * 0.3; }
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
  // A colored ring keeps a small red heart, so it still reads as a goal.
  if (t.hue !== 'w') bead(ctx, p.x, p.y, Math.max(2, c * 0.05), C.target, { alpha: on ? 1 : 0.7 });
}

/** A dark sensor: a dark disc with a bar, flaring amber while light reaches it. */
function darkSensor(ctx: CanvasRenderingContext2D, p: Point, c: number, bad: boolean, now: number, motion: boolean): void {
  const r = c * 0.2;
  const pulse = motion ? 0.7 + 0.3 * Math.sin(now / 160) : 1;
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  if (bad) {
    if (motion) { ctx.shadowColor = C.warn; ctx.shadowBlur = c * 0.3; }
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

/** One piece, centered on p. */
function piece(ctx: CanvasRenderingContext2D, cell: Cell, p: Point, c: number, lit: boolean): void {
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

// ---- rule cards ------------------------------------------------------------------------

/**
 * A demo board three cells wide and two high: rows of cells as written, a lamp
 * on cell (x, y) shining `dir`, and its sensors. A hidden third row pads the
 * grid square so the real beam tracing runs unchanged.
 */
function board(cells: Cell[][], lamp: [number, number, Dir], targets: [number, number, Hue][] = [], darks: [number, number][] = []): LightState {
  const n = 3;
  const flat: Cell[] = Array(n * n).fill('.');
  cells.forEach((row, y) => row.forEach((c, x) => { flat[y * n + x] = c; }));
  return {
    size: n, cells: flat, entry: lamp[1] * n + lamp[0], entryDir: lamp[2],
    targets: targets.map(([x, y, hue]) => ({ cell: y * n + x, hue })), darks: darks.map(([x, y]) => y * n + x),
    solution: [...flat], features: [], moves: 0, par: 0,
  };
}

const FIRST_TAP = 1.3;
const TAP_GAP = 1.5;

/**
 * A looping demo: the beam grows from the lamp, then each tap (an accent
 * ripple) flips its piece and the beam regrows, as on the board. A tap on a
 * piece that does not turn gets the board's nudge instead.
 */
function scene(s0: LightState, taps: [number, number][] = []): (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void {
  const states = [s0];
  for (const [x, y] of taps) {
    const prev = states[states.length - 1];
    states.push(flip(prev, y * prev.size + x) ?? prev);
  }
  const loop = Math.max(3.4, FIRST_TAP + taps.length * TAP_GAP + 0.6);
  return (ctx, w, h, t) => {
    const u = ((t % loop) + loop) % loop;
    const k = Math.max(0, Math.min(taps.length, Math.floor((u - FIRST_TAP) / TAP_GAP) + 1));
    const at = k ? FIRST_TAP + (k - 1) * TAP_GAP : 0;
    const fit = fitGrid({ x: 0, y: 0, w, h }, 3 + 1.1, 2 + 1.1, { margin: 2, maxCell: 999 });
    const c = fit.cell;
    const g = { x: fit.x + 0.55 * c, y: fit.y + 0.55 * c, c, rows: 2 };
    const s = states[k];
    // A refused tap leaves the board as it was, so the beam does not regrow.
    const changed = k > 0 && s !== states[k - 1];
    const since = k && !changed ? u : u - at;
    paintLight(ctx, s, g, since * 1000 / STEP_MS / 2.5, u * 1000, true);
    if (k > 0) {
      const [x, y] = taps[k - 1];
      const p = { x: g.x + (x + 0.5) * c, y: g.y + (y + 0.5) * c };
      const d = u - at;
      if (!changed && d < 0.35) nudge(ctx, p, c, 1 - d / 0.35, true);
      if (d < 0.5) {
        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.globalAlpha = 1 - d / 0.5;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, c * (0.25 + 0.3 * d / 0.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Mirrors',
    text: 'Tap a mirror to flip it between / and \\. It turns the beam through a right angle.',
    demo: scene(board([['.', '.', '.'], ['.', '\\', '.']], [0, 1, 'right'], [[1, 0, 'w']]), [[1, 1]]),
  },
  {
    title: 'Rings',
    text: 'Light every red ring to win. A red ring takes light of any color.',
    demo: scene(board([['.', '.', '/'], ['.', '.', '.']], [0, 0, 'right'], [[1, 0, 'w'], [2, 1, 'w']]), [[2, 0]]),
  },
  {
    title: 'Fixed mirrors',
    text: 'Darker, hatched on the back and flat on the board. They turn the beam too, but never flip.',
    demo: scene(board([['.', '.', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'w']]), [[2, 0]]),
  },
  {
    title: 'Splitters',
    text: 'Half-silvered glass, dashed: the beam goes straight through and also turns, so one beam becomes two. Tap to flip.',
    demo: scene(board([['.', '.', '.'], ['.', 'H\\', '.']], [0, 1, 'right'], [[1, 0, 'w'], [2, 1, 'w']]), [[1, 1]]),
  },
  {
    title: 'Filters',
    text: 'White light leaves a filter tinted its color. Light of that color passes; any other color is absorbed.',
    demo: scene(board([['.', 'Cs', 'F\\'], ['.', '.', 'Cp']], [0, 0, 'right'])),
  },
  {
    title: 'Colored rings',
    text: 'A colored ring, with a small red heart, needs light of its own color.',
    demo: scene(board([['.', 'Cp', '/'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'p']]), [[2, 0]]),
  },
  {
    title: 'Dark sensors',
    text: 'Dark discs with a bar must stay unlit. A lit one flares amber and the puzzle is not solved.',
    demo: scene(board([['.', '.', '.'], ['.', '\\', '.']], [1, 0, 'down'], [[0, 1, 'w']], [[2, 1]]), [[1, 1]]),
  },
  {
    title: 'Blockers',
    text: 'Gray blocks stop the beam.',
    demo: scene(board([['.', '.', '.'], ['.', '#', '.']], [0, 1, 'right'], [[2, 1, 'w']])),
  },
];
