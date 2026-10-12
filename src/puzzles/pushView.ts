// Drawing and touch for Push: swipe to step the probe (or press an arrow), tap an open cell to
// walk there by the shortest way, tap a nucleon beside the probe to push it. Walking is free;
// only pushes count. Protons are red with a plus, neutrons blue with a small ring, and each
// socket is a ring of its nucleon's color; a nucleon on its own socket glows green. A nucleon
// that can never reach a socket again is outlined in amber, but nothing ends the game: undo is
// free.
//
// The board is painted by `paintPush`, which the rule cards' pictures share.

import { boxAt, cellX, cellY, clonePush, deadCells, DIR_NAME, DX, DY, dirBetween, onSocket, placed, playPush, solve, solved, step, stepCell, stepKind, stuckBoxes, walkMap, walkTo, type Dir, type Kind, type PushMove, type PushState } from './push';
import { bead, C, fitGrid, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Shepherd is a reserve game, played from the Puzzles screen. The chamber grows from 4 by 4 to 7 by 7 inside its walls, with more wall set into it as the difficulty rises. It holds one nucleon on the easiest boards, two from the top of Very easy through Easy, three through Medium and most of Hard, and four from the top of Hard on.</p>
<p class="meta">Par is the fewest pushes that solve the chamber; walking never counts. Every deal is made backwards, by pulling the nucleons off their sockets, so every one can be solved, and par is proven by a search over every position the nucleons and the probe can reach. It rises from 2 to 5 pushes on the easiest boards to around 24 to 36 on the hardest. From the middle of Easy on, a deal is kept only when pushing each nucleon straight at its socket does not solve it, and the shortest solution takes some nucleon away from its socket or the long way round, more of them the harder the board. Undo is free, and a nucleon that can never reach a socket again is outlined so you know to take it back.</p>
`;

/** Protons and neutrons, warm red and cool blue like a pair of opposite poles. */
export const PROTON = '#e0503a';
export const NEUTRON = '#4f8fe8';
const kindColor = (k: Kind): string => (k === 0 ? PROTON : NEUTRON);
const kindName = (k: Kind): string => (k === 0 ? 'proton' : 'neutron');

const SWIPE = 22;
/** Milliseconds a walking step takes, a push takes, and a landing's green ring lasts. */
const WALK_MS = 62;
const PUSH_MS = 150;
const LAND_MS = 520;

/** The interior's top-left cell (grid x 1, y 1) sits at (x, y); c is the cell size. */
interface Geo { x: number; y: number; c: number }

/** One action played out: the probe along `path` (start first), the last step a push of `push`. */
interface Anim {
  before: PushState;
  path: number[];
  push: { box: number; from: number; to: number } | null;
  /** Milliseconds per step: walking steps, then the push. */
  steps: number[];
  start: number;
}

export interface Paint {
  now: number;
  motion: boolean;
  /** The probe's position in grid cells (fractional while moving). */
  probe?: { x: number; y: number };
  /** Nucleons drawn away from their cells (moving), by index. */
  moving?: Map<number, { x: number; y: number }>;
  /** The way the probe faces. */
  face?: Dir;
  /** Nucleon indices outlined in amber: they can never reach a socket. */
  stuck?: number[];
  /** Cells tinted faintly amber: dead squares. */
  dead?: number[];
  /** Green rings spreading from sockets just filled, 0 to 1. */
  lands?: { cell: number; k: number }[];
  /** Rule pictures: a faint cyan ring where the player tapped. */
  tap?: { cell: number; k: number };
  /** Rule pictures: cells flagged amber at the end of a bad picture. */
  flag?: number[];
}

const at = (g: Geo, x: number, y: number): Point => ({ x: g.x + (x - 0.5) * g.c, y: g.y + (y - 0.5) * g.c });
const cellAt = (s: PushState, g: Geo, cell: number): Point => at(g, cellX(s, cell), cellY(s, cell));

/** The frame round the chamber's inside, its wall blocks (merged where they touch, and joined to
 *  the frame along the edge), and a faint dot on each open cell. */
function chamber(ctx: CanvasRenderingContext2D, s: PushState, g: Geo, dead: number[] | undefined): void {
  const c = g.c, cols = s.w - 2, rows = s.h - 2;
  const lw = frameWidth(c), pad = framePad(c);
  drawFrame(ctx, frameBox(g.x, g.y, cols * c, rows * c, c), { width: lw, radius: c * 0.2 + pad, color: C.frame });
  const wall = (x: number, y: number) => x >= 1 && y >= 1 && x <= cols && y <= rows && !s.floor[y * s.w + x];
  // Each wall cell is a block inset from its cell, bridged to any wall beside it at the same
  // thickness, so the walls read as one calm mass. Along the edge a wall runs out under the
  // frame (clipped to the frame's rounded line), so a notch reads as part of the room's shape.
  const ins = c * 0.1, ext = pad + lw;
  const box = frameBox(g.x, g.y, cols * c, rows * c, c);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, c * 0.2 + pad);
  ctx.clip();
  ctx.fillStyle = C.frame;
  for (let y = 1; y <= rows; y++) for (let x = 1; x <= cols; x++) {
    if (!wall(x, y)) continue;
    const x0 = g.x + (x - 1) * c, y0 = g.y + (y - 1) * c, e = c - 2 * ins;
    tile(ctx, x0 + ins, y0 + ins, e, e, c * 0.14, C.frame, null);
    ctx.fillStyle = C.frame;
    if (wall(x + 1, y)) ctx.fillRect(x0 + c / 2, y0 + ins, c, e);
    if (wall(x, y + 1)) ctx.fillRect(x0 + ins, y0 + c / 2, e, c);
    if (wall(x + 1, y) && wall(x, y + 1) && wall(x + 1, y + 1)) ctx.fillRect(x0 + c / 2, y0 + c / 2, c, c);
    // Out to the frame, and along it where the next cell on the edge is a wall too.
    const L = x === 1, R = x === cols, T = y === 1, B = y === rows;
    if (L) ctx.fillRect(x0 - ext, y0 + ins, ext + c / 2, e);
    if (R) ctx.fillRect(x0 + c / 2, y0 + ins, c / 2 + ext, e);
    if (T) ctx.fillRect(x0 + ins, y0 - ext, e, ext + c / 2);
    if (B) ctx.fillRect(x0 + ins, y0 + c / 2, e, c / 2 + ext);
    if ((L || R) && wall(x, y + 1)) ctx.fillRect(L ? x0 - ext : x0 + c - ins - 0.5, y0 + c / 2, ext + ins + 0.5, c);
    if ((T || B) && wall(x + 1, y)) ctx.fillRect(x0 + c / 2, T ? y0 - ext : y0 + c - ins - 0.5, c, ext + ins + 0.5);
    if (L && T) ctx.fillRect(x0 - ext, y0 - ext, ext + ins + 0.5, ext + ins + 0.5);
    if (R && T) ctx.fillRect(x0 + c - ins - 0.5, y0 - ext, ext + ins + 0.5, ext + ins + 0.5);
    if (L && B) ctx.fillRect(x0 - ext, y0 + c - ins - 0.5, ext + ins + 0.5, ext + ins + 0.5);
    if (R && B) ctx.fillRect(x0 + c - ins - 0.5, y0 + c - ins - 0.5, ext + ins + 0.5, ext + ins + 0.5);
  }
  ctx.restore();
  if (dead?.length) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (const cell of dead) {
      const p = cellAt(s, g, cell);
      tile(ctx, p.x - c * 0.46, p.y - c * 0.46, c * 0.92, c * 0.92, c * 0.14, C.warn, null);
    }
    ctx.restore();
  }
  ctx.fillStyle = C.surface3;
  const r = Math.max(1.5, c * 0.035);
  for (let i = 0; i < s.floor.length; i++) {
    if (!s.floor[i] || s.goals.includes(i)) continue;
    const p = cellAt(s, g, i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A socket: a thick ring in its nucleon's color with the same small mark the nucleon carries
 *  (a plus for a proton, a dot for a neutron); green once its nucleon sits in it. */
function socketRing(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, kind: Kind, filled: boolean): void {
  ctx.save();
  const col = filled ? C.good : kindColor(kind);
  ctx.strokeStyle = col;
  ctx.globalAlpha = filled ? 0.95 : 0.8;
  ctx.lineWidth = Math.max(2, c * 0.075);
  ctx.beginPath();
  ctx.arc(x, y, c * 0.39, 0, Math.PI * 2);
  ctx.stroke();
  if (!filled) {
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1.5, c * 0.05);
    ctx.lineCap = 'round';
    const k = c * 0.09;
    if (kind === 0) {
      ctx.beginPath();
      ctx.moveTo(x - k, y); ctx.lineTo(x + k, y);
      ctx.moveTo(x, y - k); ctx.lineTo(x, y + k);
      ctx.stroke();
    } else {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, k * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A nucleon: a flat disc in its kind's color, a plus on a proton and a small ring on a neutron.
 *  `home` lights it with a soft green halo. */
export function nucleon(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, kind: Kind, home: boolean): void {
  const r = c * 0.3;
  bead(ctx, x, y, r, kindColor(kind), home ? { glow: C.good } : {});
  ctx.save();
  ctx.strokeStyle = C.tile;
  ctx.lineWidth = Math.max(1.5, c * 0.06);
  ctx.lineCap = 'round';
  const k = r * 0.42;
  ctx.beginPath();
  if (kind === 0) {
    ctx.moveTo(x - k, y); ctx.lineTo(x + k, y);
    ctx.moveTo(x, y - k); ctx.lineTo(x, y + k);
  } else {
    ctx.arc(x, y, k * 0.75, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/** The probe: a silver bead with a small cyan chevron for its heading. */
function probe(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, face: Dir): void {
  const r = c * 0.24;
  bead(ctx, x, y, r, C.silver, { rim: C.silverDim });
  const dx = DX[face], dy = DY[face], k = r * 0.42;
  const tx = x + dx * r * 0.45, ty = y + dy * r * 0.45;
  ctx.save();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = Math.max(1.5, r * 0.24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tx - dx * k + dy * k, ty - dy * k + dx * k);
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx - dx * k - dy * k, ty - dy * k - dx * k);
  ctx.stroke();
  ctx.restore();
}

/** Paints the chamber, its sockets, nucleons and the probe. */
export function paintPush(ctx: CanvasRenderingContext2D, s: PushState, g: Geo, o: Paint): void {
  const c = g.c;
  chamber(ctx, s, g, o.dead);
  const moving = o.moving ?? new Map();
  // Sockets: green only once their own kind rests in them (and is not still sliding in).
  s.goals.forEach((cell, gi) => {
    const p = cellAt(s, g, cell);
    const i = boxAt(s, cell);
    const filled = i >= 0 && !moving.has(i) && s.kinds[i] === s.goalKinds[gi];
    socketRing(ctx, p.x, p.y, c, s.goalKinds[gi], filled);
  });
  for (const l of o.lands ?? []) {
    const p = cellAt(s, g, l.cell);
    ctx.save();
    ctx.globalAlpha = 0.8 * (1 - l.k);
    ctx.strokeStyle = C.good;
    ctx.lineWidth = Math.max(2, c * 0.06);
    ctx.beginPath();
    ctx.arc(p.x, p.y, c * (0.39 + 0.16 * ease(l.k)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (o.tap && o.tap.k < 1) {
    const p = cellAt(s, g, o.tap.cell);
    ctx.save();
    ctx.globalAlpha = 0.9 * (1 - o.tap.k);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = Math.max(2, c * 0.06);
    ctx.beginPath();
    ctx.arc(p.x, p.y, c * (0.18 + 0.2 * o.tap.k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const stuck = new Set(o.stuck ?? []);
  s.boxes.forEach((cell, i) => {
    const m = moving.get(i);
    const p = m ? at(g, m.x, m.y) : cellAt(s, g, cell);
    const home = !m && onSocket(s, i);
    nucleon(ctx, p.x, p.y, c, s.kinds[i], home);
    if (stuck.has(i) && !m) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = Math.max(2, c * 0.06);
      ctx.beginPath();
      ctx.arc(p.x, p.y, c * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  });
  for (const cell of o.flag ?? []) {
    const p = cellAt(s, g, cell);
    tile(ctx, p.x - c * 0.46, p.y - c * 0.46, c * 0.92, c * 0.92, c * 0.18, null, C.warn, Math.max(2, c * 0.06));
  }
  const pp = o.probe ?? { x: cellX(s, s.player), y: cellY(s, s.player) };
  const q = at(g, pp.x, pp.y);
  probe(ctx, q.x, q.y, c, o.face ?? 2);
}

/** Where an animation has the probe and the pushed nucleon at `ms` into it; done once past its end. */
function animAt(s: PushState, a: Anim, ms: number): { probe: { x: number; y: number }; box: { x: number; y: number } | null; face: Dir; done: boolean } {
  const p = a.path;
  let t = ms, i = 0;
  while (i < a.steps.length && t >= a.steps[i]) { t -= a.steps[i]; i++; }
  const done = i >= a.steps.length;
  const seg = Math.min(i, p.length - 2);
  const isPush = a.push !== null && seg === p.length - 2;
  const f = done ? 1 : isPush ? ease(t / a.steps[i]) : t / a.steps[i];
  const ax = cellX(s, p[seg]), ay = cellY(s, p[seg]), bx = cellX(s, p[seg + 1]), by = cellY(s, p[seg + 1]);
  const probeAt = { x: ax + (bx - ax) * f, y: ay + (by - ay) * f };
  const face = dirBetween(s, p[seg], p[seg + 1]);
  let box: { x: number; y: number } | null = null;
  if (a.push) {
    const k = seg === p.length - 2 ? f : 0;
    const fx = cellX(s, a.push.from), fy = cellY(s, a.push.from), tx = cellX(s, a.push.to), ty = cellY(s, a.push.to);
    box = { x: fx + (tx - fx) * k, y: fy + (ty - fy) * k };
  }
  return { probe: probeAt, box, face, done };
}

export class PushView implements PuzzleView {
  private state: PushState;
  private history: PushState[] = [];
  private pressed: Point | null = null;
  private geo: Geo = { x: 0, y: 0, c: 0 };
  private reduced: boolean;
  private anims: Anim[] = [];
  private lands: { cell: number; at: number }[] = [];
  private face: Dir = 2;
  /** The plan from a position: its nucleons and the probe's region, and the pushes. */
  private plan: { key: string; moves: PushMove[] } | null = null;
  private mark: { state: PushState; box: number; dir: Dir | null; dead: number[] } | null = null;

  constructor(private readonly initial: PushState, reducedMotion: boolean) {
    this.state = clonePush(initial);
    this.reduced = reducedMotion;
  }

  /** Won once the last push has played out. */
  get won(): boolean { return solved(this.state) && this.anims.length === 0; }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    return { progress: { label: 'Placed', value: `${placed(s)}/${s.boxes.length}` } };
  }

  hint(): string {
    const s = this.state;
    if (solved(s)) return 'Every nucleon in its socket';
    if (stuckBoxes(s).length) return 'A nucleon is stuck: undo';
    const left = s.boxes.length - placed(s);
    return left === 1 ? '1 nucleon to place' : `${left} nucleons to place`;
  }

  /** A position's key for the plan cache: the nucleons and the smallest cell the probe can reach. */
  private keyOf(s: PushState): string {
    const map = walkMap(s);
    let min = s.player;
    for (let i = 0; i < map.length; i++) if (map[i] !== -2) { min = i; break; }
    return `${s.boxes.join(',')}|${min}`;
  }

  /** The best pushes from here, cached while the player keeps to them; null when there are none. */
  private planFor(s: PushState): PushMove[] | null | 'unknown' {
    const key = this.keyOf(s);
    if (this.plan?.key === key) return this.plan.moves;
    const r = solve(s, 250000);
    if (!r.moves) return r.proven ? null : 'unknown';
    this.plan = { key, moves: r.moves };
    return r.moves;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (solved(s)) return null;
    this.finish();
    const plan = this.planFor(s);
    if (plan === null || plan === 'unknown') {
      const stuck = stuckBoxes(s);
      if (level === 1 && stuck.length) this.mark = { state: s, box: stuck[0], dir: null, dead: deadCells(s, s.kinds[stuck[0]]) };
      return plan === null ? this.backOnTrack() : { text: 'Too tangled to read from here: try undoing a push or two.' };
    }
    const m = plan[0];
    const box = boxAt(s, m.cell);
    const what = kindName(s.kinds[box]);
    if (level === 2) {
      const res = playPush(s, m);
      if (!res) return null;
      this.commit(res.state, [s.player, ...res.walk, m.cell], { box, from: m.cell, to: res.state.boxes[box] });
      this.plan = { key: this.keyOf(this.state), moves: plan.slice(1) };
      return { text: `Pushed the ${what} ${DIR_NAME[m.dir]}.`, moved: true };
    }
    this.mark = { state: s, box, dir: m.dir, dead: [] };
    const text = plan.length === 1 ? `Push this ${what} ${DIR_NAME[m.dir]} to finish.`
      : s.moves === 0 ? `Start with this ${what}: push it ${DIR_NAME[m.dir]}.` : `Push this ${what} ${DIR_NAME[m.dir]} next.`;
    return { text };
  }

  /** On a chamber that can no longer be solved: the fewest undos back to one that can. */
  private backOnTrack(): Help {
    const h = this.history;
    // The search for each is capped, and so is the whole look back, so a hint never stalls.
    let spent = 0;
    for (let k = 1; k <= h.length && spent < 400000; k++) {
      const r = solve(h[h.length - k], 100000);
      if (r.moves) return undoHelp(k);
      spent += r.nodes + 1;
    }
    return { text: 'Restart to get back on track.' };
  }

  restart(): void {
    this.state = clonePush(this.initial);
    this.history = [];
    this.anims = [];
    this.lands = [];
    this.face = 2;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.anims = [];
    this.lands = [];
    return true;
  }

  /** Ends any animation at once (before a hint reads the board). */
  private finish(): void {
    if (this.anims.length) this.anims = [];
  }

  /**
   * Takes a new state from one action: the probe's path (start first) and, when the last step
   * pushed, which nucleon went where. Pushes go on the undo history, walks do not.
   */
  private commit(next: PushState, path: number[], push: Anim['push']): void {
    const prev = this.state;
    if (push) {
      this.history.push(prev);
      if (this.history.length > 400) this.history.shift();
    }
    this.state = next;
    if (path.length >= 2) this.face = dirBetween(next, path[path.length - 2], path[path.length - 1]);
    const now = performance.now();
    if (this.reduced || path.length < 2) {
      this.anims = [];
      return;
    }
    // A walk takes a steady pace, shortened for long ones; the push takes a little longer.
    const walkSteps = path.length - 1 - (push ? 1 : 0);
    const per = Math.min(WALK_MS, 520 / Math.max(1, walkSteps));
    const steps = Array.from({ length: walkSteps }, () => per);
    if (push) steps.push(PUSH_MS);
    // Queued behind the one playing, which hurries to make room.
    const last = this.anims[this.anims.length - 1];
    const start = last ? Math.max(now, last.start + last.steps.reduce((a, b) => a + b, 0)) : now;
    this.anims.push({ before: prev, path, push, steps, start });
    if (this.anims.length > 2) this.anims.splice(0, this.anims.length - 2);
    if (push && onSocket(next, push.box)) {
      this.lands.push({ cell: push.to, at: start + steps.reduce((a, b) => a + b, 0) });
    }
  }

  /** One step of the probe in a direction: a walk, a push or nothing. */
  private go(dir: Dir): void {
    if (solved(this.state)) return;
    const s = this.state;
    const k = stepKind(s, dir);
    const next = step(s, dir);
    if (!k || !next) { this.face = dir; return; }
    const to = stepCell(s, s.player, dir);
    this.commit(next, [s.player, to], k.kind === 'push' ? { box: k.box, from: to, to: next.boxes[k.box] } : null);
  }

  /** A walk to a cell by the shortest way. */
  private walk(cell: number): void {
    const s = this.state;
    const path = walkTo(s, cell);
    if (!path || !path.length) return;
    this.commit({ ...s, player: cell }, [s.player, ...path], null);
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* read on release */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s0 = this.pressed;
    this.pressed = null;
    if (!s0 || solved(this.state)) return;
    const dx = p.x - s0.x, dy = p.y - s0.y;
    if (Math.hypot(dx, dy) >= SWIPE) {
      this.go((Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0) as Dir);
      return;
    }
    const g = this.geo;
    if (!g.c) return;
    const s = this.state;
    const x = Math.floor((p.x - g.x) / g.c) + 1, y = Math.floor((p.y - g.y) / g.c) + 1;
    if (x < 1 || y < 1 || x > s.w - 2 || y > s.h - 2) return;
    const cell = y * s.w + x;
    if (cell === s.player) return;
    if (boxAt(s, cell) >= 0) {
      // A nucleon beside the probe is pushed straight on, away from it.
      const px = cellX(s, s.player), py = cellY(s, s.player);
      if (Math.abs(px - x) + Math.abs(py - y) === 1) this.go(dirBetween(s, s.player, cell));
      return;
    }
    if (s.floor[cell]) this.walk(cell);
  }

  key(e: KeyboardEvent): boolean {
    const map: Record<string, Dir> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };
    const dir = map[e.key];
    if (dir === undefined) return false;
    this.go(dir);
    return true;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const fit = fitFramed(area, s.w - 2, s.h - 2, { margin: 8, maxCell: 72 });
    const g = { x: fit.x, y: fit.y, c: fit.cell };
    this.geo = g;
    // Finished animations drop off; the first one still running is drawn.
    while (this.anims.length) {
      const a = this.anims[0];
      const total = a.steps.reduce((x, y) => x + y, 0);
      if (now - a.start < total) break;
      this.anims.shift();
    }
    this.lands = this.lands.filter((l) => now - l.at < LAND_MS);
    const a = this.anims[0];
    let shown = s;
    const o: Paint = { now, motion: !this.reduced, face: this.face };
    if (a && now >= a.start) {
      shown = a.before;
      const pos = animAt(a.before, a, now - a.start);
      o.probe = pos.probe;
      o.face = pos.face;
      if (a.push && pos.box) o.moving = new Map([[a.push.box, pos.box]]);
    } else if (a) {
      shown = a.before;
    }
    if (shown === s) o.stuck = stuckBoxes(s);
    o.lands = this.lands.filter((l) => now >= l.at).map((l) => ({ cell: l.cell, k: (now - l.at) / LAND_MS }));
    const m = this.mark?.state === s && !a && !solved(s) ? this.mark : null;
    if (m?.dead.length) o.dead = m.dead;
    paintPush(ctx, shown, g, o);
    if (m) {
      const p = cellAt(s, g, s.boxes[m.box]);
      const c = g.c;
      drawHelpMark(ctx, p.x - c * 0.44, p.y - c * 0.44, c * 0.88, c * 0.88, now, this.reduced, c * 0.44);
      if (m.dir !== null) chevron(ctx, p.x + DX[m.dir] * c * 0.62, p.y + DY[m.dir] * c * 0.62, c, m.dir);
    }
  }
}

/** A small chevron pointing the way the marked nucleon is to go. */
function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, dir: Dir): void {
  const dx = DX[dir], dy = DY[dir], k = c * 0.1;
  ctx.save();
  ctx.strokeStyle = C.text;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(2, c * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - dx * k + dy * k, y - dy * k + dx * k);
  ctx.lineTo(x, y);
  ctx.lineTo(x - dx * k - dy * k, y - dy * k - dx * k);
  ctx.stroke();
  ctx.restore();
}

const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

function fitFramed(area: Area, cols: number, rows: number, opts: { margin: number; maxCell: number; top?: number }): { cell: number; x: number; y: number } {
  const room = frameRoom(fitGrid(area, cols, rows, opts).cell);
  const g = fitGrid(area, cols, rows, { ...opts, margin: opts.margin + room });
  return { cell: g.cell, x: g.x, y: g.y };
}

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A small picture chamber from rows of text (the inside only; the wall ring is added): '.' open,
 * '#' wall, '@' the probe, 'p' and 'n' a proton and a neutron, '+' and 'o' their sockets, 'P'
 * and 'N' each already on its own socket.
 */
export function board(rows: string[]): PushState {
  const cols = Math.max(...rows.map((r) => r.length));
  const w = cols + 2, h = rows.length + 2;
  const floor = Array<boolean>(w * h).fill(false);
  const goals: number[] = [], goalKinds: Kind[] = [], boxes: number[] = [], kinds: Kind[] = [];
  let player = -1;
  rows.forEach((line, y) => [...line.padEnd(cols, '.')].forEach((ch, x) => {
    const c = (y + 1) * w + x + 1;
    if (ch === '#') return;
    floor[c] = true;
    if (ch === '@') player = c;
    if (ch === '+' || ch === 'P') { goals.push(c); goalKinds.push(0); }
    if (ch === 'o' || ch === 'N') { goals.push(c); goalKinds.push(1); }
    if (ch === 'p' || ch === 'P') { boxes.push(c); kinds.push(0); }
    if (ch === 'n' || ch === 'N') { boxes.push(c); kinds.push(1); }
  }));
  return { w, h, floor, goals, goalKinds, boxes, kinds, player, moves: 0, par: 0 };
}

const LEAD = 0.45;
const STEP = 0.3;
const REST = 0.6;

/** One beat of a picture: a step (walk or push) or a bump against what will not move. */
interface Beat { before: PushState; after: PushState; dir: Dir; push: number; bump: boolean; at: number; dur: number }

/**
 * One rule picture: the probe takes the steps in `moves` ('U', 'R', 'D', 'L'), one a beat, or
 * walks to a tapped cell (a '*' then the cell's x and y, e.g. '*3,1') along the shortest way.
 * A bad picture ends with `flag` (cells, as [x, y] inside the chamber) outlined in amber; with
 * `dead`, the stuck nucleon is outlined too and that kind's dead squares are tinted.
 */
function picture(rows: string[], moves: string, caption: string, opts: { bad?: boolean; flag?: [number, number][]; dead?: Kind } = {}): Illustration {
  const s0 = board(rows);
  const beats: Beat[] = [];
  let cur = s0, clock = LEAD;
  const taps: { cell: number; at: number }[] = [];
  const dirs: Dir[] = [];
  for (const tok of moves.match(/\*\d+,\d+|[URDL]/g) ?? []) {
    if (tok[0] === '*') {
      const [x, y] = tok.slice(1).split(',').map(Number);
      const cell = (y + 1) * s0.w + x + 1;
      const path = walkTo(cur, cell) ?? [];
      taps.push({ cell, at: clock });
      clock += 0.25;
      let from = cur.player;
      for (const c of path) { dirs.push(dirBetween(cur, from, c)); from = c; }
      // Walk the tapped path at once, beat by beat (a little quicker than single steps).
      for (const d of dirs.splice(0)) {
        const next = step(cur, d)!;
        beats.push({ before: cur, after: next, dir: d, push: -1, bump: false, at: clock, dur: STEP * 0.6 });
        clock += STEP * 0.6;
        cur = next;
      }
      continue;
    }
    const d = 'URDL'.indexOf(tok) as Dir;
    const k = stepKind(cur, d);
    const next = step(cur, d);
    if (!k || !next) {
      beats.push({ before: cur, after: cur, dir: d, push: -1, bump: true, at: clock, dur: STEP * 1.3 });
      clock += STEP * 1.3;
      continue;
    }
    beats.push({ before: cur, after: next, dir: d, push: k.kind === 'push' ? k.box : -1, bump: false, at: clock, dur: STEP });
    clock += STEP;
    cur = next;
  }
  const end = cur;
  const raw = clock + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  const flagCells = (opts.flag ?? []).map(([x, y]) => (y + 1) * s0.w + x + 1);
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      const fit = fitFramed({ x: 0, y: 0, w, h }, s0.w - 2, s0.h - 2, { margin: 2, maxCell: 999 });
      const g = { x: fit.x, y: fit.y, c: fit.cell };
      let shown = s0;
      const o: Paint = { now: t * 1000, motion: true, face: 2 };
      let lastFace: Dir = 2;
      for (const b of beats) {
        if (t < b.at) break;
        lastFace = b.dir;
        const k = Math.min(1, (t - b.at) / b.dur);
        if (k >= 1) { shown = b.after; continue; }
        shown = b.before;
        const px = cellX(b.before, b.before.player), py = cellY(b.before, b.before.player);
        if (b.bump) {
          const nudge = 0.22 * Math.sin(Math.PI * k);
          o.probe = { x: px + DX[b.dir] * nudge, y: py + DY[b.dir] * nudge };
        } else {
          const e = b.push >= 0 ? ease(k) : k;
          o.probe = { x: px + DX[b.dir] * e, y: py + DY[b.dir] * e };
          if (b.push >= 0) {
            const bc = b.before.boxes[b.push];
            o.moving = new Map([[b.push, { x: cellX(b.before, bc) + DX[b.dir] * e, y: cellY(b.before, bc) + DY[b.dir] * e }]]);
          }
        }
        break;
      }
      o.face = lastFace;
      const tap = taps.filter((x) => t >= x.at).pop();
      if (tap) o.tap = { cell: tap.cell, k: Math.min(1, (t - tap.at) / 0.6) };
      // Sockets filled during the picture ring green as their nucleon lands.
      o.lands = [];
      for (const b of beats) {
        if (b.push < 0 || !onSocket(b.after, b.push)) continue;
        const k = (t - b.at - b.dur) / (LAND_MS / 1000);
        if (k >= 0 && k < 1) o.lands.push({ cell: b.after.boxes[b.push], k });
      }
      const settled = t >= clock;
      if (opts.bad && settled) {
        o.flag = flagCells;
        if (opts.dead !== undefined) { o.stuck = stuckBoxes(end); o.dead = deadCells(end, opts.dead); }
      }
      paintPush(ctx, shown, g, o);
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Walk',
    text: 'Swipe to step the probe, or tap an open cell to walk there the shortest way. Walking is free: only pushes count.',
    good: picture(['@....', '.##..', '.....'], '*4,2', 'Tap to walk there'),
  },
  {
    title: 'Push',
    text: 'Step into a nucleon, or tap one beside the probe, to push it a cell. You push one at a time and can never pull.',
    good: picture(['.....', '@n...', '.....'], 'RRR', 'One cell a push'),
    bad: picture(['.....', '@pn..', '.....'], 'R', 'Two will not budge', { bad: true, flag: [[1, 1], [2, 1]] }),
  },
  {
    title: 'Sockets',
    text: 'Push each nucleon onto a ring of its own color: protons on red, neutrons on blue. Fill every ring to win.',
    good: picture(['@p.+.', '.....', '.n..o'], 'RRLLDDRRR', 'Each to its own ring'),
    bad: picture(['@p.o.', '.....', '.n..+'], 'RR', 'Wrong ring', { bad: true, flag: [[3, 0]] }),
  },
  {
    title: 'Corners',
    text: 'A nucleon pushed into a corner, or flat against a wall with no ring along it, is stuck for good. Undo is free, so take the push back.',
    good: picture(['+...', 'p...', '@...'], 'UR', 'A corner with a ring'),
    bad: picture(['.p@.', '....', '...+'], 'LD', 'Stuck in a corner', { bad: true, dead: 0 }),
  },
];
