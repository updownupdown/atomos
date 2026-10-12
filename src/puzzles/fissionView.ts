// Drawing and touch for Fission: tap a nucleus and watch the chain. Each nucleus is a cluster of
// violet nucleons breathing in a soft halo, with chevrons set out from it for the ways its
// neutrons fly. A neutron is a white-hot bead with a fading ice-blue trail that crosses the plate
// one wave at a time; what it hits splits on the next wave. Moderator blocks are plain wall
// blocks. A split nucleus stays as two dim fragments.
//
// The board is painted by `paintFission`, which the rule cards' pictures share.

import { allSplit, chainFrom, cloneFission, DX, DY, nucleusAt, plan, solved, tap, type Chain, type FissionState } from './fission';
import { C, fitGrid, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Fission is a reserve game, played from the Practice screen. The plate grows from 4 by 4 to 7 by 7 and the nuclei from 5 to 16; moderator blocks appear from sodium on. Par is the fewest taps that split everything, found by trying every tap, pair and triple: 1 up to calcium, 2 to barium, 3 to rutherfordium and 4 beyond. On a par-1 board at most one or two nuclei finish it in one, so the puzzle is finding them. Every chain is fixed by the board, so nothing is luck.</p>
`;

/** Milliseconds per wave of the chain: a neutron's flight, then the nucleus it hit splits. */
const WAVE = 380;
const STATUS_H = 0;

interface Geo { x: number; y: number; c: number }

/** A chain under way: when it started and which nuclei were split before it. */
interface Anim { chain: Chain; at: number; before: number }

interface Paint {
  /** Milliseconds since the chain started, or null when nothing is flying. */
  anim: Anim | null;
  now: number;
  motion: boolean;
  /** Rule pictures: outline every unsplit nucleus in amber. */
  flag?: boolean;
  /** The clock for the nuclei's idle breath, when it differs from `now` (the rule pictures run
   *  their own clock for the chain, which restarts each loop). */
  idle?: number;
}

/** A linear gradient through the stops, or the fallback where the canvas has no gradients (a
 *  test stand-in). */
function linear(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][], fallback: string): CanvasGradient | string {
  const g = ctx.createLinearGradient(x0, y0, x1, y1) as CanvasGradient | undefined;
  if (!g) return fallback;
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

const centerOf = (s: FissionState, g: Geo, i: number): Point => ({ x: g.x + ((i % s.size) + 0.5) * g.c, y: g.y + (Math.floor(i / s.size) + 0.5) * g.c });

function lattice(ctx: CanvasRenderingContext2D, s: FissionState, g: Geo): void {
  const c = g.c, n = s.size;
  drawFrame(ctx, frameBox(g.x, g.y, n * c, n * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  const busy = new Set<number>([...s.blocks, ...s.nuclei.map((nu) => nu.cell)]);
  ctx.fillStyle = C.surface3;
  const r = Math.max(1.5, c * 0.035);
  for (let i = 0; i < n * n; i++) {
    if (busy.has(i)) continue;
    const p = centerOf(s, g, i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A moderator block: a plain wall block in the frame's color with one small dot. */
function block(ctx: CanvasRenderingContext2D, x: number, y: number, c: number): void {
  const side = c * 0.8;
  tile(ctx, x - side / 2, y - side / 2, side, side, c * 0.16, C.frame, null);
  ctx.fillStyle = C.text3;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.5, c * 0.055), 0, Math.PI * 2);
  ctx.fill();
}

/** Uranium sits in the f block, so a nucleus wears the f orbital's violet. */
const VIOLET = '#a865d6';
const BODY = '#26163a';
/** Protons a bright lavender, neutrons a gray violet, as the palette has protons warm and
 *  neutrons gray. */
const NUCLEON_A = '#d4a8f5';
const NUCLEON_B = '#7f6a9c';
/** Neutrons fly white-hot with a cool ice-blue glow. */
const ICE = '#bfeeff';
const HOT = '#f4fcff';

/** Nucleon offsets in a nucleus, as fractions of its radius: one in the middle, six round it. */
const NUCLEONS: [number, number][] = [[0, 0], ...Array.from({ length: 6 }, (_, k): [number, number] => {
  const a = Math.PI / 6 + (k * Math.PI) / 3;
  return [Math.cos(a) * 0.6, Math.sin(a) * 0.6];
})];

/** A nucleus: a cluster of nucleons on a deep violet plate, breathing softly in a violet halo,
 *  with a chevron well out from its rim for each way its neutrons fly. Split, it is two dim
 *  fragments on a faint plate with no chevrons. `flash` 0 to 1 lights it as it splits; `pulse`
 *  0 to 1 is the idle breath (0 when motion is off). */
export function nucleus(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, arrows: number, split: boolean, flash = 0, pulse = 0): void {
  const r = c * 0.22;
  ctx.save();
  if (split) {
    ctx.fillStyle = VIOLET;
    ctx.globalAlpha = 0.17;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
    ctx.fill();
    // Two fragments, flung apart along the diagonal.
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = NUCLEON_B;
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + k * r * 0.42, y - k * r * 0.42, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
    if (flash > 0) {
      // A burst of white-hot light that swells and fades: a soft filled disc, no thin ring.
      ctx.globalAlpha = flash * 0.55;
      ctx.fillStyle = ICE;
      ctx.shadowColor = ICE;
      ctx.shadowBlur = c * 0.35 * flash;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.9 + 0.9 * (1 - flash)), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = flash;
      ctx.fillStyle = HOT;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45 * flash, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  // The halo: a wide faint violet band that breathes.
  ctx.fillStyle = VIOLET;
  ctx.globalAlpha = 0.16 + 0.1 * pulse;
  ctx.beginPath();
  ctx.arc(x, y, r * (1.24 + 0.08 * pulse), 0, Math.PI * 2);
  ctx.fill();
  // The plate, glowing faintly from within.
  ctx.globalAlpha = 1;
  ctx.shadowColor = VIOLET;
  ctx.shadowBlur = c * (0.12 + 0.1 * pulse);
  ctx.fillStyle = BODY;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // The nucleons, lit from the top left by a linear sheen.
  const nr = r * 0.32;
  NUCLEONS.forEach(([ox, oy], k) => {
    const px = x + ox * r, py = y + oy * r;
    const base = k > 0 && k % 2 === 0 ? NUCLEON_B : NUCLEON_A;
    ctx.fillStyle = linear(ctx, px - nr, py - nr, px + nr, py + nr, [[0, '#f6ecff'], [0.4, base], [1, base]], base);
    ctx.beginPath();
    ctx.arc(px, py, nr, 0, Math.PI * 2);
    ctx.fill();
  });
  // The chevrons, set well out from the rim so the nucleus has room to breathe.
  ctx.strokeStyle = C.silver;
  ctx.lineWidth = Math.max(1.75, c * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const k = c * 0.1, along = c * 0.065;
  for (let d = 0; d < 4; d++) {
    if (!(arrows & (1 << d))) continue;
    const dx = DX[d], dy = DY[d];
    const tx = x + dx * c * 0.43, ty = y + dy * c * 0.43;
    ctx.beginPath();
    ctx.moveTo(tx - dx * along + dy * k, ty - dy * along + dx * k);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - dx * along - dy * k, ty - dy * along - dx * k);
    ctx.stroke();
  }
  ctx.restore();
}

/** A neutron in flight: a white-hot bead in an ice-blue glow, trailing a streak that fades out
 *  behind it. */
function neutron(ctx: CanvasRenderingContext2D, from: Point, to: Point, k: number, c: number): void {
  const x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k;
  const tail = Math.max(0, k - 0.45);
  const bx = from.x + (to.x - from.x) * tail, by = from.y + (to.y - from.y) * tail;
  ctx.save();
  if (Math.hypot(x - bx, y - by) > 1) {
    ctx.strokeStyle = linear(ctx, bx, by, x, y, [[0, 'rgba(191, 238, 255, 0)'], [1, 'rgba(191, 238, 255, 0.55)']], ICE);
    ctx.lineWidth = Math.max(2.5, c * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  const r = Math.max(2.5, c * 0.085);
  ctx.fillStyle = ICE;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowColor = ICE;
  ctx.shadowBlur = r * 2.2;
  ctx.fillStyle = HOT;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Paints the plate, its blocks and nuclei, and the chain under way: in wave k (from `at` plus
 * k waves) its neutrons fly, and the nuclei they split show split from the wave after. Returns
 * true while something is still flying.
 */
export function paintFission(ctx: CanvasRenderingContext2D, s: FissionState, g: Geo, o: Paint): boolean {
  const c = g.c;
  lattice(ctx, s, g);
  for (const b of s.blocks) { const p = centerOf(s, g, b); block(ctx, p.x, p.y, c); }
  const a = o.anim;
  const ms = a ? o.now - a.at : Infinity;
  const wave = a && o.motion ? ms / WAVE : Infinity;
  const splitAt = new Map<number, number>();
  if (a) for (const sp of a.chain.splits) splitAt.set(sp.index, sp.step);
  let flying = false;
  // The chain's trails: a faint line along each flight that has landed, until the next tap.
  if (a) {
    ctx.save();
    ctx.strokeStyle = ICE;
    ctx.globalAlpha = 0.07;
    ctx.lineWidth = Math.max(3, c * 0.08);
    ctx.lineCap = 'round';
    for (const f of a.chain.flights) {
      if (wave < f.step + 1) continue;
      const from = centerOf(s, g, f.from), to = centerOf(s, g, f.to);
      const end = f.hit === 'edge' ? { x: to.x + DX[f.dir] * c * 0.5, y: to.y + DY[f.dir] * c * 0.5 } : to;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    ctx.restore();
  }
  s.nuclei.forEach((nu, i) => {
    const p = centerOf(s, g, nu.cell);
    const isSplit = (s.split >> i & 1) === 1;
    let shown = isSplit;
    let flash = 0;
    if (a && isSplit && !((a.before >> i) & 1)) {
      const step = splitAt.get(i) ?? 0;
      shown = wave >= step;
      const since = (wave - step) * WAVE;
      if (shown && since < 320) flash = 1 - since / 320;
    }
    if (o.flag && !isSplit) tile(ctx, p.x - c * 0.44, p.y - c * 0.44, c * 0.88, c * 0.88, c * 0.18, null, C.warn, Math.max(2, c * 0.06));
    // Each nucleus breathes on its own phase, so the plate never pulses in step.
    const pulse = o.motion ? 0.5 + 0.5 * Math.sin((o.idle ?? o.now) / 900 + nu.cell * 1.7) : 0;
    nucleus(ctx, p.x, p.y, c, nu.arrows, shown, flash, pulse);
  });
  if (a && o.motion) {
    for (const f of a.chain.flights) {
      const t = wave - f.step;
      if (t < 0 || t >= 1) continue;
      flying = true;
      const from = centerOf(s, g, f.from), to = centerOf(s, g, f.to);
      // A flight that leaves the plate runs on half a cell past the edge, then vanishes.
      const end = f.hit === 'edge' ? { x: to.x + DX[f.dir] * c * 0.5, y: to.y + DY[f.dir] * c * 0.5 } : to;
      const k = ease(t);
      if (f.hit === 'edge' && t > 0.85) continue;
      neutron(ctx, from, end, k, c);
    }
    const last = Math.max(0, ...a.chain.splits.map((sp) => sp.step));
    if (wave < last + 1) flying = true;
  }
  return flying;
}

export class FissionView implements PuzzleView {
  private state: FissionState;
  private history: FissionState[] = [];
  private pressed: Point | null = null;
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private anim: Anim | null = null;
  private busy = false;
  private reduced: boolean;
  private mark: { state: FissionState; index: number } | null = null;

  constructor(private readonly initial: FissionState, reducedMotion: boolean) {
    this.state = cloneFission(initial);
    this.reduced = reducedMotion;
  }

  /** Won once the last chain has played out, so the win waits for the neutrons. */
  get won(): boolean { return solved(this.state) && !this.busy; }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    return { progress: { label: 'Split', value: `${popcount(s.split)}/${s.nuclei.length}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'Every nucleus split';
    if (this.busy) return 'Chain under way';
    const left = s.nuclei.length - popcount(s.split);
    return left === 1 ? '1 nucleus left' : `${left} nuclei left`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const p = plan(s, 6);
    if (!p?.length) return null;
    const index = p[0];
    const gain = chainFrom(s, index).splits.length;
    if (level === 2) {
      this.go(index);
      return { text: `Tapped one that splits ${gain}.`, moved: true };
    }
    this.mark = { state: s, index };
    const text = p.length === 1 ? `This one sets off everything left.` : s.moves === 0 ? `Start here: it splits ${gain} of ${s.nuclei.length}.` : `Tap here next: it splits ${gain} more.`;
    return { text };
  }

  private go(index: number): void {
    if (this.won || this.busy) return;
    const next = tap(this.state, index);
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.anim = { chain: next.last!, at: performance.now(), before: this.state.split };
    this.busy = !this.reduced;
    this.state = next;
  }

  restart(): void {
    this.state = cloneFission(this.initial);
    this.history = [];
    this.anim = null;
    this.busy = false;
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

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s || !this.cell) return;
    if (Math.hypot(p.x - s.x, p.y - s.y) > 16) return;
    const n = this.state.size;
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return;
    const index = nucleusAt(this.state, cy * n + cx);
    if (index >= 0) this.go(index);
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const fit = fitFramed(area, s.size, s.size, { margin: 8, maxCell: 72, top: STATUS_H });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const g = { x: fit.x, y: fit.y, c };
    const flying = paintFission(ctx, s, g, { anim: this.anim, now, motion: !this.reduced });
    if (!flying) this.busy = false;
    const m = this.mark?.state === s && !this.won && !flying ? this.mark : null;
    if (m) {
      const p = centerOf(s, g, s.nuclei[m.index].cell);
      drawHelpMark(ctx, p.x - c * 0.44, p.y - c * 0.44, c * 0.88, c * 0.88, now, this.reduced, c * 0.44);
    }
  }
}

function popcount(v: number): number {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
}

const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

function fitFramed(area: Area, cols: number, rows: number, opts: { margin: number; maxCell: number; top?: number }): { cell: number; x: number; y: number; room: number } {
  const room = frameRoom(fitGrid(area, cols, rows, opts).cell);
  const g = fitGrid(area, cols, rows, { ...opts, margin: opts.margin + room });
  return { cell: g.cell, x: g.x, y: g.y, room };
}

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A small picture board from rows of text: '.' empty, '#' a moderator block, a hex digit a
 * nucleus with that arrow mask (1 up, 2 right, 4 down, 8 left; so 'a' is up and left).
 */
function board(rows: string[]): FissionState {
  const n = Math.max(rows.length, ...rows.map((r) => r.length));
  // Rows are padded square with empty cells, so every picture board is n by n.
  const nuclei: FissionState['nuclei'] = [];
  const blocks: number[] = [];
  rows.forEach((line, y) => [...line].forEach((ch, x) => {
    const i = y * n + x;
    if (ch === '#') blocks.push(i);
    else if (ch !== '.') nuclei.push({ cell: i, arrows: parseInt(ch, 16) });
  }));
  return { size: n, nuclei, blocks, split: 0, moves: 0, par: 0, last: null };
}

const LEAD = 0.4;
const PWAVE = 0.5;
const REST = 0.5;

/** One rule picture: the taps at [x, y], one after another, each chain playing out wave by wave.
 *  A `bad` picture ends with every unsplit nucleus flagged. */
function picture(rows: string[], taps: [number, number][], caption: string, bad = false): Illustration {
  const s0 = board(rows);
  // Each tap's chain and when it starts, after the one before has played out.
  const steps: { state: FissionState; before: number; chain: Chain; at: number }[] = [];
  let cur = s0;
  let clock = LEAD;
  for (const [x, y] of taps) {
    const index = nucleusAt(cur, y * s0.size + x);
    const next = tap(cur, index);
    if (!next) continue;
    steps.push({ state: next, before: cur.split, chain: next.last!, at: clock });
    const waves = Math.max(0, ...next.last!.splits.map((sp) => sp.step)) + 1;
    clock += waves * PWAVE + 0.2;
    cur = next;
  }
  const raw = clock + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const u = t * pace;
      let st = s0;
      let anim: Anim | null = null;
      for (const step of steps) {
        if (u < step.at) break;
        st = step.state;
        anim = { chain: step.chain, at: step.at * 1000 * (WAVE / (PWAVE * 1000)), before: step.before };
      }
      const fit = fitFramed({ x: 0, y: 0, w, h }, s0.size, s0.size, { margin: 2, maxCell: 999 });
      // The picture's clock runs in its own waves; scale it to the board's.
      const now = u * 1000 * (WAVE / (PWAVE * 1000));
      const settled = u >= clock;
      paintFission(ctx, st, { x: fit.x, y: fit.y, c: fit.cell }, { anim, now, motion: true, flag: bad && settled, idle: performance.now() });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Tap',
    text: 'Tap a nucleus and it splits, sending a neutron the way each of its chevrons points. A neutron flies straight until it hits something, or leaves the plate.',
    good: picture(['2.2.', '....', '....'], [[0, 0]], 'Two split in one'),
  },
  {
    title: 'Chain',
    text: 'A nucleus hit by a neutron splits too, and sends out its own. Follow the chevrons to see how far a tap reaches.',
    good: picture(['2..4', '....', '1..8'], [[0, 0]], 'One tap, a chain'),
  },
  {
    title: 'Moderators',
    text: 'A block soaks up any neutron that hits it. Nothing behind it is reached that way.',
    good: picture(['6#.5', '....', '2..1'], [[0, 0]], 'Round the block'),
    bad: picture(['2#2.', '....', '....'], [[0, 0]], 'Soaked up', true),
  },
  {
    title: 'Fewest taps',
    text: 'Split every nucleus in the fewest taps: par is the least the board allows. Extra taps still finish it, but cost the star.',
    good: picture(['4...', '2..8', '....'], [[0, 0]], 'All in one'),
    bad: picture(['4...', '2..8', '....'], [[3, 1]], 'One left over', true),
  },
];
