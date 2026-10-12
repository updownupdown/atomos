// Drawing and touch for Flood: tap a color, on the board or in the row of swatches under it, and
// the crystal takes it and grows. The crystal is drawn as one slab, its cells bonded into a
// lattice and ringed by a light outline; loose cells are separate tiles. A pick ripples out from
// the corner through the crystal, cell by cell. The picks left show as dots under the board.
// Holding a finger on a color previews the cells it would join.
//
// The board is painted by `paintFlood`, which the rule cards' pictures share.

import { cloneFlood, crystal, gain, outOfMoves, pick, solved, solveFlood, type FloodState } from './flood';
import { C, fitGrid, shade, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { glyph, HUES, inkOn } from './hues';
import { drawHelpMark, undoHelp, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat, type ViewAction } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Flood is a reserve game, played from the Puzzles screen. The board grows from 5 by 5 in 3 colors to 12 by 12 in 6, and the spare picks beyond par fall from 4 on the easiest boards to none at the top of Expert. Par is the fewest picks a solver finds: an A* search proves it the fewest on most boards up to about 9 by 9; on bigger ones a beam search finds a short route, which the player may sometimes beat. Running out of picks ends the run; undo is free.</p>
`;

/** Milliseconds per step of the ripple, out from the corner. */
const STEP_MS = 34;
const RIPPLE_MAX_MS = 700;
const FLASH_MS = 280;

interface Geo { x: number; y: number; c: number }

export interface FloodLayout {
  board: Geo;
  /** The color swatches, or none (rule pictures). */
  swatches: { x: number; y: number; s: number }[];
  /** The row of dots for the picks, its center line. */
  pips: { y: number; r: number; x0: number; gap: number } | null;
}

/** A pick under way: the board before it and when it began. */
interface Anim { before: FloodState; at: number }

export interface Paint {
  now: number;
  anim?: Anim | null;
  motion: boolean;
  /** Cells a held color would join (a white wash). */
  preview?: number[];
  /** The swatch held down. */
  pressed?: number;
  /** Cells outlined in amber (rule pictures). */
  flags?: number[];
  /** A tap shown on a cell (rule pictures), 0 to 1 through its press. */
  tap?: { cell: number; k: number } | null;
}

const centerOf = (n: number, g: Geo, i: number): Point => ({ x: g.x + ((i % n) + 0.5) * g.c, y: g.y + (Math.floor(i / n) + 0.5) * g.c });

const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

/** Board on top, then the dots for the picks, then the swatches; each sized for a thumb. */
export function layoutFlood(area: Area, n: number, colors: number, opts: { palette?: boolean; pips?: boolean; margin?: number; maxCell?: number } = {}): FloodLayout {
  const m = opts.margin ?? 8;
  const palette = opts.palette ?? true;
  const showPips = opts.pips ?? true;
  const gapK = 0.28;
  const s = palette ? Math.max(30, Math.min(54, (area.w - 2 * m) / (colors + (colors - 1) * gapK), area.h * 0.11)) : 0;
  const pipR = showPips ? Math.max(2.5, Math.min(5, area.h * 0.012, area.w * 0.012)) : 0;
  const pipH = showPips ? pipR * 2 + Math.max(8, pipR * 3) : 0;
  const bottom = (palette ? s + 14 : 0) + pipH;
  const opt = { margin: m, top: 0, bottom, maxCell: opts.maxCell ?? 64 };
  const room = frameRoom(fitGrid(area, n, n, opt).cell);
  const g = fitGrid(area, n, n, { ...opt, margin: m + room });
  const boardBottom = g.y + g.h + room;
  const swatches: FloodLayout['swatches'] = [];
  if (palette) {
    const total = colors * s + (colors - 1) * s * gapK;
    const x0 = area.x + (area.w - total) / 2;
    const y = Math.min(area.y + area.h - m - s, boardBottom + pipH + 8);
    for (let k = 0; k < colors; k++) swatches.push({ x: x0 + k * s * (1 + gapK), y, s });
  }
  const pips = showPips ? { y: boardBottom + pipH / 2 + 1, r: pipR, x0: area.x + area.w / 2, gap: pipR * 3 } : null;
  return { board: { x: g.x, y: g.y, c: g.cell }, swatches, pips };
}

/** Paints the board, its crystal and the ripple of the last pick, the dots for the picks and the
 *  swatches. Returns true while the ripple is still running. */
export function paintFlood(ctx: CanvasRenderingContext2D, s: FloodState, L: FloodLayout, o: Paint): boolean {
  const n = s.size, g = L.board, c = g.c;
  drawFrame(ctx, frameBox(g.x, g.y, n * c, n * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  const a = o.anim && o.motion && s.last ? o.anim : null;
  const ms = a ? o.now - a.at : Infinity;
  const dist = s.last?.dist;
  let maxD = 1;
  if (dist) for (const d of dist.values()) maxD = Math.max(maxD, d);
  const step = Math.min(STEP_MS, RIPPLE_MAX_MS / maxD);
  const now = crystal(s);
  const before = a ? crystal(a.before) : now;
  let moving = false;
  // What each cell shows right now: its color, whether it is crystal, and its flash.
  const shown = s.cells.map((col, i) => {
    if (!a || !now.has(i)) return { col, cr: now.has(i), flash: 0 };
    const at = (dist!.get(i) ?? 0) * step;
    if (ms < at) { moving = true; return { col: a.before.cells[i], cr: before.has(i), flash: 0 }; }
    const k = (ms - at) / FLASH_MS;
    if (k < 1) moving = true;
    return { col, cr: true, flash: Math.max(0, 1 - k) };
  });
  const gap = Math.max(1, c * 0.08);
  // Loose cells: separate tiles with their glyph.
  shown.forEach((v, i) => {
    if (v.cr) return;
    const x = g.x + (i % n) * c, y = g.y + Math.floor(i / n) * c;
    const col = HUES[v.col % HUES.length].color;
    tile(ctx, x + gap / 2, y + gap / 2, c - gap, c - gap, c * 0.18, col);
    glyph(ctx, v.col, x + c / 2, y + c / 2, c * 0.2, inkOn(col));
  });
  // The crystal: one slab, cells bonded into a lattice.
  shown.forEach((v, i) => {
    if (!v.cr) return;
    const x = g.x + (i % n) * c, y = g.y + Math.floor(i / n) * c;
    ctx.fillStyle = HUES[v.col % HUES.length].color;
    ctx.fillRect(x - 0.25, y - 0.25, c + 0.5, c + 0.5);
  });
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.2, c * 0.07);
  shown.forEach((v, i) => {
    if (!v.cr) return;
    const p = centerOf(n, g, i);
    const x = i % n;
    for (const j of [x < n - 1 ? i + 1 : -1, i + n < n * n ? i + n : -1]) {
      if (j < 0 || !shown[j].cr || shown[j].col !== v.col) continue;
      const q = centerOf(n, g, j);
      ctx.strokeStyle = inkOn(HUES[v.col % HUES.length].color).replace(/[\d.]+\)$/, '0.32)');
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
  });
  ctx.restore();
  shown.forEach((v, i) => {
    if (!v.cr) return;
    const p = centerOf(n, g, i);
    const col = HUES[v.col % HUES.length].color;
    glyph(ctx, v.col, p.x, p.y, c * 0.17, inkOn(col));
    if (v.flash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5 * v.flash;
      ctx.fillStyle = shade(col, 0.75);
      ctx.fillRect(p.x - c / 2, p.y - c / 2, c, c);
      ctx.restore();
    }
  });
  // A light outline round the crystal's edge.
  ctx.save();
  ctx.strokeStyle = 'rgba(238, 241, 242, 0.75)';
  ctx.lineWidth = Math.max(2, c * 0.08);
  ctx.lineCap = 'round';
  ctx.beginPath();
  shown.forEach((v, i) => {
    if (!v.cr) return;
    const x = g.x + (i % n) * c, y = g.y + Math.floor(i / n) * c;
    const cx = i % n, cy = Math.floor(i / n);
    const out = (dx: number, dy: number) => {
      const nx = cx + dx, ny = cy + dy;
      return nx < 0 || ny < 0 || nx >= n || ny >= n ? false : !shown[ny * n + nx].cr;
    };
    if (out(0, -1)) { ctx.moveTo(x, y); ctx.lineTo(x + c, y); }
    if (out(1, 0)) { ctx.moveTo(x + c, y); ctx.lineTo(x + c, y + c); }
    if (out(0, 1)) { ctx.moveTo(x, y + c); ctx.lineTo(x + c, y + c); }
    if (out(-1, 0)) { ctx.moveTo(x, y); ctx.lineTo(x, y + c); }
  });
  ctx.stroke();
  ctx.restore();
  if (o.preview?.length) {
    ctx.save();
    ctx.fillStyle = 'rgba(238, 241, 242, 0.42)';
    for (const i of o.preview) {
      const x = g.x + (i % n) * c, y = g.y + Math.floor(i / n) * c;
      tile(ctx, x + gap / 2, y + gap / 2, c - gap, c - gap, c * 0.18, 'rgba(238, 241, 242, 0.42)');
    }
    ctx.restore();
  }
  for (const i of o.flags ?? []) {
    const x = g.x + (i % n) * c, y = g.y + Math.floor(i / n) * c;
    tile(ctx, x + gap, y + gap, c - 2 * gap, c - 2 * gap, c * 0.16, null, C.warn, Math.max(2, c * 0.08));
  }
  if (o.tap) {
    const p = centerOf(n, g, o.tap.cell);
    ctx.save();
    ctx.globalAlpha = 1 - o.tap.k * 0.6;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = Math.max(2, c * 0.08);
    ctx.beginPath();
    ctx.arc(p.x, p.y, c * (0.22 + 0.16 * o.tap.k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // The picks: a dot each, cyan while still to spend; the spare ones past par are rings.
  if (L.pips) {
    const { y, r, gap: pg } = L.pips;
    const count = s.budget;
    const width = (count - 1) * pg;
    const room = n * c;
    const k = width > room ? room / width : 1;
    const x0 = L.pips.x0 - (width * k) / 2;
    for (let i = 0; i < count; i++) {
      const x = x0 + i * pg * k;
      const used = i < s.moves;
      ctx.beginPath();
      ctx.arc(x, y, r * Math.min(1, k + 0.3), 0, Math.PI * 2);
      if (used) { ctx.fillStyle = C.surface3; ctx.fill(); }
      else if (i < s.par) { ctx.fillStyle = C.accent; ctx.fill(); }
      else { ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(1.5, r * 0.5); ctx.stroke(); }
    }
  }
  // The swatches: the crystal's own color and every color once out of picks are dimmed.
  const over = solved(s) || outOfMoves(s);
  L.swatches.forEach((sw, k) => {
    const col = HUES[k % HUES.length].color;
    const shrink = o.pressed === k ? sw.s * 0.06 : 0;
    const off = k === s.cells[0] || over;
    // A color that cannot be picked is a plain plate with its glyph in the color.
    tile(ctx, sw.x + shrink, sw.y + shrink, sw.s - 2 * shrink, sw.s - 2 * shrink, sw.s * 0.22, off ? C.surface2 : col);
    glyph(ctx, k, sw.x + sw.s / 2, sw.y + sw.s / 2, sw.s * 0.2, off ? col : inkOn(col));
  });
  return moving;
}

// ---- the view --------------------------------------------------------------------------

export class FloodView implements PuzzleView {
  private state: FloodState;
  private history: FloodState[] = [];
  private layout: FloodLayout | null = null;
  private pressed: { p: Point; color: number; swatch: boolean } | null = null;
  private anim: Anim | null = null;
  private busy = false;
  private reduced: boolean;
  private mark: { state: FloodState; color: number; cells: number[] } | null = null;
  /** Known routes from boards met in this run: the solver's picks, carried along as they are
   *  played, so the hints never wander from par. */
  private routes = new WeakMap<FloodState, number[]>();

  constructor(private readonly initial: FloodState, reducedMotion: boolean) {
    this.state = cloneFlood(initial);
    this.reduced = reducedMotion;
    this.routes.set(this.state, initial.solution.slice());
  }

  /** Won once the ripple has run out to the last cell. */
  get won(): boolean { return solved(this.state) && !this.busy; }
  get stuck(): boolean { return outOfMoves(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  private grown(): number {
    return Math.round((100 * crystal(this.state).size) / this.state.cells.length);
  }

  stats(): { progress: Stat } {
    return { progress: { label: 'Grown', value: `${this.grown()}%` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'The crystal fills the board';
    if (this.stuck) return 'Out of picks: undo or restart';
    const left = s.budget - s.moves;
    return left === 1 ? '1 pick left' : `${left} of ${s.budget} picks left`;
  }

  action(): ViewAction | null {
    if (!this.stuck) return null;
    return { label: 'Restart', icon: 'restart', run: () => this.restart() };
  }

  /** The picks that fill the board from here: a kept route, else a fresh search. */
  private planFrom(s: FloodState): number[] {
    return this.routes.get(s) ?? solveFlood(s, { budget: s.size <= 9 ? 1200 : 300, width: 60 }).path;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (solved(s)) return null;
    const plan = this.planFrom(s);
    if (!plan.length || plan.length > s.budget - s.moves) return this.backOnTrack();
    const color = plan[0];
    const cells = gain(s, color);
    const name = HUES[color % HUES.length].name;
    const joins = cells.length === 1 ? '1 cell joins' : `${cells.length} cells join`;
    this.routes.set(s, plan);
    if (level === 2) {
      this.go(color);
      return { text: `Picked ${name}: ${cells.length === 1 ? '1 cell joined' : `${cells.length} cells joined`}.`, moved: true };
    }
    this.mark = { state: s, color, cells };
    return { text: plan.length === 1 ? `Pick ${name} to fill the board.` : `Pick ${name} next: ${joins}.` };
  }

  /** The fewest undos back to a board that can still be filled in the picks left. */
  private backOnTrack(): Help {
    const h = this.history;
    for (let n = 1; n <= h.length; n++) {
      const st = h[h.length - n];
      const need = this.routes.get(st)?.length ?? solveFlood(st, { budget: st.size <= 9 ? 600 : 200, width: 30 }).path.length;
      if (need <= st.budget - st.moves) return undoHelp(n);
    }
    return { text: 'Restart to get back on track.' };
  }

  private go(color: number): boolean {
    const next = pick(this.state, color);
    if (!next) return false;
    this.history.push(this.state);
    if (this.history.length > 300) this.history.shift();
    this.anim = this.reduced ? null : { before: this.state, at: performance.now() };
    this.busy = !this.reduced;
    // A pick along the kept route keeps the rest of it.
    const r = this.routes.get(this.state);
    if (r && r[0] === color) this.routes.set(next, r.slice(1));
    this.state = next;
    return true;
  }

  restart(): void {
    this.state = cloneFlood(this.initial);
    this.history = [];
    this.anim = null;
    this.busy = false;
    this.mark = null;
    this.routes.set(this.state, this.initial.solution.slice());
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.anim = null;
    this.busy = false;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  /** The color under a point: a swatch, or a loose cell on the board; -1 for neither. */
  private colorAt(p: Point): { color: number; swatch: boolean } {
    const L = this.layout;
    if (!L) return { color: -1, swatch: false };
    const k = L.swatches.findIndex((sw) => p.x >= sw.x - 4 && p.x < sw.x + sw.s + 4 && p.y >= sw.y - 6 && p.y < sw.y + sw.s + 6);
    if (k >= 0) return { color: k, swatch: true };
    const n = this.state.size, g = L.board;
    const cx = Math.floor((p.x - g.x) / g.c), cy = Math.floor((p.y - g.y) / g.c);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return { color: -1, swatch: false };
    return { color: this.state.cells[cy * n + cx], swatch: false };
  }

  down(p: Point): void {
    const at = this.colorAt(p);
    this.pressed = at.color >= 0 && !this.stuck && !solved(this.state) ? { p, ...at } : null;
  }

  move(p: Point): void {
    // Sliding off the color held drops the preview.
    if (this.pressed && this.colorAt(p).color !== this.pressed.color) this.pressed = null;
  }

  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const press = this.pressed;
    this.pressed = null;
    if (!press) return;
    if (this.colorAt(p).color !== press.color) return;
    this.go(press.color);
  }

  key(e: KeyboardEvent): boolean {
    // 1 to 6 pick the swatches in order.
    const k = Number(e.key) - 1;
    if (!(k >= 0 && k < this.state.colors)) return false;
    return this.go(k);
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const L = layoutFlood(area, s.size, s.colors);
    this.layout = L;
    const held = this.pressed && this.pressed.color !== s.cells[0] ? this.pressed : null;
    const moving = paintFlood(ctx, s, L, {
      now,
      anim: this.anim,
      motion: !this.reduced,
      preview: held ? gain(s, held.color) : undefined,
      pressed: held?.swatch ? held.color : undefined,
    });
    if (!moving) { this.anim = null; this.busy = false; }
    const m = this.mark?.state === s && !this.busy ? this.mark : null;
    if (m) {
      const sw = L.swatches[m.color];
      if (sw) drawHelpMark(ctx, sw.x, sw.y, sw.s, sw.s, now, this.reduced, sw.s * 0.22);
      const g = L.board, n = s.size;
      const gap = Math.max(1, g.c * 0.08);
      for (const i of m.cells) tile(ctx, g.x + (i % n) * g.c + gap / 2, g.y + Math.floor(i / n) * g.c + gap / 2, g.c - gap, g.c - gap, g.c * 0.18, 'rgba(238, 241, 242, 0.32)');
    }
  }
}

// ---- rule pictures ---------------------------------------------------------------------

/** A picture board from rows of hue letters ('a' blue, 'b' orange, 'c' green, 'd' violet). */
function board(rows: string[], budget: number): FloodState {
  const n = rows.length;
  const cells = rows.join('').split('').map((ch) => ch.charCodeAt(0) - 97);
  const colors = Math.max(...cells) + 1;
  return { size: n, colors, cells, moves: 0, par: budget, budget, exact: true, solution: [], last: null };
}

const LEAD = 0.35;
const TAP = 0.3;

/** One rule picture: each pick shown as a tap on a cell of that color touching the crystal, then
 *  the ripple. A `bad` picture ends with every cell left outside the crystal flagged amber. */
function picture(rows: string[], picks: number[], caption: string, opts: { budget?: number; bad?: boolean } = {}): Illustration {
  const s0 = board(rows, opts.budget ?? picks.length);
  const steps: { at: number; before: FloodState; after: FloodState; cell: number; ms: number }[] = [];
  let cur = s0;
  let clock = LEAD;
  for (const color of picks) {
    const next = pick(cur, color);
    if (!next) continue;
    const cell = next.last!.joined[0] ?? cur.cells.indexOf(color);
    let maxD = 1;
    for (const d of next.last!.dist.values()) maxD = Math.max(maxD, d);
    const ms = Math.min(STEP_MS, RIPPLE_MAX_MS / maxD) * maxD + FLASH_MS;
    steps.push({ at: clock, before: cur, after: next, cell, ms });
    clock += TAP + ms / 1000 + 0.15;
    cur = next;
  }
  const raw = clock + 0.45;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  const left = (st: FloodState) => { const cr = crystal(st); return st.cells.map((_, i) => i).filter((i) => !cr.has(i)); };
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      const L = layoutFlood({ x: 0, y: 0, w, h }, s0.size, s0.colors, { palette: false, margin: 2, maxCell: 999 });
      let st = s0;
      let anim: Anim | null = null;
      let tap: Paint['tap'] = null;
      for (const sp of steps) {
        if (t < sp.at) break;
        if (t < sp.at + TAP) { st = sp.before; anim = null; tap = { cell: sp.cell, k: (t - sp.at) / TAP }; break; }
        st = sp.after;
        anim = { before: sp.before, at: (sp.at + TAP) * 1000 };
        tap = null;
      }
      const flags = opts.bad && t >= clock ? left(st) : [];
      paintFlood(ctx, st, L, { now: t * 1000, anim, motion: true, tap, flags });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Grow',
    text: 'The crystal is the patch joined to the top-left corner. Tap a color and the crystal takes it, and every touching cell of that color joins.',
    good: picture(['abca', 'bbac', 'cabb', 'bcaa'], [1], 'Orange joins'),
  },
  {
    title: 'Touching only',
    text: 'Only cells touching the crystal join. A patch of the same color farther off waits for the crystal to reach it.',
    good: picture(['aabb', 'acbb', 'ccab', 'bcaa'], [1, 2], 'Reach, then join'),
  },
  {
    title: 'Picks',
    text: 'Fill the whole board within the picks allowed, the dots under it. Par is the fewest picks the solver found.',
    good: picture(['abb', 'bcc', 'cca'], [1, 2, 0], 'Filled in three', { budget: 3 }),
    bad: picture(['abb', 'bcc', 'cca'], [2, 1, 2], 'Out of picks', { budget: 3, bad: true }),
  },
  {
    title: 'Plan the growth',
    text: 'The color that joins the most cells now is not always best. Hold a color to see what it would join, and look a pick ahead.',
    good: picture(['baaa', 'caaa', 'bbbb', 'bbaa'], [2, 1, 0], 'Green first', { budget: 3 }),
    bad: picture(['baaa', 'caaa', 'bbbb', 'bbaa'], [0, 2, 1], 'Blue first: one short', { budget: 3, bad: true }),
  },
];
