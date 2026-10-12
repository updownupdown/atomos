// Drawing and touch for Blocks: drag from one corner to the other to draw a rectangle, tap one
// to remove it. A rectangle that keeps the rules takes the color of the subshell its size would
// fill (up to 2 cells s, up to 6 p, up to 10 d, up to 14 f); one that breaks a rule turns gray
// with an amber outline. While dragging, rectangles the new one would replace show amber too.
//
// The board is painted by `paintBlocks`, which the rule cards' pictures share.

import {
  cellsOf, cloneBlocks, covered, drawRect, firstWrong, flawed, flawOf, knowledgeOf, nextStep, applyStep,
  overlaps, removeAt, sameRect, solved, spanning, type BlocksState, type Clue, type Rect, type Step,
} from './blocks';
import { C, fitGrid, font, shade } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, SUBSHELL_COLORS, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Blocks is a reserve game, played from the Practice screen. The grid grows with the dial from 5 by 5 (Very easy) to 10 by 10 at the top of Expert, and the largest rectangle from 5 cells to 14. Every board has exactly one answer, checked by a solver, and a step-by-step solver that works the way a person does reaches it without guessing. Each deal is picked from several by how many harder steps it takes: easy dials keep boards where each number fits one way as you go; hard dials keep ones where you must see which number alone can reach a cell, or which way would box another in. Par is one rectangle per number; tapping one away is free, but every rectangle drawn counts.</p>
`;

/** The subshell a rectangle's size would fill, and its color. */
export function subshellOf(area: number): 's' | 'p' | 'd' | 'f' {
  return area <= 2 ? 's' : area <= 6 ? 'p' : area <= 10 ? 'd' : 'f';
}

/** A rectangle's fill: its subshell's color, darkened so the white numbers stay clear, and a
 *  touch lighter for the larger sizes within each. */
export function fillOf(area: number): string {
  const sub = subshellOf(area);
  const lo = { s: 1, p: 3, d: 7, f: 11 }[sub], hi = { s: 2, p: 6, d: 10, f: 14 }[sub];
  const t = hi > lo ? (Math.min(area, hi) - lo) / (hi - lo) : 0;
  return shade(SUBSHELL_COLORS[sub], -0.42 + 0.1 * t);
}

interface Geo { x: number; y: number; c: number }

interface Paint {
  /** The rectangle being dragged out, if any. */
  preview?: Rect | null;
  /** When each rectangle was drawn (ms), keyed by its spot, and the clock. */
  pops?: Map<string, number>;
  now?: number;
  /** Rectangles just removed, fading out: [rect, when]. */
  ghosts?: [Rect, number][];
  /** Milliseconds since the board was won, or null. */
  wonFor?: number | null;
  /** Show the drag's size beside it (the board; the small rule pictures leave it out). */
  label?: boolean;
}

const POP = 180;
const FADE = 220;
const key = (r: Rect) => `${r.x},${r.y},${r.w},${r.h}`;

const cellBox = (g: Geo, r: Rect, inset: number) => ({ x: g.x + r.x * g.c + inset, y: g.y + r.y * g.c + inset, w: r.w * g.c - 2 * inset, h: r.h * g.c - 2 * inset });

/** Paints the board: frame, empty-cell dots, rectangles, the drag, and the numbers on top. */
export function paintBlocks(ctx: CanvasRenderingContext2D, s: BlocksState, g: Geo, o: Paint = {}): void {
  const n = s.size, c = g.c;
  drawFrame(ctx, frameBox(g.x, g.y, n * c, n * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  const now = o.now ?? 0;
  // Faint dots in the cells no rectangle covers yet.
  const taken = new Uint8Array(n * n);
  for (const r of s.rects) for (const i of cellsOf(r, n)) taken[i] = 1;
  ctx.fillStyle = C.surface3;
  const dot = Math.max(1.5, c * 0.035);
  for (let i = 0; i < n * n; i++) {
    if (taken[i] || s.clues.some((q) => q.cell === i)) continue;
    ctx.beginPath();
    ctx.arc(g.x + ((i % n) + 0.5) * c, g.y + (Math.floor(i / n) + 0.5) * c, dot, 0, Math.PI * 2);
    ctx.fill();
  }
  const inset = Math.max(2, c * 0.07);
  const rad = c * 0.16;
  for (const [r, at] of o.ghosts ?? []) {
    const k = 1 - Math.min(1, (now - at) / FADE);
    if (k <= 0) continue;
    const b = cellBox(g, r, inset);
    ctx.save();
    ctx.globalAlpha = 0.6 * k;
    ctx.fillStyle = C.surface3;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, rad);
    ctx.fill();
    ctx.restore();
  }
  const doomed = o.preview ? s.rects.filter((r) => overlaps(r, o.preview!)) : [];
  for (const r of s.rects) {
    const at = o.pops?.get(key(r));
    const k = at === undefined ? 1 : ease((now - at) / POP);
    const grow = (1 - k) * c * 0.12;
    const b = cellBox(g, r, inset + grow);
    if (b.w <= 0 || b.h <= 0) continue;
    const bad = flawOf(s, r) !== null;
    const replaced = doomed.includes(r);
    ctx.save();
    ctx.globalAlpha = (0.4 + 0.6 * k) * (replaced ? 0.55 : 1);
    ctx.fillStyle = bad ? C.surface3 : fillOf(r.w * r.h);
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, rad);
    ctx.fill();
    // Once won, a light sweeps across the rectangles, corner to corner.
    if (o.wonFor != null && !bad) {
      const lit = Math.max(0, Math.min(1, (o.wonFor - (r.x + r.y) * 45) / 240));
      const fade = o.wonFor > 1e5 ? 0 : Math.max(0, 1 - (o.wonFor - (r.x + r.y) * 45 - 240) / 600);
      const a = lit * Math.min(1, fade) * 0.35;
      if (a > 0) {
        ctx.globalAlpha = a;
        ctx.fillStyle = C.good;
        ctx.fill();
      }
    }
    ctx.restore();
    if (bad || replaced) {
      ctx.save();
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = Math.max(2.5, c * 0.07);
      ctx.beginPath();
      ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, rad);
      ctx.stroke();
      ctx.restore();
    }
  }
  const pv = o.preview;
  if (pv) {
    const b = cellBox(g, pv, inset);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = C.accent;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, rad);
    ctx.fill();
    ctx.restore();
  }
  // The numbers, over everything.
  const px = Math.max(13, Math.min(30, c * 0.44));
  ctx.save();
  ctx.font = font(px, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.text;
  for (const q of s.clues) {
    const x = g.x + ((q.cell % n) + 0.5) * c, y = g.y + (Math.floor(q.cell / n) + 0.5) * c;
    ctx.fillText(String(q.area), x, y + px * 0.04);
  }
  ctx.restore();
  // The size being dragged, above the drag.
  if (pv && o.label !== false) {
    const label = `${pv.w} × ${pv.h}`;
    const fs = Math.max(13, Math.min(18, c * 0.34));
    ctx.save();
    ctx.font = font(fs, 600);
    const tw = Math.max(fs * 2.6, label.length * fs * 0.55);
    const b = cellBox(g, pv, inset);
    const cx = Math.min(g.x + n * c - tw / 2 - 2, Math.max(g.x + tw / 2 + 2, b.x + b.w / 2));
    const above = b.y - fs * 0.9 - 4 >= g.y;
    const cy = above ? b.y - fs * 0.9 : b.y + b.h + fs * 0.9;
    ctx.fillStyle = C.surface2;
    ctx.beginPath();
    ctx.roundRect(cx - tw / 2, cy - fs * 0.75, tw, fs * 1.5, fs * 0.5);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + fs * 0.04);
    ctx.restore();
  }
}

export class BlocksView implements PuzzleView {
  private state: BlocksState;
  private history: BlocksState[] = [];
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private mark: { state: BlocksState; boxes: Rect[] } | null = null;
  private pops = new Map<string, number>();
  private ghosts: [Rect, number][] = [];
  private wonAt: number | null = null;
  private drag: { start: number; end: number } | null = null;

  constructor(private readonly initial: BlocksState, reducedMotion: boolean) {
    this.state = cloneBlocks(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    const ok = s.rects.filter((r) => flawOf(s, r) === null).length;
    return { progress: { label: 'Boxed', value: `${ok}/${s.clues.length}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'Every number boxed';
    const bad = flawed(s).length;
    if (bad) return bad === 1 ? '1 rectangle breaks a rule' : `${bad} rectangles break a rule`;
    const left = s.size * s.size - covered(s);
    return left === 1 ? '1 cell left' : `${left} cells left`;
  }

  private why(st: Step): string {
    const a = this.state.clues[st.clue].area;
    switch (st.kind) {
      case 'one-way': return `The marked ${a} fits only one way.`;
      case 'only-cover': return 'Only one rectangle can cover the marked cell.';
      case 'reach': return `Only the marked ${a} can reach the marked empty cell, so it must cover it.`;
      case 'core': return `Every way the marked ${a} fits covers the marked cell, so no other rectangle can.`;
      case 'room': return `One way the marked ${a} could fit would leave another number or cell no room.`;
    }
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    if (wrong >= 0) {
      const r = s.rects[wrong];
      if (level === 2) {
        this.apply(removeAt(s, r.y * s.size + r.x));
        return { text: 'Removed a rectangle that is not part of the answer.', moved: true };
      }
      this.mark = { state: s, boxes: [r] };
      const f = flawOf(s, r);
      return {
        text: f === 'none' ? 'This rectangle holds no number.'
          : f === 'many' ? 'This rectangle holds more than one number.'
          : f === 'area' ? "This rectangle's area does not match its number."
          : 'This rectangle is not part of the answer.',
      };
    }
    // Walk the solver on from what is right so far, to the next rectangle it can place.
    const kn = knowledgeOf(s);
    let first: Step | null = null;
    let placed: Step | null = null;
    for (let guard = 0; guard < 500 && !placed; guard++) {
      const st = nextStep(kn);
      if (!st) break;
      first ??= st;
      if (st.place) placed = st;
      else applyStep(kn, st);
    }
    const k = placed ? placed.clue : s.solution.findIndex((r) => !s.rects.some((q) => sameRect(q, r)));
    if (k < 0) return null;
    const target = s.solution[k];
    if (level === 2) {
      this.apply(drawRect(s, target));
      const a = s.clues[k].area;
      const why = first?.kind === 'one-way' ? ': it fits only one way' : first?.kind === 'only-cover' ? ': nothing else could cover one of its cells' : '';
      return { text: `Drew the ${a}${why}.`, moved: true };
    }
    const st = first ?? placed;
    const clueBox = (q: Clue): Rect => ({ x: q.cell % s.size, y: Math.floor(q.cell / s.size), w: 1, h: 1 });
    if (!st) {
      this.mark = { state: s, boxes: [clueBox(s.clues[k])] };
      return { text: `Box in the marked ${s.clues[k].area} next.` };
    }
    const boxes = [clueBox(s.clues[st.clue])];
    if (st.cell >= 0 && st.cell !== s.clues[st.clue].cell) boxes.push({ x: st.cell % s.size, y: Math.floor(st.cell / s.size), w: 1, h: 1 });
    this.mark = { state: s, boxes };
    return { text: this.why(st) };
  }

  /** Takes a new board: new rectangles pop in, removed ones fade out. */
  private apply(next: BlocksState | null): void {
    if (!next) return;
    const now = performance.now();
    for (const r of next.rects) if (!this.state.rects.some((q) => sameRect(q, r))) this.pops.set(key(r), now);
    for (const r of this.state.rects) if (!next.rects.some((q) => sameRect(q, r))) this.ghosts.push([r, now]);
    this.history.push(this.state);
    if (this.history.length > 300) this.history.shift();
    this.state = next;
  }

  restart(): void {
    this.state = cloneBlocks(this.initial);
    this.history = [];
    this.drag = null;
    this.pops.clear();
    this.ghosts = [];
  }

  canUndo(): boolean { return this.history.length > 0 && !this.drag; }

  undo(): boolean {
    if (this.drag) return false;
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.pops.clear();
    this.ghosts = [];
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  /** The cell under a point, clamped onto the board when `clamp` is set. */
  private cellAt(p: Point, clamp = false): number {
    if (!this.cell) return -1;
    const n = this.state.size;
    let cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (clamp) { cx = Math.max(0, Math.min(n - 1, cx)); cy = Math.max(0, Math.min(n - 1, cy)); }
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return -1;
    return cy * n + cx;
  }

  down(p: Point): void {
    if (this.won) return;
    const start = this.cellAt(p);
    if (start < 0) return;
    this.drag = { start, end: start };
  }

  move(p: Point): void {
    if (!this.drag) return;
    const end = this.cellAt(p, true);
    if (end >= 0) this.drag.end = end;
  }

  up(p: Point): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const end = this.cellAt(p, true);
    if (end >= 0) d.end = end;
    const s = this.state;
    if (d.end === d.start) {
      this.apply(removeAt(s, d.start));
      return;
    }
    this.apply(drawRect(s, spanning(s.size, d.start, d.end)));
  }

  cancel(): void { this.drag = null; }

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
    this.ghosts = this.ghosts.filter(([, at]) => now - at < FADE);
    const d = this.drag;
    paintBlocks(ctx, s, g, {
      preview: d && d.end !== d.start ? spanning(n, d.start, d.end) : null,
      pops: motion ? this.pops : undefined,
      ghosts: motion ? this.ghosts : [],
      now,
      wonFor: won ? (motion ? now - this.wonAt! : 1e6) : null,
    });
    const m = this.mark?.state === s && !won && !d ? this.mark : null;
    if (m) for (const r of m.boxes) {
      const b = cellBox(g, r, Math.max(2, c * 0.06));
      drawHelpMark(ctx, b.x, b.y, b.w, b.h, now, this.reduced, c * 0.16);
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
 * The picture board, 4 by 4, and its answer:
 *   A A B B      A 2, B 4, C 3, D 2, E 2, F 3
 *   C D B B
 *   C D E E
 *   C F F F
 */
const PIC_CLUES: Clue[] = [
  { cell: 0, area: 2 }, { cell: 7, area: 4 }, { cell: 5, area: 2 }, { cell: 8, area: 3 }, { cell: 11, area: 2 }, { cell: 14, area: 3 },
];
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const PIC_ANSWER: Rect[] = [R(0, 0, 2, 1), R(2, 0, 2, 2), R(1, 1, 1, 2), R(0, 1, 1, 3), R(2, 2, 2, 1), R(1, 3, 3, 1)];

/** A drag in a picture: from cell a to cell b, starting at t (s), taking 0.5 s, then drawn. */
interface Stroke { t: number; a: [number, number]; b: [number, number] }

function picture(strokes: Stroke[], caption: string, opts: { settle?: number; duration?: number } = {}): Illustration {
  const n = 4;
  const DRAG = 0.5;
  return {
    caption,
    duration: opts.duration ?? Math.min(4, Math.max(1.6, strokes[strokes.length - 1].t + DRAG + 0.7)),
    draw: (ctx, w, h, t) => {
      let s: BlocksState = { size: n, clues: PIC_CLUES, rects: [], solution: PIC_ANSWER, moves: 0, par: 6, score: 0 };
      const pops = new Map<string, number>();
      let preview: Rect | null = null;
      for (const st of strokes) {
        if (t < st.t) break;
        const [ax, ay] = st.a, [bx, by] = st.b;
        const k = Math.min(1, (t - st.t) / DRAG);
        if (k < 1) {
          // The finger moves from a toward b; the rectangle follows cell by cell.
          const cx = Math.round(ax + (bx - ax) * ease(k)), cy = Math.round(ay + (by - ay) * ease(k));
          preview = spanning(n, ay * n + ax, cy * n + cx);
          if (preview.w * preview.h < 2) preview = null;
          break;
        }
        const r = spanning(n, ay * n + ax, by * n + bx);
        s = drawRect(s, r) ?? s;
        pops.set(key(r), (st.t + DRAG) * 1000);
      }
      const fit = fitFramed({ x: 0, y: 0, w, h }, n, n, { margin: 2, maxCell: 999 });
      paintBlocks(ctx, s, { x: fit.x, y: fit.y, c: fit.cell }, { preview, pops, now: t * 1000, label: false });
    },
  };
}

const ALL: Stroke[] = PIC_ANSWER.map((r, k) => ({ t: 0.3 + 0.45 * k, a: [r.x, r.y], b: [r.x + r.w - 1, r.y + r.h - 1] }));

export const RULES: RuleCard[] = [
  {
    title: 'Rectangles',
    text: 'Drag from one corner to the opposite one to draw a rectangle. Tap a rectangle to remove it.',
    good: picture([{ t: 0.4, a: [2, 0], b: [3, 1] }], 'Corner to corner', { duration: 2 }),
  },
  {
    title: 'One number',
    text: 'Each rectangle holds exactly one number.',
    good: picture([{ t: 0.4, a: [0, 1], b: [0, 3] }], 'One number', { duration: 2 }),
    bad: picture([{ t: 0.4, a: [0, 1], b: [1, 2] }], 'Two numbers', { duration: 2 }),
  },
  {
    title: 'Area',
    text: 'The number is the area of its rectangle: how many cells it covers.',
    good: picture([{ t: 0.4, a: [2, 0], b: [3, 1] }], 'Four cells for a 4', { duration: 2 }),
    bad: picture([{ t: 0.4, a: [2, 1], b: [3, 1] }], 'Two cells for a 4', { duration: 2 }),
  },
  {
    title: 'Fill the grid',
    text: 'Cover every cell with no gaps. A new rectangle replaces any it overlaps.',
    good: picture(ALL, 'Every cell covered', { duration: 3.9 }),
  },
  {
    title: 'Colors',
    text: 'Rectangles take the color of the subshell their size would fill: s holds 2, p 6, d 10 and f 14.',
    good: picture([{ t: 0.3, a: [0, 0], b: [1, 0] }, { t: 0.9, a: [2, 0], b: [3, 1] }], 'Sized like subshells', { duration: 2.2 }),
  },
];
