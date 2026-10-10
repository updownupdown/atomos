// Drawing and touch for Lumen: the tray of mirrors (and a splitter) sits under
// the grid. Tap an empty cell to set a piece there; tap it again to turn it, a
// third time to take it back. The beam redraws at once, growing from the lamp.
// Keyboard: arrows move a cursor, Space or Enter taps under it, Tab switches
// between mirrors and splitters.

import { cloneLight, DELTA, filterHue, isSplitter, left, open, slant, status, tap, targetLit, trace, turnable, type Cell, type Dir, type Hue, type LightState, type PieceKind, type Target } from './light';
import { bead, C, fitGrid, font, tile } from './palette';
import { type Area, type Illustration, type Point, type PuzzleView, type RuleCard } from './view';

/** Milliseconds for the light to cross one cell as it grows after a change. */
const STEP_MS = 40;
/** Height of the tray under the grid, and of the counter line above it. */
const TRAY_H = 52;
const COUNT_H = 20;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Builds fleeting isotopes: pick Lumen when you build one. Every board has exactly one answer, and it uses every piece in the tray, so par is the tray's size. Only placing a piece counts as a move; turning a piece or taking it back is free.</p>
<p class="meta">The tray grows with the atom: one mirror (H to B), two (C to Mn, sometimes with fixed mirrors on the board), three with dark sensors (Fe to Zr), a splitter and two mirrors (Nb to Nd), color filters fixed on the board with colored rings (Pm to Hg), four pieces (Tl to Fm), and 7×7 boards from Md. Keyboard: arrows move a cursor, Space or Enter taps under it, Tab switches between mirrors and splitters.</p>
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
  /** The kind a tap on an empty cell places. */
  private kind: PieceKind;
  /** Where the tray's chips were drawn, for taps. */
  private chips: { kind: PieceKind; x: number; y: number; w: number; h: number }[] = [];

  constructor(private readonly initial: LightState, reducedMotion: boolean) {
    this.state = cloneLight(initial);
    this.reduced = reducedMotion;
    this.kind = initial.tray.mirrors ? 'mirror' : 'splitter';
    this.cursor = Math.max(0, initial.cells.findIndex((_, i) => open(initial, i)));
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
    this.kind = this.initial.tray.mirrors ? 'mirror' : 'splitter';
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

  private tryTap(i: number): void {
    if (this.won || i < 0) return;
    const next = tap(this.state, i, this.kind);
    if (!next) {
      this.bump = { cell: i, at: performance.now() };
      return;
    }
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    this.cursor = i;
    this.flashAt = performance.now();
    // Once a kind is used up, an empty cell takes the other.
    const l = left(this.state);
    if (l[this.kind] <= 0 && l[this.other()] > 0) this.kind = this.other();
  }

  private other(): PieceKind { return this.kind === 'mirror' ? 'splitter' : 'mirror'; }

  private choose(kind: PieceKind): void {
    if (this.initial.tray[kind === 'mirror' ? 'mirrors' : 'splitters'] > 0) this.kind = kind;
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): { statusY: number } {
    const n = this.state.size;
    // Half a cell round the grid for the lamp and the beam's exit stubs; the counter and tray below.
    const fit = fitGrid(area, n + 1.1, n + 1.1, { margin: 6, bottom: COUNT_H + TRAY_H, maxCell: 72 });
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
    const chip = this.chips.find((c) => s.x >= c.x && s.x <= c.x + c.w && s.y >= c.y && s.y <= c.y + c.h);
    if (chip) { this.choose(chip.kind); return; }
    this.tryTap(this.cellAt(s));
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
      this.tryTap(this.cursor);
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.choose(this.other());
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

    // Keyboard cursor and a nudge where a tap does nothing.
    if (this.showCursor && !st.won) {
      const p = this.center(this.cursor);
      tile(ctx, p.x - half + 1.5, p.y - half + 1.5, c - 3, c - 3, c * 0.18, null, C.accent, 2);
    }
    const bumpT = this.bump ? Math.max(0, 1 - (now - this.bump.at) / 350) : 0;
    if (this.bump && bumpT > 0) nudge(ctx, this.center(this.bump.cell), c, bumpT, !this.reduced);

    // One small counter under the grid, then the tray.
    ctx.font = font(12);
    ctx.fillStyle = C.text2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${st.lit} / ${st.total} lit`, area.x + area.w / 2, statusY);
    this.drawTray(ctx, area.x + area.w / 2, statusY + COUNT_H);
    ctx.restore();
  }

  /** The tray: a chip per piece kind, a drawing of the piece and how many are left; the kind an
   *  empty cell takes is raised. */
  private drawTray(ctx: CanvasRenderingContext2D, cx: number, y: number): void {
    const l = left(this.state);
    const kinds = (['mirror', 'splitter'] as PieceKind[]).filter((k) => this.state.tray[k === 'mirror' ? 'mirrors' : 'splitters'] > 0);
    const w = 92, h = 44, gap = 10;
    let x = cx - (kinds.length * w + (kinds.length - 1) * gap) / 2;
    this.chips = [];
    for (const k of kinds) {
      const on = k === this.kind && kinds.length > 1;
      const empty = l[k] <= 0;
      ctx.save();
      ctx.globalAlpha = empty ? 0.45 : 1;
      tile(ctx, x, y, w, h, 8, on ? C.surface3 : C.surface, null);
      const pc = 30;
      piece(ctx, k === 'mirror' ? '/' : 'H/', { x: x + 8 + pc / 2, y: y + h / 2 }, pc * 1.3, true);
      ctx.font = font(15, 600);
      ctx.fillStyle = empty ? C.text3 : C.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`× ${l[k]}`, x + 8 + pc + 10, y + h / 2 + 1);
      ctx.restore();
      this.chips.push({ kind: k, x, y, w, h });
      x += w + gap;
    }
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

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A picture board three cells wide and two high: rows of cells as written, a
 * lamp on cell (x, y) shining `dir`, and its sensors. A hidden third row pads
 * the grid square so the real beam tracing runs unchanged.
 */
function board(cells: Cell[][], lamp: [number, number, Dir], targets: [number, number, Hue][] = [], darks: [number, number][] = []): LightState {
  const n = 3;
  const flat: Cell[] = Array(n * n).fill('.');
  cells.forEach((row, y) => row.forEach((c, x) => { flat[y * n + x] = c; }));
  return {
    size: n, cells: flat, entry: lamp[1] * n + lamp[0], entryDir: lamp[2],
    targets: targets.map(([x, y, hue]) => ({ cell: y * n + x, hue })), darks: darks.map(([x, y]) => y * n + x),
    solution: [...flat], tray: { mirrors: 1, splitters: 1 }, features: [], moves: 0, par: 0,
  };
}

/** Seconds: the beam's first growth, a tap (if any) and the beam regrowing, the verdict coming in, a last rest. */
const GROW = 0.75;
const TAP = 0.25;
const VERDICT = 0.4;
const REST = 0.45;
/** Cells the beam grows per second in a picture. */
const SPEED = 10;

/**
 * One rule picture: the beam grows out from the lamp as on the board; then,
 * if there is a tap, an accent ripple lands on that cell and the piece `to`
 * appears there (or, where a tap does nothing, the board's nudge) and the beam
 * regrows. When the light has settled, the cell `flag` names is flagged in
 * amber. The last frame is that finished state.
 */
function picture(s0: LightState, caption: string, o: { tap?: [number, number]; to?: Cell; flag?: [number, number] } = {}): Illustration {
  const tapAt = o.tap ? GROW : -1;
  let s1: LightState | null = null;
  if (o.tap && o.to) {
    s1 = cloneLight(s0);
    s1.cells[o.tap[1] * s0.size + o.tap[0]] = o.to;
  }
  const changed = !!s1;
  const settle = o.tap ? GROW + TAP + (changed ? GROW : 0.2) : GROW;
  const duration = Math.min(4, Math.max(1.5, settle + (o.flag ? VERDICT : 0) + REST));
  const flag = o.flag ? o.flag[1] * s0.size + o.flag[0] : -1;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const fit = fitGrid({ x: 0, y: 0, w, h }, 3 + 1.1, 2 + 1.1, { margin: 2, maxCell: 999 });
      const c = fit.cell;
      const g = { x: fit.x + 0.55 * c, y: fit.y + 0.55 * c, c, rows: 2 };
      const after = changed && t >= tapAt + TAP;
      const s = after ? s1! : s0;
      const since = after ? t - tapAt - TAP : t;
      paintLight(ctx, s, g, since * SPEED, t * 1000, true);
      if (o.tap && t >= tapAt) {
        const p = { x: g.x + (o.tap[0] + 0.5) * c, y: g.y + (o.tap[1] + 0.5) * c };
        const d = t - tapAt;
        if (!changed && d < 0.4) nudge(ctx, p, c, 1 - d / 0.4, true);
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
      if (flag >= 0 && t > settle) {
        const k = Math.min(1, (t - settle) / VERDICT);
        const p = { x: g.x + ((flag % s0.size) + 0.5) * c, y: g.y + (Math.floor(flag / s0.size) + 0.5) * c };
        ctx.save();
        ctx.globalAlpha = 1 - (1 - k) ** 3;
        tile(ctx, p.x - c * 0.45, p.y - c * 0.45, c * 0.9, c * 0.9, c * 0.18, null, C.warn, Math.max(2, c * 0.06));
        ctx.restore();
      }
    },
  };
}

const RINGS = board([['.', '.', '.'], ['.', '.', '.']], [0, 0, 'right'], [[1, 0, 'w'], [2, 1, 'w']]);
const DARKS = board([['.', '.', '.'], ['.', '.', '.']], [1, 0, 'down'], [[0, 1, 'w']], [[2, 1]]);

export const RULES: RuleCard[] = [
  {
    title: 'Mirrors',
    text: 'Tap an empty square to set a mirror from the tray there; it turns the beam through a right angle. Tap it again to turn it, and a third time to put it back.',
    good: picture(board([['.', '.', '.'], ['.', '.', '.']], [0, 1, 'right'], [[1, 0, 'w']]), 'Set a mirror', { tap: [1, 1], to: '/' }),
  },
  {
    title: 'Rings',
    text: 'Light every red ring to win. A red ring takes light of any color.',
    good: picture(RINGS, 'Every ring lit', { tap: [2, 0], to: '\\' }),
    bad: picture(RINGS, 'A ring left dark', { tap: [2, 0], to: '/', flag: [2, 1] }),
  },
  {
    title: 'The tray',
    text: 'The tray under the board holds exactly the pieces the answer needs. Only setting a piece down counts as a move; turning it or putting it back is free.',
    good: picture(board([['.', '.', '.'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'w']]), 'Every piece used', { tap: [2, 0], to: '\\' }),
  },
  {
    title: 'Fixed mirrors',
    text: 'Darker and hatched on the back, they are part of the board: they turn the beam too, but never move.',
    good: picture(board([['.', '.', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'w']]), 'Turns the beam'),
    bad: picture(board([['.', '.', 'F/'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'w']]), 'A tap does nothing', { tap: [2, 0], flag: [2, 0] }),
  },
  {
    title: 'Splitters',
    text: 'Half-silvered glass, dashed: the beam goes straight through and also turns, so one beam becomes two. Pick it in the tray, then tap a square.',
    good: picture(board([['.', '.', '.'], ['.', '.', '.']], [0, 1, 'right'], [[1, 0, 'w'], [2, 1, 'w']]), 'One beam becomes two', { tap: [1, 1], to: 'H/' }),
  },
  {
    title: 'Filters',
    text: 'White light leaves a filter tinted its color. Light of that color passes; any other color is absorbed.',
    good: picture(board([['Cs', 'Cs', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 's']]), 'Same color passes'),
    bad: picture(board([['Cs', 'Cp', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 's']]), 'Other color stops', { flag: [1, 0] }),
  },
  {
    title: 'Colored rings',
    text: 'A colored ring, with a small red heart, needs light of its own color.',
    good: picture(board([['.', 'Cp', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'p']]), 'Its own color'),
    bad: picture(board([['.', 'Cs', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'p']]), 'Wrong color: unlit', { flag: [2, 1] }),
  },
  {
    title: 'Dark sensors',
    text: 'Dark discs with a bar must stay unlit. A lit one flares amber and the puzzle is not solved.',
    good: picture(DARKS, 'Sensor stays dark', { tap: [1, 1], to: '/' }),
    bad: picture(DARKS, 'A sensor is lit', { tap: [1, 1], to: '\\', flag: [2, 1] }),
  },
  {
    title: 'Blockers',
    text: 'Gray blocks stop the beam.',
    good: picture(board([['.', '.', '.'], ['.', '#', '.']], [0, 1, 'right']), 'Stops the beam'),
  },
];
