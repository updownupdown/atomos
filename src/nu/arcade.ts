// More of Nu's park (park.ts), on the same kit:
//   Hockey  air hockey against Nu: your paddle at the bottom, Nu guarding the top; first to 5.
//   Chain   steer Nu to catch electrons; each one trails behind it. Don't run into the chain.
//   Split   Nu carries a shell along the bottom; bounce a neutron up to split the nuclei.
//   Pairs   atom cards face down; turn two at a time to find the pairs, in as few turns as you can.

import {
  CYAN, K300, K500, K800, K900, NOTE_COLOURS, RED, TAU, WHITE,
  best, bounceIn, buzz, chimeSound, clamp, completeSound, dist, dot, edge, inside, missSound, ring, setBest, tickSound,
  type Mover, type Pt, type Stage, type Toy,
} from './kit';
import { ELEMENTS, placeColour } from '../gallery/data';
import { inkOn } from '../gallery/looks';

// ---- Hockey ----------------------------------------------------------------------------------

/** Air hockey against Nu. Your paddle follows your finger in the bottom half; Nu defends the
 *  top goal and strikes when the puck comes its way. Each match you win, Nu plays a little
 *  quicker. */
export class Hockey implements Toy {
  private puck: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private me: Mover = { x: 0, y: 0, vx: 0, vy: 0 };
  private finger: Pt | null = null;
  private you = 0;
  private them = 0;
  private wins = 0;
  private wait = 0;
  private state: 'play' | 'over' = 'play';
  private flash: { at: number; top: boolean } | null = null;
  private static PUCK = 10;
  private static PAD = 22;
  private static TO = 5;
  private mouth(s: Stage): number { return Math.min(s.hw * 0.9, 130) / 2; }

  enter(s: Stage): void {
    s.nu.r = 18;
    this.you = this.them = 0;
    this.state = 'play';
    this.me = { x: s.c.x, y: s.c.y + s.hh * 0.6, vx: 0, vy: 0 };
    this.serve(s, Math.random() < 0.5);
    this.say(s);
  }

  private say(s: Stage): void { s.score(`${this.you} : ${this.them}`, best(s, 'hockey') || null); }

  /** The puck back in the middle, drifting toward whoever conceded. */
  private serve(s: Stage, toMe: boolean): void {
    this.puck = { x: s.c.x, y: s.c.y, vx: (Math.random() - 0.5) * 0.1, vy: toMe ? 0.12 : -0.12 };
    this.wait = 700;
  }

  /** The puck off a paddle (a circle moving at `v`), keeping some of the paddle's speed. */
  private hit(pad: Mover, r: number): boolean {
    const d = dist(this.puck, pad), min = r + Hockey.PUCK;
    if (d >= min || d === 0) return false;
    const nx = (this.puck.x - pad.x) / d, ny = (this.puck.y - pad.y) / d;
    this.puck.x = pad.x + nx * min;
    this.puck.y = pad.y + ny * min;
    const rvx = this.puck.vx - pad.vx, rvy = this.puck.vy - pad.vy, vn = rvx * nx + rvy * ny;
    if (vn < 0) { this.puck.vx -= 1.9 * vn * nx; this.puck.vy -= 1.9 * vn * ny; }
    this.puck.vx += pad.vx * 0.4;
    this.puck.vy += pad.vy * 0.4;
    const sp = Math.hypot(this.puck.vx, this.puck.vy);
    if (sp > 1.3) { this.puck.vx *= 1.3 / sp; this.puck.vy *= 1.3 / sp; }
    return true;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, top = s.c.y - s.hh, bottom = s.c.y + s.hh, m = this.mouth(s);
    // Your paddle: to your finger, quickly but not instantly, in your half.
    const ox = this.me.x, oy = this.me.y;
    if (this.finger) {
      const to = inside(s, { x: this.finger.x, y: Math.max(s.c.y + Hockey.PAD + 4, this.finger.y) }, Hockey.PAD);
      const k = 1 - Math.exp(-dt / 30);
      this.me.x += (to.x - this.me.x) * k;
      this.me.y += (to.y - this.me.y) * k;
    }
    this.me.vx = (this.me.x - ox) / Math.max(1, dt);
    this.me.vy = (this.me.y - oy) / Math.max(1, dt);
    // Nu: guards its goal, and goes for the puck in its half.
    const quick = 0.32 + this.wins * 0.04;
    const mine = this.puck.y < s.c.y;
    const guard = { x: s.c.x + clamp(this.puck.x - s.c.x, -m, m) * 0.8, y: top + 46 };
    const strike = { x: this.puck.x, y: Math.max(top + 24, this.puck.y - 16) };
    const nox = nu.x, noy = nu.y;
    nu.seek(mine && this.puck.vy < 0.35 ? strike : guard, dt, quick, 0.03);
    if (nu.y > s.c.y - nu.r - 4) nu.y = s.c.y - nu.r - 4;
    Object.assign(nu, inside(s, nu, nu.r));
    nu.vx = (nu.x - nox) / Math.max(1, dt);
    nu.vy = (nu.y - noy) / Math.max(1, dt);
    if (this.state === 'over') return;
    if (this.wait > 0) { this.wait -= dt; return; }
    // The puck: a few small steps a frame, so it never passes through a paddle.
    const steps = Math.ceil(dt / 5), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const pk = this.puck;
      pk.x += pk.vx * h;
      pk.y += pk.vy * h;
      const f = Math.pow(0.9994, h);
      pk.vx *= f;
      pk.vy *= f;
      if (this.hit(this.me, Hockey.PAD)) tickSound(1);
      if (this.hit(nu, nu.r)) tickSound(3);
      // Through a goal mouth: a goal. Elsewhere the rim bounces it.
      const inMouth = Math.abs(pk.x - s.c.x) < m - Hockey.PUCK * 0.5;
      if (inMouth && pk.y < top - Hockey.PUCK) return this.goal(s, now, true);
      if (inMouth && pk.y > bottom + Hockey.PUCK) return this.goal(s, now, false);
      if (!(inMouth && (pk.y < top + Hockey.PUCK || pk.y > bottom - Hockey.PUCK))) {
        if (bounceIn(s, pk, Hockey.PUCK, 0.9)) tickSound(0);
      } else if (edge(s, { x: pk.x, y: s.c.y }).d > -Hockey.PUCK) bounceIn(s, pk, Hockey.PUCK, 0.9);
    }
  }

  private goal(s: Stage, now: number, mine: boolean): void {
    if (mine) this.you++; else this.them++;
    this.flash = { at: now, top: mine };
    if (mine) { completeSound(); buzz(14); } else missSound();
    if (this.you >= Hockey.TO || this.them >= Hockey.TO) {
      this.state = 'over';
      if (this.you > this.them) { this.wins++; setBest(s, 'hockey', this.wins); s.fx.burst(s.c, 18, WHITE, 0.15); }
      this.puck = { x: s.c.x, y: s.c.y, vx: 0, vy: 0 };
    } else this.serve(s, mine);
    this.say(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const top = s.c.y - s.hh, bottom = s.c.y + s.hh, m = this.mouth(s);
    // The middle line and circle, and the goals: Nu's (your target) red, yours gray.
    ctx.fillStyle = K800;
    ctx.fillRect(s.c.x - s.hw, s.c.y - 1, s.hw * 2, 2);
    ring(ctx, s.c, 44, K800, 2);
    const flash = this.flash ? clamp(1 - (now - this.flash.at) / 700, 0, 1) : 0;
    ctx.fillStyle = RED;
    ctx.globalAlpha = 0.8 + 0.2 * (this.flash?.top ? flash : 0);
    ctx.fillRect(s.c.x - m, top, m * 2, 5);
    ctx.fillStyle = K300;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(s.c.x - m, bottom - 5, m * 2, 5);
    ctx.globalAlpha = 1;
    if (flash > 0 && this.flash) dot(ctx, { x: s.c.x, y: this.flash.top ? top : bottom }, m * (1.4 - flash * 0.4), this.flash.top ? RED : K500, 0.25 * flash);
    // Your paddle, the puck, Nu.
    ring(ctx, this.me, Hockey.PAD - 1.5, WHITE, 3);
    dot(ctx, this.me, 7, WHITE);
    ctx.save();
    ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
    ctx.shadowBlur = 10;
    dot(ctx, this.puck, Hockey.PUCK, CYAN);
    ctx.restore();
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'over') { this.enter(s); return; }
    this.finger = p;
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

// ---- Chain -----------------------------------------------------------------------------------

/** Nu glides on, turning toward your finger. Each electron it catches joins the chain behind
 *  it; run into the chain and it's over. Quicker as the chain grows. */
export class Chain implements Toy {
  private finger: Pt | null = null;
  private heading = -Math.PI / 2;
  private path: Pt[] = [];
  private length = 0;
  private food: Pt = { x: 0, y: 0 };
  private state: 'ready' | 'run' | 'over' = 'ready';
  private overAt = 0;
  private static GAP = 14;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.state = 'ready';
    this.length = 0;
    this.path = [];
    this.heading = -Math.PI / 2;
    this.feed(s);
    s.score(0, best(s, 'chain') || null);
  }

  private feed(s: Stage): void {
    for (let i = 0; i < 40; i++) {
      const p = { x: s.c.x + (Math.random() * 2 - 1) * (s.hw - 30), y: s.c.y + (Math.random() * 2 - 1) * (s.hh - 30) };
      if (edge(s, p).d < -24 && dist(p, s.nu) > 80 && this.links().every((q) => dist(q, p) > 24)) { this.food = p; return; }
    }
    this.food = { ...s.c };
  }

  /** Where each link of the chain is: spaced along the way Nu came. */
  private links(): Pt[] {
    const out: Pt[] = [];
    let want = Chain.GAP, acc = 0;
    for (let i = 1; i < this.path.length && out.length < this.length; i++) {
      acc += dist(this.path[i - 1], this.path[i]);
      if (acc >= want) { out.push(this.path[i]); want += Chain.GAP; }
    }
    return out;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state !== 'run') {
      if (this.state === 'ready') nu.seek({ x: s.c.x, y: s.c.y + Math.sin(now / 700) * 4 }, dt, 0.3, 0.01);
      return;
    }
    // Turns toward the finger, a little at a time, and always moves on.
    if (this.finger) {
      const want = Math.atan2(this.finger.y - nu.y, this.finger.x - nu.x);
      const d = ((want - this.heading + Math.PI * 3) % TAU) - Math.PI;
      this.heading += clamp(d, -0.0055 * dt, 0.0055 * dt);
    }
    const sp = 0.13 + Math.min(0.12, this.length * 0.004);
    nu.vx = Math.cos(this.heading) * sp;
    nu.vy = Math.sin(this.heading) * sp;
    nu.x += nu.vx * dt;
    nu.y += nu.vy * dt;
    if (bounceIn(s, nu, nu.r, 1)) this.heading = Math.atan2(nu.vy, nu.vx);
    this.path.unshift({ x: nu.x, y: nu.y });
    if (this.path.length > 1200) this.path.length = 1200;
    if (dist(nu, this.food) < nu.r + 7) {
      this.length++;
      chimeSound(this.length % 5);
      s.fx.ring(this.food, CYAN, 6, 26, 400);
      s.score(this.length, best(s, 'chain') || null);
      this.feed(s);
    }
    // Into its own chain (past the first few links, which always trail close).
    if (this.links().slice(3).some((q) => dist(q, nu) < nu.r + 3)) {
      this.state = 'over';
      this.overAt = now;
      setBest(s, 'chain', this.length);
      s.fx.ring(nu, RED, 8, 40, 600);
      missSound();
      buzz(30);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();
    ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
    ctx.shadowBlur = 10;
    dot(ctx, this.food, 5.5, CYAN);
    ctx.restore();
    const fade = this.state === 'over' ? clamp(1 - (now - this.overAt) / 900, 0.3, 1) : 1;
    for (const q of this.links()) dot(ctx, q, 4.5, CYAN, 0.8 * fade);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'over') { if (performance.now() - this.overAt > 500) this.enter(s); return; }
    if (this.state === 'ready') { this.state = 'run'; this.path = [{ x: s.nu.x, y: s.nu.y }]; }
    this.finger = p;
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

// ---- Split -----------------------------------------------------------------------------------

/** Nu carries a shell along the bottom, under your finger. A neutron bounces off it up into the
 *  nuclei above, splitting each nucleon it hits. Miss it three times and the round is over;
 *  clear the nuclei and more come, closer together. */
export class Split implements Toy {
  private ball: Mover & { on: boolean } = { x: 0, y: 0, vx: 0, vy: 0, on: false };
  private bricks: { x: number; y: number; proton: boolean; hue: string }[] = [];
  private lives = 3;
  private wave = 1;
  private count = 0;
  private finger: Pt | null = null;
  private state: 'play' | 'over' = 'play';
  private static SHELL = 42;
  private static BALL = 6;
  private static NUC = 8;
  private y(s: Stage): number { return s.c.y + s.hh - 40; }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.lives = 3;
    this.wave = 1;
    this.count = 0;
    this.state = 'play';
    this.build(s);
    s.score(0, best(s, 'split') || null);
  }

  /** A few nuclei, clusters of protons (filled) and neutrons (rings), across the top. */
  private build(s: Stage): void {
    this.bricks = [];
    const n = Math.min(6, 2 + this.wave), cols = n <= 3 ? n : Math.ceil(n / 2), rows = Math.ceil(n / cols);
    const w = (s.hw * 2 - 40) / cols, h = Math.min(110, (s.hh * 0.9) / rows);
    for (let k = 0; k < n; k++) {
      const cx = s.c.x - s.hw + 20 + w * ((k % cols) + 0.5), cy = s.c.y - s.hh + 30 + h * (Math.floor(k / cols) + 0.5);
      const size = 5 + Math.min(7, this.wave + (k % 3)), hue = NOTE_COLOURS[k % 4];
      for (let i = 0; i < size; i++) {
        // Packed round the middle: a golden-angle spiral.
        const r = Split.NUC * 1.9 * Math.sqrt(i), a = i * 2.4;
        this.bricks.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, proton: i % 2 === 0, hue });
      }
    }
    this.ball.on = false;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, y = this.y(s);
    if (this.finger) nu.seek({ x: clamp(this.finger.x, s.c.x - s.hw + Split.SHELL, s.c.x + s.hw - Split.SHELL), y }, dt, 1.2, 0.05);
    else nu.seek({ x: nu.x, y }, dt, 0.3, 0.02);
    const b = this.ball;
    if (!b.on) { b.x = nu.x; b.y = y - Split.SHELL * 0.55; return; }
    const steps = Math.ceil(dt / 5), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      b.x += b.vx * h;
      b.y += b.vy * h;
      if (b.y < s.c.y + s.hh - Split.BALL) bounceIn(s, b, Split.BALL, 1);
      // Off the shell: an arc over Nu, so where it lands steers it.
      const d = dist(b, nu);
      if (b.vy > 0 && d < Split.SHELL * 0.55 + Split.BALL && b.y < nu.y) {
        const a = clamp((b.x - nu.x) / (Split.SHELL * 0.55), -1, 1) * 1.05, sp = Math.min(0.62, Math.hypot(b.vx, b.vy) * 1.01);
        b.vx = Math.sin(a) * sp;
        b.vy = -Math.cos(a) * sp;
        tickSound(1);
      }
      const hit = this.bricks.findIndex((q) => dist(q, b) < Split.NUC + Split.BALL);
      if (hit >= 0) {
        const q = this.bricks[hit];
        this.bricks.splice(hit, 1);
        const nx = (b.x - q.x) / (dist(b, q) || 1), ny = (b.y - q.y) / (dist(b, q) || 1), vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
        this.count++;
        s.fx.burst(q, 5, q.proton ? q.hue : WHITE, 0.08);
        tickSound(this.count % 5);
        s.score(this.count, best(s, 'split') || null);
        if (!this.bricks.length) { this.wave++; completeSound(); this.build(s); return; }
      }
      if (b.y > s.c.y + s.hh + Split.BALL) {
        this.lives--;
        missSound();
        buzz(20);
        b.on = false;
        if (this.lives <= 0) { this.state = 'over'; setBest(s, 'split', this.count); }
        return;
      }
    }
    void now;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const q of this.bricks) {
      if (q.proton) dot(ctx, q, Split.NUC - 1, q.hue);
      else ring(ctx, q, Split.NUC - 2, q.hue, 2.5);
    }
    // The lives left: small dots at the foot.
    for (let i = 0; i < this.lives; i++) dot(ctx, { x: s.c.x - 12 + i * 12, y: s.c.y + s.hh - 10 }, 3, K500);
    const nu = s.nu;
    ctx.save();
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(nu.x, nu.y, Split.SHELL * 0.55, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
    ctx.restore();
    if (this.state === 'play') ring(ctx, this.ball, Split.BALL - 1, WHITE, 2.5);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'over') { this.enter(s); return; }
    this.finger = p;
    if (!this.ball.on) {
      this.ball.on = true;
      const a = (Math.random() - 0.5) * 0.8;
      this.ball.vx = Math.sin(a) * 0.42;
      this.ball.vy = -Math.cos(a) * 0.42;
    }
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

// ---- Pairs -----------------------------------------------------------------------------------

/** A round atom card: its symbol and number on the colour of its place in the table. */
type Glyph = { z: number; symbol: string; colour: string; ink: string };

/** Atom cards face down. Turn two at a time (Nu flies to each); a pair stays up. Find them all
 *  in as few turns as you can: the best is the fewest. */
export class Pairs implements Toy {
  private tiles: { p: Pt; g: Glyph; up: boolean; done: boolean; turned: number }[] = [];
  private open: number[] = [];
  private turns = 0;
  private hold = 0;
  private flyTo: Pt | null = null;
  private doneAt = 0;
  private size = 26;

  enter(s: Stage): void {
    s.nu.r = 8;
    this.deal(s);
  }

  resize(s: Stage): void {
    const old = this.tiles;
    this.deal(s);
    if (old.length === this.tiles.length) this.tiles.forEach((t, i) => { t.g = old[i].g; t.up = old[i].up; t.done = old[i].done; });
  }

  private deal(s: Stage): void {
    const cols = 4, rows = s.hh > s.hw * 1.25 ? 5 : 4, n = cols * rows;
    // Atoms from all over the table, so no two cards look alike.
    const pool = ELEMENTS.slice().sort(() => Math.random() - 0.5).slice(0, n / 2);
    const glyphs: Glyph[] = pool.map((e) => { const colour = placeColour(e); return { z: e.z, symbol: e.symbol, colour, ink: inkOn(colour) }; });
    const deck = [...glyphs, ...glyphs].sort(() => Math.random() - 0.5);
    const gx = (s.hw * 2 - 30) / cols, gy = (s.hh * 2 - 30) / rows;
    this.size = Math.min(gx, gy) * 0.42;
    this.tiles = deck.map((g, i) => ({
      p: { x: s.c.x - s.hw + 15 + gx * ((i % cols) + 0.5), y: s.c.y - s.hh + 15 + gy * (Math.floor(i / cols) + 0.5) },
      g, up: false, done: false, turned: 0,
    }));
    this.open = [];
    this.turns = 0;
    this.doneAt = 0;
    s.score(0, (s.bests.pairs as number | undefined) ?? null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    nu.seek(this.flyTo ?? s.c, dt, 0.8, 0.03);
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) {
        for (const i of this.open) this.tiles[i].up = false;
        this.open = [];
      }
    }
    if (this.doneAt && now - this.doneAt > 1800) this.deal(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const r = this.size;
    for (const t of this.tiles) {
      const flip = clamp((now - t.turned) / 180, 0, 1), showing = t.up || t.done;
      if (!showing) { dot(ctx, t.p, r, K900); ring(ctx, t.p, r, K500, 2, 0.7); continue; }
      // The card turns over: it grows from a sliver to the full atom card.
      const g = t.g, rr = r * (0.6 + 0.4 * flip);
      dot(ctx, t.p, rr, g.colour, t.done ? 0.75 : 1);
      if (flip > 0.5) {
        ctx.save();
        ctx.fillStyle = g.ink;
        ctx.globalAlpha = t.done ? 0.75 : 1;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.round(r * 0.72)}px Outfit, system-ui, sans-serif`;
        ctx.fillText(g.symbol, t.p.x, t.p.y + r * 0.1);
        ctx.font = `500 ${Math.max(13, Math.round(r * 0.3))}px Outfit, system-ui, sans-serif`;
        ctx.fillText(String(g.z), t.p.x, t.p.y - r * 0.5);
        ctx.restore();
      }
      if (t.done) ring(ctx, t.p, r, g.colour, 2, 0.5);
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.doneAt || this.hold > 0) return;
    const i = this.tiles.findIndex((t) => dist(t.p, p) < this.size + 6);
    if (i < 0) return;
    const t = this.tiles[i];
    if (t.up || t.done) return;
    t.up = true;
    t.turned = performance.now();
    this.flyTo = t.p;
    this.open.push(i);
    tickSound(this.open.length);
    if (this.open.length < 2) return;
    this.turns++;
    const [a, b] = this.open.map((k) => this.tiles[k]);
    if (a.g.z === b.g.z) {
      a.done = b.done = true;
      this.open = [];
      chimeSound(a.g.z % 5);
      s.fx.ring(a.p, a.g.colour, this.size, this.size + 18, 500);
      s.fx.ring(b.p, b.g.colour, this.size, this.size + 18, 500);
      if (this.tiles.every((q) => q.done)) {
        this.doneAt = performance.now();
        completeSound();
        const was = s.bests.pairs as number | undefined;
        if (!was || this.turns < was) { s.bests.pairs = this.turns; s.save(); }
        s.fx.burst(s.c, 18, WHITE, 0.15);
      }
    } else this.hold = 800;
    s.score(this.turns, (s.bests.pairs as number | undefined) ?? null);
  }
}
