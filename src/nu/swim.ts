// One of Nu's park games (park.ts), on the same kit:
//   Ripple  Nu floats on still water. Tap the water and a ripple spreads, pushing Nu away from
//           where it started; float Nu into the ring, as many times as you can before the rim
//           runs out.

import {
  CYAN, GREEN, K300, K500, RED, WHITE,
  anywhere, best, captureSound, bounceIn, buzz, chimeSound, clamp, completeSound, dashed, dist, dot, missSound, ring, finish, setBest, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';

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
      captureSound();
      s.score(this.count, best(s, 'ripple') || null);
      this.place(s);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // Each ripple a bright front ring with a fainter one following, and a mark where it started
    // while it's young.
    for (const w of this.waves) {
      const r = (now - w.t0) * RIPPLE_SPEED, f = 1 - r / RIPPLE_REACH;
      ring(ctx, w, r, CYAN, 4, 0.95 * f);
      if (r > 16) ring(ctx, w, r - 14, CYAN, 3, 0.45 * f);
      if (r < 60) dot(ctx, w, 5, CYAN, 0.8 * (1 - r / 60));
    }
    if (!this.overAt) {
      ring(ctx, this.goal, this.goal.r, WHITE, 3, 0.85);
      dot(ctx, this.goal, this.goal.r - 7, K500, 0.35);
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    // Over: the park's card starts it again (a preview, with no card, on the next tap).
    if (this.overAt) { if (!s.end && now - this.overAt > 1000) this.reset(s); return; }
    if (!this.start) this.start = now;
    // A few at a time at most: the water needs to settle.
    if (this.waves.length >= 4) return;
    this.waves.push({ x: p.x, y: p.y, t0: now });
    tickSound(2);
  }
}
