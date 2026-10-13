// Drawing and touch for Dipole: tap a domino to make it a magnet with + at the tapped end, again
// to turn it round, again to mark it blank, and once more to clear it. A magnet's + half is red
// and its − half blue, each with its sign; a blank is plain gray. The numbers round the board
// count the + poles (top and left, red) and − poles (bottom and right, blue) in each column and
// row; a number met turns gray, one gone past turns amber, and like poles touching are outlined
// in amber.
//
// The board is painted by `paintDipole`, which the rule cards' pictures share.

import { cellPole, clashes, cloneDipole, counts, firstWrong, lineState, nextForced, poleAt, put, solved, tap, type Clues, type DipoleState, type LineState, type Setting } from './dipole';
import { C, fitGrid, font, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<section class="how-specs"><h3>Specs</h3><ul>
<li><b>Flawless:</b> Meet every number in par moves or fewer, where a move is a tap that leaves a domino a magnet, either way round, and par is one per magnet you place (marking blanks is free), and without Show me.</li>
<li><b>Board:</b> The board grows from 5 by 6 cells on the easiest setting through 6 by 6, 7 by 8 and 8 by 8 to 10 by 10 at Expert. About a quarter to a third of the dominoes are blank, a touch more on bigger boards.</li>
<li><b>Numbers:</b> The first few boards deal a few magnets in place. From Easy on, some of the edge numbers are left out, up to about two in five at Expert.</li>
<li><b>Built:</b> Every board has exactly one answer, and the generator checks that it can be reached by deduction alone, with no guessing.</li>
<li><b>Difficulty:</b> The easiest boards are settled directly by the numbers and neighbors; the hardest need a few steps of "what if".</li>
<li><b>Par:</b> One tap per magnet, on its + end. Marking blanks is free, and magnets dealt in place do not count.</li>
<li><b>Where it's played:</b> Dipole is a reserve game, played from the Puzzles screen.</li>
</ul></section>
`;

/** The poles' colors: red +, blue −, like a bar magnet's painted ends. */
export const PLUS = '#e0503a';
export const MINUS = '#4f8fe8';
/** Lighter tints for the numbers, so they read as text on the dark board. */
const PLUS_TEXT = '#f27a66';
const MINUS_TEXT = '#78a8ee';
const BLANK = '#4a5157';
/** The edge bands, in cells. */
const BAND = 0.82;
/** Milliseconds a tap's flourish takes. */
const POP = 520;

export interface Geo { x: number; y: number; c: number; room: number }

interface Paint {
  /** Flag what breaks a rule (clashes, numbers gone past) in amber. */
  flag: boolean;
  /** Recently tapped dominoes, with how far their flourish has gone (0 to 1). */
  pops?: Map<number, number>;
  /** The win's sweep, 0 to 1, or null. */
  sweep?: number | null;
  /** Leave the edge numbers out (a rule picture about one domino). */
  bare?: boolean;
}

/** Fits the board and its number bands into an area. */
export function layout(area: Area, cols: number, rows: number, margin: number, maxCell: number, bands = true): Geo {
  const band = bands ? BAND : 0;
  const W = cols + 2 * band, H = rows + 2 * band;
  const aw = area.w - 2 * margin, ah = area.h - 2 * margin;
  const c0 = Math.max(4, Math.min(aw / W, ah / H));
  const room0 = frameRoom(c0);
  const c = Math.max(4, Math.min((aw - 2 * room0) / W, (ah - 2 * room0) / H, maxCell));
  const room = frameRoom(c);
  const tw = c * W + 2 * room, th = c * H + 2 * room;
  return { c, room, x: area.x + (area.w - tw) / 2 + room + c * band, y: area.y + (area.h - th) / 2 + room + c * band };
}

const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

const centerOf = (s: DipoleState, g: Geo, i: number): Point => ({ x: g.x + ((i % s.cols) + 0.5) * g.c, y: g.y + (Math.floor(i / s.cols) + 0.5) * g.c });

/** A + or − sign, drawn as strokes so it is crisp at any size. */
function sign(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, plus: boolean, color: string, width: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  if (plus) { ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); }
  ctx.stroke();
  ctx.restore();
}

/** One domino at its setting. `k` (0 to 1) is a fresh tap's pop. */
function domino(ctx: CanvasRenderingContext2D, s: DipoleState, g: Geo, d: number, v: Setting, given: boolean, k = 1): void {
  const c = g.c;
  const dm = s.dominoes[d];
  const a = centerOf(s, g, dm.a), b = centerOf(s, g, dm.b);
  const across = a.y === b.y;
  const inset = c * 0.09;
  const grow = 0.9 + 0.1 * ease(k);
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const w = ((across ? 2 * c : c) - 2 * inset) * grow, h = ((across ? c : 2 * c) - 2 * inset) * grow;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const r = c * 0.2;
  if (v === 0) {
    tile(ctx, x0, y0, w, h, r, C.surface2, null);
    // A faint seam where the two halves meet.
    ctx.save();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1, c * 0.03);
    ctx.beginPath();
    if (across) { ctx.moveTo(cx, y0 + h * 0.25); ctx.lineTo(cx, y0 + h * 0.75); } else { ctx.moveTo(x0 + w * 0.25, cy); ctx.lineTo(x0 + w * 0.75, cy); }
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (v === 3) {
    tile(ctx, x0, y0, w, h, r, BLANK, null);
    // A small hollow ring in each half: no pole here.
    ctx.save();
    ctx.strokeStyle = C.silverDim;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1.5, c * 0.05);
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, c * 0.1, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // Two halves, each its pole's color, meeting square in the middle.
    const pa = poleAt(v, 0);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, r);
    ctx.clip();
    ctx.fillStyle = pa === 1 ? PLUS : MINUS;
    if (across) ctx.fillRect(x0, y0, w / 2, h); else ctx.fillRect(x0, y0, w, h / 2);
    ctx.fillStyle = pa === 1 ? MINUS : PLUS;
    if (across) ctx.fillRect(cx, y0, w / 2, h); else ctx.fillRect(x0, cy, w, h / 2);
    ctx.restore();
    const sr = c * 0.17 * grow, sw = Math.max(2, c * 0.075);
    sign(ctx, a.x, a.y, sr, pa === 1, '#ffffff', sw);
    sign(ctx, b.x, b.y, sr, pa !== 1, '#ffffff', sw);
  }
  if (given) {
    // A dealt domino carries a small dark pin where its halves meet.
    ctx.save();
    ctx.fillStyle = C.bg;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, c * 0.075), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** A magnet's field: lines that leave its + end, loop round either side and come back into its
 *  − end, as round a bar magnet. They draw out from the + end and fade as `k` runs 0 to 1. */
function field(ctx: CanvasRenderingContext2D, s: DipoleState, g: Geo, d: number, v: Setting, k: number): void {
  if (v !== 1 && v !== 2) return;
  const dm = s.dominoes[d];
  const a = centerOf(s, g, dm.a), b = centerOf(s, g, dm.b);
  const plus = v === 1 ? a : b, minus = v === 1 ? b : a;
  const c = g.c;
  // The axis, pointing from − to +, and its normal.
  const ux = (plus.x - minus.x) / c, uy = (plus.y - minus.y) / c;
  const nx = -uy, ny = ux;
  const alpha = Math.sin(Math.PI * Math.min(1, k)) * 0.7;
  if (alpha <= 0.01) return;
  const reach = Math.min(1, k * 1.8);
  ctx.save();
  ctx.lineWidth = Math.max(1.5, c * 0.04);
  ctx.lineCap = 'round';
  for (const side of [1, -1]) {
    for (const [wide, out, fade] of [[0.85, 0.5, 1], [1.35, 0.75, 0.55]]) {
      ctx.strokeStyle = `rgba(238, 241, 242, ${alpha * fade})`;
      const p0 = { x: plus.x + ux * c * 0.32, y: plus.y + uy * c * 0.32 };
      const p3 = { x: minus.x - ux * c * 0.32, y: minus.y - uy * c * 0.32 };
      const p1 = { x: p0.x + (ux * out + nx * side * wide) * c, y: p0.y + (uy * out + ny * side * wide) * c };
      const p2 = { x: p3.x + (-ux * out + nx * side * wide) * c, y: p3.y + (-uy * out + ny * side * wide) * c };
      ctx.beginPath();
      const steps = 20;
      for (let i = 0; i <= steps * reach; i++) {
        const t = i / steps, w = 1 - t;
        const px = w * w * w * p0.x + 3 * w * w * t * p1.x + 3 * w * t * t * p2.x + t * t * t * p3.x;
        const py = w * w * w * p0.y + 3 * w * w * t * p1.y + 3 * w * t * t * p2.y + t * t * t * p3.y;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The edge numbers: + counts on top and left, − counts on the bottom and right, with a sign in
 *  the top-left and bottom-right corners to say which is which. */
function numbers(ctx: CanvasRenderingContext2D, s: DipoleState, g: Geo, have: Clues, flag: boolean): void {
  const c = g.c;
  const px = Math.max(13, Math.min(22, c * 0.5));
  const off = g.room + (c * BAND) / 2;
  const top = g.y - off, bottom = g.y + s.rows * c + off, left = g.x - off, right = g.x + s.cols * c + off;
  ctx.save();
  ctx.font = font(px, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const text = (v: number, st: LineState, x: number, y: number, tint: string) => {
    if (v < 0) {
      // A hidden number: a faint dot holds its place.
      ctx.fillStyle = C.text3;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, c * 0.04), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.fillStyle = st === 'over' && flag ? C.warn : st === 'met' ? C.text2 : tint;
    ctx.fillText(String(v), x, y + px * 0.36);
  };
  for (let x = 0; x < s.cols; x++) {
    const cx = g.x + (x + 0.5) * c;
    text(s.clues.colPlus[x], lineState(s.clues.colPlus[x], have.colPlus[x]), cx, top, PLUS_TEXT);
    text(s.clues.colMinus[x], lineState(s.clues.colMinus[x], have.colMinus[x]), cx, bottom, MINUS_TEXT);
  }
  for (let y = 0; y < s.rows; y++) {
    const cy = g.y + (y + 0.5) * c;
    text(s.clues.rowPlus[y], lineState(s.clues.rowPlus[y], have.rowPlus[y]), left, cy, PLUS_TEXT);
    text(s.clues.rowMinus[y], lineState(s.clues.rowMinus[y], have.rowMinus[y]), right, cy, MINUS_TEXT);
  }
  ctx.restore();
  const sr = Math.max(4, c * 0.16), sw = Math.max(2, c * 0.07);
  sign(ctx, left, top, sr, true, PLUS, sw);
  sign(ctx, right, bottom, sr, false, MINUS, sw);
}

/** Paints the frame, every domino, the edge numbers, amber marks on whatever breaks a rule, and
 *  any flourish under way. */
export function paintDipole(ctx: CanvasRenderingContext2D, s: DipoleState, g: Geo, o: Paint): void {
  const c = g.c;
  drawFrame(ctx, frameBox(g.x, g.y, s.cols * c, s.rows * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  for (let d = 0; d < s.dominoes.length; d++) domino(ctx, s, g, d, s.set[d], s.given[d], o.pops?.get(d) ?? 1);
  const have = counts(s);
  if (!o.bare) numbers(ctx, s, g, have, o.flag);
  if (o.flag) {
    for (const cell of clashes(s)) {
      const p = centerOf(s, g, cell);
      tile(ctx, p.x - c * 0.44, p.y - c * 0.44, c * 0.88, c * 0.88, c * 0.18, null, C.warn, Math.max(2.5, c * 0.08));
    }
  }
  if (o.pops) for (const [d, k] of o.pops) field(ctx, s, g, d, s.set[d], k);
  if (o.sweep != null) {
    // The win: each magnet's field blooms in turn, from the top-left corner down.
    const span = s.cols + s.rows;
    s.dominoes.forEach((dm, d) => {
      const at = ((dm.a % s.cols) + Math.floor(dm.a / s.cols)) / span;
      const k = (o.sweep! - at * 0.6) / 0.4;
      if (k > 0 && k < 1) field(ctx, s, g, d, s.set[d], k);
    });
  }
}

export class DipoleView implements PuzzleView {
  private state: DipoleState;
  private history: DipoleState[] = [];
  private pressed: Point | null = null;
  private geo: Geo | null = null;
  private reduced: boolean;
  private mark: { state: DipoleState; domino: number } | null = null;
  /** Fresh taps: domino and when. */
  private pops = new Map<number, number>();
  private wonAt: number | null = null;

  constructor(private readonly initial: DipoleState, reducedMotion: boolean) {
    this.state = cloneDipole(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  /** Shown numbers met, and how many are shown. */
  private met(): [number, number] {
    const s = this.state, have = counts(s);
    let met = 0, shown = 0;
    for (const key of ['rowPlus', 'rowMinus', 'colPlus', 'colMinus'] as const) {
      s.clues[key].forEach((v, i) => { if (v >= 0) { shown++; if (v === have[key][i]) met++; } });
    }
    return [met, shown];
  }

  stats(): { progress: Stat } {
    const [met, shown] = this.met();
    return { progress: { label: 'Met', value: `${met}/${shown}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'Every magnet in place';
    if (clashes(s).size) return 'Like poles are touching';
    const have = counts(s);
    const over = (['rowPlus', 'rowMinus', 'colPlus', 'colMinus'] as const).some((k) => s.clues[k].some((v, i) => v >= 0 && have[k][i] > v));
    if (over) return 'A number has gone past';
    const [met, shown] = this.met();
    return `${met} of ${shown} numbers met`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    if (wrong >= 0) {
      const want = s.solution[wrong], have = s.set[wrong];
      if (level === 2) {
        this.apply(put(s, wrong, want === 3 ? 0 : want), wrong);
        return { text: want === 3 ? 'Cleared it: no magnet goes there.' : have === 3 ? 'A magnet goes there: set it.' : 'Turned that magnet round.', moved: true };
      }
      this.mark = { state: s, domino: wrong };
      return { text: want === 3 ? 'No magnet goes in this domino.' : have === 3 ? 'This domino is a magnet, not a blank.' : 'This magnet is the wrong way round.' };
    }
    const f = nextForced(s);
    if (!f) return null;
    if (level === 2) {
      this.apply(put(s, f.domino, f.setting), f.domino);
      return { text: 'Set that magnet.', moved: true };
    }
    this.mark = { state: s, domino: f.domino };
    return { text: f.why };
  }

  private apply(next: DipoleState | null, d: number): void {
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 300) this.history.shift();
    this.state = next;
    if (!this.reduced) this.pops.set(d, performance.now());
  }

  restart(): void {
    this.state = cloneDipole(this.initial);
    this.history = [];
    this.pops.clear();
    this.wonAt = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.pops.clear();
    this.wonAt = null;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  private cellAt(p: Point): number {
    const g = this.geo;
    if (!g) return -1;
    const s = this.state;
    const cx = Math.floor((p.x - g.x) / g.c), cy = Math.floor((p.y - g.y) / g.c);
    if (cx < 0 || cy < 0 || cx >= s.cols || cy >= s.rows) return -1;
    return cy * s.cols + cx;
  }

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const st = this.pressed;
    this.pressed = null;
    if (!st || this.won) return;
    if (Math.hypot(p.x - st.x, p.y - st.y) > 16) return;
    const cell = this.cellAt(st);
    if (cell < 0) return;
    this.apply(tap(this.state, cell), this.state.owner[cell]);
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const g = layout(area, s.cols, s.rows, 8, 64);
    this.geo = g;
    const pops = new Map<number, number>();
    for (const [d, at] of this.pops) {
      const k = (now - at) / POP;
      if (k >= 1) this.pops.delete(d);
      else pops.set(d, Math.max(0, k));
    }
    let sweep: number | null = null;
    if (this.won && !this.reduced) {
      this.wonAt ??= now;
      const k = (now - this.wonAt) / 1400;
      if (k < 1) sweep = k;
    } else if (!this.won) this.wonAt = null;
    paintDipole(ctx, s, g, { flag: true, pops, sweep });
    const m = this.mark?.state === s && !this.won ? this.mark : null;
    if (m) {
      const dm = s.dominoes[m.domino];
      const a = centerOf(s, g, dm.a), b = centerOf(s, g, dm.b);
      const c = g.c;
      drawHelpMark(ctx, Math.min(a.x, b.x) - c * 0.45, Math.min(a.y, b.y) - c * 0.45, Math.abs(b.x - a.x) + c * 0.9, Math.abs(b.y - a.y) + c * 0.9, now, this.reduced, c * 0.22);
    }
  }
}

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A small picture board. `tiles` lists the dominoes as [x, y, 'h' or 'v'] (across or down from
 * that cell). Its numbers are read off `answer`, except those named in `hide`; it starts empty.
 */
function board(cols: number, rows: number, tiles: [number, number, 'h' | 'v'][], answer: Setting[], hide: string[] = []): DipoleState {
  const owner: number[] = Array(cols * rows).fill(-1);
  const dominoes = tiles.map(([x, y, dir], d) => {
    const a = y * cols + x, b = dir === 'h' ? a + 1 : a + cols;
    owner[a] = d; owner[b] = d;
    return { a, b };
  });
  const s: DipoleState = { cols, rows, dominoes, owner, set: answer.slice(), given: answer.map(() => false), clues: { rowPlus: [], rowMinus: [], colPlus: [], colMinus: [] }, solution: answer.slice(), moves: 0, par: 0 };
  const k = counts(s);
  for (const h of hide) {
    const [key, i] = h.split(':') as [keyof Clues, string];
    k[key][Number(i)] = -1;
  }
  s.clues = k;
  s.set = answer.map(() => 0);
  return s;
}

const LEAD = 0.4;
const BEAT = 0.55;
const REST = 0.7;

/** One rule picture: settings tapped in one per beat, each with its pop and field; rule breaks
 *  show in amber once it has settled. */
function picture(s0: DipoleState, steps: [number, Setting][], caption: string, bare = false): Illustration {
  const raw = LEAD + BEAT * steps.length + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      const s = cloneDipole(s0);
      const pops = new Map<number, number>();
      steps.forEach(([d, v], k) => {
        const at = LEAD + BEAT * k;
        if (t < at) return;
        s.set[d] = v;
        const dt = (t - at) / (POP / 1000);
        if (dt < 1) pops.set(d, dt); else pops.delete(d);
      });
      const g = layout({ x: 0, y: 0, w, h }, s.cols, s.rows, bare ? 10 : 2, bare ? 34 : 999, !bare);
      const settled = t >= LEAD + BEAT * steps.length;
      paintDipole(ctx, s, g, { flag: settled, pops, bare });
    },
  };
}

// A 4 by 2 board of four dominoes across. In answers, 1 is + on the left (or top), 2 is − there
// and 3 a blank.
const ROW2: [number, number, 'h' | 'v'][] = [[0, 0, 'h'], [2, 0, 'h'], [0, 1, 'h'], [2, 1, 'h']];

export const RULES: RuleCard[] = [
  {
    title: 'Magnets',
    text: 'Tap a domino to make it a magnet with **+ at the end you tap**. Tap again to turn it round, again to mark it blank, and once more to clear it.',
    good: picture(board(2, 1, [[0, 0, 'h']], [1]), [[0, 1], [0, 2], [0, 3]], '+ end, turn, blank', true),
  },
  {
    title: 'Numbers',
    text: '**Red numbers count the + poles** in each row and column, blue ones the − poles. A number met turns gray.',
    good: picture(board(4, 2, ROW2, [1, 3, 2, 2]), [[0, 1], [2, 2], [3, 2]], 'Every number met'),
    bad: picture(board(4, 2, ROW2, [1, 3, 2, 2]), [[0, 1], [1, 1], [2, 2], [3, 2]], 'Too many in a row'),
  },
  {
    title: 'Like poles',
    text: 'Two + poles, or two − poles, **never touch across an edge**. Opposites can.',
    good: picture(board(2, 2, [[0, 0, 'v'], [1, 0, 'v']], [1, 2]), [[0, 1], [1, 2]], 'Opposites touch'),
    bad: picture(board(2, 2, [[0, 0, 'v'], [1, 0, 'v']], [1, 2]), [[0, 1], [1, 1]], 'Like poles touch'),
  },
  {
    title: 'Blanks',
    text: 'Some dominoes **hold no magnet at all**. Marking them gray is only a note: the board is done once every number is met.',
    good: picture(board(4, 2, ROW2, [3, 1, 2, 3]), [[1, 1], [2, 2], [0, 3]], 'Blanks are gray'),
  },
];
