// Drawing and touch for the Merge puzzle: a swipe slides the board; a cluster
// of the wanted size flies up into the nucleus.

import { ALL_SYMBOLS } from '../core/elements';
import { cloneMerge, jammed, slide, wanted, won, type Dir, type MergeState, type Tile } from './merge';
import { ease, MONO, type Area, type Point, type PuzzleView, type RuleCard } from './view';
import { C, font } from './palette';

const SLIDE_MS = 150;
const POP_MS = 260;
const FLY_MS = 520;
const SWIPE = 22;

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

  constructor(private readonly initial: MergeState, reducedMotion: boolean) {
    this.state = cloneMerge(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return won(this.state); }
  get stuck(): boolean { return jammed(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.spoils === 0; }

  hint(): string {
    const want = wanted(this.state);
    if (this.won) return 'Nucleus complete';
    if (this.stuck) return 'Jammed: restart';
    if (this.state.cells.some((c) => c?.spoiled)) return 'Cracked: it crumbles next swipe';
    return want === null ? '' : `Next: a ${want}`;
  }

  restart(): void {
    this.state = cloneMerge(this.initial);
    this.history = [];
    this.animAt = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.animAt = 0;
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
    const goalH = 84;
    const side = Math.min(area.w, area.h - goalH) * 0.94;
    const cell = side / n;
    const x0 = area.x + (area.w - side) / 2;
    const y0 = area.y + goalH + (area.h - goalH - side) / 2;
    const center = (i: number): Point => ({ x: x0 + (i % n) * cell + cell / 2, y: y0 + Math.floor(i / n) * cell + cell / 2 });
    const r = cell * 0.4;

    this.drawGoal(ctx, x0, y0 - goalH + 10, side, r);

    // The board: a faint ruled grid.
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    for (let i = 0; i < n * n; i++) {
      const c = center(i);
      ctx.strokeRect(c.x - cell / 2 + 3, c.y - cell / 2 + 3, cell - 6, cell - 6);
    }
    ctx.setLineDash([]);

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

  /** The nucleus being gathered: its name, and a socket per wanted cluster. */
  private drawGoal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, r: number): void {
    const s = this.state;
    const t = s.target;
    const sr = Math.min(r * 0.7, 26);
    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = C.text2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = `${sup(String(t.a))}${symbolOf(t.z)}`;
    ctx.font = `700 22px ${MONO}`;
    ctx.fillStyle = this.won ? C.accent : C.text;
    ctx.fillText(label, x + 4, y + 22);
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = C.text2;
    ctx.fillText(`${t.a} nucleons · ${t.z} p · ${t.a - t.z} n`, x + 4, y + 46);
    // Sockets, right-aligned, largest first.
    const gap = sr * 2 + 14;
    const total = s.sockets.length * gap;
    let cx = x + w - total + sr + 4;
    const cy = y + 34;
    this.socketAt = [];
    s.sockets.forEach((v, i) => {
      this.socketAt.push({ x: cx, y: cy });
      const filled = i < s.filled;
      const next = i === s.filled;
      drawSocket(ctx, cx, cy, sr, v, filled ? 'filled' : next ? 'next' : 'later');
      cx += gap;
    });
  }

  private drawTile(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, r: number, alpha: number, lit: boolean): void {
    drawCluster(ctx, tile, x, y, r, alpha, lit);
  }
}

/**
 * A cluster: a flat disc, gray for a lone nucleon and light for clusters, its
 * nucleons packed inside, the size in the middle, a crack when spoiled and a
 * red ring when lit.
 */
export function drawCluster(ctx: CanvasRenderingContext2D, tile: Pick<Tile, 'v' | 'spoiled'>, x: number, y: number, r: number, alpha = 1, lit = false): void {
  ctx.save();
  ctx.globalAlpha = alpha * (tile.spoiled ? 0.55 : 1);
  if (lit) {
    ctx.shadowColor = C.target;
    ctx.shadowBlur = r * 0.8;
  }
  // Flat card-table discs: a lone nucleon is gray, clusters are light tiles.
  ctx.fillStyle = tile.v === 1 ? C.pewter : tile.v === 2 ? C.silverDim : C.tile;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (tile.v > 1) drawNucleons(ctx, tile.v, x, y, r);
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
  if (lit) {
    ctx.strokeStyle = C.target;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  const label = String(tile.v);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (tile.v > 1) {
    ctx.fillStyle = C.tile;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (label.length > 1 ? 0.56 : 0.42), r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = C.tileInk;
  ctx.font = font(r * (label.length > 1 ? 0.62 : 0.8), 700);
  ctx.fillText(label, x, y + 1);
  ctx.restore();
}

/** A socket of the nucleus: filled with its cluster, a red ring when it is wanted next, dashed while it waits. */
export function drawSocket(ctx: CanvasRenderingContext2D, cx: number, cy: number, sr: number, v: number, state: 'filled' | 'next' | 'later'): void {
  if (state === 'filled') { drawCluster(ctx, { v, spoiled: false }, cx, cy, sr); return; }
  const next = state === 'next';
  ctx.save();
  ctx.strokeStyle = next ? C.target : C.line2;
  ctx.lineWidth = next ? 2 : 1;
  ctx.setLineDash(next ? [] : [3, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, sr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = next ? C.target : C.text3;
  ctx.font = `700 ${Math.round(sr * 0.8)}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(v), cx, cy + 1);
  ctx.restore();
}

/** The nucleons packed inside a cluster, in a sunflower spiral. */
function drawNucleons(ctx: CanvasRenderingContext2D, v: number, x: number, y: number, r: number): void {
  const count = Math.min(v, 64);
  const dot = Math.max(1.6, (r * 0.95) / Math.sqrt(count + 2));
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const k = (i + 0.5) / count;
    const rr = Math.sqrt(k) * (r - dot - 1);
    const a = i * golden;
    ctx.fillStyle = i % 2 ? C.neutron : C.proton;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, dot, 0, Math.PI * 2);
    ctx.fill();
  }
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export function sup(s: string): string {
  return s.split('').map((c) => SUP[c] ?? c).join('');
}

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Builds the nucleus of every element from helium to iron (hydrogen has nothing to gather). The sockets are the mass number of the element's most common isotope written in powers of two, so the number of sockets and their sizes set the difficulty. Par is a nucleon budget (about 0.7 swipes per nucleon), still a first guess: light elements are easy enough that random swiping often beats it. No cracks means a flawless build.</p>`;

// ---- rules ------------------------------------------------------------------------

/** A row of `n` dashed board cells, as on the board, centered at height cy. Returns the cell size and left edge. */
function demoRow(ctx: CanvasRenderingContext2D, w: number, cy: number, n: number, cell: number): number {
  const x0 = (w - n * cell) / 2;
  ctx.save();
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  for (let i = 0; i < n; i++) ctx.strokeRect(x0 + i * cell + 3, cy - cell / 2 + 3, cell - 6, cell - 6);
  ctx.restore();
  return x0;
}

/** A finger's swipe in the demos: a faint dot sliding along a short line. */
function swipeMark(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, k: number): void {
  if (k <= 0 || k >= 1) return;
  ctx.save();
  ctx.globalAlpha = 0.45 * Math.sin(Math.PI * k);
  ctx.fillStyle = C.silver;
  ctx.beginPath();
  ctx.arc(x + dx * ease(k), y + dy * ease(k), 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const at = (n: number, x0: number, cell: number) => x0 + n * cell + cell / 2;
const mix = (a: number, b: number, k: number) => a + (b - a) * ease(Math.max(0, Math.min(1, k)));

export const RULES: RuleCard[] = [
  {
    title: 'Swipe',
    text: 'Swipe, or press an arrow key, to slide every cluster as far as it goes. A new nucleon drops in after each swipe.',
    demo: (ctx, w, h, t) => {
      const T = t % 3;
      const cell = Math.min(w / 4.6, h / 2.4), cy = h * 0.42, r = cell * 0.4;
      const x0 = demoRow(ctx, w, cy, 4, cell);
      const k = (T - 0.6) / 0.4;
      drawCluster(ctx, { v: 2, spoiled: false }, mix(at(1, x0, cell), at(0, x0, cell), k), cy, r);
      drawCluster(ctx, { v: 1, spoiled: false }, mix(at(3, x0, cell), at(1, x0, cell), k), cy, r);
      if (T > 1.2) drawCluster(ctx, { v: 1, spoiled: false }, at(2, x0, cell), cy, r * ease(Math.min(1, (T - 1.2) / 0.3)));
      swipeMark(ctx, w * 0.7, cy + cell * 0.95, -w * 0.4, 0, (T - 0.3) / 0.7);
    },
  },
  {
    title: 'Merge',
    text: 'Two clusters of the same size that meet merge into one twice as big: 1 + 1 makes 2, 2 + 2 makes 4, and so on.',
    demo: (ctx, w, h, t) => {
      const T = t % 3;
      const cell = Math.min(w / 4.6, h / 2.4), cy = h * 0.5, r = cell * 0.4;
      const x0 = demoRow(ctx, w, cy, 4, cell);
      const k = (T - 0.6) / 0.4;
      if (T < 1) {
        drawCluster(ctx, { v: 2, spoiled: false }, mix(at(1, x0, cell), at(0, x0, cell), k), cy, r);
        drawCluster(ctx, { v: 2, spoiled: false }, mix(at(3, x0, cell), at(0, x0, cell), k), cy, r);
      } else {
        const pop = Math.min(1, (T - 1) / 0.26);
        drawCluster(ctx, { v: 4, spoiled: false }, at(0, x0, cell), cy, r * (1 + 0.18 * Math.sin(Math.PI * pop)));
      }
    },
  },
  {
    title: 'Clusters',
    text: 'A lone nucleon is a gray disc. Bigger clusters show their protons and neutrons, with the size in the middle.',
    demo: (ctx, w, h) => {
      const sizes = [1, 2, 4, 8];
      const cell = Math.min(w / 4.4, h / 2), cy = h / 2, r = cell * 0.42;
      const x0 = (w - 4 * cell) / 2;
      sizes.forEach((v, i) => drawCluster(ctx, { v, spoiled: false }, at(i, x0, cell), cy, r));
    },
  },
  {
    title: 'The nucleus',
    text: 'The sockets at the top are the clusters the nucleus wants, largest first. The red one is wanted next; fill every socket to finish.',
    demo: (ctx, w, h, t) => {
      // Carbon-12: an 8, then a 4, filling in turn.
      const filled = Math.floor((t % 4.5) / 1.5);
      const sr = Math.min(w / 7, h / 3.4), gap = sr * 2 + sr * 0.8;
      const x0 = w / 2 - gap / 2;
      [8, 4].forEach((v, i) => drawSocket(ctx, x0 + i * gap, h / 2, sr, v, i < filled ? 'filled' : i === filled ? 'next' : 'later'));
    },
  },
  {
    title: 'Into the nucleus',
    text: 'A red ring marks clusters half the size wanted next. Merge two of them and the new cluster flies up into its socket.',
    demo: (ctx, w, h, t) => {
      const T = t % 3.6;
      const sr = Math.min(w / 9, h / 6), cell = Math.min(w / 4.6, h / 3), r = cell * 0.4;
      const cy = h * 0.7, x0 = demoRow(ctx, w, cy, 4, cell);
      const sx = w / 2 - sr * 1.4, sy = sr + 4;
      const done = T > 1.9;
      drawSocket(ctx, sx, sy, sr, 8, done ? 'filled' : 'next');
      drawSocket(ctx, sx + sr * 2.8, sy, sr, 4, done ? 'next' : 'later');
      const k = (T - 0.6) / 0.4;
      if (T < 1) {
        drawCluster(ctx, { v: 4, spoiled: false }, mix(at(2, x0, cell), at(0, x0, cell), k), cy, r, 1, true);
        drawCluster(ctx, { v: 4, spoiled: false }, at(0, x0, cell), cy, r, 1, true);
      } else if (!done) {
        const f = ease((T - 1.1) / 0.8);
        const fx = at(0, x0, cell) + (sx - at(0, x0, cell)) * f, fy = cy + (sy - cy) * f - Math.sin(Math.PI * f) * h * 0.12;
        drawCluster(ctx, { v: 8, spoiled: false }, fx, fy, r * (1 - 0.5 * f), 1, true);
      }
    },
  },
  {
    title: 'Cracks',
    text: 'A cluster bigger than anything still wanted cracks, and crumbles away on your next swipe. No cracks means a flawless build.',
    demo: (ctx, w, h, t) => {
      const T = t % 4;
      const sr = Math.min(w / 9, h / 6), cell = Math.min(w / 4.6, h / 3), r = cell * 0.4;
      const cy = h * 0.7, x0 = demoRow(ctx, w, cy, 4, cell);
      const sx = w / 2 - sr * 1.4, sy = sr + 4;
      // The 8 is in; only a lone 1 is still wanted.
      drawSocket(ctx, sx, sy, sr, 8, 'filled');
      drawSocket(ctx, sx + sr * 2.8, sy, sr, 1, 'next');
      if (T < 0.9) {
        drawCluster(ctx, { v: 2, spoiled: false }, at(0, x0, cell), cy, r);
        drawCluster(ctx, { v: 2, spoiled: false }, mix(at(2, x0, cell), at(0, x0, cell), (T - 0.5) / 0.4), cy, r);
      } else if (T < 2.4) drawCluster(ctx, { v: 4, spoiled: true }, at(0, x0, cell), cy, r);
      else if (T < 3) drawCluster(ctx, { v: 4, spoiled: true }, at(0, x0, cell), cy, r * (1 - (T - 2.4) / 0.6), 1 - (T - 2.4) / 0.6);
      swipeMark(ctx, w * 0.7, cy - cell * 0.9, -w * 0.4, 0, (T - 0.2) / 0.6);
      swipeMark(ctx, w * 0.7, cy - cell * 0.9, -w * 0.4, 0, (T - 2.1) / 0.6);
    },
  },
];
