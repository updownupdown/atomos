// Drawing and touch for the Merge puzzle: a swipe slides the board; a cluster
// of the wanted size flies up into the nucleus.

import { ALL_SYMBOLS } from '../core/elements';
import { bestSwipe, cloneMerge, closestPair, inReach, jammed, mergeOf, slide, wanted, won, type Dir, type MergeState, type Tile } from './merge';
import { drawHelpMark, HINT_RGB, ease, MONO, undoHelp, type Area, type Help, type Point, type PuzzleView, type RuleCard } from './view';
import { C, font, tile as roundTile } from './palette';
import { drawFrame, frameWidth, framePad } from './frame';

const SLIDE_MS = 150;
const POP_MS = 260;
const FLY_MS = 520;
const SWIPE = 22;
/** How long Show me's arrow stays on the board after its swipe. */
const ARROW_MS = 900;

const symbolOf = (z: number) => ALL_SYMBOLS[z - 1] ?? '?';

export class MergeView implements PuzzleView {
  private state: MergeState;
  private history: MergeState[] = [];
  private pressed: Point | null = null;
  private animAt = 0;
  private area: Area = { x: 0, y: 0, w: 1, h: 1 };
  private reduced: boolean;
  /** Where each socket sits on screen, for the flight animation. */
  private socketAt: Point[] = [];
  /** Look here: the clusters to ring, for the board it was asked on. */
  private mark: { state: MergeState; cells: number[] } | null = null;
  /** Show me: the way it swiped, shown as an arrow over the board that swipe made. */
  private shown: { state: MergeState; dir: Dir; at: number } | null = null;

  constructor(private readonly initial: MergeState, reducedMotion: boolean) {
    this.state = cloneMerge(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return won(this.state); }
  get stuck(): boolean { return jammed(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.spoils === 0; }

  /** The game bar's Progress column: the nucleus's clusters fused so far. */
  stats(): { progress: { label: string; value: string } } {
    return { progress: { label: 'Fused', value: `${this.state.filled}/${this.state.sockets.length}` } };
  }

  hint(): string {
    const want = wanted(this.state);
    if (this.won) return 'Nucleus complete';
    if (this.stuck) return 'Jammed: restart';
    if (this.state.cells.some((c) => c?.spoiled)) return 'Cracked: it crumbles next swipe';
    return want === null ? '' : `Next: a ${want}`;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (this.won) return null;
    if (!inReach(s)) return this.backOnTrack();
    const want = wanted(s)!;
    const dir = bestSwipe(s)!;
    const merge = mergeOf(s, dir);
    if (level === 2) {
      this.swipe(dir);
      this.shown = { state: this.state, dir, at: performance.now() };
      const flew = this.state.flown[0]?.tile.v;
      const text = flew ? `Swiped ${dir}, and ${flew === 8 ? 'an' : 'a'} ${flew} flew into the nucleus.`
        : merge ? `Swiped ${dir} to merge two ${merge.makes / 2}s.`
        : `Swiped ${dir} to set up the next merge.`;
      return { text, moved: true };
    }
    // Ring the merge the best swipe makes, or else the best pair still to bring together.
    const pair = merge ? { ...merge, lined: true } : closestPair(s);
    if (pair) {
      this.mark = { state: s, cells: pair.cells };
      const v = pair.makes / 2;
      const text = pair.makes === want ? `These two ${v}s can merge into the ${want} the nucleus wants.`
        : pair.lined ? `These two ${v}s can merge toward the target.`
        : `These two ${v}s can merge once they line up.`;
      return { text };
    }
    // No two clusters match: point at the biggest one still worth growing.
    let big = -1;
    s.cells.forEach((t, i) => { if (t && !t.spoiled && t.v < want && (big < 0 || t.v > s.cells[big]!.v)) big = i; });
    if (big < 0) return { text: `Swipe to gather clusters toward the ${want} the nucleus wants.` };
    this.mark = { state: s, cells: [big] };
    return { text: `Grow this ${s.cells[big]!.v} toward the ${want} the nucleus wants.` };
  }

  /** The fewest undos back to a board the nucleus can still be finished from. */
  private backOnTrack(): Help | null {
    const h = this.history;
    for (let n = 1; n <= h.length; n++) if (inReach(h[h.length - n])) return undoHelp(n);
    // Further back than the undo history keeps: only a restart helps.
    return inReach(this.initial) ? { text: 'Restart to get back on track.' } : null;
  }

  restart(): void {
    this.state = cloneMerge(this.initial);
    this.history = [];
    this.mark = null;
    this.animAt = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.animAt = 0;
    // Undo hands back the very board a Look here may have been asked on; the mark stays cleared.
    this.mark = null;
    return true;
  }

  private swipe(dir: Dir): void {
    if (this.won) return;
    const next = slide(this.state, dir);
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    this.animAt = performance.now();
  }

  down(p: Point): void { this.pressed = p; }
  move(): void { /* a swipe is read on release */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s) return;
    const dx = p.x - s.x, dy = p.y - s.y;
    if (Math.hypot(dx, dy) < SWIPE) return;
    this.swipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  }

  key(e: KeyboardEvent): boolean {
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    const dir = map[e.key];
    if (!dir) return false;
    this.swipe(dir);
    return true;
  }

  // ---- drawing ---------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.area = area;
    const n = this.state.size;
    const goal = this.goalLayout(ctx, Math.min(area.w, Math.max(1, area.h - 60)));
    const goalH = goal.h + 12;
    const outer = Math.max(1, Math.min(area.w, area.h - goalH) * 0.96);
    // Room inside for the frame, which sits framePad outside the cells.
    const pad = framePad(outer / n);
    const side = Math.max(1, outer - 2 * pad);
    const cell = side / n;
    const x0 = area.x + (area.w - side) / 2;
    const y0 = area.y + goalH + (area.h - goalH - side) / 2;
    const center = (i: number): Point => ({ x: x0 + (i % n) * cell + cell / 2, y: y0 + Math.floor(i / n) * cell + cell / 2 });
    const r = cell * 0.43;

    this.drawGoal(ctx, x0 - pad, y0 - pad - goalH, side + 2 * pad);

    // The board: the shared frame, and a faint dot at each empty cell's center.
    drawFrame(ctx, { x: x0 - pad, y: y0 - pad, w: side + 2 * pad, h: side + 2 * pad }, { width: frameWidth(cell), radius: cell * 0.2 + pad });
    ctx.fillStyle = C.surface3;
    for (let i = 0; i < n * n; i++) {
      if (this.state.cells[i]) continue;
      const c = center(i);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(1.5, cell * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }

    const since = now - this.animAt;
    const t = this.reduced ? 1 : since / SLIDE_MS;
    const pop = this.reduced ? 1 : since / POP_MS;
    const sliding = t < 1;
    const byId = new Map<number, number>();
    this.state.cells.forEach((tile, i) => tile && byId.set(tile.id, i));

    if (sliding) {
      for (const j of this.state.last) {
        const a = center(j.from), b = center(j.to);
        const p = { x: a.x + (b.x - a.x) * ease(t), y: a.y + (b.y - a.y) * ease(t) };
        const tile = j.into ? this.ghostOf(j.id) : this.state.cells[byId.get(j.id)!];
        if (tile) this.drawTile(ctx, tile, p.x, p.y, r, 1, false);
      }
    }
    const want = wanted(this.state);
    for (const [i, tile] of this.state.cells.entries()) {
      if (!tile) continue;
      const inFlight = sliding && this.state.last.some((j) => j.id === tile.id || j.into === tile.id);
      if (inFlight) continue;
      const c = center(i);
      const fresh = this.state.spawned.includes(tile.id);
      const scale = fresh ? ease(Math.min(1, pop)) : 1;
      const made = this.state.last.some((j) => j.into === tile.id) && pop < 1;
      this.drawTile(ctx, tile, c.x, c.y, r * (made ? 1 + 0.18 * Math.sin(Math.PI * pop) : scale), 1, want !== null && tile.v === want / 2 && !tile.spoiled);
    }

    // Clusters flying into the nucleus.
    const fly = this.reduced ? 1 : Math.max(0, since - SLIDE_MS) / FLY_MS;
    if (fly < 1) {
      this.state.flown.forEach((f, k) => {
        const a = center(f.from);
        const b = this.socketAt[this.state.filled - this.state.flown.length + k] ?? a;
        const e = ease(fly);
        const p = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * 30 };
        this.drawTile(ctx, f.tile, p.x, p.y, r * (1 - 0.5 * e), 1, true);
      });
    }

    // Look here: a ring round each cluster it points at, until the board changes.
    if (this.mark?.state === this.state) {
      for (const i of this.mark.cells) {
        const c = center(i);
        drawHelpMark(ctx, c.x - r, c.y - r, r * 2, r * 2, now, this.reduced, r * TILE_RADIUS * 2);
      }
    }
    // Show me: an arrow the way it swiped, fading out.
    const shown = this.shown?.state === this.state ? this.shown : null;
    const k = shown ? (now - shown.at) / ARROW_MS : 1;
    if (shown && k < 1) drawSwipeArrow(ctx, x0 + side / 2, y0 + side / 2, side * 0.32, shown.dir, this.reduced ? 0.7 : 0.7 * (1 - ease(k)));
  }

  /** Tiles that merged last move are gone from the board; remember what they looked like for the slide. */
  private ghosts = new Map<number, Tile>();

  private ghostOf(id: number): Tile | undefined {
    if (this.ghosts.has(id)) return this.ghosts.get(id);
    const prev = this.history[this.history.length - 1];
    const tile = prev?.cells.find((c) => c?.id === id) ?? undefined;
    if (tile) this.ghosts.set(id, tile);
    return tile;
  }

  /** The goal row's shape for a width: the nucleus's name with its sockets beside it when they
   *  fit, or on a row of their own below it. */
  private goalLayout(ctx: CanvasRenderingContext2D, w: number): { h: number; beside: boolean; sr: number; gap: number; labelW: number } {
    const n = this.state.sockets.length;
    ctx.font = font(26, 700);
    const labelW = ctx.measureText(`${sup(String(this.state.target.a))}${symbolOf(this.state.target.z)}`).width;
    let sr = 20, gap = sr * 2 + 12;
    const beside = n * gap <= w - labelW - 20;
    if (!beside) {
      gap = Math.min(gap, w / n);
      sr = Math.max(10, Math.min(sr, gap / 2 - 4));
    }
    return { h: beside ? sr * 2 + 8 : 34 + sr * 2 + 8, beside, sr, gap, labelW };
  }

  /** The nucleus being gathered: its name, and a socket per wanted cluster (the next one white). */
  private drawGoal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    const s = this.state;
    const t = s.target;
    const L = this.goalLayout(ctx, w);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font(26, 700);
    ctx.fillStyle = this.won ? C.accent : C.text;
    ctx.fillText(`${sup(String(t.a))}${symbolOf(t.z)}`, x + 2, L.beside ? y + L.sr + 4 : y + 16);
    ctx.restore();
    // Sockets, right-aligned, largest first.
    const total = s.sockets.length * L.gap;
    let cx = x + w - total + L.gap / 2;
    const cy = L.beside ? y + L.sr + 4 : y + 34 + L.sr + 4;
    this.socketAt = [];
    s.sockets.forEach((v, i) => {
      this.socketAt.push({ x: cx, y: cy });
      const filled = i < s.filled;
      const next = i === s.filled;
      drawSocket(ctx, cx, cy, L.sr, v, filled ? 'filled' : next ? 'next' : 'later');
      cx += L.gap;
    });
  }

  private drawTile(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, r: number, alpha: number, lit: boolean): void {
    drawCluster(ctx, tile, x, y, r, alpha, lit);
  }
}

/** Corner radius of a cluster tile, as a share of its side. */
const TILE_RADIUS = 0.24;

/**
 * Cluster colors climb the spectrum as clusters grow, the way a plasma glows hotter: a lone
 * nucleon is gray, then orange, yellow, lime, green, cyan, blue, violet and orchid. Pure red
 * stays kept for targets, amber for warnings and rose for Next.
 */
const SPECTRUM = ['#7d868a', '#f08a4b', '#ecd24f', '#a6d95b', '#3fcf8e', '#3fc3dc', '#5b8cff', '#9b7bff', '#cf72ec', '#e7a3f5'];

/** The color of a cluster of v nucleons. */
export function clusterColor(v: number): string {
  return SPECTRUM[Math.max(0, Math.min(SPECTRUM.length - 1, Math.round(Math.log2(Math.max(1, v)))))];
}

/**
 * A cluster: a rounded tile in its spectrum color with its size in dark ink, a soft glow of its
 * own color and a crack when spoiled (`lit` is kept for callers and draws nothing extra). (x, y) is its
 * center and r half its side.
 */
export function drawCluster(ctx: CanvasRenderingContext2D, tile: Pick<Tile, 'v' | 'spoiled'>, x: number, y: number, r: number, alpha = 1, lit = false): void {
  if (!(r > 0)) return;
  const hue = clusterColor(tile.v);
  const side = r * 2, rad = side * TILE_RADIUS;
  ctx.save();
  ctx.globalAlpha = alpha * (tile.spoiled ? 0.55 : 1);
  // A faint halo of the tile's own color: luminous, never a gradient fill.
  if (tile.v > 1) {
    ctx.shadowColor = hue;
    ctx.shadowBlur = r * 0.3;
  }
  roundTile(ctx, x - r, y - r, side, side, rad, hue);
  ctx.shadowBlur = 0;
  if (tile.spoiled) {
    ctx.strokeStyle = C.bad;
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.7, y - r * 0.5);
    ctx.lineTo(x - r * 0.15, y - r * 0.05);
    ctx.lineTo(x - r * 0.35, y + r * 0.35);
    ctx.lineTo(x + r * 0.25, y + r * 0.75);
    ctx.moveTo(x + r * 0.1, y - r * 0.85);
    ctx.lineTo(x + r * 0.35, y - r * 0.2);
    ctx.lineTo(x + r * 0.8, y + r * 0.1);
    ctx.stroke();
  }
  const label = String(tile.v);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.tileInk;
  ctx.font = font(r * (label.length > 2 ? 0.66 : label.length > 1 ? 0.8 : 0.95), 700);
  ctx.fillText(label, x, y + r * 0.04);
  ctx.restore();
}

/** A socket of the nucleus: filled with its cluster, a white ring when it is wanted next, dashed while it waits. */
export function drawSocket(ctx: CanvasRenderingContext2D, cx: number, cy: number, sr: number, v: number, state: 'filled' | 'next' | 'later'): void {
  if (state === 'filled') { drawCluster(ctx, { v, spoiled: false }, cx, cy, sr); return; }
  const next = state === 'next';
  ctx.save();
  ctx.setLineDash(next ? [] : [3, 4]);
  roundTile(ctx, cx - sr, cy - sr, sr * 2, sr * 2, sr * 2 * TILE_RADIUS, null, next ? C.text : C.line3, next ? 2.5 : 1.25);
  ctx.setLineDash([]);
  ctx.fillStyle = next ? C.text : C.text2;
  ctx.font = font(Math.max(13, sr * (String(v).length > 1 ? 0.75 : 0.9)), 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(v), cx, cy + 1);
  ctx.restore();
}

/** Show me's swipe: a soft rose-magenta arrow through (x, y), half length l, pointing the way the board slid. */
function drawSwipeArrow(ctx: CanvasRenderingContext2D, x: number, y: number, l: number, dir: Dir, alpha: number): void {
  const [ux, uy] = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
  const hd = l * 0.35;
  const tx = x + ux * l, ty = y + uy * l;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = `rgba(${HINT_RGB}, 0.95)`;
  ctx.shadowColor = `rgba(${HINT_RGB}, 0.8)`;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - ux * l, y - uy * l);
  ctx.lineTo(tx, ty);
  // The head: two strokes back from the tip, either side of the shaft.
  ctx.moveTo(tx - ux * hd - uy * hd, ty - uy * hd + ux * hd);
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx - ux * hd + uy * hd, ty - uy * hd - ux * hd);
  ctx.stroke();
  ctx.restore();
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export function sup(s: string): string {
  return s.split('').map((c) => SUP[c] ?? c).join('');
}

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Builds the nucleus of every element from helium to iron (hydrogen has nothing to gather). The sockets are the mass number of the element's most common isotope written in powers of two, so the number of sockets and their sizes set the difficulty. Par is a nucleon budget (about 0.7 swipes per nucleon), still a first guess: light elements are easy enough that random swiping often beats it. No cracks means a flawless build.</p>`;

// ---- rules ------------------------------------------------------------------------
//
// Each rule's pictures are stills of their last frame until the player taps Play. A swipe
// leaves a faint arrow under the row so the still says which way it went; what went wrong is
// flagged in amber (a crack keeps the board's own crack).

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Progress through [a, b] seconds, eased. */
const seg = (t: number, a: number, b: number) => ease(clamp01((t - a) / (b - a)));
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const cl = (v: number, spoiled = false) => ({ v, spoiled });

/** A row of four dashed board cells, as on the board. */
interface Row { cell: number; r: number; cy: number; x0: number; at: (n: number) => number }

function demoRow(ctx: CanvasRenderingContext2D, w: number, h: number, cy: number, cell: number): Row {
  const n = 4, x0 = (w - n * cell) / 2;
  ctx.save();
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  for (let i = 0; i < n; i++) ctx.strokeRect(x0 + i * cell + 3, cy - cell / 2 + 3, cell - 6, cell - 6);
  ctx.restore();
  return { cell, r: cell * 0.4, cy, x0, at: (i) => x0 + i * cell + cell / 2 };
}

/** A row alone, centered a little high to leave room for the swipe arrow. */
const plainRow = (ctx: CanvasRenderingContext2D, w: number, h: number) => demoRow(ctx, w, h, h * 0.42, Math.min(w / 4.6, h / 2.4));
/** Two sockets above, a row below. */
function nucleusRow(ctx: CanvasRenderingContext2D, w: number, h: number): Row & { sr: number; sx: [number, number]; sy: number } {
  const sr = Math.min(w / 9, h / 6.5);
  const row = demoRow(ctx, w, h, h * 0.62, Math.min(w / 4.6, h / 3.3));
  return { ...row, sr, sx: [w / 2 - sr * 1.4, w / 2 + sr * 1.4], sy: sr + 5 };
}

/** The swipe: a faint arrow under the row, with a fingertip running along it while k is between 0 and 1. */
function swipeArrow(ctx: CanvasRenderingContext2D, row: Row, k: number): void {
  const y = row.cy + row.cell * 0.62, x1 = row.at(3) + row.r * 0.6, x2 = row.at(0) - row.r * 0.6, hd = 4;
  ctx.save();
  ctx.strokeStyle = C.line3;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.moveTo(x2 + hd, y - hd);
  ctx.lineTo(x2, y);
  ctx.lineTo(x2 + hd, y + hd);
  ctx.stroke();
  if (k > 0 && k < 1) {
    ctx.globalAlpha = 0.6 * Math.sin(Math.PI * k);
    ctx.fillStyle = C.silver;
    ctx.beginPath();
    ctx.arc(x1 + (x2 - x1) * ease(k), y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A merged cluster's pop: a short swell as it forms. */
const popScale = (t: number, at: number) => 1 + 0.18 * Math.sin(Math.PI * clamp01((t - at) / 0.26));

/** The path a cluster flew from the board into its socket: a faint dotted arc. */
function flightArc(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, lift: number): void {
  ctx.save();
  ctx.fillStyle = C.line3;
  for (let k = 0.12; k < 0.9; k += 0.1) {
    ctx.beginPath();
    ctx.arc(mix(ax, bx, k), mix(ay, by, k) - Math.sin(Math.PI * k) * lift, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A cluster on its way from the board to a socket, shrinking to socket size. */
function fly(ctx: CanvasRenderingContext2D, v: number, ax: number, ay: number, bx: number, by: number, r: number, sr: number, lift: number, k: number): void {
  const e = ease(k);
  drawCluster(ctx, cl(v), mix(ax, bx, e), mix(ay, by, e) - Math.sin(Math.PI * e) * lift, mix(r, sr, e), 1, true);
}

/** The amber flag for two clusters that will not merge: a not-equal sign over the seam between them. */
function notEqual(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.4); ctx.lineTo(x + s, y - s * 0.4);
  ctx.moveTo(x - s, y + s * 0.4); ctx.lineTo(x + s, y + s * 0.4);
  ctx.moveTo(x + s * 0.5, y - s); ctx.lineTo(x - s * 0.5, y + s);
  ctx.stroke();
  ctx.restore();
}

/** The amber flag for a cluster that waits or has cracked: a dashed ring around it. */
function waitRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export const RULES: RuleCard[] = [
  {
    title: 'Swipe',
    text: 'Swipe, or press an arrow key, to slide every cluster as far as it goes. A new nucleon drops in after each swipe.',
    good: {
      duration: 2,
      caption: 'All slide left; a new 1 drops in',
      draw: (ctx, w, h, t) => {
        const row = plainRow(ctx, w, h), k = seg(t, 0.55, 0.95);
        swipeArrow(ctx, row, (t - 0.25) / 0.8);
        drawCluster(ctx, cl(2), mix(row.at(1), row.at(0), k), row.cy, row.r);
        drawCluster(ctx, cl(1), mix(row.at(3), row.at(1), k), row.cy, row.r);
        if (t > 1.2) drawCluster(ctx, cl(1), row.at(3), row.cy, row.r * seg(t, 1.2, 1.5));
      },
    },
  },
  {
    title: 'Merge',
    text: 'Two clusters of the same size that meet merge into one twice as big: 1 + 1 makes 2, 2 + 2 makes 4, and so on.',
    good: {
      duration: 1.8,
      caption: 'Two 2s make a 4',
      draw: (ctx, w, h, t) => {
        const row = plainRow(ctx, w, h), k = seg(t, 0.55, 0.95);
        swipeArrow(ctx, row, (t - 0.25) / 0.8);
        if (t < 0.95) {
          drawCluster(ctx, cl(2), mix(row.at(1), row.at(0), k), row.cy, row.r);
          drawCluster(ctx, cl(2), mix(row.at(3), row.at(0), k), row.cy, row.r);
        } else drawCluster(ctx, cl(4), row.at(0), row.cy, row.r * popScale(t, 0.95));
      },
    },
    bad: {
      duration: 1.8,
      caption: "A 2 and a 1 don't merge",
      draw: (ctx, w, h, t) => {
        const row = plainRow(ctx, w, h), k = seg(t, 0.55, 0.95);
        swipeArrow(ctx, row, (t - 0.25) / 0.8);
        drawCluster(ctx, cl(2), mix(row.at(1), row.at(0), k), row.cy, row.r);
        drawCluster(ctx, cl(1), mix(row.at(3), row.at(1), k), row.cy, row.r);
        if (t > 1.1) {
          ctx.save();
          ctx.globalAlpha = seg(t, 1.1, 1.4);
          notEqual(ctx, (row.at(0) + row.at(1)) / 2, row.cy - row.r - 6, 4);
          ctx.restore();
        }
      },
    },
  },
  {
    title: 'Clusters',
    text: 'A lone nucleon is a gray tile. Bigger clusters show their size, and their color climbs the spectrum as they grow: orange, yellow, green, cyan, blue, violet.',
    good: {
      duration: 1.6,
      caption: '1, 2, 4 and 8 nucleons',
      draw: (ctx, w, h, t) => {
        const cell = Math.min(w / 4.4, h / 2), cy = h / 2, r = cell * 0.42;
        const x0 = (w - 4 * cell) / 2;
        [1, 2, 4, 8].forEach((v, i) => {
          const k = seg(t, 0.2 + i * 0.3, 0.45 + i * 0.3);
          if (k > 0) drawCluster(ctx, cl(v), x0 + i * cell + cell / 2, cy, r * k);
        });
      },
    },
  },
  {
    title: 'The nucleus',
    text: 'The sockets at the top are the clusters the nucleus wants, largest first. The white one is wanted next; fill every socket to finish.',
    good: {
      duration: 2.2,
      caption: 'Largest first, until all are full',
      draw: (ctx, w, h, t) => {
        // Carbon-12: the 8, then the 4.
        const filled = t < 0.7 ? 0 : t < 1.5 ? 1 : 2;
        const sr = Math.min(w / 7, h / 3.4), gap = sr * 2 + sr * 0.8;
        const x0 = w / 2 - gap / 2;
        [8, 4].forEach((v, i) => {
          const state = i < filled ? 'filled' : i === filled ? 'next' : 'later';
          const s = i === filled - 1 ? popScale(t, i === 0 ? 0.7 : 1.5) : 1;
          drawSocket(ctx, x0 + i * gap, h / 2, sr * s, v, state);
        });
      },
    },
  },
  {
    title: 'Into the nucleus',
    text: 'Merge two clusters of half the size wanted next, and the new cluster flies up into its socket.',
    good: {
      duration: 2.4,
      caption: 'Two 4s fill the 8',
      draw: (ctx, w, h, t) => {
        const g = nucleusRow(ctx, w, h), k = seg(t, 0.55, 0.95), f = clamp01((t - 1.05) / 0.8);
        const inside = f >= 1;
        drawSocket(ctx, g.sx[0], g.sy, g.sr, 8, inside ? 'filled' : 'next');
        drawSocket(ctx, g.sx[1], g.sy, g.sr, 4, inside ? 'next' : 'later');
        swipeArrow(ctx, g, (t - 0.25) / 0.8);
        if (t < 0.95) {
          drawCluster(ctx, cl(4), mix(g.at(2), g.at(0), k), g.cy, g.r, 1, true);
          drawCluster(ctx, cl(4), g.at(0), g.cy, g.r, 1, true);
        } else if (!inside) fly(ctx, 8, g.at(0), g.cy, g.sx[0], g.sy, g.r, g.sr, h * 0.1, f);
        else flightArc(ctx, g.at(0), g.cy - g.r, g.sx[0], g.sy + g.sr, h * 0.06);
      },
    },
    bad: {
      duration: 2,
      caption: 'A 4 waits while the 8 is wanted',
      draw: (ctx, w, h, t) => {
        const g = nucleusRow(ctx, w, h), k = seg(t, 0.55, 0.95);
        drawSocket(ctx, g.sx[0], g.sy, g.sr, 8, 'next');
        drawSocket(ctx, g.sx[1], g.sy, g.sr, 4, 'later');
        swipeArrow(ctx, g, (t - 0.25) / 0.8);
        if (t < 0.95) {
          drawCluster(ctx, cl(2), mix(g.at(2), g.at(0), k), g.cy, g.r);
          drawCluster(ctx, cl(2), g.at(0), g.cy, g.r);
        } else drawCluster(ctx, cl(4), g.at(0), g.cy, g.r * popScale(t, 0.95));
        waitRing(ctx, g.at(0), g.cy, g.r + 4, seg(t, 1.3, 1.6));
      },
    },
  },
  {
    title: 'Cracks',
    text: 'A cluster bigger than anything still wanted cracks, and crumbles away on your next swipe. No cracks means a flawless build.',
    good: {
      duration: 2.4,
      caption: 'Two 1s make the 2 still wanted',
      draw: (ctx, w, h, t) => {
        // The 8 is in; only a 2 is still wanted.
        const g = nucleusRow(ctx, w, h), k = seg(t, 0.55, 0.95), f = clamp01((t - 1.05) / 0.8);
        const inside = f >= 1;
        drawSocket(ctx, g.sx[0], g.sy, g.sr, 8, 'filled');
        drawSocket(ctx, g.sx[1], g.sy, g.sr, 2, inside ? 'filled' : 'next');
        swipeArrow(ctx, g, (t - 0.25) / 0.8);
        if (t < 0.95) {
          drawCluster(ctx, cl(1), mix(g.at(2), g.at(0), k), g.cy, g.r, 1, true);
          drawCluster(ctx, cl(1), g.at(0), g.cy, g.r, 1, true);
        } else if (!inside) fly(ctx, 2, g.at(0), g.cy, g.sx[1], g.sy, g.r, g.sr, h * 0.1, f);
        else flightArc(ctx, g.at(0), g.cy - g.r, g.sx[1], g.sy + g.sr, h * 0.06);
      },
    },
    bad: {
      duration: 2,
      caption: 'Two 2s make a 4: too big, it cracks',
      draw: (ctx, w, h, t) => {
        const g = nucleusRow(ctx, w, h), k = seg(t, 0.55, 0.95);
        drawSocket(ctx, g.sx[0], g.sy, g.sr, 8, 'filled');
        drawSocket(ctx, g.sx[1], g.sy, g.sr, 2, 'next');
        swipeArrow(ctx, g, (t - 0.25) / 0.8);
        if (t < 0.95) {
          drawCluster(ctx, cl(2), mix(g.at(2), g.at(0), k), g.cy, g.r);
          drawCluster(ctx, cl(2), g.at(0), g.cy, g.r);
        } else drawCluster(ctx, cl(4, t > 1.25), g.at(0), g.cy, g.r * popScale(t, 0.95));
        waitRing(ctx, g.at(0), g.cy, g.r + 4, seg(t, 1.3, 1.6));
      },
    },
  },
];
