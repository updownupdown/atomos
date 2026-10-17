// Three more of Nu's park games (park.ts), all in the round court, on the same kit:
//   Flash   seven atoms, laid out like the logo; one lights up at a time: tap it before it
//           fades. Never tap a red one. Three misses and it's over.
//   Halo    the nucleus throws out photons; run Nu round the ring to catch them before they
//           escape. Red ones stay away from. Three lost and it's over. Steered from the ring
//           itself, or from the wheel under the court: turn it and Nu goes round as far.
//   Pulse   a wave spreads out from the nucleus with Nu riding it; tap as it crosses the
//           marked ring. Each catch, the ring moves, the band narrows and the wave speeds up.
//           Nu bounces on a catch as far as the tap was off: dead on, it hardly moves.

import {
  CYAN, GREEN, K300, K500, K800, K900, RED, TAU, WHITE,
  best, hitSound, buzz, captureSound, chimeSound, clamp, completeSound, dist, dot, missSound, ring, finish, setBest, tickSound,
  type Pt, type Stage, type Toy,
} from './kit';

/** Lives left, as small dots across the top of the court. */
function lives(s: Stage, ctx: CanvasRenderingContext2D, left: number, of = 3): void {
  for (let i = 0; i < of; i++) {
    const p = { x: s.c.x + (i - (of - 1) / 2) * 16, y: s.c.y - s.R + 22 };
    if (i < left) dot(ctx, p, 4.5, WHITE, 0.85);
    else ring(ctx, p, 4.5, K500, 2, 0.8);
  }
}

// ---- Flash -----------------------------------------------------------------------------------

/** Seven atoms like the logo's nucleus: one in the middle, six round it. One lights up at a
 *  time; tap it while it's lit and Nu darts to it. Now and then one lights red: leave it. */
export class Flash implements Toy {
  court = true;
  private nodes: Pt[] = [];
  private lit = -1;
  private red = false;
  private litAt = 0;
  private gap = 0;
  private hits = 0;
  private left = 3;
  private overAt = 0;
  private flyTo: Pt | null = null;
  private flash = new Map<number, { at: number; c: string }>();
  private lastLit = -1;

  enter(s: Stage): void {
    s.nu.r = 8;
    this.layout(s);
    this.reset(s);
  }

  resize(s: Stage): void { this.layout(s); }

  private layout(s: Stage): void {
    const r = s.R * 0.55;
    this.nodes = [{ ...s.c }, ...Array.from({ length: 6 }, (_, i) => {
      const a = -Math.PI / 2 + (i * TAU) / 6;
      return { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r };
    })];
  }

  private reset(s: Stage): void {
    this.hits = 0;
    this.left = 3;
    this.overAt = 0;
    this.lit = -1;
    this.gap = 700;
    this.flyTo = null;
    s.score(0, best(s, 'flash') || null);
  }

  /** How long a light stays on: shorter as you go. */
  private window(): number { return Math.max(480, 1300 - this.hits * 22); }

  private miss(s: Stage, now: number, at: number): void {
    this.left--;
    this.flash.set(at, { at: now, c: RED });
    missSound();
    buzz(25);
    if (this.left <= 0) {
      this.overAt = now;
      finish(s, 'flash', this.hits);
      s.score(this.hits, best(s, 'flash') || null);
    }
  }

  step(s: Stage, dt: number, now: number): void {
    s.nu.seek(this.flyTo ?? { x: s.c.x, y: s.c.y + s.R * 0.82 }, dt, 1.1, 0.05);
    if (this.overAt) return;
    if (this.lit >= 0) {
      if (now - this.litAt > this.window()) {
        // Faded: a missed cyan costs a life; a red left alone is right.
        const was = this.lit;
        this.lit = -1;
        this.gap = 250 + Math.random() * 450;
        if (!this.red) this.miss(s, now, was);
      }
      return;
    }
    this.gap -= dt;
    if (this.gap > 0) return;
    let k = Math.floor(Math.random() * this.nodes.length);
    if (k === this.lastLit) k = (k + 1 + Math.floor(Math.random() * 6)) % 7;
    this.lit = k;
    this.lastLit = k;
    this.red = this.hits > 4 && Math.random() < 0.18;
    this.litAt = now;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const R = s.R * 0.14;
    this.nodes.forEach((p, i) => {
      dot(ctx, p, R, K800);
      const f = this.flash.get(i), ft = f ? clamp(1 - (now - f.at) / 500, 0, 1) : 0;
      if (i === this.lit) {
        const t = clamp((now - this.litAt) / this.window(), 0, 1), c = this.red ? RED : CYAN;
        ctx.save();
        ctx.shadowColor = c;
        ctx.shadowBlur = 18;
        dot(ctx, p, R * (0.92 - 0.25 * t), c, 1 - 0.55 * t);
        ctx.restore();
      } else ring(ctx, p, R, K500, 2, 0.6);
      if (ft > 0) ring(ctx, p, R + 4, f!.c, 4, ft);
    });
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) { if (now - this.overAt > 1000) this.reset(s); return; }
    const i = this.nodes.findIndex((q) => dist(q, p) < s.R * 0.2);
    if (i < 0) return;
    this.flyTo = this.nodes[i];
    if (i === this.lit && !this.red) {
      this.hits++;
      this.lit = -1;
      this.gap = 200 + Math.random() * 400;
      this.flash.set(i, { at: now, c: GREEN });
      s.fx.burst(this.nodes[i], 6, CYAN, 0.1);
      // Pitched by where the atom sits, and a little by chance.
      hitSound((i + Math.random() * 0.8) / 6);
      s.score(this.hits, best(s, 'flash') || null);
      return;
    }
    if (i === this.lit) { this.lit = -1; this.gap = 500; }
    this.miss(s, now, i);
  }
}

// ---- Halo ------------------------------------------------------------------------------------

/** The nucleus throws photons outward; Nu runs round the ring after your finger to catch them.
 *  A red one caught, or a photon that gets past, costs a life. Under the court, a wheel: turn it
 *  and Nu goes round the ring just as far, with the finger off the ring it's watching. */
export class Halo implements Toy {
  court = true;
  controls = true;
  private a = -Math.PI / 2;
  private want: number | null = null;
  /** Turning the wheel: where the finger was round it. `want` is then not wrapped, so a quick
   *  turn of more than half a circle still goes the right way. */
  private turn: number | null = null;
  private wheel(s: Stage): { x: number; y: number; r: number } | null {
    const p = s.pad;
    if (!p) return null;
    return { x: p.x + p.w / 2, y: p.y + p.h / 2, r: clamp(Math.min(p.w, p.h) / 2 - 10, 34, 64) };
  }
  private shots: { a: number; r: number; v: number; red: boolean }[] = [];
  private caught = 0;
  private left = 3;
  private next = 0;
  private overAt = 0;
  private track(s: Stage): number { return s.R * 0.78; }

  enter(s: Stage): void {
    s.nu.r = 10;
    this.reset(s);
    s.nu.at(this.pos(s, this.a));
  }

  private reset(s: Stage): void {
    this.shots = [];
    this.caught = 0;
    this.left = 3;
    this.next = 600;
    this.overAt = 0;
    s.score(0, best(s, 'halo') || null);
  }

  /** Where Nu is round the ring, and how far either side of it (px along the ring) the paddle
   *  catches: twice Nu's width in all, and a photon's own size. */
  private at(s: Stage): number { return Math.atan2(s.nu.y - s.c.y, s.nu.x - s.c.x); }
  private reach(s: Stage): number { return 2 * s.nu.r + 4.5; }

  private pos(s: Stage, a: number, r = this.track(s)): Pt { return { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r }; }

  step(s: Stage, dt: number, now: number): void {
    // Nu runs round after the finger, no faster than it can.
    if (this.want !== null) {
      const d = this.turn !== null ? this.want - this.a : Math.atan2(Math.sin(this.want - this.a), Math.cos(this.want - this.a));
      const top = this.turn !== null ? 0.012 : 0.0075;
      this.a += clamp(d, -top * dt, top * dt);
    }
    s.nu.seek(this.pos(s, this.a), dt, 2, 0.2);
    if (this.overAt) return;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = Math.max(420, 1300 - this.caught * 18) * (0.7 + Math.random() * 0.6);
      this.shots.push({ a: Math.random() * TAU, r: s.R * 0.1, v: 0.06 + Math.min(0.08, this.caught * 0.002), red: this.caught > 3 && Math.random() < 0.25 });
    }
    const T = this.track(s), at = this.at(s), reach = this.reach(s);
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const q = this.shots[i], was = q.r;
      q.r += q.v * dt;
      // Crossing the ring: is Nu there?
      if (was < T && q.r >= T) {
        const near = Math.abs(Math.atan2(Math.sin(q.a - at), Math.cos(q.a - at))) * T < reach;
        if (near && !q.red) {
          this.caught++;
          this.shots.splice(i, 1);
          s.fx.ring(s.nu, CYAN, s.nu.r, s.nu.r + 18, 400);
          captureSound();
          s.score(this.caught, best(s, 'halo') || null);
          continue;
        }
        if (near && q.red) { this.shots.splice(i, 1); this.lose(s, now, s.nu); continue; }
      }
      if (q.r > s.R + 6) {
        this.shots.splice(i, 1);
        if (!q.red) this.lose(s, now, this.pos(s, q.a, s.R - 4));
      }
    }
  }

  private lose(s: Stage, now: number, at: Pt): void {
    this.left--;
    s.fx.ring(at, RED, 6, 26, 500);
    missSound();
    buzz(22);
    if (this.left <= 0) {
      this.overAt = now;
      this.shots = [];
      finish(s, 'halo', this.caught);
      s.score(this.caught, best(s, 'halo') || null);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ring(ctx, s.c, this.track(s), K500, 3, 0.7);
    dot(ctx, s.c, 9 + Math.sin(now / 300) * 1.2, K300, 0.85);
    for (const q of this.shots) {
      const p = this.pos(s, q.a, q.r);
      if (q.red) ring(ctx, p, 4.5, RED, 3);
      else {
        ctx.save();
        ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
        ctx.shadowBlur = 10;
        dot(ctx, p, 4.5, CYAN);
        ctx.restore();
      }
    }
    lives(s, ctx, this.left);
    // The paddle: a white arc on the ring under Nu, as wide as it catches.
    const T = this.track(s), half = (2 * s.nu.r - 2.5) / T, a = this.at(s);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = WHITE;
    ctx.globalAlpha = this.overAt ? 0.4 : 0.9;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(s.c.x, s.c.y, T, a - half, a + half);
    ctx.stroke();
    ctx.restore();
    s.nu.draw(ctx, now);
  }

  /** The wheel, drawn after the court's clip is gone (park.ts calls it with the whole arena). */
  drawPad(s: Stage, ctx: CanvasRenderingContext2D): void {
    const w = this.wheel(s);
    if (!w) return;
    dot(ctx, w, w.r, K900, 0.9);
    ring(ctx, w, w.r, this.turn !== null ? CYAN : K500, 3, 0.8);
    dot(ctx, w, 6, K300, 0.85);
    // The knob turns with Nu, on the wheel's rim.
    dot(ctx, { x: w.x + Math.cos(this.a) * w.r, y: w.y + Math.sin(this.a) * w.r }, 9, WHITE, 0.9);
  }

  private aim(s: Stage, p: Pt): void { this.want = Math.atan2(p.y - s.c.y, p.x - s.c.x); }

  down(s: Stage, p: Pt): void {
    // Over: the park's card starts it again (a preview, with no card, on the next tap).
    if (this.overAt) { if (!s.end && performance.now() - this.overAt > 1000) this.reset(s); return; }
    const w = this.wheel(s);
    if (w && dist(p, w) < w.r + 24) {
      this.turn = Math.atan2(p.y - w.y, p.x - w.x);
      this.want = this.a;
      return;
    }
    this.aim(s, p);
  }

  move(s: Stage, p: Pt): void {
    const w = this.wheel(s);
    if (this.turn === null || !w) { if (this.turn === null) this.aim(s, p); return; }
    // Near the middle the angle jumps about: hold still there.
    if (dist(p, w) < 8) return;
    const t = Math.atan2(p.y - w.y, p.x - w.x);
    this.want = (this.want ?? this.a) + Math.atan2(Math.sin(t - this.turn), Math.cos(t - this.turn));
    this.turn = t;
  }

  up(): void {
    // Let go of the wheel, Nu still finishes the turn; off the ring, it stops where it is.
    if (this.turn !== null) this.turn = null; else this.want = null;
  }
}

/** How long Nu takes to drop back to the new wave after a catch in Pulse. */
const BACK_MS = 260;

// ---- Pulse -----------------------------------------------------------------------------------

/** A wave spreads out from the nucleus, Nu riding it at the top. Tap as it crosses the marked
 *  band. Each catch moves the band, narrows it and quickens the wave; a miss ends the run. */
export class Pulse implements Toy {
  court = true;
  big = true;
  private r = 0;
  private speed = 0.09;
  private band = { r: 0, w: 0 };
  private streak = 0;
  private state: 'run' | 'over' = 'run';
  private overAt = 0;
  private hitAt = 0;
  /** The last catch: where Nu was, and how far off the tap was (0 dead on .. 1 the band's edge). */
  private from: Pt = { x: 0, y: 0 };
  private off = 0;

  enter(s: Stage): void {
    s.nu.r = 8;
    s.nu.scale = 1;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.streak = 0;
    this.speed = 0.09;
    this.state = 'run';
    this.place(s);
    this.r = s.R * 0.1;
    // From wherever Nu is onto the wave, smoothly.
    this.from = { x: s.nu.x, y: s.nu.y };
    this.hitAt = performance.now();
    this.off = 0;
    s.score(0, best(s, 'pulse') || null);
  }

  private place(s: Stage): void {
    const w = Math.max(10, 34 - this.streak * 1.5);
    this.band = { r: s.R * (0.32 + Math.random() * 0.52), w };
  }

  step(s: Stage, dt: number, now: number): void {
    if (this.state === 'over') {
      s.nu.seek({ x: s.c.x, y: s.c.y - s.R * 0.1 }, dt, 0.4, 0.02);
      return;
    }
    this.r += this.speed * dt;
    if (this.r > s.R) {
      // Let it go by: that's a miss too.
      this.end(s, now);
      return;
    }
    const nu = s.nu, ride = { x: s.c.x, y: s.c.y - this.r }, t = now - this.hitAt;
    if (t < BACK_MS) {
      // Back down to the new wave, smoothly, no overshoot.
      const k = 1 - (1 - t / BACK_MS) ** 3;
      nu.x = this.from.x + (ride.x - this.from.x) * k;
      nu.y = this.from.y + (ride.y - this.from.y) * k;
      nu.vx = nu.vy = 0;
      return;
    }
    // Then it bounces on the wave, as much as the tap was off.
    const u = t - BACK_MS, amp = (2 + this.off * 26) * Math.exp(-u / 320);
    const b = amp * Math.abs(Math.sin(u / 70));
    nu.x = ride.x;
    nu.y = ride.y - b;
    nu.vx = nu.vy = 0;
    nu.scale = 1 + (amp > 1 ? (0.5 - Math.abs(Math.sin(u / 70))) * 0.012 * amp : 0);
  }

  private end(s: Stage, now: number): void {
    this.state = 'over';
    s.nu.scale = 1;
    this.overAt = now;
    s.fx.ring(s.c, RED, this.r * 0.9, this.r + 10, 500);
    missSound();
    buzz(25);
    finish(s, 'pulse', this.streak);
    s.score(this.streak, best(s, 'pulse') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const b = this.band, glow = this.streak ? clamp(1 - (now - this.hitAt) / 400, 0, 1) : 0;
    ctx.save();
    ctx.globalAlpha = 0.18 + glow * 0.3;
    ctx.strokeStyle = glow > 0 ? GREEN : CYAN;
    ctx.lineWidth = b.w * 2;
    ctx.beginPath();
    ctx.arc(s.c.x, s.c.y, b.r, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ring(ctx, s.c, b.r, CYAN, 2, 0.6);
    dot(ctx, s.c, 8, K300, 0.85);
    if (this.state === 'run') ring(ctx, s.c, this.r, WHITE, 3, 0.85);
    s.nu.draw(ctx, now);
  }

  down(s: Stage): void {
    const now = performance.now();
    if (this.state === 'over') { if (now - this.overAt > 900) this.reset(s); return; }
    if (Math.abs(this.r - this.band.r) <= this.band.w) {
      this.streak++;
      this.hitAt = now;
      this.off = Math.abs(this.r - this.band.r) / this.band.w;
      this.from = { x: s.nu.x, y: s.nu.y };
      s.fx.ring(s.c, GREEN, this.r, this.r + 16, 450);
      captureSound();
      if (this.streak % 10 === 0) { completeSound(); buzz(14); }
      this.speed = Math.min(0.26, this.speed + 0.006);
      this.place(s);
      this.r = s.R * 0.1;
      s.score(this.streak, best(s, 'pulse') || null);
      return;
    }
    this.end(s, now);
  }
}
