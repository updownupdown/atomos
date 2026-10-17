// Three more of Nu's park games (park.ts), on the same kit:
//   Carve   red dots bounce about one big block. Swipe across or up and down and Nu draws a wall
//           both ways from there; a dot touching it before it's done breaks it. Blocks left
//           with no red in them are won; win three quarters and on to the next, with one more dot.
//   Trail   Nu glides on and turns toward the finger, a chain of electrons behind it. Catch the
//           green to grow it; never cross the chain, never touch the red.
//   Bank    pull back and let go to send Nu off the rim and the grey posts through the green
//           rings, so many shots a layout. Red stops the shot.

import {
  CYAN, GREEN, K300, K500, NOTE_COLOURS, RED, TAU, WHITE,
  anywhere, best, bounceIn, buzz, captureSound, clamp, completeSound, dist, dot, edge, finish, inside, missSound, ring, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';
import { bar, lives } from './lawn';

// ---- Carve -----------------------------------------------------------------------------------

/** How fast each end of a wall grows (px/ms), the red dots' size, and the share to win. */
const CARVE_GROW = 0.3;
const CARVE_DOT = 6;
const CARVE_GOAL = 0.75;
/** The won blocks' plate. */
const CARVE_PLATE = NOTE_COLOURS[1];

type Box = { x0: number; y0: number; x1: number; y1: number; won: boolean };
/** A wall growing across its block: along y = `at` from x `a` to `z` (`h`), or along x = `at`
 *  from y `a` to `z`; `o` is where it started. */
type Wall = { b: Box; h: boolean; at: number; o: number; a: number; z: number };

/** JezzBall, Nu's way. The arena starts as one block with red dots bouncing about in it. Swipe
 *  (mostly across, or mostly up and down) and Nu draws a wall from where the finger went down,
 *  growing both ways across the block it's in. If a red dot touches it before it's done, it
 *  breaks: one of three lives. A finished wall splits the block in two, and a block with no red
 *  in it is won, a calm green plate. Win three quarters of the arena and the next level starts by
 *  itself, with one more dot, a little faster; each level won gives a life back. The count is the
 *  levels won and a tenth for each tenth of the way through this one. */
export class Carve implements Toy {
  private boxes: Box[] = [];
  private dots: Mover[] = [];
  private wall: Wall | null = null;
  /** The wall that just broke, shown red for a moment. */
  private broke: { w: Wall; t: number } | null = null;
  private press: Pt | null = null;
  private lv = 0;
  private won = 0;
  private left = 3;
  private clearAt = 0;
  private overAt = 0;
  private f: Box = { x0: 0, y0: 0, x1: 0, y1: 0, won: false };

  /** The playing field: the arena less its corners, and room at the top for the lives. */
  private field(s: Stage): Box {
    const m = Math.max(14, s.rr * 0.3 + 6);
    return { x0: s.m.x - s.hw + m, y0: s.m.y - s.hh + 40, x1: s.m.x + s.hw - m, y1: s.m.y + s.hh - m, won: false };
  }

  /** Levels won, and tenths of the way through this one. */
  raw(): number { return this.lv + Math.min(0.9, Math.floor((this.won / CARVE_GOAL) * 10 + 1e-6) / 10); }

  enter(s: Stage): void {
    s.nu.r = 8;
    s.rim = null;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.lv = 0;
    this.left = 3;
    this.overAt = 0;
    this.level(s);
    s.score(0, best(s, 'carve') || null);
  }

  private level(s: Stage): void {
    this.f = this.field(s);
    this.boxes = [{ ...this.f }];
    this.wall = null;
    this.broke = null;
    this.press = null;
    this.won = 0;
    this.clearAt = 0;
    const n = 2 + this.lv, v = Math.min(0.26, 0.1 + this.lv * 0.015), f = this.f;
    this.dots = Array.from({ length: n }, () => {
      // Never straight along a wall: diagonals, give or take.
      const a = (Math.floor(Math.random() * 4) + 0.5) * (Math.PI / 2) + (Math.random() - 0.5) * 0.6;
      return {
        x: f.x0 + 20 + Math.random() * (f.x1 - f.x0 - 40), y: f.y0 + 20 + Math.random() * (f.y1 - f.y0 - 40),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      };
    });
  }

  private boxAt(p: Pt): Box | undefined {
    return this.boxes.find((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, w = this.wall;
    nu.seek(w ? (w.h ? { x: w.o, y: w.at } : { x: w.at, y: w.o }) : nu, dt, 0.9, 0.05);
    if (this.overAt) return;
    if (this.clearAt) {
      if (now - this.clearAt > 1000) this.level(s);
      return;
    }
    if (w) {
      const lo = w.h ? w.b.x0 : w.b.y0, hi = w.h ? w.b.x1 : w.b.y1;
      w.a = Math.max(lo, w.a - CARVE_GROW * dt);
      w.z = Math.min(hi, w.z + CARVE_GROW * dt);
    }
    // The dots, in small steps so none slips through a wall.
    for (const d of this.dots) {
      const b = this.boxAt(d) ?? this.f, n = Math.max(1, Math.ceil((Math.hypot(d.vx, d.vy) * dt) / 3));
      for (let k = 0; k < n; k++) {
        d.x += (d.vx * dt) / n;
        d.y += (d.vy * dt) / n;
        if (d.x < b.x0 + CARVE_DOT) { d.x = b.x0 + CARVE_DOT; d.vx = Math.abs(d.vx); }
        if (d.x > b.x1 - CARVE_DOT) { d.x = b.x1 - CARVE_DOT; d.vx = -Math.abs(d.vx); }
        if (d.y < b.y0 + CARVE_DOT) { d.y = b.y0 + CARVE_DOT; d.vy = Math.abs(d.vy); }
        if (d.y > b.y1 - CARVE_DOT) { d.y = b.y1 - CARVE_DOT; d.vy = -Math.abs(d.vy); }
        const ww = this.wall;
        if (ww && ww.b === b && this.touches(ww, d)) { this.breakWall(s, d, now); break; }
      }
    }
    if (this.overAt) return;
    const ww = this.wall;
    if (ww && ww.a <= (ww.h ? ww.b.x0 : ww.b.y0) && ww.z >= (ww.h ? ww.b.x1 : ww.b.y1)) this.split(s, ww, now);
  }

  private touches(w: Wall, d: Pt): boolean {
    const across = w.h ? d.y : d.x, along = w.h ? d.x : d.y;
    return Math.abs(across - w.at) < CARVE_DOT + 1.5 && along > w.a - CARVE_DOT && along < w.z + CARVE_DOT;
  }

  private breakWall(s: Stage, d: Pt, now: number): void {
    if (!this.wall) return;
    this.broke = { w: this.wall, t: now };
    this.wall = null;
    this.left--;
    s.fx.ring(d, RED, CARVE_DOT, 34, 500);
    missSound();
    buzz(24);
    if (this.left > 0) return;
    this.overAt = now;
    finish(s, 'carve', this.raw());
    s.score(this.raw(), best(s, 'carve') || null);
  }

  private split(s: Stage, w: Wall, now: number): void {
    this.wall = null;
    const b = w.b, one: Box = { ...b }, two: Box = { ...b };
    if (w.h) { one.y1 = w.at; two.y0 = w.at; } else { one.x1 = w.at; two.x0 = w.at; }
    this.boxes.splice(this.boxes.indexOf(b), 1, one, two);
    let gained = false;
    for (const q of [one, two]) {
      q.won = !this.dots.some((d) => d.x >= q.x0 && d.x <= q.x1 && d.y >= q.y0 && d.y <= q.y1);
      if (q.won) { gained = true; s.fx.ring({ x: (q.x0 + q.x1) / 2, y: (q.y0 + q.y1) / 2 }, GREEN, 8, 40, 600); }
    }
    const area = (q: Box) => (q.x1 - q.x0) * (q.y1 - q.y0);
    this.won = this.boxes.filter((q) => q.won).reduce((n, q) => n + area(q), 0) / area(this.f);
    if (this.won >= CARVE_GOAL) {
      this.lv++;
      this.won = 0;
      this.left = Math.min(3, this.left + 1);
      this.clearAt = now;
      completeSound();
    } else if (gained) captureSound();
    else tickSound(3);
    s.score(this.raw(), best(s, 'carve') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    for (const b of this.boxes) {
      if (!b.won) continue;
      ctx.globalAlpha = this.clearAt ? 0.6 : 0.42;
      ctx.fillStyle = CARVE_PLATE;
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = K300;
    ctx.lineWidth = 3;
    for (const b of this.boxes) ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.restore();
    const line = (w: Wall, c: string, alpha: number) => w.h ? bar(ctx, w.a, w.at, w.z, w.at, c, 3, alpha) : bar(ctx, w.at, w.a, w.at, w.z, c, 3, alpha);
    if (this.wall) line(this.wall, CYAN, 0.95);
    if (this.broke && now - this.broke.t < 500) line(this.broke.w, RED, 0.9 * (1 - (now - this.broke.t) / 500));
    for (const d of this.dots) dot(ctx, d, CARVE_DOT, RED, this.overAt ? 0.5 : 0.95);
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt || this.clearAt || this.wall) return;
    this.press = p;
  }

  move(s: Stage, p: Pt): void {
    const o = this.press;
    if (!o) return;
    const dx = p.x - o.x, dy = p.y - o.y;
    if (Math.hypot(dx, dy) < 14) return;
    this.press = null;
    const b = this.boxAt(o), h = Math.abs(dx) >= Math.abs(dy);
    if (!b || b.won || this.wall || this.clearAt || this.overAt) return;
    const at = h ? o.y : o.x, lo = h ? b.y0 : b.x0, hi = h ? b.y1 : b.x1;
    // Not right against the block's own edge: no block that thin.
    if (at - lo < 5 || hi - at < 5) return;
    const along = h ? o.x : o.y;
    this.wall = { b, h, at, o: along, a: along, z: along };
    tickSound(2);
    s.fx.ring(o, CYAN, 4, 20, 300);
  }

  up(): void { this.press = null; }

  resize(s: Stage): void {
    // Everything stretched to the new field.
    const o = this.f, f = this.field(s);
    const kx = (f.x1 - f.x0) / (o.x1 - o.x0 || 1), ky = (f.y1 - f.y0) / (o.y1 - o.y0 || 1);
    const X = (x: number) => f.x0 + (x - o.x0) * kx, Y = (y: number) => f.y0 + (y - o.y0) * ky;
    for (const b of this.boxes) { b.x0 = X(b.x0); b.x1 = X(b.x1); b.y0 = Y(b.y0); b.y1 = Y(b.y1); }
    for (const d of this.dots) { d.x = X(d.x); d.y = Y(d.y); }
    const w = this.wall;
    if (w) {
      if (w.h) { w.at = Y(w.at); w.o = X(w.o); w.a = X(w.a); w.z = X(w.z); } else { w.at = X(w.at); w.o = Y(w.o); w.a = Y(w.a); w.z = Y(w.z); }
    }
    this.broke = null;
    this.f = f;
  }
}

// ---- Trail -----------------------------------------------------------------------------------

/** The room between electrons on the chain, and how fast Nu turns (rad/ms). */
const TRAIL_GAP = 16;
const TRAIL_TURN = 0.0045;
const TRAIL_FOOD = 6;

/** Snake, Nu's way. Nu glides on by itself and turns toward the finger as it drags; behind it
 *  trails a chain of electrons, one for each green dot caught, and each catch quickens it a
 *  little. The rim only turns Nu along it, but crossing its own chain or touching a red dot ends
 *  the run. More red drifts in as the chain grows. The count is the dots caught. */
export class Trail implements Toy {
  private head = -Math.PI / 2;
  /** Where Nu has been, newest first, for the chain to follow. */
  private path: Pt[] = [];
  private food: Pt = { x: 0, y: 0 };
  private reds: Mover[] = [];
  private finger: Pt | null = null;
  private started = false;
  private count = 0;
  private overAt = 0;
  private speed(): number { return Math.min(0.24, 0.1 + this.count * 0.006); }

  enter(s: Stage): void {
    s.nu.r = 8;
    s.rim = null;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.head = -Math.PI / 2;
    this.path = [];
    this.reds = [];
    this.finger = null;
    this.started = false;
    this.count = 0;
    this.overAt = 0;
    this.addRed(s);
    this.place(s);
    s.score(0, best(s, 'trail') || null);
  }

  /** The electrons' places, nearest Nu first, spaced along the way it came. */
  private links(): Pt[] {
    const out: Pt[] = [];
    let want = TRAIL_GAP, run = 0;
    for (let i = 1; i < this.path.length && out.length < this.count; i++) {
      const a = this.path[i - 1], b = this.path[i], l = dist(a, b);
      while (l > 0 && run + l >= want && out.length < this.count) {
        const t = (want - run) / l;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        want += TRAIL_GAP;
      }
      run += l;
    }
    return out;
  }

  private place(s: Stage): void {
    const chain = this.links();
    let p = anywhere(s, 26);
    for (let k = 0; k < 60; k++) {
      if (dist(p, s.nu) > 90 && this.reds.every((r) => dist(r, p) > 40) && chain.every((c) => dist(c, p) > 18)) break;
      p = anywhere(s, 26);
    }
    this.food = p;
  }

  private addRed(s: Stage): void {
    let p = anywhere(s, 30);
    for (let k = 0; k < 40 && dist(p, s.nu) < 150; k++) p = anywhere(s, 30);
    const a = Math.random() * TAU, v = 0.03 + Math.min(0.03, this.count * 0.002);
    this.reds.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.overAt) { nu.vx = nu.vy = 0; return; }
    if (!this.started) { nu.seek(s.m, dt); return; }
    const f = this.finger;
    if (f && dist(f, nu) > 14) {
      let d = Math.atan2(f.y - nu.y, f.x - nu.x) - this.head;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.head += clamp(d, -TRAIL_TURN * dt, TRAIL_TURN * dt);
    }
    const v = this.speed();
    let hx = Math.cos(this.head), hy = Math.sin(this.head);
    nu.x += hx * v * dt;
    nu.y += hy * v * dt;
    // The rim turns Nu along it.
    const e = edge(s, nu);
    if (e.d + nu.r > 0) {
      Object.assign(nu, inside(s, nu, nu.r));
      const vn = hx * e.nx + hy * e.ny;
      if (vn > 0) {
        hx -= vn * e.nx;
        hy -= vn * e.ny;
        if (Math.hypot(hx, hy) < 0.2) {
          // Head on: turn whichever way the finger is, else to the right.
          const tx = -e.ny, ty = e.nx, side = f ? (f.x - nu.x) * tx + (f.y - nu.y) * ty : 1;
          hx = side >= 0 ? tx : -tx;
          hy = side >= 0 ? ty : -ty;
        }
        this.head = Math.atan2(hy, hx);
      }
    }
    nu.vx = Math.cos(this.head) * v;
    nu.vy = Math.sin(this.head) * v;
    if (!this.path.length || dist(this.path[0], nu) >= 2) this.path.unshift({ x: nu.x, y: nu.y });
    // Keep only as much of the way as the chain needs.
    let run = 0;
    for (let i = 1; i < this.path.length; i++) {
      run += dist(this.path[i - 1], this.path[i]);
      if (run > (this.count + 2) * TRAIL_GAP) { this.path.length = i + 1; break; }
    }
    for (const r of this.reds) {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      bounceIn(s, r, 7, 1);
    }
    // The first few links are too close to Nu to be crossed.
    const crossed = this.links().some((c, i) => i >= 3 && dist(c, nu) < nu.r + 2);
    if (crossed || this.reds.some((r) => dist(r, nu) < nu.r + 6)) { this.over(s, now); return; }
    if (dist(nu, this.food) < nu.r + TRAIL_FOOD + 1) {
      this.count++;
      s.fx.ring(this.food, GREEN, TRAIL_FOOD, 30, 500);
      captureSound();
      s.score(this.count, best(s, 'trail') || null);
      if (this.count % 4 === 0 && this.reds.length < 6) this.addRed(s);
      this.place(s);
    }
  }

  private over(s: Stage, now: number): void {
    this.overAt = now;
    s.fx.ring(s.nu, RED, s.nu.r, 40, 600);
    missSound();
    buzz(30);
    finish(s, 'trail', this.count);
    s.score(this.count, best(s, 'trail') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const out = !!this.overAt;
    if (!out) dot(ctx, this.food, TRAIL_FOOD, GREEN, 0.95);
    for (const r of this.reds) dot(ctx, r, 7, RED, out ? 0.5 : 0.95);
    for (const c of this.links()) ring(ctx, c, 4.5, out ? K500 : CYAN, 2.5, 0.9);
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.started = true;
    this.finger = p;
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }

  resize(s: Stage): void {
    Object.assign(s.nu, inside(s, s.nu, s.nu.r));
    this.food = inside(s, this.food, TRAIL_FOOD + 20);
    for (const r of this.reds) Object.assign(r, inside(s, r, 8));
    this.path = this.path.map((p) => inside(s, p, 4));
  }
}

// ---- Bank ------------------------------------------------------------------------------------

const BANK_R = 9;
const BANK_POST = 13;
const BANK_RING = 12;
/** What a bounce keeps of Nu's speed. */
const BANK_KEEP = 0.85;

type Block = { x: number; y: number; w: number; h: number };

/** Bank shots. Green rings, grey posts and red blocks stand about the arena; Nu waits at the
 *  bottom. Pull back (from anywhere) and let go: Nu flies the other way, harder the further the
 *  pull, bounces off the rim and the posts, a little slower each time, and catches every ring it
 *  passes through. Dots show the way to the first bounce. Red stops the shot. Each layout gives
 *  so many shots; catch every ring for a new one, with more posts and fewer spare shots. Out of
 *  shots with rings left, it's over. The count is the rings caught. */
export class Bank implements Toy {
  private rings: (Pt & { got: boolean })[] = [];
  private posts: Pt[] = [];
  private blocks: Block[] = [];
  private b: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private state: 'back' | 'ready' | 'fly' | 'clear' = 'back';
  private from: Pt | null = null;
  private pull: Pt | null = null;
  private shots = 0;
  private lv = 0;
  private count = 0;
  private flyAt = 0;
  private clearAt = 0;
  private overAt = 0;
  private home(s: Stage): Pt { return { x: s.m.x, y: s.m.y + s.hh - 36 }; }

  enter(s: Stage): void {
    s.nu.r = BANK_R;
    s.rim = null;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.lv = 0;
    this.count = 0;
    this.overAt = 0;
    this.layout(s);
    s.score(0, best(s, 'bank') || null);
  }

  private layout(s: Stage): void {
    const lv = this.lv, home = this.home(s), placed: (Pt & { r: number })[] = [];
    const spot = (r: number): Pt => {
      let p: Pt = s.m;
      for (let k = 0; k < 200; k++) {
        p = { x: s.m.x + (Math.random() * 2 - 1) * (s.hw - 30 - r), y: s.m.y - s.hh + 50 + r + Math.random() * Math.max(10, 2 * s.hh - 170 - 2 * r) };
        if (edge(s, p).d < -r - 12 && dist(p, home) > 90 && placed.every((q) => dist(q, p) > q.r + r + 18)) break;
      }
      placed.push({ ...p, r });
      return p;
    };
    this.rings = Array.from({ length: 3 + Math.min(3, lv) }, () => ({ ...spot(BANK_RING), got: false }));
    this.posts = Array.from({ length: Math.min(8, 2 + lv) }, () => spot(BANK_POST));
    this.blocks = Array.from({ length: Math.min(5, 1 + Math.floor(lv / 2)) }, () => {
      const p = spot(24), across = Math.random() < 0.6;
      return { x: p.x, y: p.y, w: across ? 22 : 7, h: across ? 7 : 22 };
    });
    this.shots = this.rings.length + Math.max(0, 3 - lv);
    this.state = 'back';
    this.from = this.pull = null;
  }

  private hitsBlock(p: Pt, r: number): boolean {
    return this.blocks.some((k) => Math.hypot(p.x - clamp(p.x, k.x - k.w, k.x + k.w), p.y - clamp(p.y, k.y - k.h, k.y + k.h)) < r);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b, home = this.home(s);
    if (this.state !== 'fly') {
      nu.seek(home, dt, 0.7, 0.03);
      if (this.overAt) return;
      if (this.state === 'clear' && now - this.clearAt > 900) { this.lv++; this.layout(s); }
      if (this.state === 'back' && dist(nu, home) < 3) this.state = 'ready';
      Object.assign(b, { x: nu.x, y: nu.y, vx: 0, vy: 0 });
      return;
    }
    const n = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 3));
    for (let k = 0; k < n; k++) {
      b.x += (b.vx * dt) / n;
      b.y += (b.vy * dt) / n;
      if (bounceIn(s, b, BANK_R, BANK_KEEP)) { b.vx *= 0.96; b.vy *= 0.96; tickSound(0); }
      for (const p of this.posts) {
        const d = dist(b, p), rr = BANK_POST + BANK_R;
        if (d >= rr || d === 0) continue;
        const nx = (b.x - p.x) / d, ny = (b.y - p.y) / d, vn = b.vx * nx + b.vy * ny;
        b.x = p.x + nx * rr;
        b.y = p.y + ny * rr;
        if (vn < 0) { b.vx -= (1 + BANK_KEEP) * vn * nx; b.vy -= (1 + BANK_KEEP) * vn * ny; tickSound(1); }
      }
      for (const r of this.rings) {
        if (r.got || dist(r, b) > BANK_RING + BANK_R * 0.6) continue;
        r.got = true;
        this.count++;
        s.fx.ring(r, GREEN, BANK_RING, BANK_RING + 24, 500);
        captureSound();
        s.score(this.count, best(s, 'bank') || null);
      }
      if (this.hitsBlock(b, BANK_R)) {
        s.fx.ring(b, RED, BANK_R, 36, 500);
        missSound();
        buzz(20);
        this.end(s, now);
        break;
      }
    }
    const f = Math.exp(-dt / 1800);
    b.vx *= f;
    b.vy *= f;
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
    if (this.state === 'fly' && (Math.hypot(b.vx, b.vy) < 0.05 || now - this.flyAt > 6000)) this.end(s, now);
  }

  /** The shot is done: a new layout, the next shot, or the end. */
  private end(s: Stage, now: number): void {
    this.b.vx = this.b.vy = 0;
    if (this.rings.every((r) => r.got)) {
      this.state = 'clear';
      this.clearAt = now;
      completeSound();
      return;
    }
    this.state = 'back';
    if (this.shots > 0) return;
    this.overAt = now;
    finish(s, 'bank', this.count);
    s.score(this.count, best(s, 'bank') || null);
  }

  /** The way Nu would go, up to its first bounce and a little beyond; null if it hits red first. */
  private aim(s: Stage, dx: number, dy: number): { to: Pt; on: Pt | null } {
    let p: Pt = { x: this.b.x, y: this.b.y };
    for (let k = 0; k < 400; k++) {
      const q = { x: p.x + dx * 3, y: p.y + dy * 3 };
      if (this.hitsBlock(q, BANK_R)) return { to: p, on: null };
      let nx = 0, ny = 0;
      const e = edge(s, q);
      if (e.d + BANK_R > 0) { nx = e.nx; ny = e.ny; } else {
        const post = this.posts.find((o) => dist(o, q) < BANK_POST + BANK_R);
        if (post) { const d = dist(post, q) || 1; nx = (post.x - q.x) / d; ny = (post.y - q.y) / d; }
      }
      if (nx || ny) {
        // Bounced: off the way it came, mirrored about the surface.
        const vn = dx * nx + dy * ny, rx = dx - 2 * vn * nx, ry = dy - 2 * vn * ny;
        return { to: p, on: { x: p.x + rx * 60, y: p.y + ry * 60 } };
      }
      p = q;
    }
    return { to: p, on: null };
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const dim = this.overAt ? 0.5 : 1;
    for (const p of this.posts) { dot(ctx, p, BANK_POST, K500, 0.9 * dim); ring(ctx, p, BANK_POST, K300, 3, 0.9 * dim); }
    ctx.save();
    ctx.fillStyle = RED;
    ctx.globalAlpha = 0.9 * dim;
    for (const k of this.blocks) {
      ctx.beginPath();
      ctx.roundRect(k.x - k.w, k.y - k.h, 2 * k.w, 2 * k.h, Math.min(k.w, k.h));
      ctx.fill();
    }
    ctx.restore();
    for (const r of this.rings) if (!r.got) ring(ctx, r, BANK_RING, GREEN, 3, 0.95 * dim);
    if (this.from && this.pull && this.state === 'ready') {
      const dx = this.from.x - this.pull.x, dy = this.from.y - this.pull.y, d = Math.hypot(dx, dy);
      if (d >= 12) {
        const { to, on } = this.aim(s, dx / d, dy / d), b = this.b, l = dist(b, to);
        for (let t = 14; t < l; t += 13) dot(ctx, { x: b.x + ((to.x - b.x) * t) / l, y: b.y + ((to.y - b.y) * t) / l }, 2.4, WHITE, 0.75);
        if (on) for (let t = 13; t <= 60; t += 13) dot(ctx, { x: to.x + ((on.x - to.x) * t) / 60, y: to.y + ((on.y - to.y) * t) / 60 }, 2.2, WHITE, 0.6 - t * 0.006);
        else dot(ctx, to, 3.5, RED, 0.85);
      }
    }
    // Shots left, small dots across the top.
    for (let i = 0; i < this.shots; i++) dot(ctx, { x: s.m.x + (i - (this.shots - 1) / 2) * 11, y: s.m.y - s.hh + 22 }, 3.5, WHITE, 0.8);
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt || this.state !== 'ready') return;
    this.from = p;
    this.pull = p;
  }

  move(_s: Stage, p: Pt): void { if (this.from) this.pull = p; }

  up(): void {
    if (!this.from || !this.pull) return;
    const dx = this.from.x - this.pull.x, dy = this.from.y - this.pull.y, d = Math.hypot(dx, dy);
    this.from = this.pull = null;
    if (d < 12 || this.state !== 'ready' || this.overAt) return;
    const v = Math.min(0.95, d * 0.009);
    this.b.vx = (dx / d) * v;
    this.b.vy = (dy / d) * v;
    this.state = 'fly';
    this.flyAt = performance.now();
    this.shots--;
    tickSound(2);
  }

  resize(s: Stage): void {
    // A fresh layout for the new size, at the same level.
    if (this.overAt) return;
    this.layout(s);
  }
}
