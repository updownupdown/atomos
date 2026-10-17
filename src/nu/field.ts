// Six more of Nu's park games (park.ts), on the same kit:
//   Grow    drag Nu about; it eats anything smaller than itself and grows. Anything bigger it
//           mustn't touch. Grown big, the view pulls back and it all starts small again.
//   Rain    Nu along the bottom, slid by the finger, catches the photons raining down and
//           dodges the red. Three red caught and it's over.
//   Sort    Nu carries atoms down one at a time; tap left or right to send each to the ring of
//           its color. Later there's a third ring in the middle, for an atom left alone.
//   Spot    a field of atoms, one slightly different; tap it before the rim runs out.
//   Stack   Nu swings an atom to and fro above a tower; tap to drop it. Off the top atom and it
//           falls. Three dropped and it's over.
//   Tilt    tilt the floor with the finger (press, then lean that way) and Nu rolls; roll over
//           photons, and around the holes. More holes as you go.

import {
  CYAN, K300, K500, K800, K975, NOTE_COLOURS, RED, TAU, WHITE,
  anywhere, best, bounceIn, buzz, captureSound, chimeSound, clamp, completeSound, dist, dot, edge, inside, rimPoint, missSound, ring, finish, setBest, tickSound, hitSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';

function glow(ctx: CanvasRenderingContext2D, p: Pt, r: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
  ctx.shadowBlur = 10;
  dot(ctx, p, r, CYAN);
  ctx.restore();
}

/** Lives left, as small dots across the top of the arena. */
function lives(s: Stage, ctx: CanvasRenderingContext2D, left: number, of = 3): void {
  for (let i = 0; i < of; i++) {
    const p = { x: s.m.x + (i - (of - 1) / 2) * 16, y: s.m.y - s.hh + 22 };
    if (i < left) dot(ctx, p, 4.5, WHITE, 0.85);
    else ring(ctx, p, 4.5, K500, 2, 0.8);
  }
}

// ---- Grow ------------------------------------------------------------------------------------

/** Nu's size when the view pulls back, and after; and how long the pulling back takes. */
const GROW_TOP = 33;
const GROW_BASE = 12;
const GROW_ZOOM_MS = 1600;
/** How many motes drift about at once. */
const GROW_MOTES = 12;

/** What a mote does: chases motes smaller than it (a fifth), wanders about (a quarter), runs
 *  from whatever chases it (half), or just drifts (the rest). */
type Way = 'chase' | 'wander' | 'flee' | 'drift';
/** Each way has its own cool colors (never near red), so you learn which is which. */
const WAY_COLOURS: Record<Way, string[]> = {
  chase: ['#a865d6', '#c48cf0'],
  wander: ['#3cc9b4', '#2ea57a'],
  flee: ['#5f8ae0', CYAN],
  drift: [K300, WHITE],
};
/** How fast each way goes at most (px/ms); a fleeing mote, while scared. */
const WAY_TOP: Record<Way, number> = { chase: 0.075, wander: 0.06, flee: 0.05, drift: 0.06 };
const FLEE_TOP = 0.13;
/** How near a chaser looks for prey, and a fleeing mote for something after it (px). */
const CHASE_SEE = 170;
const FLEE_SEE = 110;

type Mote = Mover & { r: number; c: string; in: boolean; way: Way; head: number; scared: number };

function pickWay(): Way {
  const u = Math.random();
  return u < 0.2 ? 'chase' : u < 0.45 ? 'wander' : u < 0.95 ? 'flee' : 'drift';
}

function mote(p: Pt, r: number, a: number, v: number, isIn: boolean): Mote {
  const way = pickWay(), cs = WAY_COLOURS[way];
  return { x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r, c: cs[Math.floor(Math.random() * cs.length)], in: isIn, way, head: a, scared: 0 };
}

/** Motes of every size move about. Drag Nu (from anywhere): what's smaller than Nu (cool
 *  colors) it eats and grows; what's bigger (red) ends the run. Nothing appears out of nowhere:
 *  new motes drift in from beyond the rim, and motes eat each other too, so a small one can
 *  grow red before your eyes. Purple ones slowly chase anything smaller (Nu too), teal ones
 *  wander, blue ones run from whatever chases them (Nu too), and pale ones just drift. Grown
 *  big, the view slowly pulls back: Nu and everything shrink together, and new motes come sized
 *  to it. */
export class Grow implements Toy {
  private motes: Mote[] = [];
  private grab: Pt | null = null;
  private want: Pt | null = null;
  private count = 0;
  private overAt = 0;
  /** Pulling back: when it began, the whole shrink, and how much of it (eased, 0..1) is done. */
  private zoomAt = 0;
  private zoomBy = 1;
  private zoomed = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    s.nu.r = 9;
    this.motes = [];
    this.count = 0;
    this.overAt = 0;
    this.zoomAt = 0;
    this.grab = this.want = null;
    // The first ones are all food, already about, and clear of Nu.
    for (let i = 0; i < GROW_MOTES; i++) {
      const r = s.nu.r * (0.35 + Math.random() * 0.5);
      let p = anywhere(s, r + 4);
      for (let k = 0; k < 30 && dist(p, s.nu) < s.nu.r + r + 70; k++) p = anywhere(s, r + 4);
      this.motes.push(mote(p, r, Math.random() * TAU, 0.02 + Math.random() * 0.04, true));
    }
    s.score(0, best(s, 'grow') || null);
  }

  /** A new mote drifting in from beyond the rim (never right by Nu): more of them bigger as the
   *  run goes on. */
  private add(s: Stage): void {
    const big = Math.min(0.55, 0.3 + this.count * 0.006);
    const r = s.nu.r * (Math.random() < big ? 1 + Math.random() * 0.9 : 0.35 + Math.random() * 0.55);
    let p = rimPoint(s, Math.random(), r + 2);
    for (let k = 0; k < 20 && dist(p, s.nu) < 110 + r; k++) p = rimPoint(s, Math.random(), r + 2);
    // Headed in, roughly at the middle.
    const a = Math.atan2(s.m.y - p.y, s.m.x - p.x) + (Math.random() - 0.5) * 1.2;
    const v = 0.025 + Math.random() * 0.035 + Math.min(0.02, this.count * 0.0004);
    this.motes.push(mote(p, r, a, v, false));
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.overAt) return;
    if (this.want) {
      nu.seek(inside(s, this.want, nu.r + 2), dt, 0.9, 0.05);
      Object.assign(nu, inside(s, nu, nu.r));
    } else nu.vx = nu.vy = 0;
    for (const m of this.motes) {
      if (m.in) this.steer(s, m, dt);
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      // Coming in from beyond the rim: free until it's all the way in.
      if (!m.in) { if (edge(s, m).d < -m.r) m.in = true; else continue; }
      // Off the rim, a wanderer heads the new way.
      if (bounceIn(s, m, m.r, 1)) m.head = Math.atan2(m.vy, m.vx);
    }
    // Motes eat motes well smaller than them, and grow (a small one can turn red this way).
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const a = this.motes[i];
      if (!a.in) continue;
      for (let j = this.motes.length - 1; j >= 0; j--) {
        const b = this.motes[j];
        if (j === i || !b.in || a.r < b.r * 1.2 || dist(a, b) > a.r) continue;
        const was = a.r >= nu.r * 0.95;
        a.r = Math.min(nu.r * 2.4, Math.sqrt(a.r * a.r + b.r * b.r * 0.7));
        this.motes.splice(j, 1);
        if (j < i) i--;
        if (!was && a.r >= nu.r * 0.95) s.fx.ring(a, RED, a.r, a.r + 18, 600);
        else s.fx.ring(a, a.c, a.r, a.r + 10, 400);
      }
    }
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      const d = dist(m, nu);
      if (m.r < nu.r * 0.95 && d < nu.r) {
        this.motes.splice(i, 1);
        nu.r = Math.sqrt(nu.r * nu.r + m.r * m.r * 0.5);
        this.count++;
        // A bigger bite, a higher note.
        hitSound(clamp((m.r / nu.r - 0.3) / 0.65, 0, 1));
        s.score(this.count, best(s, 'grow') || null);
        continue;
      }
      if (m.r >= nu.r * 0.95 && d < nu.r + m.r * 0.8) {
        this.overAt = now;
        this.want = null;
        s.fx.ring(nu, RED, nu.r, nu.r + 30, 600);
        missSound();
        buzz(22);
        finish(s, 'grow', this.count);
        s.score(this.count, best(s, 'grow') || null);
        return;
      }
      // Wandered off the far side while still coming in: gone.
      if (!m.in && edge(s, m).d > m.r + 60) this.motes.splice(i, 1);
    }
    // Grown big: pull the view back, slowly, round Nu.
    if (!this.zoomAt && nu.r > GROW_TOP) {
      this.zoomAt = now;
      this.zoomBy = GROW_BASE / nu.r;
      this.zoomed = 0;
      completeSound();
      s.fx.ring(nu, CYAN, nu.r, nu.r + 50, 1200);
    }
    if (this.zoomAt) {
      const t = clamp((now - this.zoomAt) / GROW_ZOOM_MS, 0, 1), e = t * t * (3 - 2 * t);
      // This frame's share of the shrink, so what Nu eats meanwhile shrinks with it.
      const k = this.zoomBy ** (e - this.zoomed);
      this.zoomed = e;
      nu.r *= k;
      for (const m of this.motes) {
        m.r *= k;
        m.x = nu.x + (m.x - nu.x) * k;
        m.y = nu.y + (m.y - nu.y) * k;
      }
      if (t >= 1) this.zoomAt = 0;
      return;
    }
    while (this.motes.length < GROW_MOTES) this.add(s);
  }

  /** What chases `m` (a bigger mote or Nu, near and coming its way), or null. */
  private chaser(s: Stage, m: Mote): Pt | null {
    const nu = s.nu;
    if (nu.r > m.r * 1.05 && dist(nu, m) < FLEE_SEE + nu.r && nu.vx * (m.x - nu.x) + nu.vy * (m.y - nu.y) > 0.05 * dist(nu, m)) return nu;
    for (const o of this.motes) {
      if (o === m || !o.in || o.r < m.r * 1.2 || dist(o, m) > FLEE_SEE + o.r) continue;
      if (o.way === 'chase' || (o.vx * (m.x - o.x) + o.vy * (m.y - o.y)) > 0) return o;
    }
    return null;
  }

  /** A mote's own way of moving, by easing its speed toward what it wants. */
  private steer(s: Stage, m: Mote, dt: number): void {
    let tx = m.vx, ty = m.vy, top = WAY_TOP[m.way], k = 1 - Math.exp(-dt / 900);
    if (m.way === 'chase') {
      // Slowly toward the nearest thing smaller than it: a mote, or Nu.
      let prey: Pt | null = null, pd = CHASE_SEE;
      for (const o of this.motes) {
        if (o === m || !o.in || o.r * 1.2 > m.r) continue;
        const d = dist(o, m);
        if (d < pd) { pd = d; prey = o; }
      }
      const nd = dist(s.nu, m);
      if (s.nu.r * 1.05 < m.r && nd < pd) { pd = nd; prey = s.nu; }
      if (prey) { tx = ((prey.x - m.x) / pd) * top; ty = ((prey.y - m.y) / pd) * top; k = 1 - Math.exp(-dt / 600); }
    } else if (m.way === 'wander') {
      // A heading that turns this way and that.
      m.head += (Math.random() - 0.5) * 0.006 * dt;
      tx = Math.cos(m.head) * top;
      ty = Math.sin(m.head) * top;
    } else if (m.way === 'flee') {
      const from = this.chaser(s, m);
      if (from) {
        const d = dist(from, m) || 1;
        tx = ((m.x - from.x) / d) * FLEE_TOP;
        ty = ((m.y - from.y) / d) * FLEE_TOP;
        k = 1 - Math.exp(-dt / 250);
        m.scared = 600;
      } else if (m.scared > 0) { m.scared -= dt; k = 0; }
      else {
        // Calm again: back to an easy drift.
        const v = Math.hypot(m.vx, m.vy) || 1;
        tx = (m.vx / v) * 0.04;
        ty = (m.vy / v) * 0.04;
      }
    }
    m.vx += (tx - m.vx) * k;
    m.vy += (ty - m.vy) * k;
    const v = Math.hypot(m.vx, m.vy), cap = m.scared > 0 ? FLEE_TOP : Math.max(top, 0.02);
    if (v > cap) { m.vx *= cap / v; m.vy *= cap / v; }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const m of this.motes) {
      const food = m.r < s.nu.r * 0.95;
      if (food) { dot(ctx, m, m.r, m.c, 0.85); } else { dot(ctx, m, m.r, RED, 0.25); ring(ctx, m, m.r - 1.5, RED, 3, 0.85); }
    }
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

// ---- Rain ------------------------------------------------------------------------------------

/** Nu runs along the bottom, as far as the finger slides. Photons rain down: each caught counts.
 *  Red ones rain too: each caught costs a life. Red from the start, and faster, thicker and
 *  redder with every catch; some drops fall faster than the rest, soon some drift sideways and
 *  reds come in pairs, and later in rows with one gap to slip through. */
export class Rain implements Toy {
  private drops: (Pt & { v: number; vx: number; red: boolean })[] = [];
  private x = 0;
  private grab: number | null = null;
  private want: number | null = null;
  private count = 0;
  private left = 3;
  private next = 0;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 11;
    this.reset(s);
  }

  private row(s: Stage): number { return s.m.y + s.hh - 34; }

  private reset(s: Stage): void {
    this.drops = [];
    this.x = s.nu.x;
    this.count = 0;
    this.left = 3;
    this.next = 600;
    this.overAt = 0;
    this.grab = this.want = null;
    s.score(0, best(s, 'rain') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.want !== null) this.x += clamp(this.want - this.x, -0.8 * dt, 0.8 * dt);
    this.x = clamp(this.x, s.m.x - s.hw + nu.r + 6, s.m.x + s.hw - nu.r - 6);
    nu.seek({ x: this.x, y: this.row(s) }, dt, 1.2, 0.08);
    if (this.overAt) return;
    this.next -= dt;
    if (this.next <= 0) {
      // Drops come quicker as it goes, from the first catch.
      this.next = Math.max(150, 580 - this.count * 15) * (0.6 + Math.random() * 0.8) / 1.2;
      const n = this.count, top = s.m.y - s.hh - 10, lo = s.m.x - s.hw + 24, hi = s.m.x + s.hw - 24;
      // Red from the first drop: from two in five to near two in three.
      const red = Math.random() < Math.min(0.62, 0.4 + n * 0.01);
      // Nearly half fall faster, up to 60% faster.
      const fast = Math.random() < 0.45 ? 1 + Math.random() * 0.6 : 1;
      // Soon some drift sideways (bouncing off the walls).
      const vx = n > 4 && Math.random() < Math.min(0.6, (n - 4) * 0.04) ? (Math.random() - 0.5) * 0.16 : 0;
      const x = lo + Math.random() * (hi - lo);
      const v = (0.17 + Math.min(0.26, n * 0.008) + Math.random() * 0.06) * fast;
      // Later, now and then a row of reds across, with one gap wide enough for Nu: a moment's
      // calm after it, so the row can be read.
      if (n > 14 && Math.random() < Math.min(0.22, (n - 14) * 0.02)) {
        const gap = Math.max(76, nuGap(s)), g0 = lo + Math.random() * (hi - lo - gap), sv = 0.17 + Math.min(0.2, n * 0.006);
        for (let gx = lo; gx <= hi; gx += 30) if (gx < g0 - 8 || gx > g0 + gap + 8) this.drops.push({ x: gx, y: top, v: sv, vx: 0, red: true });
        this.next += 500;
      } else {
        this.drops.push({ x, y: top, v, vx, red });
        // Soon reds can come in pairs or threes, spread a Nu's width or two apart.
        if (red && n > 5 && Math.random() < Math.min(0.55, (n - 5) * 0.04)) {
          const more = n > 12 && Math.random() < 0.35 ? 2 : 1, side = Math.random() < 0.5 ? -1 : 1;
          for (let j = 1; j <= more; j++) {
            const x2 = clamp(x + side * j * (34 + Math.random() * 30), lo, hi);
            this.drops.push({ x: x2, y: top - Math.random() * 40, v, vx, red: true });
          }
        }
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y += d.v * dt;
      d.x += d.vx * dt;
      if (Math.abs(d.x - s.m.x) > s.hw - 8) { d.vx = -d.vx; d.x = clamp(d.x, s.m.x - s.hw + 8, s.m.x + s.hw - 8); }
      if (dist(d, nu) < nu.r + 6) {
        this.drops.splice(i, 1);
        if (d.red) {
          this.left--;
          s.fx.ring(nu, RED, nu.r, nu.r + 24, 500);
          missSound();
          buzz(22);
          if (this.left <= 0) {
            this.overAt = now;
            this.drops = [];
            finish(s, 'rain', this.count);
            s.score(this.count, best(s, 'rain') || null);
            return;
          }
        } else {
          this.count++;
          s.fx.burst(d, 6, CYAN, 0.1);
          captureSound();
          s.score(this.count, best(s, 'rain') || null);
        }
        continue;
      }
      if (d.y > s.m.y + s.hh + 10) this.drops.splice(i, 1);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const d of this.drops) if (d.red) dot(ctx, d, 6, RED); else glow(ctx, d, 5);
    lives(s, ctx, this.left);
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

/** The gap in a row of reds Nu can slip through, with room to spare. */
function nuGap(s: Stage): number { return s.nu.r * 2 + 50; }

// ---- Spot ------------------------------------------------------------------------------------

const SPOT_MS = 6000;

/** A field of atoms, all alike but one: a touch bigger, or a touch off in color. Tap it before
 *  the rim runs out; each find makes the field bigger and the difference smaller. A wrong tap or
 *  the rim running out costs a life, and Nu shows you which it was. */
export class Spot implements Toy {
  private atoms: (Pt & { r: number; c: string })[] = [];
  private odd = 0;
  private count = 0;
  private left = 3;
  private start = 0;
  private showAt = 0;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 7;
    this.count = 0;
    this.left = 3;
    this.overAt = 0;
    this.deal(s);
    s.score(0, best(s, 'spot') || null);
  }

  private deal(s: Stage): void {
    const n = Math.min(30, 6 + this.count * 2), base = 15, hue = NOTE_COLOURS[this.count % 4];
    const diff = Math.max(0.08, 0.4 - this.count * 0.025);
    // A loose grid, nudged so it doesn't look ruled.
    const cols = Math.ceil(Math.sqrt(n * (s.hw / s.hh))), rows = Math.ceil(n / cols);
    const gx = (s.hw * 2 - 60) / cols, gy = (s.hh * 2 - 120) / rows;
    this.atoms = [];
    for (let i = 0; i < n; i++) {
      const cx = s.m.x - s.hw + 30 + gx * ((i % cols) + 0.5), cy = s.m.y - s.hh + 70 + gy * (Math.floor(i / cols) + 0.5);
      this.atoms.push({ x: cx + (Math.random() - 0.5) * gx * 0.3, y: cy + (Math.random() - 0.5) * gy * 0.3, r: base, c: hue });
    }
    this.odd = Math.floor(Math.random() * n);
    const o = this.atoms[this.odd];
    if (Math.random() < 0.5) o.r = base * (1 + diff);
    else o.c = shade(hue, diff);
    this.start = performance.now();
    this.showAt = 0;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, o = this.atoms[this.odd];
    // Showing the odd one (after a find or a miss): Nu circles it.
    if (this.showAt) {
      const a = now / 200;
      nu.seek({ x: o.x + Math.cos(a) * (o.r + 10), y: o.y + Math.sin(a) * (o.r + 10) }, dt, 1, 0.05);
      if (now - this.showAt > 1100 && !this.overAt) this.deal(s);
      s.rim = 0;
      return;
    }
    nu.seek({ x: s.m.x, y: s.m.y - s.hh + 40 }, dt, 0.6, 0.02);
    if (this.overAt) return;
    const left = 1 - (now - this.start) / SPOT_MS;
    s.rim = clamp(left, 0, 1);
    if (left <= 0) this.miss(s, now);
  }

  private miss(s: Stage, now: number): void {
    this.left--;
    this.showAt = now;
    s.fx.ring(this.atoms[this.odd], RED, 16, 40, 600);
    missSound();
    buzz(22);
    if (this.left <= 0) {
      this.overAt = now;
      finish(s, 'spot', this.count);
      s.score(this.count, best(s, 'spot') || null);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const a of this.atoms) dot(ctx, a, a.r, a.c);
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt || this.showAt) return;
    const hit = this.atoms.findIndex((a) => dist(a, p) < a.r + 8);
    if (hit < 0) return;
    if (hit !== this.odd) { this.miss(s, now); return; }
    this.count++;
    this.showAt = now;
    s.fx.ring(this.atoms[hit], CYAN, 16, 40, 500);
    captureSound();
    s.score(this.count, best(s, 'spot') || null);
  }
}

/** A color a little lighter: `k` of the way to white. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16), mix = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// ---- Tilt ------------------------------------------------------------------------------------

/** Press anywhere and lean the finger away from where it went down: the floor tilts that way and
 *  Nu rolls. Roll over photons; every third brings a hole. Into a hole and it's over. */
export class Tilt implements Toy {
  private b: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private press: Pt | null = null;
  private lean = { x: 0, y: 0 };
  private holes: (Pt & { r: number; born: number })[] = [];
  private photon: Pt = { x: 0, y: 0 };
  private count = 0;
  private overAt = 0;
  private sinkAt = 0;

  enter(s: Stage): void {
    s.nu.r = 10;
    this.reset(s);
  }

  private reset(s: Stage): void {
    s.nu.scale = 1;
    this.b = { x: s.nu.x, y: s.nu.y, vx: 0, vy: 0 };
    this.holes = [];
    this.count = 0;
    this.overAt = 0;
    this.press = null;
    this.lean = { x: 0, y: 0 };
    this.addHole(s, performance.now());
    this.photon = this.spot(s);
    s.score(0, best(s, 'tilt') || null);
  }

  private spot(s: Stage, r = 12): Pt {
    let p = anywhere(s, 30);
    for (let k = 0; k < 40 && (dist(p, this.b) < 90 || this.holes.some((h) => dist(p, h) < h.r + r + 20)); k++) p = anywhere(s, 30);
    return p;
  }

  private addHole(s: Stage, now: number): void {
    const r = 22 + Math.random() * 12;
    this.holes.push({ ...this.spot(s, r), r, born: now });
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b;
    if (this.overAt) {
      // Down the hole: Nu sinks to its middle.
      const h = this.holes.find((q) => dist(q, nu) < q.r) ?? nu;
      nu.seek(h, dt, 0.2, 0.02);
      nu.scale = Math.max(0.5, 1 - (now - this.sinkAt) / 600);
      return;
    }
    b.vx += this.lean.x * 0.0009 * dt;
    b.vy += this.lean.y * 0.0009 * dt;
    const drag = Math.exp(-dt / 1400);
    b.vx *= drag;
    b.vy *= drag;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0.5) { b.vx *= 0.5 / sp; b.vy *= 0.5 / sp; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (bounceIn(s, b, nu.r, 0.5)) tickSound(0);
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
    if (dist(b, this.photon) < nu.r + 9) {
      this.count++;
      s.fx.burst(this.photon, 6, CYAN, 0.1);
      captureSound();
      s.score(this.count, best(s, 'tilt') || null);
      if (this.count % 3 === 0 && this.holes.length < 8) this.addHole(s, now);
      this.photon = this.spot(s);
    }
    // Harmless while a new hole opens.
    for (const h of this.holes) {
      if (now - h.born < 900 || dist(b, h) > h.r - nu.r * 0.3) continue;
      this.overAt = now;
      this.sinkAt = now;
      missSound();
      buzz(22);
      finish(s, 'tilt', this.count);
      s.score(this.count, best(s, 'tilt') || null);
      return;
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const h of this.holes) {
      const k = clamp((now - h.born) / 900, 0, 1);
      dot(ctx, h, h.r * k, K975, 1);
      ring(ctx, h, h.r * k, K500, 3, 0.8);
    }
    glow(ctx, this.photon, 5 + Math.sin(now / 260) * 0.6);
    // Which way it leans: a small arrow of dots from the middle of Nu.
    if (this.press && !this.overAt && Math.hypot(this.lean.x, this.lean.y) > 0.05) {
      for (let i = 1; i <= 3; i++) dot(ctx, { x: s.nu.x + this.lean.x * (s.nu.r + 8 * i), y: s.nu.y + this.lean.y * (s.nu.r + 8 * i) }, 2.5, K300, 0.7 - i * 0.15);
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.press = p;
    this.lean = { x: 0, y: 0 };
  }

  move(_s: Stage, p: Pt): void {
    if (!this.press) return;
    const dx = p.x - this.press.x, dy = p.y - this.press.y, d = Math.hypot(dx, dy);
    const k = Math.min(1, d / 60) / (d || 1);
    this.lean = { x: dx * k, y: dy * k };
  }

  up(): void { this.press = null; this.lean = { x: 0, y: 0 }; }
}
