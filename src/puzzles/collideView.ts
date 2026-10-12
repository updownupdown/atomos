// Drawing and touch for Collide: drag a tile onto its neighbor (or tap one, then the other) to
// swap them. Quarks are rounded squares and leptons discs, each kind its own color and letter.
// A swap plays out wave by wave: the lines pop with a glint, jets sweep their row or column,
// showers reach every tile of their kind, then the tiles above fall and new ones drop in. The
// targets and the moves left sit in a strip above the board.
//
// The board is painted by `paintCollide`, which the rule cards' pictures share.

import {
  adjacent, bestSwap, cloneCollide, greedyMoves, JET_COL, JET_ROW, kindOf, KIND_COUNT_MAX, outOfMoves, remaining, SHOWER,
  SHOWER_TILE, solved, specOf, swap, makeTile, type CollideState, type Tile, type Turn,
} from './collide';
import { C, fitGrid, font, tile } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Collide is a reserve game, played from the Practice screen. The board is 7 by 7 at the easiest, then 7 wide by 8 tall, and 8 by 8 from the middle of Easy on, with five kinds of tile up to Easy and six from Medium. Very easy boards ask for one kind of tile, Easy and Medium for two and Hard and Expert for three, more of each as the dial rises. Par is the move budget. It was set by playing over two thousand deals with a simple player that looks one swap ahead and sees only the lines it makes, not the cascades after: at the bottom of the dial that player wins nearly every deal within the budget, at the top about half to two thirds. Every deal is checked before it is dealt: Show me alone wins it from the start. New tiles come down each column in an order fixed by the deal, so a restart or an undo replays the same tiles.</p>
`;

/** The kinds: three quarks (rounded squares) and three leptons (discs). */
export const KINDS: { name: string; glyph: string; color: string; quark: boolean }[] = [
  { name: 'up quark', glyph: 'u', color: '#f08a5d', quark: true },
  { name: 'down quark', glyph: 'd', color: '#e6c453', quark: true },
  { name: 'strange quark', glyph: 's', color: '#7ccf7a', quark: true },
  { name: 'electron', glyph: 'e', color: '#5f9ff0', quark: false },
  { name: 'muon', glyph: 'mu', color: '#b48ef2', quark: false },
  { name: 'neutrino', glyph: 'nu', color: '#cdd4d8', quark: false },
];

/** Milliseconds for a swap, a wave's pop, its fall, and a reshuffle's fade. */
const SWAP = 150;
const POP = 230;
const FALL = 240;
const SHUFFLE = 420;
/** A collected tile's flight to its target: when it leaves (into the wave's pop) and how long. */
const FLY_AT = POP * 0.3;
const FLY = 380;
/** The strip above the board with the targets and the moves left. */
const HUD = 58;

interface Geo { x: number; y: number; c: number; w: number; h: number }

/** A swap under way: its turn, the board before it, and when it started. */
export interface Anim { turn: Turn; before: Tile[]; at: number; gotBefore: number[] }

export function turnLength(turn: Turn): number {
  if (turn.bounce) return SWAP * 2;
  return SWAP + turn.steps.length * (POP + FALL) + (turn.shuffledFrom ? SHUFFLE : 0);
}

const cellCenter = (g: Geo, i: number): Point => ({ x: g.x + ((i % g.w) + 0.5) * g.c, y: g.y + (Math.floor(i / g.w) + 0.5) * g.c });

/** A letter on a tile: u, d, s and e from the font; mu and nu drawn as strokes in the same weight. */
function glyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, g: string, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (g.length === 1) {
    ctx.font = font(size, 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g, x, y + size * 0.04);
    return;
  }
  const s = size * 0.3;
  ctx.lineWidth = Math.max(1.2, size * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (g === 'mu') {
    // A stem from below the line up the left, a bowl, and the right stem.
    ctx.moveTo(x - s, y + s * 2);
    ctx.lineTo(x - s, y - s);
    ctx.moveTo(x - s, y + s * 0.1);
    ctx.quadraticCurveTo(x - s, y + s, x, y + s);
    ctx.quadraticCurveTo(x + s, y + s, x + s, y + s * 0.1);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x + s, y + s);
  } else {
    // nu: a straight left arm down to the point, a curved right arm back up.
    ctx.moveTo(x - s * 1.05, y - s);
    ctx.lineTo(x - s * 0.1, y + s);
    ctx.quadraticCurveTo(x + s * 1.1, y + s * 0.2, x + s * 0.95, y - s);
  }
  ctx.stroke();
}

/** One tile at (x, y) for cell size c. `scale` shrinks or grows it about its center. */
export function paintTile(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, t: Tile, scale = 1, alpha = 1): void {
  if (t < 0 || scale <= 0.01 || alpha <= 0.01) return;
  const sp = specOf(t);
  ctx.save();
  ctx.globalAlpha = alpha;
  const r = c * 0.4 * scale;
  if (sp === SHOWER) {
    // A shower: a dark disc with a bright burst of rays.
    ctx.fillStyle = C.surface3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.silver;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, c * 0.06 * scale);
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      const r0 = r * 0.3, r1 = r * (k % 2 ? 0.62 : 0.8);
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    }
    ctx.stroke();
    ctx.fillStyle = C.silver;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const k = KINDS[kindOf(t)] ?? KINDS[0];
  const fill = k.color;
  if (sp !== 0) { ctx.shadowColor = k.color; ctx.shadowBlur = c * 0.3 * scale; }
  if (k.quark) tile(ctx, x - r * 0.96, y - r * 0.96, r * 1.92, r * 1.92, r * 0.42, fill, null);
  else {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  if (sp === JET_ROW || sp === JET_COL) {
    // A jet: two dark streaks through the tile along its row or column, the letter between.
    ctx.strokeStyle = 'rgba(16, 17, 18, 0.55)';
    ctx.lineWidth = Math.max(1.5, c * 0.06 * scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const a = r * 0.82, o = r * 0.62;
    if (sp === JET_ROW) {
      ctx.moveTo(x - a, y - o); ctx.lineTo(x + a, y - o);
      ctx.moveTo(x - a, y + o); ctx.lineTo(x + a, y + o);
    } else {
      ctx.moveTo(x - o, y - a); ctx.lineTo(x - o, y + a);
      ctx.moveTo(x + o, y - a); ctx.lineTo(x + o, y + a);
    }
    ctx.stroke();
  }
  glyph(ctx, x, y, c * 0.44 * scale, k.glyph, C.tileInk);
  ctx.restore();
}

interface Paint {
  anim: Anim | null;
  now: number;
  motion: boolean;
  /** The tile picked up for a swap. */
  sel?: number;
  /** Cells to flag in amber (the rule pictures' broken swap). */
  flag?: number[];
}

/**
 * Paints the board: its frame, the tiles, and a swap under way (the slide, each wave's pop and
 * fall, a reshuffle). Returns true while something is still moving.
 */
export function paintCollide(ctx: CanvasRenderingContext2D, cells: Tile[], g: Geo, o: Paint): boolean {
  const { c, w, h } = g;
  const box = frameBox(g.x, g.y, w * c, h * c, c);
  drawFrame(ctx, box, { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
  const a = o.anim;
  const ms = a && o.motion ? o.now - a.at : Infinity;
  const total = a ? turnLength(a.turn) : 0;
  const moving = ms < total;
  // The tiles stay inside the frame: anything above its inner edge waits to come in.
  const innerTop = g.y - (framePad(c) - frameWidth(c) / 2);
  const put = (i: number, t: Tile, dy = 0, scale = 1, alpha = 1, dx = 0) => {
    const p = cellCenter(g, i);
    const y = p.y + dy;
    if (y - c * 0.42 < innerTop) return;
    const enter = Math.min(1, Math.max(0, (y - g.y) / (c * 0.5)));
    paintTile(ctx, p.x + dx, y, c, t, scale, alpha * enter);
  };
  if (o.sel !== undefined && !moving && cells[o.sel] >= 0) {
    // The picked tile: a soft cyan plate under it, and the tile lifted a little.
    const p = cellCenter(g, o.sel);
    tile(ctx, p.x - c * 0.48, p.y - c * 0.48, c * 0.96, c * 0.96, c * 0.22, 'rgba(111, 208, 230, 0.28)', null);
  }
  if (!a || !moving) {
    cells.forEach((t, i) => put(i, t, 0, o.sel === i ? 1.08 : 1));
    if (o.flag) for (const i of o.flag) {
      const p = cellCenter(g, i);
      tile(ctx, p.x - c * 0.46, p.y - c * 0.46, c * 0.92, c * 0.92, c * 0.2, null, C.warn, Math.max(2, c * 0.07));
    }
    return false;
  }
  const t = a.turn;
  // The swap: the two tiles slide past each other (and back, for a swap that made nothing).
  if (ms < SWAP * (t.bounce ? 2 : 1)) {
    const k = t.bounce ? (ms < SWAP ? ease(ms / SWAP) * 0.55 : 0.55 * (1 - ease((ms - SWAP) / SWAP))) : ease(ms / SWAP);
    const pa = cellCenter(g, t.a), pb = cellCenter(g, t.b);
    a.before.forEach((tl, i) => { if (i !== t.a && i !== t.b) put(i, tl); });
    put(t.a, a.before[t.a], (pb.y - pa.y) * k, 1, 1, (pb.x - pa.x) * k);
    put(t.b, a.before[t.b], (pa.y - pb.y) * k, 1, 1, (pa.x - pb.x) * k);
    return true;
  }
  let u = ms - SWAP;
  for (const st of t.steps) {
    if (u < POP) {
      const k = u / POP;
      const gone = new Set(st.clear);
      st.grid.forEach((tl, i) => {
        if (!gone.has(i)) { put(i, tl); return; }
        // A pop: a little swell, then shrinking away.
        const sc = k < 0.25 ? 1 + 0.6 * k : 1.15 * (1 - (k - 0.25) / 0.75);
        put(i, tl, 0, sc, 1 - Math.max(0, k - 0.5) * 2 * 0.6);
      });
      paintBursts(ctx, g, st, k);
      for (const m of st.make) if (k > 0.45) put(m.cell, m.tile, 0, ease((k - 0.45) / 0.55));
      return true;
    }
    u -= POP;
    if (u < FALL) {
      const k = ease(u / FALL);
      st.after.forEach((tl, i) => put(i, tl, -st.drop[i] * c * (1 - k)));
      return true;
    }
    u -= FALL;
  }
  if (t.shuffledFrom && u < SHUFFLE) {
    const k = u / SHUFFLE;
    if (k < 0.5) t.shuffledFrom.forEach((tl, i) => put(i, tl, 0, 1 - k, 1 - k * 2));
    else cells.forEach((tl, i) => put(i, tl, 0, k, (k - 0.5) * 2));
    return true;
  }
  cells.forEach((tl, i) => put(i, tl));
  return false;
}

/** A wave's light: a glint ring on each tile that pops, a beam along each jet's line, and a
 *  fine ray from each shower to the tiles it reaches. */
function paintBursts(ctx: CanvasRenderingContext2D, g: Geo, st: Turn['steps'][number], k: number): void {
  const { c, w, h } = g;
  ctx.save();
  ctx.lineCap = 'round';
  for (const j of st.jets) {
    const p = cellCenter(g, j.cell);
    const col = KINDS[kindOf(st.grid[j.cell])]?.color ?? C.silver;
    const f = 1 - k;
    const reach = ease(Math.min(1, k * 2.2));
    ctx.globalAlpha = f;
    ctx.strokeStyle = col;
    ctx.lineWidth = c * 0.34 * f + 1;
    ctx.beginPath();
    if (j.dir === 1) {
      const x0 = g.x + c * 0.5, x1 = g.x + (w - 0.5) * c;
      ctx.moveTo(p.x + (x0 - p.x) * reach, p.y); ctx.lineTo(p.x + (x1 - p.x) * reach, p.y);
    } else {
      const y0 = g.y + c * 0.5, y1 = g.y + (h - 0.5) * c;
      ctx.moveTo(p.x, p.y + (y0 - p.y) * reach); ctx.lineTo(p.x, p.y + (y1 - p.y) * reach);
    }
    ctx.stroke();
    ctx.strokeStyle = C.silver;
    ctx.lineWidth = c * 0.08 * f + 0.5;
    ctx.stroke();
  }
  for (const s of st.showers) {
    const p = cellCenter(g, s.cell);
    ctx.globalAlpha = 0.7 * (1 - k);
    ctx.strokeStyle = C.silver;
    ctx.lineWidth = Math.max(1, c * 0.04);
    ctx.beginPath();
    for (const i of s.hits) {
      if (i === s.cell) continue;
      const q = cellCenter(g, i);
      const r = ease(Math.min(1, k * 2.5));
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (q.x - p.x) * r, p.y + (q.y - p.y) * r);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = C.silver;
  for (const i of st.clear) {
    const p = cellCenter(g, i);
    ctx.globalAlpha = 0.85 * (1 - k);
    ctx.lineWidth = Math.max(1.5, c * 0.06 * (1 - k));
    ctx.beginPath();
    ctx.arc(p.x, p.y, c * (0.2 + 0.28 * ease(k)), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** The targets strip: each target kind as a small tile and how many are still to collect (a
 *  check once done), and the moves left on the right. */
function paintHud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, targets: { kind: number; left: number }[], movesLeft: number, lost: boolean): Point[] {
  const size = 30;
  let cx = x + size / 2 + 2;
  const cy = y + 24;
  const step = Math.min(82, (w - 90) / Math.max(1, targets.length));
  const chips: Point[] = [];
  for (const t of targets) {
    chips.push({ x: cx, y: cy });
    paintTile(ctx, cx, cy, size / 0.8, makeTile(t.kind), 0.82, t.left ? 1 : 0.55);
    const tx = cx + size / 2 + 8;
    if (t.left > 0) {
      ctx.fillStyle = C.text;
      ctx.font = font(19, 600);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(t.left), tx, cy + 1);
    } else checkMark(ctx, tx + 9, cy, 9);
    cx += step;
  }
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = lost ? C.warn : C.text;
  ctx.font = font(22, 600);
  textRight(ctx, String(movesLeft), x + w - 2, y + 26);
  ctx.fillStyle = C.text2;
  ctx.font = font(13, 500);
  textRight(ctx, movesLeft === 1 ? 'move left' : 'moves left', x + w - 2, y + 45);
  return chips;
}

/** Collected target tiles flying from where they popped to their chip in the strip above. */
function paintFlights(ctx: CanvasRenderingContext2D, g: Geo, anim: Anim, now: number, chips: Map<number, Point>): void {
  let u = now - anim.at - SWAP;
  for (const st of anim.turn.steps) {
    const k = (u - FLY_AT) / FLY;
    if (k > 0 && k < 1) {
      let n = 0;
      for (const i of st.clear) {
        const kind = kindOf(st.grid[i]);
        const to = chips.get(kind);
        if (!to || n++ >= 16) continue;
        const from = cellCenter(g, i);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        // A gentle arc: out sideways a little, then in.
        const side = Math.sin(Math.PI * e) * g.c * 0.6 * ((i % 2) * 2 - 1);
        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
        const x = from.x + dx * e - (dy / len) * side, y = from.y + dy * e + (dx / len) * side;
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = KINDS[kind].color;
        ctx.shadowColor = KINDS[kind].color;
        ctx.shadowBlur = g.c * 0.2;
        ctx.beginPath();
        ctx.arc(x, y, g.c * (0.14 - 0.06 * e), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    u -= POP + FALL;
  }
}

/** Text set flush right against x (measured where the canvas can, estimated where it can't). */
function textRight(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  const m = ctx.measureText?.(text) as TextMetrics | undefined;
  const tw = m?.width ?? text.length * 7;
  ctx.textAlign = 'left';
  ctx.fillText(text, x - tw, y);
}

function checkMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = C.good;
  ctx.lineWidth = Math.max(2, r * 0.32);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.8, y);
  ctx.lineTo(x - r * 0.2, y + r * 0.6);
  ctx.lineTo(x + r * 0.9, y - r * 0.6);
  ctx.stroke();
  ctx.restore();
}

/** Target counts as the board shows them partway through a swap: the waves that have popped
 *  so far are counted. */
function shownGot(got: number[], anim: Anim | null, now: number, motion: boolean): number[] {
  if (!anim || !motion || anim.turn.bounce) return got;
  const out = got.slice();
  let u = now - anim.at - SWAP;
  // Take back the waves still to pop.
  for (const st of anim.turn.steps) {
    if (u < FLY_AT + FLY) for (const i of st.clear) { const k = kindOf(st.grid[i]); if (k < KIND_COUNT_MAX) out[k]--; }
    u -= POP + FALL;
  }
  return out;
}

export class CollideView implements PuzzleView {
  private state: CollideState;
  private history: CollideState[] = [];
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private anim: Anim | null = null;
  private busy = false;
  private sel: number | null = null;
  private press: { p: Point; cell: number; done: boolean } | null = null;
  private mark: { state: CollideState; cells: [number, number] } | null = null;

  constructor(private readonly initial: CollideState, reducedMotion: boolean) {
    this.state = cloneCollide(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state) && !this.busy; }
  get stuck(): boolean { return outOfMoves(this.state) && !this.busy; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat; par: Stat } {
    const s = this.state;
    const all = s.targets.reduce((n, t) => n + t.need, 0);
    return { progress: { label: 'Collected', value: `${all - remaining(s)}/${all}` }, par: { label: 'Budget', value: String(s.budget) } };
  }

  hint(): string {
    const s = this.state;
    if (solved(s)) return this.busy ? 'Cascade under way' : 'Every target collected';
    if (this.busy) return 'Cascade under way';
    if (outOfMoves(s)) return 'Out of moves: undo or restart';
    const left = s.budget - s.moves;
    return left === 1 ? '1 move left' : `${left} moves left`;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (solved(s)) return null;
    if (outOfMoves(s)) {
      // The fewest undos back to a board greedy play still wins from.
      const h = this.history;
      for (let n = 1; n <= h.length; n++) if (greedyMoves(h[h.length - n]) <= h[h.length - n].budget - h[h.length - n].moves) return undoHelp(n);
      return { text: 'Restart to try this board again.' };
    }
    const m = bestSwap(s);
    if (!m) return null;
    const what = m.gain > 0 ? `${m.gain} toward the targets` : 'a line';
    if (level === 2) {
      this.play(m.a, m.b);
      return { text: m.gain > 0 ? `Swapped: ${m.gain} collected toward the targets.` : 'Swapped to make a line.', moved: true };
    }
    this.mark = { state: s, cells: [m.a, m.b] };
    return { text: `Swap these two: it makes ${what}.` };
  }

  /** Swaps two cells through the same path as a drag, for the player and for Show me. */
  private play(a: number, b: number): void {
    const before = this.state;
    const next = swap(before, a, b, true);
    this.sel = null;
    if (!next) return;
    this.anim = { turn: next.last!, before: before.cells, at: performance.now(), gotBefore: before.got };
    this.busy = !this.reduced;
    if (next.last!.bounce) return;
    this.history.push(before);
    if (this.history.length > 100) this.history.shift();
    this.state = next;
  }

  restart(): void {
    this.state = cloneCollide(this.initial);
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
    return cy * w + cx;
  }

  private get open(): boolean { return !solved(this.state) && !outOfMoves(this.state); }

  down(p: Point): void {
    if (!this.open) return;
    this.press = { p, cell: this.cellAt(p), done: false };
  }

  move(p: Point): void {
    const pr = this.press;
    if (!pr || pr.done || pr.cell < 0) return;
    const dx = p.x - pr.p.x, dy = p.y - pr.p.y;
    if (Math.hypot(dx, dy) < this.cell * 0.35) return;
    // A drag: swap with the neighbor it points at.
    const { w, h } = this.state;
    const x = pr.cell % w, y = Math.floor(pr.cell / w);
    const [nx, ny] = Math.abs(dx) > Math.abs(dy) ? [x + Math.sign(dx), y] : [x, y + Math.sign(dy)];
    pr.done = true;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
    this.play(pr.cell, ny * w + nx);
  }

  up(p: Point): void {
    const pr = this.press;
    this.press = null;
    if (!pr || pr.done || !this.open) return;
    const cell = this.cellAt(p);
    if (cell < 0 || cell !== pr.cell) { this.sel = null; return; }
    // Taps: pick a tile, then a neighbor to swap it with.
    if (this.sel === null || this.sel === cell) { this.sel = this.sel === cell ? null : cell; return; }
    if (adjacent(this.state.w, this.sel, cell)) this.play(this.sel, cell);
    else this.sel = cell;
  }

  cancel(): void { this.press = null; }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const fit = fitFramed(area, s.w, s.h, { margin: 6, maxCell: 64, top: HUD });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const g: Geo = { x: fit.x, y: fit.y, c, w: s.w, h: s.h };
    const moving = paintCollide(ctx, s.cells, g, { anim: this.anim, now, motion: !this.reduced, sel: this.sel ?? undefined });
    if (!moving) { this.busy = false; }
    const got = shownGot(s.got, this.anim, now, !this.reduced && moving);
    const hudY = fit.y - fit.room - HUD + 4;
    const hudW = Math.min(area.w - 12, Math.max(s.w * c + 2 * fit.room - 12, 330));
    const chips = paintHud(ctx, fit.x + (s.w * c) / 2 - hudW / 2, hudY, hudW, s.targets.map((t) => ({ kind: t.kind, left: Math.max(0, t.need - got[t.kind]) })), s.budget - s.moves, outOfMoves(s) && !moving);
    if (moving && this.anim && !this.anim.turn.bounce) {
      // Only tiles a target still wanted when the swap began fly up.
      const want = new Map<number, Point>();
      s.targets.forEach((t, k) => { if (this.anim!.gotBefore[t.kind] < t.need) want.set(t.kind, chips[k]); });
      paintFlights(ctx, g, this.anim, now, want);
    }
    const m = this.mark?.state === s && !moving && this.open ? this.mark : null;
    if (m) {
      const [p, q] = [cellCenter(g, m.cells[0]), cellCenter(g, m.cells[1])];
      const x0 = Math.min(p.x, q.x) - c * 0.46, y0 = Math.min(p.y, q.y) - c * 0.46;
      drawHelpMark(ctx, x0, y0, Math.abs(p.x - q.x) + c * 0.92, Math.abs(p.y - q.y) + c * 0.92, now, this.reduced, c * 0.22);
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
 * A small picture board from rows of text: '0' to '5' a plain tile of that kind, 'A' to 'F' a
 * row jet and 'a' to 'f' a column jet of kind 0 to 5, '*' a shower. `feed` gives each column's
 * new tiles, top first, as digits; '.' leaves the gap open, so the picture ends showing what went.
 */
function mini(rows: string[], feed: string[], targets: { kind: number; need: number }[] = [{ kind: 0, need: 99 }], budget = 9): CollideState {
  const h = rows.length, w = rows[0].length;
  const cells: Tile[] = [];
  for (const line of rows) for (const ch of line) {
    if (ch === '*') cells.push(SHOWER_TILE);
    else if (ch >= 'A' && ch <= 'F') cells.push(makeTile(ch.charCodeAt(0) - 65, JET_ROW));
    else if (ch >= 'a' && ch <= 'f') cells.push(makeTile(ch.charCodeAt(0) - 97, JET_COL));
    else cells.push(Number(ch));
  }
  return {
    w, h, kinds: 6, seed: 1, cells, drawn: new Array(w).fill(0), targets, got: new Array(KIND_COUNT_MAX).fill(0),
    budget, moves: 0, par: budget, feed: feed.map((f) => [...f].map((ch) => (ch === '.' ? -1 : Number(ch)))), last: null,
  };
}

const LEAD = 0.45;
const REST = 0.5;

/** One rule picture: the swaps (cell pairs, as [x, y]) played one after another, each to its
 *  end. A `bad` picture ends with the cells of a swap that did nothing flagged in amber; `hud`
 *  draws the targets strip above the board. */
function picture(s0: CollideState, swaps: [[number, number], [number, number]][], caption: string, opts: { bad?: boolean; hud?: boolean } = {}): Illustration {
  const steps: { before: CollideState; after: CollideState; anim: Turn; at: number }[] = [];
  let cur = s0;
  let clock = LEAD;
  let bounced: number[] | undefined;
  for (const [[ax, ay], [bx, by]] of swaps) {
    const a = ay * s0.w + ax, b = by * s0.w + bx;
    const next = swap(cur, a, b, true)!;
    const turn = next.last!;
    steps.push({ before: cur, after: turn.bounce ? cur : next, anim: turn, at: clock });
    clock += turnLength(turn) / 1000 + 0.3;
    if (turn.bounce) bounced = [a, b];
    else cur = next;
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
      for (const sp of steps) {
        if (u < sp.at) break;
        st = sp.after;
        anim = { turn: sp.anim, before: sp.before.cells, at: sp.at * 1000, gotBefore: sp.before.got };
      }
      const top = opts.hud ? 30 : 0;
      const fit = fitFramed({ x: 0, y: 0, w, h }, s0.w, s0.h, { margin: 2, maxCell: 999, top });
      const g: Geo = { x: fit.x, y: fit.y, c: fit.cell, w: s0.w, h: s0.h };
      const settled = u >= clock;
      const moving = paintCollide(ctx, st.cells, g, { anim, now: u * 1000, motion: true, flag: opts.bad && settled ? bounced : undefined });
      if (opts.hud) {
        const got = shownGot(st.got, anim, u * 1000, moving);
        const tg = st.targets[0];
        const left = Math.max(0, tg.need - got[tg.kind]);
        const movesLeft = st.budget - st.moves;
        const lost = opts.bad === true && settled && left > 0;
        const y = fit.y - fit.room - top + 2;
        paintTile(ctx, 13, y + 12, 22, makeTile(tg.kind), 0.9, left ? 1 : 0.55);
        if (left) {
          ctx.fillStyle = C.text;
          ctx.font = font(14, 600);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(left), 28, y + 13);
        } else checkMark(ctx, 33, y + 12, 6);
        ctx.fillStyle = lost ? C.warn : C.text2;
        ctx.font = font(13, 500);
        ctx.textBaseline = 'middle';
        textRight(ctx, movesLeft === 1 ? '1 move' : `${movesLeft} moves`, w - 4, y + 13);
      }
    },
  };
}

const SWAP_ROWS = ['0203', '1031', '2312'];
const SWAP_FEED = ['.', '.', '.', '.'];

export const RULES: RuleCard[] = [
  {
    title: 'Swap',
    text: 'Drag a tile onto a neighbor, or tap one then the other, to swap them. Three or more of a kind in a line collide and vanish.',
    good: picture(mini(SWAP_ROWS, SWAP_FEED), [[[1, 0], [1, 1]]], 'Three in a line'),
    bad: picture(mini(SWAP_ROWS, SWAP_FEED), [[[2, 1], [3, 1]]], 'No line: slides back', { bad: true }),
  },
  {
    title: 'Falls',
    text: 'Tiles above fall into the gaps and new ones drop in from the top. A line they make clears too.',
    good: picture(mini(['1313', '3201', '0022'], ['.', '..', '..', '.']), [[[2, 1], [2, 2]]], 'A cascade'),
  },
  {
    title: 'Jets',
    text: 'Four in a line leave a jet. When a jet goes, it clears its whole row or column.',
    good: picture(mini(['0100', '0032', '3213'], ['2.', '.', '0.', '3.']), [[[1, 0], [1, 1]], [[0, 0], [0, 1]]], 'Four, then the jet'),
  },
  {
    title: 'Showers',
    text: 'Five in a line leave a shower. Swap it with any tile to clear every tile of that kind.',
    good: picture(mini(['*121', '1312', '2131'], ['..', '.', '..', '..']), [[[0, 0], [1, 0]]], 'Every d goes'),
  },
  {
    title: 'Targets',
    text: 'Collect the tiles shown above the board before the moves run out. Undo is always free.',
    good: picture(mini(SWAP_ROWS, SWAP_FEED, [{ kind: 0, need: 3 }], 3), [[[1, 0], [1, 1]]], 'Collected in time', { hud: true }),
    bad: picture(mini(SWAP_ROWS, SWAP_FEED, [{ kind: 1, need: 6 }], 1), [[[1, 0], [1, 1]]], 'Out of moves', { hud: true, bad: true }),
  },
];
