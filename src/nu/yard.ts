// Seven more of Nu's park games (park.ts), on the same kit:
//   Bloom   red electrons bounce round the court. Hold to blow a bubble where you press; an
//           electron touching it while it grows pops it. Fill most of the court to clear it.
//   Hop     Nu hops up from pad to pad; slide the finger to steer it. Cyan pads spring higher.
//           Down at the bottom and it's over.
//   Juggle  keep Nu up: tap near it to kick it into the air. It mustn't touch the floor.
//   Loop    draw a loop round electrons to catch them, but never round a red one.
//   Pull    Nu orbits a nucleus; hold to pull it toward the finger and reshape its orbit, so it
//           runs through photons and misses the reds circling on their own rings.
//   Spark   one spark a round: aim, let go, and Nu bursts there; every atom a burst touches
//           bursts too, wider for bigger atoms. Set off enough of them to go on.
//   Twin    Nu has a twin on the far side of the middle that goes where it goes, mirrored.
//           Catch photons with either; neither may touch red.

import {
  CYAN, K300, K500, K800, NOTE_COLOURS, RED, ROSE, TAU, WHITE,
  anywhere, best, bounceIn, buzz, captureSound, chimeSound, clamp, completeSound, dist, dot, edge, inside, missSound, ring, finish, setBest, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';

function glow(ctx: CanvasRenderingContext2D, p: Pt, r: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
  ctx.shadowBlur = 10;
  dot(ctx, p, r, CYAN);
  ctx.restore();
}

/** Lives left, as small dots across the top (of the court, or of the arena). */
function lives(s: Stage, ctx: CanvasRenderingContext2D, left: number, of = 3): void {
  const top = s.court ? s.c.y - s.R + 22 : s.m.y - s.hh + 22;
  for (let i = 0; i < of; i++) {
    const p = { x: s.c.x + (i - (of - 1) / 2) * 16, y: top };
    if (i < left) dot(ctx, p, 4.5, WHITE, 0.85);
    else ring(ctx, p, 4.5, K500, 2, 0.8);
  }
}

/** A moving thing given a random heading at `speed`. */
function drift(p: Pt, speed: number): Mover {
  const a = Math.random() * TAU;
  return { x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
}

// ---- Hop -------------------------------------------------------------------------------------

const HOP_G = 0.0016;
const HOP_JUMP = 0.8;
const HOP_SPRING = 1.15;

/** Nu hops up from pad to pad, and the view climbs with it. Slide the finger left and right and
 *  Nu goes as far. Cyan pads (filled) throw it higher; higher up, some pads drift along a rail
 *  (white, with a hub). The score is how high it has climbed; down to the floor and it's over. */
export class Hop implements Toy {
  /** Pads and Nu in the climb's own space: y goes up as it goes negative; the view's top is at `cam`. */
  private pads: { x: number; y: number; r: number; vx: number; spring: boolean }[] = [];
  private x = 0;
  private y = 0;
  private vy = 0;
  private cam = 0;
  private from = 0;
  private height = 0;
  private grab: number | null = null;
  private want: number | null = null;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private floor(s: Stage): number { return s.m.y + s.hh; }

  private reset(s: Stage): void {
    this.cam = 0;
    this.x = s.nu.x;
    this.y = s.nu.y;
    this.vy = -0.6;
    this.from = this.y;
    this.height = 0;
    this.overAt = 0;
    this.grab = this.want = null;
    this.pads = [{ x: this.x, y: Math.min(this.y + 40, this.floor(s) - 24), r: 20, vx: 0, spring: false }];
    this.more(s);
    s.score(0, best(s, 'hop') || null);
  }

  /** Pads up to a screen above the view. */
  private more(s: Stage): void {
    const top = this.cam - s.hh * 2;
    let last = this.pads[this.pads.length - 1];
    while (last.y > top) {
      const climb = this.from - last.y;
      const gap = 60 + Math.random() * Math.min(110, 50 + climb * 0.015);
      const moving = climb > 900 && Math.random() < 0.3, spring = !moving && Math.random() < 0.1;
      // Plain pads vary a little in size; springs and drifters keep the usual size.
      const r = Math.max(14, 20 - climb * 0.001) * (moving || spring ? 1 : 0.85 + Math.random() * 0.3);
      const x = s.m.x + (Math.random() * 2 - 1) * (s.hw - r - 12);
      last = { x, y: last.y - gap, r, vx: moving ? (Math.random() < 0.5 ? -1 : 1) * 0.06 : 0, spring };
      this.pads.push(last);
    }
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.overAt) { nu.x = this.x; nu.y = this.y - this.cam; return; }
    if (this.want !== null) this.x += clamp(this.want - this.x, -0.7 * dt, 0.7 * dt);
    this.x = clamp(this.x, s.m.x - s.hw + nu.r + 4, s.m.x + s.hw - nu.r - 4);
    for (const p of this.pads) {
      if (!p.vx) continue;
      p.x += p.vx * dt;
      if (Math.abs(p.x - s.m.x) > s.hw - p.r - 10) { p.vx *= -1; p.x = clamp(p.x, s.m.x - s.hw + p.r + 10, s.m.x + s.hw - p.r - 10); }
    }
    // Two half steps, so a fast fall can't pass through a pad.
    for (let k = 0; k < 2; k++) {
      const h = dt / 2, was = this.y;
      this.vy += HOP_G * h;
      this.y += this.vy * h;
      if (this.vy <= 0) continue;
      for (const p of this.pads) {
        const top = p.y - p.r * 0.6 - nu.r;
        if (was <= top && this.y >= top && Math.abs(this.x - p.x) < p.r + nu.r * 0.6) {
          this.y = top;
          this.vy = -(p.spring ? HOP_SPRING : HOP_JUMP);
          if (p.spring) { chimeSound(3); s.fx.ring({ x: p.x, y: p.y - this.cam }, CYAN, p.r, p.r + 16, 400); } else tickSound(1);
          nu.scale = 0.8;
          break;
        }
      }
    }
    nu.scale += (1 - nu.scale) * Math.min(1, dt / 120);
    // The view climbs to keep Nu out of the top third.
    const high = s.m.y - s.hh + s.hh * 0.75;
    if (this.y - this.cam < high) this.cam = this.y - high;
    const h = Math.max(0, Math.round((this.from - this.y) / 10));
    if (h > this.height) { this.height = h; s.score(h, best(s, 'hop') || null); }
    this.pads = this.pads.filter((p) => p.y - this.cam < this.floor(s) + 60);
    this.more(s);
    // Down on the floor: over, and Nu stays there in view.
    if (this.y - this.cam + nu.r >= this.floor(s)) {
      this.y = this.floor(s) - nu.r + this.cam;
      this.overAt = now;
      missSound();
      buzz(22);
      finish(s, 'hop', this.height);
      s.score(this.height, best(s, 'hop') || null);
    }
    nu.x = this.x;
    nu.y = this.y - this.cam;
    nu.vx = nu.vy = 0;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // A drifting pad's rail first, under everything.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = K500;
    ctx.globalAlpha = 0.5;
    for (const p of this.pads) {
      if (!p.vx) continue;
      const y = p.y - this.cam, w = s.hw - p.r - 10;
      ctx.beginPath();
      ctx.moveTo(s.m.x - w, y);
      ctx.lineTo(s.m.x + w, y);
      ctx.stroke();
    }
    ctx.restore();
    for (const p of this.pads) {
      const at = { x: p.x, y: p.y - this.cam };
      if (p.spring) {
        // A spring: filled with cyan light.
        dot(ctx, at, p.r, CYAN, 0.35);
        ring(ctx, at, p.r - 1.5, CYAN, 3, 0.95);
      } else if (p.vx) {
        // A drifter: white, with a hub.
        dot(ctx, at, p.r, K800, 0.95);
        ring(ctx, at, p.r - 1.5, WHITE, 3, 0.9);
        dot(ctx, at, 3.5, WHITE, 0.9);
      } else {
        dot(ctx, at, p.r, K800, 0.95);
        ring(ctx, at, p.r - 1.5, K300, 3, 0.7);
      }
    }
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

// ---- Juggle ----------------------------------------------------------------------------------

/** Juggle's fall: gentle at first, a little stronger with each kick, up to a cap (px/ms²). */
const JUGGLE_G = 0.0007;
const JUGGLE_G_MORE = 0.00002;
const JUGGLE_G_TOP = 0.0012;
/** Juggle moves in small fixed steps, so its arc is the same at any frame rate. */
const JUGGLE_STEP = 4;

/** Keep Nu in the air: tap near it to kick it up, and off to the side away from where you
 *  tapped. Off the walls and the ceiling it bounces; touching the floor ends the run. Each kick
 *  counts; it falls a little faster as you go. */
export class Juggle implements Toy {
  private b: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private state: 'ready' | 'run' | 'over' = 'ready';
  private count = 0;
  private overAt = 0;
  private kickAt = 0;
  /** The kick's speed, eased into over a few frames rather than all at once. */
  private kick: { vx: number; vy: number } | null = null;
  private spare = 0;

  enter(s: Stage): void {
    s.nu.r = 13;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.state = 'ready';
    this.count = 0;
    this.kick = null;
    this.spare = 0;
    s.score(0, best(s, 'juggle') || null);
  }

  private g(): number { return Math.min(JUGGLE_G_TOP, JUGGLE_G + this.count * JUGGLE_G_MORE); }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b;
    if (this.state === 'ready') {
      nu.seek({ x: s.m.x, y: s.m.y - s.hh * 0.25 + Math.sin(now / 400) * 6 }, dt, 0.5, 0.01);
      Object.assign(b, { x: nu.x, y: nu.y, vx: 0, vy: 0 });
      return;
    }
    if (this.state === 'over') return;
    this.spare += dt;
    while (this.spare >= JUGGLE_STEP && this.state === 'run') {
      this.spare -= JUGGLE_STEP;
      this.tick(s, JUGGLE_STEP, now);
    }
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
    nu.scale += (1 - nu.scale) * Math.min(1, dt / 180);
  }

  private tick(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b;
    if (this.kick) {
      // Most of the kick lands within about 60 ms.
      const k = 1 - Math.exp(-dt / 22);
      b.vx += (this.kick.vx - b.vx) * k;
      b.vy += (this.kick.vy - b.vy) * k;
      if (Math.abs(this.kick.vy - b.vy) < 0.01) this.kick = null;
    } else b.vy += this.g() * dt;
    // A little air, so sideways drift settles.
    b.vx *= Math.exp(-dt / 5000);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const e = edge(s, b);
    if (e.d + nu.r > 0 && e.ny > 0.6) {
      Object.assign(b, inside(s, b, nu.r));
      this.state = 'over';
      this.overAt = now;
      s.fx.ring({ x: b.x, y: b.y + nu.r }, RED, 6, 34, 600);
      missSound();
      buzz(22);
      finish(s, 'juggle', this.count);
      s.score(this.count, best(s, 'juggle') || null);
    } else if (bounceIn(s, b, nu.r, 0.85)) {
      tickSound(0);
      // Off the ceiling, the kick's done.
      this.kick = null;
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // The floor, faintly red: it mustn't land there.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = RED;
    ctx.fillRect(s.m.x - s.hw, s.m.y + s.hh - 8, s.hw * 2, 8);
    ctx.restore();
    if (now - this.kickAt < 260) ring(ctx, s.nu, s.nu.r + 4 + (now - this.kickAt) / 14, WHITE, 2, 0.5 * (1 - (now - this.kickAt) / 260));
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now(), nu = s.nu;
    if (this.state === 'over') return;
    if (dist(p, nu) > nu.r + 48) return;
    this.state = 'run';
    // Up about as high as a third of the arena and more, whatever the fall: v² = 2gh.
    const rise = clamp(s.hh * 0.8, 180, 320);
    const vy = -Math.sqrt(2 * this.g() * rise);
    // A falling Nu stops at once, then eases up to the kick's speed.
    this.b.vy = Math.min(this.b.vy, 0);
    this.kick = { vx: clamp(this.b.vx * 0.5 + (nu.x - p.x) * 0.01, -0.32, 0.32), vy };
    this.count++;
    this.kickAt = now;
    nu.scale = 0.88;
    chimeSound(this.count % 5);
    if (this.count % 10 === 0) completeSound();
    s.score(this.count, best(s, 'juggle') || null);
  }
}

// ---- Loop ------------------------------------------------------------------------------------

function insidePoly(p: Pt, poly: Pt[]): boolean {
  let on = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) on = !on;
  }
  return on;
}

/** Electrons drift about. Draw a loop round some (Nu follows the finger, drawing it): when the
 *  line meets itself, or you let go near where you began, the electrons inside are caught. A
 *  red one inside spoils the loop and costs a life. */
export class Loop implements Toy {
  private dots: (Mover & { red: boolean })[] = [];
  private line: Pt[] = [];
  private count = 0;
  private left = 3;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.dots = [];
    this.line = [];
    this.count = 0;
    this.left = 3;
    this.overAt = 0;
    this.stock(s);
    s.score(0, best(s, 'loop') || null);
  }

  /** Six electrons, and a red one more for every eight caught (up to four). */
  private stock(s: Stage): void {
    const reds = Math.min(4, 1 + Math.floor(this.count / 8));
    const add = (red: boolean) => {
      let p = anywhere(s, 20);
      for (let k = 0; k < 20 && dist(p, s.nu) < 70; k++) p = anywhere(s, 20);
      this.dots.push({ ...drift(p, 0.04 + Math.random() * 0.04), red });
    };
    while (this.dots.filter((d) => !d.red).length < 6) add(false);
    while (this.dots.filter((d) => d.red).length < reds) add(true);
  }

  step(s: Stage, dt: number): void {
    for (const d of this.dots) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      bounceIn(s, d, 6, 1);
    }
    const end = this.line[this.line.length - 1];
    if (end && !this.overAt) s.nu.seek(end, dt, 1.4, 0.06);
  }

  private close(s: Stage, poly: Pt[]): void {
    this.line = [];
    if (poly.length < 8) return;
    const caught = this.dots.filter((d) => insidePoly(d, poly));
    if (caught.some((d) => d.red)) {
      for (const d of caught.filter((q) => q.red)) s.fx.ring(d, RED, 6, 30, 500);
      this.left--;
      missSound();
      buzz(22);
      if (this.left <= 0) {
        this.overAt = performance.now();
        finish(s, 'loop', this.count);
        s.score(this.count, best(s, 'loop') || null);
      }
      return;
    }
    if (!caught.length) return;
    for (const d of caught) s.fx.burst(d, 6, CYAN, 0.1);
    this.dots = this.dots.filter((d) => !caught.includes(d));
    this.count += caught.length;
    captureSound();
    if (caught.length >= 3) completeSound();
    s.score(this.count, best(s, 'loop') || null);
    this.stock(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (let i = 0; i < this.line.length; i += 2) dot(ctx, this.line[i], 2.6, WHITE, 0.55);
    for (const d of this.dots) if (d.red) dot(ctx, d, 6, RED); else glow(ctx, d, 5.5);
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.line = [p];
  }

  move(s: Stage, p: Pt): void {
    if (this.overAt || !this.line.length) return;
    const last = this.line[this.line.length - 1];
    if (dist(p, last) < 6) return;
    this.line.push(p);
    if (this.line.length > 400) this.line.shift();
    // The line meets itself: the loop is what lies between.
    for (let i = 0; i < this.line.length - 12; i++) {
      if (dist(p, this.line[i]) < 16) { this.close(s, this.line.slice(i)); return; }
    }
  }

  up(s: Stage): void {
    const l = this.line;
    if (l.length > 12 && dist(l[0], l[l.length - 1]) < 44) this.close(s, l);
    this.line = [];
  }
}

// ---- Pull ------------------------------------------------------------------------------------

/** Pull's time for one round of Nu's starting orbit, in ms. */
const PULL_LAP = 4200;
/** Nu's starting orbit, and the nucleus, as parts of the court's radius. */
const PULL_START = 0.55;
const PULL_CORE = 0.08;
/** Physics in small fixed steps, so the orbits hold. */
const PULL_STEP = 4;

/** A red danger on its own round orbit. */
type Red = { rr: number; a: number; w: number };

/** Nu orbits the nucleus at the middle of the court, on an ellipse, under its pull (the faint
 *  line ahead of Nu is where it will go). Hold anywhere and Nu is pulled toward the finger: hold
 *  ahead of it to speed up and swing wider, behind to slow down and drop in. Shape the orbit to
 *  run through photons, which are caught on touch; red dangers circle on their own rings, and
 *  one touching Nu costs a life. Waiting is fine: let a red go round before crossing its ring. */
export class Pull implements Toy {
  court = true;
  private b: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private photons: Pt[] = [];
  private reds: Red[] = [];
  private press: Pt | null = null;
  private count = 0;
  private left = 3;
  private overAt = 0;
  /** After a hit, a moment when no red can hit again. */
  private safeUntil = 0;
  private spare = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  /** The nucleus's pull (GM), set so the starting orbit takes PULL_LAP. */
  private gm(s: Stage): number { const r = s.R * PULL_START, w = TAU / PULL_LAP; return r * r * r * w * w; }
  /** How hard the finger pulls (px/ms²): a second's hold changes the speed by about 15%. */
  private thrust(s: Stage): number { return Math.sqrt(this.gm(s) / (s.R * PULL_START)) * 0.15 / 1000; }

  private reset(s: Stage): void {
    const r = s.R * PULL_START, v = Math.sqrt(this.gm(s) / r);
    // Nu starts on a round orbit, going round anticlockwise (on screen).
    this.b = { x: s.c.x, y: s.c.y + r, vx: v, vy: 0 };
    s.nu.at(this.b);
    this.count = 0;
    this.left = 3;
    this.overAt = 0;
    this.safeUntil = 0;
    this.spare = 0;
    this.press = null;
    this.reds = [];
    this.photons = [];
    this.stock(s);
    s.score(0, best(s, 'pull') || null);
  }

  /** Three photons waiting, and a red ring more for every five caught (up to four). */
  private stock(s: Stage): void {
    while (this.photons.length < 3) {
      let p: Pt = s.c;
      for (let k = 0; k < 30; k++) {
        const a = Math.random() * TAU, r = s.R * (0.22 + Math.random() * 0.66);
        p = { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r };
        if (dist(p, this.b) > 70 && this.photons.every((q) => dist(p, q) > 50)) break;
      }
      this.photons.push(p);
    }
    const want = Math.min(4, 1 + Math.floor(this.count / 5));
    while (this.reds.length < want) {
      // A ring of its own, clear of the others and of Nu's way round now, starting across the
      // court from Nu.
      const nuR = dist(this.b, s.c);
      let rr = 0;
      for (let k = 0; k < 30; k++) {
        rr = s.R * (0.22 + Math.random() * 0.68);
        if (Math.abs(rr - nuR) > 30 && this.reds.every((q) => Math.abs(q.rr - rr) > s.R * 0.12)) break;
      }
      const nuA = Math.atan2(this.b.y - s.c.y, this.b.x - s.c.x);
      // Slower than an orbit there would be, either way round.
      const w = Math.sqrt(this.gm(s) / (rr * rr * rr)) * (0.45 + Math.random() * 0.2) * (Math.random() < 0.5 ? -1 : 1);
      this.reds.push({ rr, a: nuA + Math.PI + (Math.random() - 0.5), w });
    }
  }

  private red(s: Stage, q: Red): Pt { return { x: s.c.x + Math.cos(q.a) * q.rr, y: s.c.y + Math.sin(q.a) * q.rr }; }

  /** One small step of Nu under the nucleus's pull (and the finger's, if held). */
  private fall(s: Stage, b: Mover, dt: number, held: Pt | null): void {
    const dx = b.x - s.c.x, dy = b.y - s.c.y, r = Math.max(s.R * PULL_CORE, Math.hypot(dx, dy));
    const g = this.gm(s) / (r * r * r);
    b.vx -= dx * g * dt;
    b.vy -= dy * g * dt;
    if (held) {
      const hx = held.x - b.x, hy = held.y - b.y, d = Math.hypot(hx, hy);
      if (d > 4) { const t = this.thrust(s); b.vx += (hx / d) * t * dt; b.vy += (hy / d) * t * dt; }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  /** Nu bounces off the nucleus (losing nothing, so it can't settle there) and off the rim
   *  (losing a little). True if it did. */
  private bounce(s: Stage, b: Mover, r: number): boolean {
    const dx = b.x - s.c.x, dy = b.y - s.c.y, d = Math.hypot(dx, dy) || 1, core = s.R * PULL_CORE + r;
    if (d < core) {
      const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
      b.x = s.c.x + nx * core;
      b.y = s.c.y + ny * core;
      if (vn >= 0) return false;
      b.vx -= 2 * vn * nx;
      b.vy -= 2 * vn * ny;
      return true;
    }
    return bounceIn(s, b, r, 0.7);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b;
    for (const q of this.reds) q.a += q.w * dt;
    if (this.overAt) return;
    this.spare += dt;
    while (this.spare >= PULL_STEP) {
      this.spare -= PULL_STEP;
      this.fall(s, b, PULL_STEP, this.press);
      if (this.bounce(s, b, nu.r)) tickSound(0);
    }
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
    for (let i = 0; i < this.photons.length; i++) {
      if (dist(this.photons[i], nu) > nu.r + 8) continue;
      this.count++;
      s.fx.burst(this.photons[i], 6, CYAN, 0.1);
      captureSound();
      s.score(this.count, best(s, 'pull') || null);
      this.photons.splice(i--, 1);
    }
    this.stock(s);
    if (now < this.safeUntil) return;
    for (const q of this.reds) {
      const p = this.red(s, q);
      if (dist(p, nu) > nu.r + 5) continue;
      this.left--;
      this.safeUntil = now + 1500;
      s.fx.ring(p, RED, 8, 36, 600);
      missSound();
      buzz(22);
      // That red goes back round, across the court.
      q.a += Math.PI;
      if (this.left <= 0) {
        this.overAt = now;
        this.press = null;
        finish(s, 'pull', this.count);
        s.score(this.count, best(s, 'pull') || null);
      }
      return;
    }
  }

  /** Where Nu will go if let be: about one orbit ahead (less if it hits something). */
  private ahead(s: Stage): Pt[] {
    const b = { ...this.b }, out: Pt[] = [{ x: b.x, y: b.y }];
    let turned = 0, last = Math.atan2(b.y - s.c.y, b.x - s.c.x);
    for (let i = 0; i < 1200 && turned < TAU * 0.97; i++) {
      this.fall(s, b, 8, null);
      if (this.bounce(s, b, s.nu.r)) break;
      const a = Math.atan2(b.y - s.c.y, b.x - s.c.x);
      let da = a - last;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      turned += Math.abs(da);
      last = a;
      if (i % 3 === 2) out.push({ x: b.x, y: b.y });
    }
    return out;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // The red rings, faintly.
    for (const q of this.reds) ring(ctx, s.c, q.rr, RED, 2, 0.16);
    // The nucleus.
    dot(ctx, s.c, s.R * PULL_CORE, K800, 1);
    ring(ctx, s.c, s.R * PULL_CORE - 1.5, K300, 3, 0.7);
    // Nu's way ahead, fading out.
    if (!this.overAt) {
      const path = this.ahead(s), n = path.length;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = WHITE;
      for (let i = 1; i < n; i++) {
        ctx.globalAlpha = 0.35 * (1 - i / n);
        ctx.beginPath();
        ctx.moveTo(path[i - 1].x, path[i - 1].y);
        ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const p of this.photons) glow(ctx, p, 5 + Math.sin(now / 260) * 0.6);
    const safe = now < this.safeUntil;
    for (const q of this.reds) dot(ctx, this.red(s, q), 6, RED, safe ? 0.5 : 1);
    // The finger's pull: a line from Nu toward it.
    if (this.press && !this.overAt) {
      const nu = s.nu, dx = this.press.x - nu.x, dy = this.press.y - nu.y, d = Math.hypot(dx, dy) || 1, l = Math.min(d, 36);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = WHITE;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(nu.x + (dx / d) * (nu.r + 4), nu.y + (dy / d) * (nu.r + 4));
      ctx.lineTo(nu.x + (dx / d) * (nu.r + 4 + l), nu.y + (dy / d) * (nu.r + 4 + l));
      ctx.stroke();
      ctx.restore();
      ring(ctx, this.press, 12, K300, 2, 0.5);
    }
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.press = p;
  }

  move(_s: Stage, p: Pt): void { if (this.press && !this.overAt) this.press = p; }
  up(): void { this.press = null; }
}

// ---- Spark -----------------------------------------------------------------------------------

const BURST_GROW = 260;
const BURST_HOLD = 1500;
const BURST_SHRINK = 320;
const BURST_MS = BURST_GROW + BURST_HOLD + BURST_SHRINK;

/** Spark's atoms come in three sizes: the bigger the atom, the wider its burst (on a phone-sized
 *  arena; bigger arenas scale up). Nu's own burst is in between. */
const SPARK_KINDS = [
  { r: 4.5, burst: 46, c: NOTE_COLOURS[0], odds: 0.4 },
  { r: 6, burst: 64, c: CYAN, odds: 0.4 },
  { r: 8, burst: 92, c: NOTE_COLOURS[3], odds: 0.2 },
];
const SPARK_NU = 50;

function burstR(t: number, R: number): number {
  if (t < 0 || t > BURST_MS) return 0;
  if (t < BURST_GROW) return R * (1 - (1 - t / BURST_GROW) ** 2);
  if (t < BURST_GROW + BURST_HOLD) return R;
  return R * (1 - (t - BURST_GROW - BURST_HOLD) / BURST_SHRINK);
}

/** Atoms of three sizes float in place. One spark a round: press to aim (the ring shows Nu's
 *  burst, and the atoms it would touch), let go and Nu flies there and bursts; any atom a burst
 *  touches bursts too, as wide as its size, and so on down the chain. Each round is dealt with a
 *  best spark in mind, and asks for a share of what that spark would set off: more of it each
 *  round, so later rounds want the best spot, found by reading the field. Set off enough (the rim
 *  fills as you do) to go on; short, and the run is over. */
export class Spark implements Toy {
  private atoms: (Pt & { kind: number; at: number | null; ph: number })[] = [];
  /** For each atom, the atoms its burst reaches. */
  private links: number[][] = [];
  private level = 1;
  private need = 1;
  private caught = 0;
  private state: 'aim' | 'fly' | 'chain' | 'done' | 'over' = 'aim';
  private spot: Pt = { x: 0, y: 0 };
  private aim: Pt | null = null;
  private nuAt = 0;
  private doneAt = 0;
  /** Bursts and atoms scale with the arena. */
  private u = 1;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.level = 1;
    this.round(s);
  }

  private burst(kind: number): number { return SPARK_KINDS[kind].burst * this.u; }

  /** Atoms Nu's burst at `p` touches itself. */
  private first(p: Pt): number[] {
    const out: number[] = [];
    this.atoms.forEach((a, i) => { if (dist(a, p) < SPARK_NU * this.u + 6) out.push(i); });
    return out;
  }

  /** How many a spark at `p` sets off, chain and all (the atoms float in place, so it's known). */
  private reach(p: Pt): number {
    const todo = this.first(p), hit = new Set(todo);
    while (todo.length) for (const j of this.links[todo.pop()!]) if (!hit.has(j)) { hit.add(j); todo.push(j); }
    return hit.size;
  }

  /** The most one spark could set off, trying the arena over in a loose grid. */
  private bestSpark(s: Stage): number {
    let most = 0;
    const step = 14 * this.u;
    for (let x = s.m.x - s.hw; x <= s.m.x + s.hw; x += step) {
      for (let y = s.m.y - s.hh; y <= s.m.y + s.hh; y += step) most = Math.max(most, this.reach({ x, y }));
    }
    return most;
  }

  private deal(s: Stage, n: number): void {
    this.atoms = [];
    for (let k = 0; this.atoms.length < n && k < 2000; k++) {
      const p = anywhere(s, 16);
      if (this.atoms.some((a) => dist(a, p) < 22 * this.u)) continue;
      let roll = Math.random(), kind = 0;
      while (kind < SPARK_KINDS.length - 1 && (roll -= SPARK_KINDS[kind].odds) >= 0) kind++;
      this.atoms.push({ ...p, kind, at: null, ph: Math.random() * TAU });
    }
    this.links = this.atoms.map((a, i) => {
      const r = this.burst(a.kind) + 6, out: number[] = [];
      this.atoms.forEach((b, j) => { if (j !== i && dist(a, b) < r) out.push(j); });
      return out;
    });
  }

  private round(s: Stage): void {
    this.u = clamp(Math.sqrt((s.hw * s.hh) / (170 * 320)), 0.8, 1.6);
    const n = Math.min(28, 16 + this.level);
    // A field where a good spark sets off at least half; the best of a few tries if none does.
    let most = 0, keep = { atoms: this.atoms, links: this.links };
    for (let k = 0; k < 12; k++) {
      this.deal(s, n);
      const m = this.bestSpark(s);
      if (m > most) { most = m; keep = { atoms: this.atoms, links: this.links }; }
      if (m >= n * 0.5) break;
    }
    this.atoms = keep.atoms;
    this.links = keep.links;
    // A share of the best: two thirds at first, nine tenths of it from round six.
    const share = Math.min(0.9, 0.6 + this.level * 0.05);
    this.need = Math.max(2, Math.round(most * share));
    this.caught = 0;
    this.state = 'aim';
    this.aim = null;
    s.rim = 0;
    s.score(this.level, best(s, 'spark') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'aim' || this.state === 'over') { nu.seek(this.aim ?? s.m, dt, 0.3, 0.01); return; }
    if (this.state === 'fly') {
      nu.seek(this.spot, dt, 0.9, 0.04);
      // Arrived: the burst is right where it was aimed.
      if (dist(nu, this.spot) < 6) { nu.x = this.spot.x; nu.y = this.spot.y; this.state = 'chain'; this.nuAt = now; captureSound(); }
      return;
    }
    if (this.state === 'done') {
      nu.seek(s.m, dt, 0.4, 0.01);
      if (now - this.doneAt > 1300) this.round(s);
      return;
    }
    // The chain: every burst still going sets off the atoms it touches.
    const bursts: { p: Pt; r: number }[] = [];
    if (now - this.nuAt < BURST_MS) bursts.push({ p: nu, r: burstR(now - this.nuAt, SPARK_NU * this.u) });
    for (const a of this.atoms) if (a.at !== null && now - a.at < BURST_MS) bursts.push({ p: a, r: burstR(now - a.at, this.burst(a.kind)) });
    for (const a of this.atoms) {
      if (a.at !== null || !bursts.some((b) => dist(a, b.p) < b.r + 6)) continue;
      a.at = now;
      this.caught++;
      chimeSound(this.caught % 5);
    }
    s.rim = clamp(this.caught / this.need, 0, 1);
    if (!bursts.length) {
      this.doneAt = now;
      if (this.caught >= this.need) {
        this.state = 'done';
        completeSound();
        setBest(s, 'spark', this.level);
        this.level++;
      } else {
        this.state = 'over';
        missSound();
        finish(s, 'spark', this.level - 1);
      }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const near = new Set(this.state === 'aim' && this.aim ? this.first(this.aim) : []);
    this.atoms.forEach((a, i) => {
      const k = SPARK_KINDS[a.kind];
      if (a.at === null) {
        // Floating in place, just about: a small sway that the bursts don't heed.
        const p = { x: a.x + Math.cos(now / 900 + a.ph) * 1.5, y: a.y + Math.sin(now / 1100 + a.ph) * 1.5 };
        dot(ctx, p, k.r * this.u, k.c);
        if (near.has(i)) ring(ctx, p, k.r * this.u + 4, WHITE, 2, 0.8);
        return;
      }
      const r = burstR(now - a.at, this.burst(a.kind));
      if (r <= 0) return;
      dot(ctx, a, r, k.c, 0.25);
      ring(ctx, a, r, k.c, 3, 0.7);
    });
    // Aiming: Nu's burst, where it would be.
    if (this.state === 'aim' && this.aim) ring(ctx, this.aim, SPARK_NU * this.u, ROSE, 2, 0.45);
    if (this.state === 'chain') {
      const r = burstR(now - this.nuAt, SPARK_NU * this.u);
      if (r > 0) { dot(ctx, s.nu, r, ROSE, 0.2); ring(ctx, s.nu, r, ROSE, 3, 0.6); }
    }
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.state !== 'aim') return;
    this.aim = p;
  }

  move(_s: Stage, p: Pt): void { if (this.state === 'aim' && this.aim) this.aim = p; }

  up(_s: Stage, p: Pt): void {
    if (this.state !== 'aim' || !this.aim) return;
    this.spot = p;
    this.aim = null;
    this.state = 'fly';
    tickSound(2);
  }
}

// ---- Twin ------------------------------------------------------------------------------------

/** Nu has a twin across the middle of the arena: drag Nu (from anywhere) and the twin goes the
 *  mirror way. Photons are caught by either; a red antiparticle touching either ends the run.
 *  More reds as you go. */
export class Twin implements Toy {
  private grab: Pt | null = null;
  private want: Pt | null = null;
  private photons: Pt[] = [];
  private reds: Mover[] = [];
  private count = 0;
  private overAt = 0;
  private spawn = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private twin(s: Stage): Pt { return { x: 2 * s.m.x - s.nu.x, y: 2 * s.m.y - s.nu.y }; }

  private reset(s: Stage): void {
    this.count = 0;
    this.overAt = 0;
    this.reds = [];
    this.spawn = 2500;
    this.grab = this.want = null;
    this.photons = [];
    this.photons = [this.spot(s), this.spot(s)];
    s.score(0, best(s, 'twin') || null);
  }

  /** Somewhere clear of both. */
  private spot(s: Stage, far = 70): Pt {
    const t = this.twin(s);
    let p = anywhere(s, 26);
    for (let k = 0; k < 30 && (dist(p, s.nu) < far || dist(p, t) < far); k++) p = anywhere(s, 26);
    return p;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.overAt) return;
    if (this.want) {
      nu.seek(inside(s, this.want, nu.r + 2), dt, 1.1, 0.05);
      Object.assign(nu, inside(s, nu, nu.r));
    } else {
      nu.vx = nu.vy = 0;
    }
    const t = this.twin(s);
    for (let i = 0; i < this.photons.length; i++) {
      const q = this.photons[i];
      if (dist(nu, q) > nu.r + 9 && dist(t, q) > nu.r + 9) continue;
      this.count++;
      s.fx.burst(q, 6, CYAN, 0.1);
      captureSound();
      s.score(this.count, best(s, 'twin') || null);
      this.photons[i] = this.spot(s);
    }
    this.spawn -= dt;
    if (this.spawn <= 0 && this.reds.length < Math.min(6, 1 + Math.floor(this.count / 4))) {
      this.reds.push(drift(this.spot(s, 130), 0.06 + Math.random() * 0.05));
      this.spawn = 2500;
    }
    for (const q of this.reds) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      bounceIn(s, q, 6, 1);
      const hit = dist(nu, q) < nu.r + 5 ? nu : dist(t, q) < nu.r + 5 ? t : null;
      if (!hit) continue;
      this.overAt = now;
      this.want = null;
      s.fx.ring(hit, RED, 8, 36, 600);
      missSound();
      buzz(22);
      finish(s, 'twin', this.count);
      s.score(this.count, best(s, 'twin') || null);
      return;
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const q of this.photons) glow(ctx, q, 5 + Math.sin(now / 260) * 0.6);
    for (const q of this.reds) dot(ctx, q, 6, RED);
    const t = this.twin(s);
    ring(ctx, t, s.nu.r - 1.5, WHITE, 3, 0.85);
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
