// Drawing and touch for Valence: drag from an atom toward a neighbor to bond them, again for a
// double bond, again to take it away; a tap on a bond does the same. Atoms are discs printed with
// the bonds they take: dark while they still need some, green and glowing once they have exactly
// that many, amber with a halo when they have too many. A bond that would cross another is
// refused, and the bond in its way flashes amber.
//
// The board is painted by `paintValence`, which the rule cards' pictures share.

import { blocker, cloneValence, counts, cycle, firstWrong, lanesFor, laneToward, nextForced, pieces, setBonds, solved, type Atom, type ValenceState } from './valence';
import { C, fitGrid, font, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<section class="how-specs"><h3>Specs</h3><ul>
<li><b>Flawless:</b> Solve in par drags or fewer, where a drag (or a tap on a gap) steps a bond from none to single to double and back to none, and par is one drag per bond in the answer (a double bond counts two), and without Show me.</li>
<li><b>Where it's played:</b> A reserve game, played from the Puzzles screen.</li>
<li><b>Board:</b> The grid grows from 7 by 7 with 8 atoms on the easiest boards to 10 across and 13 down with about 29 on the hardest, with fewer double bonds and more rings as it goes.</li>
<li><b>Built:</b> Each board is grown as a random molecule and kept only when the solver can finish it by deduction, which proves it has exactly one answer.</li>
<li><b>Difficulty:</b> Very easy boards need only counting; from Easy on a board may need the one-molecule rule (a lone link must hold a bond, and no bond may close off a finished group), and from Medium on a step of looking ahead. Hard and Expert boards are picked to need it where they can.</li>
</ul></section>
`;

/** Milliseconds a bond takes to grow from its atom. */
const GROW = 180;
/** A satisfied atom's pop, and the win wave's step per atom. */
const POP = 320;
const WAVE = 90;

interface Geo { x: number; y: number; c: number }

/** A lane changing: from `prev` bonds to its current count, drawn from atom `from`, `f` of the way. */
interface Change { prev: number; from: number; f: number }

interface Paint {
  /** Lanes part way through a change. */
  changes?: Map<number, Change>;
  /** A lane under the finger: where a drag would bond. */
  aim?: { lane: number; from: number; blocked: boolean } | null;
  /** A bond flashing amber, 0 to 1 (1 just struck). */
  flash?: { lane: number; k: number } | null;
  /** Per atom, 0 to 1 through its pop. */
  pop?: number[];
  /** Per atom, 0 to 1 through its win ring. */
  ring?: number[];
}

const centerOf = (g: Geo, a: { x: number; y: number }): Point => ({ x: g.x + (a.x + 0.5) * g.c, y: g.y + (a.y + 0.5) * g.c });
const radius = (c: number): number => c * 0.38;

/** One bond line between two points, shortened at both ends by the atoms' radius. */
function bondLines(ctx: CanvasRenderingContext2D, p: Point, q: Point, c: number, n: number, color: string, alpha: number, from: number, upto = 1): void {
  if (n <= 0 || alpha <= 0) return;
  const dx = q.x - p.x, dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  if (!len) return;
  const ux = dx / len, uy = dy / len;
  const r = radius(c) * 0.9;
  // Drawn from the `from` end (0 is p, 1 is q), upto a share of the way.
  const a = from === 0 ? { x: p.x + ux * r, y: p.y + uy * r } : { x: q.x - ux * r, y: q.y - uy * r };
  const b = from === 0 ? { x: q.x - ux * r, y: q.y - uy * r } : { x: p.x + ux * r, y: p.y + uy * r };
  const e = { x: a.x + (b.x - a.x) * upto, y: a.y + (b.y - a.y) * upto };
  const off = c * 0.11;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2.5, c * 0.085);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const offs = n === 1 ? [0] : [-off, off];
  for (const o of offs) {
    ctx.moveTo(a.x - uy * o, a.y + ux * o);
    ctx.lineTo(e.x - uy * o, e.y + ux * o);
  }
  ctx.stroke();
  ctx.restore();
}

/** A broad soft band along a lane: the drag's aim (cyan), or a refusal (amber). */
function band(ctx: CanvasRenderingContext2D, p: Point, q: Point, c: number, color: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = c * 0.46;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
  ctx.restore();
}

/** Paints the grid, every bond and every atom. */
export function paintValence(ctx: CanvasRenderingContext2D, s: ValenceState, g: Geo, o: Paint = {}): void {
  const c = g.c, cols = s.cols, rows = s.rows;
  drawFrame(ctx, frameBox(g.x, g.y, cols * c, rows * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  // Faint dots on the empty cells no bond runs over.
  const busy = new Uint8Array(cols * rows);
  for (const a of s.atoms) busy[a.y * cols + a.x] = 1;
  s.lanes.forEach((l, k) => { if (s.bonds[k] || o.changes?.has(k)) for (const cell of l.cells) busy[cell] = 1; });
  ctx.fillStyle = C.surface3;
  const dot = Math.max(1.5, c * 0.035);
  for (let i = 0; i < cols * rows; i++) {
    if (busy[i]) continue;
    ctx.beginPath();
    ctx.arc(g.x + ((i % cols) + 0.5) * c, g.y + (Math.floor(i / cols) + 0.5) * c, dot, 0, Math.PI * 2);
    ctx.fill();
  }
  const have = counts(s);
  const done = s.atoms.map((a, i) => have[i] === a.need);
  // The drag's aim, under everything.
  if (o.aim) {
    const l = s.lanes[o.aim.lane];
    const p = centerOf(g, s.atoms[l.a]), q = centerOf(g, s.atoms[l.b]);
    band(ctx, p, q, c, o.aim.blocked ? C.warn : C.accent, o.aim.blocked ? 0.35 : 0.22);
  }
  if (o.flash && o.flash.k > 0) {
    const l = s.lanes[o.flash.lane];
    band(ctx, centerOf(g, s.atoms[l.a]), centerOf(g, s.atoms[l.b]), c, C.warn, 0.55 * o.flash.k);
  }
  // Bonds.
  s.lanes.forEach((l, k) => {
    const p = centerOf(g, s.atoms[l.a]), q = centerOf(g, s.atoms[l.b]);
    const color = done[l.a] && done[l.b] ? C.silver : C.silverDim;
    const ch = o.changes?.get(k);
    const now = s.bonds[k];
    if (!ch || ch.f >= 1) { bondLines(ctx, p, q, c, now, color, 0.92, 0); return; }
    const from = ch.from === l.a ? 0 : 1;
    if (now > ch.prev) {
      // Growing: the lines already there stay; the new one runs out from the atom dragged from.
      if (ch.prev === 0) bondLines(ctx, p, q, c, now, color, 0.92, from, ease(ch.f));
      else doubleGrow(ctx, p, q, c, color, from, ease(ch.f));
    } else {
      // Taken away (or cut down): the old lines fade out over the new ones.
      bondLines(ctx, p, q, c, now, color, 0.92, 0);
      bondLines(ctx, p, q, c, ch.prev, color, 0.92 * (1 - ease(ch.f)), 0);
    }
  });
  // Atoms.
  const piece = pieces(s);
  const split = done.every(Boolean) && piece.some((v) => v !== 0);
  // The largest piece is the molecule; the rest are the ones left apart.
  let main = 0;
  if (split) {
    const size = new Map<number, number>();
    for (const v of piece) size.set(v, (size.get(v) ?? 0) + 1);
    for (const [v, n] of size) if (n > (size.get(main) ?? 0)) main = v;
  }
  s.atoms.forEach((a, i) => {
    const p = centerOf(g, a);
    const pop = o.pop?.[i] ?? 1;
    const r = radius(c) * (pop < 1 ? 1 + 0.16 * Math.sin(Math.PI * pop) : 1);
    paintAtom(ctx, p.x, p.y, r, c, a.need, have[i] - a.need, split && piece[i] !== main);
    const ring = o.ring?.[i];
    if (ring !== undefined && ring > 0 && ring < 1) {
      ctx.save();
      ctx.globalAlpha = 0.5 * (1 - ring);
      ctx.strokeStyle = C.good;
      ctx.lineWidth = Math.max(2, c * 0.07);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius(c) * (1 + 0.7 * ease(ring)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  });
}

/** The second line of a double bond growing beside the first. */
function doubleGrow(ctx: CanvasRenderingContext2D, p: Point, q: Point, c: number, color: string, from: number, f: number): void {
  // The first line slides aside as the second runs out.
  const dx = q.x - p.x, dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const r = radius(c) * 0.9;
  const off = c * 0.11 * f;
  const a = { x: p.x + ux * r, y: p.y + uy * r }, b = { x: q.x - ux * r, y: q.y - uy * r };
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2.5, c * 0.085);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x + uy * off, a.y - ux * off);
  ctx.lineTo(b.x + uy * off, b.y - ux * off);
  const s0 = from === 0 ? a : b, s1 = from === 0 ? b : a;
  ctx.moveTo(s0.x - uy * off, s0.y + ux * off);
  ctx.lineTo(s0.x + (s1.x - s0.x) * f - uy * off, s0.y + (s1.y - s0.y) * f + ux * off);
  ctx.stroke();
  ctx.restore();
}

/** An atom: a disc with its count. `over` is bonds beyond its count (negative while it needs
 *  more); `apart` marks one left out of the molecule. */
function paintAtom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: number, need: number, over: number, apart: boolean): void {
  ctx.save();
  if (over > 0 || apart) {
    // A thick faint halo: the second cue beside the color.
    ctx.fillStyle = C.warn;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (over === 0 && !apart) {
    ctx.shadowColor = C.good;
    ctx.shadowBlur = r * 0.9;
  }
  ctx.fillStyle = over > 0 || apart ? C.warn : over === 0 ? C.good : C.surface3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (over < 0) {
    // A thick faint rim, so a waiting atom reads as a whole disc on the dark plate.
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.beginPath();
    ctx.arc(x, y, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = over < 0 ? C.text : C.bg;
  ctx.font = font(Math.max(13, r * 1.12), 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(need), x, y + r * 0.04);
  ctx.restore();
}

export class ValenceView implements PuzzleView {
  private state: ValenceState;
  private history: ValenceState[] = [];
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private mark: { state: ValenceState; lanes: number[] } | null = null;
  /** A press: on an atom (a drag) or on a lane (a tap). */
  private press: { atom: number; lane: number; at: Point; aim: number; blocked: boolean } | null = null;
  private change: { lane: number; prev: number; from: number; at: number } | null = null;
  private flash: { lane: number; at: number } | null = null;
  private popAt: number[];
  private wonAt = 0;

  constructor(private readonly initial: ValenceState, reducedMotion: boolean) {
    this.state = cloneValence(initial);
    this.reduced = reducedMotion;
    this.popAt = initial.atoms.map(() => -Infinity);
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    const have = counts(s);
    return { progress: { label: 'Bonded', value: `${s.atoms.filter((a, i) => have[i] === a.need).length}/${s.atoms.length}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'One molecule, every atom bonded';
    const have = counts(s);
    const over = s.atoms.filter((a, i) => have[i] > a.need).length;
    if (over) return over === 1 ? '1 atom has too many bonds' : `${over} atoms have too many bonds`;
    const left = s.atoms.filter((a, i) => have[i] < a.need).length;
    if (!left) {
      const n = new Set(pieces(s)).size;
      return `Every atom bonded, but in ${n} pieces`;
    }
    return left === 1 ? '1 atom to bond' : `${left} atoms to bond`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const wrong = firstWrong(s);
    if (wrong >= 0) {
      const want = s.solution[wrong];
      if (level === 2) {
        this.apply(setBonds(s, wrong, want), wrong, s.lanes[wrong].a);
        return { text: want === 0 ? 'Took that bond away.' : 'Made it a single bond.', moved: true };
      }
      this.mark = { state: s, lanes: [wrong] };
      return { text: want === 0 ? 'This bond is not part of the molecule.' : 'This should be a single bond.' };
    }
    const f = nextForced(s);
    if (!f) {
      // Never expected: fall back on the answer.
      const k = s.solution.findIndex((v, i) => v > s.bonds[i]);
      if (k < 0) return null;
      if (level === 2) { this.apply(setBonds(s, k, s.solution[k]), k, s.lanes[k].a); return { text: 'Added a bond.', moved: true }; }
      this.mark = { state: s, lanes: [k] };
      return { text: 'A bond belongs here.' };
    }
    const l = s.lanes[f.lane];
    if (level === 2) {
      const from = f.step.atom ?? l.a;
      this.apply(setBonds(s, f.lane, f.bonds), f.lane, from);
      return { text: f.bonds === 2 ? 'Made it a double bond.' : 'Added a bond.', moved: true };
    }
    this.mark = { state: s, lanes: f.why.lane !== f.lane ? [f.lane, f.why.lane] : [f.lane] };
    return { text: this.why(f) };
  }

  private why(f: NonNullable<ReturnType<typeof nextForced>>): string {
    const s = this.state;
    switch (f.why.rule) {
      case 'link': return `This is the only link left between two parts of the molecule, so it needs ${f.bonds === 2 ? 'a double bond' : 'a bond'}.`;
      case 'seal': return f.why.lane !== f.lane
        ? 'A bond at the other mark would seal a finished group off from the molecule, so this one is forced.'
        : 'Any more here would seal a finished group off from the molecule, so this is forced.';
      case 'look': return f.why.lane !== f.lane
        ? 'Every other choice at the other mark runs into a dead end, and this bond follows.'
        : 'Every other choice here runs into a dead end.';
      default: {
        const i = f.step.atom ?? s.lanes[f.lane].a;
        const need = s.atoms[i].need;
        const left = need - counts(s)[i];
        const add = f.bonds - s.bonds[f.lane];
        const here = add === 2 ? 'a double bond' : s.bonds[f.lane] ? 'a second bond' : 'a bond';
        if (left <= add) return left === need ? `This ${need} can only reach its count with ${here} here.` : `This ${need} still needs ${left}, and only this neighbor can take ${left === 1 ? 'it' : 'them'}.`;
        return `This ${need} still needs ${left}; its other neighbors can take at most ${left - add}, so ${here} goes here.`;
      }
    }
  }

  private apply(next: ValenceState | null, lane: number, from: number): void {
    if (!next) return;
    const before = this.state;
    this.history.push(before);
    if (this.history.length > 300) this.history.shift();
    this.state = next;
    this.settled(before, lane, from);
  }

  /** Starts the animations a change calls for: the bond growing or fading, atoms popping as they
   *  are satisfied, the win wave. */
  private settled(before: ValenceState, lane: number, from: number): void {
    if (this.reduced) return;
    const now = performance.now();
    this.change = { lane, prev: before.bonds[lane], from, at: now };
    const was = counts(before), have = counts(this.state);
    this.state.atoms.forEach((a, i) => { if (have[i] === a.need && was[i] !== a.need) this.popAt[i] = now + GROW * 0.7; });
    if (solved(this.state)) this.wonAt = now + GROW;
  }

  restart(): void {
    this.state = cloneValence(this.initial);
    this.history = [];
    this.press = null;
    this.change = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.change = null;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  private atomAt(p: Point): number {
    const c = this.cell;
    let best = -1, bd = c * 0.62;
    this.state.atoms.forEach((a, i) => {
      const d = Math.hypot(this.origin.x + (a.x + 0.5) * c - p.x, this.origin.y + (a.y + 0.5) * c - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /** The lane under a point between its atoms: a bonded one first where two cross. */
  private laneAt(p: Point): number {
    const c = this.cell, s = this.state;
    const gx = (p.x - this.origin.x) / c - 0.5, gy = (p.y - this.origin.y) / c - 0.5;
    let best = -1;
    s.lanes.forEach((l, k) => {
      const a = s.atoms[l.a], b = s.atoms[l.b];
      const on = l.horiz
        ? Math.abs(gy - a.y) < 0.32 && gx > Math.min(a.x, b.x) + 0.3 && gx < Math.max(a.x, b.x) - 0.3
        : Math.abs(gx - a.x) < 0.32 && gy > Math.min(a.y, b.y) + 0.3 && gy < Math.max(a.y, b.y) - 0.3;
      if (on && (best < 0 || (s.bonds[k] && !s.bonds[best]))) best = k;
    });
    return best;
  }

  down(p: Point): void {
    if (this.won || !this.cell) return;
    const atom = this.atomAt(p);
    if (atom >= 0) { this.press = { atom, lane: -1, at: p, aim: -1, blocked: false }; return; }
    const lane = this.laneAt(p);
    if (lane >= 0) this.press = { atom: -1, lane, at: p, aim: lane, blocked: this.state.bonds[lane] === 0 && blocker(this.state, lane) >= 0 };
  }

  move(p: Point): void {
    const pr = this.press;
    if (!pr) return;
    if (pr.atom < 0) {
      // A tap on a lane that turns into a drag is no tap.
      if (Math.hypot(p.x - pr.at.x, p.y - pr.at.y) > 16) { pr.aim = -1; pr.lane = -1; }
      return;
    }
    const a = this.state.atoms[pr.atom];
    const cx = this.origin.x + (a.x + 0.5) * this.cell, cy = this.origin.y + (a.y + 0.5) * this.cell;
    const dx = p.x - cx, dy = p.y - cy;
    if (Math.hypot(dx, dy) < this.cell * 0.32) { pr.aim = -1; return; }
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    pr.aim = laneToward(this.state, pr.atom, dir);
    pr.blocked = pr.aim >= 0 && this.state.bonds[pr.aim] === 0 && blocker(this.state, pr.aim) >= 0;
  }

  up(p: Point): void {
    this.move(p);
    const pr = this.press;
    this.press = null;
    if (!pr || pr.aim < 0 || this.won) return;
    const k = pr.aim;
    const next = cycle(this.state, k);
    if (!next) {
      const b = blocker(this.state, k);
      if (b >= 0 && !this.reduced) this.flash = { lane: b, at: performance.now() };
      return;
    }
    this.apply(next, k, pr.atom >= 0 ? pr.atom : this.state.lanes[k].a);
  }

  cancel(): void { this.press = null; }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const fit = fitFramed(area, s.cols, s.rows, { margin: 8, maxCell: 64 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const g = { x: fit.x, y: fit.y, c };
    const changes = new Map<number, Change>();
    const ch = this.change;
    if (ch && !this.reduced) {
      const f = (now - ch.at) / GROW;
      if (f < 1) changes.set(ch.lane, { prev: ch.prev, from: ch.from, f: Math.max(0, f) });
    }
    const pop = this.popAt.map((t) => (now < t ? 0 : Math.min(1, (now - t) / POP)));
    let ring: number[] | undefined;
    if (this.won && this.wonAt && !this.reduced) ring = winOrder(s).map((d) => Math.max(0, Math.min(1, (now - this.wonAt - d * WAVE) / 520)));
    const fl = this.flash && !this.reduced ? { lane: this.flash.lane, k: Math.max(0, 1 - (now - this.flash.at) / 600) } : null;
    const pr = this.press;
    const aim = pr && pr.aim >= 0 ? { lane: pr.aim, from: pr.atom, blocked: pr.blocked } : null;
    paintValence(ctx, s, g, { changes, pop, ring, flash: fl, aim });
    const m = this.mark?.state === s && !this.won && !pr ? this.mark : null;
    if (m) for (const k of m.lanes) {
      const l = s.lanes[k];
      const p = centerOf(g, s.atoms[l.a]), q = centerOf(g, s.atoms[l.b]);
      const r = radius(c) * 1.1;
      drawHelpMark(ctx, Math.min(p.x, q.x) - r, Math.min(p.y, q.y) - r, Math.abs(q.x - p.x) + 2 * r, Math.abs(q.y - p.y) + 2 * r, now, this.reduced, r);
    }
  }
}

/** Each atom's step in the win wave: its distance in bonds from the first atom. */
function winOrder(s: ValenceState): number[] {
  const dist = s.atoms.map(() => -1);
  dist[0] = 0;
  const queue = [0];
  for (let j = 0; j < queue.length; j++) {
    const a = queue[j];
    s.lanes.forEach((l, k) => {
      if (!s.bonds[k] || (l.a !== a && l.b !== a)) return;
      const b = l.a === a ? l.b : l.a;
      if (dist[b] < 0) { dist[b] = dist[a] + 1; queue.push(b); }
    });
  }
  return dist.map((d) => Math.max(0, d));
}

const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

function fitFramed(area: Area, cols: number, rows: number, opts: { margin: number; maxCell: number }): { cell: number; x: number; y: number } {
  const room = frameRoom(fitGrid(area, cols, rows, opts).cell);
  const g = fitGrid(area, cols, rows, { ...opts, margin: opts.margin + room });
  return { cell: g.cell, x: g.x, y: g.y };
}

// ---- rule pictures ---------------------------------------------------------------------

/** A picture board: atoms as [x, y, need], and the bonds to draw in order as [atom, atom]
 *  (the same pair twice makes it double). */
function board(cols: number, rows: number, atoms: [number, number, number][]): ValenceState {
  const at: Atom[] = atoms.map(([x, y, need]) => ({ x, y, need }));
  const lanes = lanesFor(cols, rows, at);
  return { cols, rows, atoms: at, lanes, bonds: lanes.map(() => 0), solution: lanes.map(() => 0), moves: 0, par: 0, depth: 0, looks: 0 };
}

const LEAD = 0.4;
const BEAT = 0.55;
const REST = 0.7;

function picture(cols: number, rows: number, atoms: [number, number, number][], steps: [number, number][], caption: string, o: { refuse?: [number, number] } = {}): Illustration {
  const s0 = board(cols, rows, atoms);
  const laneOf = (a: number, b: number) => s0.lanes.findIndex((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  const plan = steps.map(([a, b]) => ({ lane: laneOf(a, b), from: a }));
  const refuse = o.refuse ? laneOf(o.refuse[0], o.refuse[1]) : -1;
  const beats = plan.length + (refuse >= 0 ? 1 : 0);
  const duration = Math.min(4, Math.max(1.5, LEAD + BEAT * beats + REST));
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const s = cloneValence(s0);
      const changes = new Map<number, Change>();
      plan.forEach((st, i) => {
        const at = LEAD + BEAT * i;
        if (t < at) return;
        const prev = s.bonds[st.lane];
        s.bonds[st.lane] = Math.min(2, prev + 1);
        const f = (t - at) / (GROW / 1000 * 1.6);
        if (f < 1) changes.set(st.lane, { prev, from: st.from, f });
      });
      let flash: Paint['flash'] = null;
      let aim: Paint['aim'] = null;
      if (refuse >= 0) {
        const at = LEAD + BEAT * plan.length;
        if (t >= at) {
          aim = { lane: refuse, from: s.lanes[refuse].a, blocked: true };
          const b = blocker(s, refuse);
          if (b >= 0) flash = { lane: b, k: 1 - Math.min(1, (t - at) / 1.2) * 0.5 };
        }
      }
      const fit = fitFramed({ x: 0, y: 0, w, h }, cols, rows, { margin: 2, maxCell: 999 });
      paintValence(ctx, s, { x: fit.x, y: fit.y, c: fit.cell }, { changes, flash, aim });
    },
  };
}

export const RULES: RuleCard[] = [
  {
    title: 'Bonds',
    text: '**Drag from an atom toward a neighbor to bond them**, or tap the gap between them. Do it again for a double bond, and once more to take it away.',
    good: picture(3, 3, [[0, 0, 1], [2, 0, 3], [2, 2, 2]], [[0, 1], [1, 2], [1, 2]], 'Single, then double'),
  },
  {
    title: 'Bond count',
    text: 'Every atom ends with **exactly as many bonds as its number**. A double bond counts as two.',
    good: picture(3, 3, [[0, 0, 2], [2, 0, 3], [0, 2, 1], [2, 2, 2]], [[0, 1], [0, 2], [1, 3], [1, 3]], 'Every count met'),
    bad: picture(3, 3, [[0, 0, 1], [2, 0, 2], [2, 2, 1]], [[0, 1], [0, 1]], 'One bond too many'),
  },
  {
    title: 'No crossing',
    text: 'Bonds run straight along a row or a column to the next atom. **They never cross another bond**.',
    good: picture(3, 3, [[0, 0, 2], [2, 0, 2], [0, 2, 1], [2, 2, 1]], [[0, 1], [0, 2], [1, 3]], 'Around, not across'),
    bad: picture(3, 3, [[1, 0, 1], [0, 1, 1], [2, 1, 1], [1, 2, 1]], [[0, 3]], 'Bonds can’t cross', { refuse: [1, 2] }),
  },
  {
    title: 'One molecule',
    text: 'Every atom must **join one connected molecule**. Groups left apart do not count.',
    good: picture(3, 3, [[0, 0, 1], [2, 0, 2], [2, 2, 2], [0, 2, 1]], [[0, 1], [1, 2], [2, 3]], 'All joined'),
    bad: picture(3, 3, [[0, 0, 1], [2, 0, 1], [0, 2, 1], [2, 2, 1]], [[0, 1], [2, 3]], 'Two pieces'),
  },
];
