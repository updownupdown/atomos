// Four more of Nu's park games (park.ts), on the same kit:
//   Hop     Nu hops up from pad to pad; slide the finger to steer it. Cyan pads spring higher.
//           Down at the bottom and it's over.
//   Juggle  keep Nu up: tap near it to kick it into the air. It mustn't touch the floor.
//   Pull    Nu circles a nucleus on one of four rings; each tap is a small burn that swings the
//           far side of its orbit out (or in) to another ring, where a tap settles it; catch the
//           photons riding the rings and miss the reds.
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

// ---- Pull ------------------------------------------------------------------------------------

/** Pull's rings, as parts of its field (the arena less a margin, so the rings stretch to fill
 *  it, wide or tall), and the nucleus. */
const PULL_RINGS = [0.4, 0.6, 0.8, 1];
const PULL_CORE = 0.1;
/** Nu starts on this ring, which takes PULL_LAP ms to go round. */
const PULL_HOME = 1;
const PULL_LAP = 6000;
/** Physics in small fixed steps, so the orbits hold. */
const PULL_STEP = 4;
/** One tap's burn, as a part of a round orbit's speed where Nu is. */
const PULL_KICK = 0.035;
/** How near a ring Nu (and its far or near point) must be for a tap to settle it there. */
const PULL_SNAP = 0.06;
/** The field's edge, where Nu bounces. */
const PULL_RIM = 1.07;
/** How long the line of a burn shows. */
const PULL_BURN_MS = 300;

/** Something riding a ring: a photon or a red, at angle `a`, turning at `w` (rad/ms). */
type Rider = { k: number; a: number; w: number };
/** Pull's field on screen: its middle, and how far one part reaches across and down. */
type Field = { x: number; y: number; ax: number; ay: number };

/** An oval ring: one of Pull's rings, stretched to its field. */
function oval(ctx: CanvasRenderingContext2D, f: Field, k: number, c: string, w = 2, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.ellipse(f.x, f.y, f.ax * k, f.ay * k, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** Nu circles the nucleus on one of four rings that fill the arena. Each tap is one small burn:
 *  tap outside Nu's ring to speed up, and the far side of its orbit swings out; tap inside to
 *  slow down, and it drops in. The dotted line is where Nu goes next, the small ring its far
 *  point, and a ring that far point reaches shows white. When Nu comes round to a ring at its
 *  far (or near) point, the ring turns green: tap that way again and Nu settles on it. Photons
 *  ride the rings, caught on touch (the dotted line rings them green when it will meet one);
 *  reds ride them too, and one touching Nu costs a life (the dotted line stops at a red ring
 *  where it would). */
export class Pull implements Toy {
  /** Nu, in the field's own parts round the nucleus. */
  private b: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private photons: Rider[] = [];
  private reds: Rider[] = [];
  private count = 0;
  private left = 3;
  private overAt = 0;
  /** After a hit, a moment when no red can hit again. */
  private safeUntil = 0;
  private spare = 0;
  /** The ring Nu has settled on, or -1 out between them. */
  private on = PULL_HOME;
  /** Light on a ring Nu just settled on, by when. */
  private litAt = 0;
  /** The last burn: when, and which way (+1 out, -1 in). */
  private burnAt = 0;
  private burnWay = 1;
  /** Settling moves Nu onto its ring at once; on screen it eases there from this offset. */
  private slide = { x: 0, y: 0 };

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private field(s: Stage): Field { return { x: s.m.x, y: s.m.y + 10, ax: Math.max(40, s.hw - 26), ay: Math.max(40, s.hh - 42) }; }
  private scr(s: Stage, p: Pt): Pt { const f = this.field(s); return { x: f.x + p.x * f.ax, y: f.y + p.y * f.ay }; }
  /** The nucleus's pull (GM), set so the home ring takes PULL_LAP. */
  private gm(): number { const r = PULL_RINGS[PULL_HOME], w = TAU / PULL_LAP; return r * r * r * w * w; }
  /** A round orbit's turning speed on ring `k` (rad/ms). */
  private spin(k: number): number { return Math.sqrt(this.gm() / PULL_RINGS[k] ** 3); }

  private reset(s: Stage): void {
    const r = PULL_RINGS[PULL_HOME], v = Math.sqrt(this.gm() / r);
    // Nu starts at the bottom of its ring, going round anticlockwise (on screen).
    this.b = { x: 0, y: r, vx: v, vy: 0 };
    s.nu.at(this.scr(s, this.b));
    this.count = 0;
    this.left = 3;
    this.overAt = 0;
    this.safeUntil = 0;
    this.spare = 0;
    this.burnAt = 0;
    this.slide = { x: 0, y: 0 };
    this.on = PULL_HOME;
    this.reds = [];
    this.photons = [];
    this.stock();
    s.score(0, best(s, 'pull') || null);
  }

  /** The ring nearest Nu now. */
  private near(): number {
    const r = Math.hypot(this.b.x, this.b.y);
    let k = 0;
    for (let i = 1; i < PULL_RINGS.length; i++) if (Math.abs(PULL_RINGS[i] - r) < Math.abs(PULL_RINGS[k] - r)) k = i;
    return k;
  }

  /** Two photons waiting on rings away from Nu's, still at first and drifting later; and a red
   *  more for every four caught (up to four), starting across the field from Nu. */
  private stock(): void {
    const home = this.near(), nuA = Math.atan2(this.b.y, this.b.x);
    while (this.photons.length < 2) {
      const free = [0, 1, 2, 3].filter((k) => k !== home && this.photons.every((p) => p.k !== k));
      const k = free[Math.floor(Math.random() * free.length)];
      const drift = this.count < 3 ? 0 : Math.min(0.35, (this.count - 2) * 0.04);
      this.photons.push({ k, a: nuA + 0.8 + Math.random() * (TAU - 1.6), w: this.spin(k) * drift * (Math.random() < 0.5 ? -1 : 1) });
    }
    const want = Math.min(4, 1 + Math.floor(this.count / 4));
    while (this.reds.length < want) {
      const free = [0, 1, 2, 3].filter((k) => k !== home);
      free.sort((a, b) => this.reds.filter((q) => q.k === a).length - this.reds.filter((q) => q.k === b).length);
      const k = free[Math.random() < 0.6 ? 0 : Math.floor(Math.random() * free.length)];
      // Slower than a round orbit there, either way round.
      const w = this.spin(k) * (0.4 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1);
      this.reds.push({ k, a: nuA + Math.PI + (Math.random() - 0.5), w });
    }
  }

  /** Where a rider is on screen, `t` ms from now. */
  private at(s: Stage, q: Rider, t = 0): Pt {
    const a = q.a + q.w * t, r = PULL_RINGS[q.k];
    return this.scr(s, { x: Math.cos(a) * r, y: Math.sin(a) * r });
  }

  /** The orbit Nu is on: its size (half the long axis), how stretched (0 round), and how far
   *  out Nu is now. */
  private orbit(b: Mover): { a: number; e: number; r: number } {
    const gm = this.gm(), r = Math.hypot(b.x, b.y), en = (b.vx * b.vx + b.vy * b.vy) / 2 - gm / r;
    const h = b.x * b.vy - b.y * b.vx;
    const a = en < 0 ? -gm / (2 * en) : Infinity;
    return { a, e: Math.sqrt(Math.max(0, 1 + (2 * en * h * h) / (gm * gm))), r };
  }

  /** The ring a tap would settle Nu on now, and the way that tap must go: out at its far point,
   *  in at its near point. Or null. */
  private ready(): { k: number; way: number } | null {
    const o = this.orbit(this.b);
    if (o.e < 0.02 || !isFinite(o.a)) return null;
    for (let k = 0; k < PULL_RINGS.length; k++) {
      const rk = PULL_RINGS[k];
      if (Math.abs(o.r - rk) > PULL_SNAP) continue;
      if (o.r > o.a && Math.abs(o.a * (1 + o.e) - rk) < PULL_SNAP) return { k, way: 1 };
      if (o.r < o.a && Math.abs(o.a * (1 - o.e) - rk) < PULL_SNAP) return { k, way: -1 };
    }
    return null;
  }

  /** One small step of Nu under the nucleus's pull. */
  private fall(b: Mover, dt: number): void {
    const r = Math.max(PULL_CORE, Math.hypot(b.x, b.y)), g = this.gm() / (r * r * r);
    b.vx -= b.x * g * dt;
    b.vy -= b.y * g * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  /** Nu bounces off the nucleus (losing nothing, so it can't settle there) and off the field's
   *  edge (losing a little). True if it did. */
  private bounce(b: Mover): boolean {
    const d = Math.hypot(b.x, b.y) || 1, nx = b.x / d, ny = b.y / d, vn = b.vx * nx + b.vy * ny;
    const lim = d < PULL_CORE ? PULL_CORE : d > PULL_RIM ? PULL_RIM : 0;
    if (!lim) return false;
    b.x = nx * lim;
    b.y = ny * lim;
    const k = lim === PULL_CORE ? (vn < 0 ? 2 : 0) : (vn > 0 ? 1.7 : 0);
    if (!k) return false;
    b.vx -= k * vn * nx;
    b.vy -= k * vn * ny;
    return true;
  }

  /** Nu settles on ring `k`, round and exactly on it, going the same way round. */
  private settle(s: Stage, k: number, now: number): void {
    const b = this.b, r = Math.hypot(b.x, b.y) || 1, rk = PULL_RINGS[k];
    const v = Math.sqrt(this.gm() / rk), turn = Math.sign(b.x * b.vy - b.y * b.vx) || 1;
    const x = b.x / r, y = b.y / r, was = this.scr(s, b);
    this.b = { x: x * rk, y: y * rk, vx: -y * v * turn, vy: x * v * turn };
    const to = this.scr(s, this.b);
    this.slide = { x: was.x - to.x + this.slide.x, y: was.y - to.y + this.slide.y };
    this.on = k;
    this.litAt = now;
    s.fx.ring(this.scr(s, this.b), GREEN, s.nu.r, s.nu.r + 22, 500);
    // Higher out, lower in.
    hitSound(k / (PULL_RINGS.length - 1));
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b, f = this.field(s);
    for (const q of this.reds) q.a += q.w * dt;
    for (const q of this.photons) q.a += q.w * dt;
    if (this.overAt) return;
    this.spare += dt;
    while (this.spare >= PULL_STEP) {
      this.spare -= PULL_STEP;
      this.fall(b, PULL_STEP);
      if (this.bounce(b)) { tickSound(0); this.on = -1; }
    }
    const p = this.scr(s, b), k = Math.exp(-dt / 70);
    this.slide.x *= k;
    this.slide.y *= k;
    nu.x = p.x + this.slide.x;
    nu.y = p.y + this.slide.y;
    nu.vx = b.vx * f.ax;
    nu.vy = b.vy * f.ay;
    for (let i = 0; i < this.photons.length; i++) {
      const q = this.at(s, this.photons[i]);
      if (dist(q, nu) > nu.r + 8) continue;
      this.count++;
      s.fx.burst(q, 6, CYAN, 0.1);
      captureSound();
      s.score(this.count, best(s, 'pull') || null);
      this.photons.splice(i--, 1);
    }
    this.stock();
    if (now < this.safeUntil) return;
    for (const q of this.reds) {
      const at = this.at(s, q);
      if (dist(at, nu) > nu.r + 5) continue;
      this.left--;
      this.safeUntil = now + 1500;
      s.fx.ring(at, RED, 8, 36, 600);
      missSound();
      buzz(22);
      // That red goes back round, across the field.
      q.a += Math.PI;
      if (this.left <= 0) {
        this.overAt = now;
        finish(s, 'pull', this.count);
        s.score(this.count, best(s, 'pull') || null);
      }
      return;
    }
  }

  /** Where Nu will go if let be, about one orbit ahead: the way, its far point, the photons it
   *  will meet, and the red it would run into (where the way stops). */
  private ahead(s: Stage, now: number): { path: Pt[]; far: Pt | null; meets: Set<Rider>; hit: Pt | null; lo: number; hi: number } {
    const b = { ...this.b }, start = this.scr(s, b), path: Pt[] = [start], meets = new Set<Rider>(), r0 = Math.hypot(b.x, b.y);
    let turned = 0, last = Math.atan2(b.y, b.x), t = 0, far: Pt | null = null, fd = 0, hit: Pt | null = null;
    let lo = r0, hi = r0, gap = 0, prev = start;
    const safe = now < this.safeUntil, reach = s.nu.r + 8, bump = s.nu.r + 5;
    // Coarser steps than Nu's own: close enough, at half the cost.
    for (let i = 0; i < 2000 && turned < TAU * 0.98; i++) {
      this.fall(b, PULL_STEP * 2);
      t += PULL_STEP * 2;
      if (this.bounce(b)) break;
      const a = Math.atan2(b.y, b.x), r = Math.hypot(b.x, b.y), p = this.scr(s, b);
      let da = a - last;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      turned += Math.abs(da);
      last = a;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      if (Math.abs(r - r0) > fd) { fd = Math.abs(r - r0); far = p; }
      // Riders checked every few steps: plenty, at these speeds.
      if (i % 2 === 0) {
        for (const q of this.photons) if (!meets.has(q) && dist(this.at(s, q, t), p) < reach) meets.add(q);
        if (!safe || t > this.safeUntil - now) {
          const red = this.reds.find((q) => dist(this.at(s, q, t), p) < bump);
          if (red) { hit = p; path.push(hit); break; }
        }
      }
      // A dot about every 12 px.
      gap += dist(p, prev);
      prev = p;
      if (gap >= 12) { gap = 0; path.push(p); }
    }
    return { path, far: fd > 0.03 ? far : null, meets, hit, lo, hi };
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const f = this.field(s), nu = s.nu;
    const view = this.overAt ? null : this.ahead(s, now);
    const ready = this.overAt ? null : this.ready();
    const o = this.orbit(this.b), apo = o.a * (1 + o.e), peri = o.a * (1 - o.e);
    // The rings: green where a tap now settles Nu; white where its orbit's far or near point
    // reaches (where it could settle); cyan, beating, where the way ahead crosses a photon's
    // ring; the one Nu has just settled on flashes.
    for (let k = 0; k < PULL_RINGS.length; k++) {
      const rk = PULL_RINGS[k];
      if (ready?.k === k) { oval(ctx, f, rk, GREEN, 3, 0.8); continue; }
      const target = this.on !== k && o.e > 0.02 && isFinite(o.a) && (Math.abs(apo - rk) < PULL_SNAP || Math.abs(peri - rk) < PULL_SNAP);
      const reached = !!view && this.on !== k && view.lo - 0.02 <= rk && view.hi + 0.02 >= rk && this.photons.some((p) => p.k === k);
      const flash = this.on === k ? clamp(1 - (now - this.litAt) / 700, 0, 1) : 0;
      if (target) oval(ctx, f, rk, WHITE, 3, 0.45);
      else if (reached) oval(ctx, f, rk, CYAN, 3, 0.45 + Math.sin(now / 180) * 0.1);
      else oval(ctx, f, rk, flash ? GREEN : K500, 2, 0.45 + flash * 0.4);
    }
    // The nucleus.
    const core = PULL_CORE * Math.min(f.ax, f.ay);
    dot(ctx, f, core, K800, 1);
    ring(ctx, f, core - 1.5, K300, 3, 0.7);
    // Nu's way ahead, dotted and fading out; its far point; a red ring where it would hit.
    if (view) {
      const n = view.path.length;
      for (let i = 1; i < n; i++) dot(ctx, view.path[i], 2, WHITE, 0.55 * (1 - (i / n) * 0.7));
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
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    // Ready to settle: a short green line from Nu the way to tap (out, or in).
    if (ready) {
      const dx = nu.x - f.x, dy = nu.y - f.y, d = Math.hypot(dx, dy) || 1, ux = (dx / d) * ready.way, uy = (dy / d) * ready.way;
      ctx.strokeStyle = GREEN;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(nu.x + ux * (nu.r + 5), nu.y + uy * (nu.r + 5));
      ctx.lineTo(nu.x + ux * (nu.r + 20), nu.y + uy * (nu.r + 20));
      ctx.stroke();
    }
    // The last burn: a short flame from Nu, fading: behind it speeding up, ahead slowing down.
    const bt = (now - this.burnAt) / PULL_BURN_MS;
    if (this.burnAt && bt < 1 && !this.overAt) {
      const v = Math.hypot(nu.vx, nu.vy) || 1, ux = (nu.vx / v) * -this.burnWay, uy = (nu.vy / v) * -this.burnWay;
      ctx.strokeStyle = WHITE;
      ctx.globalAlpha = 0.7 * (1 - bt);
      ctx.beginPath();
      ctx.moveTo(nu.x + ux * (nu.r + 4), nu.y + uy * (nu.r + 4));
      ctx.lineTo(nu.x + ux * (nu.r + 24), nu.y + uy * (nu.r + 24));
      ctx.stroke();
    }
    ctx.restore();
    lives(s, ctx, this.left);
    nu.draw(ctx, now);
  }

  /** A tap is one burn: outside Nu's ring speeds it up, inside slows it down. At a green ring,
   *  the right way settles it there instead. */
  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    const f = this.field(s), b = this.b, now = performance.now();
    const way = Math.hypot((p.x - f.x) / f.ax, (p.y - f.y) / f.ay) >= Math.hypot(b.x, b.y) ? 1 : -1;
    this.burnAt = now;
    this.burnWay = way;
    const rd = this.ready();
    if (rd && rd.way === way) { this.settle(s, rd.k, now); return; }
    const r = Math.hypot(b.x, b.y), v = Math.hypot(b.vx, b.vy) || 1, dv = Math.sqrt(this.gm() / r) * PULL_KICK * way;
    b.vx += (b.vx / v) * dv;
    b.vy += (b.vy / v) * dv;
    this.on = -1;
    tickSound(way > 0 ? 3 : 1);
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
