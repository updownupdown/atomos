// Drawing and touch for Slide Until Stop: swipe (or press an arrow, or tap a
// cell in line with the electron) and the electron slides across the lattice
// until something stops it. Photons it crosses are absorbed and unstable
// nuclei it leaves decay into fixed ones, both shown as the electron actually
// passes them.
//
// The board is painted by `paintSlide`, which the rule cards' demos share, so
// every tile in the Instructions modal is drawn exactly as on the board.
//
// Names, used the same in RULES, hint() and INSTRUCTIONS:
//   electron         the silver bead that slides;
//   lattice          the plate it slides on;
//   nucleus          a fixed blocker (model: '#' rock);
//   photon           a pickup the electron must absorb (model: spark);
//   potential well   stops the electron on entry (model: '~' sticky);
//   unstable nucleus crossable once, decays into a nucleus (model: '%' crack);
//   drift arrows     one-way cells (model: '^' 'v' '<' '>');
//   red ring         the goal.

import { allSparks, cellX, cellY, cloneSlideStop, cracksOf, isRock, slide, slideRun, solve, solved, type Dir, type SlideStopState, type Tile } from './slideStop';
import { bead, C, fitGrid, font, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView, type RuleCard } from './view';

const SWIPE = 22;
const MS_PER_CELL = 55;
const TRAIL_MS = 420;
const STATUS_H = 22;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Slide Until Stop opens each period of the table, so it is met at z 1, 3, 11, 19, 37, 55 and 87, and each gate brings something new: photons at 3, potential wells at 11, unstable nuclei at 19 (two photons from here), drift arrows at 37, three photons and three wells at 55, three unstable nuclei and three drift arrows at 87.</p>
<p class="meta">The lattice grows from 7 by 7 to 8 by 8 at z 30 and 9 by 9 at z 80. Par is the fewest slides that win, found by a search over the electron's cell, the photons absorbed and the nuclei decayed. The ring is placed where the shortest win is as long as the element's range allows, so par usually sits at the top of that range: 5 at the first gates, 7 at z 37, 9 at z 55, 12 at z 87 and up to 14 at the end of the table, with a floor that rises from 3 to 8. A board is kept only when its shortest win uses every kind of tile on it. Undo takes back a slide and restores any nucleus it decayed.</p>
`;

interface Glide { from: number; to: number; path: number[]; prev: SlideStopState; at: number; ms: number }

/** Where the board sits: its top-left corner, the cell size and how many rows show. */
interface Geo { x: number; y: number; c: number; rows: number }

interface Paint {
  won: boolean;
  /** Glows and the unstable nuclei's tremble; off under reduced motion. */
  motion: boolean;
  /** The rim flashes red: a swipe that went nowhere. */
  bumped: boolean;
  /** Small ticks at the electron's sides for the ways it can move, once it rests. */
  ticks: boolean;
  /** A cell outlined in flashing red (demos: what went wrong), with its brightness. */
  flash?: { cell: number; k: number };
}

const centerOf = (s: SlideStopState, g: Geo, i: number): Point => ({ x: g.x + ((i % s.size) + 0.5) * g.c, y: g.y + (Math.floor(i / s.size) + 0.5) * g.c });

/**
 * Paints the lattice, its tiles, the ring and the electron, mid-slide when a
 * glide is under way. Returns how far the glide has run, 0 to 1.
 */
function paintSlide(ctx: CanvasRenderingContext2D, s: SlideStopState, g: Geo, now: number, gl: Glide | null, o: Paint): number {
  const c = g.c;
  const cells = s.size * g.rows;
  const at = (i: number) => centerOf(s, g, i);

  // How far along the current slide the electron is, in cells entered.
  const t = gl ? Math.min(1, (now - gl.at) / gl.ms) : 1;
  const along = gl ? ease(t) * gl.path.length : Infinity;
  // A cell of this slide's path counts as passed once the electron is past its middle.
  const passed = (cell: number): boolean => {
    if (!gl) return true;
    if (cell === gl.from) return along >= 0.5;
    const j = gl.path.indexOf(cell);
    return j < 0 || along >= j + 1.5 || (j === gl.path.length - 1 && t >= 1);
  };
  const reached = (cell: number): boolean => {
    if (!gl) return true;
    const j = gl.path.indexOf(cell);
    return j < 0 || along >= j + 0.7;
  };

  lattice(ctx, g.x, g.y, s.size, g.rows, c, o.bumped);

  // Tiles.
  const cracks = cracksOf(s);
  for (let i = 0; i < cells; i++) {
    const t0 = s.tiles[i];
    const p = at(i);
    if (t0 === '#') nucleus(ctx, p.x, p.y, c * 0.38, i * 7 + s.size);
    else if (t0 === '~') well(ctx, p.x, p.y, c);
    else if (t0 === '%') {
      const decayedNow = isRock(s, i);
      const decayedBefore = gl ? (gl.prev.broken >> cracks.indexOf(i) & 1) === 1 : decayedNow;
      if (decayedNow && (decayedBefore || passed(i))) nucleus(ctx, p.x, p.y, c * 0.38, i * 7 + s.size);
      else unstable(ctx, p.x, p.y, c, i * 7 + s.size, o.motion ? now : 0);
    } else if (t0 !== '.') drift(ctx, p.x, p.y, c, t0);
  }

  // Photons still out (those taken on this slide are absorbed as the electron reaches them).
  let out = 0;
  s.sparks.forEach((cell, k) => {
    const takenNow = (s.got >> k & 1) === 1;
    const takenBefore = gl ? (gl.prev.got >> k & 1) === 1 : takenNow;
    if (takenBefore || (takenNow && reached(cell))) return;
    out++;
    const p = at(cell);
    photon(ctx, p.x, p.y, c * 0.24, o.motion ? now : 0, o.motion);
  });

  // The red ring: dashed while photons remain, solid once it counts, filled once the electron rests on it.
  const goal = at(s.goal);
  ring(ctx, goal.x, goal.y, c, out === 0 && s.got === allSparks(s), o.won && t >= 1);

  // The electron, easing along its slide with a fading streak behind.
  const r = c * 0.26;
  let p = at(s.pos);
  if (gl) {
    const from = at(gl.from), to = at(gl.to);
    const k = ease(t);
    p = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    const fade = 1 - Math.max(0, Math.min(1, (now - gl.at - gl.ms * 0.4) / TRAIL_MS));
    if (fade > 0) {
      ctx.save();
      ctx.globalAlpha = 0.3 * fade;
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = r * 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }
  }
  electron(ctx, p.x, p.y, r, o.won && o.motion);

  // Which ways can move, as small ticks at the electron's sides, once settled.
  if (o.ticks && !o.won && t >= 1) {
    ctx.fillStyle = C.text3;
    const dirs: [Dir, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
    for (const [d, dx, dy] of dirs) {
      if (slideRun(s, d).end === s.pos) continue;
      ctx.beginPath();
      ctx.arc(p.x + dx * (r + c * 0.1), p.y + dy * (r + c * 0.1), Math.max(1.2, c * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (o.flash && o.flash.k > 0) {
    const q = at(o.flash.cell);
    ctx.save();
    ctx.globalAlpha = o.flash.k;
    tile(ctx, q.x - c * 0.46, q.y - c * 0.46, c * 0.92, c * 0.92, c * 0.16, null, C.bad, Math.max(1.5, c * 0.05));
    ctx.restore();
  }
  return t;
}

export class SlideStopView implements PuzzleView {
  private state: SlideStopState;
  private history: SlideStopState[] = [];
  private pressed: Point | null = null;
  private glide: Glide | null = null;
  private bump = -1e9;
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private reachCache: { state: SlideStopState; left: number | null } | null = null;

  constructor(private readonly initial: SlideStopState, reducedMotion: boolean) {
    this.state = cloneSlideStop(initial);
    this.reduced = reducedMotion;
  }

  /** Slides left to a win from here (cached per state), or null when none is left. */
  private left(): number | null {
    if (this.reachCache?.state !== this.state) this.reachCache = { state: this.state, left: solve(this.state)?.length ?? null };
    return this.reachCache.left;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return !this.won && this.left() === null; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'At rest on the ring';
    if (this.stuck) return 'Out of reach: undo or restart';
    const s = this.state;
    const left = s.sparks.length - popcount(s.got);
    if (left > 0) return left === 1 ? '1 photon left' : `${left} photons left`;
    return 'Stop on the ring';
  }

  restart(): void {
    this.state = cloneSlideStop(this.initial);
    this.history = [];
    this.glide = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.glide = null;
    return true;
  }

  private go(dir: Dir): void {
    if (this.won) return;
    const run = slideRun(this.state, dir);
    const next = slide(this.state, dir);
    if (!next) { this.bump = performance.now(); return; }
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.glide = { from: this.state.pos, to: next.pos, path: run.path, prev: this.state, at: performance.now(), ms: Math.min(360, MS_PER_CELL * run.path.length) };
    this.state = next;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* read on release */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s) return;
    const dx = p.x - s.x, dy = p.y - s.y;
    if (Math.hypot(dx, dy) >= SWIPE) {
      this.go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      return;
    }
    if (!this.cell) return;
    // A tap in line with the electron slides toward it.
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    const px = cellX(this.state, this.state.pos), py = cellY(this.state, this.state.pos);
    if (cx < 0 || cy < 0 || cx >= this.state.size || cy >= this.state.size) return;
    if (cx === px && cy !== py) this.go(cy > py ? 'down' : 'up');
    else if (cy === py && cx !== px) this.go(cx > px ? 'right' : 'left');
  }

  key(e: KeyboardEvent): boolean {
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    const dir = map[e.key];
    if (!dir) return false;
    this.go(dir);
    return true;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const status = s.sparks.length > 0;
    const fit = fitGrid(area, s.size, s.size, { margin: 8, maxCell: 72, top: status ? STATUS_H : 0 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };

    const gl = this.glide && !this.reduced ? this.glide : null;
    const t = paintSlide(ctx, s, { x: fit.x, y: fit.y, c, rows: s.size }, now, gl, {
      won: this.won,
      motion: !this.reduced,
      bumped: now - this.bump < 200,
      ticks: true,
    });
    if (gl && t >= 1 && now - gl.at - gl.ms * 0.4 >= TRAIL_MS) this.glide = null;

    if (status) {
      ctx.font = font(12);
      ctx.fillStyle = C.text2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`Photons ${popcount(s.got)} / ${s.sparks.length}`, this.origin.x + 2, this.origin.y - 6);
    }
  }
}

function popcount(v: number): number {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
}

// ---- tiles ---------------------------------------------------------------------------

/** A tiny repeatable hash in [0, 1), so each nucleus packs its own way. */
const hash = (salt: number, k: number): number => {
  const t = Math.sin(salt * 12.9898 + k * 78.233) * 43758.5453;
  return t - Math.floor(t);
};

/** The calm lattice plate: a flat panel with a fine dot at each lattice point. */
function lattice(ctx: CanvasRenderingContext2D, x: number, y: number, cols: number, rows: number, c: number, bumped: boolean): void {
  const w = c * cols, h = c * rows;
  tile(ctx, x, y, w, h, c * 0.18, C.surface, null);
  ctx.fillStyle = C.line2;
  const r = Math.max(0.9, c * 0.025);
  for (let j = 1; j < rows; j++) for (let i = 1; i < cols; i++) {
    ctx.beginPath();
    ctx.arc(x + i * c, y + j * c, r, 0, Math.PI * 2);
    ctx.fill();
  }
  tile(ctx, x, y, w, h, c * 0.18, null, bumped ? C.bad : C.line2, 1);
}

/** Protons and neutrons packed tight: one in the middle and six round it, each set apart by a fine rim. */
function nucleons(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, salt: number, alpha: number, tremble: number): void {
  const b = r * 0.31;
  const turn = hash(salt, 0) * Math.PI * 2;
  const beads: [number, number, boolean][] = [];
  for (let k = 0; k < 6; k++) {
    const a = turn + (k / 6) * Math.PI * 2;
    beads.push([x + Math.cos(a) * b * 1.85, y + Math.sin(a) * b * 1.85, hash(salt, k + 1) < 0.5]);
  }
  beads.sort((p, q) => p[1] - q[1]);
  beads.push([x, y, hash(salt, 9) < 0.5]);
  // Never all one kind.
  if (beads.every((q) => q[2] === beads[0][2])) beads[2][2] = !beads[0][2];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.surface3;
  ctx.lineWidth = Math.max(0.8, b * 0.2);
  beads.forEach(([bx, by, proton], k) => {
    const jx = tremble ? Math.sin(tremble / 90 + k * 2.1) * b * 0.12 : 0;
    const jy = tremble ? Math.cos(tremble / 110 + k * 1.7) * b * 0.12 : 0;
    ctx.fillStyle = proton ? C.proton : C.neutron;
    ctx.beginPath();
    ctx.arc(bx + jx, by + jy, b, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

/** A fixed nucleus: a cluster of protons and neutrons on a dark disc. It blocks the electron. */
export function nucleus(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, salt: number): void {
  ctx.save();
  ctx.fillStyle = C.surface3;
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  nucleons(ctx, x, y, r * 0.92, salt, 1, 0);
}

/** Kept for older callers: the blocker is a nucleus now. */
export const pebble = nucleus;

/** An unstable nucleus: a faint, trembling cluster in a dashed ring. Crossable until it decays. */
function unstable(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, salt: number, now: number): void {
  const r = c * 0.38;
  ctx.save();
  ctx.strokeStyle = C.line3;
  ctx.lineWidth = Math.max(1, c * 0.03);
  ctx.setLineDash([c * 0.07, c * 0.06]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  nucleons(ctx, x, y, r * 0.8, salt, 0.55, now);
}

/** A potential well: concentric contour rings, brightening toward the middle. */
function well(ctx: CanvasRenderingContext2D, x: number, y: number, c: number): void {
  ctx.save();
  ctx.fillStyle = C.surface2;
  ctx.beginPath();
  ctx.arc(x, y, c * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, c * 0.03);
  const rings: [number, string][] = [[0.4, C.line2], [0.28, C.line3], [0.16, C.silverDim]];
  for (const [k, col] of rings) {
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, c * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = C.silverDim;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.2, c * 0.04), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Drift arrows: a pane with a double chevron pointing the only way in. */
function drift(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, t: Tile): void {
  const [dx, dy] = t === '^' ? [0, -1] : t === 'v' ? [0, 1] : t === '<' ? [-1, 0] : [1, 0];
  ctx.save();
  tile(ctx, x - c * 0.42, y - c * 0.42, c * 0.84, c * 0.84, c * 0.14, C.surface2, C.line2, 1);
  ctx.strokeStyle = C.silverDim;
  ctx.lineWidth = Math.max(1.5, c * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const k = c * 0.16;
  for (const off of [-0.12, 0.12]) {
    const cx = x + dx * off * c, cy = y + dy * off * c;
    ctx.beginPath();
    ctx.moveTo(cx - dx * k + dy * k, cy - dy * k + dx * k);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - dx * k - dy * k, cy - dy * k - dx * k);
    ctx.stroke();
  }
  ctx.restore();
}

/** A photon: a short wave packet in a soft glow, its wave drifting gently. */
function photon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, now: number, glow: boolean): void {
  ctx.save();
  ctx.fillStyle = C.warn;
  ctx.globalAlpha = 0.14;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (glow) { ctx.shadowColor = C.warn; ctx.shadowBlur = r * 0.9; }
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = Math.max(1.5, r * 0.2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const phase = now / 260;
  for (let k = 0; k <= 24; k++) {
    const u = k / 24 * 2 - 1;
    const env = Math.cos(u * Math.PI / 2) ** 2;
    const px = x + u * r, py = y - Math.sin(u * Math.PI * 2.5 - phase) * r * 0.55 * env;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

/** The red ring: dashed while photons remain, solid once it counts, filled on a win. */
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, open: boolean, won: boolean): void {
  ctx.save();
  ctx.strokeStyle = C.target;
  ctx.lineWidth = Math.max(1.5, c * 0.05);
  if (!open) ctx.setLineDash([c * 0.09, c * 0.07]);
  ctx.beginPath();
  ctx.arc(x, y, c * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  if (won) {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = C.target;
    ctx.fill();
  }
  ctx.restore();
}

/** The electron: the game's silver bead. */
function electron(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, glow: boolean): void {
  bead(ctx, x, y, r, C.silver, { rim: C.pewter, glow: glow ? C.silver : undefined });
}

// ---- rule cards ------------------------------------------------------------------------

/**
 * A small demo board: `rows` lines of text, one character per cell ('.'
 * lattice, '#' nucleus, '~' well, '%' unstable nucleus, arrows, plus 'e' the
 * electron, '*' a photon, 'o' the ring). Hidden rows of nuclei pad it square,
 * so the real slide rules run on it unchanged.
 */
function board(rows: string[]): { s: SlideStopState; rows: number } {
  const cols = rows[0].length;
  const size = Math.max(cols, rows.length);
  const tiles: Tile[] = Array(size * size).fill('#');
  const sparks: number[] = [];
  let start = 0, goal = 0;
  rows.forEach((line, y) => [...line].forEach((ch, x) => {
    const i = y * size + x;
    tiles[i] = '.';
    if (ch === 'e') start = i;
    else if (ch === 'o') goal = i;
    else if (ch === '*') sparks.push(i);
    else if (ch !== '.') tiles[i] = ch as Tile;
  }));
  return { s: { size, tiles, sparks, got: 0, broken: 0, start, goal, pos: start, moves: 0, par: 0 }, rows: rows.length };
}

/** Seconds before the first slide; photons and unstable nuclei wait longer so the still frame shows them. */
const WAIT = 0.45;
const CELL_S = 0.09;
const REST = 0.2;
const HOLD_FAIL = 0.75;
const HOLD_WIN = 1.3;

/**
 * A looping demo: each attempt starts from the board as dealt and plays its
 * slides one after another with the board's own glide. A failed attempt
 * flashes its culprit cell red; the last one ends on the ring.
 */
function scene(rows: string[], attempts: { moves: Dir[]; flash?: [number, number]; from?: [number, number] }[], lead = WAIT): (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void {
  const { s: s0, rows: n } = board(rows);
  const plays = attempts.map((a, k) => {
    const first = a.from ? { ...s0, pos: a.from[1] * s0.size + a.from[0] } : s0;
    let cur = first;
    let clock = k ? WAIT * 0.5 : lead;
    const steps = a.moves.map((d) => {
      const run = slideRun(cur, d);
      const next = slide(cur, d) ?? cur;
      const ms = Math.max(200, CELL_S * 1000 * run.path.length);
      const step = { prev: cur, next, from: cur.pos, to: next.pos, path: run.path, at: clock, ms };
      clock += ms / 1000 + REST;
      cur = next;
      return step;
    });
    const won = solved(cur);
    return { first, steps, end: cur, won, flash: a.flash ? a.flash[1] * s0.size + a.flash[0] : -1, settle: clock, len: clock + (won ? HOLD_WIN : HOLD_FAIL) };
  });
  // At least 3.4 s, so the still frame shown under reduced motion (2.5 s) has the last attempt at rest
  // (or, with a long lead, the board as dealt, for tiles the win would use up).
  const last = plays[plays.length - 1];
  last.len += Math.max(0, 3.4 - plays.reduce((a, p) => a + p.len, 0));
  const loop = plays.reduce((a, p) => a + p.len, 0);
  return (ctx, w, h, t) => {
    let u = ((t % loop) + loop) % loop;
    let k = 0;
    while (k < plays.length - 1 && u >= plays[k].len) u -= plays[k++].len;
    const play = plays[k];
    // The latest slide that has begun, kept as a glide so its streak fades as on the board.
    let st = play.first;
    let gl: Glide | null = null;
    for (const step of play.steps) {
      if (u < step.at) break;
      st = step.next;
      gl = { from: step.from, to: step.to, path: step.path, prev: step.prev, at: step.at * 1000, ms: step.ms };
    }
    const fit = fitGrid({ x: 0, y: 0, w, h }, s0.size, n, { margin: 3, maxCell: 999 });
    const since = u - play.settle;
    const flashK = play.flash >= 0 && since > 0 ? 0.55 + 0.45 * Math.cos(since * Math.PI * 5) * Math.max(0, 1 - since / 0.7) : 0;
    paintSlide(ctx, st, { x: fit.x, y: fit.y, c: fit.cell, rows: n }, u * 1000, gl, {
      won: solved(st),
      motion: true,
      bumped: false,
      ticks: true,
      flash: play.flash >= 0 ? { cell: play.flash, k: flashK } : undefined,
    });
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Slide',
    text: 'Swipe and the electron slides until something stops it: a nucleus or the rim. It cannot stop halfway.',
    demo: scene(['....', 'e...', '#o..'], [{ moves: ['right', 'down', 'left'] }]),
  },
  {
    title: 'Red ring',
    text: 'Bring the electron to rest on the red ring. Sliding over it does not count.',
    demo: scene(['....', 'e.o.', '..#.'], [{ moves: ['right'], flash: [2, 1] }, { moves: ['down'], from: [2, 0] }]),
  },
  {
    title: 'Nuclei',
    text: 'Fixed nuclei block the way. The electron stops in the cell just before one.',
    demo: scene(['e..#', '....', '#o..'], [{ moves: ['right', 'down', 'left'] }]),
  },
  {
    title: 'Photons',
    text: 'Absorb every photon by sliding over it or stopping on it. Until then the ring stays dashed.',
    demo: scene(['e.*.', '....', '#o..'], [{ moves: ['right', 'down', 'left'] }], 2.7),
  },
  {
    title: 'Potential wells',
    text: 'A well catches the electron: it stops on one as soon as it slides in.',
    demo: scene(['....', 'e.~.', '..o.'], [{ moves: ['right', 'down'] }]),
  },
  {
    title: 'Unstable nuclei',
    text: 'The electron can cross one, but as soon as it leaves, the nucleus decays into a fixed one that blocks.',
    demo: scene(['....', 'e%o.', '....'], [{ moves: ['right', 'left'] }], 2.7),
  },
  {
    title: 'Drift arrows',
    text: 'The electron can enter only moving the way the arrows point. From any other side they block it; leaving is free.',
    demo: scene(['.o..', '.^.e', '....'], [{ moves: ['left'], flash: [1, 1] }, { moves: ['up'], from: [1, 2] }]),
  },
];
