// Two more of Nu's park games (park.ts), on the same kit:
//   Surf   rolling hills of a wave go by. Hold to make Nu heavy, let go to make it light: heavy
//          down the slopes, light up them, and Nu flies. Tap at a crest to leap. Catch the green
//          dots; outrun the tide.
//   Shade  searchlights sweep the arena from lamps on its rim. Nu starts under a grey shade plate.
//          Drag Nu about for the green dots; stay out of the light, or under a plate, or the ring
//          round Nu fills.

import {
  CYAN, GREEN, K300, K500, K800, RED, ROSE, TAU, WHITE,
  best, buzz, captureSound, clamp, completeSound, dist, dot, finish, hitSound, inside, missSound, ring, rimPoint, tickSound,
  type Pt, type Stage, type Toy,
} from './kit';
import { bar } from './lawn';

// ---- Surf ------------------------------------------------------------------------------------

// The wave is laid out in its own units: the arena is 640 of them tall, whatever its size.
/** Gravity (units/ms²), and how much heavier Nu is while held: going down, and (less) going up. */
const SURF_G = 0.0008;
const SURF_HEAVY = 3.4;
const SURF_HEAVY_UP = 1.8;
/** Held on a downslope: a gentle push along it on top (units/ms², at full slope). */
const SURF_PRESS = 0.00035;
/** A tap shorter than this (ms) is a jump, and the jump's push off the wave (units/ms). */
const SURF_TAP = 220;
const SURF_JUMP = 0.3;
/** A jump at a crest (the sweet spot: this far before it, or just past it, in units) is a leap:
 *  this much more speed forward, and up. */
const SURF_SWEET = 90;
const SURF_SWEET_PAST = 60;
const SURF_LEAP = 0.24;
const SURF_LEAP_UP = 0.12;
/** Landing along a downslope: the speed it gives on top. */
const SURF_BOOST = 0.2;
/** Nu's radius, and its top speed (units/ms). */
const SURF_R = 10;
const SURF_TOP = 1.5;
/** Nu never stalls on the wave: at the least it creeps on at this (units/ms). */
const SURF_CRAWL = 0.12;
/** The tide's speed at the start (units/ms), when it starts (ms), how fast it grows (per ms) and
 *  how far behind Nu it can fall at most. */
const SURF_TIDE = 0.12;
const SURF_TIDE_WAIT = 3500;
const SURF_TIDE_GROW = 0.000006;
const SURF_TIDE_GAP = 1400;
/** The troughs' height (units below the arena's middle). */
const SURF_LOW = 200;

type Key = { x: number; y: number };
type Gem = { x: number; y: number; high: boolean };

/** Tiny Wings, Nu's way. Hills of a wave roll by from the right. Hold anywhere and Nu is heavy,
 *  pressing into the wave (and pushing on, down a slope); let go and it floats. Heavy on the way
 *  down and light on the way up builds speed, and over a crest Nu takes off. A ring sits on the
 *  crest ahead: it lights green while a tap there would be a leap, a big push forward and up. Come
 *  down along a downslope and Nu gets a push (a green ring), into an upslope and it stumbles.
 *  Green dots hang in the air to catch, the higher the bigger the push they give. The bar at the
 *  top is Nu's speed (red while slower than the tide), the red mark on it the tide's. The tide, a
 *  red dashed line, waits a moment, then creeps up from the left, a little faster all the time:
 *  if it catches Nu, the run is over. Rolling along idle, Nu slows; it won't outrun it for long. */
export class Surf implements Toy {
  private keys: Key[] = [];
  private gems: Gem[] = [];
  /** Nu in the wave's units: where, its velocity in the air, its speed along the wave. */
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private sp = 0;
  private grounded = true;
  private heavy = false;
  /** When the finger went down (for telling a tap from a hold), and Nu's last spots, for its wake. */
  private downAt = 0;
  private wake: { x: number; y: number }[] = [];
  /** Lately off the wave (ms), so a tap just after a crest still jumps. */
  private airMs = 0;
  /** The last landing's flash: when, and good or not. */
  private landAt = 0;
  private landGood = false;
  /** The last push (a leap, a good landing): when, for the speed bar's flash; and the crest last
   *  leapt from, so its ring stays dark. */
  private boostAt = 0;
  private leapt = -Infinity;
  private tide = 0;
  private camY = 0;
  private t = 0;
  private count = 0;
  private overAt = 0;
  /** Its scale (px per unit) and where Nu sits across the arena (px). */
  private k(s: Stage): number { return s.hh / 400; }
  private ax(s: Stage): number { return s.m.x - s.hw * 0.45; }

  enter(s: Stage): void {
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.keys = [{ x: -700, y: SURF_LOW }, { x: -320, y: 90 }, { x: 160, y: SURF_LOW }];
    this.gems = [];
    this.x = -160;
    this.sp = 0.32;
    this.grounded = true;
    this.y = this.ground(this.x).y - SURF_R;
    this.vx = this.vy = 0;
    this.heavy = false;
    this.downAt = 0;
    this.wake = [];
    this.airMs = 0;
    this.landAt = 0;
    this.boostAt = 0;
    this.leapt = -Infinity;
    this.camY = 0;
    this.t = 0;
    this.count = 0;
    this.overAt = 0;
    this.tide = this.x - this.leftRoom(s) + 30;
    this.grow(s);
    s.nu.r = SURF_R * this.k(s);
    s.nu.scale = 1;
    this.place(s);
    s.score(0, best(s, 'surf') || null);
  }

  /** The tide's speed now (units/ms). */
  private tideSpeed(): number { return SURF_TIDE + Math.max(0, this.t - SURF_TIDE_WAIT) * SURF_TIDE_GROW; }

  /** The crest ahead (or just behind) Nu, if it's a crest still to leap from. */
  private crest(): Key | undefined {
    const c = this.keys.find((q) => q.y < SURF_LOW - 40 && q.x > this.x - SURF_SWEET_PAST);
    return c && c.x !== this.leapt ? c : undefined;
  }

  /** In the sweet spot: near enough the crest ahead, on the wave or only just off it. */
  private sweet(): boolean {
    const c = this.crest();
    return !!c && c.x - this.x < SURF_SWEET && (this.grounded || this.airMs < 240) && (this.grounded ? this.sp : this.vx) > 0.05;
  }

  /** How far the arena reaches behind Nu, in units. */
  private leftRoom(s: Stage): number { return (this.ax(s) - (s.m.x - s.hw)) / this.k(s); }

  /** More wave ahead, as far as the arena shows and a bit; the hills grow as Nu goes. */
  private grow(s: Stage): void {
    const ahead = this.x + (s.m.x + s.hw - this.ax(s)) / this.k(s) + 400;
    while (this.keys[this.keys.length - 1].x < ahead) {
      const a = this.keys[this.keys.length - 1], crest = a.y > SURF_LOW - 20, far = Math.max(0, a.x);
      const w = 300 + Math.random() * 160 + Math.min(80, far * 0.003);
      const h = Math.min(210, 80 + far * 0.005) * (0.7 + Math.random() * 0.4);
      const b = { x: a.x + w, y: crest ? SURF_LOW - h : SURF_LOW - Math.random() * 25 };
      this.keys.push(b);
      // Dots: low ones along the way down, to roll through; high ones over the trough, to fly to.
      if (a.x < 300) continue;
      if (!crest) {
        const n = Math.random() < 0.65 ? 1 + Math.floor(Math.random() * 3) : 0;
        for (let i = 0; i < n; i++) {
          const x = a.x + w * (0.25 + i * 0.18);
          this.gems.push({ x, y: this.groundAt(a, b, x) - 26 - Math.random() * 16, high: false });
        }
        if (Math.random() < 0.55) {
          const x = a.x + w * (0.6 + Math.random() * 0.5);
          this.gems.push({ x, y: a.y - 70 - Math.random() * 170, high: true });
        }
      }
    }
    const back = this.tide - 200;
    while (this.keys.length > 3 && this.keys[1].x < back) this.keys.shift();
    this.gems = this.gems.filter((g) => g.x > back);
  }

  private groundAt(a: Key, b: Key, x: number): number {
    const u = clamp((x - a.x) / (b.x - a.x), 0, 1);
    return a.y + (b.y - a.y) * (1 - Math.cos(Math.PI * u)) / 2;
  }

  /** The wave at `x`: its height, slope and bend (down is +). */
  private ground(x: number): { y: number; d1: number; d2: number } {
    const ks = this.keys;
    let i = 0;
    while (i < ks.length - 2 && ks[i + 1].x <= x) i++;
    const a = ks[i], b = ks[i + 1], w = b.x - a.x, u = clamp((x - a.x) / w, 0, 1), dy = b.y - a.y;
    return {
      y: a.y + dy * (1 - Math.cos(Math.PI * u)) / 2,
      d1: (dy * Math.PI / (2 * w)) * Math.sin(Math.PI * u),
      d2: (dy * Math.PI * Math.PI / (2 * w * w)) * Math.cos(Math.PI * u),
    };
  }

  /** Puts Nu on the screen where the wave has it. */
  private place(s: Stage): void {
    const k = this.k(s);
    s.nu.x = this.ax(s);
    s.nu.y = s.m.y + (this.y - this.camY) * k;
    s.nu.r = SURF_R * k;
  }

  step(s: Stage, dt: number, now: number): void {
    if (this.overAt) {
      // The tide washes on over Nu.
      this.tide += SURF_TIDE * dt;
      s.nu.scale = 1;
      return;
    }
    this.t += dt;
    for (let left = dt; left > 0; left -= 8) this.roll(s, Math.min(8, left), now);
    this.airMs = this.grounded ? 0 : this.airMs + dt;
    // Nu's wake: where it was over the last moments, longer the faster it goes.
    this.wake.unshift({ x: this.x, y: this.y });
    if (this.wake.length > 16) this.wake.length = 16;
    // Heavy, Nu squashes into the wave.
    s.nu.scale += ((this.heavy ? 0.82 : 1) - s.nu.scale) * (1 - Math.exp(-dt / 60));
    // The tide: slow at first, then faster, never too far behind.
    if (this.t > SURF_TIDE_WAIT) this.tide += this.tideSpeed() * dt;
    this.tide = Math.max(this.tide, this.x - SURF_TIDE_GAP);
    // The view rises with Nu when it flies high.
    const want = Math.min(0, this.y + 300);
    this.camY += (want - this.camY) * (1 - Math.exp(-dt / 160));
    this.grow(s);
    this.place(s);
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      if (Math.hypot(g.x - this.x, g.y - this.y) > SURF_R + 16) continue;
      this.gems.splice(i, 1);
      this.count++;
      captureSound();
      // A push forward, bigger for the high ones.
      const push = g.high ? 0.08 : 0.025;
      if (this.grounded) this.sp = Math.min(SURF_TOP, this.sp + push);
      else this.vx = Math.min(SURF_TOP, this.vx + push);
      s.fx.ring(s.nu, GREEN, s.nu.r, s.nu.r + (g.high ? 40 : 24), 500);
      s.score(this.count, best(s, 'surf') || null);
    }
    if (this.tide >= this.x - SURF_R * 0.5) {
      this.overAt = now;
      this.heavy = false;
      s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 34, 700);
      missSound();
      buzz(24);
      finish(s, 'surf', this.count);
      s.score(this.count, best(s, 'surf') || null);
    }
  }

  /** One small step of Nu on (or over) the wave. */
  private roll(s: Stage, dt: number, now: number): void {
    let g = SURF_G * (this.heavy ? SURF_HEAVY : 1);
    if (this.grounded) {
      const w = this.ground(this.x), c = 1 / Math.sqrt(1 + w.d1 * w.d1);
      // Heavy going up costs less than it gives going down.
      if (this.heavy && w.d1 < 0) g = SURF_G * SURF_HEAVY_UP;
      // Over a crest, fast enough that the wave falls away under it: off it goes.
      if (this.sp > 0 && this.sp * this.sp * w.d2 * c * c * c > g * c) {
        this.grounded = false;
        this.vx = this.sp * c;
        this.vy = this.sp * w.d1 * c;
      } else {
        this.sp += g * w.d1 * c * dt;
        // Held on the way down: a gentle push on top.
        if (this.heavy && w.d1 > 0) this.sp += SURF_PRESS * Math.min(1, w.d1) * dt;
        this.sp -= 0.0001 * this.sp * Math.abs(this.sp) * dt;
        this.sp = clamp(this.sp, SURF_CRAWL, SURF_TOP);
        this.x += this.sp * c * dt;
        this.y = this.ground(this.x).y - SURF_R;
        return;
      }
    }
    this.vy += g * dt;
    this.vx -= 0.00006 * this.vx * Math.abs(this.vx) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const w = this.ground(this.x);
    if (this.y + SURF_R < w.y) return;
    // Down on the wave: along a downslope it keeps its speed, into an upslope it loses it.
    this.y = w.y - SURF_R;
    this.grounded = true;
    const c = 1 / Math.sqrt(1 + w.d1 * w.d1), along = (this.vx + this.vy * w.d1) * c, speed = Math.hypot(this.vx, this.vy) || 1;
    const smooth = along / speed > 0.8, downhill = w.d1 > 0.06;
    this.landAt = now;
    this.landGood = smooth && downhill;
    if (this.landGood) {
      // Along a downslope: a push on top, more the steeper it is.
      this.sp = Math.min(SURF_TOP, speed + SURF_BOOST * Math.min(1, 0.4 + w.d1 * 1.5));
      this.boostAt = now;
      hitSound(this.sp / SURF_TOP);
      buzz(10);
      s.fx.ring(s.nu, GREEN, s.nu.r, s.nu.r + 34, 450);
    } else if (smooth) {
      this.sp = Math.min(SURF_TOP, speed);
      tickSound(1);
    } else {
      this.sp = Math.max(SURF_CRAWL, along * 0.8);
      buzz(18);
      s.fx.ring(s.nu, K300, s.nu.r, s.nu.r + 18, 350);
    }
  }

  /** A jump: a push off the wave, up from its face; at a crest, a leap. */
  private jump(s: Stage): void {
    const leap = this.sweet(), w = this.ground(this.x), c = 1 / Math.sqrt(1 + w.d1 * w.d1);
    const sp = this.grounded ? this.sp : Math.hypot(this.vx, this.vy);
    const vx = this.grounded ? sp * c : this.vx, vy = this.grounded ? sp * w.d1 * c : this.vy;
    this.grounded = false;
    this.airMs = 1000;
    this.vx = vx + w.d1 * c * SURF_JUMP * 0.4;
    // A leap skims low over the crest, to come down on the slope beyond it.
    this.vy = Math.min(vy, 0) - (leap ? SURF_LEAP_UP : SURF_JUMP * c);
    this.y -= 2;
    if (leap) {
      // The leap: well forward and up, and that crest's ring goes dark.
      this.leapt = this.crest()!.x;
      this.vx = Math.min(SURF_TOP, Math.max(this.vx, 0) + SURF_LEAP);
      this.boostAt = performance.now();
      hitSound(0.5 + 0.5 * this.vx / SURF_TOP);
      buzz(14);
      s.fx.ring(s.nu, GREEN, s.nu.r, s.nu.r + 44, 550);
      s.fx.burst(s.nu, 8, GREEN, 0.14);
    } else {
      tickSound(2);
      s.fx.ring(s.nu, WHITE, s.nu.r, s.nu.r + 16, 300);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const k = this.k(s), ax = this.ax(s);
    const X = (x: number): number => ax + (x - this.x) * k, Y = (y: number): number => s.m.y + (y - this.camY) * k;
    const x0 = s.m.x - s.hw - 4, x1 = s.m.x + s.hw + 4, bottom = s.m.y + s.hh + 4;
    // The wave: a flat darker plate under a grey line.
    ctx.beginPath();
    const stepPx = 4;
    for (let px = x0; px <= x1 + stepPx; px += stepPx) {
      const y = Y(this.ground(this.x + (px - ax) / k).y);
      if (px === x0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.save();
    ctx.lineTo(x1 + stepPx, bottom);
    ctx.lineTo(x0, bottom);
    ctx.closePath();
    ctx.fillStyle = K800;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    for (let px = x0; px <= x1 + stepPx; px += stepPx) {
      const y = Y(this.ground(this.x + (px - ax) / k).y);
      if (px === x0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.save();
    ctx.strokeStyle = K300;
    ctx.lineWidth = Math.max(3, 4 * k);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    // The dots, the high ones with a ring.
    for (const g of this.gems) {
      const p = { x: X(g.x), y: Y(g.y) };
      if (p.x < x0 - 20 || p.x > x1 + 20) continue;
      dot(ctx, p, 6 * k, GREEN, 0.95);
      if (g.high) ring(ctx, p, 11 * k, GREEN, 2, 0.6);
    }
    // The tide: a red dashed line, with a faint wash behind it.
    const tx = X(this.tide);
    if (tx > x0) {
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = RED;
      ctx.fillRect(x0, s.m.y - s.hh - 4, tx - x0, 2 * s.hh + 8);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.setLineDash([10, 9]);
      ctx.lineDashOffset = -now / 40;
      ctx.beginPath();
      ctx.moveTo(tx, s.m.y - s.hh - 4);
      ctx.lineTo(tx, s.m.y + s.hh + 4);
      ctx.stroke();
      ctx.restore();
    }
    // The ring on the crest ahead: grey, and green while a tap would leap.
    const cr = this.crest();
    if (cr && !this.overAt) {
      const p = { x: X(cr.x), y: Y(cr.y - SURF_R - 14) };
      if (this.sweet()) { ring(ctx, p, 13 * k, GREEN, 3, 0.95); dot(ctx, p, 4 * k, GREEN, 0.9); }
      else ring(ctx, p, 11 * k, K500, 2, 0.8);
    }
    // Nu's wake, behind it on the wave: the faster, the longer.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = ROSE;
    for (let i = 1; i < this.wake.length; i++) {
      const f = 1 - i / this.wake.length;
      ctx.globalAlpha = 0.5 * f;
      ctx.lineWidth = Math.max(2, s.nu.r * 1.2 * f);
      ctx.beginPath();
      ctx.moveTo(X(this.wake[i - 1].x), Y(this.wake[i - 1].y));
      ctx.lineTo(X(this.wake[i].x), Y(this.wake[i].y));
      ctx.stroke();
    }
    ctx.restore();
    // The speed bar across the top: Nu's speed (red while slower than the tide, cyan when fast,
    // green just after a push), the tide's a red mark.
    const sp = this.grounded ? this.sp : Math.hypot(this.vx, this.vy);
    const bx0 = s.m.x - s.hw * 0.5, bx1 = s.m.x + s.hw * 0.5, by = s.m.y - s.hh + 22, bw = bx1 - bx0;
    bar(ctx, bx0, by, bx1, by, K800, 8, 0.9);
    const u = clamp(sp / SURF_TOP, 0, 1), tv = this.t > SURF_TIDE_WAIT ? this.tideSpeed() : 0;
    const pushed = now - this.boostAt < 450;
    const bc = pushed ? GREEN : sp < tv ? RED : u > 0.55 ? CYAN : WHITE;
    if (u > 0.01) bar(ctx, bx0, by, bx0 + bw * u, by, bc, pushed ? 10 : 8, 0.9);
    const tu = clamp(this.tideSpeed() / SURF_TOP, 0, 1);
    bar(ctx, bx0 + bw * tu, by - 8, bx0 + bw * tu, by + 8, RED, 3, 0.9);
    // A landing: green along a downslope (a push), grey into an upslope.
    const lf = clamp(1 - (now - this.landAt) / 400, 0, 1);
    if (lf > 0 && this.landGood) ring(ctx, s.nu, s.nu.r + 7, GREEN, 3, 0.8 * lf);
    // Heavy: a ring hugging Nu, cyan while it pushes Nu on down a slope.
    if (this.heavy && !this.overAt) {
      const pressing = this.grounded && this.ground(this.x).d1 > 0.05;
      ring(ctx, s.nu, s.nu.r + 4, pressing ? CYAN : WHITE, 3, 0.85);
    }
    s.nu.draw(ctx, now);
  }

  down(): void {
    if (this.overAt) return;
    this.heavy = true;
    this.downAt = performance.now();
  }

  up(s: Stage): void {
    this.heavy = false;
    // A quick tap on the wave (or just off a crest) jumps.
    const tap = this.downAt && performance.now() - this.downAt < SURF_TAP;
    this.downAt = 0;
    if (tap && !this.overAt && (this.grounded || this.airMs < 140 || this.sweet())) this.jump(s);
  }
  resize(s: Stage): void { this.grow(s); this.place(s); }
}

// ---- Shade -----------------------------------------------------------------------------------

/** How long the light takes to fill the ring (ms), and to empty it again in the dark. */
const SHADE_FILL = 1000;
const SHADE_EMPTY = 4000;
/** How long a shade plate lasts with Nu under it (ms). */
const SHADE_WEAR = 7500;
/** The game's pace (the sweeps, the dots' time, the plates' wear), not Nu's: 0.8 of what it was. */
const SHADE_PACE = 0.8;
/** A beam's half width at the start and at its widest (radians), and how far it swings each way. */
const SHADE_BEAM = 0.13;
const SHADE_WIDE = 0.26;
const SHADE_SWING = 0.95;
/** Nu's top speed (px/ms, before the arena's scale): slow, so a dash through a beam costs. */
const SHADE_SPEED = 0.2;
/** How many lamps at the start, and the counts that bring another. */
const SHADE_LAMPS = 3;
const SHADE_MORE = [5, 11, 18];

/** A lamp: where, the way it faces, how far through its sweep, and its own pace. */
type Lamp = Pt & { aim: number; phase: number; pace: number };

/** Searchlights on the arena's rim sweep slowly to and fro, each at its own pace. Drag Nu about
 *  (it follows the finger a little behind, and slowly: a dash through a beam costs) to the green dots.
 *  In a beam, and not under one of the grey shade plates, the ring round Nu fills, quickly; out
 *  of the light it empties slowly. Full, and the run is over. A plate wears thin while Nu hides
 *  under it, and each dot has its time on the rim, a generous one: wait for the gap, then go.
 *  Let it run out and the ring fills by a third. The dots sit well away from Nu, so each one is a
 *  route to plan. More lamps, wider beams and quicker sweeps as the count goes up. */
export class Shade implements Toy {
  private lamps: Lamp[] = [];
  /** The shade plates; each wears thin while Nu hides under it (`wear` 0..1) and grows back. */
  private plates: (Pt & { r: number; wear: number })[] = [];
  private gem: Pt = { x: 0, y: 0 };
  /** The dot's time left and its whole time (ms); it waits for the first touch. */
  private gemLeft = 0;
  private gemMs = 1;
  private started = false;
  private grab: Pt | null = null;
  private want: Pt | null = null;
  private heat = 0;
  private lit = false;
  private count = 0;
  private overAt = 0;
  private k(s: Stage): number { return clamp(Math.min(s.hw, s.hh) / 180, 0.6, 1.5); }

  enter(s: Stage): void {
    this.reset(s);
  }

  private reset(s: Stage): void {
    s.nu.r = 9;
    this.grab = this.want = null;
    this.heat = 0;
    this.lit = false;
    this.started = false;
    this.count = 0;
    this.overAt = 0;
    this.lamps = [];
    this.layout(s);
    s.score(0, best(s, 'shade') || null);
  }

  /** Lays out the plates, the lamps and the dot (again, on a resize). */
  private layout(s: Stage): void {
    const k = this.k(s);
    Object.assign(s.nu, inside(s, s.nu, s.nu.r + 4));
    this.plates = [];
    const n = s.hw * s.hh > 50000 ? 5 : 4;
    for (let tries = 0; this.plates.length < n && tries < 300; tries++) {
      const r = (30 + Math.random() * 12) * k;
      const p = { x: s.m.x + (Math.random() * 2 - 1) * (s.hw - r - 20), y: s.m.y + (Math.random() * 2 - 1) * (s.hh - r - 20) };
      if (this.plates.some((q) => dist(p, q) < r + q.r + 40 * k)) continue;
      this.plates.push({ ...p, r, wear: 0 });
    }
    // Nu starts (and, on a resize, goes back) under a plate: the one nearest the middle.
    const home = this.plates.reduce<Pt | null>((a, b) => (a && dist(a, s.m) <= dist(b, s.m) ? a : b), null);
    if (home) s.nu.at(home);
    const want = this.lamps.length || SHADE_LAMPS;
    this.lamps = [];
    while (this.lamps.length < want) this.addLamp(s);
    this.newGem(s);
  }

  private addLamp(s: Stage): void {
    // Top, bottom, then the sides, then the corners.
    const at = [0, 0.5, 0.25, 0.75, 0.125, 0.625];
    const u = at[this.lamps.length % at.length], p = rimPoint(s, u, -8);
    // It starts swung away to one side, clear of the middle.
    const phase = (this.lamps.length % 2 ? 1 : -1) * Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    const pace = 0.75 + Math.random() * 0.5;
    this.lamps.push({ ...p, aim: Math.atan2(s.m.y - p.y, s.m.x - p.x), phase, pace });
  }

  private newGem(s: Stage): void {
    // Well away from Nu (most of the arena's width, when there's room), and not under a plate.
    const far = 0.75 * Math.min(Math.max(s.hw, s.hh), 1.6 * Math.min(s.hw, s.hh));
    let p = this.gemSpot(s), bestD = -1;
    for (let i = 0; i < 60; i++) {
      const q = this.gemSpot(s), d = dist(q, s.nu);
      if (this.plates.some((o) => dist(o, q) < o.r + 6)) continue;
      // The first spot far enough, else the farthest.
      if (d > bestD) { p = q; bestD = d; }
      if (d > far) break;
    }
    this.gem = p;
    // Time to wait for a gap: about twice what a straight dash would take, and a bit.
    const dash = dist(p, s.nu) / (SHADE_SPEED * this.k(s));
    this.gemMs = this.gemLeft = Math.max(7000, Math.min(19000, 2 * dash + (9000 - this.count * 150) / SHADE_PACE));
    s.rim = 1;
  }

  private gemSpot(s: Stage): Pt {
    return { x: s.m.x + (Math.random() * 2 - 1) * (s.hw - 30), y: s.m.y + (Math.random() * 2 - 1) * (s.hh - 30) };
  }

  /** A beam's half width now: wider as the count goes up. */
  private beam(): number { return Math.min(SHADE_WIDE, SHADE_BEAM + this.count * 0.004); }

  /** Where a lamp's beam points now. */
  private angle(l: Lamp): number { return l.aim + Math.sin(l.phase) * SHADE_SWING; }

  private inBeam(p: Pt): boolean {
    for (const l of this.lamps) {
      let d = Math.atan2(p.y - l.y, p.x - l.x) - this.angle(l);
      d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (Math.abs(d) < this.beam()) return true;
    }
    return false;
  }

  /** A plate's size now, worn thin or not. */
  private size(q: { r: number; wear: number }): number { return q.r * (1 - 0.8 * q.wear); }

  /** The plate Nu is under, if any. */
  private cover(p: Pt, r: number): { r: number; wear: number } | undefined {
    return this.plates.find((q) => dist(p, q) < this.size(q) - r * 0.3);
  }

  private shaded(p: Pt, r: number): boolean { return !!this.cover(p, r); }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.overAt) { nu.seek(nu, dt); return; }
    // The beams swing quicker as the count goes up.
    const w = (0.0003 + Math.min(this.count, 30) * 0.00002) * SHADE_PACE;
    for (const l of this.lamps) l.phase += w * l.pace * dt;
    if (this.want) {
      nu.seek(inside(s, this.want, nu.r + 2), dt, SHADE_SPEED * this.k(s), 0.025);
      Object.assign(nu, inside(s, nu, nu.r));
    } else nu.seek(nu, dt);
    // A plate wears thin while Nu hides under it, and slowly grows back once it's left.
    // (Not before the first touch: waiting there is free.)
    const under = this.started ? this.cover(nu, nu.r) : undefined;
    for (const q of this.plates) q.wear = clamp(q.wear + (q === under ? dt / SHADE_WEAR : -dt / (2 * SHADE_WEAR)), 0, 1);
    const lit = this.inBeam(nu) && !this.shaded(nu, nu.r);
    if (lit && !this.lit) { tickSound(1); buzz(8); }
    this.lit = lit;
    this.heat = clamp(this.heat + (lit ? dt / SHADE_FILL : -dt / SHADE_EMPTY), 0, 1);
    if (this.heat >= 1) {
      this.overAt = now;
      this.grab = this.want = null;
      s.fx.ring(nu, RED, nu.r, nu.r + 34, 700);
      missSound();
      buzz(24);
      finish(s, 'shade', this.count);
      s.score(this.count, best(s, 'shade') || null);
      return;
    }
    // Each dot has its time, on the rim: let it run out and the ring fills by a third.
    if (this.started) this.gemLeft -= dt;
    s.rim = clamp(this.gemLeft / this.gemMs, 0, 1);
    if (this.gemLeft <= 0) {
      this.heat = Math.min(0.999, this.heat + 0.34);
      s.fx.ring(this.gem, RED, 6, 30, 500);
      missSound();
      this.newGem(s);
      return;
    }
    if (dist(nu, this.gem) < nu.r + 9) {
      this.count++;
      captureSound();
      s.fx.ring(this.gem, GREEN, 6, 30, 500);
      // Another lamp now and then.
      if (SHADE_MORE.includes(this.count)) { this.addLamp(s); completeSound(); }
      this.newGem(s);
      s.score(this.count, best(s, 'shade') || null);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const nu = s.nu, far = 2.5 * Math.max(s.hw, s.hh);
    // The shade plates, under everything, as big as they are now.
    for (const q of this.plates) { dot(ctx, q, this.size(q), K500, 0.55); ring(ctx, q, this.size(q), K300, 2, 0.35); }
    // The beams: a flat translucent red wedge, and a narrower, stronger one down its middle.
    ctx.save();
    ctx.fillStyle = RED;
    for (const l of this.lamps) {
      const a = this.angle(l);
      for (const [half, alpha] of [[this.beam(), 0.14], [this.beam() * 0.45, 0.2]]) {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(l.x + Math.cos(a - half) * far, l.y + Math.sin(a - half) * far);
        ctx.lineTo(l.x + Math.cos(a + half) * far, l.y + Math.sin(a + half) * far);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    for (const l of this.lamps) { dot(ctx, l, 7, RED, 0.95); ring(ctx, l, 11, RED, 2, 0.5); }
    if (!this.overAt) {
      const pulse = 1 + 0.12 * Math.sin(now / 220);
      dot(ctx, this.gem, 6 * pulse, GREEN, 0.95);
      ring(ctx, this.gem, 11 * pulse, GREEN, 2, 0.4);
    }
    // The ring round Nu: how much light it has taken.
    if (this.heat > 0.005) {
      const R = nu.r + 9;
      ring(ctx, nu, R, K500, 3, 0.6);
      ctx.save();
      ctx.strokeStyle = RED;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(nu.x, nu.y, R, -Math.PI / 2, -Math.PI / 2 + TAU * this.heat);
      ctx.stroke();
      ctx.restore();
    }
    nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.started = true;
    this.grab = { x: s.nu.x - p.x, y: s.nu.y - p.y };
    this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y };
  }

  move(_s: Stage, p: Pt): void { if (this.grab) this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y }; }
  up(): void { this.grab = null; this.want = null; }

  resize(s: Stage): void { this.layout(s); }
}
