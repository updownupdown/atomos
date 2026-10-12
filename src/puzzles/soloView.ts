// Drawing and touch for Solo: the orbitals are soft colored patches of cells, parted by wide
// gutters. Tap a cell for a cross, again for an electron, again to clear it; drag across cells
// to cross off many at once (drag from a cross to clear them). Electrons are silver beads; any
// that break a rule get an amber ring as soon as they do.
//
// The board is painted by `paintSolo`, which the rule cards' pictures share.

import {
  applyStep, CROSS, cloneSolo, conflicts, ELECTRON, electrons, firstWrong, geometry, knowledgeOf, nextStep,
  setMarks, solved, tap, unitKind, type Geometry, type Mark, type SoloState, type Step,
} from './solo';
import { bead, C, fitGrid } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Solus is a reserve game, played from the Puzzles screen. The grid grows with the dial from 5 by 5 (Very easy) through 6, 7, 8 and 9 to 10 by 10 at the top of Expert, with as many orbitals as rows. Every board has exactly one answer, checked by a solver, and a step-by-step solver that works the way a person does reaches it without guessing. Each deal is picked from several by how many harder steps it takes: easy dials keep the boards that fall almost entirely to "one cell left"; hard dials keep the ones that most need an orbital boxed into a row, a squeeze, or two or three orbitals sharing rows. Orbitals are a mix of sizes, with a few small ones as footholds. Par is one electron per row; crosses are free.</p>
`;

/** The orbitals' fills and their names, for the hint line: soft, dark enough for the silver
 *  electrons, in hue order round the color wheel, kept clear of rose and amber. */
export const SOLO_HUES: { color: string; name: string; hue: number }[] = [
  { color: '#8a4049', name: 'brick', hue: 356 },
  { color: '#8f5a2e', name: 'copper', hue: 28 },
  { color: '#77732f', name: 'olive', hue: 58 },
  { color: '#4d7a33', name: 'moss', hue: 100 },
  { color: '#2f7a5c', name: 'green', hue: 155 },
  { color: '#2d7079', name: 'teal', hue: 187 },
  { color: '#3760a0', name: 'blue', hue: 217 },
  { color: '#4f4aa0', name: 'indigo', hue: 244 },
  { color: '#71489f', name: 'violet', hue: 272 },
  { color: '#86457c', name: 'plum', hue: 308 },
];

/**
 * A color per orbital (an index into SOLO_HUES). Fewer orbitals take hues spread evenly round
 * the wheel; then colors are swapped between orbitals while that pushes neighbors' hues further
 * apart, so two orbitals that touch never look alike.
 */
export function orbitalColors(n: number, regions: number[]): number[] {
  const side = Math.round(Math.sqrt(regions.length));
  const pairs: [number, number][] = [];
  const add = (a: number, b: number) => { if (a !== b && !pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) pairs.push([a, b]); };
  for (let i = 0; i < regions.length; i++) {
    if ((i % side) + 1 < side) add(regions[i], regions[i + 1]);
    if (i + side < regions.length) add(regions[i], regions[i + side]);
  }
  const k = SOLO_HUES.length;
  const out = Array.from({ length: n }, (_, g) => Math.floor((g * k) / n) % k);
  const gap = (a: number, b: number) => { const d = Math.abs(SOLO_HUES[a].hue - SOLO_HUES[b].hue) % 360; return Math.min(d, 360 - d); };
  const cost = () => pairs.reduce((t, [a, b]) => t + Math.max(0, 100 - gap(out[a], out[b])) ** 2, 0);
  let best = cost();
  for (let pass = 0; pass < 12; pass++) {
    let better = false;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      [out[a], out[b]] = [out[b], out[a]];
      const c = cost();
      if (c < best) { best = c; better = true; } else [out[a], out[b]] = [out[b], out[a]];
    }
    if (!better) break;
  }
  return out;
}

interface Geo { x: number; y: number; c: number }

interface Paint {
  /** Ring electrons that break a rule. */
  mark: boolean;
  /** When each cell last changed (ms), for its pop; and the clock. */
  pops?: Map<number, number>;
  now?: number;
  /** Milliseconds since the board was won, for the wave of green; null while not won. */
  wonFor?: number | null;
  colors?: number[];
}

const POP = 170;

const centerOf = (n: number, g: Geo, i: number): Point => ({ x: g.x + ((i % n) + 0.5) * g.c, y: g.y + (Math.floor(i / n) + 0.5) * g.c });

/** The orbitals: each cell a tile, joined to same-orbital neighbors by a hairline gutter and
 *  parted from other orbitals by a wide one; corners round only on an orbital's outside. */
function orbitals(ctx: CanvasRenderingContext2D, s: SoloState, g: Geo, colors: number[]): void {
  const n = s.size, c = g.c;
  const inner = Math.max(1, c * 0.025), outer = Math.max(3, c * 0.09);
  const r = c * 0.16;
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = Math.floor(i / n), reg = s.regions[i];
    const same = (dx: number, dy: number) => {
      const xx = x + dx, yy = y + dy;
      return xx >= 0 && yy >= 0 && xx < n && yy < n && s.regions[yy * n + xx] === reg;
    };
    const L = same(-1, 0), R = same(1, 0), U = same(0, -1), D = same(0, 1);
    const l = (L ? inner : outer) / 2, rr = (R ? inner : outer) / 2, u = (U ? inner : outer) / 2, d = (D ? inner : outer) / 2;
    const px = g.x + x * c + l, py = g.y + y * c + u, w = c - l - rr, h = c - u - d;
    const k = (a: boolean, b: boolean) => (!a && !b ? r : Math.min(r, inner));
    ctx.fillStyle = SOLO_HUES[colors[reg] % SOLO_HUES.length].color;
    ctx.beginPath();
    ctx.roundRect(px, py, w, h, [k(U, L), k(U, R), k(D, R), k(D, L)]);
    ctx.fill();
  }
}

/** A cross: the player's note that a cell holds no electron. */
function cross(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, k = 1): void {
  const a = c * 0.13 * (0.6 + 0.4 * k);
  ctx.save();
  ctx.globalAlpha = 0.2 + 0.45 * k;
  ctx.strokeStyle = C.silverDim;
  ctx.lineWidth = Math.max(2, c * 0.055);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - a, y - a); ctx.lineTo(x + a, y + a);
  ctx.moveTo(x + a, y - a); ctx.lineTo(x - a, y + a);
  ctx.stroke();
  ctx.restore();
}

/** Paints the board: frame, orbitals, crosses, electrons, and amber rings round clashes. */
export function paintSolo(ctx: CanvasRenderingContext2D, s: SoloState, g: Geo, o: Paint): void {
  const n = s.size, c = g.c;
  drawFrame(ctx, frameBox(g.x, g.y, n * c, n * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  const colors = o.colors ?? orbitalColors(n, s.regions);
  orbitals(ctx, s, g, colors);
  const bad = o.mark ? conflicts(s) : new Set<number>();
  const now = o.now ?? 0;
  for (let i = 0; i < n * n; i++) {
    const v = s.cells[i];
    if (!v) continue;
    const p = centerOf(n, g, i);
    const at = o.pops?.get(i);
    const k = at === undefined ? 1 : ease((now - at) / POP);
    if (v === CROSS) { cross(ctx, p.x, p.y, c, k); continue; }
    // A green glow sweeps down the rows once the board is won.
    const row = Math.floor(i / n);
    const lit = o.wonFor != null ? Math.max(0, Math.min(1, (o.wonFor - row * 70) / 260)) : 0;
    if (lit > 0) bead(ctx, p.x, p.y, c * 0.36 * (0.7 + 0.3 * lit), C.good, { alpha: 0.35 * lit });
    bead(ctx, p.x, p.y, c * 0.25 * (0.55 + 0.45 * k), C.silver, { rim: C.bg, glow: lit > 0 ? C.good : undefined });
    if (bad.has(i)) {
      ctx.save();
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = Math.max(2.5, c * 0.07);
      ctx.beginPath();
      ctx.arc(p.x, p.y, c * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Where Look here points: units (rows, columns, orbitals) or single cells. */
interface Mark2 { state: SoloState; units: number[]; cells: number[] }

export class SoloView implements PuzzleView {
  private state: SoloState;
  private history: SoloState[] = [];
  private geo: Geometry;
  private colors: number[];
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private mark: Mark2 | null = null;
  private pops = new Map<number, number>();
  private wonAt: number | null = null;
  /** A press under way: where it began, the board before it, and, once it drags, what it paints. */
  private press: { start: number; at: Point; before: SoloState; paint: { from: Mark; to: Mark } | null; last: Point } | null = null;

  constructor(private readonly initial: SoloState, reducedMotion: boolean) {
    this.state = cloneSolo(initial);
    this.reduced = reducedMotion;
    this.geo = geometry(initial.size, initial.regions);
    this.colors = orbitalColors(initial.size, initial.regions);
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    return { progress: { label: 'Placed', value: `${electrons(this.state)}/${this.state.size}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'One electron in every orbital';
    const bad = conflicts(s).size;
    if (bad) return `${bad} electrons clash`;
    const left = s.size - electrons(s);
    return left === 1 ? '1 electron to place' : `${left} electrons to place`;
  }

  private name(u: number): string {
    const n = this.state.size;
    return `the ${SOLO_HUES[this.colors[u - 2 * n] % SOLO_HUES.length].name} orbital`;
  }

  /** What a unit is called in a sentence: "this row", "the blue orbital". */
  private called(u: number, one = true): string {
    const kind = unitKind(this.state.size, u);
    return kind === 'orbital' ? this.name(u) : one ? `this ${kind}` : `that ${kind}`;
  }

  /** One plain sentence on why a step holds. */
  private why(st: Step): string {
    const n = this.state.size;
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    const u = st.units[0];
    switch (st.kind) {
      case 'single':
        return `${cap(this.called(u))} has one free cell left for its electron.`;
      case 'confined': {
        const v = st.into[0];
        return unitKind(n, u) === 'orbital'
          ? `${cap(this.name(u))}'s free cells all lie in one ${unitKind(n, v)}, so the rest of that ${unitKind(n, v)} stays empty.`
          : `${cap(this.called(u))}'s free cells all lie in ${this.name(v)}, so the rest of that orbital stays empty.`;
      }
      case 'squeeze':
        return `An electron in a marked cell would leave ${this.called(u, false)} no room.`;
      case 'group': {
        const k = st.units.length;
        const kind = unitKind(n, st.units[0]);
        const into = unitKind(n, st.into[0]);
        return kind === 'orbital'
          ? `These ${k} orbitals fill ${k} ${into}s between them, so the rest of those ${into}s stays empty.`
          : `These ${k} ${kind}s lie within ${k} orbitals, so the rest of those orbitals stays empty.`;
      }
    }
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    if (wrong >= 0) {
      const el = s.cells[wrong] === ELECTRON;
      if (level === 2) {
        this.apply(setMarks(s, [wrong], 0));
        return { text: el ? 'Took away an electron that does not belong there.' : 'Cleared a cross from a cell that needs its electron.', moved: true };
      }
      this.mark = { state: s, units: [], cells: [wrong] };
      return { text: el ? 'This electron does not belong here.' : 'This cross sits on a cell that needs an electron.' };
    }
    const kn = knowledgeOf(s, this.geo);
    const st = nextStep(this.geo, kn);
    if (!st) {
      // Every step a person would take is covered; fall back on the answer.
      const r = s.solution.findIndex((c, y) => s.cells[y * s.size + c] !== ELECTRON);
      if (r < 0) return null;
      const i = r * s.size + s.solution[r];
      if (level === 2) { this.apply(setMarks(s, [i], ELECTRON)); return { text: 'Placed an electron.', moved: true }; }
      this.mark = { state: s, units: [], cells: [i] };
      return { text: 'An electron belongs here.' };
    }
    if (level === 2) {
      const crosses = st.cross.filter((i) => s.cells[i] === 0);
      let next = crosses.length ? setMarks(s, crosses, CROSS) : null;
      if (st.place >= 0) next = setMarks(next ?? s, [st.place], ELECTRON);
      this.apply(next);
      if (st.place >= 0) return { text: `${this.why(st).replace(/\.$/, '')}: placed it, and crossed off what it rules out.`, moved: true };
      const k = crosses.length;
      const why = this.why(st).replace('a marked cell', 'any of them');
      return { text: `Crossed off ${k} ${k === 1 ? 'cell' : 'cells'}: ${why.charAt(0).toLowerCase()}${why.slice(1)}`, moved: true };
    }
    if (st.kind === 'squeeze') this.mark = { state: s, units: [], cells: st.cross };
    else this.mark = { state: s, units: st.units, cells: [] };
    return { text: this.why(st) };
  }

  private apply(next: SoloState | null): void {
    if (!next) return;
    const now = performance.now();
    next.cells.forEach((v, i) => { if (v !== this.state.cells[i]) this.pops.set(i, now); });
    this.history.push(this.state);
    if (this.history.length > 300) this.history.shift();
    this.state = next;
  }

  restart(): void {
    this.state = cloneSolo(this.initial);
    this.history = [];
    this.press = null;
    this.pops.clear();
  }

  canUndo(): boolean { return this.history.length > 0 && !this.press; }

  undo(): boolean {
    if (this.press) return false;
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.pops.clear();
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
    const start = this.cellAt(p);
    if (start < 0) return;
    this.press = { start, at: p, before: this.state, paint: null, last: p };
  }

  /** Paints the drag's mark onto every cell under the segment from a to b. */
  private paintAlong(a: Point, b: Point): void {
    const pr = this.press;
    if (!pr?.paint) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (this.cell * 0.25)));
    const cells: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const i = this.cellAt({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
      if (i >= 0 && this.state.cells[i] === pr.paint.from && !cells.includes(i)) cells.push(i);
    }
    if (!cells.length) return;
    const next = setMarks(this.state, cells, pr.paint.to);
    if (!next) return;
    const now = performance.now();
    for (const i of cells) this.pops.set(i, now);
    this.state = next;
  }

  move(p: Point): void {
    const pr = this.press;
    if (!pr) return;
    if (!pr.paint) {
      const i = this.cellAt(p);
      if (i === pr.start || i < 0) return;
      // The drag began: cross off empty cells, or clear crosses when it began on one.
      const from = pr.before.cells[pr.start];
      pr.paint = from === CROSS ? { from: CROSS, to: 0 } : { from: 0, to: CROSS };
      this.paintAlong(pr.at, p);
    } else {
      this.paintAlong(pr.last, p);
    }
    pr.last = p;
  }

  up(p: Point): void {
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    if (pr.paint) {
      this.paintAlong(pr.last, p);
      const after = this.state;
      this.state = pr.before;
      if (after !== pr.before) {
        this.history.push(pr.before);
        if (this.history.length > 300) this.history.shift();
        this.state = after;
      }
      return;
    }
    if (this.cellAt(p) !== pr.start) return;
    this.apply(tap(this.state, pr.start));
  }

  cancel(): void {
    const pr = this.press;
    this.press = null;
    if (pr) this.state = pr.before;
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const n = s.size;
    const fit = fitFramed(area, n, n, { margin: 8, maxCell: 72 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const g = { x: fit.x, y: fit.y, c };
    const won = this.won;
    if (won) this.wonAt ??= now;
    else this.wonAt = null;
    const motion = !this.reduced;
    paintSolo(ctx, s, g, {
      mark: true,
      pops: motion ? this.pops : undefined,
      now,
      wonFor: won ? (motion ? now - this.wonAt! : 1e6) : null,
      colors: this.colors,
    });
    const m = this.mark?.state === s && !won && !this.press ? this.mark : null;
    if (!m) return;
    const r = c * 0.18;
    for (const u of m.units) {
      const kind = unitKind(n, u);
      if (kind === 'row') drawHelpMark(ctx, g.x + 2, g.y + u * c + 2, n * c - 4, c - 4, now, this.reduced, r);
      else if (kind === 'column') drawHelpMark(ctx, g.x + (u - n) * c + 2, g.y + 2, c - 4, n * c - 4, now, this.reduced, r);
      else for (const i of this.geo.units[u]) {
        const p = centerOf(n, g, i);
        drawHelpMark(ctx, p.x - c * 0.36, p.y - c * 0.36, c * 0.72, c * 0.72, now, this.reduced, r);
      }
    }
    for (const i of m.cells) {
      const p = centerOf(n, g, i);
      drawHelpMark(ctx, p.x - c * 0.38, p.y - c * 0.38, c * 0.76, c * 0.76, now, this.reduced, r);
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
 * The picture board: four orbitals on a 4 by 4 grid, the green one (D) boxed into the bottom row.
 *   A A B B
 *   C A B B
 *   C C C B
 *   C D D D
 * Its one answer: columns 1, 3, 0, 2.
 */
const PIC_REGIONS = 'AABBCABBCCCBCDDD'.split('').map((ch) => ch.charCodeAt(0) - 65);

function picBoard(): SoloState {
  return { size: 4, regions: PIC_REGIONS, cells: Array(16).fill(0), solution: [1, 3, 0, 2], moves: 0, par: 4, score: 0 };
}

/** A beat of a picture: at `t` seconds, these cells take this mark. */
type Beat = { t: number; cells: [number, number][]; v: Mark };

/** One rule picture: marks land beat by beat, each popping in; rules are checked once it settles. */
function picture(beats: Beat[], caption: string, check = false, duration = 2.6): Illustration {
  const s0 = picBoard();
  // Blue, copper, violet and green, so the cards can name the green one.
  const colors = [6, 1, 8, 4];
  const last = beats.reduce((a, b) => Math.max(a, b.t), 0);
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const s = cloneSolo(s0);
      const pops = new Map<number, number>();
      for (const b of beats) {
        if (t < b.t) continue;
        for (const [x, y] of b.cells) { s.cells[y * 4 + x] = b.v; pops.set(y * 4 + x, b.t * 1000); }
      }
      const fit = fitFramed({ x: 0, y: 0, w, h }, 4, 4, { margin: 2, maxCell: 999 });
      paintSolo(ctx, s, { x: fit.x, y: fit.y, c: fit.cell }, { mark: check && t >= last + 0.2, pops, now: t * 1000, colors });
    },
  };
}

const SOLUTION: [number, number][] = [[1, 0], [3, 1], [0, 2], [2, 3]];

export const RULES: RuleCard[] = [
  {
    title: 'Electrons',
    text: 'Tap a cell once for a cross, twice for an electron and again to clear it. Crosses are only your notes.',
    good: picture([
      { t: 0.4, cells: [[1, 0]], v: CROSS },
      { t: 1.0, cells: [[1, 0]], v: ELECTRON },
      { t: 1.6, cells: [[0, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]], v: CROSS },
    ], 'Cross, then electron'),
  },
  {
    title: 'One each',
    text: 'Every row, every column and every orbital holds exactly one electron.',
    good: picture(SOLUTION.map((cell, k) => ({ t: 0.4 + 0.45 * k, cells: [cell], v: ELECTRON })), 'One in each'),
    bad: picture([{ t: 0.4, cells: [[2, 0]], v: ELECTRON }, { t: 0.9, cells: [[3, 2]], v: ELECTRON }], 'Two in one orbital', true, 2),
  },
  {
    title: 'No touching',
    text: 'No two electrons touch, not even at a corner.',
    good: picture([{ t: 0.4, cells: [[1, 0]], v: ELECTRON }, { t: 0.9, cells: [[3, 1]], v: ELECTRON }], 'A cell apart', false, 2),
    bad: picture([{ t: 0.4, cells: [[1, 0]], v: ELECTRON }, { t: 0.9, cells: [[2, 1]], v: ELECTRON }], 'Corners touching', true, 2),
  },
  {
    title: 'Drag to cross',
    text: 'Drag across cells to cross off many at once. Drag from a cross to clear them.',
    good: picture([0, 1, 2].map((x) => ({ t: 0.4 + 0.25 * x, cells: [[x, 1]] as [number, number][], v: CROSS })), 'Drag across', false, 2),
  },
  {
    title: 'Think ahead',
    text: 'The green orbital lies in the bottom row, so its electron is there: cross off the rest of that row.',
    good: picture([{ t: 0.8, cells: [[0, 3]], v: CROSS }], 'Orbital in one row', false, 1.8),
  },
];
