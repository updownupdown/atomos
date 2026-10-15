// Nu's park: a place to play with Nu, from the Nu button in Home's bar. Everything happens in
// one round arena drawn like the logo: a ring of two arcs with two electrons slowly going round.
//
// The park opens on Nu's home: stroke Nu and it warms up and purrs; tap it and it hops; flick
// one of its toys (a photon, a hoop, a pair of nucleons) and it fetches it back to you. Left
// alone, it brings you a toy. The round button under the arena opens the games, laid out like
// the logo's nucleus round Nu's home in the middle, and Nu circles the one it fancies today:
//   Sling   pull Nu back and let go; it swings round nuclei on gravity into the green ring.
//   Course  lead Nu up a winding channel past orbiting electrons, against the clock.
//   Echo    Nu flies a tune between five atoms; play it back, one note longer each round.
//   Orbit   Nu runs round a ring; tap to turn it, catch photons, dodge the red antiparticles.
//   Shells  Nu hides under a shell, the shells shuffle; find it.
//   Herd    Nu chases electrons into the nucleus until the atom is whole.
//   Trace   draw a path and Nu rides it, lighting the stars it passes.
//   Tag     Nu runs from your finger; tag it as often as you can before the ring runs out.
// Most games are learnt by trying, so they carry no words: just the score over the arena.
// When the park opens, the guide Nu (src/ui/nu.ts) flies in from the logo and the park takes it
// over; leaving, it hands Nu back where it is and Nu flies home. It never jumps. Bests are kept
// on the device under PARK_KEY.

import { buzz, captureSound, chimeSound, completeSound, missSound, tickSound } from '../audio';
import { loadSave, writeSave } from '../core/save';
import { nuBorrow, nuEnabled, nuGiveBack, reducedMotion } from '../ui/nu';
import { eatTreat, giveToy, periodsDone, toysSeen, treats, wake, warmth, warmUp } from './bond';
import { F, GAMES, S, ST, nuPick, type GameId } from './games';
import './park.css';

type Pt = { x: number; y: number };
type Mover = Pt & { vx: number; vy: number };
type PlaceId = 'home' | GameId;

const PARK_KEY = 'atomos.nu-park';
const ROSE = '#ff5aa8';
const CYAN = '#6fd0e6';
const GREEN = '#4ff29a';
const RED = '#e0503a';
const WHITE = '#e4e8ea';
const K300 = '#a3abaf';
const K500 = '#50575b';
const K800 = '#2a2e32';
const K900 = '#1f2225';
const K975 = '#121416';
/** Orbital colours (s, p, d, f) and the accent: Echo's five atoms. */
const NOTE_COLOURS = ['#5f8ae0', '#2ea57a', '#c07f1e', '#a865d6', CYAN];

interface Bests { [k: string]: unknown; course: Record<string, number> }

function readBests(): Bests {
  const b: Bests = { course: {} };
  try {
    const v = JSON.parse(localStorage.getItem(PARK_KEY) ?? 'null');
    if (v && typeof v === 'object') {
      for (const [k, n] of Object.entries(v)) if (Number.isFinite(n)) b[k] = n;
      if (v.course && typeof v.course === 'object') b.course = v.course;
    }
  } catch { /* nothing kept */ }
  return b;
}

function writeBests(b: Bests): void {
  try { localStorage.setItem(PARK_KEY, JSON.stringify(b)); } catch { /* not kept */ }
}

/** A small seeded random, so each Sling layout and Course is the same every time. */
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
const TAU = Math.PI * 2;

function dot(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function ring(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string, w = 2, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

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
    ctx.arc(this.x, this.y, this.r * this.scale, 0, TAU);
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
      const a = (i / n) * TAU + Math.random() * 0.5;
      const s = speed * (0.6 + Math.random() * 0.6);
      this.sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.03, t0: now, ms: 700 + Math.random() * 400, c });
    }
  }

  clear(): void { this.rings = []; this.sparks = []; }

  draw(ctx: CanvasRenderingContext2D, now: number, dt: number): void {
    this.rings = this.rings.filter((r) => now - r.t0 < r.ms);
    this.sparks = this.sparks.filter((s) => now - s.t0 < s.ms);
    for (const r of this.rings) {
      const t = (now - r.t0) / r.ms;
      ring(ctx, r, r.r0 + (r.r1 - r.r0) * (1 - (1 - t) * (1 - t)), r.c, 2, 0.55 * (1 - t));
    }
    for (const s of this.sparks) {
      const t = (now - s.t0) / s.ms;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.985;
      s.vy *= 0.985;
      dot(ctx, s, 2.4 * (1 - t * 0.5), s.c, 1 - t);
    }
  }
}

// ---- The arena -------------------------------------------------------------------------------

interface Stage {
  /** The arena: its middle and radius, in canvas px. */
  c: Pt;
  R: number;
  nu: Body;
  fx: Fx;
  bests: Bests;
  save(): void;
  /** The score over the arena (and the best beside it); null hides it. */
  score(n: number | string | null, best?: number | string | null): void;
  /** The rim's own countdown, 0..1 left, or null for the plain rim (Tag's timer). */
  rim: number | null;
}

function best(s: Stage, k: string): number { const v = s.bests[k]; return typeof v === 'number' ? v : 0; }
function setBest(s: Stage, k: string, n: number): void { if (n > best(s, k)) { s.bests[k] = n; s.save(); } }

/** Keeps a moving thing inside the arena, bouncing it off the rim. True if it bounced. */
function bounceIn(s: Stage, o: Mover, r: number, k = 0.8): boolean {
  const dx = o.x - s.c.x, dy = o.y - s.c.y, d = Math.hypot(dx, dy), lim = s.R - r;
  if (d <= lim || d === 0) return false;
  const nx = dx / d, ny = dy / d;
  o.x = s.c.x + nx * lim;
  o.y = s.c.y + ny * lim;
  const vn = o.vx * nx + o.vy * ny;
  if (vn > 0) { o.vx -= (1 + k) * vn * nx; o.vy -= (1 + k) * vn * ny; }
  return true;
}

/** A point pulled inside the arena. */
function inside(s: Stage, p: Pt, r: number): Pt {
  const dx = p.x - s.c.x, dy = p.y - s.c.y, d = Math.hypot(dx, dy), lim = s.R - r;
  return d <= lim ? p : { x: s.c.x + (dx / d) * lim, y: s.c.y + (dy / d) * lim };
}

interface Toy {
  /** Nu is here (or the game was just picked): set up. */
  enter(s: Stage): void;
  step(s: Stage, dt: number, now: number): void;
  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void;
  down?(s: Stage, p: Pt): void;
  move?(s: Stage, p: Pt): void;
  up?(s: Stage, p: Pt): void;
  /** The arena changed size. */
  resize?(s: Stage): void;
}

// ---- Home: pet and fetch ---------------------------------------------------------------------

type PlayThing = Mover & { kind: 'photon' | 'hoop' | 'pair' | 'treat' | 'atom'; spin: number; period?: number };

/** How big a toy is, for catching and bouncing. */
const toyR = (t: PlayThing): number => (t.kind === 'atom' ? 12 : t.kind === 'treat' ? 6 : 10);

/** The colour of a period's toy: the orbital colour of the newest block that period fills
 *  (s in period 1, p from 2, d from 4, f from 6). */
const periodColour = (p: number): string => NOTE_COLOURS[p >= 6 ? 3 : p >= 4 ? 2 : p >= 2 ? 1 : 0];

/** Nu's home. Stroke it and it warms up and leans into your finger; full, it purrs, three
 *  little electrons going round it. Tap it and it hops. Flick a toy and Nu fetches it back to
 *  where you let go. Left alone a while, it brings you a toy of its own accord. */
class Home implements Toy {
  private happy = 0;
  private finger: Pt | null = null;
  private downAt = 0;
  private downP: Pt | null = null;
  private lastRing = 0;
  private lastBurst = -Infinity;
  private hop = 0;
  private toys: PlayThing[] = [];
  private held: PlayThing | null = null;
  private trail: { x: number; y: number; t: number }[] = [];
  private state: 'idle' | 'chase' | 'carry' = 'idle';
  private target: PlayThing | null = null;
  private drop: Pt = { x: 0, y: 0 };
  private quiet = 0;
  /** Treats from wins still to come in, and when the last one did. */
  private treatsDue = 0;
  private treatAt = 0;
  private warm = 0;
  private spot(s: Stage): Pt { return { x: s.c.x, y: s.c.y - s.R * 0.08 }; }

  enter(s: Stage): void {
    s.nu.r = 12;
    s.score(null);
    if (!this.toys.length) {
      const at = (a: number, k: number): Pt => ({ x: s.c.x + Math.cos(a) * s.R * k, y: s.c.y + Math.sin(a) * s.R * k });
      this.toys = [
        { ...at(2.2, 0.62), vx: 0, vy: 0, kind: 'photon', spin: 0 },
        { ...at(0.9, 0.6), vx: 0, vy: 0, kind: 'hoop', spin: 0 },
        { ...at(1.57, 0.72), vx: 0, vy: 0, kind: 'pair', spin: 0.6 },
      ];
    }
    this.state = 'idle';
    this.quiet = 0;
    this.warm = warmth();
    this.treatsDue = treats();
    this.treatAt = performance.now();
    // A toy for each period finished: a tiny model of its atom. A new one appears in the middle
    // and Nu brings it to you.
    const have = new Set(this.toys.filter((t) => t.kind === 'atom').map((t) => t.period));
    const seen = toysSeen();
    for (const p of periodsDone()) {
      if (have.has(p)) continue;
      const fresh = !seen.includes(p), a = -Math.PI / 2 + (p * TAU) / 7, k = fresh ? 0.3 : 0.4 + Math.random() * 0.35;
      const t: PlayThing = { x: s.c.x + Math.cos(a) * s.R * k, y: s.c.y + Math.sin(a) * s.R * k, vx: 0, vy: 0, kind: 'atom', spin: 0, period: p };
      Object.assign(t, inside(s, t, toyR(t)));
      this.toys.push(t);
      if (fresh) {
        giveToy(p);
        s.fx.ring(t, periodColour(p), 6, 60, 1200);
        s.fx.burst(t, 12, periodColour(p), 0.12);
        chimeSound(p % 5);
        this.target = t;
        this.drop = { x: s.c.x, y: s.c.y + s.R * 0.62 };
        this.state = 'chase';
      }
    }
  }

  resize(s: Stage): void { for (const t of this.toys) Object.assign(t, inside(s, t, toyR(t))); }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    for (const t of this.toys) {
      if (t === this.held || (this.state === 'carry' && t === this.target)) continue;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      const f = Math.pow(0.9975, dt);
      t.vx *= f;
      t.vy *= f;
      t.spin += Math.hypot(t.vx, t.vy) * dt * 0.02;
      if (bounceIn(s, t, toyR(t)) && t.kind !== 'treat') tickSound(0);
    }
    this.quiet += dt;
    if (this.state === 'idle') {
      const h = this.spot(s);
      let to = { x: h.x, y: h.y + Math.sin(now / 900) * 6 };
      if (this.finger && dist(this.finger, h) < 140) to = { x: h.x + (this.finger.x - h.x) * 0.18, y: h.y + (this.finger.y - h.y) * 0.18 };
      if (this.hop > 0) {
        this.hop = Math.max(0, this.hop - dt);
        const t = 1 - this.hop / 520;
        to.y -= Math.sin(t * Math.PI) * 40;
        nu.scale = 1 + Math.sin(t * TAU) * 0.12;
      } else nu.scale = 1 + Math.sin(now / 700) * 0.03 * (1 + this.happy);
      nu.seek(to, dt, 0.6, 0.012);
      // A treat from a win drifts in from the rim, and Nu goes to eat it.
      if (this.treatsDue > 0 && !this.held && now - this.treatAt > 1400) {
        this.treatsDue--;
        this.treatAt = now;
        const a = Math.random() * TAU, t: PlayThing = { x: s.c.x + Math.cos(a) * (s.R - 8), y: s.c.y + Math.sin(a) * (s.R - 8), vx: -Math.cos(a) * 0.12, vy: -Math.sin(a) * 0.12, kind: 'treat', spin: 0 };
        this.toys.push(t);
        this.target = t;
        this.state = 'chase';
        return;
      }
      // Bored: it fetches a toy for you, and drops it by the button.
      if (this.quiet > 9000 && !this.held && !reducedMotion()) {
        this.quiet = 0;
        this.target = this.toys[Math.floor(Math.random() * this.toys.length)];
        this.drop = { x: s.c.x, y: s.c.y + s.R * 0.62 };
        this.state = 'chase';
      }
    } else if (this.state === 'chase' && this.target) {
      nu.scale = 1;
      nu.seek(this.target, dt, 0.62, 0.02);
      if (dist(nu, this.target) < nu.r + toyR(this.target)) {
        if (this.target.kind === 'treat') {
          // Eaten: Nu glows a little warmer.
          this.toys.splice(this.toys.indexOf(this.target), 1);
          s.fx.burst(this.target, 10, CYAN, 0.12);
          chimeSound(Math.floor(Math.random() * 5));
          eatTreat();
          this.warm = warmUp(0.08);
          this.hop = 520;
          this.target = null;
          this.state = 'idle';
          return;
        }
        this.state = 'carry';
        captureSound();
        s.fx.ring(this.target, WHITE, 6, 26, 450);
      }
    } else if (this.state === 'carry' && this.target) {
      nu.seek(this.drop, dt, 0.42, 0.01);
      this.target.x = nu.x + 13;
      this.target.y = nu.y - 7;
      if (dist(nu, this.drop) < 6) {
        this.target.x = this.drop.x;
        this.target.y = this.drop.y + 18;
        this.target.vx = this.target.vy = 0;
        this.state = 'idle';
        this.target = null;
        this.quiet = 0;
        s.fx.burst(nu, 6, ROSE, 0.08);
        tickSound(3);
        this.warm = warmUp(0.03);
      }
    }
    this.happy = clamp(this.happy - dt * 0.00003, 0, 1);
    nu.glow = 1 + this.warm * 0.8 + this.happy * 1.4;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const t of this.toys) {
      if (t.kind === 'photon') {
        ctx.save();
        ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
        ctx.shadowBlur = 12;
        dot(ctx, t, 6, CYAN);
        ctx.restore();
      } else if (t.kind === 'hoop') {
        ring(ctx, t, 8, WHITE, 3);
      } else if (t.kind === 'treat') {
        ctx.save();
        ctx.shadowColor = 'rgba(111, 208, 230, 0.9)';
        ctx.shadowBlur = 14;
        dot(ctx, t, 4, WHITE);
        ctx.restore();
        ring(ctx, t, 7 + Math.sin(now / 180) * 1.5, CYAN, 1.6, 0.6);
      } else if (t.kind === 'atom') {
        // A period's atom: its nucleus in the period's colour, and as many electrons going round
        // as the period has shells.
        const c = periodColour(t.period ?? 1), n = t.period ?? 1, r = toyR(t) - 2;
        ring(ctx, t, r, c, 2, 0.55);
        dot(ctx, t, 4.2, c);
        for (let i = 0; i < n; i++) {
          const a = t.spin + now / 1100 + (i * TAU) / n;
          dot(ctx, { x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r }, 1.9, WHITE);
        }
      } else {
        const ox = Math.cos(t.spin) * 5, oy = Math.sin(t.spin) * 5;
        dot(ctx, { x: t.x + ox, y: t.y + oy }, 5.5, WHITE);
        ring(ctx, { x: t.x - ox, y: t.y - oy }, 4.4, WHITE, 2.2);
      }
    }
    if (this.happy > 0.66 && this.state === 'idle') {
      // Purring: three small electrons on a tilted ring round Nu.
      const k = clamp((this.happy - 0.66) / 0.34, 0, 1), nu = s.nu, tilt = -0.3;
      ctx.save();
      ctx.globalAlpha = 0.35 * k;
      ctx.strokeStyle = K500;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(nu.x, nu.y, 40, 15, tilt, 0, TAU);
      ctx.stroke();
      ctx.restore();
      for (let i = 0; i < 3; i++) {
        const a = now / 700 + (i * TAU) / 3, ex = Math.cos(a) * 40, ey = Math.sin(a) * 15;
        dot(ctx, { x: nu.x + ex * Math.cos(tilt) - ey * Math.sin(tilt), y: nu.y + ex * Math.sin(tilt) + ey * Math.cos(tilt) }, 3.2, CYAN, k);
      }
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    this.quiet = 0;
    this.finger = p;
    this.downAt = performance.now();
    this.downP = p;
    const t = this.toys.find((q) => q.kind !== 'treat' && dist(p, q) < Math.max(30, toyR(q) + 14) && !(this.state === 'carry' && q === this.target));
    if (t) {
      this.held = t;
      t.vx = t.vy = 0;
      if (t === this.target) { this.state = 'idle'; this.target = null; }
      this.trail = [{ ...p, t: performance.now() }];
    }
    void s;
  }

  move(s: Stage, p: Pt): void {
    this.quiet = 0;
    const last = this.finger;
    this.finger = p;
    if (this.held) {
      Object.assign(this.held, inside(s, p, toyR(this.held)));
      this.trail.unshift({ ...p, t: performance.now() });
      this.trail.length = Math.min(this.trail.length, 8);
      return;
    }
    if (!last || !this.downP || this.state !== 'idle' || dist(p, s.nu) > s.nu.r + 46) return;
    const was = this.happy;
    this.happy = clamp(this.happy + dist(p, last) * 0.0016, 0, 1);
    const now = performance.now();
    if (now - this.lastRing > 160) { this.lastRing = now; s.fx.ring(s.nu, ROSE, s.nu.r, s.nu.r + 30, 800); }
    if (was < 1 && this.happy >= 1 && now - this.lastBurst > 8000) { this.lastBurst = now; s.fx.burst(s.nu, 12); completeSound(); buzz(12); this.warm = warmUp(0.12); }
  }

  up(s: Stage, p: Pt): void {
    if (this.held) {
      const t = this.held, now = performance.now();
      this.held = null;
      const old = this.trail.find((q) => now - q.t > 40) ?? this.trail[this.trail.length - 1];
      const dt = Math.max(16, now - old.t);
      let vx = (p.x - old.x) / dt, vy = (p.y - old.y) / dt;
      const sp = Math.hypot(vx, vy);
      if (sp > 2.2) { vx *= 2.2 / sp; vy *= 2.2 / sp; }
      t.vx = vx;
      t.vy = vy;
      if (sp > 0.15) { this.target = t; this.drop = inside(s, p, 24); this.state = 'chase'; }
    } else {
      const quick = performance.now() - this.downAt < 260 && this.downP && dist(p, this.downP) < 12;
      if (quick && this.state === 'idle' && dist(p, s.nu) < s.nu.r + 30) {
        this.hop = 520;
        this.happy = clamp(this.happy + 0.06, 0, 1);
        s.fx.burst({ x: s.nu.x, y: s.nu.y + s.nu.r }, 6, ROSE, 0.08);
        tickSound(2);
      }
    }
    this.finger = null;
    this.downP = null;
  }
}

// ---- Sling -----------------------------------------------------------------------------------

/** Pull back from Nu and let go: it swings round the nuclei on their gravity. Reach the green
 *  ring for the next layout; a nucleus knocks it back to its pad. */
class Sling implements Toy {
  private level = 1;
  private nuclei: { x: number; y: number; m: number; r: number }[] = [];
  private goal = { x: 0, y: 0, r: 22 };
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
    const { c, R } = s;
    this.pad = { x: c.x + (rnd() - 0.5) * R * 0.5, y: c.y + R * 0.72 };
    this.goal = { x: c.x + (rnd() - 0.5) * R * 0.9, y: c.y - R * (0.5 + rnd() * 0.15), r: Math.max(16, 26 - this.level) };
    const n = Math.min(3, 1 + Math.floor(this.level / 3));
    this.nuclei = [];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const a = rnd() * TAU, k = rnd() * 0.45;
        const q = { x: c.x + Math.cos(a) * R * k, y: c.y + Math.sin(a) * R * k * 0.8, m: 9 + rnd() * 10, r: 0 };
        q.r = 7 + q.m * 0.6;
        if (this.nuclei.every((o) => dist(o, q) > 80) && dist(q, this.goal) > 64 && dist(q, this.pad) > 76) { this.nuclei.push(q); break; }
      }
    }
    s.score(this.level, best(s, 'sling') || null);
  }

  private accel(x: number, y: number): Pt {
    let ax = 0, ay = 0;
    for (const q of this.nuclei) {
      const dx = q.x - x, dy = q.y - y, d2 = dx * dx + dy * dy + 400, d = Math.sqrt(d2);
      const a = (q.m * 0.012) / d2;
      ax += (a * dx) / d;
      ay += (a * dy) / d;
    }
    return { x: ax, y: ay };
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
      const len = Math.hypot(off.x, off.y), k = len > 30 ? 30 / len : 1;
      nu.seek({ x: this.pad.x + off.x * k, y: this.pad.y + off.y * k }, dt, 0.8, 0.03);
      return;
    }
    // Flying: a few small steps a frame, so a close pass round a nucleus stays smooth.
    const steps = Math.ceil(dt / 4), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.accel(nu.x, nu.y);
      nu.vx += a.x * h;
      nu.vy += a.y * h;
      const sp = Math.hypot(nu.vx, nu.vy);
      if (sp > 1.1) { nu.vx *= 1.1 / sp; nu.vy *= 1.1 / sp; }
      nu.x += nu.vx * h;
      nu.y += nu.vy * h;
      bounceIn(s, nu, nu.r, 0.7);
      for (const q of this.nuclei) {
        if (dist(nu, q) >= q.r + nu.r) continue;
        const d = dist(nu, q) || 1;
        nu.x = q.x + ((nu.x - q.x) / d) * (q.r + nu.r);
        nu.y = q.y + ((nu.y - q.y) / d) * (q.r + nu.r);
        nu.vx *= -0.3;
        nu.vy *= -0.3;
        s.fx.ring(q, RED, q.r, q.r + 18, 500);
        missSound();
        this.state = 'back';
        return;
      }
      if (dist(nu, this.goal) < this.goal.r - 2) {
        s.fx.burst(this.goal, 14, GREEN, 0.14);
        s.fx.ring(this.goal, GREEN, this.goal.r, this.goal.r + 34, 800);
        completeSound();
        buzz(14);
        setBest(s, 'sling', this.level);
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
    ring(ctx, this.goal, this.goal.r, GREEN, 3, 0.9);
    ring(ctx, this.pad, 15, K500, 2, 0.6);
    for (const q of this.nuclei) {
      for (const k of [2.2, 3.4]) ring(ctx, q, q.r * k, K500, 2, 0.2);
      dot(ctx, q, q.r, K300);
    }
    // Aiming: dots where Nu would go for the first second.
    if (this.state === 'aim' && this.pull) {
      const v = this.launch();
      let x = s.nu.x, y = s.nu.y, vx = v.x, vy = v.y;
      for (let i = 1; i <= 60; i++) {
        const a = this.accel(x, y);
        vx += a.x * 16;
        vy += a.y * 16;
        x += vx * 16;
        y += vy * 16;
        if (i % 5 === 0) dot(ctx, { x, y }, 2.6, ROSE, 0.6 * (1 - i / 64));
      }
    }
    s.nu.draw(ctx, now);
  }

  private launch(): Pt {
    if (!this.pull) return { x: 0, y: 0 };
    const dx = this.pad.x - this.pull.x, dy = this.pad.y - this.pull.y;
    const len = Math.hypot(dx, dy), k = Math.min(len, 150) / (len || 1);
    return { x: dx * k * 0.0064, y: dy * k * 0.0064 };
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

// ---- Course ----------------------------------------------------------------------------------

/** Lead Nu up a winding channel to the green ring without touching its walls or the electrons
 *  crossing it. A touch sends Nu back to the last gate. Each course is narrower and busier. */
class Course implements Toy {
  private level = 1;
  private path: Pt[] = [];
  private half = 26;
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
    const { c, R } = s;
    this.half = Math.max(15, 27 - this.level * 2);
    const rows = 4 + Math.min(3, this.level);
    const ctrl: Pt[] = [];
    for (let i = 0; i <= rows; i++) {
      const y = c.y + R * 0.8 - (i / rows) * R * 1.6;
      const chord = Math.sqrt(Math.max(0, R * R - (y - c.y) ** 2)) - this.half - 10;
      const side = i % 2 ? 1 : -1;
      const x = i === 0 || i === rows ? c.x : c.x + side * chord * (0.55 + rnd() * 0.3);
      ctrl.push({ x, y });
    }
    // A smooth line through the points (Catmull-Rom), sampled every few px.
    const pts: Pt[] = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const n = Math.ceil(dist(p1, p2) / 4);
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const cr = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
        pts.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) });
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
      if (this.gates.some((g) => Math.abs(g - i) < 14)) i = Math.min(n - 20, i + 16);
      this.orbits.push({ i, r: this.half * (0.55 + rnd() * 0.3), speed: (0.0016 + rnd() * 0.0014) * (rnd() < 0.5 ? -1 : 1), phase: rnd() * 6.3 });
    }
    this.gate = 0;
    this.progress = 0;
    this.state = 'back';
    this.time = 0;
    this.say(s);
  }

  private say(s: Stage): void {
    const b = s.bests.course[String(this.level)];
    s.score(`${(this.time / 1000).toFixed(1)}`, b ? (b / 1000).toFixed(1) : null);
  }

  private electron(o: { i: number; r: number; speed: number; phase: number }, now: number): Pt {
    const q = this.path[o.i], a = o.phase + now * o.speed;
    return { x: q.x + Math.cos(a) * o.r, y: q.y + Math.sin(a) * o.r };
  }

  /** The nearest point of the channel's middle to `p`, looking near where Nu has got to. */
  private nearest(p: Pt): { i: number; d: number } {
    let b = { i: this.progress, d: Infinity };
    const lo = Math.max(0, this.progress - 25), hi = Math.min(this.path.length - 1, this.progress + 25);
    for (let i = lo; i <= hi; i++) {
      const d = dist(p, this.path[i]);
      if (d < b.d) b = { i, d };
    }
    return b;
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
      const b = s.bests.course[String(this.level)];
      if (!b || this.time < b) { s.bests.course[String(this.level)] = Math.round(this.time); s.save(); }
      this.say(s);
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
    const flash = clamp(1 - (now - this.hitAt) / 400, 0, 1);
    if (flash > 0) { ctx.strokeStyle = RED; ctx.globalAlpha = flash * 0.6; ctx.lineWidth = this.half * 2 + 6; line(); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = K900;
    ctx.lineWidth = this.half * 2;
    line();
    ctx.stroke();
    ctx.restore();
    for (let g = 1; g < this.gates.length; g++) dot(ctx, p[this.gates[g]], 4, g <= this.gate ? CYAN : K500, 0.7);
    ring(ctx, p[p.length - 1], Math.min(14, this.half - 4), GREEN, 3);
    for (const o of this.orbits) {
      ring(ctx, p[o.i], o.r, K500, 2, 0.22);
      dot(ctx, p[o.i], 3, K500, 0.6);
      dot(ctx, this.electron(o, now), 4, CYAN);
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'done') { this.level++; this.build(s); return; }
    if (this.state === 'run' || this.state === 'ready') this.finger = p;
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

// ---- Echo ------------------------------------------------------------------------------------

/** Five atoms in a ring, like the logo's nucleus. Nu flies a tune between them; play it back.
 *  Each round the tune is a note longer. */
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
    const R = s.R * 0.56;
    this.nodes = Array.from({ length: 5 }, (_, i) => {
      const a = -Math.PI / 2 + (i * TAU) / 5;
      return { x: s.c.x + Math.cos(a) * R, y: s.c.y + Math.sin(a) * R };
    });
  }

  private next(s: Stage): void {
    let n = Math.floor(Math.random() * 5);
    if (this.tune.length && n === this.tune[this.tune.length - 1]) n = (n + 1 + Math.floor(Math.random() * 4)) % 5;
    this.tune.push(n);
    this.state = 'wait';
    this.timer = 900;
    this.at = 0;
    s.score(this.tune.length, best(s, 'echo') || null);
  }

  private light(i: number): void {
    this.lit.set(i, performance.now());
    chimeSound(i);
  }

  step(s: Stage, dt: number): void {
    const nu = s.nu;
    if (this.flyTo) nu.seek(this.flyTo, dt, 0.7, 0.02);
    else nu.seek(s.c, dt, 0.4, 0.01);
    if (this.state === 'wait') {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'show'; this.at = 0; this.flyTo = this.nodes[this.tune[0]]; }
    } else if (this.state === 'show') {
      if (this.flyTo && dist(nu, this.flyTo) < 5) {
        this.light(this.tune[this.at]);
        this.at++;
        if (this.at >= this.tune.length) { this.state = 'listen'; this.at = 0; this.flyTo = null; }
        else this.flyTo = this.nodes[this.tune[this.at]];
      }
    } else if (this.state === 'wrong') {
      this.timer -= dt;
      if (this.timer <= 0) { this.tune = []; this.next(s); }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // Your turn: the five atoms breathe a little, waiting.
    const wait = this.state === 'listen' ? 0.08 + 0.06 * Math.sin(now / 400) : 0;
    this.nodes.forEach((p, i) => {
      const t = this.lit.get(i);
      const on = t !== undefined ? clamp(1 - (now - t) / 520, 0, 1) : 0;
      const c = NOTE_COLOURS[i];
      ctx.save();
      ctx.shadowColor = c;
      ctx.shadowBlur = 24 * on;
      dot(ctx, p, 22 + on * 4, c, 0.28 + wait + 0.64 * on);
      ctx.restore();
      ring(ctx, p, 31, c, 2, 0.45);
    });
    const shake = this.state === 'wrong' ? Math.sin((now - this.wrongAt) / 25) * 3 * clamp(1 - (now - this.wrongAt) / 600, 0, 1) : 0;
    s.nu.x += shake;
    s.nu.draw(ctx, now);
    s.nu.x -= shake;
  }

  down(s: Stage, p: Pt): void {
    if (this.state !== 'listen') return;
    const i = this.nodes.findIndex((q) => dist(p, q) < 36);
    if (i < 0) return;
    this.flyTo = this.nodes[i];
    if (i !== this.tune[this.at]) {
      this.lit.set(i, performance.now());
      missSound();
      this.state = 'wrong';
      this.wrongAt = performance.now();
      this.timer = 1600;
      this.flyTo = null;
      return;
    }
    this.light(i);
    this.at++;
    if (this.at >= this.tune.length) {
      setBest(s, 'echo', this.tune.length);
      s.fx.burst(this.nodes[i], 10, NOTE_COLOURS[i], 0.12);
      this.state = 'wait';
      this.timer = 1e9;
      window.setTimeout(() => { if (this.state === 'wait') this.next(s); }, 650);
    }
  }
}

// ---- Orbit -----------------------------------------------------------------------------------

/** Nu runs round a ring like an electron. Tap to turn it round. Catch the photons that appear
 *  on the ring; an antiparticle (red) coming the other way ends the run. Faster as it goes. */
class Orbit implements Toy {
  private a = -Math.PI / 2;
  private dir = 1;
  private speed = 0.0012;
  private photons: number[] = [];
  private anti: { a: number; dir: number; born: number }[] = [];
  private count = 0;
  private state: 'run' | 'over' = 'run';
  private overAt = 0;
  private spawn = 0;
  private rad(s: Stage): number { return s.R * 0.66; }
  private pos(s: Stage, a: number): Pt { const r = this.rad(s); return { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r }; }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.dir = 1;
    this.speed = 0.0011;
    this.photons = [this.a + 1.6, this.a + 3.2];
    this.anti = [];
    this.count = 0;
    this.spawn = 2600;
    this.state = 'run';
    s.score(0, best(s, 'orbit') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'over') { nu.seek(s.c, dt, 0.4, 0.01); return; }
    this.a += this.dir * this.speed * dt;
    const at = this.pos(s, this.a);
    // Joins the ring smoothly, then rides it.
    if (dist(nu, at) > 6) nu.seek(at, dt, 0.7, 0.03); else { nu.x = at.x; nu.y = at.y; }
    const near = (b: number) => { const d = Math.abs(((this.a - b) % TAU + TAU + Math.PI) % TAU - Math.PI); return d * this.rad(s) < nu.r + 7; };
    for (let i = this.photons.length - 1; i >= 0; i--) {
      if (!near(this.photons[i])) continue;
      this.photons.splice(i, 1);
      this.count++;
      this.speed = Math.min(0.0028, this.speed + 0.00005);
      s.fx.burst(at, 6, CYAN, 0.1);
      tickSound(this.count % 5);
      s.score(this.count, best(s, 'orbit') || null);
      // A new photon somewhere ahead, not too close.
      this.photons.push(this.a + this.dir * (1.2 + Math.random() * 3.5));
    }
    this.spawn -= dt;
    if (this.spawn <= 0 && this.anti.length < 1 + Math.floor(this.count / 8)) {
      this.anti.push({ a: this.a + Math.PI, dir: Math.random() < 0.5 ? 1 : -1, born: now });
      this.spawn = 4000 + Math.random() * 3000;
    }
    for (const q of this.anti) {
      q.a += q.dir * this.speed * 0.55 * dt;
      // Harmless while it fades in.
      if (now - q.born > 700 && near(q.a)) {
        this.state = 'over';
        this.overAt = now;
        setBest(s, 'orbit', this.count);
        s.fx.ring(at, RED, 8, 40, 700);
        missSound();
        s.score(this.count, best(s, 'orbit') || null);
        return;
      }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ring(ctx, s.c, this.rad(s), K500, 3, 0.55);
    dot(ctx, s.c, 10, K300, 0.5);
    for (const b of this.photons) {
      ctx.save();
      ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
      ctx.shadowBlur = 10;
      dot(ctx, this.pos(s, b), 5, CYAN);
      ctx.restore();
    }
    for (const q of this.anti) dot(ctx, this.pos(s, q.a), 6, RED, clamp((now - q.born) / 700, 0.2, 1));
    if (this.state === 'over') ring(ctx, s.c, 22 + Math.sin((now - this.overAt) / 300) * 2, WHITE, 2, 0.5);
    s.nu.draw(ctx, now);
  }

  down(s: Stage): void {
    if (this.state === 'over') { if (performance.now() - this.overAt > 600) this.reset(s); return; }
    this.dir *= -1;
    tickSound(1);
  }
}

// ---- Shells ----------------------------------------------------------------------------------

/** Three shells. Nu hides under one and the shells shuffle; tap the one it is under. Each find
 *  in a row shuffles a little longer and faster. */
class Shells implements Toy {
  private spots: Pt[] = [];
  /** Which spot each shell is at. */
  private at = [0, 1, 2];
  private under = 0;
  private state: 'hide' | 'shuffle' | 'pick' | 'show' = 'hide';
  private swap: { a: number; b: number; t0: number; ms: number } | null = null;
  private left = 0;
  private streak = 0;
  private timer = 0;
  private open = new Set<number>();
  private pos: Pt[] = [];

  enter(s: Stage): void {
    s.nu.r = 9;
    this.place(s);
    this.streak = 0;
    this.round(s);
  }

  resize(s: Stage): void { this.place(s); }

  private place(s: Stage): void {
    const r = s.R * 0.42;
    this.spots = [-90, 30, 150].map((d) => ({ x: s.c.x + Math.cos((d * Math.PI) / 180) * r, y: s.c.y + Math.sin((d * Math.PI) / 180) * r }));
    this.pos = this.at.map((i) => ({ ...this.spots[i] }));
  }

  private round(s: Stage): void {
    this.under = Math.floor(Math.random() * 3);
    this.state = 'hide';
    this.open = new Set([0, 1, 2]);
    this.timer = 1100;
    s.score(this.streak, best(s, 'shells') || null);
  }

  private shellAt(i: number): Pt { return this.pos[i]; }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    // Positions: each shell at its spot, or on its arc while two swap.
    for (let i = 0; i < 3; i++) this.pos[i] = { ...this.spots[this.at[i]] };
    if (this.swap) {
      const t = clamp((now - this.swap.t0) / this.swap.ms, 0, 1), e = t * t * (3 - 2 * t);
      const A = this.spots[this.at[this.swap.a]], B = this.spots[this.at[this.swap.b]];
      const m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, half = dist(A, B) / 2, a0 = Math.atan2(A.y - m.y, A.x - m.x);
      this.pos[this.swap.a] = { x: m.x + Math.cos(a0 + Math.PI * e) * half, y: m.y + Math.sin(a0 + Math.PI * e) * half };
      this.pos[this.swap.b] = { x: m.x - Math.cos(a0 + Math.PI * e) * half, y: m.y - Math.sin(a0 + Math.PI * e) * half };
      if (t >= 1) {
        [this.at[this.swap.a], this.at[this.swap.b]] = [this.at[this.swap.b], this.at[this.swap.a]];
        this.swap = null;
        for (let i = 0; i < 3; i++) this.pos[i] = { ...this.spots[this.at[i]] };
        if (--this.left <= 0) this.state = 'pick';
      }
    }
    if (this.state === 'hide') {
      nu.seek(this.shellAt(this.under), dt, 0.55, 0.015);
      this.timer -= dt;
      if (this.timer < 300) this.open.clear();
      if (this.timer <= 0) { this.state = 'shuffle'; this.left = 4 + this.streak * 2; }
    }
    if (this.state === 'shuffle' && !this.swap) {
      const a = Math.floor(Math.random() * 3), b = (a + 1 + Math.floor(Math.random() * 2)) % 3;
      this.swap = { a, b, t0: now, ms: Math.max(240, 520 - this.streak * 40) };
    }
    if (this.state !== 'hide') { nu.x = this.pos[this.under].x; nu.y = this.pos[this.under].y; }
    if (this.state === 'show') {
      this.timer -= dt;
      if (this.timer <= 0) this.round(s);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const hiddenNu = this.state === 'shuffle' || this.state === 'pick' || (this.state === 'hide' && !this.open.has(this.under));
    if (!hiddenNu) s.nu.draw(ctx, now);
    for (let i = 0; i < 3; i++) {
      const p = this.pos[i], r = 30;
      if (this.open.has(i)) ring(ctx, p, r, K300, 3, 0.7);
      else {
        dot(ctx, p, r, K800);
        ring(ctx, p, r, K300, 3, this.state === 'pick' ? 0.75 + 0.2 * Math.sin(now / 300 + i) : 0.6);
      }
    }
    if (hiddenNu && this.state === 'hide') dot(ctx, this.pos[this.under], 3, ROSE, 0.6);
  }

  down(s: Stage, p: Pt): void {
    if (this.state !== 'pick') return;
    const i = [0, 1, 2].find((k) => dist(p, this.pos[k]) < 36);
    if (i === undefined) return;
    this.open = new Set([i, this.under]);
    this.state = 'show';
    this.timer = 1300;
    if (i === this.under) {
      this.streak++;
      setBest(s, 'shells', this.streak);
      s.fx.burst(this.pos[i], 10, ROSE, 0.12);
      completeSound();
    } else {
      this.streak = 0;
      missSound();
    }
    s.score(this.streak, best(s, 'shells') || null);
  }
}

// ---- Herd ------------------------------------------------------------------------------------

/** Electrons wander the arena and shy away from Nu. Lead Nu to herd them into the nucleus in the
 *  middle, where they settle into shells (2, then 8). All in, the atom is whole: the next one
 *  has more, livelier electrons. */
class Herd implements Toy {
  private level = 1;
  private free: Mover[] = [];
  private caught = 0;
  private finger: Pt | null = null;
  private doneAt = 0;
  private zone(s: Stage): number { return s.R * 0.2; }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.start(s);
  }

  private start(s: Stage): void {
    const n = Math.min(10, 2 + this.level);
    this.free = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = s.R * (0.45 + Math.random() * 0.4);
      this.free.push({ x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r, vx: 0, vy: 0 });
    }
    this.caught = 0;
    this.doneAt = 0;
    s.score(this.level, best(s, 'herd') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.finger) nu.seek(this.finger, dt, 0.5, 0.02);
    else nu.seek({ x: nu.x, y: nu.y }, dt, 0.2, 0.01);
    bounceIn(s, nu, nu.r, 0.4);
    const wander = 0.00004 + this.level * 0.00001;
    for (let i = this.free.length - 1; i >= 0; i--) {
      const e = this.free[i];
      // Shy of Nu, and restless.
      const dx = e.x - nu.x, dy = e.y - nu.y, d = Math.hypot(dx, dy) || 1;
      if (d < 90) { const f = (0.0016 * (90 - d)) / 90; e.vx += (dx / d) * f * dt; e.vy += (dy / d) * f * dt; }
      e.vx += (Math.random() - 0.5) * wander * dt * 4;
      e.vy += (Math.random() - 0.5) * wander * dt * 4;
      const f = Math.pow(0.996, dt);
      e.vx *= f;
      e.vy *= f;
      const sp = Math.hypot(e.vx, e.vy), top = 0.32 + this.level * 0.02;
      if (sp > top) { e.vx *= top / sp; e.vy *= top / sp; }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      bounceIn(s, e, 5, 0.9);
      if (dist(e, s.c) < this.zone(s)) {
        this.free.splice(i, 1);
        this.caught++;
        s.fx.ring(s.c, CYAN, this.zone(s) * 0.6, this.zone(s) * 1.4, 500);
        tickSound(this.caught % 5);
      }
    }
    if (!this.free.length && !this.doneAt) {
      this.doneAt = now;
      setBest(s, 'herd', this.level);
      s.fx.burst(s.c, 16, CYAN, 0.14);
      completeSound();
      buzz(14);
    }
    if (this.doneAt && now - this.doneAt > 1600) { this.level++; this.start(s); }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const z = this.zone(s);
    ring(ctx, s.c, z, K500, 2, 0.5);
    dot(ctx, s.c, 7, K300, 0.8);
    // Caught electrons settle into shells round the nucleus: 2, then up to 8.
    for (let i = 0; i < this.caught; i++) {
      const shell = i < 2 ? 0 : 1, n = shell ? Math.min(8, this.caught - 2) : Math.min(2, this.caught);
      const k = shell ? i - 2 : i, r = shell ? z * 0.82 : z * 0.45;
      const a = now / (shell ? 1800 : 1200) + (k * TAU) / n;
      dot(ctx, { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r }, 3.4, CYAN);
    }
    for (const e of this.free) dot(ctx, e, 4.5, CYAN, 0.9);
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void { this.finger = p; }
  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

// ---- Trace -----------------------------------------------------------------------------------

/** Draw a path with your finger; let go and Nu rides it. Stars it passes light up; light them
 *  all for a new sky. */
class Trace implements Toy {
  private line: Pt[] = [];
  private ride: Pt[] | null = null;
  private along = 0;
  private stars: { x: number; y: number; on: number }[] = [];
  private skies = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.sky(s);
    this.skies = 0;
    s.score(0, best(s, 'trace') || null);
  }

  resize(s: Stage): void { this.sky(s); }

  private sky(s: Stage): void {
    this.stars = [];
    for (let tries = 0; this.stars.length < 6 && tries < 200; tries++) {
      const a = Math.random() * TAU, r = s.R * (0.15 + Math.random() * 0.7);
      const p = { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r, on: 0 };
      if (this.stars.every((q) => dist(q, p) > 50)) this.stars.push(p);
    }
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (!this.ride) { if (!this.line.length) nu.seek({ x: s.c.x, y: s.c.y + Math.sin(now / 800) * 4 }, dt, 0.4, 0.01); return; }
    // Glides along the drawn path at an even speed, joining it smoothly at its start.
    const path = this.ride;
    if (this.along === 0 && dist(nu, path[0]) > 4) { nu.seek(path[0], dt, 0.6, 0.02); return; }
    this.along += dt * 0.38;
    let left = this.along, i = 1;
    for (; i < path.length; i++) { const d = dist(path[i - 1], path[i]); if (left <= d) break; left -= d; }
    if (i >= path.length) { this.ride = null; this.along = 0; return; }
    const a = path[i - 1], b = path[i], d = dist(a, b) || 1;
    const p = { x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d };
    nu.vx = (p.x - nu.x) / Math.max(1, dt);
    nu.vy = (p.y - nu.y) / Math.max(1, dt);
    nu.x = p.x;
    nu.y = p.y;
    for (const st of this.stars) {
      if (st.on || dist(st, nu) > nu.r + 9) continue;
      st.on = now;
      chimeSound(this.stars.filter((q) => q.on).length - 1);
      s.fx.ring(st, WHITE, 4, 22, 600);
    }
    if (this.stars.every((q) => q.on)) {
      this.skies++;
      setBest(s, 'trace', this.skies);
      s.score(this.skies, best(s, 'trace') || null);
      s.fx.burst(nu, 14, WHITE, 0.13);
      completeSound();
      this.sky(s);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const st of this.stars) {
      if (st.on) { ctx.save(); ctx.shadowColor = 'rgba(228, 232, 234, 0.8)'; ctx.shadowBlur = 10; dot(ctx, st, 4.5, WHITE); ctx.restore(); }
      else dot(ctx, st, 3.2, K300, 0.45 + 0.2 * Math.sin(now / 500 + st.x));
    }
    const drawn = this.ride ?? this.line;
    if (drawn.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ROSE;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(drawn[0].x, drawn[0].y);
      for (const q of drawn) ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.restore();
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.ride) return;
    this.line = [inside(s, p, 10)];
  }

  move(s: Stage, p: Pt): void {
    if (this.ride || !this.line.length) return;
    const q = inside(s, p, 10);
    if (dist(q, this.line[this.line.length - 1]) > 5) this.line.push(q);
  }

  up(): void {
    if (this.ride) return;
    if (this.line.length > 3) { this.ride = this.line; this.along = 0; }
    this.line = [];
  }
}

// ---- Tag -------------------------------------------------------------------------------------

/** Nu darts away from your finger. Tag it as many times as you can before the rim runs out;
 *  each tag makes it a little quicker. Tap when the rim is empty to play again. */
class Tag implements Toy {
  private finger: Pt | null = null;
  private count = 0;
  private left = 0;
  private state: 'ready' | 'run' | 'over' = 'ready';
  private dodge = 1;
  private immune = 0;
  private static RUN_MS = 25000;

  enter(s: Stage): void {
    s.nu.r = 11;
    this.state = 'ready';
    this.count = 0;
    s.rim = 1;
    s.score(0, best(s, 'tag') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'run') {
      this.left -= dt;
      s.rim = clamp(this.left / Tag.RUN_MS, 0, 1);
      if (this.left <= 0) {
        this.state = 'over';
        setBest(s, 'tag', this.count);
        s.score(this.count, best(s, 'tag') || null);
        completeSound();
      }
    }
    this.immune = Math.max(0, this.immune - dt);
    if (this.finger && this.state !== 'over') {
      if (this.state === 'ready') { this.state = 'run'; this.left = Tag.RUN_MS; }
      const dx = nu.x - this.finger.x, dy = nu.y - this.finger.y, d = Math.hypot(dx, dy) || 1;
      if (d < 130) {
        // Away, with a sideways dodge, so it can be cornered against the rim.
        const top = 0.3 + this.count * 0.012, f = ((130 - d) / 130) * 0.003 * dt;
        nu.vx += (dx / d) * f + (-dy / d) * f * 0.6 * this.dodge;
        nu.vy += (dy / d) * f + (dx / d) * f * 0.6 * this.dodge;
        const sp = Math.hypot(nu.vx, nu.vy);
        if (sp > top) { nu.vx *= top / sp; nu.vy *= top / sp; }
      }
      if (d < nu.r + 16 && !this.immune && this.state === 'run') {
        this.count++;
        this.immune = 600;
        this.dodge = Math.random() < 0.5 ? 1 : -1;
        s.fx.burst(nu, 8, ROSE, 0.12);
        tickSound(this.count % 5);
        buzz(8);
        s.score(this.count, best(s, 'tag') || null);
        // A hop away after a tag.
        nu.vx = (dx / d) * 0.6;
        nu.vy = (dy / d) * 0.6;
      }
    } else {
      const f = Math.pow(0.995, dt);
      nu.vx *= f;
      nu.vy *= f;
      if (this.state !== 'run') { nu.seek({ x: s.c.x, y: s.c.y + Math.sin(now / 700) * 5 }, dt, 0.3, 0.01); return; }
    }
    nu.x += nu.vx * dt;
    nu.y += nu.vy * dt;
    bounceIn(s, nu, nu.r, 0.6);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    if (this.finger && this.state === 'run') ring(ctx, this.finger, 16, WHITE, 2, 0.25);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'over') { this.enter(s); return; }
    this.finger = p;
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

// ---- The screen ------------------------------------------------------------------------------


const HOME_ICON = S(`<circle cx="12" cy="12" r="4" ${F}/><ellipse cx="12" cy="12" rx="9.5" ry="4.6" ${ST} transform="rotate(-24 12 12)"/>`);
const PICK_ICON = S(`<circle cx="12" cy="12" r="2.6" ${F}/><circle cx="12" cy="4" r="2" ${F}/><circle cx="18.9" cy="8" r="2" ${F}/><circle cx="18.9" cy="16" r="2" ${F}/><circle cx="12" cy="20" r="2" ${F}/><circle cx="5.1" cy="16" r="2" ${F}/><circle cx="5.1" cy="8" r="2" ${F}/>`);
const CLOSE_ICON = S(`<path d="M6 6l12 12M18 6L6 18" ${ST}/>`);

export class NuPark {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scoreEl: HTMLElement;
  private pickEl: HTMLElement;
  private goBtn: HTMLButtonElement;
  private off: HTMLElement;
  private toys: Record<PlaceId, Toy> = { home: new Home(), sling: new Sling(), course: new Course(), echo: new Echo(), orbit: new Orbit(), shells: new Shells(), herd: new Herd(), trace: new Trace(), tag: new Tag() };
  private place: PlaceId = 'home';
  private stage: Stage;
  private frame = 0;
  private last = 0;
  private open = false;
  /** Nu is ours: borrowed from the guide. */
  private have = false;
  private borrowed = false;
  private size = { w: 0, h: 0 };
  /** The picker is open, and the game Nu fancies today (it circles it there). */
  private picking = false;
  private fancy: GameId = 'orbit';
  private since = 0;
  private pickAt = 0;

  constructor(host: HTMLElement) {
    this.root = host;
    host.innerHTML = '<div class="nup">'
      + '<p class="nup-score" aria-live="polite"></p>'
      + '<div class="nup-field"><canvas class="nup-canvas"></canvas>'
      + `<div class="nup-pick" hidden role="menu" aria-label="Games">`
      + `<button type="button" class="nup-pick-btn is-home" data-place="home" role="menuitem" aria-label="Nu's home">${HOME_ICON}</button>`
      + GAMES.map((g) => `<button type="button" class="nup-pick-btn" data-place="${g.id}" role="menuitem">${g.icon}<span>${g.label}</span></button>`).join('')
      + '</div>'
      + '<div class="nup-off" hidden><p>Nu is switched off in Settings.</p><button type="button" class="nup-on">Turn Nu on</button></div></div>'
      + `<button type="button" class="nup-go" aria-label="Games" aria-expanded="false">${PICK_ICON}</button>`
      + '</div>';
    this.canvas = host.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.scoreEl = host.querySelector('.nup-score')!;
    this.pickEl = host.querySelector('.nup-pick')!;
    this.goBtn = host.querySelector('.nup-go')!;
    this.off = host.querySelector('.nup-off')!;
    this.goBtn.onclick = () => this.togglePick();
    for (const b of this.pickEl.querySelectorAll<HTMLButtonElement>('.nup-pick-btn')) b.onclick = () => this.go(b.dataset.place as PlaceId);
    host.querySelector<HTMLButtonElement>('.nup-on')!.onclick = () => {
      const save = loadSave();
      save.settings.nu = true;
      writeSave(save);
      window.dispatchEvent(new Event('atomos:settings'));
      this.arrive();
    };
    const bests = readBests();
    this.stage = {
      c: { x: 0, y: 0 }, R: 100, nu: new Body(), fx: new Fx(), bests, rim: null,
      save: () => writeBests(bests),
      score: (n, b) => {
        if (n === null) { this.scoreEl.innerHTML = ''; return; }
        this.scoreEl.innerHTML = `<b>${n}</b>${b !== null && b !== undefined ? `<small>best ${b}</small>` : ''}`;
      },
    };
    this.wirePointer();
    new ResizeObserver(() => this.fit()).observe(this.canvas);
  }

  /** The game open, for the header's trail; null on Nu's home. */
  get gameName(): string | null { return this.place === 'home' ? null : GAMES.find((g) => g.id === this.place)?.label ?? null; }

  show(): void {
    this.root.hidden = false;
    this.open = true;
    this.since = performance.now();
    wake();
    this.place = 'home';
    this.fit();
    this.closePick();
    this.arrive();
    this.loop();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    // Time spent playing warms Nu up, a little per minute.
    if (this.have) warmUp(Math.min(0.3, ((performance.now() - this.since) / 60_000) * 0.05));
    this.giveBack();
  }

  /** Opens straight into a game (Home's Nu section). */
  openGame(id: GameId): void { this.go(id); }

  /** Nu's home, from the header's trail. */
  goHome(): void { this.go('home'); }

  /** Back to Nu's home from a game (or the picker closes). False if already there. */
  back(): boolean {
    if (this.picking) { this.closePick(); return true; }
    if (this.place === 'home') return false;
    this.go('home');
    return true;
  }

  /** Nu flies in from the logo; play starts when it's here. */
  private arrive(): void {
    const on = nuEnabled();
    this.off.hidden = on;
    this.goBtn.hidden = !on;
    this.stage.nu.hidden = true;
    this.have = false;
    if (!on) { this.stage.score(null); return; }
    const r = this.canvas.getBoundingClientRect();
    const to = { x: r.left + this.stage.c.x, y: r.top + this.stage.c.y };
    void nuBorrow(to).then((got) => {
      this.borrowed = got;
      if (!this.open) { this.giveBack(); return; }
      const now = this.canvas.getBoundingClientRect();
      this.stage.nu.at({ x: to.x - now.left, y: to.y - now.top });
      this.stage.nu.hidden = false;
      this.have = true;
      this.toys[this.place].enter(this.stage);
    });
  }

  private giveBack(): void {
    if (!this.borrowed) return;
    this.borrowed = false;
    this.have = false;
    const r = this.canvas.getBoundingClientRect(), nu = this.stage.nu;
    nuGiveBack({ x: r.left + clamp(nu.x, 0, r.width), y: r.top + clamp(nu.y, 0, r.height) });
  }

  private go(id: PlaceId): void {
    this.closePick();
    if (id === this.place) return;
    this.place = id;
    this.stage.fx.clear();
    this.stage.rim = null;
    this.stage.nu.scale = 1;
    this.stage.nu.glow = 1;
    if (this.have) this.toys[id].enter(this.stage);
    window.dispatchEvent(new Event('atomos:nav'));
  }

  private togglePick(): void { if (this.picking) this.closePick(); else this.openPick(); }

  /** The games round Nu's home, like the logo's nucleus; Nu circles the one it fancies. */
  private openPick(): void {
    if (!this.have) return;
    this.picking = true;
    this.pickAt = performance.now();
    this.fancy = nuPick().id;
    this.layoutPick();
    this.pickEl.hidden = false;
    this.scoreEl.style.visibility = 'hidden';
    this.goBtn.innerHTML = CLOSE_ICON;
    this.goBtn.setAttribute('aria-expanded', 'true');
    for (const b of this.pickEl.querySelectorAll<HTMLElement>('.nup-pick-btn')) {
      b.classList.toggle('is-here', b.dataset.place === this.place);
      b.setAttribute('aria-label', b.dataset.place === 'home' ? "Nu's home" : `${GAMES.find((g) => g.id === b.dataset.place)!.label}${b.dataset.place === this.fancy ? ', Nu’s pick today' : ''}`);
    }
  }

  private closePick(): void {
    this.picking = false;
    this.pickEl.hidden = true;
    this.scoreEl.style.visibility = '';
    this.goBtn.innerHTML = PICK_ICON;
    this.goBtn.setAttribute('aria-expanded', 'false');
  }

  /** Where each game sits in the picker, round the middle. */
  private pickSpot(i: number): Pt {
    const a = -Math.PI / 2 + (i * TAU) / GAMES.length, r = this.stage.R * 0.62;
    return { x: this.stage.c.x + Math.cos(a) * r, y: this.stage.c.y + Math.sin(a) * r };
  }

  private layoutPick(): void {
    const { c } = this.stage;
    for (const b of this.pickEl.querySelectorAll<HTMLElement>('.nup-pick-btn')) {
      const i = GAMES.findIndex((g) => g.id === b.dataset.place);
      const p = i < 0 ? c : this.pickSpot(i);
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
    }
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
    this.stage.c = { x: r.width / 2, y: r.height / 2 };
    this.stage.R = Math.max(80, Math.min(r.width, r.height) / 2 - 16);
    if (this.picking) this.layoutPick();
    if (changed && this.have) this.toys[this.place].resize?.(this.stage);
  }

  private wirePointer(): void {
    const c = this.canvas;
    const at = (e: PointerEvent): Pt => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let down = false;
    c.addEventListener('pointerdown', (e) => {
      if (!this.have) return;
      if (this.picking) { this.closePick(); return; }
      down = true;
      c.setPointerCapture(e.pointerId);
      this.toys[this.place].down?.(this.stage, at(e));
    });
    c.addEventListener('pointermove', (e) => { if (down && this.have) this.toys[this.place].move?.(this.stage, at(e)); });
    const end = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      if (this.have) this.toys[this.place].up?.(this.stage, at(e));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  /** The arena's rim, after the logo: two arcs with an electron in each gap, slowly turning.
   *  In Tag the arcs shorten as the time runs out. */
  private drawRim(ctx: CanvasRenderingContext2D, now: number): void {
    const { c, R, rim } = this.stage, r = R + 8, turn = now / 40000, gap = 0.22;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    for (let k = 0; k < 2; k++) {
      const a0 = turn + k * Math.PI + gap / 2, span = Math.PI - gap;
      ctx.strokeStyle = K500;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, a0, a0 + span);
      ctx.stroke();
      if (rim !== null) {
        ctx.strokeStyle = CYAN;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, a0, a0 + span * rim);
        ctx.stroke();
      }
      dot(ctx, { x: c.x + Math.cos(turn + k * Math.PI) * r, y: c.y + Math.sin(turn + k * Math.PI) * r }, 4.5, WHITE);
    }
    ctx.restore();
  }

  private drawPick(ctx: CanvasRenderingContext2D, now: number): void {
    const s = this.stage, t = clamp((now - this.pickAt) / 260, 0, 1);
    dot(ctx, s.c, s.R, K975, 0.92 * t);
    ring(ctx, s.c, s.R * 0.62, K500, 2, 0.35 * t);
    // Nu goes to circle the game it fancies.
    const i = GAMES.findIndex((g) => g.id === this.fancy), p = this.pickSpot(i), a = now / 420;
    s.nu.seek({ x: p.x + Math.cos(a) * 40, y: p.y + Math.sin(a) * 40 }, 16, 0.7, 0.04);
    s.nu.draw(ctx, now);
  }

  private loop(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.open) return;
      const dt = Math.min(40, now - this.last);
      this.last = now;
      const s = this.stage, ctx = this.ctx;
      ctx.clearRect(0, 0, this.size.w, this.size.h);
      ctx.save();
      dot(ctx, s.c, s.R, K975, 0.55);
      this.drawRim(ctx, now);
      ctx.beginPath();
      ctx.arc(s.c.x, s.c.y, s.R, 0, TAU);
      ctx.clip();
      if (this.have) {
        const toy = this.toys[this.place];
        if (!this.picking) toy.step(s, dt, now);
        toy.draw(s, ctx, now);
        if (this.picking) this.drawPick(ctx, now);
      }
      s.fx.draw(ctx, now, dt);
      ctx.restore();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
