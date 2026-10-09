// Drawing and touch for Slide Until Stop: swipe (or press an arrow) and the
// droplet skates until a rock or the edge stops it.

import { cellX, cellY, cloneSlideStop, reachable, slide, solve, solved, type Dir, type SlideStopState } from './slideStop';
import { droplet, ease, MONO, type Area, type Point, type PuzzleView } from './view';

const SWIPE = 22;
const MS_PER_CELL = 55;
const TRAIL_MS = 420;

interface Glide { from: number; to: number; at: number; ms: number }

export class SlideStopView implements PuzzleView {
  private state: SlideStopState;
  private history: SlideStopState[] = [];
  private pressed: Point | null = null;
  private glide: Glide | null = null;
  private bump = 0;
  private origin: Point = { x: 0, y: 0 };
  private cell = 40;
  private reduced: boolean;

  constructor(private readonly initial: SlideStopState, reducedMotion: boolean) {
    this.state = cloneSlideStop(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return !this.won && !reachable(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'Stopped on the ring. Nothing left to do.';
    if (this.stuck) return 'From here the ring is out of reach. Restart.';
    if (this.state.moves === 0) return `<span class="hl">Swipe</span> or press an arrow to slide. You only stop at a <span class="hl">rock</span> or the edge. Come to rest on the <span class="hl">red ring</span>: passing over it does not count.`;
    const left = solve(this.state)?.length ?? 0;
    return left === 1 ? 'One slide away.' : `Stop on the ring. It is ${left} slides from here at best.`;
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
    const next = slide(this.state, dir);
    if (!next) { this.bump = performance.now(); return; }
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    const dist = Math.abs(cellX(next, next.pos) - cellX(next, this.state.pos)) + Math.abs(cellY(next, next.pos) - cellY(next, this.state.pos));
    this.glide = { from: this.state.pos, to: next.pos, at: performance.now(), ms: Math.min(320, MS_PER_CELL * dist) };
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
    return { x: this.origin.x + (cellX(this.state, i) + 0.5) * this.cell, y: this.origin.y + (cellY(this.state, i) + 0.5) * this.cell };
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const side = Math.min(area.w, area.h) * 0.92;
    this.cell = side / s.size;
    this.origin = { x: area.x + (area.w - side) / 2, y: area.y + (area.h - side) / 2 };
    const r = this.cell * 0.26;

    // The ice: a faint grid with a hairline frame.
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < s.size; k++) {
      ctx.moveTo(this.origin.x + k * this.cell, this.origin.y);
      ctx.lineTo(this.origin.x + k * this.cell, this.origin.y + side);
      ctx.moveTo(this.origin.x, this.origin.y + k * this.cell);
      ctx.lineTo(this.origin.x + side, this.origin.y + k * this.cell);
    }
    ctx.stroke();
    const bumped = now - this.bump < 200;
    ctx.strokeStyle = bumped ? 'rgba(224, 80, 58, 0.6)' : 'rgba(226, 220, 207, 0.28)';
    ctx.strokeRect(this.origin.x, this.origin.y, side, side);

    for (let i = 0; i < s.rocks.length; i++) if (s.rocks[i]) {
      const c = this.centre(i);
      pebble(ctx, c.x, c.y, this.cell * 0.36, i * 7 + s.size);
    }

    // The goal ring, the one red thing on the board.
    const g = this.centre(s.goal);
    ctx.strokeStyle = '#e0503a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(g.x, g.y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    if (this.won) {
      ctx.fillStyle = 'rgba(224, 80, 58, 0.18)';
      ctx.beginPath();
      ctx.arc(g.x, g.y, r + 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // The droplet, easing along its slide with a faint streak behind.
    let p = this.centre(s.pos);
    const gl = this.glide;
    if (gl && !this.reduced) {
      const t = (now - gl.at) / gl.ms;
      const from = this.centre(gl.from), to = this.centre(gl.to);
      const k = ease(t);
      p = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      const fade = 1 - Math.max(0, Math.min(1, (now - gl.at - gl.ms * 0.4) / TRAIL_MS));
      if (fade > 0) {
        const grad = ctx.createLinearGradient(from.x, from.y, p.x, p.y);
        grad.addColorStop(0, 'rgba(226, 220, 207, 0)');
        grad.addColorStop(1, `rgba(226, 220, 207, ${0.35 * fade})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = r * 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      if (t > 1 && fade <= 0) this.glide = null;
    }
    droplet(ctx, p.x, p.y, r, this.won);

    // Which ways can move, as small ticks at the droplet's sides, once settled.
    if (!this.won && (!gl || this.reduced || now - gl.at > gl.ms)) {
      ctx.fillStyle = 'rgba(226, 220, 207, 0.35)';
      const dirs: [Dir, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
      for (const [d, dx, dy] of dirs) {
        if (!slide(s, d)) continue;
        ctx.beginPath();
        ctx.arc(p.x + dx * (r + 7), p.y + dy * (r + 7), 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = 'rgba(226, 220, 207, 0.5)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`ice ${s.size}×${s.size}`, this.origin.x, this.origin.y - 6);
  }
}

/** A dark grainy pebble, its outline jittered by a small hash so no two match. */
export function pebble(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, salt: number): void {
  const h = (k: number) => { const t = Math.sin(salt * 12.9898 + k * 78.233) * 43758.5453; return t - Math.floor(t); };
  ctx.fillStyle = 'rgba(48, 46, 42, 1)';
  ctx.strokeStyle = 'rgba(226, 220, 207, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const n = 9;
  for (let k = 0; k <= n; k++) {
    const a = (k % n) / n * Math.PI * 2 + h(0) * 2;
    const rr = r * (0.78 + 0.22 * h(k % n + 1));
    const px = x + Math.cos(a) * rr * 1.08, py = y + Math.sin(a) * rr * 0.92;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(226, 220, 207, 0.16)';
  for (let k = 0; k < 6; k++) {
    const a = h(20 + k) * Math.PI * 2, d = h(40 + k) * r * 0.6;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}
