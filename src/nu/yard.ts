// Four more of Nu's park games (park.ts), on the same kit:
//   Hop     Nu hops up from pad to pad; slide the finger to steer it. Cyan pads spring higher.
//           Down at the bottom and it's over.
//   Juggle  keep Nu up: tap near it to kick it into the air. It mustn't touch the floor.
//   Pull    Nu circles a nucleus on one of four rings; hold to burn and swing out (or in) to
//           another ring, catching the photons riding them and missing the reds.
//   Twin    Nu has a twin on the far side of the middle that goes where it goes, mirrored.
//           Catch photons with either; neither may touch red.

import {
  CYAN, GREEN, K300, K500, K800, NOTE_COLOURS, RED, ROSE, TAU, WHITE,
  anywhere, best, bounceIn, buzz, captureSound, chimeSound, clamp, completeSound, dist, dot, edge, inside, missSound, ring, finish, setBest, tickSound,
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
      const r = Math.max(14, 20 - climb * 0.001) * (moving || spring ? 1 : 0.85 + Math.random() * 0.3);
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
    const h = Math.max(0, Math.round((this.from - this.y) / 10));
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
    chimeSound(this.count % 5);
    if (this.count % 10 === 0) completeSound();
    s.score(this.count, best(s, 'juggle') || null);
  }
}

// ---- Pull ------------------------------------------------------------------------------------

/** Pull's rings, as parts of the court's radius, and the nucleus. */
const PULL_RINGS = [0.3, 0.48, 0.66, 0.84];
const PULL_CORE = 0.08;
/** Nu starts on this ring, which takes PULL_LAP ms to go round. */
const PULL_HOME = 1;
const PULL_LAP = 3800;
/** Physics in small fixed steps, so the orbits hold. */
const PULL_STEP = 4;
/** How hard a burn pushes: a second's hold changes the speed by a fifth. */
const PULL_BURN = 0.2;
/** How round, and how near a ring, an orbit must be for Nu to settle on that ring: forgiving
 *  for a new ring, strict for the one it left (so a small burn there isn't undone). */
const PULL_ROUND = 0.12;
const PULL_ROUND_HOME = 0.04;
const PULL_NEAR = 0.06;

/** Something riding a ring: a photon or a red, at angle `a`, turning at `w` (rad/ms). */
type Rider = { k: number; a: number; w: number };

/** Nu circles the nucleus on one of four faint rings. Hold to burn: press outside Nu's ring to
 *  speed up, and the far side of its orbit swings out (the dotted line is where it will go, the
 *  small ring its far point); press inside to slow down and drop in. Out on the far side, burn
 *  again until that ring turns green and let go: Nu settles on it. Photons ride the rings, caught
 *  on touch (the dotted line marks it green when it will meet one); reds ride them too, and
 *  one touching Nu costs a life (the dotted line stops at a red ring where it would). */
export class Pull implements Toy {
  court = true;
  private b: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private photons: Rider[] = [];
  private reds: Rider[] = [];
  private press: Pt | null = null;
  private count = 0;
  private left = 3;
  private overAt = 0;
  /** After a hit, a moment when no red can hit again. */
  private safeUntil = 0;
  private spare = 0;
  /** The ring Nu has settled on, or -1 out between them. */
  private on = PULL_HOME;
  /** The ring Nu last left (or is on). */
  private from = PULL_HOME;
  /** Light on a ring Nu just settled on, by when. */
  private litAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private rr(s: Stage, k: number): number { return s.R * PULL_RINGS[k]; }
  /** The nucleus's pull (GM), set so the home ring takes PULL_LAP. */
  private gm(s: Stage): number { const r = this.rr(s, PULL_HOME), w = TAU / PULL_LAP; return r * r * r * w * w; }
  /** A round orbit's turning speed on ring `k` (rad/ms). */
  private spin(s: Stage, k: number): number { return Math.sqrt(this.gm(s) / this.rr(s, k) ** 3); }

  private reset(s: Stage): void {
    const r = this.rr(s, PULL_HOME), v = Math.sqrt(this.gm(s) / r);
    // Nu starts on its ring, going round anticlockwise (on screen).
    this.b = { x: s.c.x, y: s.c.y + r, vx: v, vy: 0 };
    s.nu.at(this.b);
    this.count = 0;
    this.left = 3;
    this.overAt = 0;
    this.safeUntil = 0;
    this.spare = 0;
    this.press = null;
    this.on = this.from = PULL_HOME;
    this.reds = [];
    this.photons = [];
    this.stock(s);
    s.score(0, best(s, 'pull') || null);
  }

  /** The ring nearest Nu now. */
  private near(s: Stage): number {
    const r = dist(this.b, s.c);
    let k = 0;
    for (let i = 1; i < PULL_RINGS.length; i++) if (Math.abs(this.rr(s, i) - r) < Math.abs(this.rr(s, k) - r)) k = i;
    return k;
  }

  /** Two photons waiting on rings away from Nu's, still at first and drifting later; and a red
   *  more for every four caught (up to four), starting across the court from Nu. */
  private stock(s: Stage): void {
    const home = this.near(s), nuA = Math.atan2(this.b.y - s.c.y, this.b.x - s.c.x);
    while (this.photons.length < 2) {
      const free = [0, 1, 2, 3].filter((k) => k !== home && this.photons.every((p) => p.k !== k));
      const k = free[Math.floor(Math.random() * free.length)];
      const drift = this.count < 3 ? 0 : Math.min(0.35, (this.count - 2) * 0.04);
      this.photons.push({ k, a: nuA + 0.8 + Math.random() * (TAU - 1.6), w: this.spin(s, k) * drift * (Math.random() < 0.5 ? -1 : 1) });
    }
    const want = Math.min(4, 1 + Math.floor(this.count / 4));
    while (this.reds.length < want) {
      const free = [0, 1, 2, 3].filter((k) => k !== home);
      free.sort((a, b) => this.reds.filter((q) => q.k === a).length - this.reds.filter((q) => q.k === b).length);
      const k = free[Math.random() < 0.6 ? 0 : Math.floor(Math.random() * free.length)];
      // Slower than a round orbit there, either way round.
      const w = this.spin(s, k) * (0.45 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1);
      this.reds.push({ k, a: nuA + Math.PI + (Math.random() - 0.5), w });
    }
  }

  private at(s: Stage, q: Rider, t = 0): Pt {
    const a = q.a + q.w * t, r = this.rr(s, q.k);
    return { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r };
  }

  /** The way a press burns: +1 speeding up (pressed outside Nu's ring), -1 slowing down. */
  private way(s: Stage, p: Pt): number { return dist(p, s.c) >= dist(this.b, s.c) ? 1 : -1; }

  /** One small step of Nu under the nucleus's pull (and a burn along its way, if pressed). */
  private fall(s: Stage, b: Mover, dt: number, burn: number): void {
    const dx = b.x - s.c.x, dy = b.y - s.c.y, r = Math.max(s.R * PULL_CORE, Math.hypot(dx, dy));
    const g = this.gm(s) / (r * r * r);
    b.vx -= dx * g * dt;
    b.vy -= dy * g * dt;
    if (burn) {
      const v = Math.hypot(b.vx, b.vy) || 1, t = Math.sqrt(this.gm(s) / r) * PULL_BURN / 1000 * burn;
      b.vx += (b.vx / v) * t * dt;
      b.vy += (b.vy / v) * t * dt;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  /** Nu bounces off the nucleus (losing nothing, so it can't settle there) and off the rim
   *  (losing a little). True if it did. */
  private bounce(s: Stage, b: Mover, r: number): boolean {
    const dx = b.x - s.c.x, dy = b.y - s.c.y, d = Math.hypot(dx, dy) || 1, core = s.R * PULL_CORE + r;
    if (d < core) {
      const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
      b.x = s.c.x + nx * core;
      b.y = s.c.y + ny * core;
      if (vn >= 0) return false;
      b.vx -= 2 * vn * nx;
      b.vy -= 2 * vn * ny;
      return true;
    }
    return bounceIn(s, b, r, 0.7);
  }

  /** The ring Nu's orbit now is round enough, and near enough, to settle on; or -1. */
  private settles(s: Stage, b: Mover): number {
    const gm = this.gm(s), x = b.x - s.c.x, y = b.y - s.c.y, r = Math.hypot(x, y);
    const e2 = (b.vx * b.vx + b.vy * b.vy) / 2 - gm / r;
    if (e2 >= 0) return -1;
    const a = -gm / (2 * e2), h = x * b.vy - y * b.vx, e = Math.sqrt(Math.max(0, 1 + (2 * e2 * h * h) / (gm * gm)));
    if (e > PULL_ROUND) return -1;
    for (let k = 0; k < PULL_RINGS.length; k++) {
      const rr = this.rr(s, k);
      if (Math.abs(a - rr) < s.R * PULL_NEAR && Math.abs(r - rr) < s.R * PULL_NEAR && (k !== this.from || e < PULL_ROUND_HOME)) return k;
    }
    return -1;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b;
    for (const q of this.reds) q.a += q.w * dt;
    for (const q of this.photons) q.a += q.w * dt;
    if (this.overAt) return;
    const burn = this.press ? this.way(s, this.press) : 0;
    this.spare += dt;
    while (this.spare >= PULL_STEP) {
      this.spare -= PULL_STEP;
      this.fall(s, b, PULL_STEP, burn);
      if (this.bounce(s, b, nu.r)) tickSound(0);
    }
    if (burn) this.on = -1;
    else {
      // Let go round enough near a ring: Nu settles on it, exactly.
      const k = this.settles(s, b);
      if (k >= 0) {
        const x = b.x - s.c.x, y = b.y - s.c.y, r = Math.hypot(x, y) || 1, rr = this.rr(s, k);
        const v = Math.sqrt(this.gm(s) / rr), turn = Math.sign(x * b.vy - y * b.vx) || 1;
        b.x = s.c.x + (x / r) * rr;
        b.y = s.c.y + (y / r) * rr;
        b.vx = (-y / r) * v * turn;
        b.vy = (x / r) * v * turn;
        if (this.on !== k) { chimeSound(k); this.litAt = now; }
        this.from = k;
      }
      this.on = k;
    }
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
    for (let i = 0; i < this.photons.length; i++) {
      const p = this.at(s, this.photons[i]);
      if (dist(p, nu) > nu.r + 8) continue;
      this.count++;
      s.fx.burst(p, 6, CYAN, 0.1);
      captureSound();
      s.score(this.count, best(s, 'pull') || null);
      this.photons.splice(i--, 1);
    }
    this.stock(s);
    if (now < this.safeUntil) return;
    for (const q of this.reds) {
      const p = this.at(s, q);
      if (dist(p, nu) > nu.r + 5) continue;
      this.left--;
      this.safeUntil = now + 1500;
      s.fx.ring(p, RED, 8, 36, 600);
      missSound();
      buzz(22);
      // That red goes back round, across the court.
      q.a += Math.PI;
      if (this.left <= 0) {
        this.overAt = now;
        this.press = null;
        finish(s, 'pull', this.count);
        s.score(this.count, best(s, 'pull') || null);
      }
      return;
    }
  }

  /** Where Nu will go if let be, about one orbit ahead: the way, its far point, the photons it
   *  will meet, and the red it would run into (where the way stops). */
  private ahead(s: Stage, now: number): { path: Pt[]; far: Pt | null; meets: Set<Rider>; hit: Pt | null; lo: number; hi: number } {
    const b = { ...this.b }, path: Pt[] = [{ x: b.x, y: b.y }], meets = new Set<Rider>(), r0 = dist(b, s.c);
    let turned = 0, last = Math.atan2(b.y - s.c.y, b.x - s.c.x), t = 0, far: Pt | null = null, fd = 0, hit: Pt | null = null;
    let lo = r0, hi = r0, gap = 0;
    const safe = now < this.safeUntil, reach = s.nu.r + 8, bump = s.nu.r + 5;
    for (let i = 0; i < 1600 && turned < TAU * 0.98; i++) {
      const px = b.x, py = b.y;
      this.fall(s, b, 8, 0);
      t += 8;
      if (this.bounce(s, b, s.nu.r)) break;
      const a = Math.atan2(b.y - s.c.y, b.x - s.c.x), r = Math.hypot(b.x - s.c.x, b.y - s.c.y);
      let da = a - last;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      turned += Math.abs(da);
      last = a;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      if (Math.abs(r - r0) > fd) { fd = Math.abs(r - r0); far = { x: b.x, y: b.y }; }
      for (const q of this.photons) if (!meets.has(q) && dist(this.at(s, q, t), b) < reach) meets.add(q);
      if (!safe || t > this.safeUntil - now) {
        const red = this.reds.find((q) => dist(this.at(s, q, t), b) < bump);
        if (red) { hit = { x: b.x, y: b.y }; path.push(hit); break; }
      }
      // A dot about every 11 px.
      gap += Math.hypot(b.x - px, b.y - py);
      if (gap >= 11) { gap = 0; path.push({ x: b.x, y: b.y }); }
    }
    return { path, far: fd > 6 ? far : null, meets, hit, lo, hi };
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const view = this.overAt ? null : this.ahead(s, now);
    // The rings, faintly: one the way reaches with a photon on it lights up, one Nu would settle
    // on if let go now turns green, and the one Nu has just settled on flashes.
    const ready = this.press && !this.overAt ? this.settles(s, this.b) : -1;
    for (let k = 0; k < PULL_RINGS.length; k++) {
      const rr = this.rr(s, k);
      if (k === ready && k !== this.from) { ring(ctx, s.c, rr, GREEN, 3, 0.7); continue; }
      const reached = !!view && this.on !== k && view.lo - 6 <= rr && view.hi + 6 >= rr && this.photons.some((p) => p.k === k);
      const flash = this.on === k ? clamp(1 - (now - this.litAt) / 700, 0, 1) : 0;
      ring(ctx, s.c, rr, reached ? CYAN : K500, reached ? 3 : 2, reached ? 0.45 + Math.sin(now / 180) * 0.1 : 0.45 + flash * 0.4);
    }
    // The nucleus.
    dot(ctx, s.c, s.R * PULL_CORE, K800, 1);
    ring(ctx, s.c, s.R * PULL_CORE - 1.5, K300, 3, 0.7);
    // Nu's way ahead, dotted and fading out; its far point; a red ring where it would hit.
    if (view) {
      const n = view.path.length;
      for (let i = 1; i < n; i++) dot(ctx, view.path[i], 1.6, WHITE, 0.55 * (1 - (i / n) * 0.7));
      if (view.far) ring(ctx, view.far, 6, WHITE, 2, 0.7);
      if (view.hit) ring(ctx, view.hit, 10, RED, 3, 0.8);
    }
    for (const q of this.photons) {
      const p = this.at(s, q);
      glow(ctx, p, 5 + Math.sin(now / 260) * 0.6);
      // On course: a green ring round it, beating.
      if (view?.meets.has(q)) ring(ctx, p, 11 + Math.sin(now / 120) * 2, GREEN, 3, 0.8);
    }
    const safe = now < this.safeUntil;
    for (const q of this.reds) dot(ctx, this.at(s, q), 6, RED, safe ? 0.5 : 1);
    // The burn: a short line from Nu along its way (ahead speeding up, behind slowing down).
    if (this.press && !this.overAt) {
      const nu = s.nu, v = Math.hypot(this.b.vx, this.b.vy) || 1, w = this.way(s, this.press);
      const ux = (this.b.vx / v) * w, uy = (this.b.vy / v) * w;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = WHITE;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(nu.x + ux * (nu.r + 4), nu.y + uy * (nu.r + 4));
      ctx.lineTo(nu.x + ux * (nu.r + 22), nu.y + uy * (nu.r + 22));
      ctx.stroke();
      ctx.restore();
      ring(ctx, this.press, 12, K300, 2, 0.5);
    }
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.press = p;
  }

  move(_s: Stage, p: Pt): void { if (this.press && !this.overAt) this.press = p; }
  up(): void { this.press = null; }
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
