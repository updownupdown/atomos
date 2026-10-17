// Six more of Nu's park games (park.ts), on the same kit:
//   Brick   Nu bounces up off the paddle into rows of atoms and knocks them out. Slide the
//           paddle along the bottom; three let past and it's over. A new wall, a row deeper.
//   Drop    slide Nu along the top and let go: it falls through the pegs into one of the bins
//           below. The green bin counts; the red one costs one of three lives.
//   Maze    hold and lean the way Nu should go; it runs the maze cell by cell to the green
//           ring. As many mazes as you can before the rim runs out.
//   More    two fields of atoms: tap the side with more. Closer counts, less time, as you go.
//   Stick   Nu turns in the middle; tap to send an electron up to its shell. It sticks where it
//           lands and turns with Nu. Never into one already there.
//   Flip    Nu runs along the floor; tap to flip it to the ceiling and back, over and under
//           the red. One touch and it's over.

import {
  CYAN, GREEN, K300, K500, NOTE_COLOURS, RED, TAU, WHITE,
  best, bounceIn, buzz, chimeSound, clamp, completeSound, dashed, dist, dot, missSound, ring, finish, setBest, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';

/** Lives left, as small dots across the top of the arena. */
export function lives(s: Stage, ctx: CanvasRenderingContext2D, left: number, of = 3): void {
  for (let i = 0; i < of; i++) {
    const p = { x: s.m.x + (i - (of - 1) / 2) * 16, y: s.m.y - s.hh + 22 };
    if (i < left) dot(ctx, p, 4.5, WHITE, 0.85);
    else ring(ctx, p, 4.5, K500, 2, 0.8);
  }
}

export function bar(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, c: string, w = 4, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

// ---- Brick -----------------------------------------------------------------------------------

/** Rows of atoms across the top. Nu bounces up off the paddle (slid along the bottom by the
 *  finger), steeper the nearer the paddle's end, and knocks out each atom it hits. A wall
 *  cleared, a new one a row deeper. Three let past and it's over. */
export class Brick implements Toy {
  private atoms: (Pt & { c: string })[] = [];
  private ar = 10;
  private ball: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private px = 0;
  private want: number | null = null;
  private left = 3;
  private count = 0;
  private wave = 0;
  private serveAt = 0;
  private overAt = 0;

  private padY(s: Stage): number { return s.m.y + s.hh - 46; }
  private padW(): number { return Math.max(56, 96 - this.wave * 8); }
  private speed(): number { return 0.27 + Math.min(0.15, this.count * 0.0025); }

  enter(s: Stage): void {
    s.nu.r = 8;
    this.px = s.m.x;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.left = 3;
    this.count = 0;
    this.wave = 0;
    this.overAt = 0;
    this.build(s);
    this.serve(s);
    s.score(0, best(s, 'brick') || null);
  }

  private build(s: Stage): void {
    const rows = Math.min(7, 3 + this.wave), w = 2 * s.hw - 28;
    const cols = Math.max(5, Math.floor(w / 30)), step = w / cols;
    this.ar = Math.min(11, step * 0.36);
    this.atoms = [];
    for (let j = 0; j < rows; j++) {
      const odd = j % 2, n = cols - odd;
      for (let i = 0; i < n; i++) {
        this.atoms.push({ x: s.m.x - w / 2 + step * (i + 0.5 + odd / 2), y: s.m.y - s.hh + 50 + j * step * 0.86, c: NOTE_COLOURS[j % NOTE_COLOURS.length] });
      }
    }
  }

  private serve(s: Stage): void {
    this.serveAt = performance.now() + 800;
    this.ball = { x: s.nu.x, y: s.nu.y, vx: 0, vy: 0 };
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, b = this.ball, half = this.padW() / 2, py = this.padY(s);
    if (this.want !== null) this.px += clamp(this.want - this.px, -1.3 * dt, 1.3 * dt);
    this.px = clamp(this.px, s.m.x - s.hw + half + 6, s.m.x + s.hw - half - 6);
    if (this.overAt) { nu.seek({ x: s.m.x, y: s.m.y }, dt, 0.4, 0.02); return; }
    if (now < this.serveAt) {
      // Back onto the paddle, then off up, a little askew.
      nu.seek({ x: this.px, y: py - nu.r - 8 }, dt, 0.8, 0.03);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      this.ball = { x: nu.x, y: nu.y, vx: Math.cos(a) * this.speed(), vy: Math.sin(a) * this.speed() };
      return;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y < py) bounceIn(s, b, nu.r, 1);
    // Never quite flat: it would take for ever to come down.
    if (Math.abs(b.vy) < this.speed() * 0.3) b.vy = Math.sign(b.vy || 1) * this.speed() * 0.3;
    if (b.vy > 0 && b.y + nu.r >= py - 5 && b.y < py + 6 && Math.abs(b.x - this.px) <= half + nu.r) {
      const off = clamp((b.x - this.px) / half, -1, 1), a = -Math.PI / 2 + off * 1.05;
      b.vx = Math.cos(a) * this.speed();
      b.vy = Math.sin(a) * this.speed();
      b.y = py - 5 - nu.r;
      tickSound(1);
    } else if (b.y > py + 30) {
      this.left--;
      s.fx.ring(b, RED, 6, 30, 550);
      missSound();
      buzz(22);
      if (this.left <= 0) {
        this.overAt = now;
        finish(s, 'brick', this.count);
        s.score(this.count, best(s, 'brick') || null);
        return;
      }
      this.serve(s);
    }
    for (let i = 0; i < this.atoms.length; i++) {
      const a = this.atoms[i], d = dist(a, b);
      if (d >= this.ar + nu.r) continue;
      const nx = (b.x - a.x) / (d || 1), ny = (b.y - a.y) / (d || 1), vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
      b.x = a.x + nx * (this.ar + nu.r);
      b.y = a.y + ny * (this.ar + nu.r);
      this.atoms.splice(i, 1);
      this.count++;
      s.fx.burst(a, 6, a.c, 0.08);
      chimeSound(this.count % 5);
      s.score(this.count, best(s, 'brick') || null);
      break;
    }
    if (!this.atoms.length) {
      this.wave++;
      completeSound();
      this.build(s);
      this.serve(s);
    }
    nu.x = b.x;
    nu.y = b.y;
    nu.vx = b.vx;
    nu.vy = b.vy;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const a of this.atoms) dot(ctx, a, this.ar, a.c, 0.9);
    const half = this.padW() / 2;
    bar(ctx, this.px - half, this.padY(s), this.px + half, this.padY(s), this.overAt ? K500 : WHITE, 10, 0.9);
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.overAt) { if (performance.now() - this.overAt > 900) this.reset(s); return; }
    this.want = p.x;
  }

  move(_s: Stage, p: Pt): void { this.want = p.x; }
  up(): void { this.want = null; }
}

// ---- More ------------------------------------------------------------------------------------

/** Two fields of atoms, one each side: tap the side with more before the rim runs out. The
 *  counts come closer and the time shorter as you go; later the atoms come in all sizes, to
 *  fool the eye. Three wrong and it's over. */
export class More implements Toy {
  private sides: { x: number; y: number; r: number }[][] = [[], []];
  private more = 0;
  private askAt = 0;
  private shownAt = 0;
  private answered: number | null = null;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private ms(): number { return Math.max(1800, 4200 - this.count * 130); }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    this.ask(s);
    s.score(0, best(s, 'more') || null);
  }

  private ask(s: Stage): void {
    const lo = 3 + Math.floor(Math.random() * Math.min(10, 3 + this.count));
    const diff = Math.max(1, Math.round(lo * Math.max(0.12, 0.6 - this.count * 0.04)));
    this.more = Math.random() < 0.5 ? 0 : 1;
    const mixed = this.count >= 6;
    this.sides = [0, 1].map((side) => {
      const n = side === this.more ? lo + diff : lo, out: { x: number; y: number; r: number }[] = [];
      const x0 = side ? s.m.x + 18 : s.m.x - s.hw + 16, x1 = side ? s.m.x + s.hw - 16 : s.m.x - 18;
      const y0 = s.m.y - s.hh + 46, y1 = s.m.y + s.hh - 20;
      for (let tries = 0; out.length < n && tries < 2000; tries++) {
        const r = mixed ? 4 + Math.random() * (side === this.more ? 4 : 7) : 6;
        const p = { x: x0 + r + Math.random() * (x1 - x0 - 2 * r), y: y0 + r + Math.random() * (y1 - y0 - 2 * r), r };
        if (out.every((q) => dist(p, q) > p.r + q.r + 8)) out.push(p);
      }
      return out;
    });
    this.askAt = performance.now();
    this.answered = null;
    s.rim = 1;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    const home = { x: s.m.x, y: s.m.y - s.hh + 22 };
    if (this.answered !== null && !this.overAt) {
      nu.seek({ x: s.m.x + (this.answered ? 1 : -1) * s.hw * 0.5, y: s.m.y }, dt, 0.8, 0.02);
      if (now - this.shownAt > 700) this.ask(s);
      return;
    }
    nu.seek(home, dt, 0.6, 0.03);
    if (this.overAt) { s.rim = 0; return; }
    const left = 1 - (now - this.askAt) / this.ms();
    s.rim = clamp(left, 0, 1);
    if (left <= 0) this.answer(s, now, 1 - this.more, true);
  }

  private answer(s: Stage, now: number, side: number, late = false): void {
    this.answered = side;
    this.shownAt = now;
    const at = { x: s.m.x + (side ? 1 : -1) * s.hw * 0.5, y: s.m.y };
    if (side === this.more && !late) {
      this.count++;
      s.fx.ring(at, GREEN, 16, 70, 600);
      chimeSound(this.count % 5);
    } else {
      this.left--;
      s.fx.ring(at, RED, 16, 70, 600);
      missSound();
      buzz(22);
      if (this.left <= 0) { this.overAt = now; finish(s, 'more', this.count); }
    }
    s.score(this.count, best(s, 'more') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    ctx.setLineDash([8, 10]);
    bar(ctx, s.m.x, s.m.y - s.hh + 40, s.m.x, s.m.y + s.hh - 16, K500, 3, 0.8);
    ctx.restore();
    this.sides.forEach((side, i) => {
      const lit = this.answered !== null && i === this.more;
      for (const a of side) dot(ctx, a, a.r, lit ? GREEN : CYAN, this.overAt ? 0.4 : 0.9);
    });
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) { if (now - this.overAt > 900) { this.reset(s); } return; }
    if (this.answered !== null) return;
    this.answer(s, now, p.x < s.m.x ? 0 : 1);
  }
}

// ---- Stick -----------------------------------------------------------------------------------

/** Nu turns in the middle of the court, a few electrons already on its shell. Tap and an electron
 *  flies up from the bottom; it sticks to the shell where it lands and turns with Nu. Never onto
 *  one already there. Each round a few more to place, the turning faster and less even. */
export class Stick implements Toy {
  court = true;
  private rot = 0;
  private turn = 1;
  private stuck: number[] = [];
  private shot: number | null = null;
  private toGo = 5;
  private round = 0;
  private count = 0;
  private nextAt = 0;
  private overAt = 0;
  private er = 8;
  private shell(s: Stage): number { return s.R * 0.42; }
  private launch(s: Stage): number { return s.c.y + s.R - 46; }

  enter(s: Stage): void {
    s.nu.r = 16;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.round = 0;
    this.count = 0;
    this.overAt = 0;
    this.newRound();
    s.score(0, best(s, 'stick') || null);
  }

  private newRound(): void {
    this.toGo = 5 + this.round;
    this.turn = Math.random() < 0.5 ? -1 : 1;
    this.stuck = [];
    const n = Math.min(4, 1 + Math.floor(this.round / 2));
    for (let i = 0; i < n; i++) this.stuck.push((i / n) * TAU + Math.random() * 0.6);
    this.shot = null;
    this.nextAt = 0;
  }

  private rate(now: number): number {
    const base = 0.0014 + Math.min(0.0016, this.round * 0.00025);
    // Later rounds speed up and slow down, and, later still, turn back.
    const wave = this.round >= 4 ? Math.sin(now / 1300) * 1.5 : this.round >= 2 ? 1 + Math.sin(now / 900) * 0.6 : 1;
    return base * this.turn * wave;
  }

  step(s: Stage, dt: number, now: number): void {
    s.nu.seek(s.c, dt, 0.5, 0.02);
    if (this.overAt) return;
    this.rot += this.rate(now) * dt;
    if (this.nextAt && now >= this.nextAt) { this.round++; this.newRound(); return; }
    if (this.shot === null) return;
    this.shot -= 1.1 * dt;
    const end = s.c.y + this.shell(s);
    if (this.shot > end) return;
    this.shot = null;
    const a = Math.PI / 2 - this.rot, room = 2 * Math.asin(Math.min(1, this.er / this.shell(s))) * 1.1;
    const at = { x: s.c.x, y: end };
    if (this.stuck.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < room)) {
      this.overAt = now;
      s.fx.ring(at, RED, this.er, 34, 600);
      missSound();
      buzz(30);
      finish(s, 'stick', this.count);
      s.score(this.count, best(s, 'stick') || null);
      return;
    }
    this.stuck.push(a);
    this.count++;
    this.toGo--;
    s.fx.ring(at, CYAN, this.er, this.er + 16, 400);
    chimeSound(this.count % 5);
    s.score(this.count, best(s, 'stick') || null);
    if (!this.toGo) { completeSound(); this.nextAt = now + 700; }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const R = this.shell(s);
    dashed(ctx, s.c, R, K500, 0.6);
    for (const a of this.stuck) dot(ctx, { x: s.c.x + Math.cos(a + this.rot) * R, y: s.c.y + Math.sin(a + this.rot) * R }, this.er, CYAN, 0.9);
    const ly = this.launch(s);
    if (this.shot !== null) dot(ctx, { x: s.c.x, y: this.shot }, this.er, CYAN);
    else if (!this.overAt && !this.nextAt) dot(ctx, { x: s.c.x, y: ly }, this.er, WHITE, 0.9);
    // The electrons still to place, after this one.
    const rest = Math.max(0, this.toGo - (this.shot === null && !this.nextAt ? 1 : 0));
    for (let i = 0; i < rest; i++) dot(ctx, { x: s.c.x + (i - (rest - 1) / 2) * 12, y: ly + 24 }, 3, K300, 0.7);
    s.nu.draw(ctx, now);
  }

  down(s: Stage): void {
    const now = performance.now();
    if (this.overAt) { if (now - this.overAt > 900) this.reset(s); return; }
    if (this.shot !== null || this.nextAt) return;
    this.shot = this.launch(s);
    tickSound(2);
  }
}

// ---- Flip ------------------------------------------------------------------------------------

/** Nu runs along the floor of a long room, red blocks coming at it from floor and ceiling. Tap
 *  and Nu falls up to the ceiling (and tap again, back down), to pass each block on the side
 *  it isn't on. Faster as it goes; one touch and it's over. */
export class Flip implements Toy {
  private side = 1;
  private vy = 0;
  private blocks: { x: number; side: number; h: number; passed: boolean }[] = [];
  private gapTo = 0;
  private count = 0;
  private overAt = 0;
  /** Flying in to the floor first, from wherever Nu was. */
  private settling = true;
  private bw = 22;
  private floorY(s: Stage): number { return s.m.y + Math.min(s.hh - 40, 150); }
  private ceilY(s: Stage): number { return s.m.y - Math.min(s.hh - 40, 150); }
  private runX(s: Stage): number { return s.m.x - s.hw * 0.5; }
  private speed(): number { return 0.2 + Math.min(0.15, this.count * 0.005); }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.side = 1;
    this.vy = 0;
    this.settling = true;
    this.blocks = [];
    this.gapTo = 120;
    this.count = 0;
    this.overAt = 0;
    s.score(0, best(s, 'flip') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, fy = this.floorY(s), cy = this.ceilY(s), room = fy - cy;
    if (this.settling) {
      const to = { x: this.runX(s), y: fy - nu.r };
      nu.seek(to, dt, 0.6, 0.03);
      if (dist(nu, to) > 3) return;
      this.settling = false;
      this.vy = 0;
    }
    nu.x += (this.runX(s) - nu.x) * (1 - Math.exp(-dt / 160));
    nu.vx = 0;
    // Falls toward the side it's on, and rests there.
    this.vy = clamp(this.vy + this.side * 0.0026 * dt, -0.9, 0.9);
    nu.y += this.vy * dt;
    if (nu.y + nu.r > fy) { nu.y = fy - nu.r; this.vy = 0; }
    if (nu.y - nu.r < cy) { nu.y = cy + nu.r; this.vy = 0; }
    nu.vy = this.vy;
    if (this.overAt) return;
    const v = this.speed();
    this.gapTo -= v * dt;
    if (this.gapTo <= 0) {
      const side = Math.random() < 0.5 ? 1 : -1;
      this.blocks.push({ x: s.m.x + s.hw + this.bw, side, h: room * (0.3 + Math.random() * 0.22), passed: false });
      // Room after a block to get across, less as it speeds up, never too little.
      this.gapTo = Math.max(130, 220 - this.count * 3) + Math.random() * 120;
    }
    for (const b of this.blocks) {
      b.x -= v * dt;
      const top = b.side > 0 ? fy - b.h : cy, bot = b.side > 0 ? fy : cy + b.h;
      const qx = clamp(nu.x, b.x - this.bw / 2, b.x + this.bw / 2), qy = clamp(nu.y, top, bot);
      if (Math.hypot(nu.x - qx, nu.y - qy) < nu.r - 1) {
        this.overAt = now;
        s.fx.ring(nu, RED, nu.r, nu.r + 30, 600);
        missSound();
        buzz(26);
        finish(s, 'flip', this.count);
        s.score(this.count, best(s, 'flip') || null);
        return;
      }
      if (!b.passed && b.x + this.bw / 2 < nu.x - nu.r) {
        b.passed = true;
        this.count++;
        tickSound(this.count % 5);
        s.score(this.count, best(s, 'flip') || null);
      }
    }
    this.blocks = this.blocks.filter((b) => b.x > s.m.x - s.hw - this.bw * 2);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const fy = this.floorY(s), cy = this.ceilY(s), x0 = s.m.x - s.hw - 10, x1 = s.m.x + s.hw + 10;
    bar(ctx, x0, fy + 2, x1, fy + 2, K500, 4, 0.9);
    bar(ctx, x0, cy - 2, x1, cy - 2, K500, 4, 0.9);
    ctx.save();
    for (const b of this.blocks) {
      const top = b.side > 0 ? fy - b.h : cy;
      ctx.beginPath();
      ctx.roundRect(b.x - this.bw / 2, top, this.bw, b.h, this.bw / 2);
      ctx.globalAlpha = this.overAt ? 0.12 : 0.25;
      ctx.fillStyle = RED;
      ctx.fill();
      ctx.globalAlpha = this.overAt ? 0.45 : 0.85;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
    s.nu.draw(ctx, now);
  }

  down(s: Stage): void {
    if (this.overAt) { if (performance.now() - this.overAt > 900) this.reset(s); return; }
    if (this.settling) return;
    this.side = -this.side;
    this.vy = this.side * 0.12;
    tickSound(1);
  }
}
