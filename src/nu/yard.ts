// Seven more of Nu's park games (park.ts), on the same kit:
//   Bloom   red electrons bounce round the court. Hold to blow a bubble where you press; an
//           electron touching it while it grows pops it. Fill most of the court to clear it.
//   Hop     Nu hops up from pad to pad; slide the finger to steer it. Cyan pads spring higher.
//           Down at the bottom and it's over.
//   Juggle  keep Nu up: tap near it to kick it into the air. It mustn't touch the floor.
//   Loop    draw a loop round electrons to catch them, but never round a red one.
//   Pull    hold to pull everything in to Nu at the middle; let go before a red one gets there.
//   Spark   one tap: Nu bursts there, and every atom the burst touches bursts too. Set off
//           enough of them to go on to the next round.
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

// ---- Bloom -----------------------------------------------------------------------------------

/** How much of the court the bubbles must cover to clear it. */
const BLOOM_FILL = 0.6;

/** Red electrons bounce round the court. Press and hold to blow a bubble there (Nu goes to blow
 *  it); it grows till you let go or it meets the rim or another bubble. An electron touching it
 *  while it grows pops it and costs a life. Settled bubbles are solid: the electrons bounce off
 *  them. Cover most of the court and the next has one electron more. */
export class Bloom implements Toy {
  court = true;
  private reds: Mover[] = [];
  private bubbles: { x: number; y: number; r: number }[] = [];
  private grow: { x: number; y: number; r: number } | null = null;
  private level = 1;
  private left = 3;
  private overAt = 0;
  private clearAt = 0;

  enter(s: Stage): void {
    s.nu.r = 8;
    this.level = 1;
    this.left = 3;
    this.overAt = 0;
    this.round(s);
  }

  private round(s: Stage): void {
    this.bubbles = [];
    this.grow = null;
    this.clearAt = 0;
    this.reds = [];
    for (let i = 0; i < 1 + this.level; i++) {
      const a = Math.random() * TAU, r = Math.random() * s.R * 0.6;
      this.reds.push(drift({ x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r }, 0.065 + this.level * 0.008));
    }
    s.rim = 0;
    s.score(this.level, best(s, 'bloom') || null);
  }

  private fill(s: Stage): number { return this.bubbles.reduce((t, b) => t + b.r * b.r, 0) / (s.R * s.R); }

  private settle(s: Stage, now: number): void {
    const g = this.grow;
    this.grow = null;
    if (!g || g.r < 8) return;
    this.bubbles.push(g);
    tickSound(2);
    const f = this.fill(s);
    s.rim = clamp(f / BLOOM_FILL, 0, 1);
    if (f >= BLOOM_FILL) {
      this.clearAt = now;
      completeSound();
      setBest(s, 'bloom', this.level);
    }
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.overAt) { nu.seek(s.c, dt, 0.4, 0.02); return; }
    if (this.clearAt) {
      if (now - this.clearAt > 1000) { this.level++; this.round(s); }
      return;
    }
    for (const q of this.reds) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      bounceIn(s, q, 5, 1);
      for (const b of this.bubbles) {
        const d = dist(q, b);
        if (d >= b.r + 5) continue;
        const nx = (q.x - b.x) / (d || 1), ny = (q.y - b.y) / (d || 1);
        q.x = b.x + nx * (b.r + 5);
        q.y = b.y + ny * (b.r + 5);
        const vn = q.vx * nx + q.vy * ny;
        if (vn < 0) { q.vx -= 2 * vn * nx; q.vy -= 2 * vn * ny; }
      }
    }
    const g = this.grow;
    if (!g) return;
    nu.seek(g, dt, 1, 0.05);
    g.r += 0.075 * dt;
    if (this.reds.some((q) => dist(q, g) < g.r + 5)) {
      this.grow = null;
      this.left--;
      s.fx.ring(g, RED, g.r, g.r + 16, 500);
      missSound();
      buzz(22);
      if (this.left <= 0) {
        this.overAt = now;
        finish(s, 'bloom', this.level - 1);
      }
      return;
    }
    if (dist(g, s.c) + g.r >= s.R - 2 || this.bubbles.some((b) => dist(b, g) <= b.r + g.r)) this.settle(s, now);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const b of this.bubbles) {
      dot(ctx, b, b.r, this.clearAt ? K500 : K800, 0.95);
      ring(ctx, b, b.r - 1.5, K300, 3, 0.7);
    }
    if (this.grow) {
      dot(ctx, this.grow, this.grow.r, K800, 0.6);
      ring(ctx, this.grow, this.grow.r - 1.5, CYAN, 3, 0.9);
    }
    for (const q of this.reds) dot(ctx, q, 5, RED, this.clearAt ? 0.4 : 1);
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) { if (now - this.overAt > 900) this.enter(s); return; }
    if (this.clearAt || dist(p, s.c) > s.R - 10 || this.bubbles.some((b) => dist(b, p) < b.r + 4)) return;
    this.grow = { x: p.x, y: p.y, r: 4 };
  }

  up(s: Stage): void { if (this.grow) this.settle(s, performance.now()); }
}

// ---- Hop -------------------------------------------------------------------------------------

const HOP_G = 0.0016;
const HOP_JUMP = 0.8;
const HOP_SPRING = 1.15;

/** Nu hops up from pad to pad, and the view climbs with it. Slide the finger left and right and
 *  Nu goes as far. Cyan pads throw it higher; higher up, some pads drift. The score is how high
 *  it has climbed; down to the floor and it's over. */
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
    this.want = null;
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
      const r = Math.max(14, 20 - climb * 0.001);
      const x = s.m.x + (Math.random() * 2 - 1) * (s.hw - r - 12);
      const moving = climb > 900 && Math.random() < 0.3;
      last = { x, y: last.y - gap, r, vx: moving ? (Math.random() < 0.5 ? -1 : 1) * 0.06 : 0, spring: Math.random() < 0.1 };
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
    for (const p of this.pads) {
      const at = { x: p.x, y: p.y - this.cam };
      dot(ctx, at, p.r, K800, 0.95);
      ring(ctx, at, p.r - 1.5, p.spring ? CYAN : K300, 3, 0.8);
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) { if (performance.now() - this.overAt > 700) this.reset(s); return; }
    this.grab = this.x - p.x;
    this.want = p.x + this.grab;
  }

  move(_s: Stage, p: Pt): void { if (this.grab !== null) this.want = p.x + this.grab; }
  up(): void { this.grab = null; this.want = null; }
}

// ---- Juggle ----------------------------------------------------------------------------------

/** Keep Nu in the air: tap near it to kick it up, and off to the side away from where you
 *  tapped. Off the walls and the ceiling it bounces; touching the floor ends the run. Each kick
 *  counts; it falls a little faster as you go. */
export class Juggle implements Toy {
  private b: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private state: 'ready' | 'run' | 'over' = 'ready';
  private count = 0;
  private overAt = 0;
  private kickAt = 0;

  enter(s: Stage): void {
    s.nu.r = 13;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.state = 'ready';
    this.count = 0;
    s.score(0, best(s, 'juggle') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.b;
    if (this.state === 'ready') {
      nu.seek({ x: s.m.x, y: s.m.y - s.hh * 0.25 + Math.sin(now / 400) * 6 }, dt, 0.5, 0.01);
      Object.assign(b, { x: nu.x, y: nu.y, vx: 0, vy: 0 });
      return;
    }
    if (this.state === 'over') return;
    b.vy += (0.0011 + Math.min(0.0008, this.count * 0.00003)) * dt;
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
    } else if (bounceIn(s, b, nu.r, 0.85)) tickSound(0);
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
    nu.scale += (1 - nu.scale) * Math.min(1, dt / 140);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // The floor, faintly red: it mustn't land there.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = RED;
    ctx.fillRect(s.m.x - s.hw, s.m.y + s.hh - 8, s.hw * 2, 8);
    ctx.restore();
    if (now - this.kickAt < 200) ring(ctx, s.nu, s.nu.r + 4 + (now - this.kickAt) / 12, WHITE, 2, 0.5 * (1 - (now - this.kickAt) / 200));
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now(), nu = s.nu;
    if (this.state === 'over') { if (now - this.overAt > 700) this.reset(s); return; }
    if (dist(p, nu) > nu.r + 48) return;
    this.state = 'run';
    this.b.vy = -0.82;
    this.b.vx = clamp(this.b.vx * 0.5 + (nu.x - p.x) * 0.012, -0.4, 0.4);
    this.count++;
    this.kickAt = now;
    nu.scale = 0.8;
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
    if (this.overAt) { if (performance.now() - this.overAt > 800) this.reset(s); return; }
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

/** Nu sits in the middle with photons and red antiparticles circling round it. Hold anywhere and
 *  everything is pulled in; each photon reaching Nu counts, but a red one reaching it ends the
 *  run. Let go and they drift back out. */
export class Pull implements Toy {
  court = true;
  private bits: (Mover & { red: boolean; dir: number; home: number })[] = [];
  private holding = false;
  private count = 0;
  private overAt = 0;

  enter(s: Stage): void {
    s.nu.r = 10;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.bits = [];
    this.count = 0;
    this.overAt = 0;
    this.holding = false;
    this.stock(s);
    s.score(0, best(s, 'pull') || null);
  }

  private add(s: Stage, red: boolean): void {
    const a = Math.random() * TAU, home = s.R * (0.45 + Math.random() * 0.45);
    this.bits.push({ x: s.c.x + Math.cos(a) * home, y: s.c.y + Math.sin(a) * home, vx: 0, vy: 0, red, dir: Math.random() < 0.5 ? -1 : 1, home });
  }

  private stock(s: Stage): void {
    const reds = Math.min(4, 1 + Math.floor(this.count / 5));
    while (this.bits.filter((b) => !b.red).length < 5) this.add(s, false);
    while (this.bits.filter((b) => b.red).length < reds) this.add(s, true);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    nu.seek(s.c, dt, 0.4, 0.02);
    if (this.overAt) return;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i], dx = b.x - s.c.x, dy = b.y - s.c.y, r = Math.hypot(dx, dy) || 1;
      const nx = dx / r, ny = dy / r;
      // Round and round, each its own way; pulled in while held, else back out to its own ring.
      const pull = this.holding ? -0.00045 : (b.home - r) * 0.000004;
      b.vx += (nx * pull - ny * b.dir * 0.00004) * dt;
      b.vy += (ny * pull + nx * b.dir * 0.00004) * dt;
      const sp = Math.hypot(b.vx, b.vy), top = this.holding ? 0.3 : 0.12;
      if (sp > top) { b.vx *= top / sp; b.vy *= top / sp; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      bounceIn(s, b, 5, 0.6);
      if (r > nu.r + 5) continue;
      this.bits.splice(i, 1);
      if (b.red) {
        this.overAt = now;
        s.fx.ring(nu, RED, nu.r, nu.r + 30, 600);
        missSound();
        buzz(25);
        finish(s, 'pull', this.count);
        s.score(this.count, best(s, 'pull') || null);
        return;
      }
      this.count++;
      s.fx.ring(nu, CYAN, nu.r, nu.r + 14, 350);
      tickSound(this.count % 5);
      s.score(this.count, best(s, 'pull') || null);
    }
    this.stock(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    if (this.holding && !this.overAt) ring(ctx, s.c, s.nu.r + 10 + Math.sin(now / 90) * 3, CYAN, 3, 0.5);
    for (const b of this.bits) if (b.red) dot(ctx, b, 6, RED); else glow(ctx, b, 5);
    s.nu.draw(ctx, now);
  }

  down(s: Stage): void {
    if (this.overAt) { if (performance.now() - this.overAt > 800) this.reset(s); return; }
    this.holding = true;
  }

  up(): void { this.holding = false; }
}

// ---- Spark -----------------------------------------------------------------------------------

const BURST_R = 40;
const BURST_GROW = 260;
const BURST_HOLD = 1500;
const BURST_SHRINK = 320;
const BURST_MS = BURST_GROW + BURST_HOLD + BURST_SHRINK;

function burstR(t: number): number {
  if (t < 0 || t > BURST_MS) return 0;
  if (t < BURST_GROW) return BURST_R * (1 - (1 - t / BURST_GROW) ** 2);
  if (t < BURST_GROW + BURST_HOLD) return BURST_R;
  return BURST_R * (1 - (t - BURST_GROW - BURST_HOLD) / BURST_SHRINK);
}

/** Atoms drift about. One tap a round: Nu flies there and bursts, and any atom the burst
 *  touches bursts too, and so on down the chain. Set off enough (the rim fills as you do) to go
 *  on to the next round, with more atoms and more needed; short, and the round starts again. */
export class Spark implements Toy {
  private atoms: (Mover & { c: string; at: number | null })[] = [];
  private level = 1;
  private need = 1;
  private caught = 0;
  private state: 'aim' | 'fly' | 'chain' | 'done' = 'aim';
  private spot: Pt = { x: 0, y: 0 };
  private nuAt = 0;
  private doneAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.level = 1;
    this.round(s);
  }

  private round(s: Stage): void {
    const n = Math.min(48, 8 + this.level * 4);
    this.need = Math.min(n - 1, Math.round(n * (0.12 + this.level * 0.06)));
    this.atoms = Array.from({ length: n }, (_, i) => ({ ...drift(anywhere(s, 16), 0.035 + Math.random() * 0.03), c: NOTE_COLOURS[i % 4], at: null }));
    this.caught = 0;
    this.state = 'aim';
    s.rim = 0;
    s.score(this.level, best(s, 'spark') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    for (const a of this.atoms) {
      if (a.at !== null) continue;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      bounceIn(s, a, 6, 1);
    }
    if (this.state === 'aim') { nu.seek(s.m, dt, 0.3, 0.01); return; }
    if (this.state === 'fly') {
      nu.seek(this.spot, dt, 0.9, 0.04);
      if (dist(nu, this.spot) < 6) { this.state = 'chain'; this.nuAt = now; captureSound(); }
      return;
    }
    if (this.state === 'done') {
      nu.seek(s.m, dt, 0.4, 0.01);
      if (now - this.doneAt > 1300) this.round(s);
      return;
    }
    // The chain: every burst still going sets off the atoms it touches.
    const bursts: { p: Pt; r: number }[] = [];
    if (now - this.nuAt < BURST_MS) bursts.push({ p: nu, r: burstR(now - this.nuAt) });
    for (const a of this.atoms) if (a.at !== null && now - a.at < BURST_MS) bursts.push({ p: a, r: burstR(now - a.at) });
    for (const a of this.atoms) {
      if (a.at !== null || !bursts.some((b) => dist(a, b.p) < b.r + 6)) continue;
      a.at = now;
      this.caught++;
      chimeSound(this.caught % 5);
    }
    s.rim = clamp(this.caught / this.need, 0, 1);
    if (!bursts.length) {
      this.state = 'done';
      this.doneAt = now;
      if (this.caught >= this.need) {
        completeSound();
        setBest(s, 'spark', this.level);
        this.level++;
      } else { missSound(); s.end?.(this.level - 1); }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const a of this.atoms) {
      if (a.at === null) { dot(ctx, a, 6, a.c); continue; }
      const r = burstR(now - a.at);
      if (r <= 0) continue;
      dot(ctx, a, r, a.c, 0.3);
      ring(ctx, a, r, a.c, 3, 0.7);
    }
    if (this.state === 'chain') {
      const r = burstR(now - this.nuAt);
      if (r > 0) { dot(ctx, s.nu, r, ROSE, 0.2); ring(ctx, s.nu, r, ROSE, 3, 0.6); }
    }
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.state !== 'aim') return;
    this.spot = p;
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
    if (this.overAt) { if (performance.now() - this.overAt > 700) this.reset(s); return; }
    this.grab = { x: s.nu.x - p.x, y: s.nu.y - p.y };
    this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y };
  }

  move(_s: Stage, p: Pt): void { if (this.grab) this.want = { x: p.x + this.grab.x, y: p.y + this.grab.y }; }
  up(): void { this.grab = null; this.want = null; }
}
