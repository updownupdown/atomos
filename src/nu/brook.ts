// Three more of Nu's park games (park.ts), on the same kit:
//   Fuse   Nu carries atoms along the top; drag to place one and let go to drop it. They pile
//          up, and two of a kind that touch fuse into the next size. Keep the pile under the line.
//   Gate   Nu glides down through pairs of posts. Drag to steer through the green gate; a missed
//          gate or a red dot costs one of three lives. Faster as it goes.
//   Tune   a grey wave rolls in from the right. Drag up and down to set Nu's own wave (and later
//          left and right for its height) to match it as it passes: both turn green.

import {
  GREEN, K300, K500, K800, NOTE_COLOURS, RED, TAU, WHITE,
  best, bounceIn, buzz, captureSound, clamp, completeSound, dist, dot, finish, missSound, ring, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';
import { bar, lives } from './lawn';

// ---- Fuse ------------------------------------------------------------------------------------

/** The biggest rank; two of these fuse into nothing, for a bonus. */
const FUSE_TOP = 8;
/** Gravity (px/ms², times the size scale), the physics' substep (ms), and how long the pile may
 *  stay over the line before the run is over (ms). */
const FUSE_G = 0.0016;
const FUSE_SUB = 4;
const FUSE_OVER = 1500;
/** The wait after a drop before Nu has the next atom (ms). */
const FUSE_COOL = 450;

type Atom = Mover & { rank: number; r: number; born: number; drop: number };

/** Suika, Nu's way. Nu carries an atom along the top of the arena; press and drag to move it,
 *  let go to drop it. The atoms fall and pile up in the arena, rolling and settling. Two of the
 *  same size (and colour) that touch fuse into one of the next size up, and that's the count. A
 *  small preview in the corner shows the atom after this one. If the pile stays above the dashed
 *  line near the top for a second and a half, the run is over. Later drops can be a size bigger. */
export class Fuse implements Toy {
  private atoms: Atom[] = [];
  private held: number | null = 0;
  private after = 0;
  private aimX = 0;
  private dropping = false;
  private readyAt = 0;
  private danger = 0;
  private count = 0;
  private overAt = 0;
  private sz = 1;

  private size(rank: number): number { return 17 * this.sz * (1 + 0.5 * rank); }
  private top(s: Stage): number { return s.m.y - s.hh; }
  private holdY(s: Stage): number { return this.top(s) + 26; }
  private lineY(s: Stage): number { return this.top(s) + Math.max(130 * this.sz, 0.3 * 2 * s.hh); }
  private heldY(s: Stage): number { return this.holdY(s) + s.nu.r + 3 + this.size(this.held ?? 0); }

  /** A new atom to drop: small ones mostly, a size bigger now and then later on. */
  private pick(): number {
    const most = Math.min(4, 3 + Math.floor(this.count / 25));
    return Math.floor(Math.pow(Math.random(), 1.2) * (most + 1));
  }

  enter(s: Stage): void {
    s.rim = null;
    this.sz = clamp(Math.min(s.hw / 180, Math.sqrt(s.hw * s.hh) / 250), 0.6, 1.6);
    this.atoms = [];
    this.held = this.pick();
    this.after = this.pick();
    this.aimX = s.m.x;
    this.dropping = false;
    this.readyAt = 0;
    this.danger = 0;
    this.count = 0;
    this.overAt = 0;
    s.nu.r = 9;
    s.nu.at({ x: s.m.x, y: this.holdY(s) });
    s.score(0, best(s, 'fuse') || null);
  }

  /** Where the held atom can go across. */
  private clampX(s: Stage, x: number): number {
    const r = this.size(this.held ?? this.after) + 4;
    return clamp(x, s.m.x - s.hw + r, s.m.x + s.hw - r);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (!this.overAt) {
      if (this.held === null && now >= this.readyAt) { this.held = this.after; this.after = this.pick(); }
      this.aimX = this.clampX(s, this.aimX);
      nu.seek({ x: this.aimX, y: this.holdY(s) }, dt, 1.4 * this.sz, 0.03);
      nu.y = this.holdY(s);
      if (this.dropping && this.held !== null && Math.abs(nu.x - this.aimX) < 4) this.drop(s, now);
    } else nu.seek(nu, dt);
    for (let left = Math.min(dt, 50); left > 0; left -= FUSE_SUB) this.physics(s, Math.min(FUSE_SUB, left));
    this.fuse(s, now);
    if (this.overAt) return;
    // The pile over the line: settled atoms whose tops are above it.
    const line = this.lineY(s);
    const over = this.atoms.some((a) => now - a.drop > 1000 && a.y - a.r < line);
    this.danger = over ? this.danger + dt : Math.max(0, this.danger - dt * 2);
    if (this.danger >= FUSE_OVER) {
      this.overAt = now;
      this.held = null;
      for (const a of this.atoms) if (a.y - a.r < line) s.fx.ring(a, RED, a.r, a.r + 24, 700);
      missSound();
      buzz(24);
      finish(s, 'fuse', this.count);
      s.score(this.count, best(s, 'fuse') || null);
    }
  }

  private drop(s: Stage, now: number): void {
    const rank = this.held ?? 0;
    this.atoms.push({ x: s.nu.x, y: this.heldY(s), vx: 0, vy: 0.05, rank, r: this.size(rank), born: now, drop: now });
    this.held = null;
    this.dropping = false;
    this.readyAt = now + FUSE_COOL;
    tickSound(1);
  }

  /** One small step of the pile: gravity, then the atoms pushed apart and kept in the arena. */
  private physics(s: Stage, h: number): void {
    const g = FUSE_G * this.sz, as = this.atoms, damp = Math.exp(-h / 2500);
    for (const a of as) {
      a.vy = Math.min(1.2 * this.sz, a.vy + g * h);
      a.vx *= damp;
      a.vy *= damp;
      a.x += a.vx * h;
      a.y += a.vy * h;
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < as.length; i++) {
        for (let j = i + 1; j < as.length; j++) {
          const a = as[i], b = as[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r;
          if (d >= min) continue;
          const nx = dx / d, ny = dy / d, ma = a.r * a.r, mb = b.r * b.r, over = (min - d) * 0.8;
          a.x -= nx * over * (mb / (ma + mb));
          a.y -= ny * over * (mb / (ma + mb));
          b.x += nx * over * (ma / (ma + mb));
          b.y += ny * over * (ma / (ma + mb));
          if (it) continue;
          // Their velocities: a soft knock along the line between them, a little rub across it.
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const j2 = (-(1.1) * rel) / (1 / ma + 1 / mb);
            a.vx -= (nx * j2) / ma; a.vy -= (ny * j2) / ma;
            b.vx += (nx * j2) / mb; b.vy += (ny * j2) / mb;
          }
          const tx = -ny, ty = nx, slide = ((b.vx - a.vx) * tx + (b.vy - a.vy) * ty) * 0.05;
          a.vx += tx * slide * (mb / (ma + mb)); a.vy += ty * slide * (mb / (ma + mb));
          b.vx -= tx * slide * (ma / (ma + mb)); b.vy -= ty * slide * (ma / (ma + mb));
        }
      }
      for (const a of as) if (bounceIn(s, a, a.r, 0.1)) { a.vx *= 0.97; }
    }
    // Slow ones settle, so the pile rests still.
    for (const a of as) if (Math.hypot(a.vx, a.vy) < 0.02 * this.sz) { a.vx *= 0.85; a.vy *= 0.85; }
  }

  /** Two of a kind that touch fuse into one a size up (two of the biggest, into nothing). */
  private fuse(s: Stage, now: number): void {
    const as = this.atoms;
    for (let i = 0; i < as.length; i++) {
      for (let j = i + 1; j < as.length; j++) {
        const a = as[i], b = as[j];
        if (a.rank !== b.rank || dist(a, b) > a.r + b.r + 1) continue;
        const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        as.splice(j, 1);
        as.splice(i, 1);
        this.count++;
        if (a.rank >= FUSE_TOP) {
          completeSound();
          s.fx.ring(p, WHITE, a.r, a.r * 2.4, 900);
          s.fx.burst(p, 16, NOTE_COLOURS[a.rank % 5], 0.2);
        } else {
          const rank = a.rank + 1;
          as.push({ ...p, vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2 - 0.05, rank, r: this.size(rank), born: now, drop: Math.min(a.drop, b.drop) });
          captureSound();
          s.fx.burst(p, 8, NOTE_COLOURS[rank % 5], 0.12);
          s.fx.ring(p, NOTE_COLOURS[rank % 5], this.size(rank) * 0.6, this.size(rank) + 18, 500);
        }
        s.score(this.count, best(s, 'fuse') || null);
        // One fusion at a time; the next is caught on the next frame.
        return;
      }
    }
  }

  private drawAtom(ctx: CanvasRenderingContext2D, p: Pt, rank: number, r: number, alpha = 0.92): void {
    dot(ctx, p, r, NOTE_COLOURS[rank % 5], alpha);
    // The second round of colours wears a white ring, to tell it from the first.
    if (rank >= 5) ring(ctx, p, r * 0.55, WHITE, 2, 0.55 * alpha);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const nu = s.nu, line = this.lineY(s), x0 = s.m.x - s.hw + 10, x1 = s.m.x + s.hw - 10;
    // The line: grey, turning red and pulsing as the pile stays over it.
    const d = this.danger / FUSE_OVER;
    ctx.save();
    ctx.setLineDash([10, 9]);
    bar(ctx, x0, line, x1, line, d > 0 ? RED : K500, 2, d > 0 ? 0.5 + 0.5 * d * (0.6 + 0.4 * Math.sin(now / 70)) : 0.8);
    ctx.restore();
    // Where the held atom will fall.
    if (this.held !== null && !this.overAt) bar(ctx, nu.x, this.heldY(s) + this.size(this.held), nu.x, s.m.y + s.hh - 6, K800, 2, 0.9);
    for (const a of this.atoms) {
      const grow = clamp((now - a.born) / 180, 0, 1);
      this.drawAtom(ctx, a, a.rank, a.r * (0.75 + 0.25 * grow));
    }
    // The atom Nu carries, and the one after it in the corner.
    if (this.held !== null && !this.overAt) this.drawAtom(ctx, { x: nu.x, y: this.heldY(s) }, this.held, this.size(this.held));
    const pv = { x: s.m.x + s.hw - 26 - s.rr * 0.3, y: this.holdY(s) + s.rr * 0.1 };
    if (!this.overAt) {
      ring(ctx, pv, 15, K500, 2, 0.7);
      this.drawAtom(ctx, pv, this.after, Math.min(10, this.size(this.after) * 0.45), 0.85);
    }
    nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.aimX = this.clampX(s, p.x);
  }

  move(s: Stage, p: Pt): void { if (!this.overAt) this.aimX = this.clampX(s, p.x); }
  up(): void { if (!this.overAt && this.held !== null) this.dropping = true; }

  resize(s: Stage): void {
    s.nu.y = this.holdY(s);
    this.aimX = this.clampX(s, this.aimX);
    for (const a of this.atoms) bounceIn(s, a, a.r, 0);
  }
}

// ---- Gate ------------------------------------------------------------------------------------

/** The scroll speed at the start and at most (px/ms, times the height scale), and how long that
 *  takes to grow (ms). */
const GATE_V0 = 0.13;
const GATE_V1 = 0.27;
const GATE_RAMP = 55000;
/** The room between gates (px, times the height scale). */
const GATE_GAP = 180;

/** A gate: its place down the course (world px), its middle and width, and whether it's ahead,
 *  passed or missed. */
type Pair = { y: number; cx: number; w: number; state: 'ahead' | 'passed' | 'missed' };
type Mine = { x: number; y: number; vx: number; r: number; hit: boolean };

/** Slalom, Nu's way. Nu glides down the arena while the course rolls up past it. Each gate is two
 *  posts; the next one to pass is green. Drag left and right to steer (Nu follows a little behind,
 *  and swings on a touch past where it's sent). Through a gate scores; past it outside the posts
 *  costs one of three lives, and so does a red dot. The gates swing wider from side to side and
 *  narrow, red dots come in between and later drift, and the course speeds up. */
export class Gate implements Toy {
  private pairs: Pair[] = [];
  private mines: Mine[] = [];
  private cam = 0;
  private t = 0;
  private x = 0;
  private vx = 0;
  private tx = 0;
  private grab: number | null = null;
  private side = 1;
  private left = 3;
  private safeUntil = 0;
  private count = 0;
  private overAt = 0;
  private u(s: Stage): number { return s.hh / 320; }
  private sz(s: Stage): number { return clamp(Math.min(s.hw, s.hh) / 180, 0.6, 1.5); }
  private top(s: Stage): number { return s.m.y - s.hh; }
  /** Nu's height on the screen. */
  private nuY(s: Stage): number { return this.top(s) + 2 * s.hh * 0.3; }

  enter(s: Stage): void {
    s.rim = null;
    s.nu.r = 9;
    this.pairs = [];
    this.mines = [];
    this.cam = 0;
    this.t = 0;
    this.x = this.tx = s.m.x;
    this.vx = 0;
    this.grab = null;
    this.side = Math.random() < 0.5 ? 1 : -1;
    this.left = 3;
    this.safeUntil = 0;
    this.count = 0;
    this.overAt = 0;
    s.nu.at({ x: this.x, y: this.nuY(s) });
    this.grow(s);
    s.score(0, best(s, 'gate') || null);
  }

  /** More gates below, as far as the arena shows and a bit. */
  private grow(s: Stage): void {
    const u = this.u(s), sz = this.sz(s), far = this.cam + 2 * s.hh + 80;
    let last = this.pairs.length ? this.pairs[this.pairs.length - 1].y : this.cam + 2 * s.hh * 0.75;
    while (last < far) {
      const n = this.count + this.pairs.filter((p) => p.state === 'ahead').length;
      const prev = this.pairs[this.pairs.length - 1];
      const y = last + GATE_GAP * u;
      const w = s.hw * Math.max(0.3, 0.62 - n * 0.007);
      const reach = s.hw - w / 2 - 14 * sz;
      const off = reach * Math.min(0.95, 0.25 + n * 0.02 + Math.random() * 0.3);
      this.side = -this.side;
      const cx = s.m.x + this.side * Math.max(0, off);
      // A red dot between this gate and the last, from the fourth gate on; later they drift.
      if (prev && n >= 3 && Math.random() < Math.min(0.75, 0.35 + n * 0.01)) {
        const r = 7 * sz, mx = (prev.cx + cx) / 2 + (Math.random() - 0.5) * s.hw * 0.5;
        const vx = n >= 12 ? (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.04) * sz : 0;
        this.mines.push({ x: clamp(mx, s.m.x - s.hw + r + 10, s.m.x + s.hw - r - 10), y: (prev.y + y) / 2, vx, r, hit: false });
      }
      this.pairs.push({ y, cx, w, state: 'ahead' });
      last = y;
    }
    const gone = this.cam - 60;
    this.pairs = this.pairs.filter((p) => p.y > gone);
    this.mines = this.mines.filter((m) => m.y > gone);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, u = this.u(s);
    if (this.overAt) {
      // The course coasts to a stop.
      this.cam += GATE_V0 * u * dt * Math.max(0, 1 - (now - this.overAt) / 900);
      nu.seek(nu, dt);
      return;
    }
    this.t += dt;
    const v = (GATE_V0 + (GATE_V1 - GATE_V0) * Math.min(1, this.t / GATE_RAMP)) * u;
    this.cam += v * dt;
    // Nu swings toward where it's sent, a little behind, with a touch of overshoot.
    const w = 0.011, damp = 2 * 0.62 * w;
    for (let left = dt; left > 0; left -= 8) {
      const h = Math.min(8, left);
      this.vx += (w * w * (this.tx - this.x) - damp * this.vx) * h;
      this.x += this.vx * h;
    }
    const lo = s.m.x - s.hw + nu.r + 4, hi = s.m.x + s.hw - nu.r - 4;
    if (this.x < lo || this.x > hi) { this.x = clamp(this.x, lo, hi); this.vx = 0; }
    nu.x = this.x;
    nu.y = this.nuY(s);
    const at = this.cam + (this.nuY(s) - this.top(s));
    for (const m of this.mines) {
      m.x += m.vx * dt;
      if (Math.abs(m.x - s.m.x) > s.hw - m.r - 10) m.vx = -m.vx;
    }
    // Gates as Nu crosses them.
    for (const p of this.pairs) {
      if (p.state !== 'ahead' || p.y > at) continue;
      const py = p.y - this.cam + this.top(s);
      if (Math.abs(this.x - p.cx) <= p.w / 2 - 3) {
        p.state = 'passed';
        this.count++;
        captureSound();
        s.fx.ring(nu, GREEN, nu.r, nu.r + 26, 500);
        s.score(this.count, best(s, 'gate') || null);
      } else {
        p.state = 'missed';
        s.fx.ring({ x: p.cx - p.w / 2, y: py }, RED, 6, 26, 500);
        s.fx.ring({ x: p.cx + p.w / 2, y: py }, RED, 6, 26, 500);
        this.hurt(s, now);
        if (this.overAt) return;
      }
    }
    // Red dots.
    if (now >= this.safeUntil) {
      for (const m of this.mines) {
        if (m.hit) continue;
        const p = { x: m.x, y: m.y - this.cam + this.top(s) };
        if (dist(p, nu) > nu.r + m.r) continue;
        m.hit = true;
        s.fx.burst(p, 8, RED, 0.12);
        this.hurt(s, now);
        if (this.overAt) return;
        break;
      }
    }
    this.grow(s);
  }

  private hurt(s: Stage, now: number): void {
    this.left--;
    this.safeUntil = now + 1200;
    missSound();
    buzz(20);
    if (this.left > 0) return;
    this.overAt = now;
    this.grab = null;
    s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 34, 700);
    finish(s, 'gate', this.count);
    s.score(this.count, best(s, 'gate') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const nu = s.nu, sz = this.sz(s), Y = (y: number): number => y - this.cam + this.top(s);
    const next = this.pairs.find((p) => p.state === 'ahead');
    for (const m of this.mines) if (!m.hit) dot(ctx, { x: m.x, y: Y(m.y) }, m.r, RED, 0.95);
    for (const p of this.pairs) {
      const y = Y(p.y), a = { x: p.cx - p.w / 2, y }, b = { x: p.cx + p.w / 2, y };
      if (y < this.top(s) - 20 || y > s.m.y + s.hh + 20) continue;
      const c = p === next && !this.overAt ? GREEN : p.state === 'passed' ? WHITE : p.state === 'missed' ? RED : K300;
      const alpha = p.state === 'passed' ? 0.35 : 0.95;
      if (p === next && !this.overAt) bar(ctx, a.x, y, b.x, y, GREEN, 2, 0.22);
      dot(ctx, a, 6 * sz, c, alpha);
      dot(ctx, b, 6 * sz, c, alpha);
    }
    // Hit a moment ago: Nu blinks.
    nu.hidden = !this.overAt && now < this.safeUntil && Math.floor(now / 110) % 2 === 0;
    nu.draw(ctx, now);
    nu.hidden = false;
    lives(s, ctx, this.left);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.grab = this.tx - p.x;
  }

  move(s: Stage, p: Pt): void {
    if (this.grab === null) return;
    this.tx = clamp(p.x + this.grab, s.m.x - s.hw, s.m.x + s.hw);
  }

  up(): void { this.grab = null; }

  resize(s: Stage): void {
    this.x = clamp(this.x, s.m.x - s.hw + 14, s.m.x + s.hw - 14);
    this.tx = clamp(this.tx, s.m.x - s.hw, s.m.x + s.hw);
    for (const p of this.pairs) p.cx = clamp(p.cx, s.m.x - s.hw + p.w / 2, s.m.x + s.hw - p.w / 2);
    this.grow(s);
  }
}

// ---- Tune ------------------------------------------------------------------------------------

/** The waves' frequencies, in whole waves across the arena: Nu's range and the targets'. */
const TUNE_LO = 1.2;
const TUNE_HI = 8;
const TUNE_T_LO = 1.4;
const TUNE_T_HI = 7;
/** How long a target lasts at the start and at its shortest (ms). */
const TUNE_LONG = 4400;
const TUNE_SHORT = 2300;
/** The count from which the target's height changes too. */
const TUNE_AMP_AT = 6;
/** The share of a target's passing that must match to score. */
const TUNE_GOAL = 0.5;

/** A stretch of the target wave: where it starts (world px), how long it is, its frequency and
 *  height, its phase at the start, and how long it matched as it passed Nu. */
type Seg = { u0: number; len: number; c: number; a: number; ph0: number; on: number; all: number };

/** Resonance. A flat grey wave rolls in from the right, a stretch at a time, each with its own
 *  frequency. Nu rides its own wave, leaving its trace to the left. Drag up to quicken Nu's wave
 *  and down to slow it; when it matches the stretch going past, both turn green. Match a stretch
 *  for half its passing and it scores; less and one of three lives empties. Later the waves'
 *  heights differ too, set by dragging left and right; the stretches come quicker and the match
 *  must be closer. */
export class Tune implements Toy {
  private segs: Seg[] = [];
  private trail: { u: number; y: number }[] = [];
  private scroll = 0;
  private c = 3;
  private a = 0;
  private ph = 0;
  private grab: { x: number; y: number; c: number; a: number } | null = null;
  private started = false;
  private matched = false;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private W(s: Stage): number { return 2 * s.hw; }
  private X0(s: Stage): number { return s.m.x - s.hw * 0.3; }
  private amax(s: Stage): number { return s.hh * 0.36; }
  /** The scroll speed (px/ms). */
  private v(s: Stage): number { return this.W(s) / 5200; }
  private ampOn(): boolean { return this.count >= TUNE_AMP_AT; }
  /** How close a match must be: in frequency (as a log ratio) and in height (as a share). */
  private tolF(): number { return Math.max(0.08, 0.16 - this.count * 0.004); }
  private tolA(): number { return Math.max(0.14, 0.24 - (this.count - TUNE_AMP_AT) * 0.005); }

  enter(s: Stage): void {
    s.rim = null;
    s.nu.r = 9;
    this.segs = [];
    this.trail = [];
    this.scroll = 0;
    this.c = 3;
    this.a = this.amax(s) * 0.65;
    this.ph = 0;
    this.grab = null;
    this.started = false;
    this.matched = false;
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    // The first stretch matches Nu as it is, to show what green means.
    this.segs.push({ u0: -(s.m.x + s.hw - this.X0(s)), len: this.W(s) * 0.8, c: this.c, a: this.a, ph0: 0, on: 0, all: 0 });
    this.grow(s);
    this.place(s);
    s.score(0, best(s, 'tune') || null);
  }

  /** More target ahead, as far as the arena shows. */
  private grow(s: Stage): void {
    const ahead = this.scroll + (s.m.x + s.hw - this.X0(s)) + 40;
    let last = this.segs[this.segs.length - 1];
    while (last.u0 + last.len < ahead) {
      const n = this.count + this.segs.filter((g) => g.u0 > this.scroll).length;
      let c = last.c;
      for (let i = 0; i < 20 && Math.abs(Math.log(c / last.c)) < 0.3; i++) {
        c = Math.exp(Math.log(TUNE_T_LO) + Math.random() * Math.log(TUNE_T_HI / TUNE_T_LO));
      }
      const a = n >= TUNE_AMP_AT ? this.amax(s) * (0.3 + Math.random() * 0.7) : this.amax(s) * 0.65;
      const ms = Math.max(TUNE_SHORT, TUNE_LONG - n * 100);
      const seg = { u0: last.u0 + last.len, len: this.v(s) * ms, c, a, ph0: last.ph0 + TAU * (last.c / this.W(s)) * last.len, on: 0, all: 0 };
      this.segs.push(seg);
      last = seg;
    }
  }

  /** The target's height at world place `u` (up is +), easing from one stretch's height to the next. */
  private target(s: Stage, u: number): number {
    const i = this.segs.findIndex((g) => u >= g.u0 && u < g.u0 + g.len);
    const g = this.segs[i < 0 ? (u < this.segs[0].u0 ? 0 : this.segs.length - 1) : i];
    const prev = i > 0 ? this.segs[i - 1] : g;
    const e = clamp((u - g.u0) / 30, 0, 1), a = prev.a + (g.a - prev.a) * e * e * (3 - 2 * e);
    return a * Math.sin(g.ph0 + TAU * (g.c / this.W(s)) * (u - g.u0));
  }

  private place(s: Stage): void {
    s.nu.x = this.X0(s);
    s.nu.y = s.m.y - this.a * Math.sin(this.ph);
  }

  step(s: Stage, dt: number, now: number): void {
    if (this.overAt) return;
    const v = this.v(s);
    this.scroll += v * dt;
    this.ph += TAU * (this.c / this.W(s)) * v * dt;
    this.place(s);
    this.trail.push({ u: this.scroll, y: s.nu.y });
    const keep = this.scroll - (this.X0(s) - (s.m.x - s.hw)) - 10;
    while (this.trail.length > 2 && this.trail[0].u < keep) this.trail.shift();
    // The stretch going past Nu, and whether Nu's wave matches it.
    const g = this.segs.find((q) => this.scroll >= q.u0 && this.scroll < q.u0 + q.len);
    const ok = !!g && Math.abs(Math.log(this.c / g.c)) < this.tolF() && (!this.ampOn() || Math.abs(this.a - g.a) / g.a < this.tolA());
    if (ok && !this.matched && this.started) tickSound(2);
    this.matched = ok;
    if (g && this.started) { g.all += dt; if (ok) g.on += dt; }
    // Stretches that have gone by: scored, or a life.
    while (this.segs.length > 1 && this.segs[0].u0 + this.segs[0].len <= this.scroll) {
      const d = this.segs.shift() as Seg;
      if (!this.started || d.all < 300) continue;
      if (d.on / d.all >= TUNE_GOAL) {
        this.count++;
        captureSound();
        s.fx.ring(s.nu, GREEN, s.nu.r, s.nu.r + 30, 500);
        if (this.count === TUNE_AMP_AT) completeSound();
        s.score(this.count, best(s, 'tune') || null);
      } else {
        this.left--;
        missSound();
        buzz(20);
        s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 30, 600);
        if (this.left <= 0) {
          this.overAt = now;
          this.grab = null;
          finish(s, 'tune', this.count);
          s.score(this.count, best(s, 'tune') || null);
          return;
        }
      }
    }
    this.grow(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const X0 = this.X0(s), x1 = s.m.x + s.hw + 4, cy = s.m.y, live = this.matched && this.started && !this.overAt;
    bar(ctx, X0, s.m.y - s.hh + 40, X0, s.m.y + s.hh - 16, K800, 2, 0.9);
    // The target: grey, and green along the stretch going past while it matches.
    const g = this.segs.find((q) => this.scroll >= q.u0 && this.scroll < q.u0 + q.len);
    const split = g && live ? X0 + (g.u0 + g.len - this.scroll) : X0;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [from, to, c] of [[X0, split, GREEN], [split, x1, K300]] as [number, number, string][]) {
      if (to <= from) continue;
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let x = from; x <= to + 3; x += 3) {
        const px = Math.min(x, to), y = cy - this.target(s, this.scroll + (px - X0));
        if (x === from) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
    // Where one stretch gives way to the next: a small mark on the line.
    for (const q of this.segs) {
      const x = X0 + (q.u0 - this.scroll);
      if (x > X0 + 4 && x < x1) dot(ctx, { x, y: cy - this.target(s, q.u0) }, 3.5, K300, 0.9);
    }
    // Nu's trace, to the left.
    ctx.strokeStyle = live ? GREEN : WHITE;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    this.trail.forEach((h, i) => {
      const x = X0 - (this.scroll - h.u);
      if (i === 0) ctx.moveTo(x, h.y); else ctx.lineTo(x, h.y);
    });
    ctx.stroke();
    ctx.restore();
    // Nu's dials: its frequency up the left side, and later its height along the bottom.
    const lx = s.m.x - s.hw + 18, ty0 = s.m.y + s.hh - 40, ty1 = s.m.y - s.hh + 50;
    bar(ctx, lx, ty0, lx, ty1, K500, 2, 0.7);
    const f = Math.log(this.c / TUNE_LO) / Math.log(TUNE_HI / TUNE_LO);
    dot(ctx, { x: lx, y: ty0 + (ty1 - ty0) * f }, 5, WHITE, 0.9);
    if (this.ampOn()) {
      const by = s.m.y + s.hh - 18, bx0 = s.m.x - s.hw * 0.5, bx1 = s.m.x + s.hw * 0.5;
      bar(ctx, bx0, by, bx1, by, K500, 2, 0.7);
      const af = (this.a - this.amax(s) * 0.2) / (this.amax(s) * 0.8);
      dot(ctx, { x: bx0 + (bx1 - bx0) * af, y: by }, 5, WHITE, 0.9);
    }
    s.nu.draw(ctx, now);
    lives(s, ctx, this.left);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.started = true;
    this.grab = { x: p.x, y: p.y, c: this.c, a: this.a };
  }

  move(s: Stage, p: Pt): void {
    const g = this.grab;
    if (!g) return;
    this.c = clamp(g.c * Math.exp(-(p.y - g.y) / (s.hh * 0.55)), TUNE_LO, TUNE_HI);
    if (this.ampOn()) this.a = clamp(g.a + (p.x - g.x) * (this.amax(s) / (s.hw * 0.9)), this.amax(s) * 0.2, this.amax(s));
  }

  up(): void { this.grab = null; }

  resize(s: Stage): void {
    this.a = clamp(this.a, this.amax(s) * 0.2, this.amax(s));
    this.trail = [];
    this.place(s);
    if (!this.overAt) this.grow(s);
  }
}
