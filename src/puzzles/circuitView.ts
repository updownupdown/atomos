// Drawing and touch for Circuit: tap a tile to turn it clockwise, swipe left on it to turn it
// back, hold it to lock it. Wires run from each tile's middle to its sides. The cell (a battery)
// sits on one tile; lamps sit at the ends of the wiring. Wires joined to the cell are live and
// glow cyan, lamps on them light up, and the rest stay gray. A live wire end that meets nothing
// gets an amber dot, and live wires that close a loop turn amber. When every tile is live with
// no loose end, the whole circuit turns green.
//
// The board is painted by `paintCircuit`, which the rule cards' pictures share.

import { cloneCircuit, firstWrong, nextStep, powerOf, rotations, shortest, toggleLock, turn, wireCount, type CircuitState, type Power, type Why } from './circuit';
import { C, fitGrid, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Volta is a reserve game, played from the Puzzles screen. The grid grows from 4 by 4 to 8 by 8 in nine steps. Easy boards have long straight runs and can be worked out tile by tile from the edges; harder ones have more branches and bends, fewer straight pieces, and are picked to need a look one tile ahead here and there. The wiring is a tree grown over the whole grid, and it is kept only when a solver can work it out without guessing, so every board has exactly one answer. A tap turns a tile a quarter turn clockwise and a left swipe turns it back, each quarter turn one move; par is the fewest quarter turns that bring every tile into place. Hold a tile to lock it; locking is free.</p>
`;

/** Milliseconds a quarter turn takes to show. */
const TURN_MS = 140;
/** Milliseconds to hold a tile to lock it. */
const HOLD_MS = 450;
/** Milliseconds per step of the current's surge along newly live wires. */
const SURGE_STEP = 55;
/** How far a finger may wander and still tap, and how far a swipe must go. */
const SLOP = 12;
const SWIPE = 22;

/** A lit lamp's warm white. */
const LAMP = '#fff4dc';

interface Geo { x: number; y: number; c: number }

interface Paint {
  /** Flag live loose ends and loops in amber. */
  mark: boolean;
  /** Tiles part way through a turn: the angle (radians) each still has to go. */
  spin?: Map<number, number>;
  /** The green of a finished board, 0 to 1. */
  glow?: number;
  /** The surge: milliseconds since the live wiring last grew, and the depth it grew from. */
  surge?: { ms: number; from: number } | null;
  /** Power already worked out for these tiles. */
  power?: Power;
}

const centerOf = (s: CircuitState, g: Geo, i: number): Point => ({ x: g.x + ((i % s.cols) + 0.5) * g.c, y: g.y + (Math.floor(i / s.cols) + 0.5) * g.c });

const DXY: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** A battery: the circuit symbol for a cell, a long thin plate and a short thick one, on a disc. */
function battery(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, fill: string): void {
  const r = c * 0.25;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.tileInk;
  ctx.lineCap = 'butt';
  ctx.lineWidth = Math.max(1.5, c * 0.04);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.25, y - r * 0.6);
  ctx.lineTo(x - r * 0.25, y + r * 0.6);
  ctx.stroke();
  ctx.lineWidth = Math.max(2.5, c * 0.09);
  ctx.beginPath();
  ctx.moveTo(x + r * 0.25, y - r * 0.32);
  ctx.lineTo(x + r * 0.25, y + r * 0.32);
  ctx.stroke();
}

/** A lamp: the circuit symbol, a circle with a cross in it; lit, it glows warm white. */
function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, lit: boolean, wire: string): void {
  const r = c * 0.19;
  ctx.save();
  if (lit) { ctx.shadowColor = LAMP; ctx.shadowBlur = c * 0.35; }
  ctx.fillStyle = lit ? LAMP : C.surface2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = lit ? C.tileInk : wire;
  ctx.lineWidth = Math.max(1.5, c * 0.045);
  if (!lit) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const k = r * 0.62;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k);
  ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
  ctx.stroke();
  ctx.restore();
}

/** Paints the board: plates, wires, the cell and the lamps, live or dead, and the problems. */
export function paintCircuit(ctx: CanvasRenderingContext2D, s: CircuitState, g: Geo, o: Paint): void {
  const c = g.c;
  drawFrame(ctx, frameBox(g.x, g.y, s.cols * c, s.rows * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  const pw = o.power ?? powerOf(s.cols, s.rows, s.tiles, s.source);
  const glow = o.glow ?? 0;
  const loose = new Set(o.mark ? pw.loose.map(([i, d]) => i * 4 + d) : []);
  const loopy = new Set<number>();
  if (o.mark) for (const key of pw.loops) {
    const [a, d] = key.split(':').map(Number);
    loopy.add(a * 4 + d);
    const b = a + DXY[d][0] + DXY[d][1] * s.cols;
    loopy.add(b * 4 + ((d + 2) % 4));
  }
  const lw = Math.max(3, c * 0.15);
  const live = (i: number) => pw.live[i];
  const wireColor = (i: number) => (glow > 0 ? C.good : live(i) ? C.accent : C.pewter);
  for (let i = 0; i < s.tiles.length; i++) {
    const p = centerOf(s, g, i);
    tile(ctx, p.x - c * 0.46, p.y - c * 0.46, c * 0.92, c * 0.92, c * 0.14, s.locked[i] ? C.surface3 : C.surface2);
    if (s.locked[i]) {
      // A pin in the corner: a locked tile reads by its plate and this, not by color alone.
      ctx.fillStyle = C.text2;
      ctx.beginPath();
      ctx.arc(p.x - c * 0.33, p.y - c * 0.33, Math.max(1.5, c * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Surge: how bright each live tile is as the current's front passes it.
  const surgeAt = (i: number): number => {
    const sg = o.surge;
    if (!sg || !live(i)) return 0;
    const front = sg.from + sg.ms / SURGE_STEP;
    const dd = pw.depth[i];
    if (dd < sg.from) return 0;
    return Math.max(0, 1 - Math.abs(front - dd) / 1.4);
  };
  for (let i = 0; i < s.tiles.length; i++) {
    const p = centerOf(s, g, i);
    const m = s.tiles[i];
    const angle = o.spin?.get(i) ?? 0;
    const color = wireColor(i);
    // Points in the tile, turned back by however far it still has to turn.
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const pt = (dx: number, dy: number): Point => ({ x: p.x + dx * cos - dy * sin, y: p.y + dx * sin + dy * cos });
    ctx.save();
    if (live(i) || glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = lw * (glow > 0 ? 1.6 * glow + 0.6 : 0.9); }
    ctx.lineWidth = lw;
    ctx.lineCap = 'butt';
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      const e = pt(DXY[d][0] * c * 0.5, DXY[d][1] * c * 0.5);
      ctx.strokeStyle = loopy.has(i * 4 + d) ? C.warn : color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
    }
    // The joint in the middle, rounding the bends: amber when the tile is on a loop.
    let onLoop = false;
    for (let d = 0; d < 4; d++) if (loopy.has(i * 4 + d)) onLoop = true;
    ctx.fillStyle = onLoop ? C.warn : color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, lw / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    const k = angle ? 0 : surgeAt(i);
    if (k > 0) {
      ctx.globalAlpha = 0.75 * k;
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = lw * 0.5;
      ctx.lineCap = 'round';
      for (let d = 0; d < 4; d++) {
        if (!(m & (1 << d))) continue;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + DXY[d][0] * c * 0.45, p.y + DXY[d][1] * c * 0.45);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (i === s.source) battery(ctx, p.x, p.y, c, glow > 0 ? C.good : C.accent);
    else if (wireCount(m) === 1) lamp(ctx, p.x, p.y, c, live(i), C.pewter);
    // Loose ends: an amber dot, ringed in black, where a live wire meets nothing.
    for (let d = 0; d < 4; d++) {
      if (!loose.has(i * 4 + d) || angle) continue;
      const ex = p.x + DXY[d][0] * c * 0.4, ey = p.y + DXY[d][1] * c * 0.4;
      ctx.fillStyle = C.bg;
      ctx.beginPath();
      ctx.arc(ex, ey, lw * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.warn;
      ctx.beginPath();
      ctx.arc(ex, ey, lw * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

const WHY: Record<Why, string> = {
  edge: 'No wire may point off the board, so this tile can lie only one way.',
  neighbors: 'The tiles round it leave this one only one way to lie.',
  loop: 'Any other way would close a loop, or cut a piece off from the cell.',
  ahead: 'Try each other way: each one leaves a tile nearby no way to fit, or closes a loop.',
};

export class CircuitView implements PuzzleView {
  private state: CircuitState;
  private history: CircuitState[] = [];
  private press: { p: Point; cell: number; at: number; far: boolean; held: boolean } | null = null;
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private mark: { state: CircuitState; cell: number } | null = null;
  /** Tiles turning: when the turn started and how many quarter turns it showed (signed). */
  private turning = new Map<number, { at: number; quarters: number }>();
  private surge: { at: number; from: number } | null = null;
  private wonAt: number | null = null;
  private powerCache: { state: CircuitState; power: Power } | null = null;

  constructor(private readonly initial: CircuitState, reducedMotion: boolean, private readonly clock: () => number = () => performance.now()) {
    this.state = cloneCircuit(initial);
    this.reduced = reducedMotion;
  }

  private power(s = this.state): Power {
    if (this.powerCache?.state !== s) this.powerCache = { state: s, power: powerOf(s.cols, s.rows, s.tiles, s.source) };
    return this.powerCache.power;
  }

  private done(): boolean {
    const p = this.power();
    return p.loose.length === 0 && p.loops.size === 0 && p.live.every(Boolean);
  }

  /** Won once the last turn has shown. */
  get won(): boolean { return this.done() && !this.busy(); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  private busy(): boolean {
    const now = this.clock();
    for (const t of this.turning.values()) if (now - t.at < TURN_MS * Math.min(3, Math.abs(t.quarters))) return true;
    return false;
  }

  stats(): { progress: Stat } {
    const live = this.power().live.filter(Boolean).length;
    return { progress: { label: 'Live', value: `${live}/${this.state.tiles.length}` } };
  }

  hint(): string {
    if (this.done()) return 'Every tile live';
    const p = this.power();
    if (p.loops.size) return 'The live wires close a loop';
    const dead = p.live.filter((x) => !x).length;
    if (!dead) return p.loose.length === 1 ? '1 loose end' : `${p.loose.length} loose ends`;
    return dead === 1 ? '1 tile dead' : `${dead} tiles dead`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    if (wrong >= 0) {
      if (level === 2) {
        const k = shortest(s.tiles[wrong], s.solution[wrong]);
        const next = turn(toggleLock(s, wrong), wrong, k)!;
        next.locked[wrong] = true;
        this.apply(next, wrong, k);
        return { text: 'Turned that locked tile into place.', moved: true };
      }
      this.mark = { state: s, cell: wrong };
      return { text: 'This tile is locked the wrong way round.' };
    }
    const step = nextStep(s);
    if (!step) return null;
    if (level === 2) {
      const k = shortest(s.tiles[step.cell], s.solution[step.cell]);
      const next = turn(s, step.cell, k);
      if (!next) return null;
      next.locked[step.cell] = true;
      this.apply(next, step.cell, k);
      return { text: 'Turned it into place and locked it.', moved: true };
    }
    this.mark = { state: s, cell: step.cell };
    return { text: WHY[step.why] };
  }

  /** Takes a new board, showing tile `cell` turning by `quarters` and the current surging into
   *  whatever it newly reaches. */
  private apply(next: CircuitState | null, cell: number, quarters: number): void {
    if (!next) return;
    const before = this.power();
    this.history.push(this.state);
    if (this.history.length > 300) this.history.shift();
    this.state = next;
    this.motion(before, cell, quarters);
  }

  private motion(before: Power, cell: number, quarters: number): void {
    if (this.reduced) return;
    const now = this.clock();
    if (cell >= 0 && quarters) {
      // A tile tapped again mid-turn carries on from where it shows.
      const prev = this.turning.get(cell);
      let left = 0;
      if (prev) left = prev.quarters * (1 - ease((now - prev.at) / (TURN_MS * Math.min(3, Math.abs(prev.quarters)))));
      this.turning.set(cell, { at: now, quarters: quarters + left });
    }
    const after = this.power();
    let from = Infinity;
    after.live.forEach((l, i) => { if (l && !before.live[i]) from = Math.min(from, after.depth[i]); });
    if (from < Infinity) this.surge = { at: now, from: Math.max(0, from - 1) };
  }

  restart(): void {
    this.state = cloneCircuit(this.initial);
    this.history = [];
    this.turning.clear();
    this.surge = null;
    this.press = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    const before = this.power();
    const was = this.state;
    this.state = prev;
    // Show the tile that changed turning back.
    const cell = prev.tiles.findIndex((m, i) => m !== was.tiles[i]);
    this.motion(before, cell, cell >= 0 ? shortest(was.tiles[cell], prev.tiles[cell]) : 0);
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  private cellAt(p: Point): number {
    if (!this.cell) return -1;
    const s = this.state;
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= s.cols || cy >= s.rows) return -1;
    return cy * s.cols + cx;
  }

  down(p: Point): void {
    if (this.won) return;
    const cell = this.cellAt(p);
    this.press = cell >= 0 ? { p, cell, at: this.clock(), far: false, held: false } : null;
  }

  move(p: Point): void {
    const pr = this.press;
    if (pr && Math.hypot(p.x - pr.p.x, p.y - pr.p.y) > SLOP) pr.far = true;
  }

  cancel(): void { this.press = null; }

  up(p: Point): void {
    const pr = this.press;
    this.press = null;
    if (!pr || pr.held || this.won) return;
    const dx = p.x - pr.p.x, dy = p.y - pr.p.y;
    if (pr.far || Math.hypot(dx, dy) > SLOP) {
      // A sideways swipe: left turns the tile back, right turns it on.
      if (Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy) * 1.2) this.turnTile(pr.cell, dx < 0 ? -1 : 1);
      return;
    }
    if (this.clock() - pr.at >= HOLD_MS) { this.lock(pr.cell); return; }
    this.turnTile(pr.cell, 1);
  }

  private turnTile(cell: number, dir: number): void {
    if (rotations(this.state.tiles[cell]).length === 1 || this.state.locked[cell]) return;
    this.apply(turn(this.state, cell, dir), cell, dir);
  }

  private lock(cell: number): void {
    this.history.push(this.state);
    this.state = toggleLock(this.state, cell);
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s0 = this.state;
    const fit = fitFramed(area, s0.cols, s0.rows, { margin: 8, maxCell: 76 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const g = { x: fit.x, y: fit.y, c };
    const t = this.clock();
    // A long press locks as soon as it has been held long enough, while the finger is still down.
    const pr = this.press;
    if (pr && !pr.far && !pr.held && t - pr.at >= HOLD_MS) { pr.held = true; this.lock(pr.cell); }
    const s = this.state;
    const spin = new Map<number, number>();
    for (const [cell, tr] of this.turning) {
      const k = ease((t - tr.at) / (TURN_MS * Math.min(3, Math.abs(tr.quarters))));
      if (k >= 1) { this.turning.delete(cell); continue; }
      spin.set(cell, (tr.quarters * (1 - k) * Math.PI) / 2);
    }
    const done = this.won;
    if (!done) this.wonAt = null;
    else this.wonAt ??= now;
    const glow = done ? (this.reduced ? 1 : Math.min(1, (now - this.wonAt!) / 500)) : 0;
    let surge: Paint['surge'] = null;
    if (this.surge && !this.reduced) {
      const ms = t - this.surge.at;
      if (ms > SURGE_STEP * (s.cols * s.rows + 4)) this.surge = null;
      else surge = { ms, from: this.surge.from };
    }
    paintCircuit(ctx, s, g, { mark: true, spin, glow, surge, power: this.power() });
    // The hold: a ring filling round the tile, once the press has lasted a moment.
    if (pr && !pr.far && !pr.held && !this.reduced) {
      const k = (t - pr.at - 150) / (HOLD_MS - 150);
      if (k > 0) {
        const q = centerOf(s, g, pr.cell);
        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = Math.max(2.5, c * 0.06);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(q.x, q.y, c * 0.36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k));
        ctx.stroke();
        ctx.restore();
      }
    }
    const m = this.mark?.state === s && !done ? this.mark : null;
    if (m) {
      const q = centerOf(s, g, m.cell);
      drawHelpMark(ctx, q.x - c * 0.46, q.y - c * 0.46, c * 0.92, c * 0.92, now, this.reduced, c * 0.16);
    }
  }
}

const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

function fitFramed(area: Area, cols: number, rows: number, opts: { margin: number; maxCell: number }): { cell: number; x: number; y: number } {
  const room = frameRoom(fitGrid(area, cols, rows, opts).cell);
  const g = fitGrid(area, cols, rows, { ...opts, margin: opts.margin + room });
  return { cell: g.cell, x: g.x, y: g.y };
}

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A small picture board: rows of tiles, each written as its wires ('u', 'r', 'd', 'l' in any
 * order, '.' for none) with a '*' on the cell's tile, separated by spaces.
 */
function board(rows: string[]): CircuitState {
  const cells = rows.map((r) => r.trim().split(/\s+/));
  const cols = cells[0].length;
  const tiles: number[] = [];
  let source = 0;
  cells.forEach((row) => row.forEach((t) => {
    if (t.includes('*')) source = tiles.length;
    tiles.push((t.includes('u') ? 1 : 0) | (t.includes('r') ? 2 : 0) | (t.includes('d') ? 4 : 0) | (t.includes('l') ? 8 : 0));
  }));
  return { cols, rows: cells.length, tiles, solution: tiles.slice(), source, locked: tiles.map(() => false), moves: 0, par: 0, order: [] };
}

const LEAD = 0.45;
const BEAT = 0.55;
const REST = 0.7;

/**
 * One rule picture: the board, then each step in turn: a tile turned a quarter turn (clockwise
 * for 1, back for -1), or locked ('lock'). A bad picture flags its problems in amber once the
 * steps are done; a `win` picture turns green.
 */
function picture(rows: string[], steps: [number, number | 'lock'][], caption: string, o: { bad?: boolean; win?: boolean } = {}): Illustration {
  const s0 = board(rows);
  const states: CircuitState[] = [s0];
  for (const [cell, what] of steps) {
    const cur = states[states.length - 1];
    states.push(what === 'lock' ? toggleLock(cur, cell) : turn(cur, cell, what)!);
  }
  const raw = LEAD + BEAT * steps.length + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      let k = 0;
      while (k < steps.length && t >= LEAD + BEAT * k) k++;
      const s = states[k];
      const spin = new Map<number, number>();
      let surge: Paint['surge'] = null;
      if (k > 0) {
        const at = LEAD + BEAT * (k - 1);
        const [cell, what] = steps[k - 1];
        const e = ease((t - at) / 0.22);
        if (what !== 'lock' && e < 1) spin.set(cell, (what * (1 - e) * Math.PI) / 2);
        const before = powerOf(s0.cols, s0.rows, states[k - 1].tiles, s0.source);
        const after = powerOf(s0.cols, s0.rows, s.tiles, s0.source);
        let from = Infinity;
        after.live.forEach((l, i) => { if (l && !before.live[i]) from = Math.min(from, after.depth[i]); });
        if (from < Infinity) surge = { ms: (t - at) * 1000, from: Math.max(0, from - 1) };
      }
      const settled = t >= LEAD + BEAT * steps.length;
      const fit = fitFramed({ x: 0, y: 0, w, h }, s0.cols, s0.rows, { margin: 2, maxCell: 999 });
      const glow = o.win && settled ? Math.min(1, (t - LEAD - BEAT * steps.length) / 0.3) : 0;
      paintCircuit(ctx, s, { x: fit.x, y: fit.y, c: fit.cell }, { mark: !!o.bad && settled, spin, surge, glow });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Turn',
    text: 'Tap a tile to turn it a quarter turn clockwise, or swipe left on it to turn it back. Hold a tile to lock it, so taps leave it alone.',
    good: picture(['r* ud l'], [[1, 1], [1, 'lock']], 'Tap, then hold'),
  },
  {
    title: 'Current',
    text: 'Current flows from the cell along wires that meet end to end. Live wires glow and light their lamps; dead ones stay gray.',
    good: picture(['d* lrd l', 'r uld l'], [[4, 1], [0, -1]], 'Lamps light up'),
  },
  {
    title: 'No loose ends',
    text: 'Every wire end must meet another wire end. None may point off the board or at a side with no wire.',
    good: picture(['rd* l', 'ur u'], [[3, -1]], 'Every end meets', { win: true }),
    bad: picture(['rd* l', 'ur l'], [[0, -1]], 'Off the board', { bad: true }),
  },
  {
    title: 'One tree',
    text: 'Every tile must be live, and the wires may never close a loop.',
    good: picture(['rd* rd', 'u u'], [[1, 1]], 'One tree, all live', { win: true }),
    bad: picture(['rd* ld', 'ur ld'], [[3, 1]], 'A loop', { bad: true }),
  },
];
