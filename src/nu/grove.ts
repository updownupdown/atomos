// Six more of Nu's park games (park.ts), on the same kit:
//   Land    Nu falls; hold to fire it up, and lean the finger left or right to drift that way.
//           Set it down gently on the green pad, along its lane, in the wind. The rim is the fuel.
//   Order   atoms of all sizes: tap them smallest first, up to the biggest, before the rim runs out.
//   Pop     fire atoms up from Nu at the cluster above; three or more of a color together pop,
//           and whatever hangs from them falls. Every few shots the cluster comes down a row.
//   Ready   wait for Nu to glow green, then tap, quick. Not before, and never on red.
//   Recall  some dots light up for a moment; tap the same ones back. One more each time.
//   Swing   press near a dot to hook on and swing, slide up or down to reel the rope; let go to
//           fly on. Don't fall, and don't touch the red.

import {
  CYAN, GREEN, K300, K500, K800, NOTE_COLOURS, RED, TAU, WHITE,
  best, buzz, chimeSound, clamp, completeSound, dashed, dist, dot, finish, missSound, ring, tickSound,
  type Pt, type Stage, type Toy,
} from './kit';
import { bar, lives } from './lawn';

// ---- Land ------------------------------------------------------------------------------------

/** Fast enough to hurt, coming down (px/ms), and how far off the pad's lane it may come in. */
const LAND_SAFE = 0.15;
const LAND_SLACK = 0.38;

/** Nu drops in from the top and falls. Hold to fire it upward (the finger left or right of Nu
 *  pushes it that way too); let go and it falls again. A ring round Nu shows its speed: green
 *  while it's slow enough and coming in along the pad's lane (the dots rising from the pad),
 *  red when not. Down green on the pad and it counts; the pad shrinks, its lane leans, and later
 *  a wind pushes. Too hard, off the lane or off the pad costs one of three lives. The rim is the
 *  fuel for each landing. */
export class Land implements Toy {
  private vx = 0;
  private vy = 0;
  private finger: Pt | null = null;
  private fuel = 1;
  /** The pad, and the lean of its lane from straight down (+ comes in moving right). */
  private pad = { x: 0, w: 70, lean: 0 };
  /** The wind's push across (px/ms²), and the motes that show it. */
  private wind = 0;
  private motes: Pt[] = [];
  private state: 'up' | 'fly' | 'rest' = 'up';
  private restAt = 0;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private floor(s: Stage): number { return s.m.y + s.hh - 26; }

  enter(s: Stage): void {
    s.nu.r = 10;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    this.next(s);
    s.score(0, best(s, 'land') || null);
  }

  private next(s: Stage): void {
    this.state = 'up';
    this.fuel = 1;
    s.rim = 1;
    const w = Math.max(30, 70 - this.count * 6);
    // The lane leans more as you go, either way.
    const lean = this.count ? (Math.random() < 0.5 ? -1 : 1) * Math.min(0.75, 0.25 + this.count * 0.1) * (0.6 + Math.random() * 0.4) : 0;
    this.pad = { x: s.m.x + (Math.random() - 0.5) * (2 * s.hw - w - 60), w, lean };
    this.wind = this.count >= 2 ? (Math.random() < 0.5 ? -1 : 1) * Math.min(0.00006, 0.00001 + this.count * 0.00001) : 0;
    this.motes = Array.from({ length: this.wind ? 7 : 0 }, () => ({ x: s.m.x + (Math.random() * 2 - 1) * s.hw, y: s.m.y + (Math.random() * 2 - 1) * (s.hh - 40) }));
  }

  /** Safe now: slow enough, and coming in along the lane (or barely moving). */
  private safe(): boolean {
    const sp = Math.hypot(this.vx, this.vy);
    if (sp >= LAND_SAFE) return false;
    if (sp < 0.04) return true;
    return this.vy > 0 && Math.abs(Math.atan2(this.vx, this.vy) - this.pad.lean) < LAND_SLACK;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    for (const m of this.motes) {
      m.x += this.wind * 2500 * dt;
      if (m.x > s.m.x + s.hw) m.x -= 2 * s.hw;
      if (m.x < s.m.x - s.hw) m.x += 2 * s.hw;
    }
    if (this.state === 'up' || this.state === 'rest') {
      if (this.state === 'rest' && now - this.restAt > 700) { if (this.overAt) return; this.next(s); }
      if (this.state === 'rest') { nu.seek(nu, dt); return; }
      // Up to the top, somewhere away from the pad, then off it goes.
      const at = { x: clamp(this.pad.x + (this.pad.x > s.m.x ? -1 : 1) * s.hw * 0.6, s.m.x - s.hw + 30, s.m.x + s.hw - 30), y: s.m.y - s.hh + 40 };
      nu.seek(at, dt, 0.7, 0.03);
      if (dist(nu, at) < 3) { this.state = 'fly'; this.vx = 0; this.vy = 0; }
      return;
    }
    let ax = this.wind, ay = 0.0003;
    if (this.finger && this.fuel > 0) {
      ay -= 0.00068;
      ax += clamp((this.finger.x - nu.x) / 120, -1, 1) * 0.00025;
      this.fuel = Math.max(0, this.fuel - dt / 6200);
      s.rim = this.fuel;
    }
    this.vx = clamp(this.vx + ax * dt, -0.3, 0.3);
    this.vy = clamp(this.vy + ay * dt, -0.3, 0.45);
    nu.x += this.vx * dt;
    nu.y += this.vy * dt;
    nu.vx = this.vx;
    nu.vy = this.vy;
    if (nu.x < s.m.x - s.hw + nu.r) { nu.x = s.m.x - s.hw + nu.r; this.vx = Math.abs(this.vx) * 0.3; }
    if (nu.x > s.m.x + s.hw - nu.r) { nu.x = s.m.x + s.hw - nu.r; this.vx = -Math.abs(this.vx) * 0.3; }
    if (nu.y < s.m.y - s.hh + nu.r) { nu.y = s.m.y - s.hh + nu.r; this.vy = 0; }
    if (nu.y + nu.r < this.floor(s)) return;
    nu.y = this.floor(s) - nu.r;
    nu.vx = nu.vy = 0;
    this.state = 'rest';
    this.restAt = now;
    const on = Math.abs(nu.x - this.pad.x) < this.pad.w / 2;
    if (on && this.safe()) {
      this.count++;
      s.fx.ring(nu, GREEN, nu.r, nu.r + 30, 600);
      completeSound();
      s.score(this.count, best(s, 'land') || null);
      return;
    }
    this.left--;
    s.fx.ring(nu, RED, nu.r, nu.r + 30, 600);
    missSound();
    buzz(24);
    if (this.left <= 0) {
      this.overAt = now;
      finish(s, 'land', this.count);
      s.score(this.count, best(s, 'land') || null);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const f = this.floor(s), nu = s.nu, pad = this.pad;
    for (const m of this.motes) bar(ctx, m.x, m.y, m.x - Math.sign(this.wind) * 10, m.y, K500, 2, 0.7);
    bar(ctx, s.m.x - s.hw, f + 3, s.m.x + s.hw, f + 3, K500, 4, 0.9);
    bar(ctx, pad.x - pad.w / 2, f + 1, pad.x + pad.w / 2, f + 1, this.overAt ? K500 : GREEN, 8, 0.95);
    // The lane: dots rising from the pad the way Nu should come in.
    if (!this.overAt) for (let k = 1; k <= 6; k++) dot(ctx, { x: pad.x - Math.sin(pad.lean) * k * 22, y: f - Math.cos(pad.lean) * k * 22 }, 3, GREEN, 0.75 - k * 0.09);
    if (this.state === 'fly') {
      if (this.finger && this.fuel > 0) {
        // The thrust: small dots under Nu.
        for (let k = 1; k <= 3; k++) dot(ctx, { x: nu.x + (Math.random() - 0.5) * 4, y: nu.y + nu.r + k * 6 }, 3 - k * 0.6, CYAN, 0.9 - k * 0.2);
      }
      // The speed: a line from Nu the way it's going, out to the ring at the safe speed.
      const c = this.safe() ? GREEN : RED, R = nu.r + 22, sp = Math.hypot(this.vx, this.vy), l = Math.min(1.8, sp / LAND_SAFE) * R;
      ring(ctx, nu, R, c, 3, 0.8);
      if (sp > 0.01) bar(ctx, nu.x + (this.vx / sp) * nu.r, nu.y + (this.vy / sp) * nu.r, nu.x + (this.vx / sp) * l, nu.y + (this.vy / sp) * l, c, 3, 0.9);
    }
    lives(s, ctx, this.left);
    nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.finger = p;
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

// ---- Order -----------------------------------------------------------------------------------

/** Atoms of all sizes about the arena: tap them in order, smallest first, before the rim runs
 *  out. Each round one more, their sizes closer. A wrong one, or the time, costs a life. */
export class Order implements Toy {
  private atoms: (Pt & { r: number; done: boolean; c: string })[] = [];
  private round = 0;
  private askAt = 0;
  private wrongAt = 0;
  private clearAt = 0;
  private left = 3;
  private overAt = 0;
  private flyTo: Pt | null = null;
  private ms(): number { return 3500 + this.atoms.length * 700; }

  enter(s: Stage): void {
    s.nu.r = 8;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.round = 0;
    this.left = 3;
    this.overAt = 0;
    this.deal(s);
    s.score(0, best(s, 'order') || null);
  }

  private deal(s: Stage): void {
    const n = 4 + Math.min(6, this.round), step = Math.max(1.6, 4.5 - this.round * 0.35);
    const sizes = Array.from({ length: n }, (_, i) => 7 + i * step).sort(() => Math.random() - 0.5);
    this.atoms = [];
    for (const r of sizes) {
      let p: Pt = s.m;
      for (let k = 0; k < 200; k++) {
        p = { x: s.m.x + (Math.random() * 2 - 1) * (s.hw - r - 16), y: s.m.y + 20 + (Math.random() * 2 - 1) * (s.hh - r - 50) };
        if (this.atoms.every((a) => dist(a, p) > a.r + r + 14)) break;
      }
      this.atoms.push({ ...p, r, done: false, c: NOTE_COLOURS[Math.floor(Math.random() * 5)] });
    }
    this.askAt = performance.now();
    this.clearAt = 0;
    s.rim = 1;
  }

  step(s: Stage, dt: number, now: number): void {
    s.nu.seek(this.flyTo ?? { x: s.m.x, y: s.m.y - s.hh + 50 }, dt, 0.8, 0.03);
    if (this.overAt) { s.rim = 0; return; }
    if (this.clearAt) { if (now - this.clearAt > 600) { this.round++; this.deal(s); } return; }
    const left = 1 - (now - this.askAt) / this.ms();
    s.rim = clamp(left, 0, 1);
    if (left <= 0) this.miss(s, now);
  }

  private miss(s: Stage, now: number): void {
    this.left--;
    this.wrongAt = now;
    missSound();
    buzz(22);
    if (this.left <= 0) {
      this.overAt = now;
      finish(s, 'order', this.round);
      s.score(this.round, best(s, 'order') || null);
      return;
    }
    this.deal(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const flash = now - this.wrongAt < 400;
    for (const a of this.atoms) {
      if (a.done) { ring(ctx, a, a.r, K500, 2, 0.6); continue; }
      dot(ctx, a, a.r, flash ? RED : a.c, this.overAt ? 0.35 : 0.9);
    }
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) return;
    if (this.clearAt) return;
    const a = this.atoms.filter((q) => !q.done && dist(q, p) < q.r + 10).sort((x, y) => dist(x, p) - dist(y, p))[0];
    if (!a) return;
    const next = this.atoms.filter((q) => !q.done).sort((x, y) => x.r - y.r)[0];
    if (a !== next) { s.fx.ring(a, RED, a.r, a.r + 16, 500); this.miss(s, now); return; }
    a.done = true;
    this.flyTo = { x: a.x, y: a.y };
    const k = this.atoms.filter((q) => q.done).length;
    chimeSound(k % 5);
    s.fx.ring(a, a.c, a.r, a.r + 14, 400);
    if (this.atoms.every((q) => q.done)) {
      this.clearAt = now;
      completeSound();
      s.score(this.round + 1, best(s, 'order') || null);
    }
  }
}

// ---- Pop -------------------------------------------------------------------------------------

const POP_R = 12;

/** A cluster of atoms in four colors hangs from the top. Nu, at the bottom, holds the next
 *  atom: press in the bottom half to aim, let go to fire (it glances off the sides). It sticks
 *  where it lands; three or more of a color touching pop, and any left hanging from nothing fall.
 *  Every eight shots the cluster comes down a row; down to the dashed line halfway and it's over. */
export class Pop implements Toy {
  private grid = new Map<string, number>();
  /** Which rows sit half a step in: flips as rows come in at the top. */
  private shift = 0;
  private cols = 8;
  private x0 = 0;
  private y0 = 0;
  private load = 0;
  private aim: Pt | null = null;
  private shot: { x: number; y: number; vx: number; vy: number; c: number } | null = null;
  private shots = 0;
  private count = 0;
  private overAt = 0;
  private drops: { x: number; y: number; vy: number; c: number }[] = [];
  private rowH = POP_R * 1.732;

  private home(s: Stage): Pt { return { x: s.m.x, y: s.m.y + s.hh - 34 }; }
  /** The line the cluster mustn't reach, halfway up; the finger aims only below it. */
  private line(s: Stage): number { return s.m.y; }
  /** Where the finger aims: kept in the bottom half, and always a little up from Nu. */
  private dir(s: Stage, p: Pt): Pt {
    const nu = s.nu, dx = p.x - nu.x, dy = Math.min(-10, Math.max(p.y, this.line(s)) - nu.y), l = Math.hypot(dx, dy);
    return { x: dx / l, y: dy / l };
  }
  private off(j: number): number { return (j + this.shift) % 2 ? POP_R : 0; }
  private width(j: number): number { return this.off(j) ? this.cols - 1 : this.cols; }
  private at(j: number, i: number): Pt { return { x: this.x0 + POP_R + i * 2 * POP_R + this.off(j), y: this.y0 + POP_R + j * this.rowH }; }
  private key(j: number, i: number): string { return `${j},${i}`; }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.cols = Math.max(6, Math.floor((2 * s.hw - 16) / (2 * POP_R)));
    this.x0 = s.m.x - (this.cols * 2 * POP_R) / 2;
    this.y0 = s.m.y - s.hh + 14;
    this.grid.clear();
    this.shift = 0;
    // Five rows to start, or fewer if the board is short, leaving room above the line.
    const fit = Math.floor((this.line(s) - this.y0 - 2 * POP_R) / this.rowH) + 1;
    for (let j = 0; j < clamp(fit - 3, 2, 5); j++) for (let i = 0; i < this.width(j); i++) this.grid.set(this.key(j, i), Math.floor(Math.random() * 4));
    this.shots = 0;
    this.count = 0;
    this.overAt = 0;
    this.shot = null;
    this.drops = [];
    this.load = this.pick();
    s.score(0, best(s, 'pop') || null);
  }

  /** The next atom: a color still in the cluster. */
  private pick(): number {
    const have = [...new Set(this.grid.values())];
    return have.length ? have[Math.floor(Math.random() * have.length)] : Math.floor(Math.random() * 4);
  }

  private around(j: number, i: number): [number, number][] {
    const o = this.off(j) ? 1 : 0;
    return [[j, i - 1], [j, i + 1], [j - 1, i - 1 + o], [j - 1, i + o], [j + 1, i - 1 + o], [j + 1, i + o]];
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu, home = this.home(s);
    nu.seek(home, dt, 0.6, 0.04);
    for (const d of this.drops) { d.vy += 0.0012 * dt; d.y += d.vy * dt; }
    this.drops = this.drops.filter((d) => d.y < s.m.y + s.hh + 20);
    if (this.overAt || !this.shot) return;
    const q = this.shot;
    for (let k = 0; k < 3; k++) {
      q.x += (q.vx * dt) / 3;
      q.y += (q.vy * dt) / 3;
      if (q.x < this.x0 + POP_R) { q.x = this.x0 + POP_R; q.vx = Math.abs(q.vx); tickSound(0); }
      if (q.x > this.x0 + this.cols * 2 * POP_R - POP_R) { q.x = this.x0 + this.cols * 2 * POP_R - POP_R; q.vx = -Math.abs(q.vx); tickSound(0); }
      const touch = q.y <= this.y0 + POP_R || [...this.grid.keys()].some((kk) => { const [j, i] = kk.split(',').map(Number); return dist(this.at(j, i), q) < POP_R * 1.8; });
      if (touch) { this.stick(s, now); return; }
    }
    if (q.y > s.m.y + s.hh) this.shot = null;
  }

  /** The shot sticks in the nearest free place; then pops and falls. */
  private stick(s: Stage, now: number): void {
    const q = this.shot!;
    this.shot = null;
    let bestK: [number, number] | null = null, bd = Infinity;
    const jj = Math.max(0, Math.round((q.y - this.y0 - POP_R) / this.rowH));
    for (let j = Math.max(0, jj - 1); j <= jj + 1; j++) {
      for (let i = 0; i < this.width(j); i++) {
        if (this.grid.has(this.key(j, i))) continue;
        const d = dist(this.at(j, i), q);
        if (d < bd) { bd = d; bestK = [j, i]; }
      }
    }
    if (!bestK) return;
    const [sj, si] = bestK;
    this.grid.set(this.key(sj, si), q.c);
    tickSound(1);
    // Same color touching.
    const same = new Set<string>([this.key(sj, si)]), todo: [number, number][] = [[sj, si]];
    while (todo.length) {
      const [j, i] = todo.pop()!;
      for (const [a, b] of this.around(j, i)) {
        const k = this.key(a, b);
        if (!same.has(k) && this.grid.get(k) === q.c) { same.add(k); todo.push([a, b]); }
      }
    }
    let popped = 0;
    if (same.size >= 3) {
      for (const k of same) { const [j, i] = k.split(',').map(Number); s.fx.burst(this.at(j, i), 4, NOTE_COLOURS[q.c], 0.08); this.grid.delete(k); }
      popped += same.size;
      // Whatever no longer hangs from the top falls.
      const held = new Set<string>(), go: [number, number][] = [];
      for (let i = 0; i < this.width(0); i++) if (this.grid.has(this.key(0, i))) { held.add(this.key(0, i)); go.push([0, i]); }
      while (go.length) {
        const [j, i] = go.pop()!;
        for (const [a, b] of this.around(j, i)) { const k = this.key(a, b); if (this.grid.has(k) && !held.has(k)) { held.add(k); go.push([a, b]); } }
      }
      for (const [k, c] of [...this.grid]) {
        if (held.has(k)) continue;
        const [j, i] = k.split(',').map(Number);
        this.drops.push({ ...this.at(j, i), vy: 0, c });
        this.grid.delete(k);
        popped++;
      }
      this.count += popped;
      chimeSound(Math.min(4, popped - 3));
      s.score(this.count, best(s, 'pop') || null);
    }
    this.shots++;
    if (!this.grid.size) { completeSound(); for (let j = 0; j < 4; j++) this.addRow(); }
    else if (this.shots % 8 === 0) this.addRow();
    this.load = this.pick();
    // Down to Nu?
    const lowest = Math.max(-1, ...[...this.grid.keys()].map((k) => Number(k.split(',')[0])));
    if (lowest >= 0 && this.at(lowest, 0).y + POP_R > this.line(s)) {
      this.overAt = now;
      missSound();
      buzz(26);
      finish(s, 'pop', this.count);
      s.score(this.count, best(s, 'pop') || null);
    }
  }

  /** A new row at the top, pushing the cluster down. */
  private addRow(): void {
    const old = [...this.grid];
    this.grid.clear();
    this.shift = (this.shift + 1) % 2;
    for (const [k, c] of old) { const [j, i] = k.split(',').map(Number); this.grid.set(this.key(j + 1, i), c); }
    for (let i = 0; i < this.width(0); i++) this.grid.set(this.key(0, i), Math.floor(Math.random() * 4));
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    for (const [k, c] of this.grid) { const [j, i] = k.split(',').map(Number); dot(ctx, this.at(j, i), POP_R - 1, NOTE_COLOURS[c], this.overAt ? 0.4 : 0.95); }
    for (const d of this.drops) dot(ctx, d, POP_R - 1, NOTE_COLOURS[d.c], 0.6);
    // The line it mustn't reach.
    const line = this.line(s);
    ctx.save();
    ctx.setLineDash([6, 8]);
    bar(ctx, s.m.x - s.hw + 10, line, s.m.x + s.hw - 10, line, K500, 3, 0.7);
    ctx.restore();
    if (this.shot) dot(ctx, this.shot, POP_R - 1, NOTE_COLOURS[this.shot.c]);
    const nu = s.nu;
    if (this.aim && !this.shot) {
      const d = this.dir(s, this.aim);
      for (let k = 1; k <= 12; k++) dot(ctx, { x: nu.x + d.x * k * 14, y: nu.y + d.y * k * 14 }, 2.4, WHITE, 0.8 - k * 0.05);
    }
    if (!this.shot && !this.overAt) dot(ctx, { x: nu.x + 22, y: nu.y }, POP_R - 1, NOTE_COLOURS[this.load]);
    nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt) return;
    this.aim = p;
  }

  move(_s: Stage, p: Pt): void { if (this.aim) this.aim = p; }

  up(s: Stage): void {
    const p = this.aim;
    this.aim = null;
    if (!p || this.shot || this.overAt) return;
    const nu = s.nu, d = this.dir(s, p);
    this.shot = { x: nu.x, y: nu.y, vx: d.x * 0.8, vy: d.y * 0.8, c: this.load };
    tickSound(2);
  }
}

// ---- Ready -----------------------------------------------------------------------------------

/** Nu waits, dim, in the middle. Then it glows green: tap, quick, before the ring closes on it.
 *  Too soon, too slow, or a tap when it glows red instead, costs one of three lives. Each catch
 *  the ring closes a little faster. */
export class Ready implements Toy {
  court = true;
  private state: 'wait' | 'go' | 'red' | 'after' = 'wait';
  private at = 0;
  private limit = 520;
  private left = 3;
  private count = 0;
  private overAt = 0;
  private lastMs = 0;

  enter(s: Stage): void {
    s.nu.r = 14;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.left = 3;
    this.count = 0;
    this.limit = 520;
    this.overAt = 0;
    this.wait();
    s.score(0, best(s, 'ready') || null);
  }

  private wait(): void {
    this.state = 'wait';
    this.at = performance.now() + 800 + Math.random() * 2600;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    nu.seek(s.c, dt, 0.5, 0.02);
    nu.glow = this.state === 'go' ? 2 : 0.5;
    if (this.overAt) return;
    if (this.state === 'wait' && now >= this.at) {
      // Now and then, after a few, a red one instead.
      this.state = this.count >= 2 && Math.random() < 0.27 ? 'red' : 'go';
      this.at = now;
    } else if (this.state === 'go' && now - this.at > this.limit) {
      this.lose(s, now);
    } else if (this.state === 'red' && now - this.at > 900) {
      this.wait();
    } else if (this.state === 'after' && now - this.at > 700) {
      this.wait();
    }
  }

  private lose(s: Stage, now: number): void {
    this.left--;
    s.fx.ring(s.nu, RED, s.nu.r, s.nu.r + 34, 600);
    missSound();
    buzz(24);
    this.state = 'after';
    this.at = now;
    if (this.left <= 0) {
      this.overAt = now;
      finish(s, 'ready', this.count);
      s.score(this.count, best(s, 'ready') || null);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const nu = s.nu;
    if (this.state === 'go') {
      const k = clamp(1 - (now - this.at) / this.limit, 0, 1);
      dot(ctx, nu, nu.r + 10, GREEN, 0.35);
      ring(ctx, nu, nu.r + 12 + k * (s.R * 0.6 - nu.r - 12), GREEN, 4, 0.9);
    } else if (this.state === 'red') {
      dot(ctx, nu, nu.r + 10, RED, 0.35);
      ring(ctx, nu, nu.r + 12, RED, 4, 0.9);
    } else {
      dashed(ctx, nu, s.R * 0.6, K500, 0.6);
    }
    if (this.state === 'after' && this.lastMs && !this.overAt) ring(ctx, nu, nu.r + 18, CYAN, 3, clamp(1 - (now - this.at) / 700, 0, 1));
    for (let i = 0; i < 3; i++) {
      const p = { x: s.c.x + (i - 1) * 16, y: s.c.y - s.R + 30 };
      if (i < this.left) dot(ctx, p, 4.5, WHITE, 0.85); else ring(ctx, p, 4.5, K500, 2, 0.8);
    }
    nu.draw(ctx, now);
  }

  down(s: Stage): void {
    const now = performance.now();
    if (this.overAt) return;
    if (this.state === 'go') {
      this.lastMs = now - this.at;
      this.count++;
      this.limit = Math.max(230, this.limit - 24);
      chimeSound(this.count % 5);
      s.score(this.count, best(s, 'ready') || null);
      this.state = 'after';
      this.at = now;
      return;
    }
    if (this.state === 'wait' || this.state === 'red') { this.lastMs = 0; this.lose(s, now); }
  }
}

// ---- Recall ----------------------------------------------------------------------------------

/** A grid of dots. Some light up for a moment, then go dark: tap the same ones back. All found,
 *  one more next time (and a bigger grid now and then). A wrong one shows where they were and
 *  costs one of three lives. */
export class Recall implements Toy {
  private n = 3;
  private size = 3;
  private lit = new Set<number>();
  private found = new Set<number>();
  private state: 'show' | 'ask' | 'after' = 'show';
  private at = 0;
  private wrong = -1;
  private left = 3;
  private count = 0;
  private overAt = 0;

  private cell(s: Stage, k: number): Pt {
    const g = Math.min((2 * s.hw - 40) / this.size, (2 * s.hh - 100) / this.size, 74);
    const i = k % this.size, j = Math.floor(k / this.size);
    return { x: s.m.x + (i - (this.size - 1) / 2) * g, y: s.m.y + 20 + (j - (this.size - 1) / 2) * g };
  }
  private dotR(s: Stage): number { return Math.min((2 * s.hw - 40) / this.size, (2 * s.hh - 100) / this.size, 74) * 0.3; }

  enter(s: Stage): void {
    s.nu.r = 8;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.n = 3;
    this.left = 3;
    this.count = 0;
    this.overAt = 0;
    this.deal();
    s.score(0, best(s, 'recall') || null);
  }

  private deal(): void {
    this.size = this.n <= 4 ? 3 : this.n <= 7 ? 4 : this.n <= 11 ? 5 : 6;
    const all = Array.from({ length: this.size * this.size }, (_, k) => k).sort(() => Math.random() - 0.5);
    this.lit = new Set(all.slice(0, this.n));
    this.found = new Set();
    this.wrong = -1;
    this.state = 'show';
    this.at = performance.now() + 400;
  }

  step(s: Stage, dt: number, now: number): void {
    s.nu.seek({ x: s.m.x, y: s.m.y - s.hh + 40 }, dt, 0.6, 0.03);
    if (this.overAt) return;
    if (this.state === 'show' && now > this.at + 900 + this.n * 120) this.state = 'ask';
    if (this.state === 'after' && now > this.at) this.deal();
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const r = this.dotR(s), showing = this.state === 'show' && now > this.at;
    for (let k = 0; k < this.size * this.size; k++) {
      const p = this.cell(s, k);
      const on = (showing && this.lit.has(k)) || this.found.has(k) || ((this.state === 'after' || this.overAt) && this.lit.has(k));
      dot(ctx, p, r, K800, 0.9);
      if (on) dot(ctx, p, r, this.found.has(k) ? GREEN : CYAN, 0.9);
      if (k === this.wrong) ring(ctx, p, r, RED, 3, 0.95);
    }
    lives(s, ctx, this.left);
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    const now = performance.now();
    if (this.overAt) return;
    if (this.state !== 'ask') return;
    const r = this.dotR(s);
    let k = -1;
    for (let q = 0; q < this.size * this.size; q++) if (dist(this.cell(s, q), p) < r + 8) k = q;
    if (k < 0 || this.found.has(k)) return;
    if (this.lit.has(k)) {
      this.found.add(k);
      chimeSound(this.found.size % 5);
      if (this.found.size === this.lit.size) {
        this.count++;
        this.n++;
        completeSound();
        s.score(this.count, best(s, 'recall') || null);
        this.state = 'after';
        this.at = now + 600;
      }
      return;
    }
    this.wrong = k;
    this.left--;
    missSound();
    buzz(22);
    this.state = 'after';
    this.at = now + 1300;
    if (this.left <= 0) {
      this.overAt = now;
      finish(s, 'recall', this.count);
      s.score(this.count, best(s, 'recall') || null);
    }
  }
}

// ---- Swing ---------------------------------------------------------------------------------

/** How far Nu can reach for a dot, and the rope's shortest and longest. */
const SWING_REACH = 300;
const SWING_MIN = 40;
const SWING_MAX = 300;

/** Dots hang along the way, high and low, near and far, on and on. Press near a dot in reach
 *  (they're ringed) and Nu hooks onto it and swings; while holding, slide the finger up to reel
 *  in (faster, like a swing pumped) or down to let the rope out; let go and it flies on, keeping
 *  its speed. Each dot passed counts. Later, red dots float in the gaps: touch one, or fall past
 *  the bottom, and it's over. */
export class Swing implements Toy {
  private pins: (Pt & { passed?: boolean; red?: boolean })[] = [];
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private cam = 0;
  private hook: Pt | null = null;
  private len = 0;
  /** The rope's length the finger asks for, and where the finger was when it asked. */
  private want = 0;
  private from: { y: number; len: number } | null = null;
  private started = false;
  private count = 0;
  private overAt = 0;
  private placed = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.cam = 0;
    this.pins = [];
    this.count = 0;
    this.placed = 0;
    this.overAt = 0;
    this.started = false;
    this.from = null;
    this.pins.push({ x: s.m.x - s.hw * 0.4, y: s.m.y - s.hh * 0.45 });
    this.more(s);
    this.x = this.pins[0].x - 70;
    this.y = this.pins[0].y + 80;
    this.vx = this.vy = 0;
    this.hook = this.pins[0];
    this.len = this.want = dist(this.hook, { x: this.x, y: this.y });
    s.score(0, best(s, 'swing') || null);
  }

  /** Lays dots on ahead of the view: gaps short and long, heights all over, now and then two
   *  close together or a long reach, and (later) a red one floating in the gap. */
  private more(s: Stage): void {
    const top = s.m.y - s.hh + 30, low = s.m.y + s.hh * 0.15;
    for (;;) {
      const real = this.pins.filter((p) => !p.red), last = real[real.length - 1];
      if (last.x - this.cam > s.m.x + s.hw * 2) return;
      this.placed++;
      const r = Math.random(), hard = Math.min(1, this.placed / 25);
      const gap = r < 0.2 ? 70 + Math.random() * 40 : r < 0.85 ? 120 + Math.random() * (80 + 60 * hard) : 230 + Math.random() * 50 * hard;
      // Mostly near the last one's height, sometimes a big step up or down.
      const dy = (Math.random() < 0.3 ? 1 : 0.4) * (Math.random() - 0.5) * s.hh * (0.7 + 0.5 * hard);
      const p = { x: last.x + gap, y: clamp(last.y + dy, top, low) };
      if (this.placed > 6 && gap > 140 && Math.random() < 0.25 + 0.3 * hard) {
        // A red one in the gap, off the straight line between the two.
        const side = Math.random() < 0.5 ? -1 : 1;
        this.pins.push({ x: last.x + gap * (0.4 + Math.random() * 0.2), y: clamp((last.y + p.y) / 2 + side * (50 + Math.random() * 50), top, s.m.y + s.hh * 0.6), red: true });
      }
      this.pins.push(p);
    }
  }

  private me(): Pt { return { x: this.x, y: this.y }; }

  /** The dots in reach to hook onto: ahead, or not far behind. */
  private reach(): Pt[] { return this.pins.filter((p) => !p.red && p.x > this.x - 40 && dist(p, this.me()) < SWING_REACH); }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (!this.started) {
      // Hung from the first dot, waiting.
      const at = { x: this.x - this.cam, y: this.y };
      nu.seek(at, dt, 0.6, 0.04);
      return;
    }
    if (this.overAt) { nu.seek({ x: nu.x, y: Math.min(nu.y, s.m.y + s.hh - nu.r) }, dt, 0.3, 0.02); return; }
    const k = 4;
    for (let n = 0; n < k; n++) {
      const h = dt / k;
      if (this.hook && this.len !== this.want) {
        // Reeling: the rope changes, and Nu's speed round the dot with it (shorter, faster).
        const was = this.len;
        this.len = clamp(this.want, this.len - 0.35 * h, this.len + 0.35 * h);
        const dx = this.x - this.hook.x, dy = this.y - this.hook.y, d = Math.hypot(dx, dy) || 1;
        if (d >= was - 1) {
          const tx = -dy / d, ty = dx / d, vt = this.vx * tx + this.vy * ty, f = clamp(was / this.len, 0.9, 1.1) - 1;
          this.vx += tx * vt * f;
          this.vy += ty * vt * f;
        }
      }
      this.vy += 0.0011 * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      if (this.hook) {
        const dx = this.x - this.hook.x, dy = this.y - this.hook.y, d = Math.hypot(dx, dy) || 1;
        if (d > this.len) {
          const nx = dx / d, ny = dy / d;
          this.x = this.hook.x + nx * this.len;
          this.y = this.hook.y + ny * this.len;
          const vn = this.vx * nx + this.vy * ny;
          if (vn > 0) { this.vx -= vn * nx; this.vy -= vn * ny; }
        }
      }
    }
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 1) { this.vx /= sp; this.vy /= sp; }
    if (this.y < s.m.y - s.hh + nu.r) { this.y = s.m.y - s.hh + nu.r; this.vy = Math.abs(this.vy) * 0.3; }
    // The view follows Nu on, never back.
    const want = this.x - (s.m.x - s.hw * 0.25);
    if (want > this.cam) this.cam += (want - this.cam) * Math.min(1, dt / 120);
    for (const p of this.pins) {
      if (p.red) {
        if (dist(p, this.me()) < 7 + nu.r) { this.over(s, now, p); return; }
        continue;
      }
      if (p.passed || this.x < p.x) continue;
      p.passed = true;
      this.count++;
      tickSound(this.count % 5);
      s.score(this.count, best(s, 'swing') || null);
    }
    this.more(s);
    this.pins = this.pins.filter((p) => p.x - this.cam > s.m.x - s.hw * 2 || p === this.hook);
    nu.x = this.x - this.cam;
    nu.y = this.y;
    nu.vx = this.vx;
    nu.vy = this.vy;
    if (this.y > s.m.y + s.hh + nu.r) this.over(s, now, null);
  }

  private over(s: Stage, now: number, at: Pt | null): void {
    this.overAt = now;
    this.hook = null;
    if (at) s.fx.ring({ x: at.x - this.cam, y: at.y }, RED, 7, 34, 600);
    missSound();
    buzz(24);
    finish(s, 'swing', this.count);
    s.score(this.count, best(s, 'swing') || null);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const nu = s.nu, near = this.started && !this.overAt && !this.hook ? this.reach() : [];
    for (const p of this.pins) {
      const q = { x: p.x - this.cam, y: p.y };
      if (p.red) { dot(ctx, q, 7, RED, this.overAt ? 0.4 : 0.85); continue; }
      dot(ctx, q, 6, p === this.hook ? CYAN : K300, 0.9);
      if (near.includes(p)) ring(ctx, q, 13, CYAN, 2, 0.5);
    }
    if (this.hook && !this.overAt) {
      // The line to the dot, as beads.
      const q = { x: this.hook.x - this.cam, y: this.hook.y }, d = dist(q, nu), n = Math.max(2, Math.floor(d / 12));
      for (let k = 1; k < n; k++) dot(ctx, { x: q.x + ((nu.x - q.x) * k) / n, y: q.y + ((nu.y - q.y) * k) / n }, 2, CYAN, 0.7);
    }
    nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void {
    if (this.overAt) return;
    if (!this.started) { this.started = true; this.vx = 0.25; this.vy = -0.1; this.from = { y: p.y, len: this.len }; return; }
    // The dot in reach nearest the finger.
    const f = { x: p.x + this.cam, y: p.y };
    const near = this.reach().sort((a, b) => dist(a, f) - dist(b, f))[0];
    if (!near) return;
    this.hook = near;
    this.len = this.want = clamp(dist(near, this.me()), SWING_MIN, SWING_MAX);
    this.from = { y: p.y, len: this.len };
    tickSound(2);
  }

  move(_s: Stage, p: Pt): void {
    if (!this.from || !this.hook) return;
    // Up reels in, down lets out.
    this.want = clamp(this.from.len + (p.y - this.from.y) * 1.2, SWING_MIN, SWING_MAX);
  }

  up(): void {
    this.from = null;
    if (this.started) this.hook = null;
  }
}
