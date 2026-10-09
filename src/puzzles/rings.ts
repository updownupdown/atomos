// Shell Rings: settle the electrons into their shells.
//
// Each shell is a ring of 2n² slots, the real capacity of shell n. Lit sockets
// mark where the element's electrons belong, coloured by sub-shell. Turning a
// ring carries its electrons and sockets round with it. All rings share one
// gate at the top: an electron sitting at the gate can hop to the ring inside
// or outside it, if that ring's gate slot is free. Every socket filled and every
// stray slot empty is the ground state.
//
// Game rule, not physics: electrons are clouds, not beads, and there is no gate.
// But the slot counts, the sub-shell colours and the filling order are real.

import { elementAt } from '../gallery/data';
import { pick, rand, randInt, seeded, type Rng } from './rng';

export type Kind = 's' | 'p' | 'd' | 'f';

export interface Ring {
  n: number;
  slots: number;
  rot: number;
  /** Which slots hold an electron. Slots are fixed to the ring, so this never changes on rotation. */
  cells: boolean[];
  /** Which slots are sockets, and of what sub-shell. */
  sockets: (Kind | null)[];
}

export interface RingsState {
  rings: Ring[];
  moves: number;
  par: number;
}

export type RingMove =
  | { kind: 'rotate'; ring: number; steps: number }
  | { kind: 'hop'; ring: number; outward: boolean };

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The slot of a ring currently sitting at the gate. */
export function topSlot(r: Ring): number {
  return mod(-r.rot, r.slots);
}

/** The signed rotation that brings a slot to the gate, the short way round. */
export function stepsToTop(r: Ring, slot: number): number {
  const target = mod(-slot, r.slots);
  let d = mod(target - r.rot, r.slots);
  if (d > r.slots / 2) d -= r.slots;
  return d;
}

/** Electrons per shell in the ground state, filled in Madelung order. */
export function shellCounts(z: number): number[] {
  // The real ground-state configuration, exceptions included (chromium, copper, the lanthanides).
  const counts: number[] = [];
  for (const sub of elementAt(z).subshells) counts[sub.n - 1] = (counts[sub.n - 1] ?? 0) + sub.count;
  for (let i = 0; i < counts.length; i++) counts[i] ??= 0;
  return counts;
}

function kindAt(i: number): Kind {
  return i < 2 ? 's' : i < 8 ? 'p' : i < 18 ? 'd' : 'f';
}

/** The solved layout for an element: one ring per shell, plus an empty ring outside. */
export function solvedRings(z: number): Ring[] {
  const counts = shellCounts(z);
  const n = Math.max(2, counts.length + 1);
  const rings: Ring[] = [];
  for (let i = 1; i <= n; i++) {
    const slots = 2 * i * i;
    const k = counts[i - 1] ?? 0;
    const sockets: (Kind | null)[] = Array(slots).fill(null);
    // Sockets sit evenly round the ring, the s pair first, then p, d, f in order.
    const idx = Array.from({ length: k }, (_, j) => Math.round((j * slots) / k) % slots).sort((a, b) => a - b);
    idx.forEach((slot, j) => (sockets[slot] = kindAt(j)));
    rings.push({ n: i, slots, rot: 0, cells: sockets.map((s) => s !== null), sockets });
  }
  return rings;
}

export function cloneRings(s: RingsState): RingsState {
  return { ...s, rings: s.rings.map((r) => ({ ...r, cells: [...r.cells], sockets: [...r.sockets] })) };
}

export function solved(s: RingsState): boolean {
  return s.rings.every((r) => r.cells.every((on, i) => on === (r.sockets[i] !== null)));
}

export function canHop(s: RingsState, ring: number, outward: boolean): boolean {
  const from = s.rings[ring];
  const to = s.rings[ring + (outward ? 1 : -1)];
  if (!from || !to) return false;
  return from.cells[topSlot(from)] && !to.cells[topSlot(to)];
}

/** Applies a move and returns the new state, or null when the move is not allowed. */
export function applyMove(s: RingsState, m: RingMove): RingsState | null {
  const next = cloneRings(s);
  if (m.kind === 'rotate') {
    const r = next.rings[m.ring];
    if (!r || m.steps === 0) return null;
    r.rot = mod(r.rot + m.steps, r.slots);
    next.moves += Math.abs(m.steps);
    return next;
  }
  if (!canHop(s, m.ring, m.outward)) return null;
  const from = next.rings[m.ring];
  const to = next.rings[m.ring + (m.outward ? 1 : -1)];
  from.cells[topSlot(from)] = false;
  to.cells[topSlot(to)] = true;
  next.moves += 1;
  return next;
}

export function inverse(m: RingMove): RingMove {
  return m.kind === 'rotate' ? { ...m, steps: -m.steps } : { kind: 'hop', ring: m.ring + (m.outward ? 1 : -1), outward: !m.outward };
}

export function moveCost(m: RingMove): number {
  return m.kind === 'rotate' ? Math.abs(m.steps) : 1;
}

interface Spot { ring: number; slot: number }

function misplaced(s: RingsState): Spot[] {
  const out: Spot[] = [];
  s.rings.forEach((r, ring) => r.cells.forEach((on, slot) => { if (on && r.sockets[slot] === null) out.push({ ring, slot }); }));
  return out;
}

function emptySockets(s: RingsState): Spot[] {
  const out: Spot[] = [];
  s.rings.forEach((r, ring) => r.cells.forEach((on, slot) => { if (!on && r.sockets[slot] !== null) out.push({ ring, slot }); }));
  return out;
}

function emptySlots(r: Ring): number[] {
  return r.cells.map((on, i) => (on ? -1 : i)).filter((i) => i >= 0);
}

/**
 * A plain plan a careful player would follow: walk each stray electron one ring
 * at a time toward an empty socket, aligning the gate before each hop. Its cost
 * is the level's par. Returns null if it cannot finish, which the generator
 * treats as a level to throw away.
 */
export function solveGreedy(start: RingsState): RingMove[] | null {
  let s = start;
  const out: RingMove[] = [];
  const push = (m: RingMove) => {
    const n = applyMove(s, m);
    if (!n) throw new Error('planner made an illegal move');
    s = n;
    out.push(m);
  };
  for (let iter = 0; iter < 200; iter++) {
    if (solved(s)) return out;
    const strays = misplaced(s);
    const targets = emptySockets(s);
    if (!strays.length || !targets.length) return null;
    let plan: { e: Spot; q: number; dest: number; cost: number } | null = null;
    for (const e of strays) {
      for (const t of targets) {
        const er = s.rings[e.ring];
        const dir = t.ring === e.ring ? 0 : Math.sign(t.ring - e.ring);
        const candidates = dir === 0 ? [e.ring + 1, e.ring - 1] : [e.ring + dir];
        for (const q of candidates) {
          const qr = s.rings[q];
          if (!qr) continue;
          const empties = emptySlots(qr);
          if (!empties.length) continue;
          // Landing on the target ring: aim for an empty socket. Passing through: avoid sockets.
          const preferred = q === t.ring ? empties.filter((i) => qr.sockets[i] !== null) : empties.filter((i) => qr.sockets[i] === null);
          const pool = preferred.length ? preferred : empties;
          const dest = pool.reduce((best, i) => (Math.abs(stepsToTop(qr, i)) < Math.abs(stepsToTop(qr, best)) ? i : best), pool[0]);
          const cost = Math.abs(stepsToTop(er, e.slot)) + Math.abs(stepsToTop(qr, dest)) + 1 + Math.abs(t.ring - q) * 4;
          if (!plan || cost < plan.cost) plan = { e, q, dest, cost };
        }
      }
    }
    if (!plan) return null;
    const er = s.rings[plan.e.ring], qr = s.rings[plan.q];
    const s1 = stepsToTop(er, plan.e.slot);
    if (s1) push({ kind: 'rotate', ring: plan.e.ring, steps: s1 });
    const s2 = stepsToTop(qr, plan.dest);
    if (s2) push({ kind: 'rotate', ring: plan.q, steps: s2 });
    push({ kind: 'hop', ring: plan.e.ring, outward: plan.q > plan.e.ring });
  }
  return null;
}

function legalHops(s: RingsState): RingMove[] {
  const out: RingMove[] = [];
  s.rings.forEach((_, i) => {
    if (canHop(s, i, true)) out.push({ kind: 'hop', ring: i, outward: true });
    if (canHop(s, i, false)) out.push({ kind: 'hop', ring: i, outward: false });
  });
  return out;
}

function scramble(solvedState: RingsState, rng: Rng, count: number): RingsState {
  let s = solvedState;
  let prev: RingMove | null = null;
  let done = 0;
  for (let guard = 0; done < count && guard < count * 10; guard++) {
    const hops = legalHops(s);
    let m: RingMove;
    if (hops.length && rand(rng) < 0.5) m = pick(rng, hops);
    else {
      const ring = randInt(rng, s.rings.length);
      let steps = randInt(rng, 3) + 1;
      if (rand(rng) < 0.5) steps = -steps;
      m = { kind: 'rotate', ring, steps };
    }
    if (prev && JSON.stringify(inverse(prev)) === JSON.stringify(m)) continue;
    const n = applyMove(s, m);
    if (!n) continue;
    s = n;
    prev = m;
    done++;
  }
  return { ...s, moves: 0 };
}

/** A fresh level for an element: the solved atom scrambled, with par from the planner. */
export function newRings(z: number, seed: number): RingsState {
  const rng = seeded(seed);
  const count = 4 + 2 * Math.min(z, 12);
  for (let attempt = 0; attempt < 20; attempt++) {
    const s = scramble({ rings: solvedRings(z), moves: 0, par: 0 }, rng, count + attempt);
    if (solved(s)) continue;
    const plan = solveGreedy(s);
    if (!plan) continue;
    return { ...s, par: plan.reduce((c, m) => c + moveCost(m), 0) };
  }
  // Every scramble failed to plan, which the tests guard against; fall back to a lightly stirred board.
  const s = scramble({ rings: solvedRings(z), moves: 0, par: 0 }, rng, 3);
  return { ...s, par: 6 };
}
