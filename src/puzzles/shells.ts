// Shells: rings of electron beads round a nucleus, turned like the dials of a combination lock.
//
// Three to five rings sit round the nucleus, each cut into the same number of slots. Some slots
// hold a bead, the rest are gaps. Every ring also carries marks on its inner edge: a stencil of
// the beads of the ring inside it. The fixed dial round the outside carries the stencil of the
// outermost ring. A pair of rings is lined up when every bead of the inner one sits in line with
// a mark of the outer one; the board is solved when every pair, and the outermost ring with the
// dial, is lined up.
//
// Drag a ring to turn it by whole slots. A tooth links some rings to the next ring out: turning a
// ring carries every ring it is linked to, out along the chain, by the same amount. So a turn
// keeps the pairs inside the moving chain as they are, and shifts exactly two pairs: the one just
// inside the ring turned, and the one just past the chain's outer end. Reading which pair only one
// remaining turn can fix, and fixing that first, is the puzzle.
//
// Game rule, not physics: electron shells do not turn, and they hold 2, 8, 18 and 32 electrons,
// not a handful of beads.

import { rand, randInt, seeded, type Rng } from './rng';

export interface ShellsState {
  /** Slots on every ring. */
  slots: number;
  /** beads[k][j]: ring k (0 innermost) has a bead at its own slot j. */
  beads: boolean[][];
  /** links[k]: ring k carries ring k + 1 when it turns (k < rings - 1). */
  links: boolean[];
  /** How far each ring has turned from its home, in slots clockwise, 0 to slots - 1. Solved when
   *  every ring is home. */
  offsets: number[];
  moves: number;
  par: number;
}

export interface ShellsShape {
  rings: number;
  slots: number;
  /** Beads on each ring, innermost first. */
  beads: number[];
  /** How many links to deal. */
  links: [number, number];
  /** How many turns past par a player who never looks ahead should need, at least (see `naive`). */
  trap: number;
  /** The least par a deal may have. */
  par: number;
  /** Most beads a wrong turn of a ring may line up with its marks (out of its beads). */
  decoy: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The board for dial d (1 to 100). Very easy: three rings, eight slots, no links, so the outside
 * in is the way. The rings, slots and beads grow with the dial, and links arrive from Easy on:
 * one at first, then two or three that form chains on five rings at Expert.
 */
export function shellsShape(d: number): ShellsShape {
  const t = Math.min(1, Math.max(0, (d - 1) / 99));
  const rings = d <= 30 ? 3 : d <= 62 ? 4 : 5;
  const slots = Math.round(lerp(8, 12, t));
  const extra = t < 0.25 ? 0 : t < 0.55 ? 1 : 1 + (t >= 0.85 ? 1 : 0);
  const beads = Array.from({ length: rings }, (_, k) => Math.min(Math.floor(slots / 2), 2 + Math.floor(k * 0.75) + extra));
  const links: [number, number] = d <= 12 ? [0, 0] : d <= 30 ? [1, 1] : d <= 45 ? [1, 2] : d <= 62 ? [2, 2] : d <= 80 ? [2, 3] : [2, 3];
  const trap = d <= 30 ? 0 : d <= 80 ? 1 : 2;
  const par = Math.min(rings, d <= 8 ? 2 : d <= 30 ? 3 : d <= 62 ? 4 : 5);
  const decoy = d <= 30 ? 1 : d <= 62 ? 2 : 3;
  return { rings, slots, beads, links, trap, par, decoy };
}

export const ringCount = (s: ShellsState): number => s.beads.length;

/** The outermost ring a turn of ring k carries: the end of its chain of links. */
export function chainEnd(links: boolean[], k: number): number {
  let m = k;
  while (m < links.length && links[m]) m++;
  return m;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** How many of ring k's beads face a mark on the ring outside it (pair k; pair rings - 1 is the
 *  outermost ring and the dial). */
export function matched(s: ShellsState, k: number): number {
  const n = s.slots, R = ringCount(s);
  const outer = k + 1 < R ? s.offsets[k + 1] : 0;
  const shift = s.offsets[k] - outer;
  let m = 0;
  for (let j = 0; j < n; j++) if (s.beads[k][j] && s.beads[k][mod(j + shift, n)]) m++;
  return m;
}

export function beadCount(s: ShellsState, k: number): number {
  return s.beads[k].filter(Boolean).length;
}

export function aligned(s: ShellsState, k: number): boolean {
  return matched(s, k) === beadCount(s, k);
}

/** Which pairs are lined up, innermost first. */
export function alignment(s: ShellsState): boolean[] {
  return s.beads.map((_, k) => aligned(s, k));
}

export function solved(s: ShellsState): boolean {
  return alignment(s).every(Boolean);
}

/** The pairs a turn of ring k shifts: the one just inside it (none for the innermost ring) and
 *  the one just past the end of its chain. */
export function touched(links: boolean[], k: number): number[] {
  const out: number[] = [];
  if (k > 0) out.push(k - 1);
  out.push(chainEnd(links, k));
  return out;
}

export function cloneShells(s: ShellsState): ShellsState {
  return { ...s, offsets: s.offsets.slice() };
}

/** Turns ring k by `steps` slots clockwise (negative: anticlockwise), with its chain. Null when
 *  it comes back where it was. */
export function turn(s: ShellsState, k: number, steps: number): ShellsState | null {
  const n = s.slots;
  if (mod(steps, n) === 0) return null;
  const next = cloneShells(s);
  const end = chainEnd(s.links, k);
  for (let j = k; j <= end; j++) next.offsets[j] = mod(next.offsets[j] + steps, n);
  next.moves++;
  return next;
}

/**
 * The turn each ring still needs, in slots (0 to slots - 1): the one set of turns that brings
 * every ring home. Turns commute and each ring's offset is its own turn plus those of the rings
 * whose chains reach it, so the turns follow ring by ring from the inside out.
 */
export function remaining(s: ShellsState): number[] {
  const n = s.slots, R = ringCount(s);
  const x: number[] = [];
  for (let j = 0; j < R; j++) {
    let carried = 0;
    for (let k = 0; k < j; k++) if (chainEnd(s.links, k) >= j) carried += x[k];
    x.push(mod(-s.offsets[j] - carried, n));
  }
  return x;
}

/** The fewest turns that solve the board: one for every ring that still needs turning. */
export function fewest(s: ShellsState): number {
  return remaining(s).filter((v) => v !== 0).length;
}

/**
 * The next good turn and why: a ring that still needs turning and is the last one left that can
 * shift some pair, so turning it home lines that pair up for good. Null on a solved board.
 */
export function nextTurn(s: ShellsState): { ring: number; steps: number; pair: number } | null {
  const x = remaining(s);
  const R = ringCount(s);
  const open = x.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
  if (!open.length) return null;
  // Outermost pairs first, so the hint walks the way the deduction does.
  for (let p = R - 1; p >= 0; p--) {
    const by = open.filter((k) => touched(s.links, k).includes(p));
    if (by.length === 1) return { ring: by[0], steps: signed(x[by[0]], s.slots), pair: p };
  }
  const k = open[0];
  return { ring: k, steps: signed(x[k], s.slots), pair: touched(s.links, k)[0] };
}

/** A turn of v slots clockwise as the shorter way round: -n/2 < result <= n/2. */
export function signed(v: number, n: number): number {
  const m = mod(v, n);
  return m > n / 2 ? m - n : m;
}

/** Whether a set of beads looks the same turned by some slots short of a full turn. */
function periodic(b: boolean[]): boolean {
  const n = b.length;
  for (let r = 1; r < n; r++) if (n % r === 0 && b.every((v, j) => v === b[(j + r) % n])) return true;
  return false;
}

/** The most beads a wrong turn lines up with their own stencil. */
function bestDecoy(b: boolean[]): number {
  const n = b.length;
  let best = 0;
  for (let r = 1; r < n; r++) {
    let m = 0;
    for (let j = 0; j < n; j++) if (b[j] && b[(j + r) % n]) m++;
    best = Math.max(best, m);
  }
  return best;
}

function randomBeads(rng: Rng, n: number, count: number, decoy: number): boolean[] {
  let fallback: boolean[] | null = null;
  for (let tries = 0; tries < 200; tries++) {
    const b = Array<boolean>(n).fill(false);
    let placed = 0;
    while (placed < count) {
      const j = randInt(rng, n);
      if (!b[j]) { b[j] = true; placed++; }
    }
    if (periodic(b)) continue;
    fallback ??= b;
    if (bestDecoy(b) <= Math.min(count - 1, decoy)) return b;
  }
  return fallback ?? Array.from({ length: n }, (_, j) => j < count && j !== 1);
}

/**
 * Deals a board for dial d: rings of random beads with no turn symmetry, random links, then a
 * turn of each ring by a random amount, played backwards from the solved board. Par is the fewest
 * turns that bring every ring home: the number of rings that need turning. From Medium on, a deal
 * is kept only when lining up the pairs one by one, from the outside in or the inside out, takes
 * more turns than par (see `naive`), so the links have to be read.
 */
export function newShells(d: number, seed: number): ShellsState {
  const rng = seeded(seed);
  const shape = shellsShape(d);
  const R = shape.rings, n = shape.slots;
  const beads = shape.beads.map((c) => randomBeads(rng, n, c, shape.decoy));
  let best: { s: ShellsState; score: number } | null = null;
  for (let tries = 0; tries < 80; tries++) {
    const want = shape.links[0] + randInt(rng, shape.links[1] - shape.links[0] + 1);
    const links = Array<boolean>(R - 1).fill(false);
    const order = shuffled(rng, R - 1);
    for (const k of order.slice(0, Math.min(want, R - 1))) links[k] = true;
    // Every ring the par asks for turns by a random amount, the rest by chance, played backwards
    // from home: each ring's offset is minus the turns that reach it.
    const x = Array<number>(R).fill(0);
    shuffled(rng, R).forEach((k, i) => { if (i < shape.par || rand(rng) < 0.5) x[k] = 1 + randInt(rng, n - 1); });
    const offsets = Array<number>(R).fill(0);
    for (let k = 0; k < R; k++) {
      const end = chainEnd(links, k);
      for (let j = k; j <= end; j++) offsets[j] = mod(offsets[j] - x[k], n);
    }
    const s: ShellsState = { slots: n, beads, links, offsets, moves: 0, par: 0 };
    s.par = fewest(s);
    const lined = alignment(s).filter(Boolean).length;
    const trap = Math.min(naive(s), naive(s, true)) - s.par;
    const score = Math.min(trap, shape.trap) * 10 - lined + (s.par >= shape.par ? 100 : 0);
    if (!best || score > best.score) best = { s, score };
    if (s.par >= shape.par && trap >= shape.trap && lined <= (R >= 5 ? 1 : 0)) break;
  }
  return best!.s;
}

function shuffled(rng: Rng, n: number): number[] {
  const order = Array.from({ length: n }, (_, k) => k);
  for (let i = order.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

/**
 * How many turns a player who never looks ahead takes: each time, the outermost (or, `inward`,
 * the innermost) pair still out of line is lined up by whichever ring touching it breaks the
 * fewest pairs already lined up. Gives up (returns 99) after a few rounds of going in circles.
 * Used to keep the harder deals from falling to that habit.
 */
export function naive(s0: ShellsState, inward = false): number {
  let s = cloneShells(s0);
  const R = ringCount(s);
  for (let moves = 0; moves < R * 3; moves++) {
    const al = alignment(s);
    if (al.every(Boolean)) return moves;
    const pairs = Array.from({ length: R }, (_, p) => p).filter((p) => !al[p]);
    const p = inward ? pairs[0] : pairs[pairs.length - 1];
    let best: ShellsState | null = null, bestBroken = Infinity;
    for (let k = 0; k < R; k++) {
      if (!touched(s.links, k).includes(p)) continue;
      for (let v = 1; v < s.slots; v++) {
        const t = turn(s, k, v)!;
        if (!aligned(t, p)) continue;
        const broken = al.filter((a, q) => a && !aligned(t, q)).length;
        if (broken < bestBroken) { bestBroken = broken; best = t; }
      }
    }
    if (!best) return 99;
    s = best;
  }
  return 99;
}
