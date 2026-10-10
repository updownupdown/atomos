// Drawing and touch for Slide Until Stop: swipe (or press an arrow, or tap a
// cell in line with the droplet) and the droplet skates until something stops
// it. Sparks it crosses go out, cracks it leaves break into rock, both shown
// as the droplet actually passes them.

import { allSparks, cellX, cellY, cloneSlideStop, cracksOf, isRock, slide, slideRun, solve, solved, type Dir, type SlideStopState, type Tile } from './slideStop';
import { bead, C, fitGrid, font, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView } from './view';

const SWIPE = 22;
const MS_PER_CELL = 55;
const TRAIL_MS = 420;
const STATUS_H = 22;

export const INSTRUCTIONS = `
<h3>How to play</h3>
<p>Bring the droplet to rest on the <b>red ring</b>.</p>
<ul>
  <li><b>Swipe</b> (or press an arrow key, or tap a cell in line with the droplet) and it slides that way until a <b>rock</b> or the edge stops it. It cannot stop halfway.</li>
  <li>Sliding over the ring does not count: it has to come to rest there.</li>
  <li><b>Sparks</b>: the droplet must pass over or stop on every spark first. Until then the ring is dashed; once they are all out it turns solid.</li>
  <li><b>Sticky patches</b> catch the droplet: it stops on one as soon as it slides onto it.</li>
  <li><b>Cracked ice</b> holds while the droplet is on it, but breaks into a rock as soon as the droplet leaves. Each crack can be crossed once.</li>
  <li><b>Arrows</b> are one-way: the droplet can only slide onto one moving the way it points. From any other side it is a wall. Leaving it is free.</li>
</ul>
<p>Undo takes back a slide, and repairs any crack it broke. If a broken crack leaves the ring out of reach, undo or restart.</p>
<h3>In the game</h3>
<p>Slide Until Stop opens each period of the table, so it is met at z 1, 3, 11, 19, 37, 55 and 87, and each gate brings something new: sparks at 3, sticky patches at 11, cracks at 19 (two sparks from here), arrows at 37, three sparks and three sticky patches at 55, three cracks and three arrows at 87.</p>
<p>The ice grows from 7 by 7 to 8 by 8 at z 30 and 9 by 9 at z 80. Par is the fewest slides that win, found by a search over the droplet's cell, the sparks collected and the cracks broken. The ring is placed where the shortest win is as long as the element's range allows, so par usually sits at the top of that range: 5 at the first gates, 7 at z 37, 9 at z 55, 12 at z 87 and up to 14 at the end of the table, with a floor that rises from 3 to 8. A maze is kept only when its shortest win uses every kind of tile on it.</p>
`;

interface Glide { from: number; to: number; path: number[]; prev: SlideStopState; at: number; ms: number }

export class SlideStopView implements PuzzleView {
  private state: SlideStopState;
  private history: SlideStopState[] = [];
  private pressed: Point | null = null;
  private glide: Glide | null = null;
  private bump = -1e9;
  private origin: Point = { x: 0, y: 0 };
  private cell = 0;
  private reduced: boolean;
  private reachCache: { state: SlideStopState; left: number | null } | null = null;

  constructor(private readonly initial: SlideStopState, reducedMotion: boolean) {
    this.state = cloneSlideStop(initial);
    this.reduced = reducedMotion;
  }

  /** Slides left to a win from here (cached per state), or null when none is left. */
  private left(): number | null {
    if (this.reachCache?.state !== this.state) this.reachCache = { state: this.state, left: solve(this.state)?.length ?? null };
    return this.reachCache.left;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return !this.won && this.left() === null; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'At rest on the ring';
    if (this.stuck) return 'Out of reach: undo or restart';
    const s = this.state;
    const left = s.sparks.length - popcount(s.got);
    if (left > 0) return left === 1 ? '1 spark left' : `${left} sparks left`;
    return 'Stop on the ring';
  }

  restart(): void {
    this.state = cloneSlideStop(this.initial);
    this.history = [];
    this.glide = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.glide = null;
    return true;
  }

  private go(dir: Dir): void {
    if (this.won) return;
    const run = slideRun(this.state, dir);
    const next = slide(this.state, dir);
    if (!next) { this.bump = performance.now(); return; }
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.glide = { from: this.state.pos, to: next.pos, path: run.path, prev: this.state, at: performance.now(), ms: Math.min(360, MS_PER_CELL * run.path.length) };
    this.state = next;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* read on release */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s) return;
    const dx = p.x - s.x, dy = p.y - s.y;
    if (Math.hypot(dx, dy) >= SWIPE) {
      this.go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      return;
    }
    if (!this.cell) return;
    // A tap in line with the droplet slides toward it.
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    const px = cellX(this.state, this.state.pos), py = cellY(this.state, this.state.pos);
    if (cx < 0 || cy < 0 || cx >= this.state.size || cy >= this.state.size) return;
    if (cx === px && cy !== py) this.go(cy > py ? 'down' : 'up');
    else if (cy === py && cx !== px) this.go(cx > px ? 'right' : 'left');
  }

  key(e: KeyboardEvent): boolean {
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    const dir = map[e.key];
    if (!dir) return false;
    this.go(dir);
    return true;
  }

  // ---- drawing --------------------------------------------------------------------

  private centre(i: number): Point {
    const n = this.state.size;
    return { x: this.origin.x + ((i % n) + 0.5) * this.cell, y: this.origin.y + (Math.floor(i / n) + 0.5) * this.cell };
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const status = s.sparks.length > 0;
    const fit = fitGrid(area, s.size, s.size, { margin: 8, maxCell: 72, top: status ? STATUS_H : 0 });
    const c = fit.cell;
    this.cell = c;
    this.origin = { x: fit.x, y: fit.y };
    const side = c * s.size;

    // How far along the current slide the droplet is, in cells entered.
    const gl = this.glide && !this.reduced ? this.glide : null;
    const t = gl ? Math.min(1, (now - gl.at) / gl.ms) : 1;
    const along = gl ? ease(t) * gl.path.length : Infinity;
    // A cell of this slide's path counts as passed once the droplet is past its middle.
    const passed = (cell: number): boolean => {
      if (!gl) return true;
      if (cell === gl.from) return along >= 0.5;
      const j = gl.path.indexOf(cell);
      return j < 0 || along >= j + 1.5 || (j === gl.path.length - 1 && t >= 1);
    };
    const reached = (cell: number): boolean => {
      if (!gl) return true;
      const j = gl.path.indexOf(cell);
      return j < 0 || along >= j + 0.7;
    };

    // The ice.
    tile(ctx, this.origin.x, this.origin.y, side, side, c * 0.18, C.surface, null);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < s.size; k++) {
      ctx.moveTo(this.origin.x + k * c, this.origin.y);
      ctx.lineTo(this.origin.x + k * c, this.origin.y + side);
      ctx.moveTo(this.origin.x, this.origin.y + k * c);
      ctx.lineTo(this.origin.x + side, this.origin.y + k * c);
    }
    ctx.stroke();
    const bumped = now - this.bump < 200;
    tile(ctx, this.origin.x, this.origin.y, side, side, c * 0.18, null, bumped ? C.bad : C.line2, 1);

    // Tiles.
    const cracks = cracksOf(s);
    for (let i = 0; i < s.tiles.length; i++) {
      const t0 = s.tiles[i];
      const p = this.centre(i);
      if (t0 === '#') pebble(ctx, p.x, p.y, c * 0.36, i * 7 + s.size);
      else if (t0 === '~') sticky(ctx, p.x, p.y, c, i);
      else if (t0 === '%') {
        const brokenNow = isRock(s, i);
        const brokenBefore = gl ? (gl.prev.broken >> cracks.indexOf(i) & 1) === 1 : brokenNow;
        if (brokenNow && (brokenBefore || passed(i))) pebble(ctx, p.x, p.y, c * 0.36, i * 7 + s.size);
        else crack(ctx, p.x, p.y, c, i);
      } else if (t0 !== '.') arrow(ctx, p.x, p.y, c, t0);
    }

    // Sparks still out (those taken on this slide go out as the droplet reaches them).
    s.sparks.forEach((cell, k) => {
      const takenNow = (s.got >> k & 1) === 1;
      const takenBefore = gl ? (gl.prev.got >> k & 1) === 1 : takenNow;
      if (takenBefore || (takenNow && reached(cell))) return;
      const p = this.centre(cell);
      spark(ctx, p.x, p.y, c * 0.2, now);
    });

    // The goal ring: dashed while sparks remain, solid once it counts.
    const g = this.centre(s.goal);
    const open = s.got === allSparks(s);
    ctx.save();
    ctx.strokeStyle = C.target;
    ctx.lineWidth = Math.max(1.5, c * 0.05);
    if (!open) ctx.setLineDash([c * 0.09, c * 0.07]);
    ctx.beginPath();
    ctx.arc(g.x, g.y, c * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    if (this.won) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = C.target;
      ctx.fill();
    }
    ctx.restore();

    // The droplet, easing along its slide with a fading streak behind.
    const r = c * 0.26;
    let p = this.centre(s.pos);
    if (gl) {
      const from = this.centre(gl.from), to = this.centre(gl.to);
      const k = ease(t);
      p = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      const fade = 1 - Math.max(0, Math.min(1, (now - gl.at - gl.ms * 0.4) / TRAIL_MS));
      if (fade > 0) {
        ctx.save();
        ctx.globalAlpha = 0.3 * fade;
        ctx.strokeStyle = C.silver;
        ctx.lineWidth = r * 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      }
      if (t >= 1 && fade <= 0) this.glide = null;
    }
    bead(ctx, p.x, p.y, r, C.silver, { rim: C.pewter, glow: this.won ? C.silver : undefined });

    // Which ways can move, as small ticks at the droplet's sides, once settled.
    if (!this.won && t >= 1) {
      ctx.fillStyle = C.text3;
      const dirs: [Dir, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
      for (const [d, dx, dy] of dirs) {
        if (slideRun(s, d).end === s.pos) continue;
        ctx.beginPath();
        ctx.arc(p.x + dx * (r + c * 0.1), p.y + dy * (r + c * 0.1), Math.max(1.2, c * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (status) {
      const got = popcount(s.got);
      ctx.font = font(12);
      ctx.fillStyle = C.text2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`Sparks ${got} / ${s.sparks.length}`, this.origin.x + 2, this.origin.y - 6);
    }
  }
}

function popcount(v: number): number {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
}

/** A dark grainy pebble, its outline jittered by a small hash so no two match. */
export function pebble(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, salt: number): void {
  const h = (k: number) => { const t = Math.sin(salt * 12.9898 + k * 78.233) * 43758.5453; return t - Math.floor(t); };
  ctx.save();
  ctx.fillStyle = C.surface3;
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const n = 9;
  for (let k = 0; k <= n; k++) {
    const a = (k % n) / n * Math.PI * 2 + h(0) * 2;
    const rr = r * (0.8 + 0.2 * h(k % n + 1));
    const px = x + Math.cos(a) * rr * 1.06, py = y + Math.sin(a) * rr * 0.94;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.line2;
  for (let k = 0; k < 6; k++) {
    const a = h(20 + k) * Math.PI * 2, d = h(40 + k) * r * 0.55;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.6, r * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A sticky patch: a soft amber puddle with a few beads of tar. */
function sticky(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, salt: number): void {
  ctx.save();
  ctx.globalAlpha = 0.32;
  tile(ctx, x - c * 0.4, y - c * 0.4, c * 0.8, c * 0.8, c * 0.3, C.d);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = C.d;
  const spots: [number, number][] = [[-0.18, -0.12], [0.16, -0.16], [0.02, 0.06], [-0.14, 0.18], [0.19, 0.15]];
  spots.forEach(([dx, dy], k) => {
    if ((salt + k) % 5 === 0) return;
    ctx.beginPath();
    ctx.arc(x + dx * c, y + dy * c, c * 0.045, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

/** Cracked ice: a faint pane with a fork of fine cracks. */
function crack(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, salt: number): void {
  ctx.save();
  tile(ctx, x - c * 0.42, y - c * 0.42, c * 0.84, c * 0.84, c * 0.14, C.surface2, C.line2, 1);
  ctx.strokeStyle = C.line3;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  const f = salt % 2 ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x - c * 0.36, y - c * 0.1 * f);
  ctx.lineTo(x - c * 0.08, y + c * 0.04 * f);
  ctx.lineTo(x + c * 0.06, y - c * 0.12 * f);
  ctx.lineTo(x + c * 0.36, y - c * 0.02 * f);
  ctx.moveTo(x - c * 0.08, y + c * 0.04 * f);
  ctx.lineTo(x - c * 0.02, y + c * 0.34 * f);
  ctx.moveTo(x + c * 0.06, y - c * 0.12 * f);
  ctx.lineTo(x + c * 0.12, y - c * 0.36 * f);
  ctx.stroke();
  ctx.restore();
}

/** A one-way cell: a tinted pane with a chevron pointing the only way in. */
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, t: Tile): void {
  const [dx, dy] = t === '^' ? [0, -1] : t === 'v' ? [0, 1] : t === '<' ? [-1, 0] : [1, 0];
  ctx.save();
  ctx.globalAlpha = 0.18;
  tile(ctx, x - c * 0.42, y - c * 0.42, c * 0.84, c * 0.84, c * 0.14, C.p);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.p;
  ctx.lineWidth = Math.max(1.5, c * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const k = c * 0.16;
  for (const off of [-0.12, 0.12]) {
    const cx = x + dx * off * c, cy = y + dy * off * c;
    ctx.beginPath();
    ctx.moveTo(cx - dx * k + dy * k, cy - dy * k + dx * k);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - dx * k - dy * k, cy - dy * k - dx * k);
    ctx.stroke();
  }
  ctx.restore();
}

/** A spark: a small four-pointed star with a soft glow that breathes. */
function spark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, now: number): void {
  const breathe = 0.85 + 0.15 * Math.sin(now / 380);
  ctx.save();
  ctx.shadowColor = C.warn;
  ctx.shadowBlur = r * 1.4 * breathe;
  ctx.fillStyle = C.warn;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 ? r * 0.36 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
