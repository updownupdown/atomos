// Three more of Nu's park games (park.ts), on the same kit:
//   Pole   Nu sits in the middle with a charge, cyan or white; tap to flip it. Opposite charges
//          drifting in are pulled in and caught, like ones pushed away. Red is pulled in by cyan.
//   Poise  a seesaw on a pivot. Tap to drop the atom Nu carries where the finger is; keep the
//          beam within its tilt and every atom on it.
//   Ferry  shells round a nucleus turn, each with a gap. Drag Nu to an electron on the rim and
//          through the gaps to the shell of its colour; any other shell knocks it loose.

import {
  CYAN, K300, K500, K800, K975, NOTE_COLOURS, RED, TAU, WHITE,
  best, buzz, captureSound, clamp, completeSound, dist, dot, finish, inside, missSound, ring, tickSound,
  type Pt, type Stage, type Toy,
} from './kit';
import { bar, lives } from './lawn';

/** An angle brought into -π..π. */
const wrap = (a: number): number => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

// ---- Pole ------------------------------------------------------------------------------------

/** The pull (or push) on a particle, scaled by the court's size, and the drag that lets a pulled
 *  one spiral in rather than swing round Nu. */
const POLE_PULL = 0.00002;
const POLE_DRAG = 0.0015;
/** How long the charge lasts with nothing caught (ms), and what a catch gives back (0..1). */
const POLE_CHARGE = 8000;
const POLE_REFILL = 0.3;

/** A particle, relative to the court's middle: +1 cyan, -1 white, 0 red. */
type Charge = { x: number; y: number; vx: number; vy: number; q: 1 | -1 | 0; r: number };

/** Nu sits in the middle of the court and carries a charge: a cyan ring is +, a white one −. Tap
 *  anywhere to flip it. Particles drift in from the rim, cyan (+) or white (−), each with its
 *  sign on it. Opposites attract: they curve in and are caught. Likes repel and curve away. Red
 *  ones are pulled in only while Nu is cyan, and a red one touching Nu costs one of three lives.
 *  Nu's charge (the rim) runs down by itself; each catch tops it up, and empty, the run is over.
 *  More particles, quicker ones, more white and more red as the count goes up. */
export class Pole implements Toy {
  court = true;
  private parts: Charge[] = [];
  private q: 1 | -1 = 1;
  private charge = 1;
  private next = 0;
  private count = 0;
  private left = 3;
  private overAt = 0;
  private k(s: Stage): number { return s.R / 180; }

  enter(s: Stage): void {
    s.nu.r = 9;
    s.nu.at(s.c);
    this.parts = [];
    this.q = 1;
    this.charge = 1;
    this.next = 600;
    this.count = 0;
    this.left = 3;
    this.overAt = 0;
    s.rim = 1;
    s.score(0, best(s, 'pole') || null);
  }

  /** A new particle at the rim, heading across the court to pass Nu by a little. */
  private spawn(s: Stage): void {
    const k = this.k(s), n = this.count;
    const red = n >= 4 && Math.random() < Math.min(0.32, 0.1 + n * 0.008);
    // More white than cyan as it goes on, so a cyan Nu (and so the red) pays.
    const q: 1 | -1 | 0 = red ? 0 : Math.random() < Math.max(0.35, 0.5 - n * 0.005) ? 1 : -1;
    const a = Math.random() * TAU, R = s.R + 10;
    // Red passes wide of Nu; the rest anywhere from close to wide.
    const b = (red ? 0.32 + Math.random() * 0.35 : 0.1 + Math.random() * 0.6) * s.R * (Math.random() < 0.5 ? -1 : 1);
    const v = (0.065 + Math.min(0.06, n * 0.0015)) * k * (0.85 + Math.random() * 0.3);
    // Inward, offset sideways by b.
    const ix = -Math.cos(a), iy = -Math.sin(a), off = Math.asin(clamp(b / R, -0.95, 0.95));
    const dx = ix * Math.cos(off) - iy * Math.sin(off), dy = ix * Math.sin(off) + iy * Math.cos(off);
    this.parts.push({ x: Math.cos(a) * R, y: Math.sin(a) * R, vx: dx * v, vy: dy * v, q, r: (q ? 6.5 : 6) * clamp(k, 0.8, 1.3) });
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    nu.seek(s.c, dt);
    const k = this.k(s);
    if (!this.overAt) {
      this.next -= dt;
      if (this.next <= 0) {
        this.spawn(s);
        this.next = Math.max(520, 1250 - this.count * 18) * (0.7 + Math.random() * 0.6);
      }
      this.charge -= dt / Math.max(5500, POLE_CHARGE - this.count * 50);
      s.rim = clamp(this.charge, 0, 1);
      if (this.charge <= 0) { this.over(s, now); return; }
    }
    const A = POLE_PULL * s.R * k;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i], d = Math.hypot(p.x, p.y) || 1;
      // Opposites attract, likes repel; red is pulled by cyan only. Nothing once the run is over.
      const pull = this.overAt ? 0 : p.q === 0 ? (this.q === 1 ? 1 : 0) : p.q === this.q ? -1 : 1;
      if (pull) {
        const a = (A / Math.max(d, 20 * k)) * pull;
        p.vx -= (p.x / d) * a * dt;
        p.vy -= (p.y / d) * a * dt;
        if (pull > 0) {
          // Drag on the swing round Nu, so it spirals in.
          const rx = p.x / d, ry = p.y / d, vr = p.vx * rx + p.vy * ry, f = Math.exp(-POLE_DRAG * dt);
          p.vx = vr * rx + (p.vx - vr * rx) * f;
          p.vy = vr * ry + (p.vy - vr * ry) * f;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const dd = Math.hypot(p.x, p.y);
      if (dd > s.R + 24 && p.x * p.vx + p.y * p.vy > 0) { this.parts.splice(i, 1); continue; }
      if (this.overAt || dd > nu.r + p.r) continue;
      const at = { x: s.c.x + p.x, y: s.c.y + p.y };
      this.parts.splice(i, 1);
      if (p.q === 0) {
        this.left--;
        s.fx.ring(at, RED, p.r, 40, 600);
        s.fx.burst(at, 8, RED);
        missSound();
        buzz(24);
        if (this.left <= 0) { this.over(s, now); return; }
      } else if (p.q !== this.q) {
        this.count++;
        this.charge = Math.min(1, this.charge + POLE_REFILL);
        s.fx.ring(nu, p.q === 1 ? CYAN : WHITE, nu.r + 4, nu.r + 30, 500);
        captureSound();
        s.score(this.count, best(s, 'pole') || null);
      }
    }
  }

  private over(s: Stage, now: number): void {
    this.overAt = now;
    s.rim = null;
    s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 34, 700);
    missSound();
    finish(s, 'pole', this.count);
    s.score(this.count, best(s, 'pole') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const nu = s.nu;
    for (const p of this.parts) {
      const at = { x: s.c.x + p.x, y: s.c.y + p.y };
      if (p.q === 0) { dot(ctx, at, p.r, RED, 0.95); continue; }
      dot(ctx, at, p.r, p.q === 1 ? CYAN : WHITE, 0.95);
      // Its sign, in the dark: + or −.
      const h = p.r * 0.55;
      bar(ctx, at.x - h, at.y, at.x + h, at.y, K975, 2);
      if (p.q === 1) bar(ctx, at.x, at.y - h, at.x, at.y + h, K975, 2);
    }
    // Nu's charge: a flat ring round it.
    if (!this.overAt) ring(ctx, nu, nu.r + 7, this.q === 1 ? CYAN : WHITE, 3, 0.9);
    lives(s, ctx, this.left);
    nu.draw(ctx, now);
  }

  down(s: Stage): void {
    if (this.overAt) return;
    this.q = this.q === 1 ? -1 : 1;
    s.fx.ring(s.nu, this.q === 1 ? CYAN : WHITE, s.nu.r + 7, s.nu.r + 22, 300);
    tickSound(this.q === 1 ? 3 : 1);
  }

}

// ---- Poise -----------------------------------------------------------------------------------

/** How far the beam may tilt (radians), and the tilt atoms on it start to roll at. */
const POISE_LIMIT = 0.3;
const POISE_FRICTION = 0.13;
/** How stiff the beam is (its tilt is the torque over this), at the start and at its loosest. */
const POISE_STIFF = 12;
const POISE_LOOSE = 7;
/** Falling (px/ms² at scale 1) and rolling. */
const POISE_G = 0.0016;
const POISE_ROLL = 0.0007;

/** An atom: where on the beam (u along it from the pivot, v up from it, in px), or resting on
 *  another (`on`, at du, dv from it in the beam's frame). Falling ones have world x, y. */
type Weight = {
  r: number; c: string; m: number;
  u: number; v: number; vu: number;
  on: Weight | null; du: number; dv: number;
  x: number; y: number; vx: number; vy: number;
};

/** A seesaw across the lower arena on a pivot in its middle. Nu carries the next atom along the
 *  top; tap (or hold and slide) and Nu takes it to the finger's x and drops it. Atoms land on
 *  the beam, or on each other, and stay; the bigger, the heavier. The beam tilts with their
 *  weight. Tilted past a little, the atoms on it roll downhill. Tilted past the faint red marks,
 *  or an atom rolled off an end, and the run is over. Bigger atoms and a looser beam as the count
 *  goes up. */
export class Poise implements Toy {
  private on: Weight[] = [];
  private loose: Weight[] = [];
  private hand: Weight | null = null;
  private falling: Weight | null = null;
  private tx = 0;
  private armed = false;
  private held = false;
  private th = 0;
  private w = 0;
  private wait = 0;
  private count = 0;
  private overAt = 0;
  private k(s: Stage): number { return clamp(Math.min(s.hw, s.hh) / 200, 0.6, 1.5); }
  private pivot(s: Stage): Pt { return { x: s.m.x, y: s.m.y + s.hh * 0.45 }; }
  private len(s: Stage): number { return Math.min(s.hw * 0.78, 230 * this.k(s)); }
  private top(s: Stage): number { return s.m.y - s.hh + 40 * this.k(s); }

  enter(s: Stage): void {
    s.nu.r = 9;
    s.rim = null;
    this.on = [];
    this.loose = [];
    this.falling = null;
    this.th = this.w = 0;
    this.count = 0;
    this.overAt = 0;
    this.armed = this.held = false;
    this.tx = s.m.x;
    s.nu.at({ x: s.m.x, y: this.top(s) });
    this.hand = this.make(s);
    s.score(0, best(s, 'poise') || null);
  }

  private make(s: Stage): Weight {
    const k = this.k(s), n = this.count;
    const r = (7 + Math.random() * Math.min(9, 4 + n * 0.3)) * k;
    return {
      r, c: NOTE_COLOURS[Math.floor(Math.random() * NOTE_COLOURS.length)], m: (r / (10 * k)) ** 2,
      u: 0, v: 0, vu: 0, on: null, du: 0, dv: 0, x: 0, y: 0, vx: 0, vy: 0,
    };
  }

  /** The beam's frame: along it and up from it. */
  private axes(): { ex: number; ey: number; nx: number; ny: number } {
    const c = Math.cos(this.th), sn = Math.sin(this.th);
    return { ex: c, ey: sn, nx: sn, ny: -c };
  }

  /** An atom's place in the beam's frame. */
  private local(a: Weight): { u: number; v: number } {
    if (!a.on) return { u: a.u, v: a.v };
    const b = this.local(a.on);
    return { u: b.u + a.du, v: b.v + a.dv };
  }

  private world(s: Stage, l: { u: number; v: number }): Pt {
    const P = this.pivot(s), e = this.axes();
    return { x: P.x + e.ex * l.u + e.nx * l.v, y: P.y + e.ey * l.u + e.ny * l.v };
  }

  private toLocal(s: Stage, p: Pt): { u: number; v: number } {
    const P = this.pivot(s), e = this.axes(), dx = p.x - P.x, dy = p.y - P.y;
    return { u: dx * e.ex + dy * e.ey, v: dx * e.nx + dy * e.ny };
  }

  /** Where Nu can drop: over the beam, an atom in from its ends. */
  private span(s: Stage, r: number): [number, number] {
    const P = this.pivot(s), L = (this.len(s) - r - 4) * Math.cos(this.th);
    return [P.x - L, P.x + L];
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, k = this.k(s), L = this.len(s);
    // The beam: it leans toward its torque over its stiffness, on a soft spring.
    const P = this.pivot(s);
    let torque = 0;
    for (const a of this.on) torque += a.m * (this.world(s, this.local(a)).x - P.x) / L;
    const stiff = Math.max(POISE_LOOSE, POISE_STIFF - this.count * 0.15);
    const want = this.overAt ? Math.sign(this.th || 1) * POISE_LIMIT * 1.3 : torque / stiff;
    const W = TAU / 1000;
    this.w += ((want - this.th) * W * W - 2 * 0.65 * W * this.w) * dt;
    this.th += this.w * dt;
    // Loose atoms (the run is over) just fall.
    for (const a of this.loose) { a.vy += POISE_G * k * dt; a.x += a.vx * dt; a.y += a.vy * dt; }
    this.loose = this.loose.filter((a) => a.y < s.m.y + s.hh + 80);
    if (this.overAt) { nu.seek(nu, dt); return; }
    if (Math.abs(this.th) > POISE_LIMIT) { this.over(s, now); return; }
    this.roll(s, dt);
    if (this.on.some((a) => !a.on && Math.abs(a.u) > L)) { this.over(s, now); return; }
    // Nu along the top, the atom under it; it lets go once over the spot, the finger up.
    if (this.hand) {
      const [x0, x1] = this.span(s, this.hand.r);
      const to = { x: clamp(this.tx, x0, x1), y: this.top(s) };
      nu.seek(to, dt, 0.7 * k, 0.03);
      if (this.armed && !this.held && Math.abs(nu.x - to.x) < 3) {
        const a = this.hand;
        a.x = nu.x;
        a.y = nu.y + nu.r + a.r + 2;
        a.vx = a.vy = 0;
        this.falling = a;
        this.hand = null;
        this.armed = false;
        tickSound(2);
      }
    } else nu.seek({ x: nu.x, y: this.top(s) }, dt);
    if (this.falling) this.fall(s, dt, now);
    else if (!this.hand && (this.wait -= dt) <= 0) this.hand = this.make(s);
  }

  /** Atoms resting on the beam roll downhill once it tilts past a little. */
  private roll(s: Stage, dt: number): void {
    const k = this.k(s), fric = Math.max(0.07, POISE_FRICTION - this.count * 0.0015);
    const base = this.on.filter((a) => !a.on);
    for (const a of base) {
      if (Math.abs(this.th) > fric) a.vu += POISE_ROLL * k * Math.sin(this.th) * dt;
      else a.vu *= Math.exp(-dt / 70);
      a.vu *= Math.exp(-dt / 900);
      a.u += a.vu * dt;
    }
    // Side by side on the beam they can't pass: they push, and share their speed.
    base.sort((p, q) => p.u - q.u);
    for (let i = 1; i < base.length; i++) {
      const p = base[i - 1], q = base[i], gap = 2 * Math.sqrt(p.r * q.r) - (q.u - p.u);
      if (gap <= 0) continue;
      const mp = this.load(p), mq = this.load(q), f = mq / (mp + mq);
      p.u -= gap * f;
      q.u += gap * (1 - f);
      const v = (p.vu * mp + q.vu * mq) / (mp + mq);
      p.vu = q.vu = v;
    }
  }

  /** An atom's weight with everything resting on it. */
  private load(a: Weight): number {
    return this.on.reduce((m, b) => m + (this.rests(b, a) ? b.m : 0), 0);
  }

  private rests(b: Weight, a: Weight): boolean {
    for (let x: Weight | null = b; x; x = x.on) if (x === a) return true;
    return false;
  }

  /** The dropped atom falls, in small steps, until it lands on the beam or on another atom. */
  private fall(s: Stage, dt: number, now: number): void {
    const a = this.falling!, k = this.k(s), L = this.len(s);
    const n = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy + POISE_G * k * dt) * dt / 3));
    for (let i = 0; i < n; i++) {
      const h = dt / n;
      a.vy += POISE_G * k * h;
      a.x += a.vx * h;
      a.y += a.vy * h;
      for (const b of this.on) {
        const bp = this.world(s, this.local(b)), d = dist(a, bp), touch = a.r + b.r;
        if (d >= touch) continue;
        const nx = (a.x - bp.x) / (d || 1), ny = (a.y - bp.y) / (d || 1), e = this.axes();
        // On top, it stays there; on a side, it slides off and falls on.
        if (nx * e.nx + ny * e.ny > 0.65) {
          const la = this.toLocal(s, { x: bp.x + nx * touch, y: bp.y + ny * touch }), lb = this.local(b);
          this.settle(s, a, b, la.u - lb.u, la.v - lb.v);
          return;
        }
        a.x = bp.x + nx * touch;
        a.y = bp.y + ny * touch;
        a.vx = nx * 0.12 * k;
        a.vy *= 0.5;
      }
      const l = this.toLocal(s, a);
      if (Math.abs(l.u) <= L && l.v <= a.r && l.v > -a.r - 8) {
        a.u = l.u;
        a.v = a.r;
        this.settle(s, a, null, 0, 0);
        return;
      }
    }
    // Missed the beam altogether: off it goes.
    if (a.y > s.m.y + s.hh + a.r) { this.falling = null; this.over(s, now); }
  }

  private settle(s: Stage, a: Weight, on: Weight | null, du: number, dv: number): void {
    a.on = on;
    a.du = du;
    a.dv = dv;
    a.vu = 0;
    this.on.push(a);
    this.falling = null;
    this.wait = 250;
    this.count++;
    captureSound();
    s.fx.ring(this.world(s, this.local(a)), a.c, a.r, a.r + 18, 400);
    s.score(this.count, best(s, 'poise') || null);
    if (this.count % 10 === 0) completeSound();
  }

  private over(s: Stage, now: number): void {
    this.overAt = now;
    // Everything slides off the beam.
    for (const a of this.on) {
      const p = this.world(s, this.local(a)), e = this.axes();
      this.loose.push({ ...a, x: p.x, y: p.y, vx: e.ex * Math.sign(this.th || 1) * 0.15, vy: 0 });
    }
    if (this.falling) this.loose.push(this.falling);
    this.on = [];
    this.falling = null;
    this.hand = null;
    missSound();
    buzz(24);
    finish(s, 'poise', this.count);
    s.score(this.count, best(s, 'poise') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const P = this.pivot(s), L = this.len(s), e = this.axes(), nu = s.nu, k = this.k(s);
    // The tilt limit: a faint red mark under each end, where it would be at the limit.
    const cl = Math.cos(POISE_LIMIT), sl = Math.sin(POISE_LIMIT), m = 9 * k;
    for (const sx of [-1, 1]) {
      const x = P.x + sx * L * cl, y = P.y + L * sl + 6;
      bar(ctx, x - m, y, x + m, y, RED, 3, 0.4);
    }
    // The post and the pivot.
    bar(ctx, P.x, P.y, P.x, s.m.y + s.hh - 6, K800, 6);
    // The beam.
    const tilt = Math.abs(this.th) / POISE_LIMIT;
    bar(ctx, P.x - e.ex * L, P.y - e.ey * L, P.x + e.ex * L, P.y + e.ey * L, tilt > 0.75 && !this.overAt ? WHITE : K300, 5, 0.95);
    dot(ctx, P, 7 * k, K500);
    ring(ctx, P, 7 * k, K300, 2, 0.8);
    for (const a of this.on) this.atom(ctx, this.world(s, this.local(a)), a);
    for (const a of this.loose) this.atom(ctx, a, a);
    if (this.falling) this.atom(ctx, this.falling, this.falling);
    // Where the atom in hand will land: a faint line down from it.
    if (this.hand && !this.overAt) {
      const a = this.hand, p = { x: nu.x, y: nu.y + nu.r + a.r + 2 };
      ctx.save();
      ctx.setLineDash([4, 7]);
      bar(ctx, p.x, p.y + a.r + 6, p.x, P.y + (p.x - P.x) * Math.tan(this.th) - a.r * 2, K500, 2, 0.6);
      ctx.restore();
      this.atom(ctx, p, a, Math.min(1, (250 - Math.max(0, this.wait)) / 250));
    }
    nu.draw(ctx, now);
  }

  private atom(ctx: CanvasRenderingContext2D, p: Pt, a: Weight, grow = 1): void {
    dot(ctx, p, a.r * grow, a.c, 0.9);
    ring(ctx, p, a.r * 0.45 * grow, K975, 2, 0.5);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.tx = p.x;
    this.armed = true;
    this.held = true;
  }

  move(_s: Stage, p: Pt): void { if (this.held) this.tx = p.x; }
  up(): void { this.held = false; }
  resize(s: Stage): void { if (this.hand) Object.assign(s.nu, { y: this.top(s) }); }
}

// ---- Ferry -----------------------------------------------------------------------------------

/** The shells' span (of the court's radius), the rim where electrons wait, and Nu's size. */
const FERRY_IN = 0.32;
const FERRY_OUT = 0.76;
const FERRY_RIM = 0.88;
const FERRY_NU = 7;

type Shell = { c: string; r: number; a: number; w: number; gap: number; held: number[] };
type Electron = { c: string; a: number; t: number };

/** A nucleus in the middle of the court, with shells round it: rings of different colours, each
 *  turning its own way and with one gap. Electrons wait on the rim, in the shells' colours. Drag
 *  Nu (it follows a little behind) onto one to pick it up, then through the gaps to the shell of
 *  its colour, and touch it: placed. Carrying, touching any other shell knocks the electron loose,
 *  and each one carried has its time (the rim): either way it's one of three lives. A third shell
 *  at 5 placed and a fourth at 12; the shells turn faster and the gaps narrow as the count goes
 *  up. */
export class Ferry implements Toy {
  court = true;
  private shells: Shell[] = [];
  private free: Electron[] = [];
  private carry: string | null = null;
  private carryLeft = 0;
  private carryMs = 1;
  private grab: Pt | null = null;
  private want: Pt | null = null;
  private next = 0;
  private count = 0;
  private left = 3;
  private overAt = 0;
  private k(s: Stage): number { return s.R / 180; }

  enter(s: Stage): void {
    s.nu.r = FERRY_NU * clamp(this.k(s), 0.85, 1.3);
    s.nu.at({ x: s.c.x, y: s.c.y + s.R * FERRY_RIM });
    s.rim = null;
    this.shells = [];
    this.free = [];
    this.carry = null;
    this.grab = this.want = null;
    this.count = 0;
    this.left = 3;
    this.overAt = 0;
    this.addShell(s);
    this.addShell(s);
    this.layout(s, true);
    this.next = 0;
    s.score(0, best(s, 'ferry') || null);
  }

  /** A shell in a colour not yet used, between the others (the next ones go further in). */
  private addShell(s: Stage): void {
    const c = NOTE_COLOURS[this.shells.length];
    const sh: Shell = { c, r: 0, a: Math.random() * TAU, w: 0, gap: 0, held: [] };
    // The first two are the inner and outer; the next fit between.
    if (this.shells.length < 2) this.shells.push(sh);
    else this.shells.splice(1, 0, sh);
    this.layout(s, false);
  }

  /** Spreads the shells evenly from in to out (at once, or eased in step). */
  private targets(s: Stage): number[] {
    const n = this.shells.length;
    return this.shells.map((_, i) => s.R * (n < 2 ? FERRY_OUT : FERRY_IN + (FERRY_OUT - FERRY_IN) * (i / (n - 1))));
  }

  private layout(s: Stage, now: boolean): void {
    const t = this.targets(s);
    this.shells.forEach((sh, i) => { if (now || !sh.r) sh.r = t[i]; });
  }

  /** A shell's gap's half width (radians): its arc a little narrower as the count goes up. */
  private half(s: Stage, sh: Shell): number {
    const arc = Math.max(46, 64 - this.count * 0.8) * clamp(this.k(s), 0.85, 1.3);
    return arc / 2 / sh.r;
  }

  private spawn(s: Stage): void {
    const sh = this.shells[Math.floor(Math.random() * this.shells.length)];
    // Away from Nu.
    let a = Math.random() * TAU;
    const na = Math.atan2(s.nu.y - s.c.y, s.nu.x - s.c.x);
    for (let i = 0; i < 20 && Math.abs(wrap(a - na)) < 1; i++) a = Math.random() * TAU;
    this.free.push({ c: sh.c, a, t: 0 });
  }

  /** The way a shell touches Nu: 'gap' if Nu is through its gap, 'solid' if on its line, or null. */
  private touch(s: Stage, sh: Shell): 'solid' | 'gap' | null {
    const nu = s.nu, d = dist(nu, s.c);
    if (Math.abs(d - sh.r) >= nu.r + 1.5) return null;
    const h = this.half(s, sh), da = wrap(Math.atan2(nu.y - s.c.y, nu.x - s.c.x) - sh.a);
    if (Math.abs(da) > h) return 'solid';
    // The gap's ends.
    for (const e of [sh.a - h, sh.a + h]) {
      if (dist(nu, { x: s.c.x + Math.cos(e) * sh.r, y: s.c.y + Math.sin(e) * sh.r }) < nu.r + 1.5) return 'solid';
    }
    return 'gap';
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, k = this.k(s);
    // The shells ease to their places and turn, each its own way, quicker as it goes on.
    const t = this.targets(s), spin = 0.00032 + Math.min(0.0005, this.count * 0.000022);
    this.shells.forEach((sh, i) => {
      sh.r += (t[i] - sh.r) * (1 - Math.exp(-dt / 300));
      sh.w = spin * (i % 2 ? -1 : 1) * (1 + 0.25 * (this.shells.length - 1 - i));
      sh.a = wrap(sh.a + sh.w * dt);
    });
    if (this.overAt) { nu.seek(nu, dt); return; }
    if (this.want) nu.seek(inside(s, this.want, nu.r + 2), dt, 0.3 * k, 0.02);
    else nu.seek(nu, dt);
    Object.assign(nu, inside(s, nu, nu.r));
    // Electrons wait on the rim, drifting slowly; two at most.
    for (const e of this.free) { e.a += 0.00012 * dt; e.t += dt; }
    if (this.free.length < (this.carry ? 1 : 2)) {
      this.next -= dt;
      if (this.next <= 0) { this.spawn(s); this.next = 900; }
    }
    if (!this.carry) {
      for (let i = 0; i < this.free.length; i++) {
        const e = this.free[i], p = this.spot(s, e.a);
        if (dist(nu, p) > nu.r + 7) continue;
        this.free.splice(i, 1);
        this.carry = e.c;
        this.carryMs = this.carryLeft = Math.max(7000, 14000 - this.count * 300);
        tickSound(3);
        s.fx.ring(p, e.c, 5, 22, 350);
        break;
      }
      s.rim = null;
      return;
    }
    // Carrying: the time it has, on the rim.
    this.carryLeft -= dt;
    s.rim = clamp(this.carryLeft / this.carryMs, 0, 1);
    if (this.carryLeft <= 0) { this.lose(s, now); return; }
    for (const sh of this.shells) {
      if (this.touch(s, sh) !== 'solid') continue;
      if (sh.c !== this.carry) { this.lose(s, now); return; }
      // Placed: it joins the shell, where Nu touched it.
      sh.held.push(wrap(Math.atan2(nu.y - s.c.y, nu.x - s.c.x) - sh.a));
      if (sh.held.length > 10) sh.held.shift();
      this.carry = null;
      s.rim = null;
      this.count++;
      captureSound();
      s.fx.ring(nu, sh.c, nu.r, nu.r + 28, 500);
      s.score(this.count, best(s, 'ferry') || null);
      if ((this.count === 5 && this.shells.length < 3) || (this.count === 12 && this.shells.length < 4)) {
        this.addShell(s);
        completeSound();
      }
      return;
    }
  }

  private spot(s: Stage, a: number): Pt {
    return { x: s.c.x + Math.cos(a) * s.R * FERRY_RIM, y: s.c.y + Math.sin(a) * s.R * FERRY_RIM };
  }

  /** The electron Nu carries is lost. */
  private lose(s: Stage, now: number): void {
    const nu = s.nu;
    this.carry = null;
    s.rim = null;
    this.left--;
    s.fx.ring(nu, RED, nu.r, nu.r + 34, 600);
    missSound();
    buzz(24);
    if (this.left > 0) return;
    this.overAt = now;
    this.grab = this.want = null;
    finish(s, 'ferry', this.count);
    s.score(this.count, best(s, 'ferry') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const nu = s.nu, k = clamp(this.k(s), 0.85, 1.3);
    // The nucleus.
    dot(ctx, s.c, 9 * k, K500, 0.9);
    dot(ctx, { x: s.c.x - 3 * k, y: s.c.y - 2 * k }, 3.5 * k, K300, 0.9);
    dot(ctx, { x: s.c.x + 3 * k, y: s.c.y + 2.5 * k }, 3.5 * k, K300, 0.9);
    // The shells: a ring with its gap, and the electrons placed on it.
    ctx.save();
    ctx.lineCap = 'round';
    for (const sh of this.shells) {
      const h = this.half(s, sh);
      const near = this.carry === sh.c && !this.overAt;
      ctx.globalAlpha = near ? 1 : 0.8;
      ctx.strokeStyle = sh.c;
      ctx.lineWidth = near ? 4 : 3;
      ctx.beginPath();
      ctx.arc(s.c.x, s.c.y, sh.r, sh.a + h, sh.a - h + TAU);
      ctx.stroke();
    }
    ctx.restore();
    for (const sh of this.shells) {
      for (const a of sh.held) {
        const p = { x: s.c.x + Math.cos(sh.a + a) * sh.r, y: s.c.y + Math.sin(sh.a + a) * sh.r };
        dot(ctx, p, 4 * k, sh.c);
        ring(ctx, p, 4 * k, WHITE, 2, 0.5);
      }
    }
    // Electrons waiting on the rim.
    const pulse = 1 + 0.1 * Math.sin(now / 240);
    for (const e of this.free) {
      const p = this.spot(s, e.a), grow = Math.min(1, e.t / 300);
      dot(ctx, p, 5 * k * grow, e.c, 0.95);
      ring(ctx, p, 9 * k * pulse * grow, e.c, 2, 0.45);
    }
    lives(s, ctx, this.left);
    // The one Nu carries circles it, with a ring in its colour.
    if (this.carry && !this.overAt) {
      ring(ctx, nu, nu.r + 6 * k, this.carry, 2, 0.6);
      const a = now / 160;
      dot(ctx, { x: nu.x + Math.cos(a) * (nu.r + 6 * k), y: nu.y + Math.sin(a) * (nu.r + 6 * k) }, 4 * k, this.carry);
    }
    nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.grab = { x: s.nu.x - p.x, y: s.nu.y - p.y };
    this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y };
  }

  move(_s: Stage, p: Pt): void { if (this.grab) this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y }; }
  up(): void { this.grab = null; this.want = null; }
  resize(s: Stage): void { this.layout(s, true); Object.assign(s.nu, inside(s, s.nu, s.nu.r)); }
}
