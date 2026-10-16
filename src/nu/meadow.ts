// Six more of Nu's park games (park.ts), on the same kit:
//   Blast   red atoms drift in on Nu from the rim; tap and Nu fires a photon that way. One that
//           reaches Nu costs one of three lives.
//   Bumper  pinball: Nu drops onto the bumpers; tap left or right to flick that flipper. Down the
//           middle costs one of three balls.
//   Cross   Nu hops up across lanes of electrons going by; tap above Nu to hop on, beside it to
//           step aside. A touch sends it back to the bottom and costs a life.
//   Cue     pool: pull back from Nu and let go to shoot it; knock the atoms into the pockets.
//           Ten shots, and two more for each rack cleared. Nu in a pocket loses a shot.
//   Dodge   drag Nu clear of the red flying in from every side, for as long as you can.
//   Hue     tap to hop Nu up through the turning rings, only through their part in Nu's color.
//           The small dots change Nu's color. Fall, or touch another color, and it's over.

import {
  CYAN, GREEN, K300, K500, K800, NOTE_COLOURS, RED, TAU, WHITE,
  best, bounceIn, buzz, chimeSound, clamp, completeSound, dist, dot, finish, inside, missSound, ring, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';
import { bar, lives } from './lawn';

/** A ball off a segment (a flipper, a guide): pushed out, bounced, and given the segment's own
 *  speed where it touches. True if it touched. */
function offSegment(b: Mover, r: number, a: Pt, c: Pt, k: number, surf?: (p: Pt) => Pt): boolean {
  const ex = c.x - a.x, ey = c.y - a.y, l2 = ex * ex + ey * ey || 1;
  const t = clamp(((b.x - a.x) * ex + (b.y - a.y) * ey) / l2, 0, 1);
  const q = { x: a.x + ex * t, y: a.y + ey * t }, d = dist(b, q);
  if (d >= r || d === 0) return false;
  const nx = (b.x - q.x) / d, ny = (b.y - q.y) / d;
  b.x = q.x + nx * r;
  b.y = q.y + ny * r;
  const sv = surf ? surf(q) : { x: 0, y: 0 };
  const rvx = b.vx - sv.x, rvy = b.vy - sv.y, vn = rvx * nx + rvy * ny;
  if (vn < 0) { b.vx -= (1 + k) * vn * nx; b.vy -= (1 + k) * vn * ny; }
  return true;
}

// ---- Blast -----------------------------------------------------------------------------------

/** Nu in the middle of the court, red atoms drifting in from the rim. Tap and Nu fires a photon
 *  toward the tap; it bursts the first red it meets. A red reaching Nu costs a life. They come
 *  faster and thicker as you go. */
export class Blast implements Toy {
  court = true;
  private reds: Mover[] = [];
  private shots: (Mover & { t0: number })[] = [];
  private nextAt = 0;
  private left = 3;
  private count = 0;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 11;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.reds = [];
    this.shots = [];
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    this.nextAt = performance.now() + 900;
    s.score(0, best(s, 'blast') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    s.nu.seek(s.c, dt, 0.5, 0.02);
    if (this.overAt) return;
    if (now >= this.nextAt) {
      this.nextAt = now + Math.max(420, 1500 - this.count * 30) * (0.7 + Math.random() * 0.6);
      const a = Math.random() * TAU, v = 0.035 + Math.min(0.05, this.count * 0.0012);
      const p = { x: s.c.x + Math.cos(a) * (s.R - 6), y: s.c.y + Math.sin(a) * (s.R - 6) };
      // Not quite straight at Nu.
      const aim = a + Math.PI + (Math.random() - 0.5) * 0.25;
      this.reds.push({ ...p, vx: Math.cos(aim) * v, vy: Math.sin(aim) * v });
    }
    for (const q of this.shots) { q.x += q.vx * dt; q.y += q.vy * dt; }
    this.shots = this.shots.filter((q) => dist(q, s.c) < s.R);
    for (let i = this.reds.length - 1; i >= 0; i--) {
      const r = this.reds[i];
      // Drawn in toward Nu, a little more as they near.
      const dx = s.c.x - r.x, dy = s.c.y - r.y, d = Math.hypot(dx, dy) || 1;
      r.vx += (dx / d) * 0.00002 * dt;
      r.vy += (dy / d) * 0.00002 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      const hit = this.shots.findIndex((q) => dist(q, r) < 14);
      if (hit >= 0) {
        this.shots.splice(hit, 1);
        this.reds.splice(i, 1);
        this.count++;
        s.fx.burst(r, 8, RED, 0.1);
        chimeSound(this.count % 5);
        s.score(this.count, best(s, 'blast') || null);
        continue;
      }
      if (d < s.nu.r + 8) {
        this.reds.splice(i, 1);
        this.left--;
        s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 30, 600);
        missSound();
        buzz(24);
        if (this.left <= 0) {
          this.overAt = now;
          finish(s, 'blast', this.count);
          s.score(this.count, best(s, 'blast') || null);
          return;
        }
      }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const r of this.reds) { dot(ctx, r, 9, RED, 0.25); ring(ctx, r, 7.5, RED, 3, 0.9); }
    for (const q of this.shots) dot(ctx, q, 4.5, CYAN);
    for (let i = 0; i < 3; i++) {
      const p = { x: s.c.x + (i - 1) * 16, y: s.c.y - s.R + 30 };
      if (i < this.left) dot(ctx, p, 4.5, WHITE, 0.85); else ring(ctx, p, 4.5, K500, 2, 0.8);
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) { if (now - this.overAt > 900) this.reset(s); return; }
    const dx = p.x - s.nu.x, dy = p.y - s.nu.y, d = Math.hypot(dx, dy);
    if (d < 4 || this.shots.length >= 4) return;
    this.shots.push({ x: s.nu.x, y: s.nu.y, vx: (dx / d) * 0.6, vy: (dy / d) * 0.6, t0: now });
    tickSound(2);
  }
}

// ---- Bumper ----------------------------------------------------------------------------------

/** Pinball. Nu drops in from the top and falls onto round bumpers that kick it away; each bump
 *  counts. Two flippers at the bottom: tap (or hold) the left or right half to flick that one.
 *  Down the gap between them and that ball is gone; three balls. */
export class Bumper implements Toy {
  private ball: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private bumps: (Pt & { r: number; at: number })[] = [];
  /** Each flipper's angle up from rest (0..1), held, and kicked until. */
  private flips = [{ up: 0, held: false, kick: 0, w: 0 }, { up: 0, held: false, kick: 0, w: 0 }];
  private serveAt = 0;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private L(s: Stage): number { return Math.min(78, s.hw * 0.5); }
  private floorY(s: Stage): number { return s.m.y + s.hh - 64; }

  /** A flipper's pivot and tip. */
  private flipper(s: Stage, side: 0 | 1): { p: Pt; tip: Pt; a: number } {
    const L = this.L(s), rest = 0.5, upA = -0.45, f = this.flips[side];
    const a0 = rest + (upA - rest) * f.up, gap = 20;
    const px = side ? s.m.x + gap + L * Math.cos(rest) : s.m.x - gap - L * Math.cos(rest), py = this.floorY(s);
    const a = side ? Math.PI - a0 : a0;
    return { p: { x: px, y: py }, tip: { x: px + Math.cos(a) * L, y: py + Math.sin(a) * L }, a };
  }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  resize(s: Stage): void { this.place(s); }

  private reset(s: Stage): void {
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    this.place(s);
    this.serve(s);
    s.score(0, best(s, 'bumper') || null);
  }

  private place(s: Stage): void {
    const w = s.hw, top = s.m.y - s.hh + 70, h = (this.floorY(s) - top) * 0.62;
    this.bumps = [
      { x: s.m.x, y: top + h * 0.25, r: 20, at: 0 },
      { x: s.m.x - w * 0.45, y: top + h * 0.45, r: 17, at: 0 },
      { x: s.m.x + w * 0.45, y: top + h * 0.45, r: 17, at: 0 },
      { x: s.m.x - w * 0.15, y: top + h * 0.8, r: 14, at: 0 },
      { x: s.m.x + w * 0.2, y: top + h * 0.75, r: 14, at: 0 },
    ];
  }

  private serve(s: Stage): void {
    this.serveAt = performance.now() + 800;
    this.ball = { x: s.nu.x, y: s.nu.y, vx: 0, vy: 0 };
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.ball;
    for (const f of this.flips) {
      const want = f.held || now < f.kick ? 1 : 0, was = f.up;
      f.up = want ? Math.min(1, f.up + dt * 0.016) : Math.max(0, f.up - dt * 0.007);
      f.w = (f.up - was) / Math.max(1, dt);
    }
    if (this.overAt) { nu.seek(s.m, dt, 0.4, 0.02); return; }
    if (now < this.serveAt) {
      const at = { x: s.m.x + (Math.random() - 0.5) * 30, y: s.m.y - s.hh + 36 };
      nu.seek(at, dt, 0.7, 0.03);
      this.ball = { x: nu.x, y: nu.y, vx: (Math.random() - 0.5) * 0.12, vy: 0 };
      return;
    }
    b.vy += 0.00055 * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0.85) { b.vx *= 0.85 / sp; b.vy *= 0.85 / sp; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y < this.floorY(s) + 10) bounceIn(s, b, nu.r, 0.7);
    for (const q of this.bumps) {
      const d = dist(q, b);
      if (d >= q.r + nu.r) continue;
      const nx = (b.x - q.x) / (d || 1), ny = (b.y - q.y) / (d || 1);
      b.x = q.x + nx * (q.r + nu.r);
      b.y = q.y + ny * (q.r + nu.r);
      const kick = Math.max(0.42, Math.hypot(b.vx, b.vy));
      b.vx = nx * kick;
      b.vy = ny * kick;
      if (now - q.at > 120) {
        q.at = now;
        this.count++;
        chimeSound(this.count % 5);
        s.score(this.count, best(s, 'bumper') || null);
      }
    }
    // The guides down to the flippers, then the flippers.
    const L = this.flipper(s, 0), R = this.flipper(s, 1), gy = this.floorY(s) - 80;
    offSegment(b, nu.r, { x: s.m.x - s.hw - 10, y: gy }, L.p, 0.3);
    offSegment(b, nu.r, { x: s.m.x + s.hw + 10, y: gy }, R.p, 0.3);
    ([L, R] as const).forEach((f, i) => {
      const w = this.flips[i].w * 0.95 * (i ? 1 : -1);
      if (offSegment(b, nu.r + 3, f.p, f.tip, 0.4, (q) => ({ x: -w * (q.y - f.p.y), y: w * (q.x - f.p.x) }))) tickSound(i);
    });
    if (b.y > s.m.y + s.hh - 4) {
      this.left--;
      s.fx.ring({ x: b.x, y: s.m.y + s.hh - 20 }, RED, 6, 34, 550);
      missSound();
      buzz(22);
      if (this.left <= 0) {
        this.overAt = now;
        finish(s, 'bumper', this.count);
        s.score(this.count, best(s, 'bumper') || null);
        return;
      }
      this.serve(s);
    }
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const q of this.bumps) {
      const lit = clamp(1 - (now - q.at) / 300, 0, 1);
      dot(ctx, q, q.r, K800, 0.9);
      ring(ctx, q, q.r - 1.5, lit ? CYAN : K300, 3, 0.6 + lit * 0.4);
      if (lit) dot(ctx, q, q.r * 0.45, CYAN, lit);
    }
    const L = this.flipper(s, 0), R = this.flipper(s, 1), gy = this.floorY(s) - 80;
    bar(ctx, s.m.x - s.hw - 10, gy, L.p.x, L.p.y, K500, 4, 0.9);
    bar(ctx, s.m.x + s.hw + 10, gy, R.p.x, R.p.y, K500, 4, 0.9);
    for (const f of [L, R]) bar(ctx, f.p.x, f.p.y, f.tip.x, f.tip.y, this.overAt ? K500 : WHITE, 10, 0.9);
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) { if (now - this.overAt > 900) this.reset(s); return; }
    const f = this.flips[p.x < s.m.x ? 0 : 1];
    f.held = true;
    f.kick = now + 160;
    tickSound(3);
  }

  up(): void { for (const f of this.flips) f.held = false; }
}

// ---- Cross -----------------------------------------------------------------------------------

/** Lanes across the arena, electrons going by in each, this way or that. Tap above Nu and it
 *  hops up a lane; tap beside it and it steps aside. Across to the top counts, and the lanes
 *  come again faster. A touch sends Nu back to the bottom and costs one of three lives. */
export class Cross implements Toy {
  private lanes: { y: number; v: number; xs: number[]; gap: number }[] = [];
  private row = 0;
  private col = 0;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private hitAt = 0;
  private step_ = 44;
  private rows(s: Stage): number { return Math.max(5, Math.floor((2 * s.hh - 70) / this.step_)); }
  private rowY(s: Stage, j: number): number { return s.m.y + s.hh - 26 - j * this.step_; }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  resize(s: Stage): void { this.build(s); }

  private reset(s: Stage): void {
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    this.col = s.m.x;
    this.build(s);
    this.row = 0;
    s.score(0, best(s, 'cross') || null);
  }

  private build(s: Stage): void {
    const n = this.rows(s);
    this.lanes = [];
    // Rows 1..n-2 have traffic, now and then a still one to rest in; the last row is the far side.
    for (let j = 1; j < n - 1; j++) {
      const rest = j % 4 === 0;
      const v = rest ? 0 : (j % 2 ? 1 : -1) * (0.05 + Math.random() * 0.05 + Math.min(0.08, this.count * 0.012));
      const gap = 70 + Math.random() * 70 - Math.min(20, this.count * 4), xs: number[] = [];
      if (!rest) for (let x = s.m.x - s.hw - Math.random() * gap; x < s.m.x + s.hw + gap; x += gap + Math.random() * 40) xs.push(x);
      this.lanes.push({ y: this.rowY(s, j), v, xs, gap });
    }
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, n = this.rows(s), to = { x: this.col, y: this.rowY(s, this.row) };
    nu.seek(to, dt, now - this.hitAt < 400 ? 0.6 : 0.9, 0.08);
    const x0 = s.m.x - s.hw - 30, x1 = s.m.x + s.hw + 30, span = x1 - x0;
    for (const l of this.lanes) {
      for (let i = 0; i < l.xs.length; i++) {
        l.xs[i] += l.v * dt;
        if (l.xs[i] > x1) l.xs[i] -= span;
        if (l.xs[i] < x0) l.xs[i] += span;
      }
    }
    if (this.overAt || now - this.hitAt < 600) return;
    for (const l of this.lanes) {
      if (Math.abs(l.y - nu.y) > 12) continue;
      if (l.xs.some((x) => Math.abs(x - nu.x) < nu.r + 8)) {
        this.left--;
        this.hitAt = now;
        this.row = 0;
        s.fx.ring(nu, RED, nu.r, nu.r + 30, 600);
        missSound();
        buzz(22);
        if (this.left <= 0) {
          this.overAt = now;
          finish(s, 'cross', this.count);
          s.score(this.count, best(s, 'cross') || null);
        }
        return;
      }
    }
    if (this.row >= n - 1 && Math.abs(nu.y - to.y) < 4) {
      this.count++;
      s.fx.ring(nu, GREEN, nu.r, nu.r + 34, 600);
      completeSound();
      s.score(this.count, best(s, 'cross') || null);
      this.build(s);
      this.row = 0;
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const n = this.rows(s);
    bar(ctx, s.m.x - s.hw, this.rowY(s, n - 1), s.m.x + s.hw, this.rowY(s, n - 1), GREEN, 6, 0.35);
    for (const l of this.lanes) {
      if (!l.v) { bar(ctx, s.m.x - s.hw, l.y, s.m.x + s.hw, l.y, K800, 20, 0.8); continue; }
      for (const x of l.xs) dot(ctx, { x, y: l.y }, 8, this.overAt ? K500 : RED, this.overAt ? 0.6 : 0.9);
    }
    lives(s, ctx, this.left);
    if (now - this.hitAt > 600 || Math.floor(now / 120) % 2) s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) { if (now - this.overAt > 900) this.reset(s); return; }
    const dx = p.x - s.nu.x, dy = p.y - s.nu.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 20) {
      this.col = clamp(this.col + Math.sign(dx) * 40, s.m.x - s.hw + 20, s.m.x + s.hw - 20);
    } else if (dy > 20 && this.row > 0) this.row--;
    else this.row = Math.min(this.rows(s) - 1, this.row + 1);
    tickSound(1);
  }
}

// ---- Cue -------------------------------------------------------------------------------------

const CUE_R = 11;

/** Pool. A rack of atoms, six pockets. Press anywhere, pull back and let go: Nu shoots off the
 *  other way, as hard as you pulled, and knocks atoms about. Each one pocketed counts. Ten shots,
 *  two more for each rack cleared; Nu down a pocket loses one. */
export class Cue implements Toy {
  private balls: Mover[] = [];
  private cue: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private from: Pt | null = null;
  private pull: Pt | null = null;
  private shots = 10;
  private count = 0;
  private overAt = 0;
  private moving = false;
  private sunkAt = 0;

  private pockets(s: Stage): Pt[] {
    const x = s.hw - 16, y = s.hh - 16;
    return [{ x: s.m.x - x, y: s.m.y - y }, { x: s.m.x + x, y: s.m.y - y }, { x: s.m.x - s.hw + 8, y: s.m.y }, { x: s.m.x + s.hw - 8, y: s.m.y }, { x: s.m.x - x, y: s.m.y + y }, { x: s.m.x + x, y: s.m.y + y }];
  }

  enter(s: Stage): void {
    s.nu.r = CUE_R;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.shots = 10;
    this.count = 0;
    this.overAt = 0;
    this.cue = { x: s.nu.x, y: s.nu.y, vx: 0, vy: 0 };
    this.rack(s);
    s.score(0, best(s, 'cue') || null);
  }

  private rack(s: Stage): void {
    this.balls = [];
    const top = { x: s.m.x, y: s.m.y - s.hh * 0.4 }, d = CUE_R * 2 + 1;
    for (let row = 0; row < 3; row++) for (let i = 0; i <= row; i++) this.balls.push({ x: top.x + (i - row / 2) * d, y: top.y - row * d * 0.87, vx: 0, vy: 0 });
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, c = this.cue, all = [c, ...this.balls];
    if (this.sunkAt) {
      // Nu climbs back out of the pocket to the spot.
      const spot = { x: s.m.x, y: s.m.y + s.hh * 0.5 };
      nu.seek(spot, dt, 0.6, 0.03);
      if (dist(nu, spot) < 3) { this.sunkAt = 0; Object.assign(c, { x: nu.x, y: nu.y, vx: 0, vy: 0 }); }
      return;
    }
    const f = Math.exp(-dt / 1300);
    let still = true;
    for (const b of all) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= f;
      b.vy *= f;
      if (Math.hypot(b.vx, b.vy) < 0.006) b.vx = b.vy = 0; else still = false;
      if (bounceIn(s, b, CUE_R, 0.8) && b === c) tickSound(0);
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j], d = dist(a, b);
        if (d >= 2 * CUE_R || d === 0) continue;
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d, o = (2 * CUE_R - d) / 2;
        a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
        const p = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (p > 0) { a.vx -= p * nx; a.vy -= p * ny; b.vx += p * nx; b.vy += p * ny; tickSound(1); }
      }
    }
    const pk = this.pockets(s);
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i], q = pk.find((p) => dist(p, b) < 18);
      if (!q) continue;
      this.balls.splice(i, 1);
      this.count++;
      s.fx.ring(q, GREEN, 8, 30, 500);
      chimeSound(this.count % 5);
      s.score(this.count, best(s, 'cue') || null);
    }
    const into = pk.find((p) => dist(p, c) < 16);
    if (into) {
      this.sunkAt = now;
      this.shots = Math.max(0, this.shots - 1);
      s.fx.ring(into, RED, 8, 30, 500);
      missSound();
      buzz(20);
      c.vx = c.vy = 0;
      nu.vx = nu.vy = 0;
      return;
    }
    nu.x = c.x;
    nu.y = c.y;
    nu.vx = c.vx;
    nu.vy = c.vy;
    if (this.moving && still) {
      this.moving = false;
      if (!this.balls.length) { this.shots += 2; completeSound(); this.rack(s); }
      if (this.shots <= 0 && !this.overAt) { this.overAt = now; finish(s, 'cue', this.count); s.score(this.count, best(s, 'cue') || null); }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const p of this.pockets(s)) dot(ctx, p, 17, '#000', 0.9);
    this.balls.forEach((b, i) => dot(ctx, b, CUE_R, NOTE_COLOURS[i % NOTE_COLOURS.length], 0.95));
    if (this.from && this.pull && !this.moving) {
      // The way Nu will go, as dots, longer the harder the pull.
      const dx = this.from.x - this.pull.x, dy = this.from.y - this.pull.y, d = Math.min(160, Math.hypot(dx, dy));
      const l = Math.hypot(dx, dy) || 1;
      for (let k = 1; k <= 6; k++) dot(ctx, { x: this.cue.x + (dx / l) * d * (k / 6), y: this.cue.y + (dy / l) * d * (k / 6) }, 2.6, WHITE, 0.7 - k * 0.07);
    }
    // Shots left, small dots across the top.
    for (let i = 0; i < this.shots; i++) dot(ctx, { x: s.m.x + (i - (this.shots - 1) / 2) * 11, y: s.m.y - s.hh + 22 }, 3.5, WHITE, 0.8);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) { if (performance.now() - this.overAt > 900) this.reset(s); return; }
    if (this.moving || this.sunkAt) return;
    this.from = p;
    this.pull = p;
  }

  move(_s: Stage, p: Pt): void { if (this.from) this.pull = p; }

  up(): void {
    if (!this.from || !this.pull) return;
    const dx = this.from.x - this.pull.x, dy = this.from.y - this.pull.y, d = Math.hypot(dx, dy);
    this.from = this.pull = null;
    if (d < 10 || this.moving || this.sunkAt) return;
    const v = Math.min(1.1, d * 0.0075);
    this.cue.vx = (dx / d) * v;
    this.cue.vy = (dy / d) * v;
    this.moving = true;
    this.shots--;
    tickSound(2);
  }
}

// ---- Dodge -----------------------------------------------------------------------------------

/** Drag Nu (from anywhere) clear of the red flying in from every side, straight across. They
 *  come thicker and faster. The count is the seconds you last. */
export class Dodge implements Toy {
  private reds: Mover[] = [];
  private grab: Pt | null = null;
  private want: Pt | null = null;
  private t = 0;
  private nextAt = 0;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.reds = [];
    this.t = 0;
    this.overAt = 0;
    this.nextAt = 0;
    s.score(0, best(s, 'dodge') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.want) { nu.seek(inside(s, this.want, nu.r + 2), dt, 0.9, 0.05); Object.assign(nu, inside(s, nu, nu.r)); } else if (!this.overAt) nu.seek(nu, dt);
    if (this.overAt) return;
    // The clock starts with the first touch.
    if (!this.grab && !this.t) return;
    this.t += dt;
    const was = Math.floor((this.t - dt) / 1000), sec = Math.floor(this.t / 1000);
    if (sec !== was) { s.score(sec, best(s, 'dodge') || null); tickSound(sec % 5); }
    this.nextAt -= dt;
    if (this.nextAt <= 0) {
      this.nextAt = Math.max(160, 650 - this.t / 60);
      const a = Math.random() * TAU, far = Math.hypot(s.hw, s.hh) + 20;
      const from = { x: s.m.x + Math.cos(a) * far, y: s.m.y + Math.sin(a) * far };
      // At Nu, or near it.
      const to = { x: nu.x + (Math.random() - 0.5) * 140, y: nu.y + (Math.random() - 0.5) * 140 };
      const d = dist(from, to) || 1, v = 0.12 + Math.min(0.14, this.t / 200_000) + Math.random() * 0.05;
      this.reds.push({ ...from, vx: ((to.x - from.x) / d) * v, vy: ((to.y - from.y) / d) * v });
    }
    for (const r of this.reds) { r.x += r.vx * dt; r.y += r.vy * dt; }
    this.reds = this.reds.filter((r) => Math.abs(r.x - s.m.x) < s.hw + 120 && Math.abs(r.y - s.m.y) < s.hh + 120);
    if (this.reds.some((r) => dist(r, nu) < nu.r + 5)) {
      this.overAt = now;
      this.want = null;
      s.fx.ring(nu, RED, nu.r, nu.r + 30, 600);
      missSound();
      buzz(26);
      const secs = Math.round(this.t / 100) / 10;
      finish(s, 'dodge', secs);
      s.score(Math.floor(secs), best(s, 'dodge') || null);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const r of this.reds) dot(ctx, r, 6, RED, this.overAt ? 0.4 : 0.9);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) { if (performance.now() - this.overAt > 900) this.reset(s); return; }
    this.grab = { x: s.nu.x - p.x, y: s.nu.y - p.y };
    this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y };
  }

  move(_s: Stage, p: Pt): void { if (this.grab) this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y }; }
  up(): void { this.grab = null; this.want = null; }
}

// ---- Hue -------------------------------------------------------------------------------------

const HUES = NOTE_COLOURS.slice(0, 4);

/** Rings stacked up the arena, each in four colors, turning. Nu wears one of the colors (the ring
 *  round it). Tap and Nu hops up; it falls between taps. It may pass a ring only where the ring is
 *  in its color. A small dot between rings changes Nu's color. Each ring passed counts; fall off
 *  the bottom, or touch another color, and it's over. */
export class Hue implements Toy {
  private y = 0;
  private vy = 0;
  private cam = 0;
  private hue = 0;
  private rings: { y: number; r: number; a: number; v: number; passed: boolean; swap: boolean }[] = [];
  private started = false;
  private count = 0;
  private overAt = 0;
  private base(s: Stage): number { return s.m.y + s.hh - 40; }

  enter(s: Stage): void {
    s.nu.r = 8;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.y = this.base(s);
    this.vy = 0;
    this.cam = 0;
    this.hue = Math.floor(Math.random() * 4);
    this.started = false;
    this.count = 0;
    this.overAt = 0;
    this.rings = [];
    for (let i = 0; i < 4; i++) this.add(s);
    s.score(0, best(s, 'hue') || null);
  }

  private add(s: Stage): void {
    const last = this.rings[this.rings.length - 1], r = Math.min(70, s.hw * 0.55);
    const y = last ? last.y - (r * 2 + 120) : this.base(s) - 200;
    const v = (Math.random() < 0.5 ? -1 : 1) * (0.0011 + Math.min(0.0012, this.rings.length * 0.00004));
    this.rings.push({ y, r, a: Math.random() * TAU, v, passed: false, swap: true });
  }

  /** The color of a ring at the bottom (dir 1) or top (-1) of it. */
  private colorAt(q: { a: number }, dir: number): number {
    const at = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    const k = ((((at - q.a) % TAU) + TAU) % TAU) / (TAU / 4);
    return Math.floor(k) % 4;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    for (const q of this.rings) q.a += q.v * dt;
    if (!this.started) {
      nu.seek({ x: s.m.x, y: this.base(s) }, dt, 0.6, 0.03);
      if (dist(nu, { x: s.m.x, y: this.base(s) }) < 2) this.y = this.base(s);
      return;
    }
    if (this.overAt) { nu.seek({ x: s.m.x, y: nu.y }, dt, 0.3, 0.02); return; }
    this.vy = Math.min(0.5, this.vy + 0.0012 * dt);
    this.y += this.vy * dt;
    // The view climbs with Nu, never back down.
    const high = s.m.y - s.hh * 0.1;
    if (this.y - this.cam < high) this.cam = this.y - high;
    nu.x = s.m.x;
    nu.y = this.y - this.cam;
    nu.vx = 0;
    nu.vy = this.vy;
    if (nu.y > s.m.y + s.hh + nu.r) return this.lose(s, now);
    for (const q of this.rings) {
      const d = this.y - q.y;
      // Passing one of its two crossings, top or bottom.
      if (Math.abs(Math.abs(d) - q.r) < 5 + nu.r * 0.7 && this.colorAt(q, Math.sign(d) || 1) !== this.hue) return this.lose(s, now);
      if (q.swap && this.y < q.y - q.r - 60) {
        q.swap = false;
        this.hue = (this.hue + 1 + Math.floor(Math.random() * 3)) % 4;
        tickSound(3);
      }
      if (!q.passed && this.y < q.y - q.r - 10) {
        q.passed = true;
        this.count++;
        chimeSound(this.count % 5);
        s.score(this.count, best(s, 'hue') || null);
        this.add(s);
      }
    }
    this.rings = this.rings.filter((q) => q.y - q.r - this.cam < s.m.y + s.hh + 40);
  }

  private lose(s: Stage, now: number): void {
    this.overAt = now;
    s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 30, 600);
    missSound();
    buzz(24);
    finish(s, 'hue', this.count);
    s.score(this.count, best(s, 'hue') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    ctx.lineWidth = 10;
    ctx.lineCap = 'butt';
    for (const q of this.rings) {
      const c = { x: s.m.x, y: q.y - this.cam };
      for (let k = 0; k < 4; k++) {
        ctx.strokeStyle = HUES[k];
        ctx.globalAlpha = this.overAt ? 0.4 : 0.95;
        ctx.beginPath();
        ctx.arc(c.x, c.y, q.r, q.a + (k * TAU) / 4 + 0.04, q.a + ((k + 1) * TAU) / 4 - 0.04);
        ctx.stroke();
      }
      if (q.swap) {
        // The color-changer, above the ring.
        const p = { x: s.m.x, y: q.y - q.r - 60 - this.cam };
        HUES.forEach((h, k) => dot(ctx, { x: p.x + Math.cos(now / 400 + (k * TAU) / 4) * 5, y: p.y + Math.sin(now / 400 + (k * TAU) / 4) * 5 }, 3.5, h));
      }
    }
    ctx.restore();
    if (!this.started) bar(ctx, s.m.x - 26, this.base(s) + 14, s.m.x + 26, this.base(s) + 14, K500, 4, 0.9);
    ring(ctx, s.nu, s.nu.r + 5, HUES[this.hue], 3.5, 0.95);
    s.nu.draw(ctx, now);
  }

  down(s: Stage): void {
    if (this.overAt) { if (performance.now() - this.overAt > 900) this.reset(s); return; }
    if (!this.started) { this.started = true; this.y = s.nu.y + this.cam; }
    this.vy = -0.42;
    tickSound(1);
  }
}

