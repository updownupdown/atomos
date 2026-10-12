// Drawing and touch for Trace: drag from the 1 to lay one glowing trail, cell to cell; drag back
// along it to pull it in. The trail runs from deep blue at the 1 to bright cyan at its head,
// where an electron sits. Numbers it has met light up; walls are short bars of the frame's color
// on the edges they block. A step onto a number out of turn, or through a wall, is refused with
// a brief amber flash.
//
// The board is painted by `paintTrace`, which the rule cards' pictures share.

import { begin, blocked, cloneTrace, edgeKey, endedShort, extend, firstWrong, neighbors, nextStep, reached, solved, type TraceState } from './trace';
import { bead, C, fitGrid, font, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Trace is a reserve game, played from the Practice screen. The grid grows from 5 by 5 on the easiest setting through 6 by 6 and 7 by 7 to 8 by 8 at Hard and Expert. Easy boards number about two cells in five; at Expert only about one in seven, so the trail between them has to be worked out. Walls arrive from Easy on, one or two at first and up to about ten. Every board is dealt from one trail through every cell and has exactly one answer, checked by the solver. Par is one stroke from each number to the next.</p>
`;

/** The trail's colors: deep blue where it starts, cyan along its length, near white at the head. */
const TRAIL_FROM = [59, 100, 200];
const TRAIL_TO = [111, 208, 230];
const GLOW = 'rgba(111, 208, 230, 0.7)';
/** Milliseconds a fresh step glows brighter, and a refused one flashes. */
const SPARK = 360;
const FLASH = 420;
const WIN_RUN = 1300;

interface Geo { x: number; y: number; c: number }

interface Paint {
  /** How much of the trail to draw, in cells (fractional ends part way); all of it when absent. */
  reveal?: number;
  /** Cells, numbers (by cell) and walls (by key) to outline in amber. */
  flagCells?: number[];
  flagWalls?: number[];
  /** Brightness boost per trail index, 0 to 1 (fresh steps). */
  spark?: (i: number) => number;
  /** The win's run along the trail, 0 to 1, or null. */
  run?: number | null;
  won?: boolean;
}

const centerOf = (s: TraceState, g: Geo, i: number): Point => ({ x: g.x + ((i % s.size) + 0.5) * g.c, y: g.y + (Math.floor(i / s.size) + 0.5) * g.c });

const mix = (t: number, k = 0): string => {
  const ch = (i: number) => Math.round(TRAIL_FROM[i] + (TRAIL_TO[i] - TRAIL_FROM[i]) * t + (255 - (TRAIL_FROM[i] + (TRAIL_TO[i] - TRAIL_FROM[i]) * t)) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
};

/** The ends of the wall on the edge between cells a and b. */
function wallLine(s: TraceState, g: Geo, a: number, b: number): [Point, Point] {
  const p = centerOf(s, g, a), q = centerOf(s, g, b);
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const h = g.c * 0.46;
  return p.y === q.y ? [{ x: mx, y: my - h }, { x: mx, y: my + h }] : [{ x: mx - h, y: my }, { x: mx + h, y: my }];
}

/** Paints the frame, the cell pads, walls, the trail, its electron and the numbers. */
export function paintTrace(ctx: CanvasRenderingContext2D, s: TraceState, g: Geo, o: Paint = {}): void {
  const c = g.c, n = s.size;
  drawFrame(ctx, frameBox(g.x, g.y, n * c, n * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  // Faint pads, one per cell, so the lattice reads without lines.
  for (let i = 0; i < n * n; i++) {
    const p = centerOf(s, g, i);
    tile(ctx, p.x - c * 0.42, p.y - c * 0.42, c * 0.84, c * 0.84, c * 0.16, C.surface, null);
  }
  const flagW = new Set(o.flagWalls ?? []);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, c * 0.1);
  for (const key of s.walls) {
    const a = Math.floor(key / 4096), b = key % 4096;
    const [p, q] = wallLine(s, g, a, b);
    ctx.strokeStyle = flagW.has(key) ? C.warn : C.frame;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  ctx.restore();
  // The trail, up to `reveal` cells along.
  const path = s.path;
  const span = Math.min(path.length - 1, o.reveal ?? path.length - 1);
  const pts: Point[] = [];
  for (let i = 0; i <= Math.floor(span) && i < path.length; i++) pts.push(centerOf(s, g, path[i]));
  const frac = span - Math.floor(span);
  if (frac > 0 && Math.floor(span) + 1 < path.length) {
    const a = centerOf(s, g, path[Math.floor(span)]), b = centerOf(s, g, path[Math.floor(span) + 1]);
    pts.push({ x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac });
  }
  if (pts.length > 1) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // A soft wide glow under the whole trail.
    ctx.strokeStyle = 'rgba(111, 208, 230, 0.16)';
    ctx.lineWidth = c * 0.56;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    // One glow under the whole trail, so joints never double it.
    ctx.lineWidth = c * 0.24;
    ctx.shadowColor = GLOW;
    ctx.shadowBlur = c * 0.3;
    ctx.strokeStyle = mix(0.6);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.shadowBlur = 0;
    // The trail itself, segment by segment, each a gradient between the shades at its ends, so it
    // runs smoothly from blue at the 1 to cyan at the head.
    const last = pts.length - 1;
    const shade = (j: number) => mix(last > 0 ? j / last : 1, 0.12 + 0.6 * Math.max(o.spark?.(j) ?? 0, runGlow(o.run, j, last)));
    for (let i = 0; i < last; i++) {
      const grad = ctx.createLinearGradient(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      // (A canvas stand-in without gradients gets the plain shade.)
      if (grad) { grad.addColorStop(0, shade(i)); grad.addColorStop(1, shade(i + 1)); }
      ctx.strokeStyle = grad ?? shade(i + 1);
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Numbers: dark discs until the trail meets them, then lit.
  const met = new Set<number>();
  for (let i = 0; i <= Math.floor(span) && i < path.length; i++) met.add(path[i]);
  const flagC = new Set(o.flagCells ?? []);
  const px = Math.max(13, Math.min(24, c * 0.38));
  s.checkpoints.forEach((cell, k) => {
    const p = centerOf(s, g, cell);
    const lit = met.has(cell);
    const fill = o.won ? C.good : lit ? C.accent : C.surface3;
    bead(ctx, p.x, p.y, c * 0.31, fill, lit && !o.won ? { glow: GLOW } : {});
    ctx.save();
    ctx.fillStyle = lit || o.won ? C.bg : C.text;
    ctx.font = font(px, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(k + 1), p.x, p.y + px * 0.36);
    ctx.restore();
  });
  // The electron at the head.
  if (pts.length && !o.won) {
    const h = pts[pts.length - 1];
    const onNumber = s.checkpoints.includes(path[Math.min(path.length - 1, Math.ceil(span))]) && frac === 0;
    if (!onNumber) bead(ctx, h.x, h.y, Math.max(3, c * 0.13), C.silver, { glow: C.silver });
  }
  if (o.run != null && pts.length > 1) {
    // The win's spark running the trail's length.
    const at = o.run * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(at)), f = at - i;
    const p = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
    bead(ctx, p.x, p.y, Math.max(3, c * 0.14), C.silver, { glow: C.silver });
  }
  for (const cell of flagC) {
    const p = centerOf(s, g, cell);
    tile(ctx, p.x - c * 0.44, p.y - c * 0.44, c * 0.88, c * 0.88, c * 0.18, null, C.warn, Math.max(2.5, c * 0.07));
  }
}

/** How brightly the win's run lights point j of the trail's `last`. */
function runGlow(run: number | null | undefined, j: number, last: number): number {
  if (run == null) return 0;
  const d = Math.abs(run * last - j);
  return Math.max(0, 1 - d / 3);
}

export class TraceView implements PuzzleView {
  private state: TraceState;
  private history: TraceState[] = [];
  private stroke: { before: TraceState; cell: number } | null = null;
  private geo: Geo | null = null;
  private reduced: boolean;
  private mark: { state: TraceState; cells: number[] } | null = null;
  private walls: Set<number>;
  /** When each trail index was last laid, for the fresh glow. */
  private laid: number[] = [];
  /** A refused step's flash: the number's cell or the wall's key, and when. */
  private refused: { cell?: number; wall?: number; at: number } | null = null;
  private wonAt: number | null = null;

  constructor(private readonly initial: TraceState, reducedMotion: boolean) {
    this.state = cloneTrace(initial);
    this.reduced = reducedMotion;
    this.walls = new Set(initial.walls);
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    return { progress: { label: 'Cells', value: `${s.path.length}/${s.size * s.size}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'Every cell traced';
    const left = s.size * s.size - s.path.length;
    if (endedShort(s)) return left === 1 ? 'At the end, but 1 cell missed' : `At the end, but ${left} cells missed`;
    if (!s.path.length) return 'Start on the 1';
    return left === 1 ? '1 cell to go' : `${left} cells to go`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    if (wrong >= 0) {
      if (level === 2) {
        const next = cloneTrace(s);
        next.path = s.path.slice(0, wrong);
        this.commit(next);
        return { text: 'Pulled the trail back to where it went astray.', moved: true };
      }
      this.mark = { state: s, cells: s.path.slice(wrong, wrong + 2) };
      return { text: 'The trail goes astray here.' };
    }
    const step = nextStep(s);
    if (!step) return null;
    if (level === 2) {
      const next = cloneTrace(s);
      if (!next.path.length) next.path = [s.solution[0]];
      const target = s.checkpoints[reached(next)];
      while (next.path.length < s.solution.length) {
        const cell = s.solution[next.path.length];
        next.path.push(cell);
        if (cell === target) break;
      }
      this.commit(next);
      return { text: `Traced on to the ${reached(next)}.`, moved: true };
    }
    this.mark = { state: s, cells: s.solution.slice(s.path.length, s.path.length + 2) };
    return { text: step.why };
  }

  /** Makes a new trail the board, as one stroke. */
  private commit(next: TraceState): void {
    const now = performance.now();
    for (let i = 0; i < next.path.length; i++) if (next.path[i] !== this.state.path[i]) this.laid[i] = now;
    next.moves = this.state.moves + 1;
    this.history.push(this.state);
    if (this.history.length > 200) this.history.shift();
    this.state = next;
  }

  restart(): void {
    this.state = cloneTrace(this.initial);
    this.history = [];
    this.stroke = null;
    this.laid = [];
    this.wonAt = null;
  }

  canUndo(): boolean { return this.history.length > 0 && !this.stroke; }

  undo(): boolean {
    if (this.stroke) return false;
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.wonAt = null;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  private cellAt(p: Point): number {
    const g = this.geo;
    if (!g) return -1;
    const n = this.state.size;
    const cx = Math.floor((p.x - g.x) / g.c), cy = Math.floor((p.y - g.y) / g.c);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return -1;
    return cy * n + cx;
  }

  down(p: Point): void {
    if (this.won) return;
    const cell = this.cellAt(p);
    if (cell < 0) return;
    const before = cloneTrace(this.state);
    if (!begin(this.state, cell)) return;
    this.stroke = { before, cell };
  }

  move(p: Point): void {
    const st = this.stroke;
    if (!st) return;
    const cell = this.cellAt(p);
    if (cell < 0 || cell === st.cell) return;
    const s = this.state;
    const n = s.size;
    const head = s.path[s.path.length - 1];
    const hx = head % n, hy = Math.floor(head / n), cx = cell % n, cy = Math.floor(cell / n);
    // A pointer that skipped cells along a row or column walks them one by one.
    const route: number[] = [];
    if (hx === cx || hy === cy) {
      const dx = Math.sign(cx - hx), dy = Math.sign(cy - hy);
      for (let at = head; at !== cell;) { at += dx + dy * n; route.push(at); }
    } else if (neighbors(n, head).includes(cell)) route.push(cell);
    for (const next of route) {
      const why = blocked(s, next, this.walls);
      if (why) {
        if (why === 'order' || why === 'wall') this.refused = why === 'wall' ? { wall: edgeKey(s.path[s.path.length - 1], next), at: performance.now() } : { cell: next, at: performance.now() };
        break;
      }
      const len = s.path.length;
      extend(s, next, this.walls);
      if (s.path.length > len) this.laid[s.path.length - 1] = performance.now();
    }
    st.cell = cell;
  }

  up(): void {
    const st = this.stroke;
    this.stroke = null;
    if (!st) return;
    const same = st.before.path.length === this.state.path.length && st.before.path.every((c, i) => c === this.state.path[i]);
    if (same) { this.state = st.before; return; }
    this.history.push(st.before);
    if (this.history.length > 200) this.history.shift();
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
    const g = { x: fit.x, y: fit.y, c: fit.cell };
    this.geo = g;
    const won = this.won;
    let run: number | null = null;
    if (won && !this.reduced) {
      this.wonAt ??= now;
      const k = (now - this.wonAt) / WIN_RUN;
      if (k < 1) run = k;
    } else if (!won) this.wonAt = null;
    const motion = !this.reduced;
    const flash = this.refused && motion && now - this.refused.at < FLASH ? this.refused : null;
    const short = endedShort(s);
    const flagCells: number[] = [];
    if (short) { const on = new Set(s.path); for (let i = 0; i < s.size * s.size; i++) if (!on.has(i)) flagCells.push(i); }
    if (flash?.cell !== undefined) flagCells.push(flash.cell);
    paintTrace(ctx, s, g, {
      spark: motion ? (i) => Math.max(0, 1 - (now - (this.laid[i] ?? -1e9)) / SPARK) : undefined,
      flagCells,
      flagWalls: flash?.wall !== undefined ? [flash.wall] : [],
      run,
      won: won && run === null,
    });
    const m = this.mark?.state === s && !won && !this.stroke ? this.mark : null;
    if (m) for (const cell of m.cells) {
      const q = centerOf(s, g, cell);
      const c = g.c;
      drawHelpMark(ctx, q.x - c * 0.4, q.y - c * 0.4, c * 0.8, c * 0.8, now, this.reduced, c * 0.2);
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

/** A picture board: numbers at [x, y] in order, walls between pairs of [x, y] cells, and the
 *  trail drawn as [x, y] steps. */
function board(n: number, nums: [number, number][], trail: [number, number][], walls: [[number, number], [number, number]][] = []): TraceState {
  const at = ([x, y]: [number, number]) => y * n + x;
  const path = trail.map(at);
  return { size: n, checkpoints: nums.map(at), walls: walls.map(([a, b]) => edgeKey(at(a), at(b))), path, solution: path.slice(), moves: 0, par: 0 };
}

const LEAD = 0.4;
const PER_CELL = 0.24;
const REST = 0.6;

/** One rule picture: the trail drawn cell by cell, then amber marks on what breaks a rule. */
function picture(s: TraceState, caption: string, flag: { cells?: [number, number][]; walls?: [[number, number], [number, number]][] } = {}): Illustration {
  const steps = Math.max(1, s.path.length - 1);
  const raw = LEAD + PER_CELL * steps + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  const n = s.size;
  const flagCells = flag.cells?.map(([x, y]) => y * n + x);
  const flagWalls = flag.walls?.map(([a, b]) => edgeKey(a[1] * n + a[0], b[1] * n + b[0]));
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const u = t * pace;
      const reveal = Math.max(0, Math.min(steps, (u - LEAD) / PER_CELL));
      const fit = fitFramed({ x: 0, y: 0, w, h }, n, n, { margin: 2, maxCell: 999 });
      const done = u >= LEAD + PER_CELL * steps;
      const shown = { ...s, path: u < LEAD ? [] : s.path };
      paintTrace(ctx, shown, { x: fit.x, y: fit.y, c: fit.cell }, {
        reveal,
        flagCells: done ? flagCells : undefined,
        flagWalls: done ? flagWalls : undefined,
      });
    },
  };
}

const WALLS: [[number, number], [number, number]][] = [[[0, 0], [1, 0]], [[1, 1], [2, 1]]];

export const RULES: RuleCard[] = [
  {
    title: 'Trail',
    text: 'Drag from the 1, cell to cell, to lay the trail. Drag back along it to pull it in.',
    good: picture(board(3, [[0, 0], [2, 2]], [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2]]), 'From the 1 onward'),
  },
  {
    title: 'In order',
    text: 'The trail meets the numbers in order, 1, 2, 3 and on, and ends on the last one.',
    good: picture(board(3, [[0, 0], [2, 0], [0, 2], [2, 2]], [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2]]), '1, 2, 3, 4'),
    bad: picture(board(3, [[0, 0], [2, 0], [0, 2], [2, 2]], [[0, 0], [0, 1], [0, 2]]), '3 before 2', { cells: [[0, 2]] }),
  },
  {
    title: 'Every cell',
    text: 'The trail passes through every cell exactly once.',
    good: picture(board(3, [[1, 1], [2, 2]], [[1, 1], [1, 2], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]), 'Every cell, once'),
    bad: picture(board(3, [[0, 0], [2, 2]], [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]), 'Cells left out', { cells: [[0, 1], [1, 1], [0, 2], [1, 2]] }),
  },
  {
    title: 'Walls',
    text: 'A wall between two cells blocks the trail: go round it.',
    good: picture(board(3, [[0, 0], [0, 2]], [[0, 0], [0, 1], [1, 1], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2]], WALLS), 'Round the walls'),
    bad: picture(board(3, [[0, 0], [0, 2]], [[0, 0], [1, 0]], WALLS), 'Through a wall', { walls: [[[0, 0], [1, 0]]] }),
  },
];
