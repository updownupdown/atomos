// Drawing and touch for Emit: tap an open cell for a lamp, again for a cross (no lamp here), again
// to clear it; drag across open cells to cross several at once (a drag from a cross clears them).
// A placed lamp sends its light out along its row and column, cell by cell, until a wall stops
// it; lit cells glow warm. Lamps that light each other turn amber with a halo, and so does a
// numbered wall with too many lamps beside it; a number with exactly its lamps turns green.
//
// The board is painted by `paintEmit`, which the rule cards' pictures share.

import { clashes, cloneEmit, CROSS, firstWrong, LAMP, lampsBeside, light, nextForced, NONE, OPEN, overfull, rays, setMark, setMarks, sight, solved, tap, WALL, type EmitState } from './emit';
import { C, fitGrid, font, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<section class="how-specs"><h3>Specs</h3><ul>
<li><b>Flawless:</b> Light every cell placing no more lamps than par, the number of lamps in the answer (crosses are free), and without Show me.</li>
<li><b>Board:</b> The grid grows from 6 by 6 to 10 by 10. Walls take about a quarter of it, laid mostly in a half-turn pattern.</li>
<li><b>Numbers:</b> Fewer walls keep their numbers as it gets harder: all of them on the easiest boards, about half on the hardest.</li>
<li><b>Built:</b> Each board is kept only when the solver can finish it by deduction, which proves it has exactly one answer.</li>
<li><b>Difficulty:</b> Very easy boards need only the basic rules. From Easy on a board may need ruling out a spot whose lamp would leave a cell or a number stranded, and from Medium on a step of looking ahead; Hard and Expert boards are picked to need it.</li>
<li><b>Where it's played:</b> Emit is a reserve game, played from the Puzzles screen.</li>
</ul></section>
`;

/** Milliseconds for the light to cross one cell, to fade in, and to fade when a lamp goes. */
const STEP = 45;
const FADE = 140;
const GONE = 220;

/** The light's warm cream (not amber, which flags a problem). */
const GLOW = '255, 238, 205';
const LAMP_FILL = '#fff4dc';
/** Walls: a cool slate, darker than lit cells and lighter than dark ones. */
const WALL_FILL = '#3a4045';

/** A numbered wall is settled when it has exactly its lamps and no free side is left open
 *  (each is a lamp, crossed, or in light). */
function settled(s: EmitState, w: number, lit: Float32Array): boolean {
  if (lampsBeside(s, w) !== s.walls[w]) return false;
  const { nb } = sight(s.size, s.walls);
  return nb[w].every((c) => s.walls[c] !== OPEN || s.marks[c] !== NONE || lit[c] > 0);
}

interface Geo { x: number; y: number; c: number }

interface Paint {
  now: number;
  /** When each lamp was placed (ms, on `now`'s clock), for its light running out. */
  placed?: Map<number, number>;
  /** Lamps taken away, and when, for their light fading. */
  gone?: Map<number, number>;
  /** Cells outlined in amber (rule pictures: a cell left dark). */
  flag?: number[];
  /** Milliseconds since the win, for its glow passing over the board. */
  won?: number;
}

const centerOf = (s: EmitState, g: Geo, i: number): Point => ({ x: g.x + ((i % s.size) + 0.5) * g.c, y: g.y + (Math.floor(i / s.size) + 0.5) * g.c });

/** How bright each cell's light is, 0 to 1, with lamps' light still running out or fading. */
function brightness(s: EmitState, o: Paint): Float32Array {
  const n = s.size;
  const out = new Float32Array(n * n);
  const { sees } = sight(n, s.walls);
  const k = (f: number): number => ease(Math.max(0, Math.min(1, f)));
  for (let c = 0; c < s.marks.length; c++) {
    if (s.marks[c] !== LAMP) continue;
    const t0 = o.placed?.get(c);
    if (t0 === undefined || o.now - t0 >= FADE + STEP * n) {
      out[c] = 1;
      for (const d of sees[c]) out[d] = 1;
      continue;
    }
    // A new lamp: its light reaches each cell a step after the one before.
    out[c] = Math.max(out[c], k((o.now - t0) / FADE));
    for (const ray of rays(n, s.walls, c)) ray.forEach((d, j) => { out[d] = Math.max(out[d], k((o.now - t0 - (j + 1) * STEP) / FADE)); });
  }
  if (o.gone) for (const [c, t0] of o.gone) {
    const f = (o.now - t0) / GONE;
    if (f >= 1) continue;
    for (const ray of [[c], ...rays(n, s.walls, c)]) for (const d of ray) out[d] = Math.max(out[d], 1 - ease(f));
  }
  return out;
}

/** A lamp: a bright disc with four short rays on the diagonals; amber with a halo when it clashes. */
function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, clash: boolean, scale = 1): void {
  const r = c * 0.24 * scale;
  ctx.save();
  if (clash) {
    ctx.fillStyle = C.warn;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.shadowColor = `rgba(${GLOW}, 0.9)`;
    ctx.shadowBlur = r * 1.4;
  }
  ctx.fillStyle = clash ? C.warn : LAMP_FILL;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = clash ? C.warn : LAMP_FILL;
  ctx.lineWidth = Math.max(1.5, c * 0.05 * scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    ctx.moveTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
    ctx.lineTo(x + Math.cos(a) * r * 1.8, y + Math.sin(a) * r * 1.8);
  }
  ctx.stroke();
  ctx.restore();
}

function cross(ctx: CanvasRenderingContext2D, x: number, y: number, c: number): void {
  const r = c * 0.11;
  ctx.save();
  ctx.strokeStyle = C.text2;
  ctx.lineWidth = Math.max(1.6, c * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.stroke();
  ctx.restore();
}

/** Paints the board: walls and their numbers, the light, beams still running out, crosses,
 *  lamps, and amber wherever a rule is broken. */
export function paintEmit(ctx: CanvasRenderingContext2D, s: EmitState, g: Geo, o: Paint): void {
  const n = s.size, c = g.c;
  drawFrame(ctx, frameBox(g.x, g.y, n * c, n * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  const b = brightness(s, o);
  const bad = clashes(s);
  const over = new Set(overfull(s));
  const inset = c * 0.05;
  for (let i = 0; i < n * n; i++) {
    const p = centerOf(s, g, i);
    const x0 = p.x - c / 2 + inset, y0 = p.y - c / 2 + inset, side = c - inset * 2;
    const v = s.walls[i];
    if (v !== OPEN) {
      const full = v >= 0 && settled(s, i, b);
      tile(ctx, x0, y0, side, side, c * 0.14, over.has(i) ? C.warn : WALL_FILL, null);
      if (v >= 0) {
        ctx.fillStyle = over.has(i) ? C.bg : full ? C.good : C.text;
        ctx.font = font(Math.max(13, c * 0.46), 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), p.x, p.y + c * 0.02);
        if (full) {
          // A short bar under a satisfied number: the cue beside the green.
          ctx.fillRect(p.x - c * 0.12, p.y + c * 0.25, c * 0.24, Math.max(2, c * 0.05));
        }
      }
      continue;
    }
    let k = b[i];
    if (o.won !== undefined) {
      // The win: a brighter glow passing over the board, corner to corner.
      const at = ((i % n) + Math.floor(i / n)) * 40;
      const f = (o.won - at) / 420;
      if (f > 0 && f < 1) k = Math.min(1.6, k + 0.6 * Math.sin(Math.PI * f));
    }
    if (k > 0) tile(ctx, x0, y0, side, side, c * 0.12, `rgba(${GLOW}, ${(0.3 * Math.min(1, k) + 0.2 * Math.max(0, k - 1)).toFixed(3)})`, null);
    else {
      ctx.fillStyle = C.surface3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.5, c * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Beams still running out: a bright line from the lamp to the light's front.
  if (o.placed) for (const [cell, t0] of o.placed) {
    if (s.marks[cell] !== LAMP) continue;
    const age = o.now - t0;
    const r = rays(n, s.walls, cell);
    const longest = Math.max(0, ...r.map((ray) => ray.length));
    const fade = 1 - (age - longest * STEP) / 260;
    if (age < 0 || fade <= 0) continue;
    const p = centerOf(s, g, cell);
    ctx.save();
    ctx.strokeStyle = `rgba(${GLOW}, ${(0.75 * Math.min(1, fade)).toFixed(3)})`;
    ctx.lineWidth = Math.max(2, c * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const ray of r) {
      if (!ray.length) continue;
      const reach = Math.min(ray.length, age / STEP);
      const end = centerOf(s, g, ray[ray.length - 1]);
      const len = Math.hypot(end.x - p.x, end.y - p.y);
      const ux = (end.x - p.x) / len, uy = (end.y - p.y) / len;
      const d = Math.min(len + c * 0.35, reach * c);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + ux * d, p.y + uy * d);
    }
    ctx.stroke();
    ctx.restore();
  }
  // Clashing lamps: the light between them in amber.
  if (bad.size) {
    const { sees } = sight(n, s.walls);
    ctx.save();
    ctx.strokeStyle = C.warn;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(2, c * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const a of bad) for (const d of sees[a]) {
      if (d < a || s.marks[d] !== LAMP) continue;
      const p = centerOf(s, g, a), q = centerOf(s, g, d);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < n * n; i++) {
    if (s.walls[i] !== OPEN) continue;
    const p = centerOf(s, g, i);
    if (s.marks[i] === CROSS) cross(ctx, p.x, p.y, c);
    else if (s.marks[i] === LAMP) {
      const t0 = o.placed?.get(i);
      const pop = t0 === undefined ? 1 : Math.max(0, Math.min(1, (o.now - t0) / 200));
      lamp(ctx, p.x, p.y, c, bad.has(i), pop < 1 ? 0.6 + 0.4 * ease(pop) + 0.12 * Math.sin(Math.PI * pop) : 1);
    }
  }
  if (o.flag) for (const i of o.flag) {
    const p = centerOf(s, g, i);
    tile(ctx, p.x - c * 0.42, p.y - c * 0.42, c * 0.84, c * 0.84, c * 0.16, null, C.warn, Math.max(2, c * 0.07));
  }
}

export class EmitView implements PuzzleView {
  private state: EmitState;
  private history: EmitState[] = [];
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private mark: { state: EmitState; cells: number[] } | null = null;
  private press: { cell: number; at: Point; mode: 'tap' | 'cross' | 'clear' | 'none'; cells: number[]; before: EmitState } | null = null;
  private placed = new Map<number, number>();
  private gone = new Map<number, number>();
  private wonAt = 0;

  constructor(private readonly initial: EmitState, reducedMotion: boolean) {
    this.state = cloneEmit(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    const lit = light(s);
    const open = s.walls.filter((v) => v === OPEN).length;
    return { progress: { label: 'Lit', value: `${s.walls.filter((v, i) => v === OPEN && lit[i]).length}/${open}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'Every cell lit';
    const bad = clashes(s).size;
    if (bad) return bad === 2 ? '2 lamps light each other' : `${bad} lamps light each other`;
    const over = overfull(s).length;
    if (over) return over === 1 ? 'A number has too many lamps' : `${over} numbers have too many lamps`;
    const lit = light(s);
    const dark = s.walls.filter((v, i) => v === OPEN && !lit[i]).length;
    if (!dark) return 'All lit, but a number is short';
    return dark === 1 ? '1 cell still dark' : `${dark} cells still dark`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    if (wrong >= 0) {
      const isLamp = s.marks[wrong] === LAMP;
      if (level === 2) {
        this.apply(setMark(s, wrong, isLamp ? CROSS : LAMP));
        return { text: isLamp ? 'Took that lamp away.' : 'Placed a lamp under that cross.', moved: true };
      }
      this.mark = { state: s, cells: [wrong] };
      return { text: isLamp ? 'This lamp is not part of the answer.' : 'A lamp belongs under this cross.' };
    }
    const f = nextForced(s);
    if (!f) {
      const c = s.solution.findIndex((v, i) => v && s.marks[i] !== LAMP);
      if (c < 0) return null;
      if (level === 2) { this.apply(setMark(s, c, LAMP)); return { text: 'Placed a lamp.', moved: true }; }
      this.mark = { state: s, cells: [c] };
      return { text: 'A lamp belongs here.' };
    }
    if (level === 2) {
      this.apply(setMark(s, f.cell, f.lamp ? LAMP : CROSS));
      return { text: f.lamp ? 'Placed a lamp.' : 'Crossed it: no lamp goes here.', moved: true };
    }
    this.mark = { state: s, cells: f.about !== undefined && f.about !== f.cell ? [f.cell, f.about] : [f.cell] };
    const k = f.about !== undefined ? s.walls[f.about] : -1;
    let text: string;
    switch (f.rule) {
      case 'needs': text = `This ${k} needs a lamp on every free side.`; break;
      case 'only': text = f.about === f.cell ? 'Nothing else can light this cell, so it needs its own lamp.' : 'This is the only spot left that can light the other marked cell.'; break;
      case 'darken': text = 'A lamp here would leave the other marked cell with no way to be lit.'; break;
      case 'starve': text = `A lamp here would leave the marked ${k} short of lamps.`; break;
      case 'full': text = `This ${k} already has its lamps.`; break;
      default: text = f.lamp ? 'Leaving this cell without a lamp leads to a dead end.' : 'A lamp here leads to a dead end.';
    }
    return { text };
  }

  private apply(next: EmitState | null): void {
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 300) this.history.shift();
    this.changed(this.state, next);
    this.state = next;
  }

  /** Starts the light running out from new lamps and fading from lamps taken away. */
  private changed(before: EmitState, after: EmitState): void {
    if (this.reduced) return;
    const now = performance.now();
    for (let c = 0; c < after.marks.length; c++) {
      const was = before.marks[c] === LAMP, is = after.marks[c] === LAMP;
      if (is && !was) { this.placed.set(c, now); this.gone.delete(c); }
      if (was && !is) { this.placed.delete(c); this.gone.set(c, now); }
    }
    if (solved(after) && !solved(before)) this.wonAt = now + STEP * after.size;
  }

  restart(): void {
    this.state = cloneEmit(this.initial);
    this.history = [];
    this.press = null;
    this.placed.clear();
    this.gone.clear();
  }

  canUndo(): boolean { return this.history.length > 0 && !this.press; }

  undo(): boolean {
    if (this.press) return false;
    const prev = this.history.pop();
    if (!prev) return false;
    this.changed(this.state, prev);
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
    if (cell < 0 || this.state.walls[cell] !== OPEN) return;
    this.press = { cell, at: p, mode: 'tap', cells: [cell], before: this.state };
  }

  move(p: Point): void {
    const pr = this.press;
    if (!pr) return;
    const cell = this.cellAt(p);
    if (pr.mode === 'tap') {
      if (cell === pr.cell || cell < 0) return;
      // Off the first cell: a drag that crosses cells, or clears crosses when it began on one.
      const m = pr.before.marks[pr.cell];
      pr.mode = m === NONE ? 'cross' : m === CROSS ? 'clear' : 'none';
    }
    if (pr.mode === 'none' || cell < 0 || pr.cells.includes(cell)) return;
    // Walk the cells between, so a fast drag along a row misses none.
    const n = this.state.size;
    const last = pr.cells[pr.cells.length - 1];
    const lx = last % n, ly = Math.floor(last / n), cx = cell % n, cy = Math.floor(cell / n);
    const steps = Math.max(Math.abs(cx - lx), Math.abs(cy - ly));
    for (let k = 1; k <= steps; k++) {
      const x = Math.round(lx + ((cx - lx) * k) / steps), y = Math.round(ly + ((cy - ly) * k) / steps);
      const c = y * n + x;
      if (!pr.cells.includes(c)) pr.cells.push(c);
    }
    const from = pr.mode === 'cross' ? NONE : CROSS;
    const to = pr.mode === 'cross' ? CROSS : NONE;
    const cells = pr.cells.filter((c) => pr.before.walls[c] === OPEN && pr.before.marks[c] === from);
    this.state = setMarks(pr.before, cells, to) ?? pr.before;
  }

  up(p: Point): void {
    const pr = this.press;
    if (!pr) return;
    this.move(p);
    this.press = null;
    if (pr.mode === 'tap') {
      this.state = pr.before;
      if (this.cellAt(p) === pr.cell) this.apply(tap(pr.before, pr.cell));
      return;
    }
    if (this.state === pr.before) return;
    const next = this.state;
    this.state = pr.before;
    this.apply(next);
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
    const fit = fitFramed(area, s.size, s.size, { margin: 8, maxCell: 64 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const g = { x: fit.x, y: fit.y, c };
    // Forget animations long finished.
    for (const [k, t] of this.placed) if (now - t > 4000) this.placed.delete(k);
    for (const [k, t] of this.gone) if (now - t > GONE) this.gone.delete(k);
    const won = this.won && this.wonAt && !this.reduced && now - this.wonAt < 2000 ? Math.max(0, now - this.wonAt) : undefined;
    paintEmit(ctx, s, g, { now, placed: this.placed, gone: this.gone, won });
    const m = this.mark?.state === s && !this.won && !this.press ? this.mark : null;
    if (m) for (const cell of m.cells) {
      const p = centerOf(s, g, cell);
      drawHelpMark(ctx, p.x - c * 0.45, p.y - c * 0.45, c * 0.9, c * 0.9, now, this.reduced, c * 0.18);
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
 * A picture board from rows of text: '.' an open cell, '#' a plain wall, a digit a numbered wall,
 * '*' a lamp placed as the picture plays (in reading order, one every beat), 'x' a cross set as
 * it plays, '?' a cell flagged amber at the end.
 */
function picture(rows: string[], caption: string): Illustration {
  const n = rows.length;
  const walls: number[] = [];
  const steps: { cell: number; mark: number }[] = [];
  const flag: number[] = [];
  rows.forEach((line, y) => [...line].forEach((ch, x) => {
    const i = y * n + x;
    walls[i] = ch === '#' ? WALL : /[0-4]/.test(ch) ? Number(ch) : OPEN;
    if (ch === '*') steps.push({ cell: i, mark: LAMP });
    if (ch === 'x') steps.push({ cell: i, mark: CROSS });
    if (ch === '?') flag.push(i);
  }));
  const s0: EmitState = { size: n, walls, marks: walls.map(() => NONE), solution: walls.map(() => false), moves: 0, par: 0, depth: 0, looks: 0 };
  const LEAD = 0.4, BEAT = 0.6, REST = 0.8;
  const raw = LEAD + BEAT * steps.length + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      const s = cloneEmit(s0);
      const placed = new Map<number, number>();
      steps.forEach((st, k) => {
        const at = LEAD + BEAT * k;
        if (t < at) return;
        s.marks[st.cell] = st.mark;
        if (st.mark === LAMP) placed.set(st.cell, at * 1000);
      });
      const settled = t >= LEAD + BEAT * steps.length;
      const fit = fitFramed({ x: 0, y: 0, w, h }, n, n, { margin: 2, maxCell: 999 });
      paintEmit(ctx, s, { x: fit.x, y: fit.y, c: fit.cell }, { now: t * 1000, placed, flag: settled ? flag : undefined });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Lamps',
    text: '**Tap an open cell to place a lamp**. Its light runs along its row and its column until a wall stops it.',
    good: picture(['...', '.*#', '...'], 'Light to the wall'),
  },
  {
    title: 'Light every cell',
    text: 'The board is done when **every open cell is lit**.',
    good: picture(['*..', '.#*', '.##'], 'All lit'),
    bad: picture(['*..', '.#?', '.##'], 'A cell left dark'),
  },
  {
    title: 'No lamp lit',
    text: '**A lamp may not stand in another lamp’s light**. Walls block light, so lamps on either side of one are fine.',
    good: picture(['*#*', '...', '...'], 'A wall between'),
    bad: picture(['*.*', '...', '...'], 'They light each other'),
  },
  {
    title: 'Numbers',
    text: 'A numbered wall has **exactly that many lamps** on the cells beside it, not counting corners.',
    good: picture(['.*.', '*2#', '.#.'], 'Two beside the 2'),
    bad: picture(['.*.', '*1#', '.#.'], 'Too many for the 1'),
  },
  {
    title: 'Crosses',
    text: 'Tap a lamp again for a cross, **your note that no lamp goes there**, and once more to clear it. Drag across cells to cross several.',
    good: picture(['.x.', 'x0x', '.x.'], 'No lamp beside a 0'),
  },
];
