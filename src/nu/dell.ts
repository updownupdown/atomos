// Two more of Nu's park games (park.ts), on the same kit:
//   Spin    a round maze of rings in the court, the nucleus at its middle. Drag round to turn the
//           maze; Nu falls, a spoke carries it up, and it slides in through the gap beside the
//           spoke. Reach the nucleus before the rim runs out; never touch the red.
//   Bend    photons stream from a source at one side. Swipe to lay a short mirror and bend them
//           into the green ring round Nu. Twelve lost in a row and it's over.

import {
  CYAN, GREEN, K300, K500, RED, TAU, WHITE,
  anywhere, best, bounceIn, buzz, captureSound, clamp, completeSound, dist, dot, edge, finish, inside, missSound, ring, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';
import { bar } from './lawn';

/** An angle brought into -π..π. */
const wrap = (a: number): number => { a %= TAU; return a > Math.PI ? a - TAU : a <= -Math.PI ? a + TAU : a; };
/** An angle brought into 0..2π. */
const turnOf = (a: number): number => ((a % TAU) + TAU) % TAU;

// ---- Spin ------------------------------------------------------------------------------------

/** Gravity (px/ms²), the nucleus's pull inside the last ring, the walls' half width, and how
 *  quickly a wall's grip brings Nu to its own speed (ms). */
const SPIN_G = 0.0008;
const SPIN_PULL = 0.0016;
const SPIN_W = 1.5;
const SPIN_GRIP = 4000;
/** How far a gap keeps from a spoke (radians). */
const SPIN_FREE = 0.12;

/** A piece of a ring's wall in the maze's own turn: its radius (a fraction of the court's), where
 *  it starts and how far round it goes. */
type Arc = { f: number; a0: number; span: number; red: boolean };
/** A spoke across a lane, from one ring out to the next (f1 = 1: out to the rim). */
type Spoke = { f0: number; f1: number; a: number };

/** A round maze in the court: rings with a gap or two, a spoke across each lane between them,
 *  and the nucleus in the middle. Drag round the court to turn the maze; Nu falls straight down
 *  through it and rests in the lane. Turned the right way, the lane's spoke lifts Nu, and once
 *  past the side Nu slides down it and in through the gap beside it; a ring passed closes behind
 *  Nu. Reach the nucleus and the next maze has more rings and narrower gaps; from the third, red
 *  on the spoke's wrong side ends the run at a touch. The rim counts each maze's time down. */
export class Spin implements Toy {
  court = true;
  /** The rings' radii as fractions of the court's, outermost first. */
  private rings: number[] = [];
  private arcs: Arc[] = [];
  private spokes: Spoke[] = [];
  /** The maze's turn, and the finger's turn not yet given to it. */
  private th = 0;
  private turn = 0;
  /** How fast the maze turns this frame (radians per ms). */
  private rate = 0;
  private fingerA: number | null = null;
  private v = { x: 0, y: 0 };
  private level = 0;
  private passed = 0;
  private start = 0;
  private ms = 20_000;
  private from: Pt = { x: 0, y: 0 };
  private state: 'play' | 'done' | 'over' = 'play';
  private doneAt = 0;

  enter(s: Stage): void {
    this.level = 0;
    this.state = 'play';
    this.turn = 0;
    this.fingerA = null;
    this.build(s, performance.now());
    s.nu.at(this.from);
    s.score(0, Math.floor(best(s, 'spin')) || null);
  }

  /** Levels done, and a part of one for the rings passed in this maze. */
  raw(): number {
    return Math.round((this.level + (this.state === 'done' ? 0 : this.passed / Math.max(1, this.rings.length))) * 100) / 100;
  }

  /** A new maze for the level to come, Nu to start at the top of its outer lane. */
  private build(s: Stage, now: number): void {
    const L = this.level + 1, n = Math.min(5, 2 + L), R = s.R;
    s.nu.r = clamp(R * 0.04, 5, 9);
    const r = s.nu.r, rOut = 0.8, rIn = n >= 5 ? 0.28 : 0.32;
    this.rings = Array.from({ length: n }, (_, i) => rOut - (i * (rOut - rIn)) / (n - 1));
    // Each lane's spoke well round from the last one's, so Nu, coming in by that, lands clear of
    // the red beside this.
    let at = Math.random() * TAU;
    this.spokes = this.rings.map((f, i) => {
      if (i) at += (Math.random() < 0.5 ? -1 : 1) * (2.3 + Math.random() * 1.1);
      return { f0: f, f1: i ? this.rings[i - 1] : 1, a: turnOf(at) };
    });
    // Room to spare in each gap, less as you go.
    const slack = Math.max(6, 22 - L * 3);
    this.arcs = [];
    this.rings.forEach((f, i) => {
      const rho = f * R, gw = (2 * r + 2 * SPIN_W + slack) / rho, cap = (2 * SPIN_W) / rho;
      const sp = this.spokes[i].a, side = Math.random() < 0.5 ? -1 : 1;
      // One gap right beside the lane's spoke: turned that way, the spoke lifts Nu, and past the
      // side Nu slides down it and through.
      const gaps = [turnOf(sp + side * (gw / 2 - cap / 2))];
      const inner = this.spokes[i + 1];
      if (inner && Math.abs(wrap(inner.a - gaps[0])) < gw / 2 + SPIN_FREE) inner.a = turnOf(inner.a + side * (gw + 2 * SPIN_FREE));
      // From the third level, often red on the spoke's other side: turned the wrong way, Nu slides
      // down the spoke onto it.
      const rl = clamp(44 / rho, 0.3, 0.9);
      const red = L >= 3 && Math.random() < Math.min(0.85, 0.5 + (L - 3) * 0.2) ? turnOf(side > 0 ? sp - cap - rl : sp + cap) : null;
      // Maybe one more gap, anywhere clear of the spokes and the red.
      const g = L <= 2 || Math.random() < 0.5 ? 2 : 1;
      for (let k = 0; k < 80 && gaps.length < g; k++) {
        const c = Math.random() * TAU;
        if ([sp, inner?.a].some((a) => a !== undefined && Math.abs(wrap(c - a)) < gw / 2 + SPIN_FREE)) continue;
        if (Math.abs(wrap(c - gaps[0])) < 1.8) continue;
        if (red !== null && Math.abs(wrap(c - red - rl / 2)) < rl / 2 + gw / 2 + 0.1) continue;
        gaps.push(c);
      }
      gaps.sort((a, b) => a - b);
      gaps.forEach((c, k) => {
        const a0 = c + gw / 2, span = gaps[(k + 1) % gaps.length] + (k + 1 === gaps.length ? TAU : 0) - gw / 2 - a0;
        const o = red === null ? TAU : turnOf(red - a0);
        if (o + rl > span) { this.arcs.push({ f, a0, span, red: false }); return; }
        this.arcs.push({ f, a0, span: o, red: false }, { f, a0: a0 + o, span: rl, red: true }, { f, a0: a0 + o + rl, span: span - o - rl, red: false });
      });
    });
    this.th = Math.random() * TAU;
    this.passed = 0;
    this.v = { x: 0, y: 0 };
    this.from = { x: s.c.x + (Math.random() - 0.5) * 8, y: s.c.y - (s.R - 3 + rOut * R) / 2 };
    // More rings, more time; but less for each as you go.
    this.ms = Math.max(20_000, 6000 + n * 6000 - (L - 1) * 1500);
    this.start = now;
    s.rim = 1;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'over') return;
    if (this.state === 'done') {
      nu.seek(this.from, dt, 0.5, 0.02);
      if (now - this.doneAt > 1100) {
        const at = this.from;
        this.build(s, now);
        this.from = at;
        this.state = 'play';
      }
      return;
    }
    const left = 1 - (now - this.start) / this.ms;
    s.rim = clamp(left, 0, 1);
    if (left <= 0) { this.lose(s, false); return; }
    const take = clamp(this.turn, -0.3, 0.3);
    this.turn = clamp(this.turn - take, -1, 1);
    this.rate = take / Math.max(1, dt);
    // Small steps, so a spoke's end never jumps past Nu.
    const k = Math.max(2, Math.ceil((Math.abs(take) * s.R) / 2.5));
    for (let i = 0; i < k && this.state === 'play'; i++) {
      this.th += take / k;
      this.fall(s, dt / k);
    }
    nu.vx = this.v.x;
    nu.vy = this.v.y;
  }

  private fall(s: Stage, h: number): void {
    const nu = s.nu, c = s.c, R = s.R, r = nu.r, v = this.v;
    let dx = nu.x - c.x, dy = nu.y - c.y, d = Math.hypot(dx, dy) || 1;
    const last = this.rings[this.rings.length - 1] * R;
    if (d < last - SPIN_W - r * 0.5) {
      // Inside the last ring the nucleus draws Nu in.
      v.x -= (dx / d) * SPIN_PULL * h;
      v.y -= (dy / d) * SPIN_PULL * h;
    } else v.y += SPIN_G * h;
    const sp = Math.hypot(v.x, v.y);
    if (sp > 0.45) { v.x *= 0.45 / sp; v.y *= 0.45 / sp; }
    nu.x += v.x * h;
    nu.y += v.y * h;
    // The rings passed are closed behind Nu: no falling back out.
    const shut = this.passed ? this.rings[this.passed - 1] : 2;
    for (let it = 0; it < 2; it++) {
      if (this.passed) {
        dx = nu.x - c.x; dy = nu.y - c.y; d = Math.hypot(dx, dy) || 1;
        this.push(s, { x: c.x + (dx / d) * shut * R, y: c.y + (dy / d) * shut * R }, h);
      }
      for (const a of this.arcs) {
        if (a.f >= shut) continue;
        const rho = a.f * R;
        dx = nu.x - c.x; dy = nu.y - c.y; d = Math.hypot(dx, dy) || 1;
        if (Math.abs(d - rho) > r + SPIN_W) continue;
        const rel = turnOf(Math.atan2(dy, dx) - this.th - a.a0);
        let q: Pt;
        if (rel <= a.span) q = { x: c.x + (dx / d) * rho, y: c.y + (dy / d) * rho };
        else {
          const e = (rel - a.span < TAU - rel ? a.a0 + a.span : a.a0) + this.th;
          q = { x: c.x + Math.cos(e) * rho, y: c.y + Math.sin(e) * rho };
        }
        if (this.push(s, q, h) && a.red) { this.lose(s, true); return; }
      }
      for (const k of this.spokes) {
        const ux = Math.cos(k.a + this.th), uy = Math.sin(k.a + this.th);
        const t = clamp((nu.x - c.x) * ux + (nu.y - c.y) * uy, k.f0 * R, k.f1 >= 1 ? R : k.f1 * R);
        this.push(s, { x: c.x + ux * t, y: c.y + uy * t }, h);
      }
      // The court's rim, a wall all round.
      dx = nu.x - c.x; dy = nu.y - c.y; d = Math.hypot(dx, dy) || 1;
      const rim = R - 3 + SPIN_W;
      this.push(s, { x: c.x + (dx / d) * rim, y: c.y + (dy / d) * rim }, h);
    }
    d = dist(nu, c);
    const inn = this.rings.filter((f) => d < f * R - SPIN_W - r).length;
    if (inn > this.passed) {
      this.passed = inn;
      tickSound(Math.min(5, inn));
      s.fx.ring(nu, CYAN, r, r + 18, 450);
    }
    if (d < R * 0.1) {
      this.level++;
      this.state = 'done';
      this.doneAt = performance.now();
      this.v = { x: 0, y: 0 };
      s.fx.ring(c, GREEN, R * 0.1, R * 0.1 + 40, 700);
      completeSound();
      s.score(this.level, Math.floor(best(s, 'spin')) || null);
    }
  }

  /** Pushes Nu out of a wall at its nearest point `q`, bounces it a little, and lets the wall's
   *  grip carry it along as the maze turns. True if it touched. */
  private push(s: Stage, q: Pt, h: number): boolean {
    const nu = s.nu, v = this.v, m = nu.r + SPIN_W;
    const ex = nu.x - q.x, ey = nu.y - q.y, d = Math.hypot(ex, ey);
    if (d >= m || d < 1e-6) return false;
    const nx = ex / d, ny = ey / d;
    nu.x = q.x + nx * m;
    nu.y = q.y + ny * m;
    const vn = v.x * nx + v.y * ny;
    if (vn < 0) { v.x -= 1.25 * vn * nx; v.y -= 1.25 * vn * ny; }
    const wx = -this.rate * (q.y - s.c.y), wy = this.rate * (q.x - s.c.x);
    const slip = ((v.x - wx) * -ny + (v.y - wy) * nx) * (1 - Math.exp(-h / SPIN_GRIP));
    v.x += slip * ny;
    v.y -= slip * nx;
    return true;
  }

  private lose(s: Stage, red: boolean): void {
    this.state = 'over';
    s.rim = red ? s.rim : 0;
    if (red) { s.fx.burst(s.nu, 10, RED, 0.12); buzz(30); }
    missSound();
    finish(s, 'spin', this.raw());
    s.score(this.level, Math.floor(best(s, 'spin')) || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const c = s.c, R = s.R, fade = this.state === 'play' ? 1 : 0.4;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    const shut = this.passed ? this.rings[this.passed - 1] : 2;
    for (const a of this.arcs) {
      if (a.f >= shut) continue;
      ctx.globalAlpha = (a.red ? 0.95 : 0.9) * fade;
      ctx.strokeStyle = a.red ? RED : K300;
      ctx.beginPath();
      ctx.arc(c.x, c.y, a.f * R, a.a0 + this.th, a.a0 + a.span + this.th);
      ctx.stroke();
    }
    ctx.restore();
    // The rings passed, closed and dim.
    for (const f of this.rings.slice(0, this.passed)) ring(ctx, c, f * R, K500, 3, 0.6 * fade);
    for (const k of this.spokes) {
      const ux = Math.cos(k.a + this.th), uy = Math.sin(k.a + this.th), r1 = k.f1 >= 1 ? R - 2 : k.f1 * R;
      const out = k.f0 >= shut;
      bar(ctx, c.x + ux * k.f0 * R, c.y + uy * k.f0 * R, c.x + ux * r1, c.y + uy * r1, out ? K500 : K300, 3, (out ? 0.6 : 0.9) * fade);
    }
    dot(ctx, c, R * 0.1, GREEN, 0.25);
    ring(ctx, c, R * 0.1, GREEN, 3, 0.9);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'over') return;
    this.fingerA = dist(p, s.c) > 12 ? Math.atan2(p.y - s.c.y, p.x - s.c.x) : null;
  }

  move(s: Stage, p: Pt): void {
    if (this.state === 'over' || dist(p, s.c) <= 12) return;
    const a = Math.atan2(p.y - s.c.y, p.x - s.c.x);
    if (this.fingerA !== null && this.state === 'play') this.turn += wrap(a - this.fingerA);
    this.fingerA = a;
  }

  up(): void { this.fingerA = null; }

  resize(s: Stage): void {
    if (this.state !== 'play') return;
    // The same level again, from the top, in a maze the new size.
    const start = this.start;
    this.build(s, performance.now());
    this.start = start;
    s.nu.at(this.from);
  }
}

// ---- Bend ------------------------------------------------------------------------------------

const BEND_LIVES = 12;
const BEND_LEN = 90;
const BEND_LIFE = 4000;

type Mirror = { a: Pt; b: Pt; t0: number };
type Photon = Mover & { t0: number; c: string; last: Mirror | null };

/** A source at one side of the arena sends a steady stream of photons across; Nu waits in a
 *  green ring elsewhere, grey posts in between. Swipe to lay a short mirror where the finger
 *  went (two at most, each fading in a few seconds); photons bounce off it, and off the posts.
 *  Each one into the ring counts. Red atoms drift about and eat the photons they touch. Every ten
 *  the ring moves and the source changes side. Twelve lost in a row and it's over. */
export class Bend implements Toy {
  private src = { x: 0, y: 0, a: 0 };
  private side = -1;
  private goal = { x: 0, y: 0, r: 26 };
  private posts: (Pt & { r: number })[] = [];
  private reds: Mover[] = [];
  private photons: Photon[] = [];
  private mirrors: Mirror[] = [];
  private drawing: { a: Pt; b: Pt } | null = null;
  private count = 0;
  private lost = 0;
  private nextAt = 0;
  private shots = 0;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    s.rim = null;
    this.count = 0;
    this.lost = 0;
    this.overAt = 0;
    this.side = -1;
    this.drawing = null;
    this.setup(s, performance.now());
    s.score(0, best(s, 'bend') || null);
  }

  /** A new layout: the source on another side, the ring somewhere off its beam, posts and reds. */
  private setup(s: Stage, now: number): void {
    const k = Math.floor(this.count / 10);
    this.photons = [];
    this.mirrors = [];
    this.nextAt = now + 1200;
    let side = Math.floor(Math.random() * 4);
    if (side === this.side) side = (side + 1 + Math.floor(Math.random() * 3)) % 4;
    this.side = side;
    const t = Math.random() - 0.5;
    const at = [
      { x: s.m.x - s.hw + 14, y: s.m.y + t * s.hh },
      { x: s.m.x + s.hw - 14, y: s.m.y + t * s.hh },
      { x: s.m.x + t * s.hw, y: s.m.y - s.hh + 14 },
      { x: s.m.x + t * s.hw, y: s.m.y + s.hh - 14 },
    ][side];
    const p = inside(s, at, 14);
    this.src = { ...p, a: [0, Math.PI, Math.PI / 2, -Math.PI / 2][side] + (Math.random() - 0.5) * 0.6 };
    const ux = Math.cos(this.src.a), uy = Math.sin(this.src.a);
    // How far along the beam a point is, and how far off it.
    const along = (q: Pt): number => (q.x - p.x) * ux + (q.y - p.y) * uy;
    const off = (q: Pt): number => Math.abs((q.x - p.x) * uy - (q.y - p.y) * ux);
    const r = Math.max(15, 26 - k * 2);
    let g = anywhere(s, r + 20);
    for (let i = 0; i < 80; i++) {
      const q = anywhere(s, r + 20), l = along(q);
      const foot = { x: p.x + ux * l, y: p.y + uy * l };
      const far = i < 60 ? 80 : 50;
      if (l > 40 && off(q) > far && dist(q, p) > 140 && edge(s, foot).d < -20) { g = q; break; }
    }
    this.goal = { ...g, r };
    const l = along(g), foot = { x: p.x + ux * l, y: p.y + uy * l };
    this.posts = [];
    // Later on, a post right in the short way from the beam to the ring.
    if (k >= 2) this.posts.push({ x: (foot.x + g.x) / 2, y: (foot.y + g.y) / 2, r: 12 });
    const want = Math.min(5, 1 + k);
    for (let i = 0; i < 80 && this.posts.length < want; i++) {
      const q = { ...anywhere(s, 26), r: 10 + Math.random() * 6 };
      if (dist(q, g) < r + 40 || dist(q, p) < 70 || (along(q) > 0 && off(q) < q.r + 26)) continue;
      if (this.posts.some((o) => dist(o, q) < 50)) continue;
      this.posts.push(q);
    }
    const reds = Math.min(5, k);
    this.reds = [];
    for (let i = 0; i < 60 && this.reds.length < reds; i++) {
      const q = anywhere(s, 20);
      if (dist(q, g) < 80 || dist(q, p) < 80 || (along(q) > 0 && off(q) < 40)) continue;
      const a = Math.random() * TAU, sp = 0.018 + Math.random() * 0.012 + Math.min(0.03, k * 0.004);
      this.reds.push({ ...q, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
    }
  }

  step(s: Stage, dt: number, now: number): void {
    s.nu.seek(this.goal, dt, 0.4, 0.015);
    s.nu.glow += (1 - s.nu.glow) * (1 - Math.exp(-dt / 200));
    if (this.overAt) return;
    for (const q of this.reds) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      bounceIn(s, q, 9, 1);
    }
    this.mirrors = this.mirrors.filter((m) => now - m.t0 < BEND_LIFE);
    if (now >= this.nextAt) {
      const k = Math.floor(this.count / 10);
      // Slower at first, to find your feet.
      this.nextAt = now + Math.max(420, 620 - k * 60);
      const a = this.src.a + (Math.random() - 0.5) * 0.08, v = Math.min(0.28, 0.2 + k * 0.015);
      this.photons.push({ x: this.src.x, y: this.src.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: now, c: this.shots++ % 2 ? WHITE : CYAN, last: null });
    }
    for (let i = this.photons.length - 1; i >= 0; i--) {
      const q = this.photons[i], ox = q.x, oy = q.y;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      // Off a mirror it crossed (not the one it just left).
      for (const m of this.mirrors) {
        if (m === q.last) continue;
        const hit = cross({ x: ox, y: oy }, q, m.a, m.b);
        if (hit === null) continue;
        const mx = m.b.x - m.a.x, my = m.b.y - m.a.y, ml = Math.hypot(mx, my) || 1, tx = mx / ml, ty = my / ml;
        const vt = q.vx * tx + q.vy * ty;
        q.vx = 2 * vt * tx - q.vx;
        q.vy = 2 * vt * ty - q.vy;
        const hx = ox + (q.x - ox) * hit, hy = oy + (q.y - oy) * hit, rest = (1 - hit) * dt;
        q.x = hx + q.vx * rest;
        q.y = hy + q.vy * rest;
        q.last = m;
        break;
      }
      for (const o of this.posts) {
        const d = dist(q, o);
        if (d >= o.r + 2 || d === 0) continue;
        const nx = (q.x - o.x) / d, ny = (q.y - o.y) / d, vn = q.vx * nx + q.vy * ny;
        if (vn < 0) { q.vx -= 2 * vn * nx; q.vy -= 2 * vn * ny; }
        q.x = o.x + nx * (o.r + 2);
        q.y = o.y + ny * (o.r + 2);
        q.last = null;
      }
      if (dist(q, this.goal) < this.goal.r) {
        this.photons.splice(i, 1);
        this.score(s, now);
        // Ten in: a new layout, and these photons are gone.
        if (!this.photons.length) return;
        continue;
      }
      const eaten = this.reds.find((o) => dist(o, q) < 11);
      if (eaten || edge(s, q).d > 0 || now - q.t0 > 7000) {
        this.photons.splice(i, 1);
        if (eaten) s.fx.burst(q, 4, RED, 0.06);
        if (++this.lost >= BEND_LIVES) {
          this.overAt = now;
          this.photons = [];
          missSound();
          finish(s, 'bend', this.count);
          s.score(this.count, best(s, 'bend') || null);
          return;
        }
      }
    }
  }

  private score(s: Stage, now: number): void {
    this.count++;
    this.lost = 0;
    s.nu.glow = 1.6;
    s.fx.ring(this.goal, GREEN, this.goal.r, this.goal.r + 14, 400);
    s.score(this.count, best(s, 'bend') || null);
    if (this.count % 10) { captureSound(); return; }
    completeSound();
    s.fx.ring(this.goal, GREEN, this.goal.r, this.goal.r + 50, 800);
    this.setup(s, now);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const nu = s.nu, g = this.goal, sr = this.src;
    for (const o of this.posts) { dot(ctx, o, o.r, K500, 0.9); ring(ctx, o, o.r, K300, 2, 0.6); }
    dot(ctx, g, g.r, GREEN, 0.12);
    ring(ctx, g, g.r, this.overAt ? K500 : GREEN, 3, 0.9);
    // The source, and a stub of its beam.
    bar(ctx, sr.x, sr.y, sr.x + Math.cos(sr.a) * 18, sr.y + Math.sin(sr.a) * 18, CYAN, 3, 0.6);
    ring(ctx, sr, 11, CYAN, 2, 0.5);
    dot(ctx, sr, 6, CYAN);
    for (const q of this.reds) { dot(ctx, q, 10, RED, 0.25); ring(ctx, q, 8, RED, 3, 0.9); }
    for (const m of this.mirrors) bar(ctx, m.a.x, m.a.y, m.b.x, m.b.y, WHITE, 3, 0.95 * Math.min(1, (BEND_LIFE - (now - m.t0)) / 1000));
    if (this.drawing) bar(ctx, this.drawing.a.x, this.drawing.a.y, this.drawing.b.x, this.drawing.b.y, WHITE, 3, 0.4);
    for (const q of this.photons) dot(ctx, q, 2.6, q.c);
    // The photons that may still be lost in a row: a row of dots that empties.
    for (let i = 0; i < BEND_LIVES; i++) {
      // At the top, or the bottom while the source is up there.
      const p = { x: s.m.x + (i - (BEND_LIVES - 1) / 2) * 10, y: this.side === 2 ? s.m.y + s.hh - 18 : s.m.y - s.hh + 18 };
      if (i < BEND_LIVES - this.lost) dot(ctx, p, 3, WHITE, 0.85); else ring(ctx, p, 3, K500, 2, 0.8);
    }
    nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.drawing = { a: { ...p }, b: { ...p } };
  }

  move(_s: Stage, p: Pt): void {
    const m = this.drawing;
    if (!m || this.overAt) return;
    const d = dist(m.a, p), k = d > BEND_LEN ? BEND_LEN / d : 1;
    m.b = { x: m.a.x + (p.x - m.a.x) * k, y: m.a.y + (p.y - m.a.y) * k };
  }

  up(s: Stage, p: Pt): void {
    this.move(s, p);
    const m = this.drawing;
    this.drawing = null;
    if (!m || this.overAt) return;
    if (dist(m.a, m.b) < 14) return;
    if (this.mirrors.length >= 2) this.mirrors.shift();
    this.mirrors.push({ a: m.a, b: m.b, t0: performance.now() });
    tickSound(2);
  }

  resize(s: Stage): void {
    if (this.overAt) return;
    this.setup(s, performance.now());
  }
}

/** Where along a→b (0..1) it crosses the segment c→d, or null. */
function cross(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
