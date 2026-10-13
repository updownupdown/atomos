// Drawing and touch for Bond: drag from a dot through empty cells to its partner. Dots are beads
// in their pair's color set in a thick dark ring; a path is a thick line of that color, cased in
// the same dark, that bends round each turn in a wide curve. Dragging back along a
// path pulls it in, and dragging into another path cuts that one off where you enter.
//
// The board is painted by `paintBond`, which the rule cards' pictures share.

import { answerFor, begin, cloneBond, complete, extend, firstWrong, neighbors, occupancy, solved, type BondState } from './bond';
import { C, fitGrid } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<section class="how-specs"><h3>Specs</h3><ul>
<li><b>Flawless:</b> Join every pair and fill every cell in par strokes or fewer, one per pair, where a stroke is any drag that changes a path, and without Show me.</li>
<li><b>Board:</b> The grid is 5 by 5 up to neon with 3 or 4 pairs, 6 by 6 to krypton with 4 or 5, 7 by 7 to radon with 5 to 7, and 8 by 8 beyond with 6 to 8.</li>
<li><b>Built:</b> Each board is dealt from one path through every cell, cut at each tight turn into the pairs, each at least three cells long.</li>
<li><b>One answer:</b> A board is kept only when the solver finds exactly one answer.</li>
<li><b>Par:</b> One stroke per pair. A redrawn path, or one cut and drawn again, costs another stroke.</li>
<li><b>Where it's played:</b> Tether is a reserve game, played from the Puzzles screen.</li>
</ul></section>
`;

/** The pairs' colors and their names, for the hint line. Kept away from red, amber and rose. */
export const BOND_HUES: { color: string; name: string }[] = [
  { color: '#5f8ae0', name: 'blue' },
  { color: '#4fbf7a', name: 'green' },
  { color: '#a865d6', name: 'violet' },
  { color: '#e0864f', name: 'orange' },
  { color: '#d8c85a', name: 'yellow' },
  { color: '#3fb8b0', name: 'teal' },
  { color: '#c9a27a', name: 'tan' },
  { color: '#eef1f2', name: 'silver' },
  { color: '#8aa4b8', name: 'slate' },
];

interface Geo { x: number; y: number; c: number }

interface Paint {
  /** Cells outlined in amber (rule pictures). */
  flag?: number[];
  /** How much of each path to draw, 0 to 1 (rule pictures); all of it when absent. */
  reveal?: number[];
}

const centerOf = (s: BondState, g: Geo, i: number): Point => ({ x: g.x + ((i % s.size) + 0.5) * g.c, y: g.y + (Math.floor(i / s.size) + 0.5) * g.c });

function lattice(ctx: CanvasRenderingContext2D, s: BondState, g: Geo): void {
  const c = g.c, n = s.size;
  drawFrame(ctx, frameBox(g.x, g.y, n * c, n * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  const occ = occupancy(s);
  ctx.fillStyle = C.surface3;
  const r = Math.max(1.5, c * 0.035);
  for (let i = 0; i < n * n; i++) {
    if (occ[i] >= 0) continue;
    const p = centerOf(s, g, i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** How wide a path is, its dark casing, a turn's bend (on the center line), and a dot. */
const PATH_W = 0.4;
const RING_W = 0.075;
const TURN_R = 0.42;
const DOT_R = 0.29;
/** The dark of the casing and the rings. */
const INK = '#000000';

/** Traces a path's center line through the given points, each turn bent round an arc. A turn's
 *  radius is held to half of any inner leg (two turns can share one) and to all of an end leg. */
function trace(ctx: CanvasRenderingContext2D, pts: Point[], radius: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], q = pts[i], b = pts[i + 1];
    const inA = Math.hypot(q.x - a.x, q.y - a.y), outB = Math.hypot(b.x - q.x, b.y - q.y);
    const straight = Math.abs((q.x - a.x) * (b.y - q.y) - (q.y - a.y) * (b.x - q.x)) < 1e-6;
    if (straight) { ctx.lineTo(q.x, q.y); continue; }
    const r = Math.min(radius, i === 1 ? inA : inA / 2, i === pts.length - 2 ? outB : outB / 2);
    ctx.arcTo(q.x, q.y, b.x, b.y, r);
  }
  const end = pts[pts.length - 1];
  ctx.lineTo(end.x, end.y);
}

/** A dot: its pair's color in a thick dark ring that also cuts it clean from its own path. */
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, hue: string): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x, y, c * (DOT_R + RING_W), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hue;
  ctx.beginPath();
  ctx.arc(x, y, c * DOT_R, 0, Math.PI * 2);
  ctx.fill();
}

/** Paints the grid, every path and every dot. */
export function paintBond(ctx: CanvasRenderingContext2D, s: BondState, g: Geo, o: Paint = {}): void {
  const c = g.c;
  lattice(ctx, s, g);
  // Paths first, under the dots: the dark casing, then the color inside it.
  s.paths.forEach((path, p) => {
    const reveal = o.reveal?.[p] ?? 1;
    const count = Math.max(1, Math.min(path.length, Math.ceil(path.length * reveal)));
    if (path.length < 2 || count < 2) return;
    const hue = BOND_HUES[p % BOND_HUES.length].color;
    const pts: Point[] = [];
    for (let i = 0; i < count; i++) pts.push(centerOf(s, g, path[i]));
    // A path still being revealed ends part way to its next cell.
    const frac = path.length * reveal - (count - 1);
    if (count < path.length && frac > 0 && frac < 1) {
      const a = pts[count - 1], b = centerOf(s, g, path[count]);
      pts.push({ x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac });
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    trace(ctx, pts, c * TURN_R);
    ctx.strokeStyle = INK;
    ctx.lineWidth = c * (PATH_W + RING_W * 2);
    ctx.stroke();
    ctx.strokeStyle = hue;
    ctx.globalAlpha = complete(s, p) ? 1 : 0.72;
    ctx.lineWidth = c * PATH_W;
    ctx.stroke();
    ctx.restore();
  });
  s.pairs.forEach(([a, b], p) => {
    const hue = BOND_HUES[p % BOND_HUES.length].color;
    for (const cell of [a, b]) {
      const q = centerOf(s, g, cell);
      dot(ctx, q.x, q.y, c, hue);
    }
  });
  if (o.flag) {
    for (const cell of o.flag) {
      const q = centerOf(s, g, cell);
      ctx.save();
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = Math.max(2, c * 0.06);
      ctx.beginPath();
      ctx.roundRect(q.x - c * 0.44, q.y - c * 0.44, c * 0.88, c * 0.88, c * 0.18);
      ctx.stroke();
      ctx.restore();
    }
  }
}

export class BondView implements PuzzleView {
  private state: BondState;
  private history: BondState[] = [];
  /** The stroke under way: its pair and the board before it. */
  private stroke: { pair: number; before: BondState; cell: number } | null = null;
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private mark: { state: BondState; cells: number[] } | null = null;

  constructor(private readonly initial: BondState, reducedMotion: boolean) {
    this.state = cloneBond(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    return { progress: { label: 'Joined', value: `${s.pairs.filter((_, p) => complete(s, p)).length}/${s.pairs.length}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'Every pair bonded';
    const joined = s.pairs.filter((_, p) => complete(s, p)).length;
    if (joined === s.pairs.length) {
      const empty = occupancy(s).filter((v) => v < 0).length;
      return empty === 1 ? '1 cell left empty' : `${empty} cells left empty`;
    }
    const left = s.pairs.length - joined;
    return left === 1 ? '1 pair to join' : `${left} pairs to join`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    const name = (p: number) => BOND_HUES[p % BOND_HUES.length].name;
    if (wrong >= 0) {
      if (level === 2) { this.lay(wrong); return { text: `Redrew the ${name(wrong)} path.`, moved: true }; }
      this.mark = { state: s, cells: s.paths[wrong].slice(1) };
      return { text: `The ${name(wrong)} path goes another way.` };
    }
    let p = s.pairs.findIndex((_, i) => !complete(s, i));
    if (p < 0) return null;
    // Of the pairs not yet joined, the one furthest along.
    for (let q = 0; q < s.pairs.length; q++) if (!complete(s, q) && s.paths[q].length > s.paths[p].length) p = q;
    if (level === 2) { this.lay(p); return { text: `Drew the ${name(p)} path.`, moved: true }; }
    const answer = answerFor(s, p);
    const have = s.paths[p].length;
    this.mark = { state: s, cells: answer.slice(Math.max(1, have), Math.max(1, have) + 2) };
    return { text: have > 1 ? `Carry the ${name(p)} path on this way.` : `Start the ${name(p)} path this way.` };
  }

  /** Lays pair p's full answer, cutting any path in its way, as one stroke. */
  private lay(p: number): void {
    const before = this.state;
    const next = cloneBond(before);
    const answer = answerFor(next, p);
    next.paths[p] = [answer[0]];
    for (let i = 1; i < answer.length; i++) extend(next, p, answer[i]);
    next.moves++;
    this.history.push(before);
    this.state = next;
  }

  restart(): void {
    this.state = cloneBond(this.initial);
    this.history = [];
    this.stroke = null;
  }

  canUndo(): boolean { return this.history.length > 0 && !this.stroke; }

  undo(): boolean {
    if (this.stroke) return false;
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  private cellAt(p: Point): number {
    if (!this.cell) return -1;
    const n = this.state.size;
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return -1;
    return cy * n + cx;
  }

  down(p: Point): void {
    if (this.won) return;
    const cell = this.cellAt(p);
    if (cell < 0) return;
    const before = cloneBond(this.state);
    const pair = begin(this.state, cell);
    if (pair < 0) return;
    this.stroke = { pair, before, cell };
  }

  move(p: Point): void {
    const st = this.stroke;
    if (!st) return;
    const cell = this.cellAt(p);
    if (cell < 0 || cell === st.cell) return;
    const s = this.state;
    const path = s.paths[st.pair];
    const head = path[path.length - 1];
    // A pointer that skipped cells along a row or column walks them one by one.
    const n = s.size;
    const hx = head % n, hy = Math.floor(head / n), cx = cell % n, cy = Math.floor(cell / n);
    if (hx === cx || hy === cy) {
      const dx = Math.sign(cx - hx), dy = Math.sign(cy - hy);
      let at = head;
      while (at !== cell) {
        const nextCell = at + dx + dy * n;
        if (!extend(s, st.pair, nextCell)) break;
        at = nextCell;
      }
    } else if (neighbors(n, head).includes(cell)) {
      extend(s, st.pair, cell);
    }
    st.cell = cell;
  }

  up(): void {
    const st = this.stroke;
    this.stroke = null;
    if (!st) return;
    const same = JSON.stringify(st.before.paths) === JSON.stringify(this.state.paths);
    if (same) { this.state = st.before; return; }
    this.history.push(st.before);
    if (this.history.length > 100) this.history.shift();
    this.state.moves++;
  }

  cancel(): void {
    const st = this.stroke;
    this.stroke = null;
    if (st) this.state = st.before;
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
    paintBond(ctx, s, g);
    const m = this.mark?.state === s && !this.won && !this.stroke ? this.mark : null;
    if (m) for (const cell of m.cells) {
      const q = centerOf(s, g, cell);
      drawHelpMark(ctx, q.x - c * 0.4, q.y - c * 0.4, c * 0.8, c * 0.8, now, this.reduced, c * 0.4);
    }
  }
}

const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

function fitFramed(area: Area, cols: number, rows: number, opts: { margin: number; maxCell: number; top?: number }): { cell: number; x: number; y: number; room: number } {
  const room = frameRoom(fitGrid(area, cols, rows, opts).cell);
  const g = fitGrid(area, cols, rows, { ...opts, margin: opts.margin + room });
  return { cell: g.cell, x: g.x, y: g.y, room };
}

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A small picture board from rows of text: a letter marks a cell on that pair's path ('a' the
 * first pair, 'b' the second...), in path order given separately as the cells each path visits;
 * '.' is an empty cell. Paths are listed as [x, y] steps from one dot to wherever they end.
 */
function board(n: number, paths: [number, number][][]): BondState {
  const cells = paths.map((path) => path.map(([x, y]) => y * n + x));
  return {
    size: n,
    pairs: cells.map((path) => [path[0], path[path.length - 1]]),
    paths: cells.map((path) => path.slice()),
    solution: cells.map((path) => path.slice()),
    moves: 0,
    par: cells.length,
  };
}

const LEAD = 0.4;
const PER_CELL = 0.16;
const REST = 0.6;

/**
 * One rule picture: each path is drawn in turn, cell by cell. `ends` names where each pair's
 * second dot really sits when the drawn path stops short (so a path can be shown unfinished),
 * and `flag` the cells outlined in amber at the end.
 */
function picture(n: number, paths: [number, number][][], caption: string, o: { ends?: Record<number, [number, number]>; flag?: [number, number][] } = {}): Illustration {
  const s = board(n, paths);
  if (o.ends) for (const [p, [x, y]] of Object.entries(o.ends)) s.pairs[Number(p)][1] = y * n + x;
  const starts: number[] = [];
  let clock = LEAD;
  for (const path of s.paths) { starts.push(clock); clock += PER_CELL * Math.max(1, path.length - 1) + 0.2; }
  const raw = clock + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  const flag = o.flag?.map(([x, y]) => y * n + x);
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const u = t * pace;
      const reveal = s.paths.map((path, p) => Math.max(0, Math.min(1, (u - starts[p]) / (PER_CELL * Math.max(1, path.length - 1)))));
      const fit = fitFramed({ x: 0, y: 0, w, h }, n, n, { margin: 2, maxCell: 999 });
      paintBond(ctx, s, { x: fit.x, y: fit.y, c: fit.cell }, { reveal, flag: u >= clock ? flag : undefined });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Pairs',
    text: 'Drag from a dot, cell by cell, **to the other dot of its color**. Lift your finger and the path stays; drag back along it to pull it in.',
    good: picture(3, [[[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 1], [0, 2], [1, 2], [2, 2]]], 'Dot to dot'),
  },
  {
    title: 'No crossing',
    text: 'Paths **never cross or share a cell**. Dragging into another path cuts it off where you enter, and it must be drawn again.',
    good: picture(3, [[[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], [[0, 1], [0, 2], [1, 2]]], 'Round each other'),
    bad: picture(3, [[[0, 1]], [[0, 0], [1, 0], [1, 1]]], 'Cut off', { ends: { 0: [2, 1], 1: [1, 2] }, flag: [[1, 1]] }),
  },
  {
    title: 'Every cell',
    text: 'The board is done when every pair is joined and **every cell is on a path**.',
    good: picture(3, [[[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2]], [[1, 2], [2, 2]]], 'All filled'),
    bad: picture(3, [[[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], [[0, 1], [0, 2], [1, 2]]], 'A cell left out', { flag: [[1, 1]] }),
  },
  {
    title: 'Strokes',
    text: '**Par is one stroke per pair**. A path drawn twice, or cut and redrawn, costs another stroke.',
    good: picture(4, [[[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [1, 2], [1, 1], [1, 0]], [[2, 0], [3, 0], [3, 1], [2, 1], [2, 2], [3, 2], [3, 3], [2, 3]]], 'One stroke each'),
  },
];
