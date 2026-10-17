// Three more of Nu's park games (park.ts), on the same kit:
//   Fuse   Nu carries atoms along the top; drag to place one and let go to drop it. They pile
//          up, and two of a kind that touch fuse into the next size. Keep the pile under the line.
//   Gate   Nu glides down through pairs of posts. Drag to steer through the green gate; a missed
//          gate or a red dot costs one of three lives. The course comes in sections of its own pace.
//   Tune   a grey wave rolls in from the right. Two sliders along the bottom set Nu's own dashed
//          wave, its frequency and its phase, to lie on it as it passes: both turn green.

import {
  CYAN, GREEN, K300, K500, K800, NOTE_COLOURS, RED, TAU, WHITE,
  best, bounceIn, buzz, captureSound, chimeSound, clamp, completeSound, dist, dot, finish, missSound, ring, tickSound,
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
 *  takes to grow (ms). A section's pace multiplies it, up to GATE_TOP of the most. */
const GATE_V0 = 0.13;
const GATE_V1 = 0.27;
const GATE_RAMP = 55000;
const GATE_TOP = 1.1;
/** The room between gates (px, times the height scale). */
const GATE_GAP = 180;

/** The course comes in sections a few gates long, each with its own pace: calm stretches, rushes
 *  of close gates, wide swings from side to side and tight slaloms through narrow gates. Each
 *  sets the room between gates, their width, how far they swing, the speed and the red dots. */
type Kind = 'calm' | 'rush' | 'wide' | 'tight';
const GATE_KINDS: Record<Kind, { gap: number; w: number; off: number; v: number; mines: number; c: string; n: [number, number] }> = {
  calm: { gap: 1.3, w: 1.2, off: 0.45, v: 0.8, mines: 0, c: NOTE_COLOURS[0], n: [3, 5] },
  rush: { gap: 0.72, w: 1.1, off: 0.45, v: 1.35, mines: 0.35, c: CYAN, n: [5, 8] },
  wide: { gap: 1.25, w: 1.15, off: 1.6, v: 1.05, mines: 0.6, c: NOTE_COLOURS[3], n: [4, 6] },
  tight: { gap: 0.95, w: 0.7, off: 0.55, v: 0.85, mines: 1.2, c: NOTE_COLOURS[2], n: [4, 6] },
};

/** A gate: its place down the course (world px), its middle and width, whether it's ahead,
 *  passed or missed, its section's kind, and whether it starts that section. */
type Pair = { y: number; cx: number; w: number; state: 'ahead' | 'passed' | 'missed'; kind: Kind; first: boolean };
type Mine = { x: number; y: number; vx: number; r: number; hit: boolean };

/** Slalom, Nu's way. Nu glides down the arena while the course rolls up past it. Each gate is two
 *  posts; the next one to pass is green. Drag left and right to steer (Nu follows a little behind,
 *  and swings on a touch past where it's sent). Through a gate scores; past it outside the posts
 *  costs one of three lives, and so does a red dot. The course comes in sections, each with its
 *  own pace and its own colour on the posts, a row of small dots across the start of each: calm
 *  wide gates, rushes of quick close ones, wide swings and tight slaloms between red dots. The
 *  gates come on one side or the other in runs of one to three, near the middle or far out. The
 *  gates narrow and the course speeds up as it goes. */
export class Gate implements Toy {
  private pairs: Pair[] = [];
  private mines: Mine[] = [];
  private cam = 0;
  private t = 0;
  private x = 0;
  private vx = 0;
  private tx = 0;
  private pace = GATE_KINDS.calm.v;
  private grab: number | null = null;
  private side = 1;
  /** Gates still to come on this side before the course swings over, and how far out the last
   *  one was (a share of the room it had). */
  private stay = 0;
  private lastOff = 0;
  private kind: Kind = 'calm';
  private run = 0;
  private sections = 0;
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
    this.pace = GATE_KINDS.calm.v;
    this.grab = null;
    this.side = Math.random() < 0.5 ? 1 : -1;
    this.stay = 0;
    this.lastOff = 0;
    // The first section is a calm one, four gates long.
    this.kind = 'calm';
    this.run = 4;
    this.sections = 0;
    this.left = 3;
    this.safeUntil = 0;
    this.count = 0;
    this.overAt = 0;
    s.nu.at({ x: this.x, y: this.nuY(s) });
    this.grow(s);
    s.score(0, best(s, 'gate') || null);
  }

  /** The next section: never the same kind twice running; rushes and slaloms after a few gates. */
  private nextKind(n: number): void {
    const all: Kind[] = n < 6 ? ['calm', 'wide'] : ['calm', 'rush', 'wide', 'tight'];
    const pick = all.filter((k) => k !== this.kind);
    this.kind = pick[Math.floor(Math.random() * pick.length)];
    const [lo, hi] = GATE_KINDS[this.kind].n;
    this.run = lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /** More gates below, as far as the arena shows and a bit. */
  private grow(s: Stage): void {
    const u = this.u(s), sz = this.sz(s), far = this.cam + 2 * s.hh + 80;
    let last = this.pairs.length ? this.pairs[this.pairs.length - 1].y : this.cam + 2 * s.hh * 0.75;
    while (last < far) {
      const n = this.count + this.pairs.filter((p) => p.state === 'ahead').length;
      const prev = this.pairs[this.pairs.length - 1];
      let first = false;
      if (this.run <= 0) { this.nextKind(n); first = true; }
      this.run--;
      const k = GATE_KINDS[this.kind];
      // The gap before a gate is set by its own section, so a rush starts close.
      const y = last + GATE_GAP * u * k.gap;
      const w = Math.min(s.hw * 0.8, s.hw * Math.max(0.3, 0.62 - n * 0.007) * k.w);
      const reach = s.hw - w / 2 - 14 * sz;
      // The sides come in runs of one to three, so the course can't be read as left, right, left.
      // A gate on the same side as the last is far in where that one was far out (and the other
      // way round), so it still takes a swing; wide swings always cross over.
      const same = this.stay > 0 && this.kind !== 'wide';
      let f = Math.min(0.95, (0.18 + Math.min(0.4, n * 0.02) + Math.random() * 0.45) * k.off);
      if (same) {
        const step = 0.4 + Math.random() * 0.3;
        f = this.lastOff + step <= 0.95 && (this.lastOff < 0.45 || this.lastOff - step < 0) ? this.lastOff + step : Math.max(0, this.lastOff - step);
        this.stay--;
      } else {
        this.side = -this.side;
        const roll = Math.random();
        this.stay = roll < 0.55 ? 0 : roll < 0.85 ? 1 : 2;
      }
      this.lastOff = f;
      const cx = s.m.x + this.side * reach * f;
      // A red dot between this gate and the last, from the fourth gate on; later they drift. On
      // the same side, it sits near the straight line between them, so Nu has to weave.
      if (prev && n >= 3 && Math.random() < Math.min(0.9, (0.35 + n * 0.01) * k.mines * (same ? 1.3 : 1))) {
        const r = 7 * sz, mx = (prev.cx + cx) / 2 + (Math.random() - 0.5) * s.hw * (same ? 0.2 : 0.5);
        const vx = n >= 12 ? (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.04) * sz : 0;
        this.mines.push({ x: clamp(mx, s.m.x - s.hw + r + 10, s.m.x + s.hw - r - 10), y: (prev.y + y) / 2, vx, r, hit: false });
      }
      this.pairs.push({ y, cx, w, state: 'ahead', kind: this.kind, first });
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
    // The pace eases toward that of the section of the gate ahead.
    const ahead = this.pairs.find((p) => p.state === 'ahead');
    this.pace += ((ahead ? GATE_KINDS[ahead.kind].v : 1) - this.pace) * (1 - Math.exp(-dt / 700));
    const base = GATE_V0 + (GATE_V1 - GATE_V0) * Math.min(1, this.t / GATE_RAMP);
    const v = Math.min(GATE_V1 * GATE_TOP, base * this.pace) * u;
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
      if (p.first) this.section(s, p);
      if (Math.abs(this.x - p.cx) <= p.w / 2 - 3) {
        p.state = 'passed';
        this.count++;
        captureSound();
        // In a rush, each gate gets an accent too, its pitch from where across Nu went through.
        if (p.kind === 'rush') tickSound(Math.round(4 * clamp((this.x - (s.m.x - s.hw)) / (2 * s.hw), 0, 1)));
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

  /** Nu enters a new section: a wave in its colour, a chime for its kind, and every fourth
   *  section a cadence. */
  private section(s: Stage, p: Pair): void {
    this.sections++;
    const c = GATE_KINDS[p.kind].c;
    s.fx.ring(s.nu, c, s.nu.r + 4, s.hw * 0.7, 900);
    s.fx.burst(s.nu, 10, c, 0.16);
    if (this.sections % 4 === 0) completeSound();
    else chimeSound(['calm', 'wide', 'tight', 'rush'].indexOf(p.kind) + 1);
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
    const nu = s.nu, sz = this.sz(s), u = this.u(s), Y = (y: number): number => y - this.cam + this.top(s);
    const next = this.pairs.find((p) => p.state === 'ahead');
    // The start of each section: a row of small dots across the arena in its colour.
    for (const p of this.pairs) {
      if (!p.first) continue;
      const y = Y(p.y - GATE_GAP * u * GATE_KINDS[p.kind].gap * 0.3);
      if (y < this.top(s) - 10 || y > s.m.y + s.hh + 10) continue;
      const n = Math.max(6, Math.round((2 * s.hw) / 26)), a = p.state === 'ahead' ? 0.75 : 0.3;
      for (let i = 0; i < n; i++) dot(ctx, { x: s.m.x - s.hw + ((i + 0.5) / n) * 2 * s.hw, y }, 2.6, GATE_KINDS[p.kind].c, a);
    }
    for (const m of this.mines) if (!m.hit) dot(ctx, { x: m.x, y: Y(m.y) }, m.r, RED, 0.95);
    for (const p of this.pairs) {
      const y = Y(p.y), a = { x: p.cx - p.w / 2, y }, b = { x: p.cx + p.w / 2, y };
      if (y < this.top(s) - 20 || y > s.m.y + s.hh + 20) continue;
      const c = p === next && !this.overAt ? GREEN : p.state === 'passed' ? WHITE : p.state === 'missed' ? RED : GATE_KINDS[p.kind].c;
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
const TUNE_LONG = 5400;
const TUNE_SHORT = 3000;
/** From this stretch on, a new stretch's wave also jumps along (its phase), more as it goes. */
const TUNE_JUMP_AT = 2;
/** The share of a target's passing that must match to score. */
const TUNE_GOAL = 0.5;
/** How close Nu's wave is, by its colour: matched, near, nearer than far, and far (red). How
 *  near is how many times the match's tolerance it's off by. */
const TUNE_BLUE = '#5f8ae0';
const TUNE_AMBER = '#d98a2b';
const TUNE_NEAR = 2.2;
const TUNE_MID = 4.5;
/** Nu's wave is dashed: a dash and a gap, along the course (px), so the dashes roll with it. */
const TUNE_DASH = 12;
const TUNE_GAP = 9;

/** A stretch of the target wave: where it starts (world px), how long it is, its frequency, its
 *  phase at the start, and how long it matched as it passed Nu. */
type Seg = { u0: number; len: number; c: number; ph0: number; on: number; all: number };

/** An angle brought into -π..π. */
const wrap = (x: number): number => ((((x + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
/** Whether world place `u` falls on a dash of Nu's wave. */
const onDash = (u: number): boolean => ((u % (TUNE_DASH + TUNE_GAP)) + TUNE_DASH + TUNE_GAP) % (TUNE_DASH + TUNE_GAP) < TUNE_DASH;

/** Resonance. A solid grey wave rolls in from the right, a stretch at a time, each with its own
 *  frequency, and later each a little along from where the last left off. Nu rides its own wave,
 *  drawn dashed over the incoming one ahead of it and left behind as a trace. Two sliders along
 *  the bottom set it: the lower its frequency (right to quicken, left to slow), the upper its
 *  phase (sliding the dashed wave along); a drag anywhere above moves both, across and up. When
 *  both are right the dashed wave lies on the solid one. Nu's wave shows how close it is: red far
 *  off, amber, blue near, and green when it matches the stretch going past, which turns green
 *  too. Match a stretch for half its passing and it scores; less and one of three lives empties.
 *  The stretches come quicker and the match must be closer as it goes. */
export class Tune implements Toy {
  private segs: Seg[] = [];
  private trail: { u: number; y: number; c: string }[] = [];
  private scroll = 0;
  private c = 3;
  /** Nu's wave's phase where Nu is, as it runs, and the phase slider's shift on top of it. */
  private ph = 0;
  private off = 0;
  private grab: { x: number; y: number; c: number; off: number; slider: 'f' | 'p' | null } | null = null;
  private started = false;
  private matched = false;
  private near = Infinity;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private W(s: Stage): number { return 2 * s.hw; }
  private X0(s: Stage): number { return s.m.x - s.hw * 0.3; }
  /** The strip along the bottom kept for the sliders, and the wave's middle above it. */
  private strip(s: Stage): number { return clamp(2 * s.hh * 0.2, 90, 130); }
  private cy(s: Stage): number { return s.m.y - this.strip(s) / 2 + 8; }
  /** The waves' height. */
  private amp(s: Stage): number { return (2 * s.hh - this.strip(s)) * 0.36 * 0.65; }
  /** The sliders: their ends across, and their heights (frequency below, phase above it). */
  private sx(s: Stage): [number, number] { return [s.m.x - s.hw + 34, s.m.x + s.hw - 34]; }
  private fy(s: Stage): number { return s.m.y + s.hh - 30; }
  private py(s: Stage): number { return this.fy(s) - 44; }
  /** The scroll speed (px/ms). */
  private v(s: Stage): number { return this.W(s) / 5200; }
  /** How close a match must be: in frequency (as a log ratio) and in phase (radians). */
  private tolF(): number { return Math.max(0.08, 0.16 - this.count * 0.004); }
  private tolP(): number { return Math.max(0.4, 0.75 - this.count * 0.015); }

  enter(s: Stage): void {
    s.rim = null;
    s.nu.r = 9;
    this.segs = [];
    this.trail = [];
    this.scroll = 0;
    this.c = 3;
    this.ph = 0;
    this.off = 0;
    this.grab = null;
    this.started = false;
    this.matched = false;
    this.near = Infinity;
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    // The first stretch matches Nu as it is, to show what green means.
    const u0 = -(s.m.x + s.hw - this.X0(s));
    this.segs.push({ u0, len: this.W(s) * 0.8, c: this.c, ph0: TAU * (this.c / this.W(s)) * u0, on: 0, all: 0 });
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
      const jump = n >= TUNE_JUMP_AT ? (Math.random() - 0.5) * TAU * Math.min(1, 0.35 + (n - TUNE_JUMP_AT) * 0.08) : 0;
      const ms = Math.max(TUNE_SHORT, TUNE_LONG - n * 100);
      const seg = { u0: last.u0 + last.len, len: this.v(s) * ms, c, ph0: this.phase(s, last, last.u0 + last.len) + jump, on: 0, all: 0 };
      this.segs.push(seg);
      last = seg;
    }
  }

  /** A stretch's phase at world place `u`. */
  private phase(s: Stage, g: Seg, u: number): number { return g.ph0 + TAU * (g.c / this.W(s)) * (u - g.u0); }

  /** The target's height at world place `u` (up is +), easing from one stretch into the next. */
  private target(s: Stage, u: number): number {
    const i = this.segs.findIndex((g) => u >= g.u0 && u < g.u0 + g.len);
    const g = this.segs[i < 0 ? (u < this.segs[0].u0 ? 0 : this.segs.length - 1) : i];
    const y = this.amp(s) * Math.sin(this.phase(s, g, u));
    if (i <= 0 || u - g.u0 >= 30) return y;
    const e = (u - g.u0) / 30, k = e * e * (3 - 2 * e);
    return this.amp(s) * Math.sin(this.phase(s, this.segs[i - 1], u)) * (1 - k) + y * k;
  }

  /** Nu's own wave's height at world place `u`, as it is set now. */
  private mine(s: Stage, u: number): number {
    return this.amp(s) * Math.sin(this.ph + this.off + TAU * (this.c / this.W(s)) * (u - this.scroll));
  }

  private place(s: Stage): void {
    s.nu.x = this.X0(s);
    s.nu.y = this.cy(s) - this.mine(s, this.scroll);
  }

  /** Nu's wave's colour: white before the first touch, then by how close it is. */
  private hue(): string {
    if (!this.started || this.overAt) return WHITE;
    return this.matched ? GREEN : this.near < TUNE_NEAR ? TUNE_BLUE : this.near < TUNE_MID ? TUNE_AMBER : RED;
  }

  step(s: Stage, dt: number, now: number): void {
    if (this.overAt) return;
    const v = this.v(s);
    this.scroll += v * dt;
    this.ph = (this.ph + TAU * (this.c / this.W(s)) * v * dt) % TAU;
    this.place(s);
    // The stretch going past Nu, how far off Nu's wave is (in tolerances, frequency and phase
    // together), and whether it matches.
    const g = this.segs.find((q) => this.scroll >= q.u0 && this.scroll < q.u0 + q.len);
    const offF = g ? Math.abs(Math.log(this.c / g.c)) / this.tolF() : Infinity;
    const offP = g ? Math.abs(wrap(this.ph + this.off - this.phase(s, g, this.scroll))) / this.tolP() : Infinity;
    this.near = Math.hypot(offF, offP);
    const ok = this.near < 1;
    if (ok && !this.matched && this.started) tickSound(2);
    this.matched = ok;
    if (g && this.started) { g.all += dt; if (ok) g.on += dt; }
    this.trail.push({ u: this.scroll, y: s.nu.y, c: this.hue() });
    const keep = this.scroll - (this.X0(s) - (s.m.x - s.hw)) - 10;
    while (this.trail.length > 2 && this.trail[0].u < keep) this.trail.shift();
    // Stretches that have gone by: scored, or a life.
    while (this.segs.length > 1 && this.segs[0].u0 + this.segs[0].len <= this.scroll) {
      const d = this.segs.shift() as Seg;
      if (!this.started || d.all < 300) continue;
      if (d.on / d.all >= TUNE_GOAL) {
        this.count++;
        captureSound();
        s.fx.ring(s.nu, GREEN, s.nu.r, s.nu.r + 30, 500);
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
    const X0 = this.X0(s), x1 = s.m.x + s.hw + 4, cy = this.cy(s), live = this.matched && this.started && !this.overAt;
    bar(ctx, X0, s.m.y - s.hh + 40, X0, s.m.y + s.hh - this.strip(s) - 4, K800, 2, 0.9);
    // The target, solid: grey, and green along the stretch going past while it matches.
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
    // Nu's wave, dashed: its trace to the left in the colour of how close it was at each point,
    // and ahead of it as it is set now, over the incoming wave.
    const pts = this.trail.map((p) => ({ x: X0 - (this.scroll - p.u), y: p.y, u: p.u, c: p.c }));
    const hue = this.hue();
    for (let x = X0; x <= x1 + 3; x += 3) {
      const u = this.scroll + (x - X0);
      pts.push({ x, y: cy - this.mine(s, u), u, c: hue });
    }
    ctx.lineWidth = 3;
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 0.9;
    for (const c of new Set(pts.map((p) => p.c))) {
      ctx.strokeStyle = c;
      ctx.beginPath();
      let pen = false;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (b.c !== c || !onDash((a.u + b.u) / 2)) { pen = false; continue; }
        if (!pen) ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        pen = true;
      }
      ctx.stroke();
    }
    ctx.restore();
    // Nu's sliders along the bottom: its frequency, and its phase just above.
    const [sx0, sx1] = this.sx(s);
    const f = Math.log(this.c / TUNE_LO) / Math.log(TUNE_HI / TUNE_LO);
    this.slider(ctx, sx0, sx1, this.fy(s), f, hue, this.grab?.slider === 'f');
    this.slider(ctx, sx0, sx1, this.py(s), (((this.off % TAU) + TAU) % TAU) / TAU, hue, this.grab?.slider === 'p');
    s.nu.draw(ctx, now);
    lives(s, ctx, this.left);
  }

  /** A slider: its track, the part up to the knob in Nu's colour, and the knob (bigger when held). */
  private slider(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, f: number, c: string, held: boolean): void {
    const x = x0 + (x1 - x0) * clamp(f, 0, 1);
    bar(ctx, x0, y, x1, y, K500, 4, 0.7);
    bar(ctx, x0, y, x, y, c, 4, 0.8);
    dot(ctx, { x, y }, held ? 12 : 10, c, 0.95);
    ring(ctx, { x, y }, held ? 18 : 15, c, 2, 0.4);
  }

  private setF(f: number): void {
    this.c = clamp(TUNE_LO * Math.exp(f * Math.log(TUNE_HI / TUNE_LO)), TUNE_LO, TUNE_HI);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.started = true;
    const [x0, x1] = this.sx(s), f = clamp((p.x - x0) / (x1 - x0), 0, 1);
    // On a slider, its knob jumps to the finger; above them, a drag moves both from where they are.
    const slider = Math.abs(p.y - this.py(s)) < 22 ? 'p' : p.y > this.py(s) + 22 ? 'f' : null;
    this.grab = { x: p.x, y: p.y, c: this.c, off: this.off, slider };
    if (slider === 'f') this.setF(f);
    if (slider === 'p') this.off = f * TAU;
  }

  move(s: Stage, p: Pt): void {
    const g = this.grab;
    if (!g) return;
    const [x0, x1] = this.sx(s), f = clamp((p.x - x0) / (x1 - x0), 0, 1);
    if (g.slider === 'f') this.setF(f);
    else if (g.slider === 'p') this.off = f * TAU;
    else {
      // Across for the frequency; up and down for the phase, a whole turn over three wave heights.
      this.c = clamp(g.c * Math.exp(((p.x - g.x) / (x1 - x0)) * Math.log(TUNE_HI / TUNE_LO)), TUNE_LO, TUNE_HI);
      this.off = g.off + ((g.y - p.y) / (3 * this.amp(s))) * TAU;
    }
  }

  up(): void { this.grab = null; }

  resize(s: Stage): void {
    this.trail = [];
    this.place(s);
    if (!this.overAt) this.grow(s);
  }
}
