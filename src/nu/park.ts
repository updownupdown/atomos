// Nu's park: a place to play with Nu, from the Nu button in Home's bar. Five tabs, five games:
//   Pet    — stroke Nu and it warms up, leans into your finger and purrs; tap it and it hops.
//   Fetch  — flick the photon; Nu chases it down and brings it back to you.
//   Sling  — pull Nu back and let go; it swings round the nuclei on gravity to reach the ring.
//   Course — guide Nu through a winding channel past orbiting electrons, against the clock.
//   Echo   — Nu flies a tune between five atoms; play it back, one note longer each round.
// When the park opens, the guide Nu (src/ui/nu.ts) flies in from the logo and the park takes it
// over; leaving, it hands Nu back where it is, and Nu flies home. It never jumps. Bests are kept
// on the device under PARK_KEY.

import { buzz, captureSound, chimeSound, completeSound, missSound, tickSound } from '../audio';
import { loadSave, writeSave } from '../core/save';
import { nuBorrow, nuEnabled, nuGiveBack } from '../ui/nu';
import './park.css';

type Pt = { x: number; y: number };
type TabId = 'pet' | 'fetch' | 'sling' | 'course' | 'echo';

const PARK_KEY = 'atomos.nu-park';
const ROSE = '#ff5aa8';
const CYAN = '#6fd0e6';
const GREEN = '#4ff29a';
const RED = '#e0503a';
const TRACK = '#1f2225';
const MUTED = '#50575b';
/** Orbital colours (s, p, d, f) and the accent: Echo's five atoms. */
const NOTE_COLOURS = ['#5f8ae0', '#2ea57a', '#c07f1e', '#a865d6', CYAN];

interface Bests { fetch: number; sling: number; course: Record<string, number>; echo: number; pets: number }

function readBests(): Bests {
  const b: Bests = { fetch: 0, sling: 0, course: {}, echo: 0, pets: 0 };
  try {
    const v = JSON.parse(localStorage.getItem(PARK_KEY) ?? 'null');
    if (v && typeof v === 'object') {
      for (const k of ['fetch', 'sling', 'echo', 'pets'] as const) if (Number.isFinite(v[k])) b[k] = v[k];
      if (v.course && typeof v.course === 'object') b.course = v.course;
    }
  } catch { /* nothing kept */ }
  return b;
}

function writeBests(b: Bests): void {
  try { localStorage.setItem(PARK_KEY, JSON.stringify(b)); } catch { /* not kept */ }
}

/** A small seeded random, so each Sling level and Course is the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---- Nu, as the park draws it ----------------------------------------------------------------

class Body {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  r = 9;
  /** How much it glows, 1 at rest. */
  glow = 1;
  /** A squash for hops and bumps, 1 at rest. */
  scale = 1;
  hidden = false;
  private hist: { x: number; y: number; t: number }[] = [];

  at(p: Pt): void { this.x = p.x; this.y = p.y; this.vx = 0; this.vy = 0; this.hist = []; }

  /** Steers toward `to` with a top speed (px/ms) and slows as it arrives: no jumps, no jerks. */
  seek(to: Pt, dt: number, top = 0.5, ease = 0.006): void {
    const dx = to.x - this.x, dy = to.y - this.y, d = Math.hypot(dx, dy);
    const want = Math.min(top, d * ease * 1.6);
    const tx = d > 0.01 ? (dx / d) * want : 0, ty = d > 0.01 ? (dy / d) * want : 0;
    const k = 1 - Math.exp(-dt / 90);
    this.vx += (tx - this.vx) * k;
    this.vy += (ty - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.hidden) return;
    this.hist.unshift({ x: this.x, y: this.y, t: now });
    while (this.hist.length > 2 && now - this.hist[this.hist.length - 1].t > 170) this.hist.pop();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = ROSE;
    for (let i = 1; i < this.hist.length; i++) {
      const f = 1 - i / this.hist.length;
      ctx.globalAlpha = f * 0.9;
      ctx.lineWidth = this.r * 0.9 * f + 0.6;
      ctx.beginPath();
      ctx.moveTo(this.hist[i - 1].x, this.hist[i - 1].y);
      ctx.lineTo(this.hist[i].x, this.hist[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowColor = 'rgba(255, 90, 168, 0.75)';
    ctx.shadowBlur = 16 * this.glow;
    ctx.fillStyle = ROSE;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * this.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Soft things that come and go: rings that spread and sparks that drift. */
class Fx {
  private rings: { x: number; y: number; t0: number; c: string; r0: number; r1: number; ms: number }[] = [];
  private sparks: { x: number; y: number; vx: number; vy: number; t0: number; ms: number; c: string }[] = [];

  ring(p: Pt, c = ROSE, r0 = 10, r1 = 46, ms = 900): void {
    this.rings.push({ x: p.x, y: p.y, t0: performance.now(), c, r0, r1, ms });
  }

  burst(p: Pt, n = 8, c = ROSE, speed = 0.12): void {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const s = speed * (0.6 + Math.random() * 0.6);
      this.sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.03, t0: now, ms: 700 + Math.random() * 400, c });
    }
  }

  clear(): void { this.rings = []; this.sparks = []; }

  draw(ctx: CanvasRenderingContext2D, now: number, dt: number): void {
    this.rings = this.rings.filter((r) => now - r.t0 < r.ms);
    this.sparks = this.sparks.filter((s) => now - s.t0 < s.ms);
    ctx.save();
    for (const r of this.rings) {
      const t = (now - r.t0) / r.ms;
      ctx.globalAlpha = 0.55 * (1 - t);
      ctx.strokeStyle = r.c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - (1 - t) * (1 - t)), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const s of this.sparks) {
      const t = (now - s.t0) / s.ms;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.985;
      s.vy *= 0.985;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.4 * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---- The games -------------------------------------------------------------------------------

interface Stage {
  w: number;
  h: number;
  nu: Body;
  fx: Fx;
  bests: Bests;
  save(): void;
  /** The line under the tabs: what to do, and the score. */
  say(hint: string, score?: string): void;
}

interface Toy {
  /** Nu has just arrived (or the tab just opened): set up. */
  enter(s: Stage): void;
  step(s: Stage, dt: number, now: number): void;
  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void;
  down?(s: Stage, p: Pt): void;
  move?(s: Stage, p: Pt): void;
  up?(s: Stage, p: Pt): void;
  /** The canvas changed size. */
  resize?(s: Stage): void;
}

/** Pet: stroke Nu and it warms up; tap it and it hops. Full of happiness, it purrs: three little
 *  electrons circle it and its glow swells. */
class Pet implements Toy {
  private happy = 0;
  private finger: Pt | null = null;
  private downAt = 0;
  private downP: Pt | null = null;
  private lastRing = 0;
  private hop = 0;
  private stroked = 0;
  private lastBurst = -Infinity;
  private home(s: Stage): Pt { return { x: s.w / 2, y: s.h * 0.48 }; }

  enter(s: Stage): void {
    s.nu.r = 13;
    this.say(s);
  }

  private say(s: Stage): void {
    const pct = Math.round(this.happy * 100);
    s.say(this.happy >= 1 ? 'Nu is purring. Keep it company.' : 'Stroke Nu with your finger. Tap it to make it hop.', `Happy ${pct}%`);
  }

  step(s: Stage, dt: number, now: number): void {
    const h = this.home(s);
    let to = { x: h.x, y: h.y + Math.sin(now / 900) * 6 };
    // It leans into a finger nearby.
    if (this.finger && dist(this.finger, h) < 140) to = { x: h.x + (this.finger.x - h.x) * 0.18, y: h.y + (this.finger.y - h.y) * 0.18 };
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt);
      const t = 1 - this.hop / 520;
      to.y -= Math.sin(t * Math.PI) * 46;
      s.nu.scale = 1 + Math.sin(t * Math.PI * 2) * 0.12;
    } else s.nu.scale = 1 + Math.sin(now / 700) * 0.03 * (1 + this.happy);
    s.nu.seek(to, dt, 0.6, 0.012);
    const before = Math.round(this.happy * 100);
    this.happy = clamp(this.happy - dt * 0.00003, 0, 1);
    s.nu.glow = 1 + this.happy * 1.4;
    if (Math.round(this.happy * 100) !== before) this.say(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    if (this.happy > 0.66) {
      // Purring: three small electrons on a tilted ring round Nu.
      const k = clamp((this.happy - 0.66) / 0.34, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.35 * k;
      ctx.strokeStyle = MUTED;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(s.nu.x, s.nu.y, 40, 15, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = k;
      ctx.fillStyle = CYAN;
      for (let i = 0; i < 3; i++) {
        const a = now / 700 + (i * Math.PI * 2) / 3;
        const ex = Math.cos(a) * 40, ey = Math.sin(a) * 15;
        ctx.beginPath();
        ctx.arc(s.nu.x + ex * Math.cos(-0.3) - ey * Math.sin(-0.3), s.nu.y + ex * Math.sin(-0.3) + ey * Math.cos(-0.3), 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    this.finger = p;
    this.downAt = performance.now();
    this.downP = p;
    this.stroked = 0;
    void s;
  }

  move(s: Stage, p: Pt): void {
    const last = this.finger;
    this.finger = p;
    if (!last || !this.downP) return;
    const near = dist(p, s.nu) < s.nu.r + 46;
    if (!near) return;
    const d = dist(p, last);
    this.stroked += d;
    const was = this.happy;
    this.happy = clamp(this.happy + d * 0.0016, 0, 1);
    const now = performance.now();
    if (now - this.lastRing > 160) { this.lastRing = now; s.fx.ring(s.nu, ROSE, s.nu.r, s.nu.r + 30, 800); }
    // Full: a little burst of joy, now and then, not on every stroke.
    if (was < 1 && this.happy >= 1 && now - this.lastBurst > 8000) { this.lastBurst = now; s.fx.burst(s.nu, 12); completeSound(); buzz(12); }
    this.say(s);
  }

  up(s: Stage, p: Pt): void {
    const quick = performance.now() - this.downAt < 260 && this.downP && dist(p, this.downP) < 12;
    if (quick && dist(p, s.nu) < s.nu.r + 30) {
      this.hop = 520;
      this.happy = clamp(this.happy + 0.06, 0, 1);
      s.fx.burst({ x: s.nu.x, y: s.nu.y + s.nu.r }, 6, ROSE, 0.08);
      tickSound(2);
      this.say(s);
    }
    if (this.stroked > 30) { s.bests.pets++; s.save(); }
    this.finger = null;
    this.downP = null;
  }
}

/** Fetch: flick the photon; Nu chases it, catches it and brings it back to where you let go. */
class Fetch implements Toy {
  private ball = { x: 0, y: 0, vx: 0, vy: 0 };
  private state: 'wait' | 'chase' | 'carry' = 'wait';
  private held = false;
  private trail: { x: number; y: number; t: number }[] = [];
  private drop: Pt = { x: 0, y: 0 };
  private count = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.ball = { x: s.w / 2, y: s.h * 0.78, vx: 0, vy: 0 };
    this.drop = { x: s.w / 2, y: s.h * 0.78 };
    this.state = 'wait';
    this.say(s);
  }

  private say(s: Stage): void {
    s.say('Flick the photon and Nu fetches it.', `Fetched ${this.count} · best ${s.bests.fetch}`);
  }

  resize(s: Stage): void {
    this.ball.x = clamp(this.ball.x, 8, s.w - 8);
    this.ball.y = clamp(this.ball.y, 8, s.h - 8);
  }

  step(s: Stage, dt: number, now: number): void {
    const b = this.ball, nu = s.nu;
    if (!this.held && this.state !== 'carry') {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const f = Math.pow(0.9975, dt);
      b.vx *= f;
      b.vy *= f;
      const r = 7;
      if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * 0.8; }
      if (b.x > s.w - r) { b.x = s.w - r; b.vx = -Math.abs(b.vx) * 0.8; }
      if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy) * 0.8; }
      if (b.y > s.h - r) { b.y = s.h - r; b.vy = -Math.abs(b.vy) * 0.8; }
    }
    if (this.state === 'wait') {
      // Waits a little above the photon, bobbing, eager.
      nu.seek({ x: b.x + Math.sin(now / 500) * 10, y: Math.max(20, b.y - 60) + Math.cos(now / 400) * 4 }, dt, 0.35, 0.01);
    } else if (this.state === 'chase') {
      nu.seek(b, dt, 0.62, 0.02);
      if (dist(nu, b) < nu.r + 8) { this.state = 'carry'; captureSound(); s.fx.ring(b, CYAN, 6, 30, 500); }
    } else {
      nu.seek(this.drop, dt, 0.45, 0.01);
      b.x = nu.x + 10;
      b.y = nu.y - 6;
      if (dist(nu, this.drop) < 6) {
        this.state = 'wait';
        b.x = this.drop.x;
        b.y = this.drop.y;
        b.vx = b.vy = 0;
        this.count++;
        if (this.count > s.bests.fetch) { s.bests.fetch = this.count; s.save(); }
        s.fx.burst(nu, 8);
        tickSound(3);
        this.say(s);
      }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const b = this.ball;
    if (this.state !== 'carry') {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 15 + Math.sin(now / 300) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    s.nu.draw(ctx, now);
    ctx.save();
    ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  down(s: Stage, p: Pt): void {
    if (dist(p, this.ball) > 44 || this.state === 'carry') return;
    this.held = true;
    this.state = 'wait';
    this.trail = [{ ...p, t: performance.now() }];
    void s;
  }

  move(s: Stage, p: Pt): void {
    if (!this.held) return;
    this.ball.x = clamp(p.x, 7, s.w - 7);
    this.ball.y = clamp(p.y, 7, s.h - 7);
    this.trail.unshift({ ...p, t: performance.now() });
    this.trail.length = Math.min(this.trail.length, 8);
  }

  up(s: Stage, p: Pt): void {
    if (!this.held) return;
    this.held = false;
    const now = performance.now();
    const old = this.trail.find((q) => now - q.t > 40) ?? this.trail[this.trail.length - 1];
    const dt = Math.max(16, now - old.t);
    let vx = (p.x - old.x) / dt, vy = (p.y - old.y) / dt;
    const sp = Math.hypot(vx, vy);
    if (sp > 2.4) { vx *= 2.4 / sp; vy *= 2.4 / sp; }
    this.ball.vx = vx;
    this.ball.vy = vy;
    this.drop = { x: clamp(p.x, 20, s.w - 20), y: clamp(p.y, 20, s.h - 20) };
    if (sp > 0.15) this.state = 'chase';
  }
}

/** Sling: pull back from Nu and let go; it swings round the nuclei on their gravity. Reach the
 *  ring to move on to the next layout. Nu never leaves the field: its edges bounce it back. */
class Sling implements Toy {
  private level = 1;
  private nuclei: { x: number; y: number; m: number; r: number }[] = [];
  private ring = { x: 0, y: 0, r: 24 };
  private pad: Pt = { x: 0, y: 0 };
  private state: 'aim' | 'fly' | 'back' = 'back';
  private pull: Pt | null = null;
  private flown = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.layout(s);
    this.state = 'back';
  }

  resize(s: Stage): void { this.layout(s); }

  private layout(s: Stage): void {
    const rnd = seeded(this.level * 7919);
    const { w, h } = s;
    this.pad = { x: w * (0.2 + rnd() * 0.6), y: h - 56 };
    this.ring = { x: w * (0.2 + rnd() * 0.6), y: h * (0.12 + rnd() * 0.18), r: Math.max(18, 28 - this.level) };
    const n = Math.min(3, 1 + Math.floor(this.level / 3));
    this.nuclei = [];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const c = { x: w * (0.18 + rnd() * 0.64), y: h * (0.3 + rnd() * 0.38), m: 9 + rnd() * 10, r: 0 };
        c.r = 7 + c.m * 0.6;
        if (this.nuclei.every((o) => dist(o, c) > 90) && dist(c, this.ring) > 70 && dist(c, this.pad) > 80) { this.nuclei.push(c); break; }
      }
    }
    this.say(s);
  }

  private say(s: Stage): void {
    s.say('Pull back from Nu and let go. Swing it round the nuclei into the ring.', `Ring ${this.level} · best ${s.bests.sling}`);
  }

  private accel(x: number, y: number): Pt {
    let ax = 0, ay = 0;
    for (const c of this.nuclei) {
      const dx = c.x - x, dy = c.y - y, d2 = dx * dx + dy * dy + 400;
      const a = (c.m * 0.012) / d2;
      const d = Math.sqrt(d2);
      ax += (a * dx) / d * 1000;
      ay += (a * dy) / d * 1000;
    }
    return { x: ax / 1000, y: ay / 1000 };
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'back') {
      nu.seek(this.pad, dt, 0.5, 0.01);
      if (dist(nu, this.pad) < 3) this.state = 'aim';
      return;
    }
    if (this.state === 'aim') {
      const off = this.pull ? { x: (this.pull.x - this.pad.x) * 0.25, y: (this.pull.y - this.pad.y) * 0.25 } : { x: 0, y: Math.sin(now / 600) * 3 };
      const len = Math.hypot(off.x, off.y), max = 34;
      const k = len > max ? max / len : 1;
      nu.seek({ x: this.pad.x + off.x * k, y: this.pad.y + off.y * k }, dt, 0.8, 0.03);
      return;
    }
    // Flying: a few small steps a frame, so a close pass round a nucleus stays smooth.
    const steps = Math.ceil(dt / 4);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.accel(nu.x, nu.y);
      nu.vx += a.x * h;
      nu.vy += a.y * h;
      const sp = Math.hypot(nu.vx, nu.vy);
      if (sp > 1.1) { nu.vx *= 1.1 / sp; nu.vy *= 1.1 / sp; }
      nu.x += nu.vx * h;
      nu.y += nu.vy * h;
      const r = nu.r;
      if (nu.x < r) { nu.x = r; nu.vx = Math.abs(nu.vx) * 0.7; }
      if (nu.x > s.w - r) { nu.x = s.w - r; nu.vx = -Math.abs(nu.vx) * 0.7; }
      if (nu.y < r) { nu.y = r; nu.vy = Math.abs(nu.vy) * 0.7; }
      if (nu.y > s.h - r) { nu.y = s.h - r; nu.vy = -Math.abs(nu.vy) * 0.7; }
      for (const c of this.nuclei) {
        if (dist(nu, c) < c.r + nu.r) {
          // Bounced off a nucleus: a little knock, then home.
          const d = dist(nu, c) || 1;
          nu.x = c.x + ((nu.x - c.x) / d) * (c.r + nu.r);
          nu.y = c.y + ((nu.y - c.y) / d) * (c.r + nu.r);
          nu.vx *= -0.3;
          nu.vy *= -0.3;
          s.fx.ring(c, RED, c.r, c.r + 18, 500);
          missSound();
          this.state = 'back';
          return;
        }
      }
      if (dist(nu, this.ring) < this.ring.r - 2) {
        s.fx.burst(this.ring, 14, GREEN, 0.14);
        s.fx.ring(this.ring, GREEN, this.ring.r, this.ring.r + 34, 800);
        completeSound();
        buzz(14);
        if (this.level > s.bests.sling) { s.bests.sling = this.level; s.save(); }
        this.level++;
        this.layout(s);
        this.state = 'back';
        return;
      }
    }
    this.flown += dt;
    if (this.flown > 6000 || (this.flown > 900 && Math.hypot(nu.vx, nu.vy) < 0.04)) this.state = 'back';
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    // The ring to reach.
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(this.ring.x, this.ring.y, this.ring.r, 0, Math.PI * 2);
    ctx.stroke();
    // The pad.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = MUTED;
    ctx.beginPath();
    ctx.arc(this.pad.x, this.pad.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    // The nuclei, each with a faint well round it.
    for (const c of this.nuclei) {
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 2;
      ctx.strokeStyle = MUTED;
      for (const k of [2.2, 3.4]) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#a3abaf';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Aiming: where Nu would go for the first second.
    if (this.state === 'aim' && this.pull) {
      const v = this.launch();
      let x = s.nu.x, y = s.nu.y, vx = v.x, vy = v.y;
      ctx.fillStyle = ROSE;
      for (let i = 1; i <= 60; i++) {
        const a = this.accel(x, y);
        vx += a.x * 16;
        vy += a.y * 16;
        x += vx * 16;
        y += vy * 16;
        if (i % 5) continue;
        ctx.globalAlpha = 0.6 * (1 - i / 64);
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    s.nu.draw(ctx, now);
  }

  private launch(): Pt {
    if (!this.pull) return { x: 0, y: 0 };
    const dx = this.pad.x - this.pull.x, dy = this.pad.y - this.pull.y;
    const len = Math.hypot(dx, dy), k = Math.min(len, 160) / (len || 1);
    return { x: dx * k * 0.0062, y: dy * k * 0.0062 };
  }

  down(_s: Stage, p: Pt): void { if (this.state === 'aim') this.pull = p; }
  move(_s: Stage, p: Pt): void { if (this.pull) this.pull = p; }

  up(s: Stage): void {
    if (!this.pull || this.state !== 'aim') { this.pull = null; return; }
    const v = this.launch();
    this.pull = null;
    if (Math.hypot(v.x, v.y) < 0.12) return;
    s.nu.vx = v.x;
    s.nu.vy = v.y;
    this.flown = 0;
    this.state = 'fly';
    tickSound(1);
  }
}

/** Course: lead Nu up a winding channel to the green ring without touching its walls or the
 *  electrons crossing it. A touch sends Nu back to the last gate. Each course is a little
 *  narrower and busier than the one before. */
class Course implements Toy {
  private level = 1;
  private path: Pt[] = [];
  private half = 30;
  private orbits: { i: number; r: number; speed: number; phase: number }[] = [];
  private gates: number[] = [];
  private gate = 0;
  private progress = 0;
  private finger: Pt | null = null;
  private time = 0;
  private state: 'ready' | 'run' | 'back' | 'done' = 'ready';
  private hitAt = 0;

  enter(s: Stage): void {
    s.nu.r = 8;
    this.build(s);
  }

  resize(s: Stage): void { this.build(s); }

  private build(s: Stage): void {
    const rnd = seeded(this.level * 104729);
    const { w, h } = s;
    this.half = Math.max(17, 32 - this.level * 2.5);
    const rows = 5 + Math.min(3, this.level);
    const ctrl: Pt[] = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const side = i % 2 ? 0.78 : 0.22;
      const x = i === 0 || i === rows ? w / 2 : w * (side + (rnd() - 0.5) * 0.12);
      ctrl.push({ x, y: h - 34 - t * (h - 68) });
    }
    // A smooth line through the points (Catmull-Rom), sampled every few px.
    const pts: Pt[] = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const n = Math.ceil(dist(p1, p2) / 4);
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        pts.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    pts.push(ctrl[ctrl.length - 1]);
    this.path = pts;
    const n = pts.length;
    this.gates = [0, Math.floor(n / 3), Math.floor((2 * n) / 3)];
    this.orbits = [];
    const count = Math.min(5, this.level + 1);
    for (let k = 0; k < count; k++) {
      let i = Math.floor(n * (0.15 + (0.7 * (k + 0.5)) / count));
      // Not on a gate, where Nu comes back to after a knock.
      if (this.gates.some((g) => Math.abs(g - i) < 14)) i = Math.min(n - 20, i + 16);
      this.orbits.push({ i, r: this.half * (0.55 + rnd() * 0.3), speed: (0.0016 + rnd() * 0.0014) * (rnd() < 0.5 ? -1 : 1), phase: rnd() * 6.3 });
    }
    this.gate = 0;
    this.progress = 0;
    this.state = 'back';
    this.time = 0;
    this.say(s);
  }

  private best(s: Stage): number | undefined { return s.bests.course[String(this.level)]; }

  private say(s: Stage, extra?: string): void {
    const b = this.best(s);
    const t = this.state === 'run' ? this.time : this.state === 'done' ? this.time : 0;
    s.say(extra ?? 'Drag to lead Nu up the channel. Mind the walls and the electrons.', `Course ${this.level} · ${(t / 1000).toFixed(1)} s${b ? ` · best ${(b / 1000).toFixed(1)} s` : ''}`);
  }

  private electron(o: { i: number; r: number; speed: number; phase: number }, now: number): Pt {
    const c = this.path[o.i];
    const a = o.phase + now * o.speed;
    return { x: c.x + Math.cos(a) * o.r, y: c.y + Math.sin(a) * o.r };
  }

  /** The nearest point of the channel's middle to `p`, looking near where Nu has got to. */
  private nearest(p: Pt): { i: number; d: number } {
    let best = { i: this.progress, d: Infinity };
    const lo = Math.max(0, this.progress - 25), hi = Math.min(this.path.length - 1, this.progress + 25);
    for (let i = lo; i <= hi; i++) {
      const d = dist(p, this.path[i]);
      if (d < best.d) best = { i, d };
    }
    return best;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'back') {
      const g = this.path[this.gates[this.gate]];
      nu.seek(g, dt, 0.5, 0.012);
      if (dist(nu, g) < 3) { this.state = this.gate === 0 && this.time === 0 ? 'ready' : 'run'; this.progress = this.gates[this.gate]; }
      return;
    }
    if (this.state === 'done') { nu.seek(this.path[this.path.length - 1], dt, 0.3, 0.01); return; }
    if (this.state === 'ready' && this.finger) this.state = 'run';
    if (this.state !== 'run') { nu.seek({ x: this.path[0].x, y: this.path[0].y + Math.sin(now / 600) * 3 }, dt, 0.2, 0.01); return; }
    this.time += dt;
    if (this.finger) nu.seek(this.finger, dt, 0.42, 0.02);
    else { nu.vx *= 0.9; nu.vy *= 0.9; }
    const n = this.nearest(nu);
    this.progress = n.i;
    for (let g = this.gates.length - 1; g > this.gate; g--) if (this.progress >= this.gates[g]) { this.gate = g; s.fx.ring(this.path[this.gates[g]], CYAN, 8, 30, 600); tickSound(2); break; }
    let hit = n.d > this.half - nu.r;
    if (!hit) for (const o of this.orbits) if (dist(nu, this.electron(o, now)) < nu.r + 4) hit = true;
    if (hit) {
      this.hitAt = now;
      s.fx.ring(nu, RED, nu.r, nu.r + 22, 500);
      missSound();
      this.state = 'back';
      this.finger = null;
      return;
    }
    if (this.progress >= this.path.length - 3) {
      this.state = 'done';
      s.fx.burst(nu, 14, GREEN, 0.14);
      completeSound();
      buzz(14);
      const b = this.best(s);
      const record = !b || this.time < b;
      if (record) { s.bests.course[String(this.level)] = Math.round(this.time); s.save(); }
      this.say(s, record ? 'A new best. Tap for the next course.' : 'Through! Tap for the next course.');
      return;
    }
    if (Math.floor(this.time / 100) !== Math.floor((this.time - dt) / 100)) this.say(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const p = this.path;
    if (p.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = () => { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (const q of p) ctx.lineTo(q.x, q.y); };
    // The channel, and a brief red edge where Nu last touched it.
    const flash = clamp(1 - (now - this.hitAt) / 400, 0, 1);
    if (flash > 0) { ctx.strokeStyle = RED; ctx.globalAlpha = flash * 0.6; ctx.lineWidth = this.half * 2 + 6; line(); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = TRACK;
    ctx.lineWidth = this.half * 2;
    line();
    ctx.stroke();
    // The gates and the goal.
    for (let g = 1; g < this.gates.length; g++) {
      const q = p[this.gates[g]];
      ctx.fillStyle = g <= this.gate ? CYAN : MUTED;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const goal = p[p.length - 1];
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(goal.x, goal.y, Math.min(16, this.half - 4), 0, Math.PI * 2);
    ctx.stroke();
    // The electrons crossing the channel, each round its own nucleus.
    for (const o of this.orbits) {
      const c = p[o.i], e = this.electron(o, now);
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = MUTED;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, o.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = MUTED;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = CYAN;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'done') { this.level++; this.build(s); return; }
    if (this.state === 'run' || this.state === 'ready') this.finger = p;
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

/** Echo: five atoms in a ring. Nu flies a tune between them; play it back by tapping the atoms
 *  in the same order. Each round the tune is a note longer. */
class Echo implements Toy {
  private nodes: Pt[] = [];
  private tune: number[] = [];
  private state: 'show' | 'listen' | 'wrong' | 'wait' = 'wait';
  private at = 0;
  private lit = new Map<number, number>();
  private timer = 0;
  private flyTo: Pt | null = null;
  private wrongAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.place(s);
    this.tune = [];
    this.next(s);
  }

  resize(s: Stage): void { this.place(s); }

  private place(s: Stage): void {
    const c = { x: s.w / 2, y: s.h / 2 }, R = Math.min(s.w, s.h) * 0.32;
    this.nodes = Array.from({ length: 5 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      return { x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R };
    });
  }

  private say(s: Stage, hint: string): void {
    s.say(hint, `Round ${Math.max(1, this.tune.length)} · best ${s.bests.echo}`);
  }

  private next(s: Stage): void {
    let n = Math.floor(Math.random() * 5);
    if (this.tune.length && n === this.tune[this.tune.length - 1]) n = (n + 1 + Math.floor(Math.random() * 4)) % 5;
    this.tune.push(n);
    this.state = 'wait';
    this.timer = 900;
    this.at = 0;
    this.say(s, 'Watch where Nu goes.');
  }

  private light(i: number): void {
    this.lit.set(i, performance.now());
    chimeSound(i);
  }

  step(s: Stage, dt: number): void {
    const nu = s.nu;
    if (this.flyTo) nu.seek(this.flyTo, dt, 0.7, 0.02);
    else nu.seek({ x: s.w / 2, y: s.h / 2 }, dt, 0.4, 0.01);
    if (this.state === 'wait') {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'show'; this.at = 0; this.flyTo = this.nodes[this.tune[0]]; }
    } else if (this.state === 'show') {
      const i = this.tune[this.at];
      if (this.flyTo && dist(nu, this.flyTo) < 5) {
        this.light(i);
        this.at++;
        if (this.at >= this.tune.length) { this.state = 'listen'; this.at = 0; this.flyTo = null; this.say(s, 'Now you: tap the atoms in the same order.'); }
        else this.flyTo = this.nodes[this.tune[this.at]];
      }
    } else if (this.state === 'wrong') {
      this.timer -= dt;
      if (this.timer <= 0) { this.tune = []; this.next(s); }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    this.nodes.forEach((p, i) => {
      const t = this.lit.get(i);
      const on = t !== undefined ? clamp(1 - (now - t) / 520, 0, 1) : 0;
      const c = NOTE_COLOURS[i];
      ctx.globalAlpha = 0.28 + 0.72 * on;
      ctx.fillStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 24 * on;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24 + on * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 34, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
    // A wrong note: Nu shivers.
    const shake = this.state === 'wrong' ? Math.sin((now - this.wrongAt) / 25) * 3 * clamp(1 - (now - this.wrongAt) / 600, 0, 1) : 0;
    s.nu.x += shake;
    s.nu.draw(ctx, now);
    s.nu.x -= shake;
  }

  down(s: Stage, p: Pt): void {
    if (this.state !== 'listen') return;
    const i = this.nodes.findIndex((q) => dist(p, q) < 38);
    if (i < 0) return;
    this.flyTo = this.nodes[i];
    if (i !== this.tune[this.at]) {
      this.lit.set(i, performance.now());
      missSound();
      this.state = 'wrong';
      this.wrongAt = performance.now();
      this.timer = 1600;
      this.flyTo = null;
      const reached = this.tune.length - 1;
      this.say(s, reached > 0 ? `Not quite. You echoed ${reached} ${reached === 1 ? 'note' : 'notes'}. Again!` : 'Not quite. Again!');
      return;
    }
    this.light(i);
    this.at++;
    if (this.at >= this.tune.length) {
      if (this.tune.length > s.bests.echo) { s.bests.echo = this.tune.length; s.save(); }
      s.fx.burst(this.nodes[i], 10, NOTE_COLOURS[i], 0.12);
      this.state = 'wait';
      this.timer = 700;
      window.setTimeout(() => { if (this.state === 'wait') this.next(s); }, 650);
    }
  }
}

// ---- The screen ------------------------------------------------------------------------------

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'pet', label: 'Pet', icon: '<circle cx="12" cy="15" r="4" fill="currentColor"/><path d="M6 8.5a8 8 0 0 1 12 0M8.8 5.2a4.5 4.5 0 0 1 6.4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { id: 'fetch', label: 'Fetch', icon: '<circle cx="7" cy="16" r="3.5" fill="currentColor"/><circle cx="18" cy="7" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 12.5C11 9 13 7.8 15 7.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3"/>' },
  { id: 'sling', label: 'Sling', icon: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M3.5 18C5 9 15 4 20.5 8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="20.5" cy="8.5" r="2" fill="currentColor"/>' },
  { id: 'course', label: 'Course', icon: '<path d="M7 21V17c0-3 10-2 10-5.5S7 8.5 7 5.5V3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="7" cy="3.2" r="2" fill="currentColor"/>' },
  { id: 'echo', label: 'Echo', icon: '<circle cx="12" cy="4.5" r="2.3" fill="currentColor"/><circle cx="19.5" cy="10" r="2.3" fill="currentColor"/><circle cx="16.7" cy="19" r="2.3" fill="currentColor"/><circle cx="7.3" cy="19" r="2.3" fill="currentColor"/><circle cx="4.5" cy="10" r="2.3" fill="currentColor"/>' },
];

const TAB_KEY = 'atomos.nu-park-tab';

export class NuPark {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hint: HTMLElement;
  private score: HTMLElement;
  private off: HTMLElement;
  private tabButtons: HTMLButtonElement[] = [];
  private toys: Record<TabId, Toy> = { pet: new Pet(), fetch: new Fetch(), sling: new Sling(), course: new Course(), echo: new Echo() };
  private tab: TabId = 'pet';
  private stage: Stage;
  private frame = 0;
  private last = 0;
  private open = false;
  /** Nu is ours: borrowed from the guide (or the guide is off and the park draws its own). */
  private have = false;
  private borrowed = false;
  private size = { w: 0, h: 0 };

  constructor(host: HTMLElement) {
    this.root = host;
    host.innerHTML = '<div class="nup">'
      + `<div class="nup-tabs" role="tablist" aria-label="Games">${TABS.map((t) => `<button type="button" role="tab" class="nup-tab" data-tab="${t.id}"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${t.icon}</svg><span>${t.label}</span></button>`).join('')}</div>`
      + '<div class="nup-info"><p class="nup-hint"></p><p class="nup-score"></p></div>'
      + '<div class="nup-field"><canvas class="nup-canvas"></canvas>'
      + '<div class="nup-off" hidden><p>Nu is switched off in Settings.</p><button type="button" class="nup-on">Turn Nu on</button></div></div>'
      + '</div>';
    this.canvas = host.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.hint = host.querySelector('.nup-hint')!;
    this.score = host.querySelector('.nup-score')!;
    this.off = host.querySelector('.nup-off')!;
    this.tabButtons = [...host.querySelectorAll<HTMLButtonElement>('.nup-tab')];
    for (const b of this.tabButtons) b.onclick = () => this.select(b.dataset.tab as TabId);
    host.querySelector<HTMLButtonElement>('.nup-on')!.onclick = () => {
      const save = loadSave();
      save.settings.nu = true;
      writeSave(save);
      window.dispatchEvent(new Event('atomos:settings'));
      this.arrive();
    };
    const bests = readBests();
    this.stage = {
      w: 0, h: 0, nu: new Body(), fx: new Fx(), bests,
      save: () => writeBests(bests),
      say: (hint, score) => { this.hint.textContent = hint; this.score.textContent = score ?? ''; },
    };
    try { const t = localStorage.getItem(TAB_KEY); if (TABS.some((x) => x.id === t)) this.tab = t as TabId; } catch { /* first tab */ }
    this.wirePointer();
    new ResizeObserver(() => this.fit()).observe(this.canvas);
  }

  show(): void {
    this.root.hidden = false;
    this.open = true;
    this.fit();
    this.paintTabs();
    this.arrive();
    this.loop();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.giveBack();
  }

  /** Nu flies in from the logo; the game starts when it's here. */
  private arrive(): void {
    const on = nuEnabled();
    this.off.hidden = on;
    this.stage.nu.hidden = true;
    this.have = false;
    if (!on) { this.stage.say('', ''); return; }
    const r = this.canvas.getBoundingClientRect();
    const to = { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
    void nuBorrow(to).then((got) => {
      this.borrowed = got;
      if (!this.open) { this.giveBack(); return; }
      const now = this.canvas.getBoundingClientRect();
      this.stage.nu.at({ x: to.x - now.left, y: to.y - now.top });
      this.stage.nu.hidden = false;
      this.have = true;
      this.toys[this.tab].enter(this.stage);
    });
  }

  private giveBack(): void {
    if (!this.borrowed) return;
    this.borrowed = false;
    this.have = false;
    const r = this.canvas.getBoundingClientRect();
    const nu = this.stage.nu;
    nuGiveBack({ x: r.left + clamp(nu.x, 0, r.width), y: r.top + clamp(nu.y, 0, r.height) });
  }

  private select(id: TabId): void {
    if (id === this.tab) return;
    this.tab = id;
    try { localStorage.setItem(TAB_KEY, id); } catch { /* not kept */ }
    this.paintTabs();
    this.stage.fx.clear();
    if (this.have) this.toys[id].enter(this.stage);
  }

  private paintTabs(): void {
    for (const b of this.tabButtons) b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
  }

  private fit(): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const changed = Math.abs(r.width - this.size.w) > 1 || Math.abs(r.height - this.size.h) > 1;
    this.size = { w: r.width, h: r.height };
    this.stage.w = r.width;
    this.stage.h = r.height;
    if (changed && this.have) this.toys[this.tab].resize?.(this.stage);
  }

  private wirePointer(): void {
    const c = this.canvas;
    const at = (e: PointerEvent): Pt => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let down = false;
    c.addEventListener('pointerdown', (e) => {
      if (!this.have) return;
      down = true;
      c.setPointerCapture(e.pointerId);
      this.toys[this.tab].down?.(this.stage, at(e));
    });
    c.addEventListener('pointermove', (e) => { if (down && this.have) this.toys[this.tab].move?.(this.stage, at(e)); });
    const end = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      if (this.have) this.toys[this.tab].up?.(this.stage, at(e));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  private loop(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.open) return;
      const dt = Math.min(40, now - this.last);
      this.last = now;
      const s = this.stage, ctx = this.ctx;
      ctx.clearRect(0, 0, s.w, s.h);
      if (this.have) {
        const toy = this.toys[this.tab];
        toy.step(s, dt, now);
        toy.draw(s, ctx, now);
      }
      s.fx.draw(ctx, now, dt);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
