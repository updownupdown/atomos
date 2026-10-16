// The park's kit (park.ts and arcade.ts): Nu as the park draws it, the soft effects, the arena
// (a rounded rectangle, or the round court in its middle) and the helpers every game shares.

import { buzz, captureSound, chimeSound, completeSound, missSound, tickSound } from '../audio';

export { buzz, captureSound, chimeSound, completeSound, missSound, tickSound };

export type Pt = { x: number; y: number };
export type Mover = Pt & { vx: number; vy: number };

const PARK_KEY = 'atomos.nu-park';
export const ROSE = '#ff5aa8';
export const CYAN = '#6fd0e6';
export const GREEN = '#4ff29a';
export const RED = '#e0503a';
export const WHITE = '#e4e8ea';
export const K300 = '#a3abaf';
export const K500 = '#50575b';
export const K800 = '#2a2e32';
export const K900 = '#1f2225';
export const K975 = '#121416';
/** Orbital colours (s, p, d, f) and the accent: Echo's five atoms. */
export const NOTE_COLOURS = ['#5f8ae0', '#2ea57a', '#c07f1e', '#a865d6', CYAN];

export interface Bests { [k: string]: unknown; course: Record<string, number> }

export function readBests(): Bests {
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

export function writeBests(b: Bests): void {
  try { localStorage.setItem(PARK_KEY, JSON.stringify(b)); } catch { /* not kept */ }
}

/** A small seeded random, so each Sling layout and Course is the same every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const TAU = Math.PI * 2;

export function dot(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(0, r), 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function ring(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string, w = 2, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(0, r), 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** A dashed ring, for telling one ring from another (Orbit's inner lane). */
export function dashed(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string, alpha = 1): void {
  // Whole dashes round the circle, so the join doesn't show.
  const n = Math.max(6, Math.round((TAU * r) / 14));
  ctx.save();
  ctx.setLineDash([(TAU * r) / n * 0.55, (TAU * r) / n * 0.45]);
  ctx.lineCap = 'round';
  ring(ctx, p, r, c, 3, alpha);
  ctx.restore();
}

// ---- Nu, as the park draws it ----------------------------------------------------------------

export class Body {
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
export class Fx {
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
      // The frame's clock can be a touch behind when the ring was made.
      const t = clamp((now - r.t0) / r.ms, 0, 1);
      ring(ctx, r, r.r0 + (r.r1 - r.r0) * (1 - (1 - t) * (1 - t)), r.c, 2, 0.55 * (1 - t));
    }
    for (const s of this.sparks) {
      const t = clamp((now - s.t0) / s.ms, 0, 1);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.985;
      s.vy *= 0.985;
      dot(ctx, s, 2.4 * (1 - t * 0.5), s.c, 1 - t);
    }
  }
}

// ---- The arena -------------------------------------------------------------------------------

export interface Stage {
  /** The arena, a rounded rectangle filling the screen: its middle, half its width and height,
   *  and its corner radius, in canvas px. */
  c: Pt;
  /** The arena's own middle. The court's middle (`c`) is the same, unless the game wants room
   *  under the court for its controls (`pad`): then the court sits at the top. */
  m: Pt;
  hw: number;
  hh: number;
  rr: number;
  /** The round court: the biggest circle in the arena. Games set on a ring (`court`) play in it
   *  and are kept inside it; the rest use the whole arena. */
  R: number;
  court: boolean;
  /** The room left for a game's controls under the court (beside it, on a wide screen), or null. */
  pad: { x: number; y: number; w: number; h: number } | null;
  nu: Body;
  fx: Fx;
  bests: Bests;
  save(): void;
  /** The score under the arena at the left (and the best at the right); null hides it. */
  score(n: number | string | null, best?: number | string | null): void;
  /** The rim's own countdown, 0..1 left, or null for the plain rim (Tag's timer). */
  rim: number | null;
}

export function best(s: Stage, k: string): number { const v = s.bests[k]; return typeof v === 'number' ? v : 0; }
export function setBest(s: Stage, k: string, n: number): void { if (n > best(s, k)) { s.bests[k] = n; s.save(); } }

/** How far `p` is outside the arena's edge (negative inside), and the way out there. */
export function edge(s: Stage, p: Pt): { d: number; nx: number; ny: number } {
  if (s.court) {
    const dx = p.x - s.c.x, dy = p.y - s.c.y, d = Math.hypot(dx, dy) || 1;
    return { d: d - s.R, nx: dx / d, ny: dy / d };
  }
  const dx = p.x - s.m.x, dy = p.y - s.m.y;
  // A rounded rectangle, by its distance field.
  const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
  const qx = Math.abs(dx) - (s.hw - s.rr), qy = Math.abs(dy) - (s.hh - s.rr);
  if (qx > 0 && qy > 0) {
    const l = Math.hypot(qx, qy);
    return { d: l - s.rr, nx: (qx / l) * sx, ny: (qy / l) * sy };
  }
  return qx > qy ? { d: qx - s.rr, nx: sx, ny: 0 } : { d: qy - s.rr, nx: 0, ny: sy };
}

/** Keeps a moving thing inside the arena, bouncing it off the rim. True if it bounced. */
export function bounceIn(s: Stage, o: Mover, r: number, k = 0.8): boolean {
  const e = edge(s, o), out = e.d + r;
  if (out <= 0) return false;
  o.x -= e.nx * out;
  o.y -= e.ny * out;
  const vn = o.vx * e.nx + o.vy * e.ny;
  if (vn > 0) { o.vx -= (1 + k) * vn * e.nx; o.vy -= (1 + k) * vn * e.ny; }
  return true;
}

/** A point pulled inside the arena. */
export function inside(s: Stage, p: Pt, r: number): Pt {
  const e = edge(s, p), out = e.d + r;
  return out <= 0 ? p : { x: p.x - e.nx * out, y: p.y - e.ny * out };
}

/** A random point in the arena, at least `r` in from its edge. */
export function anywhere(s: Stage, r: number, rnd = Math.random): Pt {
  for (let i = 0; i < 40; i++) {
    const p = { x: s.m.x + (rnd() * 2 - 1) * s.hw, y: s.m.y + (rnd() * 2 - 1) * s.hh };
    if (edge(s, p).d < -r) return p;
  }
  return { ...s.c };
}

/** The arena's outline, `out` px outside its edge. */
export function arenaPath(ctx: CanvasRenderingContext2D, s: Stage, out = 0): void {
  ctx.beginPath();
  if (s.court) { ctx.arc(s.c.x, s.c.y, s.R + out, 0, TAU); return; }
  ctx.roundRect(s.m.x - s.hw - out, s.m.y - s.hh - out, 2 * (s.hw + out), 2 * (s.hh + out), s.rr + out);
}

/** A point on the rounded rectangle `out` px outside the arena, `u` (0..1) of the way round it
 *  clockwise from the top middle. */
export function rimPoint(s: Stage, u: number, out: number): Pt {
  const w = s.hw + out, h = s.hh + out, r = s.rr + out, sx = w - r, sy = h - r;
  const parts = [sx, (Math.PI / 2) * r, 2 * sy, (Math.PI / 2) * r, 2 * sx, (Math.PI / 2) * r, 2 * sy, (Math.PI / 2) * r, sx];
  let l = (((u % 1) + 1) % 1) * parts.reduce((a, b) => a + b, 0);
  const corner = (cx: number, cy: number, a0: number, t: number): Pt => ({ x: s.m.x + cx + Math.cos(a0 + t * Math.PI / 2) * r, y: s.m.y + cy + Math.sin(a0 + t * Math.PI / 2) * r });
  for (let i = 0; i < parts.length; i++) {
    if (l > parts[i] && i < parts.length - 1) { l -= parts[i]; continue; }
    const t = parts[i] ? l / parts[i] : 0;
    switch (i) {
      case 0: return { x: s.m.x + t * sx, y: s.m.y - h };
      case 1: return corner(sx, -sy, -Math.PI / 2, t);
      case 2: return { x: s.m.x + w, y: s.m.y - sy + t * 2 * sy };
      case 3: return corner(sx, sy, 0, t);
      case 4: return { x: s.m.x + sx - t * 2 * sx, y: s.m.y + h };
      case 5: return corner(-sx, sy, Math.PI / 2, t);
      case 6: return { x: s.m.x - w, y: s.m.y + sy - t * 2 * sy };
      case 7: return corner(-sx, -sy, Math.PI, t);
      default: return { x: s.m.x - sx + t * sx, y: s.m.y - h };
    }
  }
  return { x: s.m.x, y: s.m.y - h };
}

export interface Toy {
  /** Played in the round court rather than the whole arena. */
  court?: boolean;
  /** Wants room under the court for its own controls (Stage.pad). */
  controls?: boolean;
  /** Nu is here (or the game was just picked): set up. */
  enter(s: Stage): void;
  step(s: Stage, dt: number, now: number): void;
  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void;
  /** Draws its controls in Stage.pad, outside the court (`controls` games). */
  drawPad?(s: Stage, ctx: CanvasRenderingContext2D, now: number): void;
  down?(s: Stage, p: Pt): void;
  move?(s: Stage, p: Pt): void;
  up?(s: Stage, p: Pt): void;
  /** The arena changed size. */
  resize?(s: Stage): void;
}

