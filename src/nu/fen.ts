// Three more of Nu's park games (park.ts), on the same kit, all about waves:
//   Beat    two waves add up, and where their frequencies differ the sum swells and fades (beats).
//           Slide along the bottom to tune Nu's wave until the beating stops, and hold it there.
//   Chord   a string rings between two posts. Slide along the row of dots at the bottom to pick its
//           harmonic, so its still points (nodes) sit on the target rings before the rim runs out.
//   Phase   Nu bobs on its wave as rings roll by. Slide the wave left or right so Nu's crest meets
//           each green ring as it passes, and misses each red one.

import {
  GREEN, K300, K500, K800, NOTE_COLOURS, RED, TAU, WHITE,
  best, buzz, captureSound, clamp, completeSound, dot, finish, hitSound, missSound, ring, tickSound,
  type Pt, type Stage, type Toy,
} from './kit';
import { bar, lives } from './lawn';

// ---- Shared ----------------------------------------------------------------------------------

const BLUE = NOTE_COLOURS[0];
const AMBER = NOTE_COLOURS[2];
/** How close Nu is, as Tune shows it: matched, near, off, far. */
const NEAR = [GREEN, BLUE, AMBER, RED];

/** The slider along the bottom of the arena, out from under the waves. */
function track(s: Stage): { x0: number; x1: number; y: number } {
  return { x0: s.m.x - s.hw * 0.72, x1: s.m.x + s.hw * 0.72, y: s.m.y + s.hh - 30 };
}

/** A press this close to the slider moves it to the finger; elsewhere, a drag nudges it. */
const ON_TRACK = 44;

/** Draws a line through `y(x)` from `x0` to `x1`. */
function trace(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: (x: number) => number, c: string, w: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let x = x0; x <= x1 + 2.5; x += 3) {
    const px = Math.min(x, x1);
    if (x === x0) ctx.moveTo(px, y(px)); else ctx.lineTo(px, y(px));
  }
  ctx.stroke();
  ctx.restore();
}

/** An angle brought into -π..π. */
const wrap = (a: number): number => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

// ---- Beat ------------------------------------------------------------------------------------

/** Nu's range of frequencies, in whole waves across the arena. */
const BEAT_LO = 3;
const BEAT_HI = 9;
/** How long the beat must stay still to score (ms). */
const BEAT_HOLD = 1100;
/** The time for a level at the start and at its shortest (ms). */
const BEAT_LONG = 10_000;
const BEAT_SHORT = 5500;
/** The count from which the reference drifts, and from which its own wave and Nu's fade, so the
 *  beat in the sum is the guide. */
const BEAT_DRIFT_AT = 6;
const BEAT_FADE_AT = 10;

/** Zero beat. A grey reference wave runs along the top and Nu's own wave under it; below, the
 *  two add up, and Nu rides the sum. While their frequencies differ, the sum swells and fades
 *  (the lines either side show its envelope), the slower the closer they are. Slide along the
 *  bottom to tune Nu's wave; its colour says how close (red, amber, blue, green). Keep the beat
 *  still until the ring round Nu fills, before the rim runs out, and that's a level; then the
 *  reference moves on. Later the reference drifts and the two waves fade, so only the sum shows
 *  the way. Three timeouts and it's over. */
export class Beat implements Toy {
  /** The reference's frequency (its middle, when it drifts), and Nu's. */
  private f0 = 5;
  private f1 = 5;
  private f2 = 5;
  /** Each wave's phase at the arena's middle. */
  private th1 = 0;
  private th2 = 0;
  private drift = 0;
  private held = 0;
  private band = 3;
  private bandAt = 0;
  private levelAt = 0;
  private grab: { x: number; v: number; abs: boolean } | null = null;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private W(s: Stage): number { return 2 * s.hw; }
  /** The scroll speed (px/ms). */
  private v(s: Stage): number { return this.W(s) / 3200; }
  private amp(s: Stage): number { return Math.min(s.hh * 0.065, 24); }
  private tol(): number { return Math.max(0.12, 0.32 - this.count * 0.014); }
  private span(): number { return Math.max(BEAT_SHORT, BEAT_LONG - this.count * 320); }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    this.grab = null;
    this.f2 = 5;
    this.th1 = 0;
    this.th2 = 0;
    this.next(0);
    // The first level's clock starts with the first touch.
    this.levelAt = 0;
    s.rim = 1;
    s.nu.at({ x: s.m.x, y: this.sumY(s) });
    s.score(0, best(s, 'beat') || null);
  }

  /** A new reference, well away from where Nu is now. */
  private next(now: number): void {
    const gap = Math.min(2.4, 1.2 + this.count * 0.08);
    this.drift = this.count >= BEAT_DRIFT_AT ? Math.min(0.6, 0.08 * (this.count - BEAT_DRIFT_AT + 1)) : 0;
    const lo = BEAT_LO + 0.4 + this.drift, hi = BEAT_HI - 0.4 - this.drift;
    let f = lo + Math.random() * (hi - lo);
    for (let i = 0; i < 30 && Math.abs(f - this.f2) < gap; i++) f = lo + Math.random() * (hi - lo);
    this.f0 = f;
    this.f1 = f;
    this.held = 0;
    this.band = 3;
    this.levelAt = now;
  }

  private sumY(s: Stage): number { return s.m.y + s.hh * 0.06; }

  step(s: Stage, dt: number, now: number): void {
    const v = this.v(s), W = this.W(s);
    this.f1 = this.f0 + this.drift * Math.sin(now / 2200);
    this.th1 += TAU * this.f1 * v / W * dt;
    this.th2 += TAU * this.f2 * v / W * dt;
    // Nu rides the sum, at the arena's middle.
    const a = this.amp(s) * 1.7;
    s.nu.x = s.m.x;
    s.nu.y = this.sumY(s) - a * (Math.sin(this.th1) + Math.sin(this.th2));
    if (this.overAt) return;
    const off = Math.abs(this.f1 - this.f2), tol = this.tol();
    const band = off < tol ? 0 : off < tol * 2.5 ? 1 : off < tol * 6 ? 2 : 3;
    // A note as it comes closer (only while the player is tuning, and not too often).
    if (band < this.band && this.grab && now - this.bandAt > 150) { tickSound(4 - band); this.bandAt = now; }
    this.band = band;
    if (band === 0) {
      // Locked on: Nu's wave falls into step with the reference, so the sum swells to full.
      this.th2 += wrap(this.th1 - this.th2) * (1 - Math.exp(-dt / 300));
      if (this.levelAt) this.held += dt;
    } else this.held = Math.max(0, this.held - dt * 2);
    if (!this.levelAt) { s.rim = 1; return; }
    if (this.held >= BEAT_HOLD) {
      this.count++;
      captureSound();
      if (this.count % 5 === 0) completeSound();
      s.fx.ring(s.nu, GREEN, s.nu.r, s.nu.r + 40, 600);
      s.fx.burst(s.nu, 10, GREEN);
      s.score(this.count, best(s, 'beat') || null);
      this.next(now);
      return;
    }
    const left = 1 - (now - this.levelAt) / this.span();
    s.rim = clamp(left, 0, 1);
    if (left <= 0) {
      this.left--;
      missSound();
      buzz(20);
      s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 34, 600);
      if (this.left <= 0) {
        this.overAt = now;
        this.grab = null;
        s.rim = null;
        finish(s, 'beat', this.count);
        s.score(this.count, best(s, 'beat') || null);
        return;
      }
      this.next(now);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const W = this.W(s), a = this.amp(s), x0 = s.m.x - s.hw + 10, x1 = s.m.x + s.hw - 10;
    const k1 = TAU * this.f1 / W, k2 = TAU * this.f2 / W;
    const y1 = s.m.y - s.hh * 0.5, y2 = s.m.y - s.hh * 0.3, ys = this.sumY(s);
    const w1 = (x: number) => Math.sin(this.th1 - k1 * (x - s.m.x));
    const w2 = (x: number) => Math.sin(this.th2 - k2 * (x - s.m.x));
    const fade = this.count >= BEAT_FADE_AT && !this.overAt ? 0.35 : 0.85;
    const c = this.overAt ? K300 : NEAR[this.band];
    // The two waves: the reference in grey, Nu's in its closeness colour.
    trace(ctx, x0, x1, (x) => y1 - a * w1(x), K300, 2, fade);
    trace(ctx, x0, x1, (x) => y2 - a * w2(x), c, 2.5, fade);
    // Their sum, and its envelope either side: still when the frequencies agree.
    const A = a * 1.7, dth = this.th1 - this.th2, dk = k1 - k2;
    const env = (x: number) => 2 * A * Math.abs(Math.cos((dth - dk * (x - s.m.x)) / 2));
    trace(ctx, x0, x1, (x) => ys - env(x), K500, 2, 0.8);
    trace(ctx, x0, x1, (x) => ys + env(x), K500, 2, 0.8);
    trace(ctx, x0, x1, (x) => ys - A * (w1(x) + w2(x)), this.band === 0 && !this.overAt ? GREEN : WHITE, 3, 0.95);
    // The hold: a ring round Nu filling while the beat is still.
    if (this.held > 0 && !this.overAt) {
      ctx.save();
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(s.nu.x, s.nu.y, s.nu.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(this.held / BEAT_HOLD, 0, 1));
      ctx.stroke();
      ctx.restore();
    }
    s.nu.draw(ctx, now);
    // The slider: Nu's frequency, low at the left.
    const t = track(s);
    bar(ctx, t.x0, t.y, t.x1, t.y, K500, 2, 0.7);
    const f = (this.f2 - BEAT_LO) / (BEAT_HI - BEAT_LO);
    dot(ctx, { x: t.x0 + (t.x1 - t.x0) * f, y: t.y }, 7, c, 0.95);
    lives(s, ctx, this.left);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    if (!this.levelAt) this.levelAt = performance.now();
    const t = track(s), abs = Math.abs(p.y - t.y) < ON_TRACK;
    this.grab = { x: p.x, v: (this.f2 - BEAT_LO) / (BEAT_HI - BEAT_LO), abs };
    this.move(s, p);
  }

  move(s: Stage, p: Pt): void {
    const g = this.grab;
    if (!g) return;
    const t = track(s), w = t.x1 - t.x0;
    const v = g.abs ? (p.x - t.x0) / w : g.v + (p.x - g.x) / w;
    this.f2 = BEAT_LO + clamp(v, 0, 1) * (BEAT_HI - BEAT_LO);
  }

  up(): void { this.grab = null; }

  resize(s: Stage): void { s.nu.at({ x: s.m.x, y: this.sumY(s) }); }
}

// ---- Chord -----------------------------------------------------------------------------------

/** The highest harmonic on the row. */
const CHORD_TOP = 8;
/** How long the nodes must sit on the rings to score (ms). */
const CHORD_HOLD = 500;
/** The time for a level at the start and at its shortest (ms). */
const CHORD_LONG = 8500;
const CHORD_SHORT = 2800;
/** The pause between levels (ms). */
const CHORD_REST = 550;
/** The counts from which the rings show only some of the nodes, and from which two strings ring. */
const CHORD_FEW_AT = 8;
const CHORD_TWO_AT = 14;

/** A target ring, at `p/q` of the way along string `str` (in lowest terms). */
type Mark = { p: number; q: number; str: number };

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);

/** Standing waves. A string rings between two posts; Nu sits on a row of dots along the bottom,
 *  one per harmonic, low at the left. Slide along the row and the string rings in that many
 *  loops, with a still point (a node) between each, and plays its note. Put a node on every
 *  target ring (each turns green as one lands on it) and hold it there a moment, before the rim
 *  runs out. Later the rings show only a few of the nodes, so you work out which harmonic has
 *  them all, and then two strings ring together. Three timeouts and it's over. */
export class Chord implements Toy {
  private n = 1;
  private marks: Mark[] = [];
  private strings = 1;
  private held = 0;
  private kick = 0;
  private levelAt = 0;
  private restAt = 0;
  private grab: { x: number; v: number; abs: boolean } | null = null;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private span(): number { return Math.max(CHORD_SHORT, CHORD_LONG - this.count * 260); }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    this.restAt = 0;
    this.grab = null;
    this.n = 1;
    this.next(0);
    this.levelAt = 0;
    s.rim = 1;
    s.nu.at(this.knob(s));
    s.score(0, best(s, 'chord') || null);
  }

  private dotX(s: Stage, n: number): number {
    const t = track(s);
    return t.x0 + (t.x1 - t.x0) * (n - 1) / (CHORD_TOP - 1);
  }

  private knob(s: Stage): Pt { return { x: this.dotX(s, this.n), y: track(s).y }; }

  /** Whether harmonic `n` has a node on every ring. */
  private fits(n: number): boolean { return this.marks.every((m) => n % m.q === 0); }

  /** A new target, which Nu's harmonic doesn't already fit. */
  private next(now: number): void {
    const c = this.count;
    for (let tries = 0; tries < 40; tries++) {
      this.strings = c >= CHORD_TWO_AT ? 2 : 1;
      let h: number;
      if (c < 4) h = 2 + Math.floor(Math.random() * 3);
      else if (c < CHORD_FEW_AT) h = 2 + Math.floor(Math.random() * 5);
      else h = 3 + Math.floor(Math.random() * (CHORD_TOP - 2));
      // The nodes of harmonic h, in lowest terms.
      const nodes: Mark[] = [];
      for (let j = 1; j < h; j++) { const g = gcd(j, h); nodes.push({ p: j / g, q: h / g, str: 0 }); }
      if (c < CHORD_FEW_AT) this.marks = nodes;
      else {
        // A few of them, but enough that h (or a multiple) is the only way to fit them all.
        const want = this.strings === 2 ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 2);
        const pick = nodes.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(want, nodes.length));
        if (pick.reduce((l, m) => lcm(l, m.q), 1) !== h) continue;
        if (this.strings === 2) {
          pick.forEach((m, i) => { m.str = i === 0 ? 0 : i === 1 ? 1 : Math.floor(Math.random() * 2); });
        }
        this.marks = pick;
      }
      if (!this.fits(this.n)) break;
    }
    // Never one that's already met: a single ring Nu's harmonic misses.
    if (this.fits(this.n)) {
      const q = [3, 2, 5, 7, 4].find((d) => this.n % d !== 0) ?? 3;
      this.strings = 1;
      this.marks = [{ p: 1, q, str: 0 }];
    }
    this.held = 0;
    this.levelAt = now;
  }

  /** The strings' heights and the posts' ends. */
  private rows(s: Stage): { y: number; x0: number; x1: number; a: number }[] {
    const x0 = s.m.x - s.hw * 0.8, x1 = s.m.x + s.hw * 0.8;
    if (this.strings === 1) return [{ y: s.m.y - s.hh * 0.12, x0, x1, a: Math.min(s.hh * 0.14, 64) }];
    const a = Math.min(s.hh * 0.1, 46);
    return [{ y: s.m.y - s.hh * 0.42, x0, x1, a }, { y: s.m.y + s.hh * 0.14, x0, x1, a }];
  }

  step(s: Stage, dt: number, now: number): void {
    s.nu.seek(this.knob(s), dt, 1.2, 0.02);
    this.kick *= Math.exp(-dt / 500);
    if (this.overAt) return;
    if (this.restAt) {
      if (now - this.restAt < CHORD_REST) return;
      this.restAt = 0;
      this.next(now);
      return;
    }
    if (!this.levelAt) { s.rim = 1; return; }
    if (this.fits(this.n)) this.held += dt; else this.held = 0;
    if (this.held >= CHORD_HOLD) {
      this.count++;
      captureSound();
      if (this.count % 5 === 0) completeSound();
      for (const r of this.rows(s)) s.fx.ring({ x: (r.x0 + r.x1) / 2, y: r.y }, GREEN, 20, (r.x1 - r.x0) / 2, 700);
      s.fx.burst(s.nu, 8, GREEN);
      s.score(this.count, best(s, 'chord') || null);
      this.restAt = now;
      return;
    }
    const left = 1 - (now - this.levelAt) / this.span();
    s.rim = clamp(left, 0, 1);
    if (left <= 0) {
      this.left--;
      missSound();
      buzz(20);
      s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 34, 600);
      if (this.left <= 0) {
        this.overAt = now;
        this.grab = null;
        s.rim = null;
        finish(s, 'chord', this.count);
        s.score(this.count, best(s, 'chord') || null);
        return;
      }
      this.restAt = now;
    }
  }

  /** How far Nu's harmonic is from one that fits, as a closeness band. */
  private band(): number {
    let d = 9;
    for (let h = 1; h <= CHORD_TOP; h++) if (this.fits(h)) d = Math.min(d, Math.abs(h - this.n));
    return Math.min(3, d);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const n = this.n, live = !this.overAt, done = !!this.restAt && this.fits(n);
    const c = live ? (done ? GREEN : NEAR[this.band()]) : K300;
    const w = 0.005 + 0.0022 * n;
    this.rows(s).forEach((r, i) => {
      const L = r.x1 - r.x0, a = r.a * (1 - (n - 1) * 0.06) * (0.75 + 0.5 * this.kick);
      // The posts, and the string ringing in its n loops.
      bar(ctx, r.x0, r.y - 22, r.x0, r.y + 22, K500, 4, 0.9);
      bar(ctx, r.x1, r.y - 22, r.x1, r.y + 22, K500, 4, 0.9);
      bar(ctx, r.x0, r.y, r.x1, r.y, K800, 2, 0.8);
      trace(ctx, r.x0, r.x1, (x) => r.y - a * Math.sin(n * Math.PI * (x - r.x0) / L) * Math.cos(w * now), c, 3, 0.95);
      // Its nodes: the still points.
      for (let j = 1; j < n; j++) dot(ctx, { x: r.x0 + (L * j) / n, y: r.y }, 3, WHITE, 0.9);
      // The target rings, green with a node on them.
      for (const m of this.marks) {
        if (m.str !== i) continue;
        const on = n % m.q === 0;
        ring(ctx, { x: r.x0 + (L * m.p) / m.q, y: r.y }, 10, on && live ? GREEN : K300, 2.5, 0.95);
      }
    });
    // The row of harmonics, and Nu on the one it plays.
    const t = track(s);
    bar(ctx, t.x0, t.y, t.x1, t.y, K800, 2, 0.8);
    for (let h = 1; h <= CHORD_TOP; h++) dot(ctx, { x: this.dotX(s, h), y: t.y }, 3 + h * 0.35, K500, 0.9);
    if (live && this.held > 0) {
      ctx.save();
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(s.nu.x, s.nu.y, s.nu.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(this.held / CHORD_HOLD, 0, 1));
      ctx.stroke();
      ctx.restore();
    } else if (live) ring(ctx, s.nu, s.nu.r + 8, c, 2, 0.8);
    s.nu.draw(ctx, now);
    lives(s, ctx, this.left);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    if (!this.levelAt && !this.restAt) this.levelAt = performance.now();
    this.grab = { x: p.x, v: this.n, abs: Math.abs(p.y - track(s).y) < ON_TRACK };
    this.move(s, p);
  }

  move(s: Stage, p: Pt): void {
    const g = this.grab;
    if (!g) return;
    const t = track(s), gap = (t.x1 - t.x0) / (CHORD_TOP - 1);
    const v = g.abs ? 1 + (p.x - t.x0) / gap : g.v + (p.x - g.x) / gap;
    const n = clamp(Math.round(v), 1, CHORD_TOP);
    if (n === this.n) return;
    this.n = n;
    this.kick = 1;
    // Its note: higher up the row, higher the note.
    hitSound((n - 1) / (CHORD_TOP - 1));
  }

  up(): void { this.grab = null; }

  resize(s: Stage): void { s.nu.at(this.knob(s)); }
}

// ---- Phase -----------------------------------------------------------------------------------

/** The time between rings at the start and at its shortest (ms). */
const PHASE_LONG = 3000;
const PHASE_SHORT = 1300;
/** The count from which some rings are red, to be missed. */
const PHASE_RED_AT = 6;
/** How far off the crest (radians) a red ring must be to pass safely. */
const PHASE_CLEAR = 1.15;

/** A ring rolling by: where it sits (world px), whether it's red, and how it went (0 to come,
 *  1 met, -1 missed). */
type Gate = { u: number; red: boolean; done: number };

/** Interference. Nu bobs on its own wave as rings roll in from the right, at the height of its
 *  crests. Drag left or right (anywhere, or along the wheel at the bottom) to slide Nu's wave
 *  under them: a green ring needs a crest on it as it reaches Nu's line, and lights up as Nu
 *  passes through; each green one met counts. Later red rings come too, and a crest on one of
 *  those costs a life, as does a green one missed. Nu's wave shows how close the next ring is
 *  (red, amber, blue, green). The rings come quicker and the match must be closer. */
export class Phase implements Toy {
  private gates: Gate[] = [];
  private scroll = 0;
  private ph = 0;
  private lam = 100;
  private band = 3;
  private bandAt = 0;
  private grab: { x: number; ph: number } | null = null;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private W(s: Stage): number { return 2 * s.hw; }
  private X0(s: Stage): number { return s.m.x - s.hw * 0.45; }
  private cy(s: Stage): number { return s.m.y - s.hh * 0.08; }
  private amp(s: Stage): number { return Math.min(s.hh * 0.2, 70); }
  private k(): number { return TAU / this.lam; }
  private v(s: Stage): number { return this.W(s) / Math.max(3800, 5000 - this.count * 40); }
  private tol(): number { return Math.max(0.45, 0.9 - this.count * 0.015); }

  enter(s: Stage): void {
    s.nu.r = 9;
    s.rim = null;
    this.lam = this.W(s) / 3.2;
    this.scroll = 0;
    // A crest at Nu's line to start with.
    this.ph = Math.PI / 2;
    this.gates = [];
    this.grab = null;
    this.band = 0;
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    // The first two rings sit on crests already, to show what a met ring does.
    const x1 = s.m.x + s.hw - this.X0(s);
    this.gates.push({ u: Math.ceil((x1 * 0.85) / this.lam) * this.lam, red: false, done: 0 });
    this.gates.push({ u: this.gates[0].u + 2 * this.lam, red: false, done: 0 });
    this.grow(s);
    this.place(s);
    s.score(0, best(s, 'phase') || null);
  }

  /** More rings ahead, as far as the arena shows. */
  private grow(s: Stage): void {
    const ahead = this.scroll + (s.m.x + s.hw - this.X0(s)) + 40;
    let last = this.gates[this.gates.length - 1];
    while (last.u < ahead) {
      const n = this.count + this.gates.filter((g) => !g.done).length;
      const ms = Math.max(PHASE_SHORT, PHASE_LONG - n * 60);
      const red = n >= PHASE_RED_AT && Math.random() < Math.min(0.4, 0.2 + (n - PHASE_RED_AT) * 0.01);
      const g = { u: last.u + this.v(s) * ms * (0.75 + Math.random() * 0.5), red, done: 0 };
      this.gates.push(g);
      last = g;
    }
  }

  /** How far (radians) Nu's crest is from the ring, -π..π. */
  private err(g: Gate): number { return wrap(this.k() * g.u + this.ph - Math.PI / 2); }

  private place(s: Stage): void {
    s.nu.x = this.X0(s);
    s.nu.y = this.cy(s) - this.amp(s) * Math.sin(this.k() * this.scroll + this.ph);
  }

  step(s: Stage, dt: number, now: number): void {
    if (this.overAt) return;
    this.scroll += this.v(s) * dt;
    this.place(s);
    // Rings reaching Nu's line.
    for (const g of this.gates) {
      if (g.done || g.u > this.scroll) continue;
      const e = Math.abs(this.err(g));
      const ok = g.red ? e > PHASE_CLEAR : e < this.tol();
      g.done = ok ? 1 : -1;
      if (ok && !g.red) {
        this.count++;
        captureSound();
        if (this.count % 10 === 0) completeSound();
        s.fx.ring(s.nu, GREEN, s.nu.r, s.nu.r + 30, 500);
        s.fx.burst(s.nu, 8, GREEN);
        s.score(this.count, best(s, 'phase') || null);
      } else if (!ok) {
        this.left--;
        missSound();
        buzz(20);
        s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 30, 600);
        if (this.left <= 0) {
          this.overAt = now;
          this.grab = null;
          finish(s, 'phase', this.count);
          s.score(this.count, best(s, 'phase') || null);
          return;
        }
      }
    }
    const gone = this.scroll - (this.X0(s) - (s.m.x - s.hw)) - 30;
    while (this.gates.length > 1 && this.gates[0].u < gone) this.gates.shift();
    this.grow(s);
    // How close the next ring is; a note as it comes closer (while the player slides).
    const g = this.gates.find((q) => !q.done);
    if (g) {
      const e = Math.abs(this.err(g)), tol = this.tol();
      const band = g.red
        ? (e > PHASE_CLEAR + 0.6 ? 0 : e > PHASE_CLEAR ? 1 : e > PHASE_CLEAR - 0.6 ? 2 : 3)
        : (e < tol ? 0 : e < tol + 0.6 ? 1 : e < tol + 1.4 ? 2 : 3);
      if (band < this.band && this.grab && now - this.bandAt > 150) { tickSound(4 - band); this.bandAt = now; }
      this.band = band;
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const X0 = this.X0(s), cy = this.cy(s), A = this.amp(s), k = this.k();
    const x0 = s.m.x - s.hw + 8, x1 = s.m.x + s.hw - 8, top = cy - A;
    const u = (x: number) => this.scroll + (x - X0);
    bar(ctx, X0, s.m.y - s.hh + 40, X0, s.m.y + s.hh - 60, K800, 2, 0.9);
    // Each ring's own short wave, faint, crest on the ring: where Nu's crests should go.
    for (const g of this.gates) {
      const gx = X0 + (g.u - this.scroll);
      if (gx < x0 - this.lam || gx > x1 + this.lam || g.red || g.done) continue;
      const a = Math.max(x0, gx - this.lam / 2), b = Math.min(x1, gx + this.lam / 2);
      if (b > a) trace(ctx, a, b, (x) => cy - A * Math.cos(k * (u(x) - g.u)), K500, 2, 0.5);
    }
    // Nu's wave, in the next ring's closeness colour.
    const c = this.overAt ? K300 : NEAR[this.band];
    trace(ctx, x0, x1, (x) => cy - A * Math.sin(k * u(x) + this.ph), c, 3, 0.9);
    // The rings: filled while a crest is on them (or, for red, while one would hit).
    for (const g of this.gates) {
      const p = { x: X0 + (g.u - this.scroll), y: top };
      if (p.x < x0 - 12 || p.x > x1 + 12) continue;
      const e = Math.abs(this.err(g));
      if (g.done) {
        const met = g.done > 0 && !g.red;
        if (g.done < 0) { ring(ctx, p, 11, RED, 3, 0.9); dot(ctx, p, 6, RED, 0.6); } else ring(ctx, p, 11, met ? GREEN : K500, 3, met ? 0.9 : 0.5);
        if (met) dot(ctx, p, 7, GREEN, 0.7);
        continue;
      }
      ring(ctx, p, 11, g.red ? RED : GREEN, 3, 0.95);
      if (!g.red && e < this.tol()) dot(ctx, p, 5, GREEN, 0.6);
      if (g.red && e < PHASE_CLEAR) dot(ctx, p, 5, RED, 0.6);
    }
    s.nu.draw(ctx, now);
    // The wheel along the bottom: its marks slide with the wave.
    const t = track(s);
    bar(ctx, t.x0, t.y, t.x1, t.y, K800, 2, 0.8);
    const step = this.lam / 4, off = ((((-this.ph / k) % step) + step) % step);
    for (let x = t.x0 + off; x <= t.x1; x += step) {
      const edge = Math.min(x - t.x0, t.x1 - x) / 40;
      dot(ctx, { x, y: t.y }, 3.5, K300, 0.85 * clamp(edge, 0, 1));
    }
    ring(ctx, { x: s.m.x, y: t.y }, 9, c, 2.5, 0.9);
    lives(s, ctx, this.left);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.grab = { x: p.x, ph: this.ph };
  }

  move(s: Stage, p: Pt): void {
    const g = this.grab;
    if (!g) return;
    // The wave follows the finger: crests move as far as it does.
    this.ph = wrap(g.ph - this.k() * (p.x - g.x));
  }

  up(): void { this.grab = null; }

  resize(s: Stage): void {
    // Everything scales with the arena's width, so the crests stay where they were on the rings.
    const lam = this.W(s) / 3.2, f = lam / this.lam;
    this.lam = lam;
    this.scroll *= f;
    for (const g of this.gates) g.u *= f;
    this.place(s);
    if (!this.overAt) this.grow(s);
  }
}
