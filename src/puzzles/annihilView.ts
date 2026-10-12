// Drawing and touch for Annihil: tap a piece to pick it up (its landing holes light in cyan),
// then tap one of them; or drag the piece straight onto one. Particles are filled red discs,
// antiparticles blue rings. A jump arcs over its neighbor, which flashes out with two photons.
//
// The board is painted by `paintAnnihil`, which the rule cards' pictures share.

import { allJumps, cloneAnnihil, deadEnd, jump, jumpsFrom, pieceCount, Solver, solved, type AnnihilState, type Jump, type Piece } from './annihil';
import { C, fitGrid } from './palette';
import { drawCellFrame, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Nullis is a reserve game, played from the Puzzles screen. The board grows from a 4 by 4 square with 4 pieces to a 7 by 7 board with notched corners and 15 pieces. Every board is built backward from a single piece by undoing jumps, then solved forward to be sure it clears. Eight boards are built for each deal and ranked by how often random jumping would clear them: the bottom of the dial deals the most forgiving, the top the one with the most dead ends. Par is the jumps it takes, one fewer than the pieces, so finishing is the whole challenge. With no jump left and more than one piece, undo or restart.</p>
`;

/** Matter red and antimatter blue: the approved pair for two opposite states on a board. */
export const MATTER = '#e25a40';
export const ANTI = '#4f8fe8';
/** Milliseconds a jump takes. */
const JUMP = 320;

interface Geo { x: number; y: number; c: number; w: number }

const centerOf = (g: Geo, i: number): Point => ({ x: g.x + ((i % g.w) + 0.5) * g.c, y: g.y + (Math.floor(i / g.w) + 0.5) * g.c });

/** A piece: matter a filled disc, antimatter a thick ring. */
export function paintPiece(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, p: Piece, scale = 1, alpha = 1): void {
  if (!p || scale <= 0.01 || alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const r = c * 0.31 * scale;
  if (p === 1) {
    ctx.fillStyle = MATTER;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const lw = r * 0.42;
    ctx.strokeStyle = ANTI;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(x, y, r - lw / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A jump under way: what moved, the board before, and when. */
export interface Anim { j: Jump; piece: Piece; gone: Piece; at: number }

interface Paint {
  anim: Anim | null;
  now: number;
  motion: boolean;
  /** The picked-up piece, its landing holes, and where a drag holds it (if it does). */
  sel?: { cell: number; targets: number[]; at?: Point };
  /** A refused move in the rule pictures: the piece nudges toward `to` and back. */
  nudge?: { from: number; to: number; k: number };
  /** Cells flagged amber (rule pictures). */
  flag?: number[];
}

/** Paints the board: its frame, the holes, the pieces, and a jump under way with its
 *  annihilation flash. Returns true while something moves. */
export function paintAnnihil(ctx: CanvasRenderingContext2D, s: AnnihilState, g: Geo, o: Paint): boolean {
  const { c } = g;
  const holes: { x: number; y: number }[] = [];
  s.mask.forEach((m, i) => { if (m) holes.push({ x: i % s.w, y: Math.floor(i / s.w) }); });
  drawCellFrame(ctx, holes, g.x, g.y, c, C.frame);
  // Holes: a faint well in every cell of the board.
  ctx.fillStyle = C.surface2;
  for (let i = 0; i < s.cells.length; i++) {
    if (!s.mask[i]) continue;
    const p = centerOf(g, i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, c * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const a = o.anim;
  const ms = a && o.motion ? o.now - a.at : Infinity;
  const moving = ms < JUMP;
  const sel = moving ? undefined : o.sel;
  if (sel) {
    // The picked piece sits on a soft cyan plate; its landing holes are lit cyan.
    const p = centerOf(g, sel.cell);
    ctx.fillStyle = 'rgba(111, 208, 230, 0.24)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, c * 0.45, 0, Math.PI * 2);
    ctx.fill();
    for (const t of sel.targets) {
      const q = centerOf(g, t);
      ctx.fillStyle = 'rgba(111, 208, 230, 0.22)';
      ctx.beginPath();
      ctx.arc(q.x, q.y, c * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.arc(q.x, q.y, c * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let i = 0; i < s.cells.length; i++) {
    const p = s.cells[i];
    if (!p) continue;
    if (moving && a && i === a.j.to) continue;
    if (sel && i === sel.cell) continue;
    if (o.nudge && i === o.nudge.from) continue;
    const q = centerOf(g, i);
    paintPiece(ctx, q.x, q.y, c, p);
  }
  if (o.nudge) {
    const f = centerOf(g, o.nudge.from), t = centerOf(g, o.nudge.to);
    const k = Math.sin(Math.PI * Math.min(1, Math.max(0, o.nudge.k))) * 0.3;
    paintPiece(ctx, f.x + (t.x - f.x) * k, f.y + (t.y - f.y) * k, c, s.cells[o.nudge.from]);
  }
  if (sel) {
    const p = sel.at ?? centerOf(g, sel.cell);
    paintPiece(ctx, p.x, p.y, c, s.cells[sel.cell], 1.12);
  }
  if (o.flag) {
    ctx.save();
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = Math.max(2, c * 0.07);
    for (const i of o.flag) {
      const q = centerOf(g, i);
      ctx.beginPath();
      ctx.arc(q.x, q.y, c * 0.43, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (!moving || !a) return false;
  const k = ms / JUMP;
  const f = centerOf(g, a.j.from), t = centerOf(g, a.j.to), m = centerOf(g, a.j.over);
  // The piece jumped over: it holds, then flashes out as the jumper passes.
  const hit = 0.45;
  if (k < hit) paintPiece(ctx, m.x, m.y, c, a.gone);
  else {
    const u = (k - hit) / (1 - hit);
    paintPiece(ctx, m.x, m.y, c, a.gone, 1 - u * 0.6, 1 - u);
    ctx.save();
    // The flash: a white disc swelling and fading.
    ctx.globalAlpha = 0.85 * (1 - u);
    ctx.fillStyle = C.silver;
    ctx.beginPath();
    ctx.arc(m.x, m.y, c * (0.12 + 0.3 * ease(u)), 0, Math.PI * 2);
    ctx.fill();
    // Two photons, out each side, square to the jump.
    const dx = (t.y - f.y) / (2 * c), dy = (t.x - f.x) / (2 * c);
    ctx.strokeStyle = C.silver;
    ctx.lineWidth = Math.max(1.5, c * 0.05);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 1 - u;
    ctx.beginPath();
    for (const side of [1, -1]) {
      const r0 = c * (0.15 + 0.4 * ease(u)), r1 = r0 + c * 0.16;
      ctx.moveTo(m.x + dx * side * r0, m.y + dy * side * r0);
      ctx.lineTo(m.x + dx * side * r1, m.y + dy * side * r1);
    }
    ctx.stroke();
    ctx.restore();
  }
  // The jumper: along the line, lifted at the middle.
  const e = ease(k);
  const lift = Math.sin(Math.PI * Math.min(1, k)) * 0.14;
  paintPiece(ctx, f.x + (t.x - f.x) * e, f.y + (t.y - f.y) * e, c, a.piece, 1 + lift);
  return true;
}

export class AnnihilView implements PuzzleView {
  private state: AnnihilState;
  private history: AnnihilState[] = [];
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private anim: Anim | null = null;
  private busy = false;
  private sel: number | null = null;
  /** A press on the board: where, on which cell, and whether it has become a drag. */
  private press: { p: Point; cell: number; at: Point; drag: boolean; wasSel: boolean } | null = null;
  private mark: { state: AnnihilState; cells: number[] } | null = null;
  private readonly solver: Solver;

  constructor(private readonly initial: AnnihilState, reducedMotion: boolean) {
    this.state = cloneAnnihil(initial);
    this.reduced = reducedMotion;
    this.solver = new Solver(initial.w, initial.h, initial.mask);
  }

  get won(): boolean { return solved(this.state) && !this.busy; }
  get stuck(): boolean { return deadEnd(this.state) && !this.busy; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    return { progress: { label: 'Pieces', value: String(pieceCount(this.state)) } };
  }

  hint(): string {
    const s = this.state;
    if (solved(s)) return 'One piece left';
    if (deadEnd(s)) return 'No jump left: undo or restart';
    const n = pieceCount(s);
    return `${n} pieces left`;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (solved(s)) return null;
    if (!this.solver.canClear(s.cells)) {
      const h = this.history;
      for (let n = 1; n <= h.length; n++) if (this.solver.canClear(h[h.length - n].cells)) return undoHelp(n);
      return { text: 'Restart to get back on track.' };
    }
    let next: Jump | null = null;
    for (const m of allJumps(s)) if (this.solver.canClear(jump(s, m.from, m.to)!.cells)) { next = m; break; }
    if (!next) return null;
    if (level === 2) {
      this.go(next.from, next.to);
      return { text: 'Jumped, and one more piece is gone.', moved: true };
    }
    this.mark = { state: s, cells: [next.from, next.over, next.to] };
    return { text: s.cells[next.from] === 1 ? 'This particle can jump next.' : 'This antiparticle can jump next.' };
  }

  private go(from: number, to: number): boolean {
    const before = this.state;
    const next = jump(before, from, to);
    if (!next) return false;
    this.history.push(before);
    if (this.history.length > 100) this.history.shift();
    this.anim = { j: next.last!, piece: before.cells[from], gone: before.cells[next.last!.over], at: performance.now() };
    this.busy = !this.reduced;
    this.state = next;
    this.sel = null;
    return true;
  }

  restart(): void {
    this.state = cloneAnnihil(this.initial);
    this.history = [];
    this.anim = null;
    this.busy = false;
    this.sel = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.anim = null;
    this.busy = false;
    this.sel = null;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  private cellAt(p: Point): number {
    if (!this.cell) return -1;
    const { w, h } = this.state;
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return -1;
    const i = cy * w + cx;
    return this.state.mask[i] ? i : -1;
  }

  private targets(cell: number): number[] {
    return jumpsFrom(this.state, cell).map((j) => j.to);
  }

  down(p: Point): void {
    if (solved(this.state)) return;
    const cell = this.cellAt(p);
    const wasSel = this.sel === cell;
    // Pressing a piece picks it up at once, so its landing holes show while it is held.
    if (cell >= 0 && this.state.cells[cell]) this.sel = cell;
    this.press = { p, cell, at: p, drag: false, wasSel };
  }

  move(p: Point): void {
    const pr = this.press;
    if (!pr) return;
    pr.at = p;
    if (!pr.drag && pr.cell >= 0 && this.state.cells[pr.cell] && Math.hypot(p.x - pr.p.x, p.y - pr.p.y) > this.cell * 0.3) pr.drag = true;
  }

  up(p: Point): void {
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    const cell = this.cellAt(p);
    if (pr.drag) {
      // A drag lands where it is let go, if that is one of its holes; else the piece goes back.
      if (cell >= 0 && this.targets(pr.cell).includes(cell)) this.go(pr.cell, cell);
      return;
    }
    if (cell < 0) { this.sel = null; return; }
    if (this.state.cells[cell]) {
      // Tapping the picked piece again puts it down.
      if (pr.wasSel) this.sel = null;
      return;
    }
    const from = this.sel;
    if (from !== null && this.targets(from).includes(cell)) this.go(from, cell);
    else this.sel = null;
  }

  cancel(): void {
    if (this.press?.drag) this.sel = null;
    this.press = null;
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const fit = fitFramed(area, s.w, s.h, { margin: 8, maxCell: 76 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const g: Geo = { x: fit.x, y: fit.y, c, w: s.w };
    const sel = this.sel !== null && s.cells[this.sel]
      ? { cell: this.sel, targets: this.targets(this.sel), at: this.press?.drag ? this.press.at : undefined }
      : undefined;
    const moving = paintAnnihil(ctx, s, g, { anim: this.anim, now, motion: !this.reduced, sel });
    if (!moving) this.busy = false;
    const m = this.mark?.state === s && !moving && !solved(s) ? this.mark : null;
    if (m) {
      const ps = m.cells.map((i) => centerOf(g, i));
      const x0 = Math.min(...ps.map((p) => p.x)) - c * 0.46, y0 = Math.min(...ps.map((p) => p.y)) - c * 0.46;
      const x1 = Math.max(...ps.map((p) => p.x)) + c * 0.46, y1 = Math.max(...ps.map((p) => p.y)) + c * 0.46;
      drawHelpMark(ctx, x0, y0, x1 - x0, y1 - y0, now, this.reduced, c * 0.46);
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

/** A small picture board from rows of text: '#' no hole, '.' an empty hole, 'm' a particle,
 *  'a' an antiparticle. */
function board(rows: string[]): AnnihilState {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const mask: boolean[] = [], cells: Piece[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x] ?? '#';
    mask.push(ch !== '#');
    cells.push(ch === 'm' ? 1 : ch === 'a' ? 2 : 0);
  }
  return { w, h, mask, cells, moves: 0, par: 0, last: null };
}

const LEAD = 0.5;
const BEAT = 0.75;
const REST = 0.6;

/** One rule picture: the moves ([x, y] to [x, y]) tried one after another. A legal one jumps;
 *  any other nudges toward its target and back. A `bad` picture ends with the refused piece,
 *  or the pieces left stranded, flagged in amber. */
function picture(rows: string[], tries: [[number, number], [number, number]][], caption: string, bad = false): Illustration {
  const s0 = board(rows);
  const steps: { before: AnnihilState; after: AnnihilState; at: number; from: number; to: number; ok: boolean }[] = [];
  let cur = s0;
  let clock = LEAD;
  for (const [[fx, fy], [tx, ty]] of tries) {
    const from = fy * s0.w + fx, to = ty * s0.w + tx;
    const next = jump(cur, from, to);
    steps.push({ before: cur, after: next ?? cur, at: clock, from, to, ok: !!next });
    if (next) cur = next;
    clock += BEAT;
  }
  const raw = clock + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  const last = steps[steps.length - 1];
  const flagAtEnd = !bad ? undefined : last && !last.ok ? [last.from] : cur.cells.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const u = t * pace;
      let st = s0;
      let anim: Anim | null = null;
      let nudge: Paint['nudge'];
      let sel: Paint['sel'];
      for (const sp of steps) {
        // A beat before each try, the piece is picked up and its holes light.
        if (u >= sp.at - 0.3 && u < sp.at) sel = { cell: sp.from, targets: jumpsFrom(sp.before, sp.from).map((j) => j.to) };
        if (u < sp.at) break;
        st = sp.after;
        sel = undefined;
        if (sp.ok) anim = { j: sp.after.last!, piece: sp.before.cells[sp.from], gone: sp.before.cells[sp.after.last!.over], at: sp.at * 1000 };
        else if (u < sp.at + 0.5) nudge = { from: sp.from, to: sp.to, k: (u - sp.at) / 0.5 };
      }
      const fit = fitFramed({ x: 0, y: 0, w, h }, s0.w, s0.h, { margin: 2, maxCell: 999 });
      paintAnnihil(ctx, st, { x: fit.x, y: fit.y, c: fit.cell, w: s0.w }, { anim, now: u * 1000, motion: true, sel, nudge, flag: u >= clock ? flagAtEnd : undefined });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Jump',
    text: 'Tap a piece, then a lit hole, or drag it there. It jumps its neighbor, which is annihilated.',
    good: picture(['#..#', '.ma.', '#..#'], [[[1, 1], [3, 1]]], 'Jumped and gone'),
  },
  {
    title: 'Opposites',
    text: 'Particles, the red discs, jump only antiparticles, the blue rings, and the other way round. Like never jumps like.',
    good: picture(['#..#', '.am.', '#..#'], [[[1, 1], [3, 1]]], 'Ring over disc'),
    bad: picture(['#..#', '.mm.', '#..#'], [[[1, 1], [3, 1]]], 'Like over like', true),
  },
  {
    title: 'Straight lines',
    text: 'A jump goes along a row or a column, over the very next piece, into the empty hole just beyond.',
    good: picture(['.m.', '.a.', '...'], [[[1, 0], [1, 2]]], 'Down a column'),
    bad: picture(['m..', '.a.', '...'], [[[0, 0], [2, 2]]], 'No diagonals', true),
  },
  {
    title: 'One left',
    text: 'Clear the board down to a single piece. Plan ahead: a piece left with nothing to jump is stranded.',
    good: picture(['ma.a.'], [[[0, 0], [2, 0]], [[2, 0], [4, 0]]], 'Two jumps, one left'),
    bad: picture(['mama.'], [[[2, 0], [4, 0]], [[0, 0], [2, 0]]], 'Two left, stranded', true),
  },
];
