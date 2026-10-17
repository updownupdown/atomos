// Nu's park: a place to play with Nu, from the Nu section on Home. Everything happens in
// one arena filling the screen, a rounded rectangle with a round court in its middle for the
// games set on a ring.
//
// The park opens on Nu's home: stroke Nu and it warms up and purrs; tap it and it hops; flick
// one of its toys and it fetches it back to you. Left alone, it brings you a toy. Drop a toy in
// the round toy box to put it away; tap the box a few times and Nu tidies up (if it listens,
// and it may not finish). Throw a toy in the round pool and Nu swims out for it, slowly. Now and
// then Nu takes itself off to its round doghouse: knock and it pokes its head out (and may come
// out, or go back in); throw a toy and it almost always comes out for it. The
// round button under the arena opens the games, a sheet A to Z, and Nu circles the one it
// fancies today:
//   Orbit   Nu runs round two rings; tap its ring to turn, the other to hop; catch photons, dodge red.
//   Sling   pull Nu back and let go; it swings round nuclei on gravity into the green ring.
//   Shells  Nu hides under a shell, the shells shuffle; find it.
//   Echo    Nu flies a tune between five atoms; play it back, one note longer each round.
//   Herd    Nu chases electrons into the nucleus until the atom is whole.
//   Course  lead Nu up a channel past orbiting electrons, against the clock.
//   Dive    tap to dive Nu through the gaps in turning shells, down to the nucleus.
//   Hockey, Pairs: see arcade.ts. Flash, Halo, Pulse: see court.ts. Ripple: see swim.ts. Hop,
//   Juggle, Twin: see yard.ts. Grow, Rain, Spot, Tilt: see field.ts. Flip, More, Stick:
//   see lawn.ts. Blast, Bumper, Cross, Cue, Dodge, Hue: see meadow.ts. Land, Order, Pop, Ready,
//   Recall, Swing: see grove.ts. Bank, Carve: see glade.ts. Shade, Surf: see heath.ts. Fuse,
//   Gate, Tune: see brook.ts. Ferry, Poise: see marsh.ts.
// Most games are learnt by trying, so they carry no words: just the score and best under the
// arena, drawn as tiny atoms (score-atom.ts). When a run is over, a card over the arena shows
// its atom and an Again button; when a level is done, a Next button.
// When the park opens, the guide Nu (src/ui/nu.ts) flies in from the logo and the park takes it
// over; leaving, it hands Nu back where it is and Nu flies home. It never jumps. Bests are kept
// on the device under PARK_KEY.

import { loadSave, writeSave } from '../core/save';
import { nuBorrow, nuEnabled, nuGiveBack, reducedMotion } from '../ui/nu';
import { boxedToys, eatTreat, giveToy, keepBox, periodsDone, toysSeen, treats, wake, warmth, warmUp } from './bond';
import { F, GAMES, S, ST, nuPick, type GameId } from './games';
import { openSheet, openSheetPanel, type Sheet } from '../ui/sheet';
import { icon } from '../ui/icons';
import {
  dashed, anywhere, arenaPath, best, Bests, Body, bounceIn, buzz, captureSound, chimeSound, clamp, completeSound, CYAN, dist, dot, edge, Fx, GREEN, inside, K300, K500, K800, K900, K975, missSound, Mover, NOTE_COLOURS, Pt, readBests, RED, rimPoint, ring, ROSE, seeded, finish, setBest, Stage, TAU, tickSound, Toy, WHITE, writeBests,
} from './kit';
import { hush, newTheme } from './kit';
import { Hockey, Pairs } from './arcade';
import { Flash, Halo, Pulse } from './court';
import { Ripple } from './swim';
import { Hop, Juggle, Twin } from './yard';
import { Grow, Rain, Spot, Tilt } from './field';
import { Flip, More, Stick } from './lawn';
import { Blast, Bumper, Cross, Cue, Dodge, Hue } from './meadow';
import { Land, Order, Pop, Ready, Recall, Swing } from './grove';
import { Bank, Carve } from './glade';
import { Shade, Surf } from './heath';
import { Fuse, Gate, Tune } from './brook';
import { Ferry, Poise } from './marsh';
import { fmt, points } from './points';
import { atomSvg } from './score-atom';
import { GAME_MS, NEXT_MS, ROULETTE_ICON, ROUND, chip, keepRun, pickSix, readBook, rouletteHtml, wheelSvg, type Run } from './roulette';
import './park.css';

type PlaceId = 'home' | GameId;

// ---- Home: pet and fetch ---------------------------------------------------------------------

type PlayThing = Mover & { kind: 'photon' | 'hoop' | 'pair' | 'treat' | 'atom'; spin: number; period?: number; id?: string; boxed?: boolean; wet?: boolean };

/** How big a toy is, for catching and bouncing. */
const toyR = (t: PlayThing): number => (t.kind === 'atom' ? 12 : t.kind === 'treat' ? 6 : 10);

/** The colour of a period's toy: the orbital colour of the newest block that period fills
 *  (s in period 1, p from 2, d from 4, f from 6). */
const periodColour = (p: number): string => NOTE_COLOURS[p >= 6 ? 3 : p >= 4 ? 2 : p >= 2 ? 1 : 0];

/** Nu's home. Stroke it and it warms up and leans into your finger; full, it purrs, three
 *  little electrons going round it. Tap it and it hops. Flick a toy and Nu fetches it back to
 *  where you let go. Left alone a while, it brings you a toy of its own accord. */
class Home implements Toy {
  private happy = 0;
  private finger: Pt | null = null;
  private downAt = 0;
  private downP: Pt | null = null;
  private lastRing = 0;
  private lastBurst = -Infinity;
  private hop = 0;
  private toys: PlayThing[] = [];
  private held: PlayThing | null = null;
  private trail: { x: number; y: number; t: number }[] = [];
  private state: 'idle' | 'chase' | 'carry' | 'house' = 'idle';
  /** In the doghouse: on its way, in it, or poking its head out (and whether it'll stay out),
   *  and when it means to come out on its own. */
  private den: 'going' | 'in' | 'peek' = 'going';
  private denUntil = 0;
  private peekUntil = 0;
  private peekOut = false;
  private target: PlayThing | null = null;
  private drop: Pt = { x: 0, y: 0 };
  private quiet = 0;
  /** Tidying up into the box, how many put away so far, taps on the box, and a "no" shake. */
  private tidying = false;
  private putAway = 0;
  private taps: number[] = [];
  private no = 0;
  private boxDown: { p: Pt; toy: PlayThing | null } | null = null;
  /** Treats from wins still to come in, and when the last one did. */
  private treatsDue = 0;
  private treatAt = 0;
  private warm = 0;
  private splashAt = 0;
  private spot(s: Stage): Pt { return { x: s.c.x, y: s.c.y - s.R * 0.08 }; }

  enter(s: Stage): void {
    s.nu.r = 12;
    s.score(null);
    if (!this.toys.length) {
      const at = (a: number, k: number): Pt => ({ x: s.c.x + Math.cos(a) * s.R * k, y: s.c.y + Math.sin(a) * s.R * k });
      this.toys = [
        { ...at(2.2, 0.62), vx: 0, vy: 0, kind: 'photon', spin: 0, id: 'photon' },
        { ...at(0.9, 0.6), vx: 0, vy: 0, kind: 'hoop', spin: 0, id: 'hoop' },
        { ...at(1.57, 0.72), vx: 0, vy: 0, kind: 'pair', spin: 0.6, id: 'pair' },
      ];
    }
    this.state = 'idle';
    this.quiet = 0;
    s.nu.scale = 1;
    this.warm = warmth();
    this.treatsDue = treats();
    this.treatAt = performance.now();
    // A toy for each period finished: a tiny model of its atom. A new one appears in the middle
    // and Nu brings it to you.
    const have = new Set(this.toys.filter((t) => t.kind === 'atom').map((t) => t.period));
    const seen = toysSeen();
    for (const p of periodsDone()) {
      if (have.has(p)) continue;
      const fresh = !seen.includes(p), a = -Math.PI / 2 + (p * TAU) / 7, k = fresh ? 0.3 : 0.4 + Math.random() * 0.35;
      const t: PlayThing = { x: s.c.x + Math.cos(a) * s.R * k, y: s.c.y + Math.sin(a) * s.R * k, vx: 0, vy: 0, kind: 'atom', spin: 0, period: p, id: `atom-${p}` };
      Object.assign(t, inside(s, t, toyR(t)));
      this.toys.push(t);
      if (fresh) {
        giveToy(p);
        s.fx.ring(t, periodColour(p), 6, 60, 1200);
        s.fx.burst(t, 12, periodColour(p), 0.12);
        chimeSound(p % 5);
        this.target = t;
        this.drop = { x: s.c.x, y: s.c.y + s.hh * 0.7 };
        this.state = 'chase';
      }
    }
    // Sometimes it's in its doghouse when you arrive.
    if (this.state === 'idle' && !reducedMotion() && Math.random() < 0.25) this.toHouse();
    // What's in the box (it may have changed while you were away).
    const boxed = new Set(boxedToys());
    for (const t of this.toys) if (t.id && t !== this.target) t.boxed = boxed.has(t.id);
    this.keep();
  }

  /** Nu's doghouse: round, in the top-left corner, with a round door at the bottom. */
  private house(s: Stage): Pt & { r: number; door: Pt } {
    const r = 36, x = s.c.x - s.hw + r + 16, y = s.c.y - s.hh + r + 16;
    return { x, y, r, door: { x, y: y + r * 0.38 } };
  }

  /** Off to the doghouse for a while. */
  private toHouse(): void {
    this.state = 'house';
    this.den = 'going';
    this.target = null;
  }

  /** Out of the doghouse, with a little hop. */
  private outOfHouse(): void {
    this.state = 'idle';
    this.quiet = 0;
    this.hop = 520;
  }

  /** The pool: round, in the top-right corner. Toys float in it, and Nu swims out for them,
   *  slowly. */
  private pool(s: Stage): Pt & { r: number } {
    const r = clamp(Math.min(s.hw, s.hh) * 0.36, 44, 74);
    return { x: s.c.x + s.hw - r - 16, y: s.c.y - s.hh + r + 16, r };
  }

  private wet(s: Stage, p: Pt): boolean { const q = this.pool(s); return dist(p, q) < q.r; }

  /** Just out of the pool, toward the middle: where Nu leaves what it fished out. */
  private shore(s: Stage): Pt {
    const q = this.pool(s), dx = s.c.x - q.x, dy = s.c.y - q.y, d = Math.hypot(dx, dy) || 1;
    return inside(s, { x: q.x + (dx / d) * (q.r + 34), y: q.y + (dy / d) * (q.r + 34) }, 24);
  }

  /** Nu's pace: slower in the water. */
  private pace(s: Stage): number { return this.wet(s, s.nu) ? 0.38 : 1; }

  /** The roulette wheel: round, in the bottom-right corner. Tap it and it spins, and the
   *  roulette opens. */
  private wheel(s: Stage): Pt & { r: number } {
    return { x: s.c.x + s.hw - 46, y: s.c.y + s.hh - 46, r: 32 };
  }
  private spinAt = 0;
  private turn = 0;

  /** The toy box: round, in the bottom-left corner. */
  private box(s: Stage): Pt & { r: number } {
    return { x: s.c.x - s.hw + 46, y: s.c.y + s.hh - 46, r: 34 };
  }

  /** Where a boxed toy sits in the box: round its middle. */
  private inBox(s: Stage, t: PlayThing): Pt {
    const b = this.box(s), all = this.toys.filter((q) => q.boxed), i = all.indexOf(t);
    if (all.length < 2) return b;
    const a = -Math.PI / 2 + (i * TAU) / all.length;
    return { x: b.x + Math.cos(a) * 15, y: b.y + Math.sin(a) * 15 };
  }

  private keep(): void {
    keepBox(this.toys.filter((t) => t.boxed && t.id).map((t) => t.id!), this.toys.filter((t) => t.id).map((t) => t.id!));
  }

  /** Into the box with it. */
  private stow(s: Stage, t: PlayThing): void {
    t.boxed = true;
    t.vx = t.vy = 0;
    s.fx.ring(this.box(s), WHITE, 20, 44, 450);
    tickSound(4);
    this.keep();
  }

  /** Tapped the box a few times: Nu tidies up, if it feels like it, and may not finish. */
  private tidy(s: Stage): void {
    const out = this.toys.filter((t) => !t.boxed && t.kind !== 'treat' && t !== this.held);
    if (!out.length) return;
    if (Math.random() < 0.25) {
      // Not now: a little shake of the head.
      this.no = 600;
      missSound();
      return;
    }
    this.tidying = true;
    this.next(s);
  }

  /** The next toy to put away, nearest first; now and then Nu loses interest and stops. */
  private next(s: Stage): void {
    const out = this.toys.filter((t) => !t.boxed && t.kind !== 'treat' && t !== this.held);
    if (!out.length || (this.putAway > 0 && Math.random() < 0.22)) {
      this.tidying = false;
      this.putAway = 0;
      this.state = 'idle';
      this.target = null;
      return;
    }
    out.sort((a, b) => dist(a, s.nu) - dist(b, s.nu));
    this.target = out[0];
    this.drop = this.box(s);
    this.state = 'chase';
  }

  resize(s: Stage): void { for (const t of this.toys) Object.assign(t, inside(s, t, toyR(t))); }

  step(s: Stage, dt: number, now: number): void {
    // The wheel turns slowly, fast for a moment when spun; then the roulette opens.
    this.turn += dt * (this.spinAt ? 0.012 * Math.max(0.1, 1 - (now - this.spinAt) / 700) : 0.0004);
    if (this.spinAt && now - this.spinAt > 700) { this.spinAt = 0; s.roulette?.(); }
    const nu = s.nu;
    for (const t of this.toys) {
      if (t.boxed) { Object.assign(t, this.inBox(s, t)); continue; }
      if (t === this.held || (this.state === 'carry' && t === this.target)) continue;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      const wet = t.kind !== 'treat' && this.wet(s, t);
      if (wet && !t.wet) {
        // Splash: rings on the water, and Nu goes to fish it out (when it isn't busy).
        s.fx.ring(t, CYAN, 6, 34, 800);
        s.fx.ring(t, CYAN, 2, 20, 600);
        tickSound(1);
        if (this.state === 'idle' && !this.held) { this.target = t; this.drop = this.shore(s); this.state = 'chase'; }
      }
      t.wet = wet;
      // Water drags hard and turns slowly round the pool.
      const f = Math.pow(wet ? 0.988 : 0.9975, dt);
      t.vx *= f;
      t.vy *= f;
      if (wet) {
        const q = this.pool(s), dx = t.x - q.x, dy = t.y - q.y, d = Math.hypot(dx, dy) || 1;
        t.vx += (-dy / d) * 0.00001 * dt;
        t.vy += (dx / d) * 0.00001 * dt;
      }
      t.spin += Math.hypot(t.vx, t.vy) * dt * 0.02;
      if (bounceIn(s, t, toyR(t)) && t.kind !== 'treat') tickSound(0);
    }
    if (this.wet(s, nu) && now - this.splashAt > 420 && Math.hypot(nu.vx, nu.vy) > 0.03) {
      // Nu swimming: little rings behind it.
      this.splashAt = now;
      s.fx.ring(nu, CYAN, nu.r, nu.r + 14, 700);
    }
    this.quiet += dt;
    if (this.state === 'idle') {
      const h = this.spot(s);
      let to = { x: h.x, y: h.y + Math.sin(now / 900) * 6 };
      if (this.finger && dist(this.finger, h) < 140) to = { x: h.x + (this.finger.x - h.x) * 0.18, y: h.y + (this.finger.y - h.y) * 0.18 };
      if (this.hop > 0) {
        this.hop = Math.max(0, this.hop - dt);
        const t = 1 - this.hop / 520;
        to.y -= Math.sin(t * Math.PI) * 40;
        nu.scale = 1 + Math.sin(t * TAU) * 0.12;
      } else nu.scale = 1 + Math.sin(now / 700) * 0.03 * (1 + this.happy);
      if (this.no > 0) { this.no = Math.max(0, this.no - dt); to.x += Math.sin(this.no / 50) * 10; }
      nu.seek(to, dt, 0.6 * this.pace(s), 0.012);
      // A treat from a win drifts in from the rim, and Nu goes to eat it.
      if (this.treatsDue > 0 && !this.held && now - this.treatAt > 1400) {
        this.treatsDue--;
        this.treatAt = now;
        const a = Math.random() * TAU, from = inside(s, { x: s.c.x + Math.cos(a) * 2000, y: s.c.y + Math.sin(a) * 2000 }, 8);
        const t: PlayThing = { ...from, vx: -Math.cos(a) * 0.12, vy: -Math.sin(a) * 0.12, kind: 'treat', spin: 0 };
        this.toys.push(t);
        this.target = t;
        this.state = 'chase';
        return;
      }
      // Left alone a while, now and then it takes itself off to its doghouse.
      if (this.quiet > 6000 && !this.held && !reducedMotion() && Math.random() < dt / 14000) { this.quiet = 0; this.toHouse(); return; }
      // Bored: it fetches a toy for you, and drops it by the button.
      const free = this.toys.filter((t) => !t.boxed && t.kind !== 'treat');
      if (this.quiet > 9000 && !this.held && !reducedMotion() && free.length) {
        this.quiet = 0;
        this.target = free[Math.floor(Math.random() * free.length)];
        this.drop = { x: s.c.x, y: s.c.y + s.hh * 0.7 };
        this.state = 'chase';
      }
    } else if (this.state === 'house') {
      const h = this.house(s);
      if (this.den === 'going') {
        nu.scale = 1;
        nu.seek(h.door, dt, 0.5 * this.pace(s), 0.012);
        if (dist(nu, h.door) < 4) { this.den = 'in'; this.denUntil = now + 18000 + Math.random() * 24000; tickSound(0); }
      } else if (this.den === 'in') {
        // Curled up just inside the door: small and dim.
        nu.seek(h.door, dt, 0.3, 0.02);
        nu.scale = 0.55 + Math.sin(now / 1200) * 0.03;
        // A treat, or enough time alone, brings it out.
        if (now > this.denUntil || (this.treatsDue > 0 && now - this.treatAt > 1400)) this.outOfHouse();
      } else {
        // Poking its head out to see who knocked.
        nu.seek({ x: h.door.x, y: h.door.y + h.r * 0.7 }, dt, 0.4, 0.03);
        nu.scale = 0.9;
        if (now > this.peekUntil) { if (this.peekOut) this.outOfHouse(); else this.den = 'in'; }
      }
    } else if (this.state === 'chase' && this.target) {
      nu.scale = 1;
      nu.seek(this.target, dt, 0.62 * this.pace(s), 0.02 * this.pace(s));
      if (dist(nu, this.target) < nu.r + toyR(this.target)) {
        if (this.target.kind === 'treat') {
          // Eaten: Nu glows a little warmer.
          this.toys.splice(this.toys.indexOf(this.target), 1);
          s.fx.burst(this.target, 10, CYAN, 0.12);
          chimeSound(Math.floor(Math.random() * 5));
          eatTreat();
          this.warm = warmUp(0.08);
          this.hop = 520;
          this.target = null;
          this.state = 'idle';
          return;
        }
        this.state = 'carry';
        captureSound();
        s.fx.ring(this.target, WHITE, 6, 26, 450);
      }
    } else if (this.state === 'carry' && this.target) {
      nu.seek(this.drop, dt, 0.42 * this.pace(s), 0.01);
      this.target.x = nu.x + 13;
      this.target.y = nu.y - 7;
      if (this.tidying && dist(nu, this.drop) < this.box(s).r) {
        this.stow(s, this.target);
        this.putAway++;
        this.target = null;
        this.next(s);
        return;
      }
      if (dist(nu, this.drop) < 6) {
        this.target.x = this.drop.x;
        this.target.y = this.drop.y + 18;
        this.target.vx = this.target.vy = 0;
        this.state = 'idle';
        this.target = null;
        this.quiet = 0;
        s.fx.burst(nu, 6, ROSE, 0.08);
        tickSound(3);
        this.warm = warmUp(0.03);
      }
    }
    this.happy = clamp(this.happy - dt * 0.00003, 0, 1);
    nu.glow = 1 + this.warm * 0.8 + this.happy * 1.4;
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const hs = this.house(s);
    dot(ctx, hs, hs.r, K900);
    ring(ctx, hs, hs.r, K500, 3, 0.9);
    dot(ctx, hs.door, 15, K975);
    ring(ctx, hs.door, 15, K500, 2, 0.7);
    const q = this.pool(s), w = (now / 2600) % 1;
    dot(ctx, q, q.r, CYAN, 0.12);
    ring(ctx, q, q.r, CYAN, 3, 0.45);
    ring(ctx, q, q.r * (0.25 + 0.65 * w), CYAN, 2, 0.22 * (1 - w));
    ring(ctx, q, q.r * (0.25 + 0.65 * ((w + 0.5) % 1)), CYAN, 2, 0.22 * (1 - ((w + 0.5) % 1)));
    const b = this.box(s);
    dot(ctx, b, b.r, K900);
    ring(ctx, b, b.r, K500, 3, 0.9);
    const wh = this.wheel(s);
    dot(ctx, wh, wh.r, K900);
    ring(ctx, wh, wh.r, K500, 3, 0.9);
    for (let k = 0; k < 6; k++) {
      const a = this.turn + (k * TAU) / 6;
      dot(ctx, { x: wh.x + Math.cos(a) * wh.r * 0.6, y: wh.y + Math.sin(a) * wh.r * 0.6 }, 4.5, k < 5 ? NOTE_COLOURS[k] : WHITE, 0.95);
    }
    dot(ctx, wh, 4, K300);
    for (const t of this.toys) {
      if (t.kind === 'photon') {
        ctx.save();
        ctx.shadowColor = 'rgba(111, 208, 230, 0.8)';
        ctx.shadowBlur = 12;
        dot(ctx, t, 6, CYAN);
        ctx.restore();
      } else if (t.kind === 'hoop') {
        ring(ctx, t, 8, WHITE, 3);
      } else if (t.kind === 'treat') {
        ctx.save();
        ctx.shadowColor = 'rgba(111, 208, 230, 0.9)';
        ctx.shadowBlur = 14;
        dot(ctx, t, 4, WHITE);
        ctx.restore();
        ring(ctx, t, 7 + Math.sin(now / 180) * 1.5, CYAN, 1.6, 0.6);
      } else if (t.kind === 'atom') {
        // A period's atom: its nucleus in the period's colour, and as many electrons going round
        // as the period has shells.
        const c = periodColour(t.period ?? 1), n = t.period ?? 1, r = toyR(t) - 2;
        ring(ctx, t, r, c, 2, 0.55);
        dot(ctx, t, 4.2, c);
        for (let i = 0; i < n; i++) {
          const a = t.spin + now / 1100 + (i * TAU) / n;
          dot(ctx, { x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r }, 1.9, WHITE);
        }
      } else {
        const ox = Math.cos(t.spin) * 5, oy = Math.sin(t.spin) * 5;
        dot(ctx, { x: t.x + ox, y: t.y + oy }, 5.5, WHITE);
        ring(ctx, { x: t.x - ox, y: t.y - oy }, 4.4, WHITE, 2.2);
      }
    }
    if (this.happy > 0.66 && this.state === 'idle') {
      // Purring: three small electrons on a tilted ring round Nu.
      const k = clamp((this.happy - 0.66) / 0.34, 0, 1), nu = s.nu, tilt = -0.3;
      ctx.save();
      ctx.globalAlpha = 0.35 * k;
      ctx.strokeStyle = K500;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(nu.x, nu.y, 40, 15, tilt, 0, TAU);
      ctx.stroke();
      ctx.restore();
      for (let i = 0; i < 3; i++) {
        const a = now / 700 + (i * TAU) / 3, ex = Math.cos(a) * 40, ey = Math.sin(a) * 15;
        dot(ctx, { x: nu.x + ex * Math.cos(tilt) - ey * Math.sin(tilt), y: nu.y + ex * Math.sin(tilt) + ey * Math.cos(tilt) }, 3.2, CYAN, k);
      }
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    this.quiet = 0;
    this.finger = p;
    this.downAt = performance.now();
    this.downP = p;
    const hs = this.house(s);
    if (this.state === 'house' && this.den !== 'going' && dist(p, hs) < hs.r + 8) {
      // A knock on the doghouse: Nu pokes its head out, and may come out, or go back in.
      this.den = 'peek';
      this.peekUntil = performance.now() + 1300;
      this.peekOut = Math.random() < 0.4;
      tickSound(2);
      return;
    }
    const wh = this.wheel(s);
    if (dist(p, wh) < wh.r + 6 && !this.held) {
      if (!this.spinAt) { this.spinAt = performance.now(); tickSound(3); }
      return;
    }
    const b = this.box(s);
    if (dist(p, b) < b.r + 6) {
      // On the box: drag a toy out of it, or tap it.
      const near = this.toys.filter((q) => q.boxed).sort((q, r) => dist(p, q) - dist(p, r))[0] ?? null;
      this.boxDown = { p, toy: near };
      return;
    }
    const t = this.toys.find((q) => !q.boxed && q.kind !== 'treat' && dist(p, q) < Math.max(30, toyR(q) + 14) && !(this.state === 'carry' && q === this.target));
    if (t) {
      this.held = t;
      t.vx = t.vy = 0;
      if (t === this.target) { this.state = 'idle'; this.target = null; this.tidying = false; }
      this.trail = [{ ...p, t: performance.now() }];
    }
  }

  move(s: Stage, p: Pt): void {
    this.quiet = 0;
    const last = this.finger;
    this.finger = p;
    if (this.boxDown) {
      if (!this.boxDown.toy || dist(p, this.boxDown.p) < 10) return;
      const t = this.boxDown.toy;
      this.boxDown = null;
      t.boxed = false;
      this.held = t;
      this.trail = [{ ...p, t: performance.now() }];
      this.keep();
    }
    if (this.held) {
      Object.assign(this.held, inside(s, p, toyR(this.held)));
      this.trail.unshift({ ...p, t: performance.now() });
      this.trail.length = Math.min(this.trail.length, 8);
      return;
    }
    if (!last || !this.downP || this.state !== 'idle' || dist(p, s.nu) > s.nu.r + 46) return;
    const was = this.happy;
    this.happy = clamp(this.happy + dist(p, last) * 0.0016, 0, 1);
    const now = performance.now();
    if (now - this.lastRing > 160) { this.lastRing = now; s.fx.ring(s.nu, ROSE, s.nu.r, s.nu.r + 30, 800); }
    if (was < 1 && this.happy >= 1 && now - this.lastBurst > 8000) { this.lastBurst = now; s.fx.burst(s.nu, 12); completeSound(); buzz(12); this.warm = warmUp(0.12); }
  }

  up(s: Stage, p: Pt): void {
    if (this.boxDown) {
      // A tap on the box; three quick ones and Nu tidies up.
      this.boxDown = null;
      const now = performance.now();
      this.taps = [...this.taps.filter((t) => now - t < 1500), now];
      s.fx.ring(this.box(s), K300, 30, 40, 300);
      tickSound(0);
      if (this.taps.length >= 3 && !this.tidying) { this.taps = []; this.tidy(s); }
      this.finger = null;
      this.downP = null;
      return;
    }
    if (this.held) {
      const t = this.held, now = performance.now();
      this.held = null;
      const b = this.box(s);
      if (dist(p, b) < b.r) {
        // Dropped in the box.
        this.stow(s, t);
        this.finger = null;
        this.downP = null;
        return;
      }
      const old = this.trail.find((q) => now - q.t > 40) ?? this.trail[this.trail.length - 1];
      const dt = Math.max(16, now - old.t);
      let vx = (p.x - old.x) / dt, vy = (p.y - old.y) / dt;
      const sp = Math.hypot(vx, vy);
      if (sp > 2.2) { vx *= 2.2 / sp; vy *= 2.2 / sp; }
      t.vx = vx;
      t.vy = vy;
      // Thrown: Nu fetches it, and almost always comes out of its doghouse for it.
      if (sp > 0.15 && (this.state !== 'house' || Math.random() < 0.92)) { this.target = t; this.drop = inside(s, p, 24); this.state = 'chase'; }
    } else {
      const quick = performance.now() - this.downAt < 260 && this.downP && dist(p, this.downP) < 12;
      if (quick && this.state === 'idle' && dist(p, s.nu) < s.nu.r + 30) {
        this.hop = 520;
        this.happy = clamp(this.happy + 0.06, 0, 1);
        s.fx.burst({ x: s.nu.x, y: s.nu.y + s.nu.r }, 6, ROSE, 0.08);
        tickSound(2);
      }
    }
    this.finger = null;
    this.downP = null;
  }
}

// ---- Sling -----------------------------------------------------------------------------------

/** Pull back from Nu and let go: it swings round the nuclei on their gravity. Reach the green
 *  ring for the next layout; a nucleus knocks it back to its pad. */
class Sling implements Toy {
  private level = 1;
  private nuclei: { x: number; y: number; m: number; r: number }[] = [];
  private goal = { x: 0, y: 0, r: 22 };
  private pad: Pt = { x: 0, y: 0 };
  private state: 'aim' | 'fly' | 'back' = 'back';
  private pull: Pt | null = null;
  private flown = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.layout(s);
    this.state = 'back';
  }

  resize(s: Stage): void { this.layout(s); }

  private layout(s: Stage): void {
    const rnd = seeded(this.level * 7919);
    const { c, hw, hh } = s;
    this.pad = { x: c.x + (rnd() - 0.5) * hw * 0.5, y: c.y + hh - 56 };
    this.goal = { x: c.x + (rnd() - 0.5) * hw * 1.1, y: c.y - hh * (0.62 + rnd() * 0.15), r: Math.max(16, 26 - this.level) };
    const n = Math.min(3, 1 + Math.floor(this.level / 3));
    this.nuclei = [];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const q = { x: c.x + (rnd() * 2 - 1) * hw * 0.6, y: c.y + (rnd() * 2 - 1) * hh * 0.45, m: 9 + rnd() * 10, r: 0 };
        q.r = 7 + q.m * 0.6;
        if (this.nuclei.every((o) => dist(o, q) > 80) && dist(q, this.goal) > 64 && dist(q, this.pad) > 76) { this.nuclei.push(q); break; }
      }
    }
    s.score(this.level, best(s, 'sling') || null);
  }

  private accel(x: number, y: number): Pt {
    let ax = 0, ay = 0;
    for (const q of this.nuclei) {
      const dx = q.x - x, dy = q.y - y, d2 = dx * dx + dy * dy + 400, d = Math.sqrt(d2);
      const a = (q.m * 0.012) / d2;
      ax += (a * dx) / d;
      ay += (a * dy) / d;
    }
    return { x: ax, y: ay };
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'back') {
      nu.seek(this.pad, dt, 0.5, 0.01);
      if (dist(nu, this.pad) < 3) this.state = 'aim';
      return;
    }
    if (this.state === 'aim') {
      const off = this.pull ? { x: (this.pull.x - this.pad.x) * 0.25, y: (this.pull.y - this.pad.y) * 0.25 } : { x: 0, y: Math.sin(now / 600) * 3 };
      const len = Math.hypot(off.x, off.y), k = len > 30 ? 30 / len : 1;
      nu.seek({ x: this.pad.x + off.x * k, y: this.pad.y + off.y * k }, dt, 0.8, 0.03);
      return;
    }
    // Flying: a few small steps a frame, so a close pass round a nucleus stays smooth.
    const steps = Math.ceil(dt / 4), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.accel(nu.x, nu.y);
      nu.vx += a.x * h;
      nu.vy += a.y * h;
      const sp = Math.hypot(nu.vx, nu.vy);
      if (sp > 1.1) { nu.vx *= 1.1 / sp; nu.vy *= 1.1 / sp; }
      nu.x += nu.vx * h;
      nu.y += nu.vy * h;
      bounceIn(s, nu, nu.r, 0.7);
      for (const q of this.nuclei) {
        if (dist(nu, q) >= q.r + nu.r) continue;
        const d = dist(nu, q) || 1;
        nu.x = q.x + ((nu.x - q.x) / d) * (q.r + nu.r);
        nu.y = q.y + ((nu.y - q.y) / d) * (q.r + nu.r);
        nu.vx *= -0.3;
        nu.vy *= -0.3;
        s.fx.ring(q, RED, q.r, q.r + 18, 500);
        missSound();
        this.state = 'back';
        return;
      }
      if (dist(nu, this.goal) < this.goal.r - 2) {
        s.fx.burst(this.goal, 14, GREEN, 0.14);
        s.fx.ring(this.goal, GREEN, this.goal.r, this.goal.r + 34, 800);
        completeSound();
        buzz(14);
        setBest(s, 'sling', this.level);
        this.level++;
        this.layout(s);
        this.state = 'back';
        return;
      }
    }
    this.flown += dt;
    if (this.flown > 6000 || (this.flown > 900 && Math.hypot(nu.vx, nu.vy) < 0.04)) this.state = 'back';
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ring(ctx, this.goal, this.goal.r, GREEN, 3, 0.9);
    // The pad: brighter while Nu is out, as it can be tapped to call Nu back.
    ring(ctx, this.pad, 15, this.state === 'fly' ? K300 : K500, 2, this.state === 'fly' ? 0.9 : 0.6);
    for (const q of this.nuclei) {
      for (const k of [2.2, 3.4]) ring(ctx, q, q.r * k, K500, 2, 0.2);
      dot(ctx, q, q.r, K300);
    }
    // Aiming: dots where Nu would go for the first second.
    if (this.state === 'aim' && this.pull) {
      const v = this.launch();
      let x = s.nu.x, y = s.nu.y, vx = v.x, vy = v.y;
      for (let i = 1; i <= 60; i++) {
        const a = this.accel(x, y);
        vx += a.x * 16;
        vy += a.y * 16;
        x += vx * 16;
        y += vy * 16;
        if (i % 5 === 0) dot(ctx, { x, y }, 2.6, ROSE, 0.6 * (1 - i / 64));
      }
    }
    s.nu.draw(ctx, now);
  }

  private launch(): Pt {
    if (!this.pull) return { x: 0, y: 0 };
    const dx = this.pad.x - this.pull.x, dy = this.pad.y - this.pull.y;
    const len = Math.hypot(dx, dy), k = Math.min(len, 150) / (len || 1);
    return { x: dx * k * 0.0064, y: dy * k * 0.0064 };
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'aim') this.pull = p;
    // Tap the pad to call Nu back mid-flight.
    else if (this.state === 'fly' && dist(p, this.pad) < 40) { this.state = 'back'; s.fx.ring(this.pad, WHITE, 8, 28, 400); tickSound(0); }
  }
  move(_s: Stage, p: Pt): void { if (this.pull) this.pull = p; }

  up(s: Stage): void {
    if (!this.pull || this.state !== 'aim') { this.pull = null; return; }
    const v = this.launch();
    this.pull = null;
    if (Math.hypot(v.x, v.y) < 0.12) return;
    s.nu.vx = v.x;
    s.nu.vy = v.y;
    this.flown = 0;
    this.state = 'fly';
    tickSound(1);
  }
}

// ---- Course ----------------------------------------------------------------------------------

/** Lead Nu up a winding channel to the green ring without touching its walls or the electrons
 *  crossing it. A touch sends Nu back to the last gate. Each course is narrower and busier. */
class Course implements Toy {
  tally = true;
  private level = 1;
  private path: Pt[] = [];
  private half = 26;
  private orbits: { i: number; r: number; speed: number; phase: number }[] = [];
  private gates: number[] = [];
  private gate = 0;
  private progress = 0;
  private finger: Pt | null = null;
  /** Nu moves with the finger, not under it: touch anywhere (below the path, say) and Nu keeps
   *  its distance, so the finger never hides Nu or the way ahead. Nu's offset from the finger. */
  private grab: Pt | null = null;
  private time = 0;
  /** Courses run, and how far along this one. */
  raw(): number { return this.level - 1 + (this.state === 'done' ? 1 : this.progress / Math.max(1, this.path.length - 3)); }
  private state: 'ready' | 'run' | 'back' | 'done' = 'ready';
  private hitAt = 0;

  enter(s: Stage): void {
    s.nu.r = 8;
    this.build(s);
  }

  resize(s: Stage): void { this.build(s); }

  private build(s: Stage): void {
    const rnd = seeded(this.level * 104729);
    const { c, hw, hh } = s;
    // Three kinds of course, in turn: a zigzag; a near-straight run, much narrower; and one
    // long sweep, a little narrower.
    const kind = (this.level - 1) % 3, tall = hh > hw * 1.3;
    // Never narrower than a fingertip can follow (a 40px channel at its tightest).
    const base = Math.max(22, 30 - this.level * 1.5);
    this.half = kind === 1 ? Math.max(20, base - 5) : kind === 2 ? Math.max(21, base - 3) : base;
    let rows = kind === 1 ? 3 + (tall ? 1 : 0) : kind === 2 ? 5 + (tall ? 2 : 0) : 4 + Math.min(3, this.level) + (tall ? 2 : 0);
    // The zigzag turns on arcs a little wider than the channel's half, so the wall on the inside
    // of each turn is round, never a sharp sliver of grey too thin to see; its rows are spaced so
    // those turns fit, with a wall between them.
    const span = hh - this.half - 16, turn = this.half + 6;
    if (kind === 0) rows = Math.max(3, Math.min(rows, Math.floor((2 * span) / (2 * turn + 16))));
    const chord = hw - this.half - 14, side = rnd() < 0.5 ? -1 : 1;
    const ctrl: Pt[] = [];
    for (let i = 0; i <= rows; i++) {
      const y = c.y + span - (i / rows) * 2 * span;
      let x = c.x;
      if (kind === 0 && i > 0 && i < rows) x = c.x + (i % 2 ? 1 : -1) * chord * (0.55 + rnd() * 0.3);
      else if (kind === 1 && i > 0 && i < rows) x = c.x + (rnd() - 0.5) * chord * 0.5;
      else if (kind === 2) x = c.x + side * Math.sin((i / rows) * Math.PI) * chord * 0.85 - side * chord * 0.35;
      ctrl.push({ x, y });
    }
    let pts: Pt[];
    if (kind === 0) {
      // Straight runs with round turns. Rounding cuts the corners in, so the corners are pushed
      // out until the turns reach about as far across as the corners were meant to.
      const want = Math.max(...ctrl.map((q) => Math.abs(q.x - c.x)));
      let k = 1;
      pts = [];
      for (let it = 0; it < 6; it++) {
        pts = Course.rounded(ctrl.map((q, i) => (i > 0 && i < rows ? { x: c.x + (q.x - c.x) * k, y: q.y } : q)), turn);
        const reach = Math.max(...pts.map((q) => Math.abs(q.x - c.x)));
        if (reach >= want * 0.97 || k >= 1.8) break;
        k = Math.min(1.8, (k * want) / reach);
      }
    } else {
      // A smooth line through the points (Catmull-Rom), sampled every few px.
      pts = [];
      for (let i = 0; i < ctrl.length - 1; i++) {
        const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
        const n = Math.ceil(dist(p1, p2) / 4);
        for (let k = 0; k < n; k++) {
          const t = k / n, t2 = t * t, t3 = t2 * t;
          const cr = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
          pts.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) });
        }
      }
      pts.push(ctrl[ctrl.length - 1]);
    }
    // Whatever the course, no bend left tighter than the channel's half and a little more: drawn
    // and tested alike, the inside wall of every bend is round.
    this.path = Course.ease(pts, this.half + 4);
    const n = this.path.length;
    this.gates = [0, Math.floor(n / 3), Math.floor((2 * n) / 3)];
    this.orbits = [];
    const count = Math.min(5, this.level + 1);
    for (let k = 0; k < count; k++) {
      let i = Math.floor(n * (0.15 + (0.7 * (k + 0.5)) / count));
      if (this.gates.some((g) => Math.abs(g - i) < 14)) i = Math.min(n - 20, i + 16);
      this.orbits.push({ i, r: this.half * (0.55 + rnd() * 0.3), speed: (0.0016 + rnd() * 0.0014) * (rnd() < 0.5 ? -1 : 1), phase: rnd() * 6.3 });
    }
    this.gate = 0;
    this.progress = 0;
    this.state = 'back';
    this.time = 0;
    this.say(s);
  }

  /** The radius of the circle through three points (Infinity if they're in a line). */
  private static bend(a: Pt, b: Pt, c: Pt): number {
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    return cross < 1e-9 ? Infinity : (dist(a, b) * dist(b, c) * dist(a, c)) / (2 * cross);
  }

  /** The same line, its points every `h` px along it. */
  private static even(p: Pt[], h: number): Pt[] {
    const out = [p[0]];
    let carry = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], l = dist(a, b);
      let t = h - carry;
      for (; t <= l; t += h) out.push({ x: a.x + ((b.x - a.x) * t) / l, y: a.y + ((b.y - a.y) * t) / l });
      carry = l - (t - h);
    }
    const end = p[p.length - 1];
    if (dist(out[out.length - 1], end) > h * 0.4) out.push(end); else out[out.length - 1] = end;
    return out;
  }

  /** Straight runs between the points, each corner turned on an arc of radius `r` (or as round
   *  as the runs either side leave room for), every 4px. */
  private static rounded(q: Pt[], r: number): Pt[] {
    const out: Pt[] = [q[0]];
    for (let i = 1; i < q.length - 1; i++) {
      const a = q[i - 1], b = q[i], c = q[i + 1], l1 = dist(a, b), l2 = dist(b, c);
      const u = { x: (b.x - a.x) / l1, y: (b.y - a.y) / l1 }, v = { x: (c.x - b.x) / l2, y: (c.y - b.y) / l2 };
      const turn = Math.acos(clamp(u.x * v.x + u.y * v.y, -1, 1));
      if (turn < 1e-3) { out.push(b); continue; }
      const t = Math.min(r * Math.tan(turn / 2), 0.48 * Math.min(l1, l2)), rr = t / Math.tan(turn / 2);
      const side = Math.sign(u.x * v.y - u.y * v.x), p = { x: b.x - u.x * t, y: b.y - u.y * t };
      const o = { x: p.x - u.y * side * rr, y: p.y + u.x * side * rr }, a0 = Math.atan2(p.y - o.y, p.x - o.x);
      const n = Math.max(2, Math.ceil((turn * rr) / 3));
      for (let k = 0; k <= n; k++) {
        const an = a0 + side * turn * (k / n);
        out.push({ x: o.x + Math.cos(an) * rr, y: o.y + Math.sin(an) * rr });
      }
    }
    out.push(q[q.length - 1]);
    return Course.even(out, 4);
  }

  /** Smooths out any bend tighter than radius `rmin`, a little at a time and only there, the
   *  ends staying put. With every bend at least the channel's half, the inside wall has no
   *  sharp point: just where a fine sliver of grey, too thin to see, would still count as wall. */
  private static ease(line: Pt[], rmin: number): Pt[] {
    let p = Course.even(line, 4);
    for (let pass = 0; pass < 1500; pass++) {
      const n = p.length, tight = new Uint8Array(n);
      let any = false;
      for (let i = 1; i < n - 1; i++) {
        if (Course.bend(p[i - 1], p[i], p[i + 1]) >= rmin) continue;
        any = true;
        for (let k = Math.max(1, i - 6); k <= Math.min(n - 2, i + 6); k++) tight[k] = 1;
      }
      if (!any) break;
      const q = p.map((v, i) => (tight[i] ? { x: 0.5 * v.x + 0.25 * (p[i - 1].x + p[i + 1].x), y: 0.5 * v.y + 0.25 * (p[i - 1].y + p[i + 1].y) } : v));
      p = pass % 8 === 7 ? Course.even(q, 4) : q;
    }
    return Course.even(p, 4);
  }

  private say(s: Stage): void {
    const b = s.bests.course[String(this.level)];
    s.score(`${(this.time / 1000).toFixed(1)}`, b ? (b / 1000).toFixed(1) : null);
  }

  private electron(o: { i: number; r: number; speed: number; phase: number }, now: number): Pt {
    const q = this.path[o.i], a = o.phase + now * o.speed;
    return { x: q.x + Math.cos(a) * o.r, y: q.y + Math.sin(a) * o.r };
  }

  /** How far `p` is from the channel's middle line, anywhere along it: the channel as drawn.
   *  (Measured to each piece of the line, not just its points, and over the whole course, since
   *  on the inside of a tight bend the nearest part can be far along it.) */
  private off(p: Pt): number {
    const q = this.path;
    let b = Infinity;
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], c = q[i + 1], dx = c.x - a.x, dy = c.y - a.y, l = dx * dx + dy * dy;
      const t = l ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l, 0, 1) : 0;
      const d = Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
      if (d < b) b = d;
    }
    return b;
  }

  /** The nearest point of the channel's middle to `p`, looking near where Nu has got to. */
  private nearest(p: Pt): { i: number; d: number } {
    let b = { i: this.progress, d: Infinity };
    const lo = Math.max(0, this.progress - 25), hi = Math.min(this.path.length - 1, this.progress + 25);
    for (let i = lo; i <= hi; i++) {
      const d = dist(p, this.path[i]);
      if (d < b.d) b = { i, d };
    }
    return b;
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'back') {
      const g = this.path[this.gates[this.gate]];
      nu.seek(g, dt, 0.5, 0.012);
      if (dist(nu, g) < 3) { this.state = this.gate === 0 && this.time === 0 ? 'ready' : 'run'; this.progress = this.gates[this.gate]; }
      return;
    }
    if (this.state === 'done') { nu.seek(this.path[this.path.length - 1], dt, 0.3, 0.01); return; }
    // Still holding on after being knocked back: Nu takes up the finger again from where it is.
    if (this.finger && !this.grab) this.grab = { x: nu.x - this.finger.x, y: nu.y - this.finger.y };
    if (this.state === 'ready' && this.finger) this.state = 'run';
    if (this.state !== 'run') { nu.seek({ x: this.path[0].x, y: this.path[0].y + Math.sin(now / 600) * 3 }, dt, 0.2, 0.01); return; }
    this.time += dt;
    // Nu goes straight where the finger says, no swinging past it, at most so fast; and it's
    // checked against the walls every few px of the way, so a quick move can't skip through one.
    nu.vx = nu.vy = 0;
    let hit = false;
    if (this.finger && this.grab) {
      const to = { x: this.grab.x + this.finger.x, y: this.grab.y + this.finger.y };
      const d = dist(nu, to), go = Math.min(d, 1.1 * dt), steps = Math.max(1, Math.ceil(go / 3));
      const ux = d ? (to.x - nu.x) / d : 0, uy = d ? (to.y - nu.y) / d : 0;
      for (let k = 0; k < steps && !hit; k++) {
        nu.x += (ux * go) / steps;
        nu.y += (uy * go) / steps;
        this.progress = this.nearest(nu).i;
        hit = this.off(nu) > this.half - nu.r * 0.6;
      }
      // Where Nu is now, for its trail.
      nu.vx = (ux * go) / dt;
      nu.vy = (uy * go) / dt;
    }
    for (let g = this.gates.length - 1; g > this.gate; g--) if (this.progress >= this.gates[g]) { this.gate = g; s.fx.ring(this.path[this.gates[g]], CYAN, 8, 30, 600); tickSound(2); break; }
    if (!hit) for (const o of this.orbits) if (dist(nu, this.electron(o, now)) < nu.r + 4) hit = true;
    if (hit) {
      this.hitAt = now;
      s.fx.ring(nu, RED, nu.r, nu.r + 22, 500);
      missSound();
      this.state = 'back';
      nu.vx = nu.vy = 0;
      this.grab = null;
      return;
    }
    if (this.progress >= this.path.length - 3) {
      this.state = 'done';
      s.fx.burst(nu, 14, GREEN, 0.14);
      completeSound();
      buzz(14);
      const b = s.bests.course[String(this.level)];
      if (!b || this.time < b) { s.bests.course[String(this.level)] = Math.round(this.time); s.save(); }
      this.say(s);
      s.prompt?.(() => { this.level++; this.build(s); });
      return;
    }
    if (Math.floor(this.time / 100) !== Math.floor((this.time - dt) / 100)) this.say(s);
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const p = this.path;
    if (p.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = () => { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (const q of p) ctx.lineTo(q.x, q.y); };
    // The board a shade of grey, the channel through it black.
    ctx.fillStyle = K800;
    arenaPath(ctx, s);
    ctx.fill();
    const flash = clamp(1 - (now - this.hitAt) / 400, 0, 1);
    if (flash > 0) { ctx.strokeStyle = RED; ctx.globalAlpha = flash * 0.6; ctx.lineWidth = this.half * 2 + 6; line(); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = '#000';
    ctx.lineWidth = this.half * 2;
    line();
    ctx.stroke();
    ctx.restore();
    for (let g = 1; g < this.gates.length; g++) dot(ctx, p[this.gates[g]], 4, g <= this.gate ? CYAN : K500, 0.7);
    ring(ctx, p[p.length - 1], Math.min(14, this.half - 4), GREEN, 3);
    for (const o of this.orbits) {
      ring(ctx, p[o.i], o.r, K500, 2, 0.22);
      dot(ctx, p[o.i], 3, K500, 0.6);
      dot(ctx, this.electron(o, now), 4, CYAN);
    }
    if (this.finger && this.grab && Math.hypot(this.grab.x, this.grab.y) > 30) {
      // Where the finger is, faintly tied to Nu, so it's clear the two move together.
      ring(ctx, this.finger, 16, K500, 2, 0.5);
      ctx.save();
      ctx.strokeStyle = K500;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(this.finger.x, this.finger.y);
      ctx.lineTo(s.nu.x, s.nu.y);
      ctx.stroke();
      ctx.restore();
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state === 'done') return;
    this.finger = p;
    this.grab = this.state === 'run' || this.state === 'ready' ? { x: s.nu.x - p.x, y: s.nu.y - p.y } : null;
  }

  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; this.grab = null; }
}

// ---- Echo ------------------------------------------------------------------------------------

/** Five atoms in a ring, like the logo's nucleus. Nu flies a tune between them; play it back.
 *  Each round the tune is a note longer. */
class Echo implements Toy {
  court = true;
  private nodes: Pt[] = [];
  private tune: number[] = [];
  private state: 'show' | 'listen' | 'wrong' | 'wait' | 'round' = 'wait';
  private at = 0;
  private lit = new Map<number, number>();
  private timer = 0;
  private flyTo: Pt | null = null;
  private wrongAt = 0;
  private wrongNode = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.place(s);
    this.tune = [];
    this.next(s);
  }

  resize(s: Stage): void { this.place(s); }

  private place(s: Stage): void {
    const R = s.R * 0.56;
    this.nodes = Array.from({ length: 5 }, (_, i) => {
      const a = -Math.PI / 2 + (i * TAU) / 5;
      return { x: s.c.x + Math.cos(a) * R, y: s.c.y + Math.sin(a) * R };
    });
  }

  private next(s: Stage): void {
    let n = Math.floor(Math.random() * 5);
    if (this.tune.length && n === this.tune[this.tune.length - 1]) n = (n + 1 + Math.floor(Math.random() * 4)) % 5;
    this.tune.push(n);
    this.state = 'wait';
    this.timer = 900;
    this.at = 0;
    s.score(this.tune.length, best(s, 'echo') || null);
  }

  private light(i: number): void {
    this.lit.set(i, performance.now());
    chimeSound(i);
  }

  step(s: Stage, dt: number): void {
    const nu = s.nu;
    if (this.flyTo) nu.seek(this.flyTo, dt, 0.7, 0.02);
    else nu.seek(s.c, dt, 0.4, 0.01);
    if (this.state === 'wait') {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'show'; this.at = 0; this.flyTo = this.nodes[this.tune[0]]; }
    } else if (this.state === 'show') {
      if (this.flyTo && dist(nu, this.flyTo) < 5) {
        this.light(this.tune[this.at]);
        this.at++;
        if (this.at >= this.tune.length) { this.state = 'listen'; this.at = 0; this.flyTo = null; }
        else this.flyTo = this.nodes[this.tune[this.at]];
      }
    } else if (this.state === 'wrong') {
      this.timer -= dt;
      if (this.timer <= 0) { this.tune = []; this.next(s); }
    } else if (this.state === 'round') {
      this.timer -= dt;
      if (this.timer <= 0) this.next(s);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    // Your turn: the five atoms breathe a little, waiting.
    const wait = this.state === 'listen' ? 0.08 + 0.06 * Math.sin(now / 400) : 0;
    this.nodes.forEach((p, i) => {
      const t = this.lit.get(i);
      const on = t !== undefined ? clamp(1 - (now - t) / 520, 0, 1) : 0;
      const c = NOTE_COLOURS[i];
      ctx.save();
      ctx.shadowColor = c;
      ctx.shadowBlur = 24 * on;
      dot(ctx, p, 22 + on * 4, c, 0.28 + wait + 0.64 * on);
      ctx.restore();
      ring(ctx, p, 31, c, 2, 0.45);
    });
    if (this.state === 'wrong') {
      // A miss: the court flushes red and shakes, the wrong atom rings red, the right one
      // blinks white, and the tune starts over.
      const t = now - this.wrongAt, f = clamp(1 - t / 1700, 0, 1), shake = Math.sin(t / 22) * 7 * clamp(1 - t / 500, 0, 1);
      dot(ctx, { x: s.c.x + shake, y: s.c.y }, s.R, RED, 0.22 * f);
      ring(ctx, this.nodes[this.wrongNode], 31 + 8 * (1 - f), RED, 5, f);
      const blink = Math.floor(t / 220) % 2 === 0 ? 1 : 0.25;
      ring(ctx, this.nodes[this.tune[this.at]], 36, WHITE, 3, blink * f);
      s.nu.scale = 0.75 + 0.25 * (1 - f);
      s.nu.x += shake;
      s.nu.draw(ctx, now);
      s.nu.x -= shake;
      return;
    }
    s.nu.scale = 1;
    s.nu.draw(ctx, now);
  }

  down(s: Stage, p: Pt): void {
    if (this.state !== 'listen') return;
    const i = this.nodes.findIndex((q) => dist(p, q) < 36);
    if (i < 0) return;
    this.flyTo = this.nodes[i];
    if (i !== this.tune[this.at]) {
      this.lit.set(i, performance.now());
      missSound();
      buzz(40);
      this.state = 'wrong';
      s.end?.(this.tune.length - 1);
      this.wrongNode = i;
      this.wrongAt = performance.now();
      this.timer = 1800;
      this.flyTo = null;
      return;
    }
    this.light(i);
    this.at++;
    if (this.at >= this.tune.length) {
      setBest(s, 'echo', this.tune.length);
      s.fx.burst(this.nodes[i], 10, NOTE_COLOURS[i], 0.12);
      // A breath, then one note longer (step).
      this.state = 'round';
      this.timer = 650;
    }
  }
}

// ---- Orbit ---------------------------------------------------------------------------------

/** Nu runs round two rings like an electron with two shells to choose from. Tap a ring: the one
 *  Nu is on turns it round (the ring flashes white), the other hops it across (the ring flashes
 *  cyan). Catch the photons; an antiparticle (red) meeting Nu on its ring ends the run, so when
 *  two close in from both sides, hop rings. Faster as it goes; antiparticles fade away after a
 *  while. */
class Orbit implements Toy {
  court = true;
  private a = -Math.PI / 2;
  private dir = 1;
  private speed = 0.0012;
  /** The ring Nu is on (0 outer, 1 inner), and how far through a hop (0 outer .. 1 inner). */
  private lane = 0;
  private hop = 0;
  private photons: { a: number; lane: number }[] = [];
  private anti: { a: number; lane: number; dir: number; born: number }[] = [];
  private count = 0;
  private state: 'run' | 'over' = 'run';
  private overAt = 0;
  private spawn = 0;
  /** The ring last tapped, lit for a moment in the colour of what the tap did. */
  private lit: { lane: number; c: string; at: number } | null = null;
  private static LIFE = 16000;
  private rad(s: Stage, lane: number): number { return s.R * (0.8 - lane * 0.32); }
  private pos(s: Stage, a: number, lane: number): Pt { const r = this.rad(s, lane); return { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r }; }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.reset(s);
  }

  private reset(s: Stage): void {
    this.dir = 1;
    this.speed = 0.0011;
    this.lane = 0;
    this.hop = 0;
    this.photons = [{ a: this.a + 1.6, lane: 0 }, { a: this.a + 3.2, lane: 1 }];
    this.anti = [];
    this.count = 0;
    this.spawn = 2600;
    this.state = 'run';
    this.lit = null;
    s.score(0, best(s, 'orbit') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.state === 'over') { nu.seek(s.c, dt, 0.4, 0.01); return; }
    this.a += this.dir * this.speed * dt;
    this.hop += clamp(this.lane - this.hop, -dt / 220, dt / 220);
    const r = this.rad(s, 0) + (this.rad(s, 1) - this.rad(s, 0)) * this.hop;
    const at = { x: s.c.x + Math.cos(this.a) * r, y: s.c.y + Math.sin(this.a) * r };
    // Joins the ring smoothly, then rides it.
    if (dist(nu, at) > 6 && this.hop === this.lane) nu.seek(at, dt, 0.7, 0.03); else { nu.x = at.x; nu.y = at.y; }
    const onLane = Math.round(this.hop);
    const near = (b: number, lane: number) => {
      if (lane !== onLane || Math.abs(this.hop - lane) > 0.35) return false;
      const d = Math.abs(((this.a - b) % TAU + TAU + Math.PI) % TAU - Math.PI);
      return d * this.rad(s, lane) < nu.r + 7;
    };
    for (let i = this.photons.length - 1; i >= 0; i--) {
      const q = this.photons[i];
      if (!near(q.a, q.lane)) continue;
      this.photons.splice(i, 1);
      this.count++;
      this.speed = Math.min(0.0028, this.speed + 0.00005);
      s.fx.burst(at, 5, CYAN, 0.08);
      tickSound(this.count % 5);
      s.score(this.count, best(s, 'orbit') || null);
      // A new photon somewhere ahead, on either ring.
      this.photons.push({ a: this.a + this.dir * (1.2 + Math.random() * 3.5), lane: Math.random() < 0.5 ? 0 : 1 });
    }
    this.spawn -= dt;
    if (this.spawn <= 0 && this.anti.length < 1 + Math.floor(this.count / 6)) {
      this.anti.push({ a: this.a + Math.PI, lane: Math.random() < 0.5 ? 0 : 1, dir: Math.random() < 0.5 ? 1 : -1, born: now });
      this.spawn = 3500 + Math.random() * 3000;
    }
    this.anti = this.anti.filter((q) => now - q.born < Orbit.LIFE);
    for (const q of this.anti) {
      q.a += q.dir * this.speed * 0.55 * dt;
      // Harmless while it fades in.
      if (now - q.born > 700 && near(q.a, q.lane)) {
        this.state = 'over';
        this.overAt = now;
        finish(s, 'orbit', this.count);
        s.fx.ring(at, RED, 8, 32, 700);
        missSound();
        s.score(this.count, best(s, 'orbit') || null);
        return;
      }
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    ring(ctx, s.c, this.rad(s, 0), K500, 3, 0.55);
    dashed(ctx, s.c, this.rad(s, 1), K500, 0.55);
    // The ring just tapped, lit and fading.
    const f = this.lit ? clamp(1 - (now - this.lit.at) / 450, 0, 1) : 0;
    if (this.lit && f > 0) ring(ctx, s.c, this.rad(s, this.lit.lane), this.lit.c, 3 + 2.25 * f, 0.64 * f);
    dot(ctx, s.c, 10, K300, 0.5);
    for (const q of this.photons) {
      ctx.save();
      ctx.shadowColor = 'rgba(111, 208, 230, 0.6)';
      ctx.shadowBlur = 7.5;
      dot(ctx, this.pos(s, q.a, q.lane), 5, CYAN);
      ctx.restore();
    }
    for (const q of this.anti) {
      const age = now - q.born, fade = Math.min(clamp(age / 700, 0.2, 1), clamp((Orbit.LIFE - age) / 1200, 0, 1));
      dot(ctx, this.pos(s, q.a, q.lane), 6, RED, fade);
    }
    if (this.state === 'over') ring(ctx, s.c, 22 + Math.sin((now - this.overAt) / 300) * 2, WHITE, 2, 0.5);
    s.nu.draw(ctx, now);
  }

  /** A tap goes to the nearer ring: Nu's own turns it round, the other hops it across. */
  down(s: Stage, p: Pt): void {
    // Over: the park's card starts it again (a preview, with no card, on the next tap).
    if (this.state === 'over') { if (!s.end && performance.now() - this.overAt > 600) this.reset(s); return; }
    const d = dist(p, s.c), lane = Math.abs(d - this.rad(s, 1)) < Math.abs(d - this.rad(s, 0)) ? 1 : 0;
    const now = performance.now();
    if (lane === this.lane) {
      this.dir *= -1;
      this.lit = { lane, c: WHITE, at: now };
      tickSound(1);
    } else {
      this.lane = lane;
      this.lit = { lane, c: CYAN, at: now };
      tickSound(3);
    }
  }
}

// ---- Shells ----------------------------------------------------------------------------------

/** Three shells. Nu hides under one and the shells shuffle; tap the one it is under. Each find
 *  in a row shuffles a little longer and faster. */
class Shells implements Toy {
  court = true;
  private spots: Pt[] = [];
  /** Which spot each shell is at. */
  private at = [0, 1, 2];
  private under = 0;
  private state: 'hide' | 'shuffle' | 'pick' | 'show' = 'hide';
  private swap: { a: number; b: number; t0: number; ms: number } | null = null;
  private left = 0;
  private streak = 0;
  private timer = 0;
  private open = new Set<number>();
  private pos: Pt[] = [];

  enter(s: Stage): void {
    s.nu.r = 9;
    this.place(s);
    this.streak = 0;
    this.round(s);
  }

  resize(s: Stage): void { this.place(s); }

  private place(s: Stage): void {
    const r = s.R * 0.42;
    this.spots = [-90, 30, 150].map((d) => ({ x: s.c.x + Math.cos((d * Math.PI) / 180) * r, y: s.c.y + Math.sin((d * Math.PI) / 180) * r }));
    this.pos = this.at.map((i) => ({ ...this.spots[i] }));
  }

  private round(s: Stage): void {
    this.under = Math.floor(Math.random() * 3);
    this.state = 'hide';
    this.open = new Set([0, 1, 2]);
    this.timer = 1100;
    s.score(this.streak, best(s, 'shells') || null);
  }

  private shellAt(i: number): Pt { return this.pos[i]; }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    // Positions: each shell at its spot, or on its arc while two swap.
    for (let i = 0; i < 3; i++) this.pos[i] = { ...this.spots[this.at[i]] };
    if (this.swap) {
      const t = clamp((now - this.swap.t0) / this.swap.ms, 0, 1), e = t * t * (3 - 2 * t);
      const A = this.spots[this.at[this.swap.a]], B = this.spots[this.at[this.swap.b]];
      const m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, half = dist(A, B) / 2, a0 = Math.atan2(A.y - m.y, A.x - m.x);
      this.pos[this.swap.a] = { x: m.x + Math.cos(a0 + Math.PI * e) * half, y: m.y + Math.sin(a0 + Math.PI * e) * half };
      this.pos[this.swap.b] = { x: m.x - Math.cos(a0 + Math.PI * e) * half, y: m.y - Math.sin(a0 + Math.PI * e) * half };
      if (t >= 1) {
        [this.at[this.swap.a], this.at[this.swap.b]] = [this.at[this.swap.b], this.at[this.swap.a]];
        this.swap = null;
        for (let i = 0; i < 3; i++) this.pos[i] = { ...this.spots[this.at[i]] };
        if (--this.left <= 0) this.state = 'pick';
      }
    }
    if (this.state === 'hide') {
      nu.seek(this.shellAt(this.under), dt, 0.55, 0.015);
      this.timer -= dt;
      if (this.timer < 300) this.open.clear();
      if (this.timer <= 0) { this.state = 'shuffle'; this.left = 4 + this.streak * 2; }
    }
    if (this.state === 'shuffle' && !this.swap) {
      const a = Math.floor(Math.random() * 3), b = (a + 1 + Math.floor(Math.random() * 2)) % 3;
      this.swap = { a, b, t0: now, ms: Math.max(240, 520 - this.streak * 40) };
    }
    if (this.state !== 'hide') { nu.x = this.pos[this.under].x; nu.y = this.pos[this.under].y; }
    if (this.state === 'show') {
      this.timer -= dt;
      if (this.timer <= 0) this.round(s);
    }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const hiddenNu = this.state === 'shuffle' || this.state === 'pick' || (this.state === 'hide' && !this.open.has(this.under));
    if (!hiddenNu) s.nu.draw(ctx, now);
    for (let i = 0; i < 3; i++) {
      const p = this.pos[i], r = 30;
      if (this.open.has(i)) ring(ctx, p, r, K300, 3, 0.7);
      else {
        dot(ctx, p, r, K800);
        ring(ctx, p, r, K300, 3, this.state === 'pick' ? 0.75 + 0.2 * Math.sin(now / 300 + i) : 0.6);
      }
    }
    if (hiddenNu && this.state === 'hide') dot(ctx, this.pos[this.under], 3, ROSE, 0.6);
  }

  down(s: Stage, p: Pt): void {
    if (this.state !== 'pick') return;
    const i = [0, 1, 2].find((k) => dist(p, this.pos[k]) < 36);
    if (i === undefined) return;
    this.open = new Set([i, this.under]);
    this.state = 'show';
    this.timer = 1300;
    if (i === this.under) {
      this.streak++;
      setBest(s, 'shells', this.streak);
      s.fx.burst(this.pos[i], 10, ROSE, 0.12);
      completeSound();
    } else {
      s.end?.(this.streak);
      this.streak = 0;
      missSound();
    }
    s.score(this.streak, best(s, 'shells') || null);
  }
}

// ---- Herd ------------------------------------------------------------------------------------

/** Electrons wander the arena and shy away from Nu. Lead Nu to herd them into the nucleus in the
 *  middle, where they settle into shells (2, then 8). All in, the atom is whole: the next one
 *  has more, livelier electrons. */
class Herd implements Toy {
  private level = 1;
  private free: Mover[] = [];
  private caught = 0;
  private finger: Pt | null = null;
  private doneAt = 0;
  private zone(s: Stage): number { return s.R * 0.2; }

  enter(s: Stage): void {
    s.nu.r = 9;
    this.start(s);
  }

  private start(s: Stage): void {
    const n = Math.min(10, 2 + this.level);
    this.free = [];
    for (let i = 0; i < n; i++) {
      let p = anywhere(s, 12);
      for (let k = 0; k < 20 && dist(p, s.c) < this.zone(s) * 2.2; k++) p = anywhere(s, 12);
      this.free.push({ ...p, vx: 0, vy: 0 });
    }
    this.caught = 0;
    this.doneAt = 0;
    s.score(this.level, best(s, 'herd') || null);
  }

  step(s: Stage, dt: number, now: number): void {
    const nu = s.nu;
    if (this.finger) nu.seek(this.finger, dt, 0.5, 0.02);
    else nu.seek({ x: nu.x, y: nu.y }, dt, 0.2, 0.01);
    bounceIn(s, nu, nu.r, 0.4);
    const wander = 0.00004 + this.level * 0.00001;
    for (let i = this.free.length - 1; i >= 0; i--) {
      const e = this.free[i];
      // Shy of Nu, and restless.
      const dx = e.x - nu.x, dy = e.y - nu.y, d = Math.hypot(dx, dy) || 1;
      if (d < 90) {
        let ux = dx / d, uy = dy / d;
        // Pinned against the rim, Nu's push would only press it into the wall: it springs back
        // off the edge instead, slipping past Nu on the side it's already on.
        const w = edge(s, e);
        if (w.d > -18) {
          const into = ux * w.nx + uy * w.ny;
          if (into > -0.2) {
            const side = (-w.ny * dx + w.nx * dy) >= 0 ? 1 : -1;
            ux = -w.nx * 0.8 + -w.ny * side * 0.9;
            uy = -w.ny * 0.8 + w.nx * side * 0.9;
            if (d < nu.r + 22) { e.vx = ux * 0.36; e.vy = uy * 0.36; }
          }
        }
        const f = (0.0016 * (90 - d)) / 90;
        e.vx += ux * f * dt;
        e.vy += uy * f * dt;
      }
      e.vx += (Math.random() - 0.5) * wander * dt * 4;
      e.vy += (Math.random() - 0.5) * wander * dt * 4;
      const f = Math.pow(0.996, dt);
      e.vx *= f;
      e.vy *= f;
      const sp = Math.hypot(e.vx, e.vy), top = 0.32 + this.level * 0.02;
      if (sp > top) { e.vx *= top / sp; e.vy *= top / sp; }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      bounceIn(s, e, 5, 0.9);
      if (dist(e, s.c) < this.zone(s)) {
        this.free.splice(i, 1);
        this.caught++;
        s.fx.ring(s.c, CYAN, this.zone(s) * 0.6, this.zone(s) * 1.4, 500);
        tickSound(this.caught % 5);
      }
    }
    if (!this.free.length && !this.doneAt) {
      this.doneAt = now;
      setBest(s, 'herd', this.level);
      s.fx.burst(s.c, 16, CYAN, 0.14);
      completeSound();
      buzz(14);
    }
    if (this.doneAt && now - this.doneAt > 1600) { this.level++; this.start(s); }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const z = this.zone(s);
    ring(ctx, s.c, z, K500, 2, 0.5);
    dot(ctx, s.c, 7, K300, 0.8);
    // Caught electrons settle into shells round the nucleus: 2, then up to 8.
    for (let i = 0; i < this.caught; i++) {
      const shell = i < 2 ? 0 : 1, n = shell ? Math.min(8, this.caught - 2) : Math.min(2, this.caught);
      const k = shell ? i - 2 : i, r = shell ? z * 0.82 : z * 0.45;
      const a = now / (shell ? 1800 : 1200) + (k * TAU) / n;
      dot(ctx, { x: s.c.x + Math.cos(a) * r, y: s.c.y + Math.sin(a) * r }, 3.4, CYAN);
    }
    for (const e of this.free) dot(ctx, e, 4.5, CYAN, 0.9);
    s.nu.draw(ctx, now);
  }

  down(_s: Stage, p: Pt): void { this.finger = p; }
  move(_s: Stage, p: Pt): void { if (this.finger) this.finger = p; }
  up(): void { this.finger = null; }
}

// ---- The screen ------------------------------------------------------------------------------


// ---- Dive ------------------------------------------------------------------------------------

/** Shells turn round the nucleus, each with a few gaps. Nu waits at the top; tap and it dives
 *  through the next shell, if a gap is there. Miss and it bounces back out a shell. Reach the nucleus
 *  for the next atom, with one more shell. */
class Dive implements Toy {
  court = true;
  private level = 1;
  /** Each shell turns at its own speed with 2 to 4 gaps of different widths round it (their
   *  middles, from the shell's turn, and their widths, in radians): wait for a wide one, or
   *  risk a narrow one coming sooner. */
  private shells: { phase: number; speed: number; gaps: { at: number; w: number }[] }[] = [];
  /** How many shells Nu is through. */
  private band = 0;
  private hitAt = 0;
  private hitShell = -1;
  private doneAt = 0;

  enter(s: Stage): void {
    s.nu.r = 9;
    this.start(s);
  }

  private radius(s: Stage, k: number): number {
    const n = this.shells.length;
    return s.R * (0.84 - (k * 0.6) / Math.max(1, n - 1));
  }

  /** Where Nu waits after `b` shells: between shell b-1 and shell b, at the top. */
  private spot(s: Stage, b: number): Pt {
    const n = this.shells.length;
    const r = b === 0 ? s.R * 0.95 : b >= n ? 0 : (this.radius(s, b - 1) + this.radius(s, b)) / 2;
    return { x: s.c.x, y: s.c.y - r };
  }

  private start(s: Stage): void {
    const rnd = seeded(this.level * 7919);
    const n = Math.min(7, 2 + this.level);
    this.shells = [];
    for (let k = 0; k < n; k++) {
      const sp = (0.0006 + rnd() * 0.0006 + this.level * 0.00008) * (k % 2 ? -1 : 1);
      const n = 2 + Math.floor(rnd() * 3), wide = 0.83 * Math.max(0.3, 0.55 - this.level * 0.03), gaps: { at: number; w: number }[] = [];
      for (let g = 0; g < n; g++) {
        // Spread round the shell, a little off even; one wide, the rest narrower.
        const at = (g * TAU) / n + (rnd() - 0.5) * (TAU / n) * 0.35;
        gaps.push({ at, w: g === 0 ? wide : wide * (0.55 + rnd() * 0.3) });
      }
      this.shells.push({ phase: rnd() * TAU, speed: sp, gaps });
    }
    // No gap too small to get through with room to spare: at least Nu's width and a fingertip's
    // timing on its shell. Small inner shells, then, keep fewer gaps.
    this.shells.forEach((sh, k) => {
      const least = (2 * s.nu.r + 20) / this.radius(s, k);
      for (const g of sh.gaps) g.w = Math.max(g.w, least);
      while (sh.gaps.length > 1 && sh.gaps.reduce((a, g) => a + g.w, 0) > TAU * 0.45) sh.gaps.pop();
    });
    this.band = 0;
    this.doneAt = 0;
    s.nu.at(this.spot(s, 0));
    s.score(this.level, best(s, 'dive') || null);
  }

  /** How far shell k has turned, now. */
  private turn(k: number, now: number): number { const sh = this.shells[k]; return sh.phase + now * sh.speed; }

  /** Nu is at the top (straight up from the nucleus): is one of shell k's gaps there? */
  private open(s: Stage, k: number, now: number): boolean { return this.room(s, k, now).px > 0; }

  /** How much room Nu would have, in px either way, diving through shell k now (0 or less: none),
   *  and the gap it would go through. */
  private room(s: Stage, k: number, now: number): { px: number; gap: { at: number; w: number } | null } {
    const top = -Math.PI / 2, t = this.turn(k, now), r = this.radius(s, k), pad = s.nu.r / r;
    let b: { px: number; gap: { at: number; w: number } | null } = { px: -Infinity, gap: null };
    for (const g of this.shells[k].gaps) {
      const px = (g.w / 2 - pad - Math.abs(Math.atan2(Math.sin(t + g.at - top), Math.cos(t + g.at - top)))) * r;
      if (px > b.px) b = { px, gap: g };
    }
    return b;
  }

  step(s: Stage, dt: number, now: number): void {
    s.nu.seek(this.spot(s, this.band), dt, 0.9, 0.04);
    if (this.doneAt && now - this.doneAt > 1500) { this.level++; this.start(s); }
  }

  draw(s: Stage, ctx: CanvasRenderingContext2D, now: number): void {
    const flash = clamp(1 - (now - this.hitAt) / 450, 0, 1);
    ctx.save();
    ctx.lineCap = 'round';
    this.shells.forEach((sh, k) => {
      const r = this.radius(s, k), t = this.turn(k, now);
      ctx.strokeStyle = k === this.hitShell && flash > 0 ? RED : k < this.band ? CYAN : K300;
      ctx.globalAlpha = k < this.band ? 0.35 : 0.85;
      ctx.lineWidth = 4;
      // The shell between its gaps, in pieces.
      const gs = sh.gaps.slice().sort((a, b) => a.at - b.at);
      gs.forEach((g, i) => {
        const nx = gs[(i + 1) % gs.length], end = nx.at - nx.w / 2 + (i === gs.length - 1 ? TAU : 0);
        ctx.beginPath();
        ctx.arc(s.c.x, s.c.y, r, t + g.at + g.w / 2, t + end);
        ctx.stroke();
      });
    });
    ctx.restore();
    const won = this.band >= this.shells.length;
    dot(ctx, s.c, 8, won ? GREEN : K300, won ? 1 : 0.8);
    // A tap now would get through: the gap under Nu glows softly green, and so does a ring round
    // Nu, fading in as the gap comes round and out as it goes.
    if (!won && !this.doneAt && dist(s.nu, this.spot(s, this.band)) <= 6) {
      const k = this.band, { px, gap } = this.room(s, k, now), o = clamp(px / 6, 0, 1);
      if (gap && o > 0) {
        const r = this.radius(s, k), a = this.turn(k, now) + gap.at;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = GREEN;
        ctx.globalAlpha = 0.45 * o;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s.c.x, s.c.y, r, a - gap.w / 2 + 0.06, a + gap.w / 2 - 0.06);
        ctx.stroke();
        ctx.restore();
        ring(ctx, s.nu, s.nu.r + 6, GREEN, 2, 0.5 * o);
      }
    }
    s.nu.draw(ctx, now);
  }

  down(s: Stage): void {
    if (this.doneAt) return;
    const now = performance.now();
    // Still on its way to the last spot: wait for it.
    if (dist(s.nu, this.spot(s, this.band)) > 6) return;
    const k = this.band;
    if (this.open(s, k, now)) {
      this.band++;
      tickSound(k % 5);
      if (this.band >= this.shells.length) {
        this.doneAt = now;
        setBest(s, 'dive', this.level);
        s.fx.burst(s.c, 16, GREEN, 0.14);
        completeSound();
        buzz(14);
        s.score(this.level, best(s, 'dive') || null);
      }
      return;
    }
    // The shell's in the way: Nu bumps it and is knocked back out one.
    this.hitAt = now;
    this.hitShell = k;
    const at = { x: s.c.x, y: s.c.y - this.radius(s, k) };
    s.fx.ring(at, RED, 4, 22, 450);
    missSound();
    buzz(20);
    s.nu.vy = 0.5;
    this.band = Math.max(0, this.band - 1);
  }
}

const PICK_ICON = S(`<circle cx="12" cy="12" r="2.6" ${F}/><circle cx="12" cy="4" r="2" ${F}/><circle cx="18.9" cy="8" r="2" ${F}/><circle cx="18.9" cy="16" r="2" ${F}/><circle cx="12" cy="20" r="2" ${F}/><circle cx="5.1" cy="16" r="2" ${F}/><circle cx="5.1" cy="8" r="2" ${F}/>`);
/** The room a game's own controls get under the court (Halo's wheel). */
const PAD_ROOM = 150;

/** Each place in the park, made fresh: the park's own, and each preview in the picker its own. */
const MAKE: Record<PlaceId, () => Toy> = {
  home: () => new Home(), sling: () => new Sling(), course: () => new Course(), echo: () => new Echo(), orbit: () => new Orbit(),
  shells: () => new Shells(), herd: () => new Herd(), hockey: () => new Hockey(), pairs: () => new Pairs(), dive: () => new Dive(), flash: () => new Flash(), halo: () => new Halo(),
  pulse: () => new Pulse(), ripple: () => new Ripple(), hop: () => new Hop(),
  juggle: () => new Juggle(), twin: () => new Twin(),
  grow: () => new Grow(), rain: () => new Rain(), spot: () => new Spot(), tilt: () => new Tilt(),
  flip: () => new Flip(), more: () => new More(), stick: () => new Stick(),
  blast: () => new Blast(), bumper: () => new Bumper(), cross: () => new Cross(), cue: () => new Cue(), dodge: () => new Dodge(), hue: () => new Hue(),
  land: () => new Land(), order: () => new Order(), pop: () => new Pop(), ready: () => new Ready(), recall: () => new Recall(), swing: () => new Swing(),
  carve: () => new Carve(), bank: () => new Bank(), surf: () => new Surf(), shade: () => new Shade(),
  poise: () => new Poise(), ferry: () => new Ferry(), fuse: () => new Fuse(), gate: () => new Gate(), tune: () => new Tune(),
};

/** The arena fills the field (w x h), its rim just inside the edge; the court is the biggest
 *  circle in it, or, for a game with controls of its own, the biggest that leaves them room
 *  under it (beside it, on a wide screen). */
function layoutStage(st: Stage, w: number, h: number, toy: Toy): void {
  st.m = { x: w / 2, y: h / 2 };
  st.hw = Math.max(80, w / 2 - 14);
  st.hh = Math.max(80, h / 2 - 14);
  st.rr = Math.min(48, Math.min(st.hw, st.hh) * 0.3);
  st.R = Math.min(st.hw, st.hh) - 6;
  st.c = { ...st.m };
  st.pad = null;
  // A big court (Pulse) runs past the arena's sides, cropped by them.
  if (toy.court && toy.big) st.R = Math.min(Math.max(st.hw, st.hh), Math.min(st.hw, st.hh) * 1.3) - 6;
  if (!toy.court || !toy.controls) return;
  const room = PAD_ROOM + 12;
  if (st.hh >= st.hw) {
    st.R = Math.max(60, Math.min(st.hw - 6, st.hh - room / 2 - 6));
    // Room to spare (a tall screen) goes above and below the two, not between them.
    const spare = Math.max(0, 2 * st.hh - 12 - 2 * st.R - room);
    st.c = { x: st.m.x, y: st.m.y - st.hh + 6 + spare / 2 + st.R };
    const top = st.c.y + st.R + 6;
    st.pad = { x: st.m.x - st.hw, y: top, w: 2 * st.hw, h: room };
  } else {
    st.R = Math.max(60, Math.min(st.hh - 6, st.hw - room / 2 - 6));
    const spare = Math.max(0, 2 * st.hw - 12 - 2 * st.R - room);
    st.c = { x: st.m.x - st.hw + 6 + spare / 2 + st.R, y: st.m.y };
    const left = st.c.x + st.R + 6;
    st.pad = { x: left, y: st.m.y - st.hh, w: room, h: 2 * st.hh };
  }
}

/** The arena's rim: a plain line round it, still, or the rim's countdown in cyan. */
function drawRim(s: Stage, ctx: CanvasRenderingContext2D, still = false): void {
  ctx.save();
  ctx.strokeStyle = K500;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 3;
  arenaPath(ctx, s, 7);
  ctx.stroke();
  if (!still && s.rim !== null && s.rim > 0) {
    ctx.strokeStyle = CYAN;
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const n = Math.ceil(s.rim * 200);
    for (let i = 0; i <= n; i++) {
      const p = rimPoint(s, (s.rim * i) / n, 7);
      if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** One frame of the arena and the game in it (stepped on when `play`). A preview (`still`) leaves
 *  out the rim's countdown, which would make the picker busy. */
function paintStage(s: Stage, ctx: CanvasRenderingContext2D, toy: Toy | null, dt: number, now: number, play: boolean, still = false): void {
  ctx.save();
  const court = s.court;
  s.court = false;
  ctx.fillStyle = K975;
  ctx.globalAlpha = 0.55;
  arenaPath(ctx, s);
  ctx.fill();
  ctx.globalAlpha = 1;
  drawRim(s, ctx, still);
  arenaPath(ctx, s);
  ctx.clip();
  // A game set on a ring plays in the round court, a lighter plate in the middle.
  s.court = court;
  if (toy && s.pad) toy.drawPad?.(s, ctx, now);
  if (court) { dot(ctx, s.c, s.R, K900, 0.9); arenaPath(ctx, s); ctx.clip(); }
  if (toy) {
    if (play) toy.step(s, dt, now);
    toy.draw(s, ctx, now);
  }
  s.fx.draw(ctx, now, dt);
  ctx.restore();
}

// ---- The picker's tiles ----------------------------------------------------------------------

/** How each game's tile plays itself: taps every so often (anywhere, near Nu, or on one side),
 *  a finger wandering about (or round the court, along the bottom, after Nu), presses held and
 *  let go, a pull and let go (Sling), or loops drawn (Loop). Each press also starts a game
 *  that's over again. */
type Bot =
  | { kind: 'tap'; every: number; at?: 'any' | 'nu' | 'near' | 'side' }
  | { kind: 'drag'; path: 'wander' | 'circle' | 'row' | 'nu' }
  | { kind: 'hold'; on: number; off: number }
  | { kind: 'sling' }
  | { kind: 'flick' }
  | { kind: 'loop' };

const BOTS: Record<GameId, Bot> = { course: { kind: 'drag', path: 'wander' },
  dive: { kind: 'tap', every: 1100 }, echo: { kind: 'tap', every: 800 }, flash: { kind: 'tap', every: 650 },
  grow: { kind: 'drag', path: 'wander' }, halo: { kind: 'drag', path: 'circle' }, herd: { kind: 'drag', path: 'wander' },
  hockey: { kind: 'drag', path: 'row' }, hop: { kind: 'drag', path: 'row' }, juggle: { kind: 'tap', every: 650, at: 'nu' },
  orbit: { kind: 'tap', every: 1200 }, pairs: { kind: 'tap', every: 700 },
  pulse: { kind: 'tap', every: 1000 }, rain: { kind: 'drag', path: 'row' }, ripple: { kind: 'tap', every: 700, at: 'near' }, shells: { kind: 'tap', every: 900 },
  sling: { kind: 'sling' }, spot: { kind: 'tap', every: 1300 },
  tilt: { kind: 'drag', path: 'wander' }, twin: { kind: 'drag', path: 'wander' },
  flip: { kind: 'tap', every: 750 }, more: { kind: 'tap', every: 1300, at: 'side' }, stick: { kind: 'tap', every: 950 },
  blast: { kind: 'tap', every: 500 }, bumper: { kind: 'tap', every: 450, at: 'side' }, cross: { kind: 'tap', every: 700, at: 'nu' },
  cue: { kind: 'flick' }, dodge: { kind: 'drag', path: 'wander' }, hue: { kind: 'tap', every: 420 },
  land: { kind: 'hold', on: 450, off: 650 }, order: { kind: 'tap', every: 800 }, pop: { kind: 'tap', every: 1000, at: 'near' },
  ready: { kind: 'tap', every: 700 }, recall: { kind: 'tap', every: 600 }, swing: { kind: 'hold', on: 650, off: 450 },
  carve: { kind: 'flick' }, bank: { kind: 'flick' }, surf: { kind: 'hold', on: 450, off: 650 }, shade: { kind: 'drag', path: 'wander' },
  poise: { kind: 'tap', every: 1200, at: 'any' }, ferry: { kind: 'drag', path: 'wander' }, fuse: { kind: 'tap', every: 900 }, gate: { kind: 'drag', path: 'wander' }, tune: { kind: 'drag', path: 'wander' },
};

/** The size a tile plays at, before it's scaled down to fit: about a phone's arena. */
const SHOT_W = 300;
const SHOT_H = 400;

/** One tile's game, playing itself on its own small stage, silently. */
class Preview {
  private stage: Stage;
  private toy: Toy;
  private ctx: CanvasRenderingContext2D;
  private bot: Bot;
  private t0 = performance.now();
  private last = performance.now();
  private down: Pt | null = null;
  private next = 600;
  private round = 0;

  constructor(id: GameId, private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.toy = MAKE[id]();
    this.bot = BOTS[id];
    this.stage = {
      c: { x: 0, y: 0 }, m: { x: 0, y: 0 }, hw: 100, hh: 100, rr: 40, R: 100, court: !!this.toy.court, pad: null,
      nu: new Body(), fx: new Fx(), bests: { course: {} }, rim: null, save: () => {}, score: () => {},
      // A preview plays on: a run over starts again, and a level done goes on, after a moment.
      end: () => this.later(() => this.toy.enter(this.stage)),
      prompt: (go) => this.later(go),
    };
    layoutStage(this.stage, SHOT_W, SHOT_H, this.toy);
    this.stage.nu.at(this.stage.c);
    hush(() => this.toy.enter(this.stage));
    this.fit();
  }

  private waiting = false;
  private later(f: () => void): void {
    if (this.waiting) return;
    this.waiting = true;
    setTimeout(() => { this.waiting = false; hush(f); }, 1200);
  }

  private fit(): void {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width) return;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    const k = (r.width / SHOT_W) * dpr;
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  frame(now: number): void {
    const dt = Math.min(40, now - this.last);
    this.last = now;
    hush(() => {
      this.drive(now - this.t0, dt);
      this.ctx.clearRect(0, 0, SHOT_W, SHOT_H);
      paintStage(this.stage, this.ctx, this.toy, dt, now, true, true);
    });
  }

  private press(p: Pt): void { this.down = p; this.toy.down?.(this.stage, p); }
  private drag(p: Pt): void { if (this.down) { this.down = p; this.toy.move?.(this.stage, p); } }
  private lift(): void { if (this.down) { this.toy.up?.(this.stage, this.down); this.down = null; } }

  /** The finger's part, `t` ms in. */
  private drive(t: number, dt: number): void {
    const s = this.stage, b = this.bot, nu = s.nu;
    this.next -= dt;
    switch (b.kind) {
      case 'tap': {
        if (this.next > 0) return;
        this.next = b.every * (0.8 + Math.random() * 0.4);
        const p = b.at === 'nu' ? { x: nu.x + (Math.random() - 0.5) * 10, y: nu.y + nu.r * 0.8 }
          : b.at === 'near' ? { x: nu.x + (Math.random() - 0.5) * 120, y: nu.y + (Math.random() - 0.5) * 120 }
          : b.at === 'side' ? { x: s.m.x + (Math.random() < 0.5 ? -1 : 1) * s.hw * 0.5, y: s.m.y }
          : s.court ? { x: s.c.x + (Math.random() - 0.5) * s.R * 1.4, y: s.c.y + (Math.random() - 0.5) * s.R * 1.4 } : anywhere(s, 20);
        this.press(p);
        this.lift();
        return;
      }
      case 'drag': {
        const p = b.path === 'circle' ? { x: s.c.x + Math.cos(t / 900) * s.R * 0.7, y: s.c.y + Math.sin(t / 900) * s.R * 0.7 }
          : b.path === 'row' ? { x: s.m.x + Math.sin(t / 700) * s.hw * 0.7, y: s.m.y + s.hh * 0.6 }
          : b.path === 'nu' ? { x: nu.x, y: nu.y }
          : { x: s.m.x + Math.sin(t / 900) * s.hw * 0.55, y: s.m.y + Math.sin(t / 1300) * s.hh * 0.5 };
        // A fresh press now and then, which also starts a game that's over again.
        if (this.next <= 0) { this.lift(); this.next = 5000; this.press(p); return; }
        this.drag(p);
        return;
      }
      case 'hold': {
        if (this.next > 0) return;
        if (this.down) { this.lift(); this.next = b.off; } else {
          this.press(s.court ? { x: s.c.x + (Math.random() - 0.5) * s.R, y: s.c.y + (Math.random() - 0.5) * s.R } : anywhere(s, 30));
          this.next = b.on;
        }
        return;
      }
      case 'sling': {
        if (this.down) {
          const k = Math.min(1, (2800 - this.next) / 500);
          this.drag({ x: this.down.x + 3 * k, y: this.down.y + 6 * k });
          if (this.next < 2300) this.lift();
          return;
        }
        if (this.next > 0) return;
        this.next = 2800;
        this.press({ x: nu.x, y: nu.y });
        return;
      }
      case 'flick': {
        // A press, a pull back some way over half a second, and let go.
        if (this.down) {
          const k = clamp((900 - this.next) / 500, 0, 1);
          this.drag({ x: this.flickAt!.x + this.flickBy.x * k, y: this.flickAt!.y + this.flickBy.y * k });
          if (k >= 1) this.lift();
          return;
        }
        if (this.next > 0) return;
        this.next = 900;
        this.flickAt = anywhere(s, 40);
        const a = Math.random() * TAU;
        this.flickBy = { x: Math.cos(a) * 90, y: Math.sin(a) * 90 };
        this.press(this.flickAt);
        return;
      }
      case 'loop': {
        if (this.next <= 0) {
          this.lift();
          this.next = 2200;
          this.round++;
          const at = anywhere(s, 90);
          this.loopAt = at;
          this.press({ x: at.x + 70, y: at.y });
          return;
        }
        if (!this.loopAt) return;
        const a = ((2200 - this.next) / 1600) * TAU;
        if (a <= TAU * 1.05) this.drag({ x: this.loopAt.x + Math.cos(a) * 70, y: this.loopAt.y + Math.sin(a) * 70 });
        else this.lift();
      }
    }
  }

  private loopAt: Pt | null = null;
  private flickAt: Pt | null = null;
  private flickBy: Pt = { x: 0, y: 0 };
}

/** The picker's tiles, playing while they're in view; a frame for each one shown. */
class Shows {
  private live = new Map<Element, Preview>();
  private seen = new Set<Element>();
  private io: IntersectionObserver;
  private frame = 0;

  constructor(root: HTMLElement) {
    this.io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) this.seen.add(e.target); else this.seen.delete(e.target);
    }, { root, rootMargin: '60px' });
    for (const c of root.querySelectorAll('.nup-shot canvas')) this.io.observe(c);
    const tick = (now: number) => {
      for (const c of this.seen) {
        let p = this.live.get(c);
        if (!p) {
          const id = c.closest<HTMLElement>('[data-place]')?.dataset.place as GameId;
          p = new Preview(id, c as HTMLCanvasElement);
          this.live.set(c, p);
        }
        p.frame(now);
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.io.disconnect();
    this.live.clear();
  }
}

export class NuPark {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scoreEl: HTMLElement;
  private bestEl: HTMLElement;
  private goBtn: HTMLButtonElement;
  private off: HTMLElement;
  private toys = Object.fromEntries((Object.keys(MAKE) as PlaceId[]).map((k) => [k, MAKE[k]()])) as Record<PlaceId, Toy>;
  private place: PlaceId = 'home';
  private stage: Stage;
  private frame = 0;
  private last = 0;
  private open = false;
  /** Nu is ours: borrowed from the guide. */
  private have = false;
  private borrowed = false;
  private size = { w: 0, h: 0 };
  /** The picker is open, and the game Nu fancies today (it circles it there). */
  private picking: Sheet | null = null;
  /** Called when the picker closes (the trail's dropdown, when it opened it). */
  private onPicked: (() => void) | null = null;
  /** Nu's own hidden state from before the picker hid it. */
  private wasHidden = false;
  /** The picker's tiles, playing. */
  private shows: Shows | null = null;
  private since = 0;
  /** A roulette under way: its six games, which one, the points so far, the time the game has
   *  left, its count so far, and when it ended (the bar to the next is up). */
  private rou: { ids: GameId[]; i: number; pts: number[]; left: number; raw: number; doneAt: number } | null = null;
  private nextEl: HTMLElement;
  private nextShow: Preview | null = null;
  /** The last count the open game showed. */
  private raw = 0;
  /** The card over the arena when a run is over (its score and Again) or a level is done (Next). */
  private overEl: HTMLElement;
  private overGo: (() => void) | null = null;
  /** The open game's best when it started, to tell a new best. */
  private bestWas = 0;
  private rouLast = 0;

  constructor(host: HTMLElement) {
    this.root = host;
    host.innerHTML = '<div class="nup">'
      + '<div class="nup-field"><canvas class="nup-canvas"></canvas>'
      + '<div class="nup-off" hidden><p>Nu is switched off in Settings.</p><button type="button" class="nup-on">Turn Nu on</button></div>'
      + '<button type="button" class="nup-next" hidden></button><div class="nup-over" hidden></div></div>'
      + '<div class="nup-foot"><p class="nup-score" aria-live="polite"></p>'
      + `<button type="button" class="nup-go" aria-label="Games" aria-expanded="false">${PICK_ICON}</button>`
      + '<p class="nup-best"></p></div>'
      + '</div>';
    this.canvas = host.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.scoreEl = host.querySelector('.nup-score')!;
    this.bestEl = host.querySelector('.nup-best')!;
    this.goBtn = host.querySelector('.nup-go')!;
    this.off = host.querySelector('.nup-off')!;
    this.nextEl = host.querySelector('.nup-next')!;
    this.overEl = host.querySelector('.nup-over')!;
    this.nextEl.onclick = () => { if (this.rou?.doneAt && performance.now() - this.rou.doneAt > 500) this.advance(); };
    this.goBtn.onclick = () => this.togglePick();
    host.querySelector<HTMLButtonElement>('.nup-on')!.onclick = () => {
      const save = loadSave();
      save.settings.nu = true;
      writeSave(save);
      window.dispatchEvent(new Event('atomos:settings'));
      this.arrive();
    };
    const bests = readBests();
    this.stage = {
      c: { x: 0, y: 0 }, m: { x: 0, y: 0 }, hw: 100, hh: 100, rr: 40, R: 100, court: false, pad: null, nu: new Body(), fx: new Fx(), bests, rim: null,
      save: () => writeBests(bests),
      score: (n, b) => {
        // A roulette game that's over keeps its points showing while the next one comes up.
        if (this.rou?.doneAt) return;
        const id = this.place === 'home' ? null : this.place, own = id && this.toys[id].tally;
        if (typeof n === 'number') this.raw = n;
        // Counts show as points (points.ts), drawn as tiny atoms (score-atom.ts). Games that
        // keep their own count show the atom of the run so far (Course's grows along the
        // course; Pairs' loses electrons with every turn), with no best beside it; Hockey keeps
        // its match score. The best is the smaller atom at the right, without a word.
        const toy = id ? this.toys[id] : null, live = own && toy?.raw && id !== 'hockey';
        const show = (v: number | string, size: number) => (typeof v === 'number' && id && !own ? atomSvg(points(id, v), size) : `<span>${v}</span>`);
        this.scoreEl.innerHTML = n === null ? '' : live ? atomSvg(points(id!, toy!.raw!()), 48) : show(n, 48);
        if (this.rou) this.bestEl.textContent = this.rouLine();
        else this.bestEl.innerHTML = n === null || b === null || b === undefined || live ? '' : show(b, 26);
      },
      end: (raw) => this.ended(raw),
      prompt: (go) => this.showOver(null, go),
      roulette: () => this.openRoulette(),
    };
    this.wirePointer();
    new ResizeObserver(() => this.fit()).observe(this.canvas);
  }

  /** The game open, for the header's trail; null on Nu's home. */
  get gameName(): string | null { return this.place === 'home' ? null : GAMES.find((g) => g.id === this.place)?.label ?? null; }

  show(): void {
    this.root.hidden = false;
    this.open = true;
    this.since = performance.now();
    wake();
    this.place = 'home';
    this.fit();
    this.closePick();
    this.arrive();
    this.loop();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.stopRoulette();
    // Time spent playing warms Nu up, a little per minute.
    if (this.have) warmUp(Math.min(0.3, ((performance.now() - this.since) / 60_000) * 0.05));
    this.giveBack();
  }

  /** The open game's icon, for the trail. */
  get gameIcon(): string | null { return this.place === 'home' ? null : GAMES.find((g) => g.id === this.place)?.icon ?? null; }

  /** The games picker is open (the trail's dropdown shows it as open). */
  get pickerOpen(): boolean { return this.picking !== null; }

  /** Opens straight into a game (Home's Nu section). */
  openGame(id: GameId): void { this.go(id); }

  // ---- The roulette (roulette.ts) ----------------------------------------------------------

  /** The roulette sheet: six games spin into place, one after the other; Play starts them.
   *  After a run it shows the run's score instead, and Play spins a new six. */
  openRoulette(run: Run | null = null, best = false): void {
    if (!this.have) return;
    this.closePick();
    let ids = pickSix();
    const sheet = openSheet({ title: 'Roulette', icon: 'nu', label: 'Nu’s roulette', from: 'top', className: 'nur-sheet' });
    const spin = () => {
      sheet.body.innerHTML = rouletteHtml(ids, null, false);
      const slots = [...sheet.body.querySelectorAll<HTMLElement>('.nur-six li')];
      const t0 = performance.now(), all = GAMES.map((g) => g.id);
      // Each slot flicks through games, then settles, one after the other.
      const roll = (now: number) => {
        if (!sheet.body.isConnected) return;
        let busy = false;
        slots.forEach((el, k) => {
          const stop = 350 + k * 260;
          if (el.dataset.done) return;
          if (now - t0 >= stop || reducedMotion()) { el.innerHTML = chip(ids[k]); el.dataset.done = '1'; el.classList.add('is-in'); return; }
          busy = true;
          if (!el.dataset.at || now - Number(el.dataset.at) > 70) { el.dataset.at = String(now); el.innerHTML = chip(all[Math.floor(Math.random() * all.length)]); }
        });
        if (busy) requestAnimationFrame(roll); else sheet.body.querySelector('.nur-six')?.classList.remove('is-spinning');
      };
      requestAnimationFrame(roll);
    };
    if (run) sheet.body.innerHTML = rouletteHtml(run.games.map((g) => g.id), run, best); else spin();
    sheet.foot.innerHTML = `<button type="button" class="nur-again">${ROULETTE_ICON}<span>${run ? 'New six' : 'Spin again'}</span></button>`
      + `<button type="button" class="nur-play"${run ? ' hidden' : ''}>${icon('play', { size: 22 })}<span>Play</span></button>`;
    const again = sheet.foot.querySelector<HTMLButtonElement>('.nur-again')!, play = sheet.foot.querySelector<HTMLButtonElement>('.nur-play')!;
    again.onclick = () => { ids = pickSix(); spin(); play.hidden = false; again.querySelector('span')!.textContent = 'Spin again'; };
    play.onclick = () => { sheet.close(); this.startRoulette(ids); };
  }

  private startRoulette(ids: GameId[]): void {
    this.go('home');
    this.rou = { ids, i: 0, pts: [], left: GAME_MS, raw: 0, doneAt: 0 };
    this.go(ids[0], true);
    this.stage.score(0, null);
  }

  private stopRoulette(): void {
    this.rou = null;
    this.nextEl.hidden = true;
    this.nextShow = null;
  }

  /** The foot's line in a roulette: the game's time left, which game, and the total so far. */
  private rouLine(): string {
    const r = this.rou!, secs = Math.ceil(r.left / 1000);
    return `${r.i + 1} of ${ROUND} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  }

  /** A run is over: in a roulette, this game is done; the bar to the next comes up. */
  private ended(raw: number): void {
    const r = this.rou;
    if (!r) { if (this.place !== 'home') this.showOver(raw, null); return; }
    if (r.doneAt || this.place !== r.ids[r.i]) return;
    const id = r.ids[r.i], pts = points(id, raw);
    r.pts[r.i] = pts;
    r.doneAt = performance.now();
    this.scoreEl.innerHTML = atomSvg(pts, 48);
    this.bestEl.textContent = this.rouLine();
    const last = r.i >= ROUND - 1, next = last ? null : GAMES.find((g) => g.id === r.ids[r.i + 1])!;
    this.nextEl.innerHTML = '<span class="nup-next-row">'
      + (next ? '<span class="nup-shot"><canvas aria-hidden="true"></canvas></span>' : `<span class="nup-next-wheel">${wheelSvg(48)}</span>`)
      + `<span class="nup-next-text"><small>${next ? 'Next' : 'Roulette done'}</small><b>${next ? `<i>${next.icon}</i>${next.label}` : 'Total'}</b></span>`
      + `<span class="nup-next-pts">${atomSvg(last ? r.pts.reduce((a, b) => a + b, 0) : pts, 44)}</span></span>`
      + `<span class="nup-next-bar"><i style="animation-duration:${NEXT_MS}ms"></i></span>`;
    this.nextEl.setAttribute('aria-label', next ? `Next: ${next.label}` : 'See the roulette score');
    this.nextEl.hidden = false;
    this.nextShow = next ? new Preview(next.id, this.nextEl.querySelector('canvas')!) : null;
  }

  /** Next level: play into a bar, so it doesn't read as resume. */
  private static readonly NEXT = '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" aria-hidden="true"><path d="M5 5.6V18.4C5 19.2 5.9 19.7 6.6 19.2L15.6 12.8C16.2 12.4 16.2 11.6 15.6 11.2L6.6 4.8C5.9 4.3 5 4.8 5 5.6Z" fill="currentColor"/><rect x="17" y="4.5" width="3" height="15" rx="1.5" fill="currentColor"/></svg>';

/** Over the arena: a run's score as an atom (ringed for a new best) and Again; or, with `next`,
   *  a level done and the Next button. While it shows, the arena takes no taps. */
  private showOver(raw: number | null, next: (() => void) | null): void {
    const id = this.place;
    if (id === 'home') return;
    this.overGo = next;
    if (next) {
      this.overEl.innerHTML = `<button type="button" class="nup-again is-next" aria-label="Next level">${NuPark.NEXT}</button>`;
    } else {
      // The run's atom (all in the accent for a new best), then Again.
      const toy = this.toys[id], own = toy.tally && !toy.raw, pts = points(id, toy.tally && toy.raw ? toy.raw() : raw ?? 0), fresh = !toy.tally && (raw ?? 0) > this.bestWas;
      this.overEl.innerHTML = (own ? '' : `<span class="nup-over-atom${fresh ? ' is-best' : ''}">${atomSvg(pts, 84, { tone: fresh ? 'var(--c-accent)' : undefined, label: `${fmt(pts)} points${fresh ? ', a new best' : ''}` })}</span>`)
        + `<button type="button" class="nup-again" aria-label="Play again">${icon('restart', { size: 36 })}</button>`;
    }
    this.overEl.hidden = false;
    const btn = this.overEl.querySelector<HTMLButtonElement>('.nup-again')!;
    btn.onclick = () => this.again();
    // Not at once: a tap meant for the game shouldn't land on the button.
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 450);
  }

  private hideOver(): void {
    this.overEl.hidden = true;
    this.overEl.innerHTML = '';
    this.overGo = null;
  }

  /** Again (the run starts over) or Next (the next level). */
  private again(): void {
    const go = this.overGo;
    this.hideOver();
    if (go) { go(); return; }
    if (this.place === 'home') return;
    this.bestWas = best(this.stage, this.place);
    this.stage.fx.clear();
    this.stage.rim = null;
    newTheme();
    this.toys[this.place].enter(this.stage);
  }

  /** On to the next game (or, after the sixth, the roulette's score). */
  private advance(): void {
    const r = this.rou;
    if (!r) return;
    this.nextEl.hidden = true;
    this.nextShow = null;
    if (r.i >= ROUND - 1) {
      const run: Run = { at: Date.now(), total: Math.round(r.pts.reduce((a, b) => a + b, 0) * 10) / 10, games: r.ids.map((id, k) => ({ id, pts: r.pts[k] ?? 0 })) };
      const best = keepRun(run);
      this.rou = null;
      this.go('home');
      this.openRoulette(run, best);
      return;
    }
    r.i++;
    r.doneAt = 0;
    r.left = GAME_MS;
    this.go(r.ids[r.i], true);
    this.stage.score(0, null);
  }

  /** The roulette's clock, each frame the game plays. */
  private rouTick(now: number): void {
    const r = this.rou;
    // The game's own clock, by the wall: frames may be slow, but a minute is a minute (a pause,
    // such as a sheet open over it, doesn't count).
    const dt = Math.min(250, now - (this.rouLast || now));
    this.rouLast = now;
    if (!r) return;
    if (r.doneAt) {
      this.nextShow?.frame(now);
      if (now - r.doneAt > NEXT_MS) this.advance();
      return;
    }
    const was = Math.ceil(r.left / 1000);
    r.left -= dt;
    if (r.left <= 0) { const t = this.toys[r.ids[r.i]]; this.ended(t.raw?.() ?? this.raw); return; }
    if (Math.ceil(r.left / 1000) !== was) this.bestEl.textContent = this.rouLine();
  }

  /** Nu's home, from the header's trail. */
  goHome(): void { this.go('home'); }

  /** Back to Nu's home from a game (or the picker closes). False if already there. */
  back(): boolean {
    if (this.picking) { this.closePick(); return true; }
    if (this.rou) this.stopRoulette();
    if (this.place === 'home') return false;
    this.go('home');
    return true;
  }

  /** Nu flies in from the logo; play starts when it's here. */
  private arrive(): void {
    const on = nuEnabled();
    this.off.hidden = on;
    this.goBtn.hidden = !on;
    this.stage.nu.hidden = true;
    this.have = false;
    if (!on) { this.stage.score(null); return; }
    const r = this.canvas.getBoundingClientRect();
    const to = { x: r.left + this.stage.c.x, y: r.top + this.stage.c.y };
    void nuBorrow(to).then((got) => {
      this.borrowed = got;
      if (!this.open) { this.giveBack(); return; }
      const now = this.canvas.getBoundingClientRect();
      this.stage.nu.at({ x: to.x - now.left, y: to.y - now.top });
      this.stage.nu.hidden = false;
      this.have = true;
      this.toys[this.place].enter(this.stage);
    });
  }

  private giveBack(): void {
    if (!this.borrowed) return;
    this.borrowed = false;
    this.have = false;
    const r = this.canvas.getBoundingClientRect(), nu = this.stage.nu;
    nuGiveBack({ x: r.left + clamp(nu.x, 0, r.width), y: r.top + clamp(nu.y, 0, r.height) });
  }

  private go(id: PlaceId, roulette = false): void {
    this.closePick();
    // Picking a game (or going home) ends a roulette.
    if (!roulette && this.rou) this.stopRoulette();
    if (id === this.place && !roulette) return;
    this.place = id;
    this.raw = 0;
    this.hideOver();
    this.bestWas = id === 'home' ? 0 : best(this.stage, id);
    newTheme();
    this.stage.court = !!this.toys[id].court;
    this.layout();
    this.stage.fx.clear();
    this.stage.rim = null;
    this.stage.nu.scale = 1;
    this.stage.nu.glow = 1;
    if (this.have) this.toys[id].enter(this.stage);
    window.dispatchEvent(new Event('atomos:nav'));
  }

  private togglePick(): void { this.openGames(); }

  /** The games, A to Z, in a sheet that scrolls: two to a row, each a tile playing a little of
   *  itself, and under them "Read from the Atlas". The round button under the arena and the
   *  trail's dropdown both open it. Nu leaves the arena for the sheet and circles the game it
   *  fancies today. */
  openGames(onClose: (() => void) | null = null): void {
    if (!this.have) return;
    if (this.picking) { this.closePick(); return; }
    const fancy = nuPick().id;
    const sheet = openSheet({ title: 'Games', icon: 'nu', label: 'Nu’s games', from: 'top', className: 'nup-sheet', onClose: () => this.picked(sheet) });
    const book = readBook();
    sheet.body.innerHTML = `<button type="button" class="nup-rou">${wheelSvg(44)}<span class="nup-rou-text"><b>Roulette</b><small>Six games in a row</small></span>`
      + `<span class="nup-rou-best">${book.best ? atomSvg(book.best, 26) : ''}</span></button>`
      + '<div class="nup-tiles">' + GAMES.map((g) => {
      const label = `${g.label}${g.id === fancy ? ', Nu’s pick today' : ''}`;
      return `<button type="button" class="nup-tile${g.id === this.place ? ' is-here' : ''}" data-place="${g.id}" aria-label="${label}">`
        + '<span class="nup-shot"><canvas aria-hidden="true"></canvas>'
        + `<span class="nup-name"><i>${g.icon}${g.id === fancy ? '<b class="nup-nu" aria-hidden="true"></b>' : ''}</i><span>${g.label}</span></span></span></button>`;
    }).join('') + '</div>';
    sheet.body.querySelector<HTMLButtonElement>('.nup-rou')!.onclick = () => this.openRoulette();
    sheet.foot.remove();
    for (const b of sheet.body.querySelectorAll<HTMLButtonElement>('.nup-tile')) b.onclick = () => this.go(b.dataset.place as PlaceId);
    this.picking = sheet;
    this.onPicked = onClose;
    this.wasHidden = this.stage.nu.hidden;
    this.stage.nu.hidden = true;
    this.goBtn.setAttribute('aria-expanded', 'true');
    this.shows = new Shows(sheet.body);
    const here = sheet.body.querySelector<HTMLElement>('.is-here');
    requestAnimationFrame(() => {
      if (here) sheet.body.scrollTop = Math.max(0, here.offsetTop - sheet.body.clientHeight / 2 + here.offsetHeight / 2);
      here?.focus({ preventScroll: true });
    });
  }

  private closePick(): void { this.picking?.close(); }

  /** The sheet has closed (its X, the mask, Back, a game picked): Nu comes back to the arena. */
  private picked(sheet: Sheet): void {
    if (this.picking !== sheet) return;
    this.picking = null;
    this.shows?.stop();
    this.shows = null;
    const then = this.onPicked;
    this.onPicked = null;
    then?.();
    this.stage.nu.hidden = this.wasHidden;
    this.goBtn.setAttribute('aria-expanded', 'false');
  }

  private fit(): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const changed = Math.abs(r.width - this.size.w) > 1 || Math.abs(r.height - this.size.h) > 1;
    this.size = { w: r.width, h: r.height };
    this.layout();
    if (changed && this.have) this.toys[this.place].resize?.(this.stage);
  }

  private layout(): void { layoutStage(this.stage, this.size.w, this.size.h, this.toys[this.place]); }

  private wirePointer(): void {
    const c = this.canvas;
    const at = (e: PointerEvent): Pt => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let down = false;
    c.addEventListener('pointerdown', (e) => {
      if (!this.have) return;
      if (this.picking) { this.closePick(); return; }
      if (this.rou?.doneAt) { if (performance.now() - this.rou.doneAt > 600) this.advance(); return; }
      if (!this.overEl.hidden) return;
      down = true;
      c.setPointerCapture(e.pointerId);
      this.toys[this.place].down?.(this.stage, at(e));
    });
    c.addEventListener('pointermove', (e) => { if (down && this.have) this.toys[this.place].move?.(this.stage, at(e)); });
    const end = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      if (this.have) this.toys[this.place].up?.(this.stage, at(e));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  private loop(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.open) return;
      const dt = Math.min(40, now - this.last);
      this.last = now;
      this.ctx.clearRect(0, 0, this.size.w, this.size.h);
      paintStage(this.stage, this.ctx, this.have ? this.toys[this.place] : null, dt, now, !this.picking);
      if (this.have && !this.picking && !openSheetPanel()) this.rouTick(now); else this.rouLast = 0;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
