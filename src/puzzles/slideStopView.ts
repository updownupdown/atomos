// Drawing and touch for Slide Until Stop: swipe (or press an arrow, or tap a
// cell in line with the electron) and the electron slides across the lattice
// until something stops it. Photons it crosses are absorbed and unstable
// nuclei it leaves decay into fixed ones, both shown as the electron actually
// passes them.
//
// The board is painted by `paintSlide`, which the rule cards' pictures share,
// so every tile in the Instructions modal is drawn exactly as on the board.
// Fixed nuclei are plain wall blocks, so a board full of them reads calmly.
//
// Names, used the same in RULES, hint() and INSTRUCTIONS:
//   electron         the silver bead that slides;
//   lattice          the plate it slides on;
//   nucleus          a fixed blocker, drawn as a plain wall block (model: '#' rock);
//   photon           a pickup the electron must absorb (model: spark);
//   potential well   stops the electron on entry (model: '~' sticky);
//   unstable nucleus crossable once, decays into a nucleus; a dashed block (model: '%' crack);
//   drift arrows     one-way cells (model: '^' 'v' '<' '>');
//   red ring         the goal.

import { allSparks, cellX, cellY, cloneSlideStop, cracksOf, isRock, slide, slideRun, solve, solved, type Dir, type SlideStopState, type Tile } from './slideStop';
import { bead, C, fitGrid, font, tile } from './palette';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

const SWIPE = 22;
const MS_PER_CELL = 55;
const TRAIL_MS = 420;
const STATUS_H = 22;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Inertia opens each period of the table, so it is met at z 1, 3, 11, 19, 37, 55 and 87, and each gate brings something new: photons at 3, potential wells at 11, unstable nuclei at 19 (two photons from here), drift arrows at 37, three photons and three wells at 55, three unstable nuclei and three drift arrows at 87.</p>
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
  /** A cell flagged in amber (rule pictures: what went wrong), with its strength, 0 to 1. */
  flash?: { cell: number; k: number };
  /** Rule pictures: the cells the electron has rested on so far, traced faintly up to where it is now. */
  route?: number[];
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
    if (t0 === '#') nucleus(ctx, p.x, p.y, c);
    else if (t0 === '~') well(ctx, p.x, p.y, c);
    else if (t0 === '%') {
      const decayedNow = isRock(s, i);
      const decayedBefore = gl ? (gl.prev.broken >> cracks.indexOf(i) & 1) === 1 : decayedNow;
      if (decayedNow && (decayedBefore || passed(i))) nucleus(ctx, p.x, p.y, c);
      else unstable(ctx, p.x, p.y, c, i, o.motion ? now : 0);
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
  if (o.route?.length) {
    // The way the electron came, faint, with a small dot at each stop.
    ctx.save();
    ctx.strokeStyle = C.silver;
    ctx.fillStyle = C.silver;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = Math.max(1, c * 0.04);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([c * 0.08, c * 0.1]);
    ctx.beginPath();
    o.route.forEach((cell, k) => { const q = at(cell); if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const cell of o.route) {
      const q = at(cell);
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(1.5, c * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
    tile(ctx, q.x - c * 0.47, q.y - c * 0.47, c * 0.94, c * 0.94, c * 0.18, null, C.warn, Math.max(2, c * 0.06));
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
  /** Look here: the slide to point at, for the board it was asked on. */
  private mark: { state: SlideStopState; dir: Dir; end: number } | null = null;

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
  stats(): { progress: Stat } { const s = this.state; return { progress: { label: 'Photons', value: `${popcount(s.got)}/${s.sparks.length}` } }; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'At rest on the ring';
    if (this.stuck) return 'Out of reach: undo or restart';
    const s = this.state;
    const left = s.sparks.length - popcount(s.got);
    if (left > 0) return left === 1 ? '1 photon left' : `${left} photons left`;
    return 'Stop on the ring';
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const route = solve(s);
    if (!route) return this.backOnTrack();
    const dir = route[0];
    if (level === 2) {
      this.go(dir);
      return { text: `Slid ${dir}.`, moved: true };
    }
    this.mark = { state: s, dir, end: slideRun(s, dir).end };
    const text = route.length === 1 ? `Slide ${dir} to stop on the ring.`
      : s.moves === 0 ? `Start by sliding ${dir}.` : `Slide ${dir} next.`;
    return { text };
  }

  /** On a board that can no longer be won: the fewest undos back to one that can. */
  private backOnTrack(): Help {
    const h = this.history;
    for (let k = 1; k <= h.length; k++) if (solve(h[h.length - k])) return undoHelp(k);
    // Only when the way back is older than the undo history keeps.
    return { text: 'Restart to get back on track.' };
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

    // Look here: the first slide of the best route, from the electron to where it stops.
    const m = this.mark?.state === s && !this.won && t >= 1 ? this.mark : null;
    if (m) helpSlide(ctx, s, { x: fit.x, y: fit.y, c, rows: s.size }, m.end, m.dir, now, this.reduced);

    if (status) {
      ctx.font = font(12);
      ctx.fillStyle = C.text2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`Photons ${popcount(s.got)} / ${s.sparks.length}`, this.origin.x + 2, this.origin.y - 6);
    }
  }
}

/** The Look here mark for a slide: a soft outline round the cells it crosses, and a chevron where it stops. */
function helpSlide(ctx: CanvasRenderingContext2D, s: SlideStopState, g: Geo, end: number, dir: Dir, now: number, reduced: boolean): void {
  const c = g.c;
  const a = centerOf(s, g, s.pos), b = centerOf(s, g, end);
  const k = c * 0.42;
  drawHelpMark(ctx, Math.min(a.x, b.x) - k, Math.min(a.y, b.y) - k, Math.abs(b.x - a.x) + 2 * k, Math.abs(b.y - a.y) + 2 * k, now, reduced, k);
  const [dx, dy] = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
  const w = c * 0.16;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = Math.max(2, c * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(b.x - dx * w + dy * w, b.y - dy * w + dx * w);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(b.x - dx * w - dy * w, b.y - dy * w - dx * w);
  ctx.stroke();
  ctx.restore();
}

function popcount(v: number): number {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
}

// ---- tiles ---------------------------------------------------------------------------

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

/** A wall block's size and corner, as fractions of a cell. */
const BLOCK = 0.8;
const BLOCK_R = 0.16;

/**
 * A fixed nucleus: a plain wall block, flat and muted, with one small dot. It
 * blocks the electron. Kept calm on purpose: a board can hold many of them.
 */
export function nucleus(ctx: CanvasRenderingContext2D, x: number, y: number, c: number): void {
  const side = c * BLOCK;
  ctx.save();
  ctx.globalAlpha = 0.17;
  tile(ctx, x - side / 2, y - side / 2, side, side, c * BLOCK_R, C.tile, null);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = C.tile;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.5, c * 0.055), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Kept for older callers: the blocker is a nucleus now. */
export const pebble = nucleus;

/**
 * An unstable nucleus: the same block, hollow and dashed, with a small ring
 * that trembles faintly. Crossable until it decays into a fixed one.
 */
function unstable(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, salt: number, now: number): void {
  const side = c * BLOCK;
  const jx = now ? Math.sin(now / 70 + salt * 1.7) * c * 0.018 : 0;
  const jy = now ? Math.cos(now / 90 + salt * 2.3) * c * 0.018 : 0;
  ctx.save();
  ctx.globalAlpha = 0.06;
  tile(ctx, x - side / 2, y - side / 2, side, side, c * BLOCK_R, C.tile, null);
  ctx.globalAlpha = 1;
  ctx.setLineDash([c * 0.08, c * 0.065]);
  tile(ctx, x - side / 2, y - side / 2, side, side, c * BLOCK_R, null, C.line3, Math.max(1, c * 0.03));
  ctx.setLineDash([]);
  ctx.strokeStyle = C.tile;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = Math.max(1, c * 0.03);
  ctx.beginPath();
  ctx.arc(x + jx, y + jy, Math.max(2, c * 0.08), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A small picture board: `rows` lines of text, one character per cell ('.'
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

/** Seconds: a beat before the first slide, per cell slid (with a floor), a rest after each, the verdict coming in, a last rest. */
const LEAD = 0.35;
const CELL_S = 0.1;
const MIN_SLIDE = 0.22;
const PAUSE = 0.25;
const VERDICT = 0.4;
const REST = 0.45;

/**
 * One rule picture: the electron starts where dealt (or at `from`) and plays
 * its slides with the board's own glide, leaving a faint trace of its route.
 * A slide the rules refuse leaves it where it is. When it has settled, the
 * real outcome shows: the ring filled on a win, or the cell `flag` names
 * flagged in amber. The last frame is that finished state.
 */
function picture(rows: string[], moves: Dir[], caption: string, o: { from?: [number, number]; flag?: [number, number] } = {}): Illustration {
  const { s: s0, rows: n } = board(rows);
  const first = o.from ? { ...s0, pos: o.from[1] * s0.size + o.from[0] } : s0;
  let cur = first;
  let clock = LEAD;
  const steps: { prev: SlideStopState; next: SlideStopState; path: number[]; at: number; ms: number }[] = [];
  for (const d of moves) {
    const next = slide(cur, d);
    if (!next) { clock += PAUSE; continue; }
    const run = slideRun(cur, d);
    const ms = Math.max(MIN_SLIDE, CELL_S * run.path.length) * 1000;
    steps.push({ prev: cur, next, path: run.path, at: clock, ms });
    clock += ms / 1000 + PAUSE;
    cur = next;
  }
  const settle = clock;
  const raw = settle + VERDICT + REST;
  // Long routes play a little faster so every picture stays within 4 s.
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  const flag = o.flag ? o.flag[1] * s0.size + o.flag[0] : -1;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const u = t * pace;
      // The latest slide that has begun, kept as a glide so its streak fades as on the board.
      let st = first;
      let gl: Glide | null = null;
      const route: number[] = [];
      for (const step of steps) {
        if (u < step.at) break;
        route.push(step.prev.pos);
        st = step.next;
        gl = { from: step.prev.pos, to: step.next.pos, path: step.path, prev: step.prev, at: step.at * 1000, ms: step.ms };
      }
      const fit = fitGrid({ x: 0, y: 0, w, h }, s0.size, n, { margin: 3, maxCell: 999 });
      const k = flag >= 0 && u > settle ? ease((u - settle) / VERDICT) : 0;
      paintSlide(ctx, st, { x: fit.x, y: fit.y, c: fit.cell, rows: n }, u * 1000, gl, {
        won: solved(st),
        motion: true,
        bumped: false,
        ticks: false,
        flash: flag >= 0 ? { cell: flag, k } : undefined,
        route,
      });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Slide',
    text: 'Swipe and the electron slides until something stops it: a nucleus or the rim. It cannot stop halfway.',
    good: picture(['....', 'e...', '#o..'], ['right', 'down', 'left'], 'Slides until stopped'),
  },
  {
    title: 'Red ring',
    text: 'Bring the electron to rest on the red ring. Sliding over it does not count.',
    good: picture(['....', '..o.', '..#.'], ['down'], 'Comes to rest on it', { from: [2, 0] }),
    bad: picture(['....', 'e.o.', '..#.'], ['right'], 'Slides over it', { flag: [2, 1] }),
  },
  {
    title: 'Nuclei',
    text: 'Fixed nuclei, the plain gray blocks, are walls. The electron stops in the cell just before one.',
    good: picture(['e..#', '....', '#o..'], ['right', 'down', 'left'], 'Stops just before one'),
  },
  {
    title: 'Photons',
    text: 'Absorb every photon by sliding over it or stopping on it. Until then the ring stays dashed.',
    good: picture(['e.*.', '....', '#o..'], ['right', 'down', 'left'], 'Photon, then ring'),
    bad: picture(['e.*.', '....', '#o..'], ['down', 'right', 'down', 'left'], 'A photon is left', { flag: [2, 0] }),
  },
  {
    title: 'Potential wells',
    text: 'A well catches the electron: it stops on one as soon as it slides in.',
    good: picture(['....', 'e.~.', '..o.'], ['right', 'down'], 'Caught by the well'),
  },
  {
    title: 'Unstable nuclei',
    text: 'The dashed blocks can be crossed once. As soon as the electron leaves one, it decays into a fixed nucleus that blocks.',
    good: picture(['....', 'e%o.', '....'], ['right', 'left'], 'Crossed, then a wall'),
    bad: picture(['....', 'oe%.', '....'], ['right', 'left'], 'Cannot cross back', { flag: [2, 1] }),
  },
  {
    title: 'Drift arrows',
    text: 'The electron can enter only moving the way the arrows point. From any other side they block it; leaving is free.',
    good: picture(['.o..', '.^..', '....'], ['up'], 'Goes the arrows\' way', { from: [1, 2] }),
    bad: picture(['.o..', '.^.e', '....'], ['left'], 'Blocked from the side', { flag: [1, 1] }),
  },
];
