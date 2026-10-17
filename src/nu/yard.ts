// Three more of Nu's park games (park.ts), on the same kit:
//   Hop     Nu hops up from pad to pad; slide the finger to steer it. Cyan pads spring higher.
//           Down at the bottom and it's over.
//   Juggle  keep Nu up: tap near it to kick it into the air. It mustn't touch the floor.
//   Twin    Nu has a twin on the far side of the middle that goes where it goes, mirrored.
//           Catch photons with either; neither may touch red.

import {
  CYAN, GREEN, K300, K500, K800, NOTE_COLOURS, RED, ROSE, TAU, WHITE,
  anywhere, best, bounceIn, buzz, captureSound, chimeSound, clamp, completeSound, dist, dot, edge, inside, missSound, ring, finish, setBest, tickSound, hitSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';

function glow(ctx: CanvasRenderingContext2D, p: Pt, r: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
  ctx.shadowBlur = 10;
  dot(ctx, p, r, CYAN);
  ctx.restore();
}

/** Lives left, as small dots across the top (of the court, or of the arena). */
function lives(s: Stage, ctx: CanvasRenderingContext2D, left: number, of = 3): void {
  const top = s.court ? s.c.y - s.R + 22 : s.m.y - s.hh + 22;
  for (let i = 0; i < of; i++) {
    const p = { x: s.c.x + (i - (of - 1) / 2) * 16, y: top };
    if (i < left) dot(ctx, p, 4.5, WHITE, 0.85);
    else ring(ctx, p, 4.5, K500, 2, 0.8);
  }
}

/** A moving thing given a random heading at `speed`. */
function drift(p: Pt, speed: number): Mover {
  const a = Math.random() * TAU;
  return { x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
}

// ---- Hop -------------------------------------------------------------------------------------

const HOP_G = 0.0016;
const HOP_JUMP = 0.8;
const HOP_SPRING = 1.15;

/** Nu hops up from pad to pad, and the view climbs with it. Slide the finger left and right and
 *  Nu goes as far. Cyan pads (filled) throw it higher; higher up, some pads drift along a rail
 *  (white, with a hub). The score is how high it has climbed; down to the floor and it's over. */
export class Hop implements Toy {
  /** Pads and Nu in the climb's own space: y goes up as it goes negative; the view's top is at `cam`. */
  private pads: { x: number; y: number; r: number; vx: number; spring: boolean }[] = [];
  private x = 0;
  private y = 0;
  private vy = 0;
  private cam = 0;
  private from = 0;
  private height = 0;
  private grab: number | null = null;
  private want: number | null = null;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private floor(s: Stage): number { return s.m.y + s.hh; }

  private reset(s: Stage): void {
    this.cam = 0;
    this.x = s.nu.x;
    this.y = s.nu.y;
    this.vy = -0.6;
    this.from = this.y;
    this.height = 0;
    this.overAt = 0;
    this.grab = this.want = null;
    this.pads = [{ x: this.x, y: Math.min(this.y + 40, this.floor(s) - 24), r: 20, vx: 0, spring: false }];
    this.more(s);
    s.score(0, best(s, 'hop') || null);
  }

  /** Pads up to a screen above the view. */
  private more(s: Stage): void {
    const top = this.cam - s.hh * 2;
    let last = this.pads[this.pads.length - 1];
    while (last.y > top) {
      const climb = this.from - last.y;
      const gap = 60 + Math.random() * Math.min(110, 50 + climb * 0.015);
      const moving = climb > 900 && Math.random() < 0.3, spring = !moving && Math.random() < 0.1;
      // Plain pads vary a little in size; springs and drifters keep the usual size.
      // Pads shrink as it climbs: from 20 px round to 11 by about 3600 px up.
      const r = Math.max(11, 20 - climb * 0.0025) * (moving || spring ? 1 : 0.85 + Math.random() * 0.3);
      const x = s.m.x + (Math.random() * 2 - 1) * (s.hw - r - 12);
      last = { x, y: last.y - gap, r, vx: moving ? (Math.random() < 0.5 ? -1 : 1) * 0.06 : 0, spring };
      this.pads.push(last);
    }
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.overAt) { nu.x = this.x; nu.y = this.y - this.cam; return; }
    if (this.want !== null) this.x += clamp(this.want - this.x, -0.7 * dt, 0.7 * dt);
    this.x = clamp(this.x, s.m.x - s.hw + nu.r + 4, s.m.x + s.hw - nu.r - 4);
    for (const p of this.pads) {
      if (!p.vx) continue;
      p.x += p.vx * dt;
      if (Math.abs(p.x - s.m.x) > s.hw - p.r - 10) { p.vx *= -1; p.x = clamp(p.x, s.m.x - s.hw + p.r + 10, s.m.x + s.hw - p.r - 10); }
    }
    // Two half steps, so a fast fall can't pass through a pad.
    for (let k = 0; k < 2; k++) {
      const h = dt / 2, was = this.y;
      this.vy += HOP_G * h;
      this.y += this.vy * h;
      if (this.vy <= 0) continue;
      for (const p of this.pads) {
        const top = p.y - p.r * 0.6 - nu.r;
        if (was <= top && this.y >= top && Math.abs(this.x - p.x) < p.r + nu.r * 0.6) {
          this.y = top;
          this.vy = -(p.spring ? HOP_SPRING : HOP_JUMP);
          if (p.spring) { chimeSound(3); s.fx.ring({ x: p.x, y: p.y - this.cam }, CYAN, p.r, p.r + 16, 400); } else tickSound(1);
          nu.scale = 0.8;
          break;
        }
      }
    }
    nu.scale += (1 - nu.scale) * Math.min(1, dt / 120);
    // The view climbs to keep Nu out of the top third.
    const high = s.m.y - s.hh + s.hh * 0.75;
    if (this.y - this.cam < high) this.cam = this.y - high;
    // A point for every 16 px climbed.
    const h = Math.max(0, Math.round((this.from - this.y) / 16));
    if (h > this.height) { this.height = h; s.score(h, best(s, 'hop') || null); }
    this.pads = this.pads.filter((p) => p.y - this.cam < this.floor(s) + 60);
    this.more(s);
    // Down on the floor: over, and Nu stays there in view.
    if (this.y - this.cam + nu.r >= this.floor(s)) {
      this.y = this.floor(s) - nu.r + this.cam;
      this.overAt = now;
      missSound();
      buzz(22);
      finish(s, 'hop', this.height);
      s.score(this.height, best(s, 'hop') || null);
    }
    nu.x = this.x;
    nu.y = this.y - this.cam;
    nu.vx = nu.vy = 0;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // A drifting pad's rail first, under everything.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = K500;
    ctx.globalAlpha = 0.5;
    for (const p of this.pads) {
      if (!p.vx) continue;
      const y = p.y - this.cam, w = s.hw - p.r - 10;
      ctx.beginPath();
      ctx.moveTo(s.m.x - w, y);
      ctx.lineTo(s.m.x + w, y);
      ctx.stroke();
    }
    ctx.restore();
    for (const p of this.pads) {
      const at = { x: p.x, y: p.y - this.cam };
      if (p.spring) {
        // A spring: filled with cyan light.
        dot(ctx, at, p.r, CYAN, 0.35);
        ring(ctx, at, p.r - 1.5, CYAN, 3, 0.95);
      } else if (p.vx) {
        // A drifter: white, with a hub.
        dot(ctx, at, p.r, K800, 0.95);
        ring(ctx, at, p.r - 1.5, WHITE, 3, 0.9);
        dot(ctx, at, 3.5, WHITE, 0.9);
      } else {
        dot(ctx, at, p.r, K800, 0.95);
        ring(ctx, at, p.r - 1.5, K300, 3, 0.7);
      }
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.grab = this.x - p.x;
    this.want = p.x + this.grab;
  }

  move(_s: Stage, p: Pt): void { if (this.grab !== null) this.want = p.x + this.grab; }
  up(): void { this.grab = null; this.want = null; }
}

// ---- Juggle ----------------------------------------------------------------------------------

/** Juggle's fall: gentle at first, a little stronger with each kick, up to a cap (px/ms²). */
const JUGGLE_G = 0.0007;
const JUGGLE_G_MORE = 0.00002;
const JUGGLE_G_TOP = 0.0012;
/** Juggle moves in small fixed steps, so its arc is the same at any frame rate. */
const JUGGLE_STEP = 4;

/** Keep Nu in the air: tap near it to kick it up, and off to the side away from where you
 *  tapped. Off the walls and the ceiling it bounces; touching the floor ends the run. Each kick
 *  counts; it falls a little faster as you go. */
export class Juggle implements Toy {
  private b: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private state: 'ready' | 'run' | 'over' = 'ready';
  private count = 0;
  private overAt = 0;
  private kickAt = 0;
  /** The kick's speed, eased into over a few frames rather than all at once. */
  private kick: { vx: number; vy: number } | null = null;
  private spare = 0;

  enter(s: Stage): void {
    s.nu.r = 13;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.state = 'ready';
    this.count = 0;
    this.kick = null;
    this.spare = 0;
    s.score(0, best(s, 'juggle') || null);
  }

  private g(): number { return Math.min(JUGGLE_G_TOP, JUGGLE_G + this.count * JUGGLE_G_MORE); }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b;
    if (this.state === 'ready') {
      nu.seek({ x: s.m.x, y: s.m.y - s.hh * 0.25 + Math.sin(now / 400) * 6 }, dt, 0.5, 0.01);
      Object.assign(b, { x: nu.x, y: nu.y, vx: 0, vy: 0 });
      return;
    }
    if (this.state === 'over') return;
    this.spare += dt;
    while (this.spare >= JUGGLE_STEP && this.state === 'run') {
      this.spare -= JUGGLE_STEP;
      this.tick(s, JUGGLE_STEP, now);
    }
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
    nu.scale += (1 - nu.scale) * Math.min(1, dt / 180);
  }

  private tick(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b;
    if (this.kick) {
      // Most of the kick lands within about 60 ms.
      const k = 1 - Math.exp(-dt / 22);
      b.vx += (this.kick.vx - b.vx) * k;
      b.vy += (this.kick.vy - b.vy) * k;
      if (Math.abs(this.kick.vy - b.vy) < 0.01) this.kick = null;
    } else b.vy += this.g() * dt;
    // A little air, so sideways drift settles.
    b.vx *= Math.exp(-dt / 5000);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const e = edge(s, b);
    if (e.d + nu.r > 0 && e.ny > 0.6) {
      Object.assign(b, inside(s, b, nu.r));
      this.state = 'over';
      this.overAt = now;
      s.fx.ring({ x: b.x, y: b.y + nu.r }, RED, 6, 34, 600);
      missSound();
      buzz(22);
      finish(s, 'juggle', this.count);
      s.score(this.count, best(s, 'juggle') || null);
    } else if (bounceIn(s, b, nu.r, 0.85)) {
      tickSound(0);
      // Off the ceiling, the kick's done.
      this.kick = null;
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // The floor, faintly red: it mustn't land there.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = RED;
    ctx.fillRect(s.m.x - s.hw, s.m.y + s.hh - 8, s.hw * 2, 8);
    ctx.restore();
    if (now - this.kickAt < 260) ring(ctx, s.nu, s.nu.r + 4 + (now - this.kickAt) / 14, WHITE, 2, 0.5 * (1 - (now - this.kickAt) / 260));
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now(), nu = s.nu;
    if (this.state === 'over') return;
    if (dist(p, nu) > nu.r + 48) return;
    this.state = 'run';
    // Up about as high as a third of the arena and more, whatever the fall: v² = 2gh.
    const rise = clamp(s.hh * 0.8, 180, 320);
    const vy = -Math.sqrt(2 * this.g() * rise);
    // A falling Nu stops at once, then eases up to the kick's speed.
    this.b.vy = Math.min(this.b.vy, 0);
    this.kick = { vx: clamp(this.b.vx * 0.5 + (nu.x - p.x) * 0.01, -0.32, 0.32), vy };
    this.count++;
    this.kickAt = now;
    nu.scale = 0.88;
    captureSound();
    if (this.count % 10 === 0) completeSound();
    s.score(this.count, best(s, 'juggle') || null);
  }
}

// ---- Twin ------------------------------------------------------------------------------------

/** Nu has a twin across the middle of the arena: drag Nu (from anywhere) and the twin goes the
 *  mirror way. Photons are caught by either; a red antiparticle touching either ends the run.
 *  More reds as you go. */
export class Twin implements Toy {
  private grab: Pt | null = null;
  private want: Pt | null = null;
  private photons: Pt[] = [];
  private reds: Mover[] = [];
  private count = 0;
  private overAt = 0;
  private spawn = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private twin(s: Stage): Pt { return { x: 2 * s.m.x - s.nu.x, y: 2 * s.m.y - s.nu.y }; }

  private reset(s: Stage): void {
    this.count = 0;
    this.overAt = 0;
    this.reds = [];
    this.spawn = 2500;
    this.grab = this.want = null;
    this.photons = [];
    this.photons = [this.spot(s), this.spot(s)];
    s.score(0, best(s, 'twin') || null);
  }

  /** Somewhere clear of both. */
  private spot(s: Stage, far = 70): Pt {
    const t = this.twin(s);
    let p = anywhere(s, 26);
    for (let k = 0; k < 30 && (dist(p, s.nu) < far || dist(p, t) < far); k++) p = anywhere(s, 26);
    return p;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.overAt) return;
    if (this.want) {
      nu.seek(inside(s, this.want, nu.r + 2), dt, 1.1, 0.05);
      Object.assign(nu, inside(s, nu, nu.r));
    } else {
      nu.vx = nu.vy = 0;
    }
    const t = this.twin(s);
    for (let i = 0; i < this.photons.length; i++) {
      const q = this.photons[i];
      if (dist(nu, q) > nu.r + 9 && dist(t, q) > nu.r + 9) continue;
      this.count++;
      s.fx.burst(q, 6, CYAN, 0.1);
      captureSound();
      s.score(this.count, best(s, 'twin') || null);
      this.photons[i] = this.spot(s);
    }
    this.spawn -= dt;
    if (this.spawn <= 0 && this.reds.length < Math.min(6, 1 + Math.floor(this.count / 4))) {
      this.reds.push(drift(this.spot(s, 130), 0.06 + Math.random() * 0.05));
      this.spawn = 2500;
    }
    for (const q of this.reds) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      bounceIn(s, q, 6, 1);
      const hit = dist(nu, q) < nu.r + 5 ? nu : dist(t, q) < nu.r + 5 ? t : null;
      if (!hit) continue;
      this.overAt = now;
      this.want = null;
      s.fx.ring(hit, RED, 8, 36, 600);
      missSound();
      buzz(22);
      finish(s, 'twin', this.count);
      s.score(this.count, best(s, 'twin') || null);
      return;
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const q of this.photons) glow(ctx, q, 5 + Math.sin(now / 260) * 0.6);
    for (const q of this.reds) dot(ctx, q, 6, RED);
    const t = this.twin(s);
    ring(ctx, t, s.nu.r - 1.5, WHITE, 3, 0.85);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.grab = { x: s.nu.x - p.x, y: s.nu.y - p.y };
    this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y };
  }

  move(_s: Stage, p: Pt): void { if (this.grab) this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y }; }
  up(): void { this.grab = null; this.want = null; }
}
