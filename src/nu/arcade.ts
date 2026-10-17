// More of Nu's park (park.ts), on the same kit:
//   Hockey  air hockey against Nu: your paddle at the bottom, Nu guarding the top; first to 5.
//   Chain   steer Nu to catch electrons; each one trails behind it. Don't run into the chain.
//   Split   Nu carries a shell along the bottom; bounce a neutron up to split the nuclei.
//   Pairs   atom cards face down; turn two at a time to find the pairs, in as few turns as you can.

import {
  CYAN, K300, K500, K800, K900, NOTE_COLOURS, RED, ROSE, TAU, WHITE,
  best, hitSound, bounceIn, buzz, chimeSound, clamp, completeSound, dist, dot, edge, inside, missSound, ring, finish, setBest, tickSound,
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

  tally = true;
  raw(): number { return this.you; }
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
      s.end?.(this.you);
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

// ---- Pairs -----------------------------------------------------------------------------------

/** A round atom card: its symbol and number on the colour of its place in the table. */
type Glyph = { z: number; symbol: string; colour: string; ink: string };

/** Atom cards face down. Turn two at a time (Nu flies to each); a pair stays up. Find them all
 *  in as few turns as you can: the best is the fewest. */
export class Pairs implements Toy {
  private tiles: { p: Pt; g: Glyph; up: boolean; done: boolean; turned: number; matched: number }[] = [];
  /** Nu's little celebration of a pair: when, and the two cards it loops round. */
  private cheer: { at: number; a: Pt; b: Pt } | null = null;
  private open: number[] = [];
  private turns = 0;
  private hold = 0;
  private flyTo: Pt | null = null;
  private doneAt = 0;
  private size = 26;
  tally = true;

  /** Turns for each pair, so far: two more turns for each pair still to find. */
  raw(): number {
    const pairs = this.tiles.length / 2, left = this.tiles.filter((t) => !t.done).length / 2;
    return pairs ? (this.turns + left * 2) / pairs : 0;
  }

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
      g, up: false, done: false, turned: 0, matched: 0,
    }));
    this.open = [];
    this.turns = 0;
    this.doneAt = 0;
    s.score(0, (s.bests.pairs as number | undefined) ?? null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    // Nu keeps round the card it's looking at, never on it, so the atom's name stays clear.
    // A pair found: it loops round the two cards, a little bigger and brighter.
    const ch = this.cheer && now - this.cheer.at < 1100 ? this.cheer : null;
    nu.scale = ch ? 1 + 0.25 * Math.sin(((now - ch.at) / 1100) * Math.PI) : 1;
    nu.glow = ch ? 2.2 : 1;
    let to: Pt = s.c;
    if (ch) {
      const m = { x: (ch.a.x + ch.b.x) / 2, y: (ch.a.y + ch.b.y) / 2 }, half = dist(ch.a, ch.b) / 2 + this.size + 10;
      const a = ((now - ch.at) / 1100) * TAU, ang = Math.atan2(ch.b.y - ch.a.y, ch.b.x - ch.a.x);
      const ex = Math.cos(a) * half, ey = Math.sin(a) * (this.size + 12);
      to = { x: m.x + ex * Math.cos(ang) - ey * Math.sin(ang), y: m.y + ex * Math.sin(ang) + ey * Math.cos(ang) };
    } else if (this.flyTo) {
      const a = now / 700;
      to = { x: this.flyTo.x + Math.cos(a) * (this.size + 12), y: this.flyTo.y + Math.sin(a) * (this.size + 12) };
    }
    nu.seek(to, dt, ch ? 1.4 : 0.8, ch ? 0.08 : 0.03);
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
      // A pair glows a moment when found, then settles at half strength: done.
      const g = t.g, rr = r * (0.6 + 0.4 * flip), since = now - t.matched;
      const glow = t.done ? clamp(1 - (since - 500) / 600, 0, 1) : 0, alpha = t.done ? 0.5 + 0.5 * glow : 1;
      if (glow > 0) {
        ctx.save();
        ctx.shadowColor = g.colour;
        ctx.shadowBlur = 26 * glow;
        dot(ctx, t.p, rr + 3 * glow, g.colour, alpha);
        ctx.restore();
      } else dot(ctx, t.p, rr, g.colour, alpha);
      if (flip > 0.5) {
        ctx.save();
        ctx.fillStyle = g.ink;
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.round(r * 0.72)}px Outfit, system-ui, sans-serif`;
        ctx.fillText(g.symbol, t.p.x, t.p.y + r * 0.1);
        ctx.font = `500 ${Math.max(13, Math.round(r * 0.3))}px Outfit, system-ui, sans-serif`;
        ctx.fillText(String(g.z), t.p.x, t.p.y - r * 0.5);
        ctx.restore();
      }
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
      a.matched = b.matched = performance.now();
      this.cheer = { at: performance.now(), a: a.p, b: b.p };
      this.flyTo = null;
      s.fx.burst({ x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 }, 8, ROSE, 0.1);
      this.open = [];
      hitSound(a.g.z / 118);
      s.fx.ring(a.p, a.g.colour, this.size, this.size + 18, 500);
      s.fx.ring(b.p, b.g.colour, this.size, this.size + 18, 500);
      if (this.tiles.every((q) => q.done)) {
        this.doneAt = performance.now();
        completeSound();
        const was = s.bests.pairs as number | undefined;
        if (!was || this.turns < was) { s.bests.pairs = this.turns; s.save(); }
        s.fx.burst(s.c, 18, WHITE, 0.15);
        s.end?.(this.turns / (this.tiles.length / 2));
      }
    } else this.hold = 800;
    s.score(this.turns, (s.bests.pairs as number | undefined) ?? null);
  }
}
