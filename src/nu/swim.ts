// Two more of Nu's park games (park.ts), on the same kit:
//   Rally   in the round court Nu bounces about like a ball; keep it in with the paddle on the
//           rim, which follows the finger round. Faster each return, the paddle a little shorter.
//           Three let past and it's over.
//   Ripple  Nu floats on still water. Tap the water and a ripple spreads, pushing Nu away from
//           where it started; float Nu into the ring, as many times as you can before the rim
//           runs out.

import {
  CYAN, GREEN, K300, K500, RED, WHITE,
  anywhere, best, bounceIn, buzz, chimeSound, clamp, completeSound, dashed, dist, dot, missSound, ring, finish, setBest, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';

// ---- Rally -----------------------------------------------------------------------------------

/** Nu bounces round the court like a ball. A paddle on the rim follows the finger round (to
 *  wherever it points from the middle); Nu glances off it, faster each time and more steeply the
 *  nearer the paddle's end it hits. Let past three times and it's over. */
export class Rally implements Toy {
  court = true;
  private paddle = Math.PI / 2;
  private want: number | null = null;
  private ball: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private count = 0;
  private left = 3;
  /** Waiting to serve again from the middle, until then. */
  private serveAt = 0;
  private overAt = 0;
  private half(): number { return Math.max(0.3, 0.55 - this.count * 0.008); }
  private wall(s: Stage): number { return s.R - 12; }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.count = 0;
    this.left = 3;
    this.overAt = 0;
    this.serve(s);
    s.score(0, best(s, 'rally') || null);
  }

  private serve(s: Stage): void {
    this.serveAt = performance.now() + 700;
    this.ball = { x: s.nu.x, y: s.nu.y, vx: 0, vy: 0 };
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.ball;
    if (this.want !== null) {
      const d = Math.atan2(Math.sin(this.want - this.paddle), Math.cos(this.want - this.paddle));
      this.paddle += clamp(d, -0.012 * dt, 0.012 * dt);
    }
    if (this.overAt) { nu.seek(s.c, dt, 0.4, 0.02); return; }
    if (now < this.serveAt) {
      // Back to the middle, then off toward the paddle's side, a little askew.
      nu.seek(s.c, dt, 0.5, 0.02);
      b.x = nu.x;
      b.y = nu.y;
      const a = this.paddle + (Math.random() - 0.5) * 0.9, v = 0.17 + Math.min(0.15, this.count * 0.006);
      b.vx = Math.cos(a) * v;
      b.vy = Math.sin(a) * v;
      return;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const dx = b.x - s.c.x, dy = b.y - s.c.y, r = Math.hypot(dx, dy) || 1;
    if (r + nu.r > this.wall(s)) {
      const nx = dx / r, ny = dy / r, at = Math.atan2(dy, dx);
      const off = Math.atan2(Math.sin(at - this.paddle), Math.cos(at - this.paddle));
      if (Math.abs(off) <= this.half() + nu.r / s.R) {
        b.x = s.c.x + nx * (this.wall(s) - nu.r);
        b.y = s.c.y + ny * (this.wall(s) - nu.r);
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          let vx = b.vx - 2 * vn * nx, vy = b.vy - 2 * vn * ny;
          // Off the paddle's end, it goes off at more of a slant.
          const turn = (off / this.half()) * 0.45, sp = Math.min(0.42, Math.hypot(vx, vy) * 1.035);
          const a = Math.atan2(vy, vx) + turn;
          vx = Math.cos(a) * sp;
          vy = Math.sin(a) * sp;
          // Never along the rim: always back in toward the middle.
          if (vx * -nx + vy * -ny < sp * 0.35) { const k = Math.atan2(-ny, -nx) + clamp(turn, -0.9, 0.9); vx = Math.cos(k) * sp; vy = Math.sin(k) * sp; }
          b.vx = vx;
          b.vy = vy;
          this.count++;
          s.fx.ring(nu, CYAN, nu.r, nu.r + 16, 350);
          chimeSound(this.count % 5);
          s.score(this.count, best(s, 'rally') || null);
        }
      } else if (r > s.R + nu.r) {
        this.lose(s, now, { x: s.c.x + nx * s.R, y: s.c.y + ny * s.R });
      }
    }
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
  }

  private lose(s: Stage, now: number, at: Pt): void {
    this.left--;
    s.fx.ring(at, RED, 6, 30, 550);
    missSound();
    buzz(22);
    // It flies back in from where it went out (serve), never jumping.
    s.nu.vx = s.nu.vy = 0;
    if (this.left <= 0) {
      this.overAt = now;
      finish(s, 'rally', this.count);
      s.score(this.count, best(s, 'rally') || null);
      return;
    }
    this.serve(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    dashed(ctx, s.c, this.wall(s), K500, 0.5);
    dot(ctx, s.c, 8, K300, 0.5);
    ctx.save();
    ctx.strokeStyle = this.overAt ? K500 : WHITE;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(s.c.x, s.c.y, this.wall(s) + 5, this.paddle - this.half(), this.paddle + this.half());
    ctx.stroke();
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      const p = { x: s.c.x + (i - 1) * 16, y: s.c.y - s.R + 34 };
      if (i < this.left) dot(ctx, p, 4.5, WHITE, 0.85);
      else ring(ctx, p, 4.5, K500, 2, 0.8);
    }
    s.nu.draw(ctx, now);
  }

  private aim(s: Stage, p: Pt): void { if (dist(p, s.c) > 12) this.want = Math.atan2(p.y - s.c.y, p.x - s.c.x); }

  down(s: Stage, p: Pt): void {
    if (this.overAt) { if (performance.now() - this.overAt > 900) this.reset(s); return; }
    this.aim(s, p);
  }

  move(s: Stage, p: Pt): void { this.aim(s, p); }
  up(): void { this.want = null; }
}

// ---- Ripple ----------------------------------------------------------------------------------

const RIPPLE_MS = 40_000;
const RIPPLE_REACH = 260;
const RIPPLE_SPEED = 0.24;

/** Nu floats on still water. A tap starts a ripple, and as it passes Nu it pushes Nu away from
 *  where it started, the harder the nearer. Float Nu into the ring; each time, a new ring,
 *  smaller as you go. The rim counts the time down. */
export class Ripple implements Toy {
  private body: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private waves: { x: number; y: number; t0: number }[] = [];
  private goal = { x: 0, y: 0, r: 30 };
  private count = 0;
  private start = 0;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.body = { x: s.nu.x, y: s.nu.y, vx: 0, vy: 0 };
    this.waves = [];
    this.count = 0;
    this.start = 0;
    this.overAt = 0;
    this.place(s);
    s.rim = 1;
    s.score(0, best(s, 'ripple') || null);
  }

  private place(s: Stage): void {
    const r = Math.max(18, 32 - this.count * 1.2);
    let p = anywhere(s, r + 14);
    for (let k = 0; k < 30 && dist(p, this.body) < 140; k++) p = anywhere(s, r + 14);
    this.goal = { ...p, r };
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.body;
    if (this.overAt) { nu.seek(this.goal, dt, 0.3, 0.01); return; }
    // The clock starts with the first ripple.
    const left = this.start ? 1 - (now - this.start) / RIPPLE_MS : 1;
    s.rim = clamp(left, 0, 1);
    if (left <= 0) {
      this.overAt = now;
      completeSound();
      finish(s, 'ripple', this.count);
      s.score(this.count, best(s, 'ripple') || null);
      return;
    }
    const was = this.waves.map((w) => (now - dt - w.t0) * RIPPLE_SPEED);
    this.waves = this.waves.filter((w, i) => {
      const r = (now - w.t0) * RIPPLE_SPEED, d = dist(w, b);
      if (was[i] < d && r >= d && d < RIPPLE_REACH) {
        const k = 0.42 * (1 - d / RIPPLE_REACH) ** 0.7, n = d || 1;
        b.vx += ((b.x - w.x) / n) * k;
        b.vy += ((b.y - w.y) / n) * k;
      }
      return r < RIPPLE_REACH;
    });
    const drag = Math.exp(-dt / 1100);
    b.vx *= drag;
    b.vy *= drag;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (bounceIn(s, b, nu.r, 0.6)) tickSound(0);
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
    if (dist(b, this.goal) < this.goal.r - nu.r * 0.4) {
      this.count++;
      s.fx.ring(this.goal, GREEN, this.goal.r, this.goal.r + 20, 500);
      chimeSound(this.count % 5);
      s.score(this.count, best(s, 'ripple') || null);
      this.place(s);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const w of this.waves) {
      const r = (now - w.t0) * RIPPLE_SPEED;
      ring(ctx, w, r, CYAN, 3, 0.5 * (1 - r / RIPPLE_REACH));
    }
    if (!this.overAt) {
      ring(ctx, this.goal, this.goal.r, WHITE, 3, 0.85);
      dot(ctx, this.goal, this.goal.r - 7, K500, 0.35);
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) { if (now - this.overAt > 1000) this.reset(s); return; }
    if (!this.start) this.start = now;
    // A few at a time at most: the water needs to settle.
    if (this.waves.length >= 4) return;
    this.waves.push({ x: p.x, y: p.y, t0: now });
    tickSound(2);
  }
}
