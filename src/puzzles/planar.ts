// Planar: untangle a molecule's drawing.
//
// Atoms joined by bonds, dealt round a ring so the bonds cross. Drag atoms anywhere on the board
// until no two bonds cross, no bond runs through an atom and no two atoms sit on each other.
// Every deal is drawn from a layout with no crossings, so it can always be untangled.
//
// Game rule, not chemistry: the atoms are unnamed and the bonds have no set lengths or angles.

import { rand, randInt, seeded, type Rng } from './rng';

export interface Pt { x: number; y: number }

export interface PlanarState {
  /** Where each atom sits, in board units: 0 to 1 across and down. */
  pos: Pt[];
  /** The bonds, as pairs of atoms. */
  edges: [number, number][];
  /** A layout with nothing crossing that moves only `par` atoms from where they were dealt. */
  solution: Pt[];
  /** Drags made. */
  moves: number;
  /** How many atoms the solution moves: one drag each. */
  par: number;
}

/** An atom's radius, in board units. */
export const ATOM_R = 0.03;
/** The keep-in margin: atoms' centers stay this far inside the board. */
export const MARGIN = 0.045;
/** A bond passing nearer than this to another atom's center runs through it. */
const THROUGH = ATOM_R;
/** Two atoms nearer than this sit on each other. */
const OVERLAP = ATOM_R * 1.8;

/** The board for a dial setting, 1 to 100: how many atoms, how many bonds per atom, and how
 *  many ring orders to try for the least knotted deal. */
export function planarShape(d: number): { atoms: number; perAtom: number; tries: number } {
  const t = Math.min(1, Math.max(0, (d - 1) / 99));
  return { atoms: Math.round(6 + 16 * t), perAtom: 1.2 + 0.75 * t, tries: 1 + Math.round((1 - t) * 6) };
}

// ---- geometry -------------------------------------------------------------------------

const orient = (a: Pt, b: Pt, c: Pt): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Whether segments ab and cd cross at a point inside both (touching ends do not count). */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = orient(c, d, a), d2 = orient(c, d, b), d3 = orient(a, b, c), d4 = orient(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Where segments ab and cd cross (assumes they do). */
export function crossPoint(a: Pt, b: Pt, c: Pt, d: Pt): Pt {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  const t = den === 0 ? 0.5 : ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Distance from p to segment ab. */
export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export const clampPt = (p: Pt): Pt => ({ x: Math.min(1 - MARGIN, Math.max(MARGIN, p.x)), y: Math.min(1 - MARGIN, Math.max(MARGIN, p.y)) });

// ---- what is wrong with a drawing ------------------------------------------------------

export interface Problems {
  /** Pairs of bonds (indices into edges) that cross. */
  crossings: [number, number][];
  /** A bond and an atom it runs through. */
  through: [number, number][];
  /** Two atoms on top of each other. */
  overlaps: [number, number][];
}

/** Everything wrong with these positions for these bonds. */
export function problemsOf(pos: Pt[], edges: [number, number][], clear = THROUGH, apart = OVERLAP): Problems {
  const crossings: [number, number][] = [];
  const through: [number, number][] = [];
  const overlaps: [number, number][] = [];
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const [c, d] = edges[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsCross(pos[a], pos[b], pos[c], pos[d])) crossings.push([i, j]);
    }
    for (let k = 0; k < pos.length; k++) {
      if (k === a || k === b) continue;
      if (segmentDistance(pos[k], pos[a], pos[b]) < clear) through.push([i, k]);
    }
  }
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
    if (Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) < apart) overlaps.push([i, j]);
  }
  return { crossings, through, overlaps };
}

export const problemCount = (p: Problems): number => p.crossings.length + p.through.length + p.overlaps.length;

export const clean = (pos: Pt[], edges: [number, number][]): boolean => problemCount(problemsOf(pos, edges)) === 0;

export function solved(s: PlanarState): boolean {
  return clean(s.pos, s.edges);
}

/** Whether atom v at its place in `pos` is clear of every other bond and atom (the rest of the
 *  drawing is assumed clear already). Used to build layouts one atom at a time. */
function atomFits(pos: Pt[], edges: [number, number][], inc: number[][], v: number, clear: number, apart: number): boolean {
  const p = pos[v];
  for (let k = 0; k < pos.length; k++) if (k !== v && Math.hypot(pos[k].x - p.x, pos[k].y - p.y) < apart) return false;
  // No other bond runs through it.
  for (const [a, b] of edges) if (a !== v && b !== v && segmentDistance(p, pos[a], pos[b]) < clear) return false;
  for (const e of inc[v]) {
    const [a, b] = edges[e];
    const o = a === v ? b : a;
    // Its bonds run through no atom and cross no bond.
    for (let k = 0; k < pos.length; k++) if (k !== v && k !== o && segmentDistance(pos[k], p, pos[o]) < clear) return false;
    for (const [c, d] of edges) {
      if (c === v || d === v || c === o || d === o) continue;
      if (segmentsCross(p, pos[o], pos[c], pos[d])) return false;
    }
  }
  return true;
}

function incidence(n: number, edges: [number, number][]): number[][] {
  const inc: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([a, b], e) => { inc[a].push(e); inc[b].push(e); });
  return inc;
}

/**
 * A clean layout as close to `keep` as this greedy pass finds: starting from the clean layout
 * `base`, each atom in turn (in index order) goes to its place in `keep` when that leaves the
 * drawing clean. Deterministic, so a hint that moves one of the atoms it did not keep to its
 * place in the result finds the same layout, less that atom, next time.
 */
export function nearestLayout(base: Pt[], keep: Pt[], edges: [number, number][], order?: number[]): Pt[] {
  const n = base.length;
  const inc = incidence(n, edges);
  const out = base.map((p) => ({ ...p }));
  for (const v of order ?? Array.from({ length: n }, (_, i) => i)) {
    if (out[v].x === keep[v].x && out[v].y === keep[v].y) continue;
    const was = out[v];
    out[v] = { ...keep[v] };
    if (!atomFits(out, edges, inc, v, THROUGH, OVERLAP)) out[v] = was;
  }
  return out;
}

const samePt = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

/** Atoms whose place differs between two layouts. */
export function moved(a: Pt[], b: Pt[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (!samePt(a[i], b[i])) out.push(i);
  return out;
}

// ---- dealing --------------------------------------------------------------------------

/** Atoms spread over the board's middle, no two too close. */
function scatter(n: number, rng: Rng): Pt[] {
  let gap = 0.62 / Math.sqrt(n);
  for (;;) {
    const pts: Pt[] = [];
    for (let tries = 0; pts.length < n && tries < 4000; tries++) {
      const p = { x: 0.12 + 0.76 * rand(rng), y: 0.12 + 0.76 * rand(rng) };
      if (pts.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) pts.push(p);
    }
    if (pts.length === n) return pts;
    gap *= 0.92;
  }
}

/** Bonds for the atoms: a greedy triangulation (shortest first, none crossing and none passing
 *  close to an atom), thinned at random, longest first, to `want` bonds while it stays connected
 *  and every atom keeps two bonds. */
function bondsFor(pts: Pt[], want: number, rng: Rng): [number, number][] {
  const n = pts.length;
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)]);
  pairs.sort((p, q) => p[2] - q[2]);
  const edges: [number, number][] = [];
  for (const [a, b] of pairs) {
    if (edges.some(([c, d]) => a !== c && a !== d && b !== c && b !== d && segmentsCross(pts[a], pts[b], pts[c], pts[d]))) continue;
    let near = false;
    for (let k = 0; k < n && !near; k++) if (k !== a && k !== b && segmentDistance(pts[k], pts[a], pts[b]) < 0.06) near = true;
    if (!near) edges.push([a, b]);
  }
  const deg = Array(n).fill(0);
  for (const [a, b] of edges) { deg[a]++; deg[b]++; }
  // Removal order: random, leaning to the long bonds.
  const order = edges.map((e, i) => ({ i, k: rand(rng) * (0.4 + Math.hypot(pts[e[0]].x - pts[e[1]].x, pts[e[0]].y - pts[e[1]].y)) }));
  order.sort((p, q) => q.k - p.k);
  const alive = edges.map(() => true);
  let count = edges.length;
  for (const { i } of order) {
    if (count <= want) break;
    const [a, b] = edges[i];
    if (deg[a] <= 2 || deg[b] <= 2) continue;
    alive[i] = false;
    if (!connected(n, edges.filter((_, k) => alive[k]))) { alive[i] = true; continue; }
    deg[a]--; deg[b]--; count--;
  }
  return edges.filter((_, k) => alive[k]);
}

function connected(n: number, edges: [number, number][]): boolean {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) for (const v of adj[stack.pop()!]) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  return seen.size === n;
}

/** The ring the atoms are dealt round. */
function ring(n: number, start: number): Pt[] {
  return Array.from({ length: n }, (_, k) => {
    const a = start + (k * Math.PI * 2) / n;
    return { x: 0.5 + 0.41 * Math.cos(a), y: 0.5 + 0.41 * Math.sin(a) };
  });
}

/** The layout turned by `angle` (and mirrored) about the middle, scaled to fit the board. */
function turned(pts: Pt[], angle: number, mirror: boolean): Pt[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = pts.map((p) => {
    const x = (mirror ? 0.5 - p.x : p.x - 0.5), y = p.y - 0.5;
    return { x: x * c - y * s, y: x * s + y * c };
  });
  const reach = Math.max(...out.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const k = Math.min(1, 0.4 / reach);
  return out.map((p) => ({ x: 0.5 + p.x * k, y: 0.5 + p.y * k }));
}

/**
 * Deals a board: atoms scattered and bonded without crossings (the hidden layout), then dealt
 * round a ring in a random order so bonds cross. Par comes from the hidden layout turned and
 * mirrored to keep as many atoms as it can where they were dealt: the atoms left over are the
 * ones it moves.
 */
export function newPlanar(d: number, seed: number): PlanarState {
  const rng = seeded(seed);
  const shape = planarShape(d);
  const n = shape.atoms;
  for (;;) {
    const pts = scatter(n, rng);
    const edges = bondsFor(pts, Math.round(n * shape.perAtom), rng);
    if (!clean(pts, edges)) continue;
    // The deal: of a few ring orders tried (more on easy boards), the one with the fewest
    // crossings above a floor, so easy boards come less knotted.
    const slots = ring(n, rand(rng) * Math.PI * 2);
    const floor = Math.max(2, Math.round(edges.length * 0.4));
    let pos: Pt[] | null = null;
    let fewest = Infinity;
    for (let k = 0; k < 40 && (k < shape.tries || !pos); k++) {
      const p = shuffled(n, rng).map((slot) => slots[slot]);
      const c = problemsOf(p, edges).crossings.length;
      if (c >= floor && c < fewest) { fewest = c; pos = p; }
    }
    if (!pos) continue;
    // Bonds between atoms two apart on the ring can graze the atom between: swap atoms round
    // the ring until no bond runs through an atom.
    for (let k = 0; k < 300; k++) {
      const through = problemsOf(pos, edges).through;
      if (!through.length) break;
      const a = through[randInt(rng, through.length)][1], b = randInt(rng, n);
      const next = pos.slice();
      [next[a], next[b]] = [next[b], next[a]];
      const p = problemsOf(next, edges);
      if (p.through.length <= through.length && p.crossings.length >= floor) pos = next;
    }
    if (problemsOf(pos, edges).through.length) continue;
    // The hidden layout that keeps the most dealt atoms in place.
    let best: Pt[] | null = null;
    let bestMoved = Infinity;
    for (let r = 0; r < 12; r++) for (const mirror of [false, true]) {
      const base = turned(pts, (r * Math.PI) / 6, mirror);
      if (!clean(base, edges)) continue;
      const order = r % 3 === 0 ? undefined : shuffled(n, rng);
      const lay = nearestLayout(base, pos, edges, order);
      const m = moved(lay, pos).length;
      if (m < bestMoved) { bestMoved = m; best = lay; }
    }
    if (!best) continue;
    // The hint chain starts from this layout and keeps what it can in index order.
    const solution = nearestLayout(best, pos, edges);
    return { pos, edges, solution, moves: 0, par: moved(solution, pos).length };
  }
}

function shuffled(n: number, rng: Rng): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = randInt(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- play -----------------------------------------------------------------------------

export function clonePlanar(s: PlanarState): PlanarState {
  return { ...s, pos: s.pos.map((p) => ({ ...p })) };
}

/** Moves atom i to p (kept inside the board), as one drag. Null when it does not move. */
export function moveAtom(s: PlanarState, i: number, p: Pt): PlanarState | null {
  const q = clampPt(p);
  if (samePt(q, s.pos[i])) return null;
  const next = clonePlanar(s);
  next.pos[i] = q;
  next.moves++;
  return next;
}

/** How many problems each atom is part of: crossings of its bonds, bonds through it or through
 *  others from it, and atoms on it. */
export function atomTrouble(s: PlanarState, p: Problems = problemsOf(s.pos, s.edges)): number[] {
  const t = Array(s.pos.length).fill(0);
  for (const [e, f] of p.crossings) for (const v of [...s.edges[e], ...s.edges[f]]) t[v]++;
  for (const [e, k] of p.through) { t[k]++; t[s.edges[e][0]]++; t[s.edges[e][1]]++; }
  for (const [a, b] of p.overlaps) { t[a]++; t[b]++; }
  return t;
}

/** The atom to look at: the one in the most trouble (-1 on a clean board). */
export function worstAtom(s: PlanarState): number {
  const t = atomTrouble(s);
  let best = -1;
  for (let i = 0; i < t.length; i++) if (t[i] > 0 && (best < 0 || t[i] > t[best])) best = i;
  return best;
}

/**
 * The next Show me move: the clean layout nearest the board (the hidden one, with every atom
 * that can stay where the player put it kept), and of the atoms it moves, the one in the most
 * trouble, with where it goes. Each such move leaves one atom fewer to move. Null when clean.
 */
export function nextMove(s: PlanarState): { atom: number; to: Pt; left: number } | null {
  if (solved(s)) return null;
  const target = nearestLayout(s.solution, s.pos, s.edges);
  const need = moved(target, s.pos);
  if (!need.length) return null;
  const t = atomTrouble(s);
  let atom = need[0];
  for (const v of need) if (t[v] > t[atom]) atom = v;
  return { atom, to: target[atom], left: need.length };
}
