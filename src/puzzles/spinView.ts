// Drawing and touch for Spin: tap a cell to set its spin up, tap again for down, again to
// clear. Up is a red plate and down a blue one, like a magnet's poles, each with its arrow;
// dealt cells carry dark arrows and cannot change, the player's carry white ones. Links between cells show as a small "=" or "x" on their shared edge. Anything that
// breaks a rule is outlined in amber as soon as it does.
//
// The board is painted by `paintSpin`, which the rule cards' pictures share.

import { cloneSpin, flaws, firstWrong, full, nextForced, set, solved, tap, type Link, type Spin, type SpinState } from './spin';
import { C, fitGrid, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Spin is a reserve game, played from the Practice screen. The grid is 4 by 4 for hydrogen and helium, 6 by 6 up to barium and 8 by 8 from lanthanum on. Fewer cells are dealt filled as the element gets heavier, from half the board down to a fifth, and more links are dealt. Every board has exactly one answer, checked by the generator. Par is the fewest taps that fill it: one for an up, two for a down.</p>
`;

interface Geo { x: number; y: number; c: number }

interface Paint {
  /** Outline the cells that break a rule. */
  mark: boolean;
  /** A cell drawn in the rule pictures as it is being set, 0 to 1. */
  pop?: { cell: number; k: number };
}

const centerOf = (s: SpinState, g: Geo, i: number): Point => ({ x: g.x + ((i % s.size) + 0.5) * g.c, y: g.y + (Math.floor(i / s.size) + 0.5) * g.c });

/** The frame round the grid and a faint dot in every empty cell. */
function lattice(ctx: CanvasRenderingContext2D, s: SpinState, g: Geo): void {
  const c = g.c, n = s.size;
  drawFrame(ctx, frameBox(g.x, g.y, n * c, n * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  ctx.fillStyle = C.surface3;
  const r = Math.max(1.5, c * 0.035);
  for (let i = 0; i < n * n; i++) {
    if (s.cells[i]) continue;
    const p = centerOf(s, g, i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** An arrow for a spin: up or down, in the cell's middle. */
export function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, spin: Spin, color: string, scale = 1): void {
  if (!spin) return;
  const h = c * 0.3 * scale, w = c * 0.14 * scale;
  const dir = spin === 1 ? -1 : 1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, c * 0.09 * scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - dir * h);
  ctx.lineTo(x, y + dir * h);
  ctx.moveTo(x - w, y + dir * (h - w));
  ctx.lineTo(x, y + dir * h);
  ctx.lineTo(x + w, y + dir * (h - w));
  ctx.stroke();
  ctx.restore();
}

/** A link's mark on the edge two cells share: "=" for match, "x" for differ. */
function linkMark(ctx: CanvasRenderingContext2D, s: SpinState, g: Geo, l: Link): void {
  const a = centerOf(s, g, l.a), b = centerOf(s, g, l.b);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const c = g.c;
  const r = c * 0.13;
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.silverDim;
  ctx.lineWidth = Math.max(1.5, c * 0.045);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (l.same) {
    ctx.moveTo(x - r * 0.75, y - r * 0.4); ctx.lineTo(x + r * 0.75, y - r * 0.4);
    ctx.moveTo(x - r * 0.75, y + r * 0.4); ctx.lineTo(x + r * 0.75, y + r * 0.4);
  } else {
    ctx.moveTo(x - r * 0.65, y - r * 0.65); ctx.lineTo(x + r * 0.65, y + r * 0.65);
    ctx.moveTo(x + r * 0.65, y - r * 0.65); ctx.lineTo(x - r * 0.65, y + r * 0.65);
  }
  ctx.stroke();
  ctx.restore();
}

/** Spin up is red and spin down blue, like a magnet's poles, so the board reads by color. */
export const SPIN_UP = '#e0503a';
export const SPIN_DOWN = '#4f8fe8';
/** The arrow on a dealt cell: dark, as if printed on the plate. The player's own are white. */
const GIVEN_INK = '#15171a';

/** Paints the grid: a red or blue plate under every spin with its arrow on top (dark on the
 *  dealt cells, white on the player's), the links, and amber outlines round whatever breaks a
 *  rule. `glow` lifts single cells (0 to 1) for the win wave. */
export function paintSpin(ctx: CanvasRenderingContext2D, s: SpinState, g: Geo, o: Paint & { glow?: (i: number) => number }): void {
  const c = g.c;
  lattice(ctx, s, g);
  const bad = o.mark ? flaws(s) : new Set<number>();
  for (let i = 0; i < s.cells.length; i++) {
    const p = centerOf(s, g, i);
    const v = s.cells[i];
    const pop = o.pop?.cell === i ? o.pop.k : 1;
    if (v) {
      const k = 0.55 + 0.45 * pop;
      const h = c * 0.4 * k;
      const given = !!s.given[i];
      tile(ctx, p.x - h, p.y - h, h * 2, h * 2, c * 0.16 * k, v === 1 ? SPIN_UP : SPIN_DOWN, null);
      const lift = o.glow?.(i) ?? 0;
      if (lift > 0) {
        ctx.save();
        ctx.globalAlpha = 0.45 * lift;
        tile(ctx, p.x - h, p.y - h, h * 2, h * 2, c * 0.16 * k, '#ffffff', null);
        ctx.restore();
      }
      arrow(ctx, p.x, p.y, c, v, given ? GIVEN_INK : '#ffffff', 0.6 + 0.4 * pop);
    }
    if (bad.has(i)) tile(ctx, p.x - c * 0.47, p.y - c * 0.47, c * 0.94, c * 0.94, c * 0.2, null, C.warn, Math.max(2, c * 0.06));
  }
  for (const l of s.links) linkMark(ctx, s, g, l);
}

export class SpinView implements PuzzleView {
  private state: SpinState;
  private history: SpinState[] = [];
  private pressed: Point | null = null;
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private mark: { state: SpinState; cell: number } | null = null;
  /** The cell last set and when, for its plate's pop. */
  private popped: { cell: number; at: number } | null = null;
  private wonAt: number | null = null;
  private now = 0;

  constructor(private readonly initial: SpinState, reducedMotion: boolean) {
    this.state = cloneSpin(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    return { progress: { label: 'Filled', value: `${s.cells.filter(Boolean).length}/${s.cells.length}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'Every spin in place';
    const bad = flaws(s).size;
    if (bad) return bad === 1 ? '1 cell breaks a rule' : `${bad} cells break a rule`;
    if (full(s)) return 'Full, but something is off';
    const left = s.cells.filter((v) => !v).length;
    return left === 1 ? '1 cell left' : `${left} cells left`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    if (wrong >= 0) {
      if (level === 2) { this.apply(set(s, wrong, s.solution[wrong])); return { text: 'Turned that spin round.', moved: true }; }
      this.mark = { state: s, cell: wrong };
      return { text: 'This spin is the wrong way round.' };
    }
    const f = nextForced(s);
    if (!f) return null;
    if (level === 2) { this.apply(set(s, f.cell, f.spin)); return { text: `Set it ${f.spin === 1 ? 'up' : 'down'}.`, moved: true }; }
    this.mark = { state: s, cell: f.cell };
    return { text: f.why };
  }

  private apply(next: SpinState | null): void {
    if (!next) return;
    const changed = next.cells.findIndex((v, i) => v !== this.state.cells[i]);
    this.popped = changed >= 0 && !this.reduced ? { cell: changed, at: this.now } : null;
    this.history.push(this.state);
    if (this.history.length > 200) this.history.shift();
    this.state = next;
  }

  restart(): void {
    this.popped = null;
    this.state = cloneSpin(this.initial);
    this.history = [];
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s || !this.cell || this.won) return;
    if (Math.hypot(p.x - s.x, p.y - s.y) > 16) return;
    const n = this.state.size;
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return;
    this.apply(tap(this.state, cy * n + cx));
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const fit = fitFramed(area, s.size, s.size, { margin: 8, maxCell: 72 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const g = { x: fit.x, y: fit.y, c };
    this.now = now;
    if (!this.won) this.wonAt = null;
    else this.wonAt ??= now;
    const k = this.popped ? Math.min(1, (now - this.popped.at) / 160) : 1;
    const pop = this.popped && k < 1 ? { cell: this.popped.cell, k: popEase(k) } : undefined;
    if (k >= 1) this.popped = null;
    // The win: a wave of light runs corner to corner across the plates, once.
    const t = this.wonAt === null || this.reduced ? -1 : now - this.wonAt;
    const glow = t >= 0 && t < 1400 ? (i: number) => {
      const d = (i % s.size) + Math.floor(i / s.size);
      const u = (t - d * 70) / 360;
      return u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
    } : undefined;
    paintSpin(ctx, s, g, { mark: true, pop, glow });
    const m = this.mark?.state === s && !this.won ? this.mark : null;
    if (m) {
      const p = centerOf(s, g, m.cell);
      drawHelpMark(ctx, p.x - c * 0.44, p.y - c * 0.44, c * 0.88, c * 0.88, now, this.reduced, c * 0.2);
    }
  }
}

/** A small overshoot, so a plate lands with a little bounce. */
const popEase = (t: number): number => { const u = t - 1; return 1 + 2.2 * u * u * u + 1.2 * u * u; };

/** The room the board frame takes round a grid of this cell size: its padding and half its stroke. */
const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

function fitFramed(area: Area, cols: number, rows: number, opts: { margin: number; maxCell: number; top?: number }): { cell: number; x: number; y: number; room: number } {
  const room = frameRoom(fitGrid(area, cols, rows, opts).cell);
  const g = fitGrid(area, cols, rows, { ...opts, margin: opts.margin + room });
  return { cell: g.cell, x: g.x, y: g.y, room };
}

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A small picture board from rows of text: 'U' and 'D' dealt spins, 'u' and 'd' spins the player
 * sets (in reading order, one every beat), '.' an empty cell. Links are given as pairs of cells.
 */
function board(rows: string[], links: { a: [number, number]; b: [number, number]; same: boolean }[] = []): { s: SpinState; fills: { cell: number; spin: Spin }[] } {
  const n = rows.length;
  const cells: Spin[] = [];
  const given: boolean[] = [];
  const fills: { cell: number; spin: Spin }[] = [];
  rows.forEach((line, y) => [...line].forEach((ch, x) => {
    const i = y * n + x;
    const up = ch === 'U' || ch === 'u', down = ch === 'D' || ch === 'd';
    const dealt = ch === 'U' || ch === 'D';
    cells[i] = dealt ? (up ? 1 : 2) : 0;
    given[i] = dealt;
    if (!dealt && (up || down)) fills.push({ cell: i, spin: up ? 1 : 2 });
  }));
  const ls: Link[] = links.map((l) => ({ a: l.a[1] * n + l.a[0], b: l.b[1] * n + l.b[0], same: l.same }));
  return { s: { size: n, cells, given, links: ls, solution: cells.slice(), moves: 0, par: 0 }, fills };
}

const LEAD = 0.4;
const BEAT = 0.45;
const REST = 0.6;

/** One rule picture: the dealt board, then the player's spins set one by one, each popping in. */
function picture(rows: string[], caption: string, links: { a: [number, number]; b: [number, number]; same: boolean }[] = []): Illustration {
  const { s: s0, fills } = board(rows, links);
  const raw = LEAD + BEAT * fills.length + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  // Long pictures play a little faster so every one stays within 4 s.
  const pace = raw / duration;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      const s = cloneSpin(s0);
      let pop: Paint['pop'];
      fills.forEach((f, k) => {
        const at = LEAD + BEAT * k;
        if (t < at) return;
        s.cells[f.cell] = f.spin;
        const dt = (t - at) / 0.25;
        if (dt < 1) pop = { cell: f.cell, k: dt };
      });
      const fit = fitFramed({ x: 0, y: 0, w, h }, s.size, s.size, { margin: 2, maxCell: 999 });
      // Rules are checked once the picture has settled, so a broken one shows amber at the end.
      const settled = t >= LEAD + BEAT * fills.length;
      paintSpin(ctx, s, { x: fit.x, y: fit.y, c: fit.cell }, { mark: settled, pop });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Spins',
    text: 'Tap an empty cell for spin up (red), again for spin down (blue), and again to clear it. Dealt spins have dark arrows and cannot change.',
    good: picture(['U.', '.d'], 'Up, then down'),
  },
  {
    title: 'Balance',
    text: 'Every row and every column holds as many ups as downs.',
    good: picture(['Ud', 'dU'], 'Two and two'),
    bad: picture(['Uu', 'dU'], 'Too many ups'),
  },
  {
    title: 'No three',
    text: 'Three alike never sit next to each other in a row or a column.',
    good: picture(['UUdd', 'dDuU', 'uDUd', 'Dudu'], 'Twos at most'),
    bad: picture(['UUud', 'dDdU', 'uDUd', 'Dudu'], 'Three ups in a row'),
  },
  {
    title: 'Links',
    text: 'Two cells joined by = take the same spin; joined by x, they differ.',
    good: picture(['UUdd', 'dDuU', 'uDUd', 'Dudu'], 'Same and different', [{ a: [0, 0], b: [1, 0], same: true }, { a: [0, 0], b: [0, 1], same: false }]),
    bad: picture(['UUdd', 'dDuU', 'uDUd', 'Dudu'], 'Linked, not the same', [{ a: [0, 0], b: [0, 1], same: true }]),
  },
];
