// Drawing and touch for Shells: drag a ring round the nucleus and it turns, slot by slot, with
// every ring its links carry. Each ring is a faint band in its own color with its beads on it;
// small wedges on a ring's inner edge are the marks for the beads of the ring inside it, in that
// ring's color, and the fixed dial round the outside holds the marks for the outermost ring. A
// bead that faces its mark sends a faint spoke to it; a pair whose beads all face their marks
// lights up with bright spokes and a glowing seam between the two rings. A link is a silver tooth
// bridging the two rings it joins.
//
// The board is painted by `paintShells`, which the rule cards' pictures share.

import { aligned, alignment, chainEnd, cloneShells, nextTurn, remaining, ringCount, signed, solved, turn, type ShellsState } from './shells';
import { bead, C } from './palette';
import { drawFrame } from './frame';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<section class="how-specs"><h3>Specs</h3><ul>
<li><b>Flawless:</b> Line up every pair in par turns or fewer, where a turn is one drag of a ring however far it goes and par is the fewest turns the board needs, and without Show me.</li>
<li><b>Where it's played:</b> A reserve game, played from the Puzzles screen.</li>
<li><b>Board:</b> Very easy boards have three rings of eight slots and no links, so working from the outside in is enough. The rings grow to four from Medium and five from Hard, the slots to twelve and the beads to six on a ring.</li>
<li><b>Links:</b> Links arrive from Easy on: one at first, then two or three that make chains.</li>
<li><b>Par:</b> Par is one turn per ring that needs turning, worked out exactly from the links.</li>
<li><b>Built:</b> From Medium on, a board is kept only when lining up pairs one at a time, from the outside in or the inside out, takes more turns than par.</li>
</ul></section>
`;

/** The rings' colors, innermost first: the orbital colors, then silver for a fifth ring. */
export function ringColor(k: number): string {
  return [C.s, C.p, C.d, C.f, C.silverDim][k] ?? C.silverDim;
}

/** The rings' colors by name, for the hint line. */
const RING_NAMES = ['blue', 'green', 'gold', 'violet', 'silver'];

/** Milliseconds a turn takes to play out, and a newly lined-up pair glows brighter. */
const TURN_MS = 380;
const PULSE_MS = 700;

/** The board's center and the radius inside its frame. */
interface Geo { cx: number; cy: number; r: number }

/** The radii everything sits at, for a board of R rings. */
interface Radii { nucleus: number; band: number; ring: number[]; dial: number }

function radii(R: number, g: Geo): Radii {
  const dialW = 0.6;
  const nucleus = g.r * (R >= 5 ? 0.12 : 0.15);
  const band = (g.r - nucleus) / (R + dialW + 0.25);
  const ring = Array.from({ length: R }, (_, k) => nucleus + band * (k + 0.75));
  return { nucleus, band, ring, dial: nucleus + band * (R + 0.35) };
}

interface Paint {
  /** Extra turn of each ring in radians, on top of its offset (a drag or a turn playing out). */
  spin?: number[];
  /** Rings drawn as grabbed: the one held and those it carries. */
  hot?: number[];
  now: number;
  /** When each pair last lined up (performance time), for the glow's pulse. */
  since?: number[];
  /** Rule pictures: outline in amber every bead of a pair that is not lined up. */
  flag?: boolean;
}

const TAU = Math.PI * 2;

/** The angle of ring k's own slot j, where 0 is straight up and angles run clockwise. */
function slotAngle(s: ShellsState, k: number, j: number, spin: number[] | undefined): number {
  return -Math.PI / 2 + ((j + s.offsets[k]) / s.slots) * TAU + (spin?.[k] ?? 0);
}

const at = (g: Geo, r: number, a: number): Point => ({ x: g.cx + Math.cos(a) * r, y: g.cy + Math.sin(a) * r });

/** A wedge on a ring's inner edge pointing in at a bead's place: a mark. */
function wedge(ctx: CanvasRenderingContext2D, g: Geo, r: number, a: number, size: number, color: string, alpha: number): void {
  const tip = at(g, r - size, a);
  const half = (size * 0.9) / r;
  const l = at(g, r, a - half), rr = at(g, r, a + half);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(l.x, l.y);
  ctx.lineTo(rr.x, rr.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The nucleus: a small cluster of protons and neutrons. */
function nucleus(ctx: CanvasRenderingContext2D, g: Geo, r: number): void {
  const b = r * 0.36;
  const spots: [number, number, boolean][] = [[0, 0, true], [-1, -0.55, false], [1, -0.55, true], [-1, 0.55, true], [1, 0.55, false], [0, -1.1, false], [0, 1.1, false]];
  for (const [x, y, p] of spots) {
    if (Math.hypot(x, y) * b * 0.9 + b > r * 1.05) continue;
    bead(ctx, g.cx + x * b * 0.92, g.cy + y * b * 0.92, b * 0.62, p ? '#d9614a' : C.neutron, { rim: C.bg });
  }
}

/**
 * Paints the frame, the dial, every ring with its beads, marks and links, and the glow of each
 * lined-up pair. Returns the radii used, for hit testing.
 */
export function paintShells(ctx: CanvasRenderingContext2D, s: ShellsState, g: Geo, o: Paint): Radii {
  const R = ringCount(s), n = s.slots;
  const rad = radii(R, g);
  const band = rad.band;
  // A square frame with round corners, like the other boards.
  const side = g.r * 2 + band * 0.5;
  drawFrame(ctx, { x: g.cx - side / 2, y: g.cy - side / 2, w: side, h: side }, { width: Math.max(3, Math.min(7, band * 0.16)), radius: side * 0.22, color: C.frame });
  // Where every ring's beads stand right now (drag and turns included), and which face marks.
  const al = alignment(s);
  const angle = (k: number, j: number) => slotAngle(s, k, j, o.spin);
  // Faint bands: the dial, then the rings.
  ctx.save();
  ctx.lineWidth = band * 0.62;
  ctx.strokeStyle = C.surface2;
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, rad.dial, 0, TAU);
  ctx.stroke();
  for (let k = 0; k < R; k++) {
    const hot = o.hot?.includes(k);
    ctx.globalAlpha = hot ? 0.26 : 0.12;
    ctx.strokeStyle = hot ? C.accent : ringColor(k);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, rad.ring[k], 0, TAU);
    ctx.stroke();
  }
  // The orbit itself: a glowing line through each band.
  ctx.lineWidth = Math.max(1.5, band * 0.07);
  for (let k = 0; k < R; k++) {
    ctx.globalAlpha = al[k] ? 0.9 : 0.55;
    ctx.strokeStyle = ringColor(k);
    ctx.shadowColor = ringColor(k);
    ctx.shadowBlur = band * 0.35;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, rad.ring[k], 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
  // Glowing seams between lined-up pairs, pulsing as they line up.
  for (let k = 0; k < R; k++) {
    if (!al[k]) continue;
    const since = o.since?.[k];
    const pulse = since === undefined ? 0 : Math.max(0, 1 - (o.now - since) / PULSE_MS);
    const outerR = k + 1 < R ? rad.ring[k + 1] : rad.dial;
    const seam = (rad.ring[k] + outerR) / 2;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.45 * pulse;
    ctx.strokeStyle = ringColor(k);
    ctx.lineWidth = Math.max(2, band * (0.08 + 0.12 * pulse));
    ctx.shadowColor = ringColor(k);
    ctx.shadowBlur = band * 0.5;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, seam, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  // Spokes: each bead that faces its mark, faint; bright when its whole pair lines up.
  for (let k = 0; k < R; k++) {
    const outer = k + 1 < R ? k + 1 : -1;
    const shift = s.offsets[k] - (outer >= 0 ? s.offsets[outer] : 0);
    const spinGap = (o.spin?.[k] ?? 0) - (outer >= 0 ? o.spin?.[outer] ?? 0 : 0);
    if (Math.abs(spinGap) > 0.02) continue;
    const markR = (outer >= 0 ? rad.ring[outer] : rad.dial) - band * 0.42;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = ringColor(k);
    ctx.lineWidth = Math.max(al[k] ? 2 : 1, band * (al[k] ? 0.12 : 0.05));
    ctx.globalAlpha = al[k] ? 0.9 : 0.28;
    for (let j = 0; j < n; j++) {
      if (!s.beads[k][j] || !s.beads[k][((j + shift) % n + n) % n]) continue;
      const a = angle(k, j);
      const p = at(g, rad.ring[k] + band * 0.26, a), q = at(g, markR - band * 0.02, a);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Marks: on each ring's inner edge for the ring inside it, and on the dial for the outermost.
  const markSize = band * 0.3;
  for (let k = 0; k < R; k++) {
    const holder = k + 1 < R ? k + 1 : -1;
    const r = (holder >= 0 ? rad.ring[holder] : rad.dial) - band * 0.42 + markSize;
    for (let j = 0; j < n; j++) {
      if (!s.beads[k][j]) continue;
      const a = holder >= 0 ? angle(holder, j) : -Math.PI / 2 + (j / n) * TAU;
      wedge(ctx, g, r, a, markSize, ringColor(k), 0.9);
    }
  }
  // Links: a silver tooth from ring k to ring k + 1, half a slot along ring k from its first slot.
  for (let k = 0; k + 1 < R; k++) {
    if (!s.links[k]) continue;
    for (const j of [0.5, n / 2 + 0.5]) {
      const a = -Math.PI / 2 + ((j + s.offsets[k]) / n) * TAU + (o.spin?.[k] ?? 0);
      const p = at(g, rad.ring[k] + band * 0.2, a), q = at(g, rad.ring[k + 1] - band * 0.2, a);
      ctx.save();
      ctx.strokeStyle = C.silverDim;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, band * 0.2);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.restore();
    }
  }
  // Gaps as dim dots, beads as discs in the ring's color, lit when their pair lines up.
  const beadR = Math.max(3, Math.min(band * 0.24, (rad.ring[0] * Math.PI) / n * 0.62));
  for (let k = 0; k < R; k++) {
    const color = ringColor(k);
    const outer = k + 1 < R ? s.offsets[k + 1] : 0;
    const shift = s.offsets[k] - outer;
    for (let j = 0; j < n; j++) {
      const p = at(g, rad.ring[k], angle(k, j));
      if (!s.beads[k][j]) {
        ctx.fillStyle = C.surface3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1.5, band * 0.06), 0, TAU);
        ctx.fill();
        continue;
      }
      bead(ctx, p.x, p.y, beadR, color, { rim: C.bg, glow: al[k] ? color : undefined });
      if (o.flag && !al[k] && !s.beads[k][((j + shift) % n + n) % n]) {
        ctx.save();
        ctx.strokeStyle = C.warn;
        ctx.lineWidth = Math.max(2, band * 0.08);
        ctx.beginPath();
        ctx.arc(p.x, p.y, beadR + Math.max(2, band * 0.08), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  nucleus(ctx, g, rad.nucleus);
  return rad;
}

/** A turn playing out: the rings it moved and how far they still have to go, in radians. */
interface Anim { rings: number[]; from: number; at: number }

export class ShellsView implements PuzzleView {
  private state: ShellsState;
  private history: ShellsState[] = [];
  private reduced: boolean;
  private geo: Geo = { cx: 0, cy: 0, r: 0 };
  private rad: Radii | null = null;
  /** The ring held and the angle the pointer has swept since it went down. */
  private drag: { ring: number; last: number; swept: number } | null = null;
  private anim: Anim | null = null;
  private since: number[] = [];
  private seen: boolean[] = [];
  private mark: { state: ShellsState; ring: number } | null = null;

  constructor(private readonly initial: ShellsState, reducedMotion: boolean) {
    this.state = cloneShells(initial);
    this.reduced = reducedMotion;
    this.seen = alignment(this.state);
  }

  get won(): boolean { return solved(this.state) && !this.drag; }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    return { progress: { label: 'Lined up', value: `${alignment(s).filter(Boolean).length}/${ringCount(s)}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'Every shell lined up';
    const left = alignment(s).filter((a) => !a).length;
    return left === 1 ? '1 pair to line up' : `${left} pairs to line up`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won || this.drag) return null;
    const s = this.state;
    const t = nextTurn(s);
    if (!t) return null;
    const R = ringCount(s);
    const pairName = t.pair === R - 1 ? `the ${RING_NAMES[t.pair]} beads with the dial` : `the ${RING_NAMES[t.pair]} beads with their marks`;
    if (level === 2) {
      this.apply(t.ring, t.steps, this.reduced ? 0 : -t.steps * (TAU / s.slots));
      return { text: `Turned the ${RING_NAMES[t.ring]} ring: that lines up ${pairName} for good.`, moved: true };
    }
    this.mark = { state: s, ring: t.ring };
    const others = remaining(s).filter((v) => v !== 0).length;
    return { text: others === 1 ? `Turn the ${RING_NAMES[t.ring]} ring to line up ${pairName}.` : `Turn the ${RING_NAMES[t.ring]} ring next: it lines up ${pairName} for good.` };
  }

  /** Turns ring k by `steps` with its chain, as one move; `from` is how far (radians) the rings
   *  are drawn from their new place as the turn starts, easing to 0. */
  private apply(k: number, steps: number, from: number): void {
    const next = turn(this.state, k, steps);
    const end = chainEnd(this.state.links, k);
    const rings = Array.from({ length: end - k + 1 }, (_, i) => k + i);
    if (next) {
      this.history.push(this.state);
      if (this.history.length > 200) this.history.shift();
      this.state = next;
    }
    this.anim = !this.reduced && Math.abs(from) > 1e-3 ? { rings, from, at: performance.now() } : null;
  }

  restart(): void {
    this.state = cloneShells(this.initial);
    this.history = [];
    this.drag = null;
    this.anim = null;
  }

  canUndo(): boolean { return this.history.length > 0 && !this.drag; }

  undo(): boolean {
    if (this.drag) return false;
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.anim = null;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  /** The ring under a point: the one whose band is nearest, or -1 off the rings. */
  private ringAt(p: Point): number {
    const rad = this.rad;
    if (!rad) return -1;
    const d = Math.hypot(p.x - this.geo.cx, p.y - this.geo.cy);
    if (d < rad.nucleus * 0.8 || d > rad.ring[rad.ring.length - 1] + rad.band * 0.75) return -1;
    let best = -1, bestD = Infinity;
    rad.ring.forEach((r, k) => { if (Math.abs(d - r) < bestD) { bestD = Math.abs(d - r); best = k; } });
    return best;
  }

  private angleOf(p: Point): number {
    return Math.atan2(p.y - this.geo.cy, p.x - this.geo.cx);
  }

  down(p: Point): void {
    if (this.won) return;
    const k = this.ringAt(p);
    if (k < 0) return;
    this.anim = null;
    this.drag = { ring: k, last: this.angleOf(p), swept: 0 };
  }

  move(p: Point): void {
    const d = this.drag;
    if (!d) return;
    // Near the center the angle swings wildly; ignore points too close to it.
    if (Math.hypot(p.x - this.geo.cx, p.y - this.geo.cy) < (this.rad?.nucleus ?? 0) * 0.6) return;
    const a = this.angleOf(p);
    let delta = a - d.last;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    d.swept += delta;
    d.last = a;
  }

  up(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const step = TAU / this.state.slots;
    const steps = Math.round(d.swept / step);
    const left = d.swept - steps * step;
    if (signed(steps, this.state.slots) === 0) {
      // Back where it started: no move, the rings just settle.
      const end = chainEnd(this.state.links, d.ring);
      this.anim = this.reduced || Math.abs(left) < 1e-3 ? null : { rings: Array.from({ length: end - d.ring + 1 }, (_, i) => d.ring + i), from: left, at: performance.now() };
      return;
    }
    this.apply(d.ring, steps, left);
  }

  cancel(): void {
    this.drag = null;
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  /** The extra turn each ring is drawn with now, from a drag or a turn playing out. */
  private spins(now: number): { spin: number[]; hot: number[] } {
    const R = ringCount(this.state);
    const spin = Array<number>(R).fill(0);
    let hot: number[] = [];
    const d = this.drag;
    if (d) {
      const end = chainEnd(this.state.links, d.ring);
      for (let j = d.ring; j <= end; j++) { spin[j] = d.swept; hot.push(j); }
    } else if (this.anim) {
      const t = (now - this.anim.at) / TURN_MS;
      if (t >= 1) this.anim = null;
      else {
        const k = 1 - ease(t);
        for (const j of this.anim.rings) spin[j] = this.anim.from * k;
        hot = this.anim.rings;
      }
    }
    return { spin, hot };
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    // The frame stands a quarter band outside the rings' room; keep its stroke inside the area.
    const shrink = 1 + 0.25 / (ringCount(this.state) + 0.85);
    this.geo = { cx: area.x + area.w / 2, cy: area.y + area.h / 2, r: Math.max(10, Math.min(area.w, area.h) / 2 - 12) / shrink };
    const { spin, hot } = this.spins(now);
    // While a ring is held, show the board as it would be if let go here.
    let shown = this.state;
    if (this.drag) {
      const steps = Math.round(this.drag.swept / (TAU / this.state.slots));
      const t = turn(this.state, this.drag.ring, steps);
      if (t) {
        shown = t;
        // Drawn from the turned state, so the spin is only what is left after the whole slots.
        for (let j = 0; j < spin.length; j++) if (hot.includes(j)) spin[j] -= steps * (TAU / this.state.slots);
      }
    }
    const al = alignment(shown);
    for (let k = 0; k < al.length; k++) {
      if (al[k] && !this.seen[k]) this.since[k] = now;
      if (!al[k]) this.since[k] = -Infinity;
    }
    this.seen = al;
    this.rad = paintShells(ctx, shown, this.geo, { spin, hot, now, since: this.reduced ? undefined : this.since });
    const m = this.mark?.state === this.state && !this.won && !this.drag ? this.mark : null;
    if (m && this.rad) {
      const rr = this.rad.ring[m.ring] + this.rad.band * 0.42;
      drawHelpMark(ctx, this.geo.cx - rr, this.geo.cy - rr, rr * 2, rr * 2, now, this.reduced, rr);
    }
  }
}

// ---- rule pictures ---------------------------------------------------------------------

/** A picture board: rings from strings of '#' (bead) and '.' (gap), links and starting offsets. */
function board(rings: string[], links: boolean[], offsets: number[]): ShellsState {
  return {
    slots: rings[0].length,
    beads: rings.map((r) => [...r].map((ch) => ch === '#')),
    links,
    offsets: offsets.slice(),
    moves: 0,
    par: 0,
  };
}

const LEAD = 0.4;
const BEAT = 0.75;
const REST = 0.7;

/** One rule picture: the turns [ring, steps] played one after another, each easing in. A `bad`
 *  picture ends with the beads of any pair still out of line outlined in amber. */
function picture(s0: ShellsState, turns: [number, number][], caption: string, bad = false): Illustration {
  const steps: { before: ShellsState; after: ShellsState; ring: number; by: number; at: number }[] = [];
  let cur = s0;
  turns.forEach(([k, by], i) => {
    const next = turn(cur, k, by)!;
    steps.push({ before: cur, after: next, ring: k, by, at: LEAD + BEAT * i });
    cur = next;
  });
  const raw = LEAD + BEAT * turns.length + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      let st = s0;
      let spin: number[] | undefined;
      let hot: number[] | undefined;
      let since: number[] | undefined;
      for (const step of steps) {
        if (t < step.at) break;
        const k = (t - step.at) / (BEAT * 0.7);
        const R = ringCount(s0), slot = TAU / s0.slots;
        // The rings ease round; half way they count as arrived.
        st = k < 0.5 ? step.before : step.after;
        spin = undefined;
        hot = undefined;
        if (k < 1) {
          const end = chainEnd(s0.links, step.ring);
          spin = Array<number>(R).fill(0);
          hot = [];
          const left = k < 0.5 ? step.by * slot * ease(k) : -step.by * slot * (1 - ease(k));
          for (let j = step.ring; j <= end; j++) { spin[j] = left; hot.push(j); }
        }
        const arrive = (step.at + BEAT * 0.35) * 1000;
        since = alignment(step.after).map((a, q) => (a && !aligned(step.before, q) ? arrive : -Infinity));
      }
      const settled = t >= LEAD + BEAT * turns.length;
      const r = Math.min(w, h) / 2 - 3;
      const shrink = 1 + 0.25 / (ringCount(st) + 0.85);
      paintShells(ctx, st, { cx: w / 2, cy: h / 2, r: r / shrink }, { spin, hot, now: t * 1000, since, flag: bad && settled });
    },
  };
}

// The rule boards: rings of eight slots. Beads on the inner ring are its marks on the outer one.
const TWO = (o: number[], links = [false]) => board(['#..#....', '.#...##.'], links, o);
const THREE = (o: number[], links: boolean[]) => board(['#.#.....', '.#..#..#', '#...##..'], links, o);

export const RULES: RuleCard[] = [
  {
    title: 'Turn a ring',
    text: '**Drag a ring round the nucleus to turn it**, one slot at a time. Its beads, and the marks on its inner edge, turn with it.',
    good: picture(TWO([0, 2]), [[1, -2]], 'Drag to turn'),
  },
  {
    title: 'Line up',
    text: 'A pair lights up when every bead of a ring **faces a mark of its color** on the ring outside it. The outermost ring lines up with the fixed dial.',
    good: picture(TWO([1, 0]), [[0, -1]], 'Every bead on a mark'),
    bad: picture(TWO([2, 0]), [[0, -1]], 'One slot short', true),
  },
  {
    title: 'Linked rings',
    text: 'A silver tooth links a ring to the next one out: **turning it carries that ring along**, and any linked beyond it. Rings that turn together keep their pair as it was.',
    good: picture(THREE([0, 2, 2], [false, true]), [[1, -2]], 'Carried along'),
  },
  {
    title: 'Fewest turns',
    text: 'A turn shifts just two pairs: the one inside the ring and the one past the end of its chain. **Line up first the pair only one ring can still fix**, and par is one turn per ring.',
    good: picture(THREE([6, 7, 6], [false, true]), [[2, 1], [1, 1], [0, 2]], 'One turn per ring'),
    bad: picture(THREE([6, 7, 6], [false, true]), [[2, 2], [0, 1]], 'Pair left broken', true),
  },
];
