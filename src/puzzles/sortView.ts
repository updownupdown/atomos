// Drawing and touch for Sort: tap a vial to lift it, then tap another to pour. The vials are
// round-bottomed glass; each band is a line of one hue with its glyph. A pour runs as a stream of
// light arcing from one mouth to the other while one level falls and the other rises. A vial
// holding a whole line is sealed with a green stopper.
//
// The board is painted by `paintSort`, which the rule cards' pictures share.

import { cloneSort, jammed, plan, pour, pourCount, solved, sortable, vialDone, type Pour, type SortState } from './sort';
import { C, shade, tile } from './palette';
import { glyph, HUES, inkOn } from './hues';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Sort is a reserve game, played from the Practice screen. The easiest boards hold 3 lines of 3 bands with two spare vials, lightly mixed; the lines rise to 9 and the vials to 5 bands, fully mixed, through Hard. The top of Expert keeps 6 or 7 lines of 4 but leaves only one spare vial, so every pour has to be planned. Each deal is checked by a solver that tries pours in order of promise (an A* search) and proves the fewest; that count is par, and a deal is kept only when par is not too low for its level. Undo is free.</p>
`;

/** Milliseconds a pour takes, by bands moved. */
const pourMs = (count: number): number => Math.min(680, 380 + 70 * count);
const LIFT_MS = 140;

// ---- layout ----------------------------------------------------------------------------

export interface Layout {
  /** One band's height. */
  u: number;
  /** Inner width and height of a vial. */
  w: number;
  h: number;
  /** Each vial's mouth, top-left of its glass, at rest. */
  at: Point[];
  /** Each vial's touch box. */
  box: { x: number; y: number; w: number; h: number }[];
  /** The area drawn in, so nothing leaves it. */
  area: Area;
}

const W_U = 1.15; // vial width, in bands
const SLOT_U = 1.95; // slot width per vial
const HEAD_U = 0.55; // room above the top band
const LIFT_U = 0.42; // how far a selected vial lifts
const ROOM_U = 0.85; // room above a vial for the lift and the stopper
const FOOT_U = 0.6; // room below for the selection bar

/** Lays the vials out in one row or two (whichever lets them be bigger), centered. */
export function layoutSort(area: Area, count: number, cap: number, opts: { margin?: number; maxU?: number } = {}): Layout {
  const m = opts.margin ?? 8;
  const rowU = ROOM_U + cap + HEAD_U + FOOT_U;
  let best = { rows: 1, u: 0 };
  for (let rows = 1; rows <= 3; rows++) {
    const cols = Math.ceil(count / rows);
    const u = Math.min((area.w - 2 * m) / (cols * SLOT_U), (area.h - 2 * m) / (rows * rowU), opts.maxU ?? 46);
    // Another row only when it lets the vials grow by a quarter.
    if (u > best.u * 1.25) best = { rows, u };
  }
  const { rows } = best;
  const u = Math.max(4, best.u);
  const cols = Math.ceil(count / rows);
  const w = u * W_U, h = u * (cap + HEAD_U);
  const totalH = rows * rowU * u;
  const y0 = area.y + (area.h - totalH) / 2;
  const at: Point[] = [], box: Layout['box'] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, count - r * cols);
    const k = i - r * cols;
    const slot = SLOT_U * u;
    const x0 = area.x + (area.w - inRow * slot) / 2;
    const top = y0 + r * rowU * u;
    at.push({ x: x0 + k * slot + (slot - w) / 2, y: top + ROOM_U * u });
    box.push({ x: x0 + k * slot, y: top, w: slot, h: rowU * u });
  }
  return { u, w, h, at, box, area };
}

/** The vial under a point, or -1. */
export function vialAt(L: Layout, p: Point): number {
  return L.box.findIndex((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h);
}

// ---- painting --------------------------------------------------------------------------

export interface Paint {
  now: number;
  /** The vial lifted, and since when (for its rise). */
  selected?: { vial: number; at: number } | null;
  /** A pour under way: the board before it, and when it began. */
  anim?: { pour: Pour; before: SortState; at: number } | null;
  /** Vials outlined in amber (rule pictures). */
  flags?: number[];
  /** A vial shaking (a refused pour in the rule pictures). */
  shake?: { vial: number; at: number } | null;
  motion: boolean;
}

function tubePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h - r);
  ctx.arc(x + r, y + h - r, r, Math.PI, 0, true);
  ctx.lineTo(x + w, y);
}

interface Seg { color: number; y0: number; y1: number }

/** A vial's bands as segments in band units from the bottom, with `less` taken off the top and
 *  `more` of `color` poured on, both possibly fractional (a pour under way). */
function segments(v: readonly number[], less: number, more: number, color: number): Seg[] {
  const out: Seg[] = [];
  const top = v.length - less;
  for (let k = 0; k < v.length; k++) {
    const y1 = Math.min(k + 1, top);
    if (y1 > k) out.push({ color: v[k], y0: k, y1 });
  }
  if (more > 0) out.push({ color, y0: v.length, y1: v.length + more });
  return out;
}

/** One vial: glass, then its bands clipped to the glass, then its stopper when sealed. */
function vial(ctx: CanvasRenderingContext2D, L: Layout, x: number, y: number, segs: Seg[], o: { sealed: boolean; flag: boolean; glow: number }): void {
  const { u, w, h } = L;
  const lw = Math.max(2.5, u * 0.1);
  ctx.save();
  tubePath(ctx, x, y, w, h);
  ctx.fillStyle = 'rgba(228, 232, 234, 0.05)';
  ctx.fill();
  // The bands, merged into blocks of one color, with a dark seam where colors change.
  ctx.save();
  tubePath(ctx, x + lw / 2, y, w - lw, h - lw / 2);
  ctx.clip();
  const bottom = y + h - lw / 2;
  const merged: Seg[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.color === s.color && Math.abs(last.y1 - s.y0) < 1e-6) last.y1 = s.y1;
    else merged.push({ ...s });
  }
  for (const s of merged) {
    const col = HUES[s.color % HUES.length].color;
    const yTop = bottom - s.y1 * u, yBot = bottom - s.y0 * u;
    if (o.glow > 0) { ctx.shadowColor = col; ctx.shadowBlur = u * 0.45 * o.glow; }
    ctx.fillStyle = col;
    ctx.fillRect(x, yTop, w, yBot - yTop + 0.5);
    ctx.shadowBlur = 0;
    // The surface: a lighter line along the top of each block.
    ctx.fillStyle = shade(col, 0.4);
    ctx.fillRect(x, yTop, w, Math.max(1.5, u * 0.06));
  }
  for (let k = 1; k < merged.length; k++) {
    ctx.fillStyle = 'rgba(16, 17, 18, 0.55)';
    ctx.fillRect(x, bottom - merged[k].y0 * u - 1, w, 2);
  }
  // A glyph on every band that is mostly in.
  for (const s of segs) {
    if (s.y1 - s.y0 < 0.6) continue;
    const col = HUES[s.color % HUES.length].color;
    glyph(ctx, s.color, x + w / 2, bottom - ((s.y0 + s.y1) / 2) * u, u * 0.24, inkOn(col));
  }
  ctx.restore();
  // The glass: a thick faint outline, open at the top.
  tubePath(ctx, x, y, w, h);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.flag ? C.warn : 'rgba(228, 232, 234, 0.3)';
  ctx.stroke();
  if (o.sealed) tile(ctx, x - lw * 0.2, y - u * 0.34, w + lw * 0.4, u * 0.26, u * 0.1, C.good);
  ctx.restore();
}

/** A point along the stream from one mouth to another: an arc over the top, then a fall to the
 *  surface. s runs 0 to 1. */
function streamPoint(a: Point, apexY: number, b: Point, floor: number, s: number): Point {
  const split = 0.78;
  if (s <= split) {
    const t = s / split;
    const cx = (a.x + b.x) / 2;
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x;
    const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * apexY + t * t * b.y;
    return { x, y };
  }
  const t = (s - split) / (1 - split);
  return { x: b.x, y: b.y + (floor - b.y) * t };
}

/**
 * Paints every vial, the lifted one raised over its cyan mark, and a pour under way as a stream
 * of light. Returns true while something is still moving.
 */
export function paintSort(ctx: CanvasRenderingContext2D, s: SortState, L: Layout, o: Paint): boolean {
  const { u, w, h } = L;
  let moving = false;
  const a = o.anim && o.motion ? o.anim : null;
  const ms = a ? o.now - a.at : 0;
  const dur = a ? pourMs(a.pour.count) : 1;
  if (a && ms >= dur) moving = false;
  const live = a && ms < dur ? a : null;
  if (live) moving = true;
  const base = live ? live.before : s;
  // How much has crossed so far.
  const k = live ? ease(Math.min(1, Math.max(0, (ms - 60) / (dur - 140)))) * live.pour.count : 0;
  const lift = (i: number): number => {
    if (live && live.pour.from === i) return LIFT_U * u * (1 - ease(Math.max(0, (ms - dur + 160) / 160)));
    const sel = o.selected;
    if (!sel || sel.vial !== i) return 0;
    const t = o.motion ? Math.min(1, (o.now - sel.at) / LIFT_MS) : 1;
    if (t < 1) moving = true;
    return LIFT_U * u * ease(t);
  };
  const shakeX = (i: number): number => {
    const sh = o.shake;
    if (!sh || sh.vial !== i || !o.motion) return 0;
    const t = (o.now - sh.at) / 320;
    if (t < 0 || t >= 1) return 0;
    moving = true;
    return Math.sin(t * Math.PI * 6) * u * 0.12 * (1 - t);
  };
  const flags = new Set(o.flags ?? []);
  const mouths: Point[] = [];
  base.vials.forEach((v, i) => {
    const x = L.at[i].x + shakeX(i), y = L.at[i].y - lift(i);
    mouths.push({ x: x + w / 2, y });
    const less = live && live.pour.from === i ? k : 0;
    const more = live && live.pour.to === i ? k : 0;
    const segs = segments(v, less, more, live ? live.pour.color : 0);
    const sealed = !live ? vialDone(s, i) : false;
    const glow = sealed && solved(s) ? 1 : sealed ? 0.5 : 0;
    vial(ctx, L, x, y, segs, { sealed, flag: flags.has(i), glow });
    if (o.selected?.vial === i && !live) {
      const bw = w * 0.62;
      tile(ctx, L.at[i].x + (w - bw) / 2, L.at[i].y + h + u * 0.22, bw, Math.max(3, u * 0.1), u * 0.05, C.accent);
    }
  });
  if (live) {
    const from = mouths[live.pour.from], to = mouths[live.pour.to];
    const lw = Math.max(2.5, u * 0.1);
    const floor = L.at[live.pour.to].y + h - lw / 2 - (base.vials[live.pour.to].length + k) * u;
    const sw = w * 0.3;
    const apexY = Math.max(L.area.y + sw, Math.min(from.y, to.y) - u * 1.1);
    const t = ms / dur;
    const head = Math.min(1, t / 0.3), tail = Math.max(0, (t - 0.7) / 0.3);
    if (head > tail) {
      const col = HUES[live.pour.color % HUES.length].color;
      const pts: Point[] = [];
      for (let q = 0; q <= 24; q++) pts.push(streamPoint(from, apexY, to, Math.max(to.y, floor), tail + ((head - tail) * q) / 24));
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = col;
      ctx.shadowBlur = u * 0.6;
      ctx.strokeStyle = col;
      ctx.lineWidth = sw;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      pts.forEach((p, q) => (q ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = shade(col, 0.6);
      ctx.lineWidth = Math.max(1.2, sw * 0.3);
      ctx.stroke();
      ctx.restore();
    }
  }
  return moving;
}

// ---- the view --------------------------------------------------------------------------

export class SortView implements PuzzleView {
  private state: SortState;
  private history: SortState[] = [];
  private layout: Layout | null = null;
  private pressed: { p: Point; vial: number } | null = null;
  private selected: { vial: number; at: number } | null = null;
  private anim: { pour: Pour; before: SortState; at: number } | null = null;
  private busy = false;
  private reduced: boolean;
  private mark: { state: SortState; from: number; to: number } | null = null;

  constructor(private readonly initial: SortState, reducedMotion: boolean) {
    this.state = cloneSort(initial);
    this.reduced = reducedMotion;
  }

  /** Won once the last pour has landed, so the win waits for the stream. */
  get won(): boolean { return solved(this.state) && !this.busy; }
  get stuck(): boolean { return jammed(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  private sortedCount(): number {
    return this.state.vials.filter((_, i) => vialDone(this.state, i)).length;
  }

  stats(): { progress: Stat } {
    return { progress: { label: 'Sorted', value: `${this.sortedCount()}/${this.state.colors}` } };
  }

  hint(): string {
    if (this.won) return 'Every line sorted';
    if (this.stuck) return 'No pours left: undo or restart';
    const n = this.sortedCount();
    return `${n} of ${this.state.colors} lines sorted`;
  }

  help(level: 1 | 2): Help | null {
    if (solved(this.state)) return null;
    const s = this.state;
    const p = plan(s);
    if (!p?.length) return this.backOnTrack();
    const [from, to] = p[0];
    const count = pourCount(s, from, to);
    const hue = HUES[s.vials[from][s.vials[from].length - 1] % HUES.length].name;
    const where = s.vials[to].length ? `onto the ${hue}` : 'into the empty vial';
    const what = count === 1 ? `the ${hue} band` : `the ${count} ${hue} bands`;
    if (level === 2) {
      this.go(from, to);
      return { text: `Poured ${what} ${where}.`, moved: true };
    }
    this.mark = { state: s, from, to };
    return { text: `Pour ${what} from here ${where}.` };
  }

  /** The fewest undos back to a board that can still be sorted. */
  private backOnTrack(): Help {
    const h = this.history;
    for (let n = 1; n <= h.length; n++) if (sortable(h[h.length - n]) !== false) return undoHelp(n);
    return { text: 'Restart to get back on track.' };
  }

  private go(from: number, to: number): boolean {
    const next = pour(this.state, from, to);
    if (!next) return false;
    this.history.push(this.state);
    if (this.history.length > 300) this.history.shift();
    this.anim = this.reduced ? null : { pour: next.last!, before: this.state, at: performance.now() };
    this.busy = !this.reduced;
    this.state = next;
    this.selected = null;
    return true;
  }

  restart(): void {
    this.state = cloneSort(this.initial);
    this.history = [];
    this.selected = null;
    this.anim = null;
    this.busy = false;
    this.mark = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.selected = null;
    this.anim = null;
    this.busy = false;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void {
    this.pressed = { p, vial: this.layout ? vialAt(this.layout, p) : -1 };
  }
  move(): void { /* read on release */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const press = this.pressed;
    this.pressed = null;
    if (!press || !this.layout || solved(this.state)) return;
    const i = vialAt(this.layout, p);
    if (i < 0) { if (press.vial < 0) this.selected = null; return; }
    // A drag from one vial to another pours straight away.
    if (press.vial >= 0 && press.vial !== i && Math.hypot(p.x - press.p.x, p.y - press.p.y) > 16) {
      if (this.go(press.vial, i)) return;
      this.select(i);
      return;
    }
    if (press.vial !== i) return;
    this.tap(i);
  }

  private tap(i: number): void {
    const sel = this.selected;
    if (!sel) { this.select(i); return; }
    if (sel.vial === i) { this.selected = null; return; }
    if (this.go(sel.vial, i)) return;
    // Not a pour that can go: lift this vial instead.
    this.select(i);
  }

  private select(i: number): void {
    if (!this.state.vials[i]?.length) { this.selected = null; return; }
    this.selected = { vial: i, at: performance.now() };
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const L = layoutSort(area, s.vials.length, s.cap);
    this.layout = L;
    const moving = paintSort(ctx, s, L, { now, selected: this.selected, anim: this.anim, motion: !this.reduced });
    if (!moving && this.anim && now - this.anim.at >= pourMs(this.anim.pour.count)) { this.anim = null; this.busy = false; }
    if (this.reduced) this.busy = false;
    const m = this.mark?.state === s && !this.busy ? this.mark : null;
    if (m) {
      for (const i of [m.from, m.to]) {
        const b = L.box[i];
        drawHelpMark(ctx, b.x + b.w * 0.12, b.y + 3, b.w * 0.76, b.h - 6, now, this.reduced, L.u * 0.4);
      }
    }
  }
}

// ---- rule pictures ---------------------------------------------------------------------

/** A picture board: each vial a string of hue letters from the bottom ('a' is blue). */
function board(vials: string[], cap: number): SortState {
  const v = vials.map((t) => [...t].map((ch) => ch.charCodeAt(0) - 97));
  const colors = new Set(v.flat()).size;
  return { cap, colors, vials: v, moves: 0, par: 0, last: null };
}

const LEAD = 0.35;
const PICK = 0.35;
const REST = 0.5;

/**
 * One rule picture: each step lifts a vial, then pours it into another. A step that cannot pour
 * shakes its target and flags it amber; `flagEnd` flags vials once the picture has played.
 */
function picture(vials: string[], cap: number, steps: [number, number][], caption: string, flagEnd: number[] = []): Illustration {
  const s0 = board(vials, cap);
  const plays: { at: number; before: SortState; after: SortState | null; from: number; to: number; ms: number }[] = [];
  let cur = s0;
  let clock = LEAD;
  for (const [from, to] of steps) {
    const next = pour(cur, from, to);
    const ms = next ? pourMs(next.last!.count) : 320;
    plays.push({ at: clock, before: cur, after: next, from, to, ms });
    clock += PICK + ms / 1000 + 0.15;
    if (next) cur = next;
  }
  const raw = clock + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      const L = layoutSort({ x: 0, y: 0, w, h }, s0.vials.length, cap, { margin: 2, maxU: 999 });
      let st = s0;
      let paint: Paint = { now: t * 1000, motion: true };
      const flags: number[] = [];
      for (const p of plays) {
        if (t < p.at) break;
        const since = t - p.at;
        if (since < PICK) { st = p.before; paint = { now: t * 1000, motion: true, selected: { vial: p.from, at: p.at * 1000 } }; continue; }
        if (p.after) {
          st = p.after;
          paint = { now: t * 1000, motion: true, anim: { pour: p.after.last!, before: p.before, at: (p.at + PICK) * 1000 } };
        } else {
          st = p.before;
          paint = { now: t * 1000, motion: true, selected: { vial: p.from, at: p.at * 1000 }, shake: { vial: p.to, at: (p.at + PICK) * 1000 } };
          flags.push(p.to);
        }
      }
      if (t >= clock) flags.push(...flagEnd);
      paintSort(ctx, st, L, { ...paint, flags });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Pour',
    text: 'Tap a vial, then another: the like bands on top of the first flow across. They land on a band of the same color or in an empty vial.',
    good: picture(['aab', 'bb', 'a'], 3, [[0, 1], [2, 0]], 'Like onto like'),
  },
  {
    title: 'Same color',
    text: 'Bands never land on another color. An empty vial takes any color.',
    good: picture(['ab', 'ba', ''], 3, [[1, 2]], 'Into the empty vial'),
    bad: picture(['ab', 'ba', ''], 3, [[0, 1]], 'Not onto blue'),
  },
  {
    title: 'Room',
    text: 'A vial holds only so many bands. A pour moves as many as fit, and the rest stay behind.',
    good: picture(['abbb', 'ab', 'aa'], 4, [[0, 1]], 'Two of three fit'),
  },
  {
    title: 'Whole lines',
    text: 'Gather every band of each color into one vial, sealed with a green stopper. Par is the fewest pours the board allows.',
    good: picture(['aa', 'bbbb', 'aa'], 4, [[2, 0]], 'One whole line'),
    bad: picture(['aa', 'bbbb', 'aa'], 4, [], 'Split in two', [0, 2]),
  },
];
