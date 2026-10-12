// Push: a box-pushing puzzle in a small walled chamber.
//
// A probe walks the floor of a chamber and pushes nucleons, protons and neutrons, onto sockets
// of their own kind. It pushes by stepping into a nucleon, one cell at a time and only one
// nucleon at a time (never two in a row), and it can never pull. Walking is free: the score is
// the number of pushes, and par is the fewest the chamber allows, proven by a solver.
//
// Deals are made backwards: nucleons start on their sockets and the probe pulls them away on a
// random walk (every pull is a push played in reverse, so the deal is always solvable). A
// push-optimal search (A* over nucleon positions and the probe's walkable region, with an
// admissible push-distance heuristic) then proves par, and the deal is kept only when it is
// long enough and asks for the pushes a player who shoves each nucleon straight at its socket
// would not find.
//
// Game rule, not physics: nucleons are never pushed about one at a time in a box, and a real
// nucleus has no sockets.

import { rand, randInt, seeded, type Rng } from './rng';

export type Dir = 0 | 1 | 2 | 3; // up, right, down, left
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const DIR_NAME = ['up', 'right', 'down', 'left'] as const;

/** 0 a proton, 1 a neutron. */
export type Kind = 0 | 1;

export interface PushState {
  /** The grid's width and height, counting the wall ring round the chamber. */
  w: number;
  h: number;
  /** Open floor, by cell (y * w + x). Shared between states; never changed. */
  floor: boolean[];
  /** Sockets: their cells and the kind each takes. Shared; never changed. */
  goals: number[];
  goalKinds: Kind[];
  /** The nucleons' cells. Index i keeps its identity from push to push (for the animation). */
  boxes: number[];
  kinds: Kind[];
  /** The probe's cell. */
  player: number;
  /** Pushes so far. */
  moves: number;
  /** The fewest pushes that solve the deal, from the solver. */
  par: number;
}

/** One push: the nucleon at `cell` moves one cell in `dir`. */
export interface PushMove { cell: number; dir: Dir }

// ---- the chamber's fixed tables ------------------------------------------------------------

interface Room {
  w: number;
  n: number;
  D: number[];
  floor: Uint8Array;
  goals: number[];
  goalKinds: Kind[];
  /** Cell -> socket index, or -1. */
  goalAt: Int8Array;
  /** Cell -> its rank among the floor cells (at most 49 of them, so 6 bits), for small keys. */
  rank: Uint8Array;
  /** Per kind: 1 where a nucleon of that kind could still be pushed onto one of its sockets. */
  live: [Uint8Array, Uint8Array];
  /** Per socket: pushes to bring a lone nucleon from each cell onto it (ignoring the probe's
   *  reach and other nucleons); a big number where it cannot. */
  dist: Int16Array[];
}

const FAR = 9999;
const rooms = new WeakMap<boolean[], Map<string, Room>>();

function roomOf(s: Pick<PushState, 'w' | 'h' | 'floor' | 'goals' | 'goalKinds'>): Room {
  let byGoals = rooms.get(s.floor);
  if (!byGoals) { byGoals = new Map(); rooms.set(s.floor, byGoals); }
  const key = s.goals.join(',') + '|' + s.goalKinds.join('');
  let r = byGoals.get(key);
  if (r) return r;
  const w = s.w, n = s.w * s.h;
  const D = [-w, 1, w, -1];
  const floor = new Uint8Array(n);
  for (let i = 0; i < n; i++) floor[i] = s.floor[i] ? 1 : 0;
  const goalAt = new Int8Array(n).fill(-1);
  s.goals.forEach((g, i) => { goalAt[g] = i; });
  // A nucleon can be pushed from x to x + d when the probe can stand at x - d.
  // Distances run backwards from each socket: y came from x = y - d when x and x - d are floor.
  const dist = s.goals.map((g) => {
    const dd = new Int16Array(n).fill(FAR);
    const q = [g];
    dd[g] = 0;
    for (let h = 0; h < q.length; h++) {
      const y = q[h];
      for (let d = 0; d < 4; d++) {
        const x = y - D[d], p = x - D[d];
        if (x < 0 || p < 0 || x >= n || p >= n) continue;
        if (!floor[x] || !floor[p] || dd[x] !== FAR) continue;
        dd[x] = dd[y] + 1;
        q.push(x);
      }
    }
    return dd;
  });
  const live: [Uint8Array, Uint8Array] = [new Uint8Array(n), new Uint8Array(n)];
  s.goals.forEach((_, i) => {
    const k = s.goalKinds[i];
    for (let c = 0; c < n; c++) if (dist[i][c] < FAR) live[k][c] = 1;
  });
  const rank = new Uint8Array(n);
  for (let c = 0, k = 0; c < n; c++) if (floor[c]) rank[c] = k++;
  r = { w, n, D, floor, goals: s.goals.slice(), goalKinds: s.goalKinds.slice(), goalAt, rank, live, dist };
  byGoals.set(key, r);
  return r;
}

/** Cells where a nucleon of this kind can never reach a socket of its kind again: dead squares
 *  (a corner, or along a wall with no socket on it), shown faintly by the rules and the hints. */
export function deadCells(s: PushState, kind: Kind): number[] {
  const r = roomOf(s);
  const out: number[] = [];
  for (let c = 0; c < r.n; c++) if (r.floor[c] && !r.live[kind][c]) out.push(c);
  return out;
}

/** Nucleons sitting where they can never reach a socket of their kind (by box index). */
export function stuckBoxes(s: PushState): number[] {
  const r = roomOf(s);
  const out: number[] = [];
  s.boxes.forEach((b, i) => { if (!r.live[s.kinds[i]][b]) out.push(i); });
  // A square of four filled by nucleons and walls can never move; flag its loose nucleons.
  const occ = new Set(s.boxes);
  const solid = (c: number) => !r.floor[c] || occ.has(c);
  s.boxes.forEach((b, i) => {
    if (out.includes(i) || onOwnGoal(r, b, s.kinds[i])) return;
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const tl = b + ox + oy * r.w;
      if (solid(tl) && solid(tl + 1) && solid(tl + r.w) && solid(tl + r.w + 1)) { out.push(i); return; }
    }
  });
  return out;
}

function onOwnGoal(r: Room, c: number, k: Kind): boolean {
  const g = r.goalAt[c];
  return g >= 0 && r.goalKinds[g] === k;
}

// ---- moves -------------------------------------------------------------------------------

export const cellX = (s: PushState, c: number): number => c % s.w;
export const cellY = (s: PushState, c: number): number => Math.floor(c / s.w);

export function boxAt(s: PushState, cell: number): number {
  return s.boxes.indexOf(cell);
}

export function isOpen(s: PushState, cell: number): boolean {
  return cell >= 0 && cell < s.floor.length && s.floor[cell] && !s.boxes.includes(cell);
}

/** The cell one step from `cell` in `dir`, or -1 off the grid. */
export function stepCell(s: PushState, cell: number, dir: Dir): number {
  const x = cellX(s, cell) + DX[dir], y = cellY(s, cell) + DY[dir];
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return -1;
  return y * s.w + x;
}

export function onSocket(s: PushState, i: number): boolean {
  const g = s.goals.indexOf(s.boxes[i]);
  return g >= 0 && s.goalKinds[g] === s.kinds[i];
}

export function placed(s: PushState): number {
  let k = 0;
  for (let i = 0; i < s.boxes.length; i++) if (onSocket(s, i)) k++;
  return k;
}

export function solved(s: PushState): boolean {
  return placed(s) === s.boxes.length;
}

/** What a step in `dir` does: walk, push (the nucleon's index), or nothing. */
export function stepKind(s: PushState, dir: Dir): { kind: 'walk' } | { kind: 'push'; box: number } | null {
  const a = stepCell(s, s.player, dir);
  if (a < 0 || !s.floor[a]) return null;
  const i = boxAt(s, a);
  if (i < 0) return { kind: 'walk' };
  const b = stepCell(s, a, dir);
  return b >= 0 && isOpen(s, b) ? { kind: 'push', box: i } : null;
}

/** One step of the probe: a walk (moves unchanged) or a push (one more move). Null when blocked. */
export function step(s: PushState, dir: Dir): PushState | null {
  const k = stepKind(s, dir);
  if (!k) return null;
  const a = stepCell(s, s.player, dir);
  if (k.kind === 'walk') return { ...s, player: a };
  const boxes = s.boxes.slice();
  boxes[k.box] = stepCell(s, a, dir);
  return { ...s, boxes, player: a, moves: s.moves + 1 };
}

/** The probe's walkable cells: for each, the cell it is reached from (-1 for the start), or
 *  -2 where it cannot walk. */
export function walkMap(s: PushState): Int16Array {
  const n = s.w * s.h;
  const prev = new Int16Array(n).fill(-2);
  const occ = new Uint8Array(n);
  for (const b of s.boxes) occ[b] = 1;
  const q = [s.player];
  prev[s.player] = -1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (let d = 0 as Dir; d < 4; d++) {
      const x = stepCell(s, c, d);
      if (x < 0 || prev[x] !== -2 || !s.floor[x] || occ[x]) continue;
      prev[x] = c;
      q.push(x);
    }
  }
  return prev;
}

/** The shortest walk to `to` (cells after the start, in order), or null when it cannot be
 *  reached without pushing. An empty list when the probe is already there. */
export function walkTo(s: PushState, to: number, map = walkMap(s)): number[] | null {
  if (to < 0 || to >= map.length || map[to] === -2) return null;
  const path: number[] = [];
  for (let c = to; c !== s.player; c = map[c]) path.push(c);
  return path.reverse();
}

/** The direction from one cell to the next one beside it. */
export function dirBetween(s: PushState, a: number, b: number): Dir {
  const dx = cellX(s, b) - cellX(s, a), dy = cellY(s, b) - cellY(s, a);
  return (dy < 0 ? 0 : dx > 0 ? 1 : dy > 0 ? 2 : 3) as Dir;
}

/** Plays one push of a plan: walks the probe behind the nucleon, then pushes. Returns the new
 *  state and the walk taken (null when the probe cannot get there or the push is blocked). */
export function playPush(s: PushState, m: PushMove): { state: PushState; walk: number[]; box: number } | null {
  const box = boxAt(s, m.cell);
  if (box < 0) return null;
  const behind = stepCell(s, m.cell, ((m.dir + 2) % 4) as Dir);
  const walk = walkTo(s, behind);
  if (!walk) return null;
  const next = step({ ...s, player: behind }, m.dir);
  if (!next || next.moves === s.moves) return null;
  return { state: next, walk, box };
}

export function clonePush(s: PushState): PushState {
  return { ...s, boxes: s.boxes.slice(), kinds: s.kinds.slice() };
}

// ---- the solver --------------------------------------------------------------------------

export type Solve =
  | { moves: PushMove[]; nodes: number }
  | { moves: null; proven: boolean; nodes: number };

/** Lower bound on pushes left: per kind, the cheapest matching of nucleons to sockets. */
function heuristic(r: Room, cells: ArrayLike<number>, np: number, k: number, gp: number[], gn: number[]): number {
  return match(r, cells, 0, np, gp) + match(r, cells, np, k, gn);
}

function match(r: Room, cells: ArrayLike<number>, from: number, to: number, goals: number[]): number {
  const m = to - from;
  if (m === 0) return 0;
  if (m === 1) return r.dist[goals[0]][cells[from]];
  if (m === 2) {
    const a = cells[from], b = cells[from + 1];
    const d0 = r.dist[goals[0]], d1 = r.dist[goals[1]];
    return Math.min(d0[a] + d1[b], d1[a] + d0[b]);
  }
  // Three or more of one kind: try every assignment (at most a handful).
  let best = FAR * 4;
  const used = new Uint8Array(m);
  const rec = (i: number, acc: number): void => {
    if (acc >= best) return;
    if (i === m) { best = acc; return; }
    for (let j = 0; j < m; j++) {
      if (used[j]) continue;
      used[j] = 1;
      rec(i + 1, acc + r.dist[goals[j]][cells[from + i]]);
      used[j] = 0;
    }
  };
  rec(0, 0);
  return best;
}

/**
 * The fewest pushes from here, by A* over (nucleon cells, the probe's region). The heuristic,
 * pushes for each nucleon alone matched to sockets of its kind, never overestimates and drops by
 * at most one a push, so the first solved state taken from the queue is optimal. Pushes onto
 * dead squares and into frozen 2 by 2 squares are never tried. Gives up after `budget` states
 * expanded (proven: false) or proves there is no solution (proven: true).
 */
export function solve(s: PushState, budget = 150000): Solve {
  const r = roomOf(s);
  const n = r.n, D = r.D, floor = r.floor;
  const k = s.boxes.length;
  // Canonical order: protons first, then neutrons, each sorted by cell.
  const prot: number[] = [], neut: number[] = [];
  s.boxes.forEach((b, i) => (s.kinds[i] === 0 ? prot : neut).push(b));
  prot.sort((a, b) => a - b); neut.sort((a, b) => a - b);
  const np = prot.length;
  const gp: number[] = [], gn: number[] = [];
  r.goalKinds.forEach((kk, i) => (kk === 0 ? gp : gn).push(i));
  if (gp.length !== np || gn.length !== k - np) return { moves: null, proven: true, nodes: 0 };
  const start = [...prot, ...neut];
  for (let j = 0; j < k; j++) if (!r.live[j < np ? 0 : 1][start[j]]) return { moves: null, proven: true, nodes: 0 };
  const h0 = heuristic(r, start, np, k, gp, gn);
  if (h0 >= FAR) return { moves: null, proven: true, nodes: 0 };

  // Node storage, grown by doubling.
  let cap = 4096;
  let nb = new Uint8Array(cap * k);
  let npl = new Uint8Array(cap);
  let par = new Int32Array(cap);
  let pc = new Uint8Array(cap);
  let pd = new Uint8Array(cap);
  let ng = new Int16Array(cap);
  let nkey = new Float64Array(cap);
  let shut = new Uint8Array(cap);
  let count = 0;
  const grow = () => {
    cap *= 2;
    const nb2 = new Uint8Array(cap * k); nb2.set(nb); nb = nb2;
    const a = new Uint8Array(cap); a.set(npl); npl = a;
    const b = new Int32Array(cap); b.set(par); par = b;
    const c = new Uint8Array(cap); c.set(pc); pc = c;
    const d = new Uint8Array(cap); d.set(pd); pd = d;
    const e = new Int16Array(cap); e.set(ng); ng = e;
    const f2 = new Float64Array(cap); f2.set(nkey); nkey = f2;
    const g2 = new Uint8Array(cap); g2.set(shut); shut = g2;
  };
  const seen = new Map<number, number>(); // key -> node id with the best g so far
  const buckets: number[][] = [];
  const push = (f: number, id: number) => { (buckets[f] ??= []).push(id); };

  // Scratch for floods.
  const vis = new Int32Array(n);
  const occ = new Int32Array(n);
  let stamp = 0, ostamp = 0;
  const queue = new Int16Array(n);
  const cells = new Uint8Array(k);

  /** Floods from `from` over open floor (occ stamped with ostamp); returns the smallest cell. */
  const flood = (from: number): number => {
    stamp++;
    let head = 0, tail = 0, min = from;
    queue[tail++] = from;
    vis[from] = stamp;
    while (head < tail) {
      const c = queue[head++];
      for (let d = 0; d < 4; d++) {
        const x = c + D[d];
        if (!floor[x] || vis[x] === stamp || occ[x] === ostamp) continue;
        vis[x] = stamp;
        if (x < min) min = x;
        queue[tail++] = x;
      }
    }
    return min;
  };
  // Keys pack the floor ranks six bits apiece: up to four nucleons and the probe in 30 bits,
  // a small integer the engine hashes fast.
  const rank = r.rank;
  const keyOf = (bs: ArrayLike<number>, norm: number): number => {
    let key = 0;
    for (let j = 0; j < k; j++) key = key * 64 + rank[bs[j]];
    return key * 64 + rank[norm];
  };

  // The start node.
  ostamp++;
  for (let j = 0; j < k; j++) occ[start[j]] = ostamp;
  const norm0 = flood(s.player);
  nb.set(start, 0);
  npl[0] = s.player; par[0] = -1; ng[0] = 0;
  count = 1;
  nkey[0] = keyOf(start, norm0);
  seen.set(nkey[0], 0);
  push(h0, 0);
  const isGoal = (bs: ArrayLike<number>, off: number): boolean => {
    for (let j = 0; j < k; j++) if (!onOwnGoal(r, bs[off + j], j < np ? 0 : 1)) return false;
    return true;
  };
  if (isGoal(start, 0)) return { moves: [], nodes: 0 };

  let expanded = 0;
  let f = h0;
  for (;;) {
    while (f < buckets.length && !(buckets[f]?.length)) f++;
    if (f >= buckets.length) return { moves: null, proven: true, nodes: expanded };
    const u = buckets[f].pop()!;
    // Skip a node already expanded, or one reached again later by a shorter way.
    if (shut[u] || seen.get(nkey[u]) !== u) continue;
    const ubase = u * k;
    for (let j = 0; j < k; j++) cells[j] = nb[ubase + j];
    if (isGoal(cells, 0)) {
      const moves: PushMove[] = [];
      for (let v = u; par[v] >= 0; v = par[v]) moves.push({ cell: pc[v], dir: pd[v] as Dir });
      return { moves: moves.reverse(), nodes: expanded };
    }
    shut[u] = 1;
    if (++expanded > budget) return { moves: null, proven: false, nodes: expanded };
    const g = ng[u];
    // The probe's region in this node.
    ostamp++;
    for (let j = 0; j < k; j++) occ[cells[j]] = ostamp;
    flood(npl[u]);
    const reachStamp = stamp;
    const reach = vis; // read before the next flood
    // Collect the pushes first: the floods below overwrite `vis`.
    const moves: number[] = [];
    for (let j = 0; j < k; j++) {
      const b = cells[j];
      const kind = j < np ? 0 : 1;
      for (let d = 0; d < 4; d++) {
        const behind = b - D[d];
        if (reach[behind] !== reachStamp) continue;
        const to = b + D[d];
        if (!floor[to] || occ[to] === ostamp || !r.live[kind][to]) continue;
        moves.push(j * 4 + d);
      }
    }
    for (const mv of moves) {
      const j = mv >> 2, d = mv & 3;
      const b = cells[j], to = b + D[d];
      // The child's nucleons, re-sorted within their kind.
      const child = Array.from(cells);
      child[j] = to;
      const lo = j < np ? 0 : np, hi = j < np ? np : k;
      for (let a = lo + 1; a < hi; a++) for (let c = a; c > lo && child[c - 1] > child[c]; c--) { const t = child[c]; child[c] = child[c - 1]; child[c - 1] = t; }
      // A frozen 2 by 2 square with a loose nucleon in it can never be undone.
      ostamp++;
      for (let a = 0; a < k; a++) occ[child[a]] = ostamp;
      if (frozen(r, occ, ostamp, to, child, np)) continue;
      const hc = heuristic(r, child, np, k, gp, gn);
      if (hc >= FAR) continue;
      const norm = flood(b);
      const key = keyOf(child, norm);
      const gc = g + 1;
      const prev = seen.get(key);
      if (prev !== undefined && (shut[prev] || ng[prev] <= gc)) continue;
      if (count >= cap) grow();
      const id = count++;
      nb.set(child, id * k);
      npl[id] = b; par[id] = u; pc[id] = b; pd[id] = d; ng[id] = gc; nkey[id] = key;
      seen.set(key, id);
      push(gc + hc, id);
    }
  }
}

/** Whether `to`, just filled, closes a 2 by 2 square of walls and nucleons holding a nucleon that
 *  is not on a socket of its kind. */
function frozen(r: Room, occ: Int32Array, st: number, to: number, cells: ArrayLike<number>, np: number): boolean {
  const w = r.w;
  const solid = (c: number) => !r.floor[c] || occ[c] === st;
  for (const tl of [to, to - 1, to - w, to - w - 1]) {
    const sq = [tl, tl + 1, tl + w, tl + w + 1];
    if (!sq.every(solid)) continue;
    for (const c of sq) {
      if (occ[c] !== st) continue;
      let j = 0;
      while (cells[j] !== c) j++;
      if (!onOwnGoal(r, c, j < np ? 0 : 1)) return true;
    }
  }
  return false;
}

/**
 * The straight-at-it player: always push some nucleon one cell closer to a socket of its kind
 * (by the matched distance), taking the one nearest to walk to. Returns true when that alone
 * solves the deal; such deals are kept off the harder dial.
 */
export function greedySolves(s: PushState, limit = 80): boolean {
  const r = roomOf(s);
  let cur = s;
  const np = s.kinds.filter((k) => k === 0).length;
  const gp: number[] = [], gn: number[] = [];
  r.goalKinds.forEach((kk, i) => (kk === 0 ? gp : gn).push(i));
  const hOf = (st: PushState) => {
    const p: number[] = [], q: number[] = [];
    st.boxes.forEach((b, i) => (st.kinds[i] === 0 ? p : q).push(b));
    return heuristic(r, [...p, ...q], np, st.boxes.length, gp, gn);
  };
  const seen = new Set<string>();
  for (let t = 0; t < limit; t++) {
    if (solved(cur)) return true;
    const h = hOf(cur);
    const map = walkMap(cur);
    let best: { st: PushState; walk: number } | null = null;
    for (let i = 0; i < cur.boxes.length; i++) for (let d = 0 as Dir; d < 4; d++) {
      const b = cur.boxes[i];
      const behind = b - [-s.w, 1, s.w, -1][d];
      if (map[behind] === -2) continue;
      const res = step({ ...cur, player: behind }, d);
      if (!res || res.moves === cur.moves) continue;
      if (hOf(res) >= h) continue;
      let walk = 0;
      for (let c = behind; map[c] >= 0; c = map[c]) walk++;
      if (!best || walk < best.walk) best = { st: res, walk };
    }
    if (!best) return false;
    const key = best.st.boxes.join(',') + ':' + best.st.player;
    if (seen.has(key)) return false;
    seen.add(key);
    cur = best.st;
  }
  return solved(cur);
}

// ---- dealing -----------------------------------------------------------------------------

export interface PushShape {
  /** The chamber's inside, in cells. */
  cols: number;
  rows: number;
  boxes: number;
  /** Share of the inside turned into wall. */
  walls: number;
  /** Par wanted, low and high. */
  par: [number, number];
  /** Pushes beyond the straight-line distance a deal must ask for. */
  slack: number;
  /** How many times the plan must switch from one nucleon to another, at least. */
  switches: number;
  /** Keep deals the straight-at-it player solves off the board. */
  noGreedy: boolean;
  /** Positions the backwards search may visit in one chamber. */
  budget: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The board for dial d, 1 to 100. */
export function pushShape(d: number): PushShape {
  const dial = Math.max(1, Math.min(100, Math.round(d)));
  const t = (dial - 1) / 99;
  const boxes = dial <= 12 ? 1 : dial <= 40 ? 2 : dial <= 74 ? 3 : 4;
  // The inside grows from 4 by 4 to 7 by 7 a row or a column at a time.
  const DIMS: [number, number][] = [[4, 4], [4, 5], [5, 5], [5, 6], [6, 6], [6, 7], [7, 7]];
  const [cols, rows] = DIMS[Math.min(DIMS.length - 1, Math.floor(t * DIMS.length))];
  const walls = lerp(0.06, 0.28, t);
  // Par rises with the dial, and within each count of nucleons.
  const parLo = Math.round(lerp(2, 24, Math.pow(t, 1.05)));
  const par: [number, number] = [parLo, parLo + Math.round(lerp(3, 12, t))];
  const slack = dial <= 20 ? 0 : Math.round(lerp(0, 8, (dial - 20) / 80));
  const switches = Math.max(0, boxes - 1 + (dial > 60 ? 1 : 0) + (dial > 85 ? 1 : 0));
  return { cols, rows, boxes, walls, par, slack, switches, noGreedy: dial > 28, budget: boxes === 1 ? 3000 : boxes === 2 ? 10000 : boxes === 3 ? 14000 : 14000 };
}

/** How the last deal went: chambers tried, search states spent, and whether it met its shape
 *  (for the tests and tuning). */
export const lastDeal = { rooms: 0, nodes: 0, ok: false };

/** Deals a chamber for dial d (1 to 100), the same one every time for a (d, seed). */
export function newPush(d: number, seed: number): PushState {
  const rng = seeded(seed * 7919 + Math.round(d) * 104729);
  const shape = pushShape(d);
  let best: { s: PushState; score: number } | null = null;
  let spent = 0;
  lastDeal.rooms = 0; lastDeal.nodes = 0; lastDeal.ok = false;
  for (let attempt = 0; attempt < 40 && spent < shape.budget * 3; attempt++) {
    const room = makeRoom(rng, shape);
    const layout = room && sockets(rng, room, shape);
    if (!layout) continue;
    const tree = pullTree(layout, shape.budget);
    spent += tree.count;
    lastDeal.rooms++; lastDeal.nodes = spent;
    const pick = choose(rng, layout, tree, shape);
    if (!pick) continue;
    if (pick.ok) { lastDeal.ok = true; return pick.s; }
    if (!best || pick.score > best.score) best = pick;
  }
  return best ? best.s : fallback();
}

/** Sockets on cells a nucleon can be pulled off, with their kinds: as even as the count allows. */
function sockets(rng: Rng, room: { w: number; h: number; floor: boolean[] }, shape: PushShape): Pick<PushState, 'w' | 'h' | 'floor' | 'goals' | 'goalKinds'> | null {
  const { w, h, floor } = room;
  const open: number[] = [];
  for (let i = 0; i < floor.length; i++) if (floor[i]) open.push(i);
  if (open.length < shape.boxes * 3 + 4) return null;
  const pullable = open.filter((c) => [-w, 1, w, -1].some((d) => floor[c + d] && floor[c + 2 * d]));
  if (pullable.length < shape.boxes) return null;
  shuffle(rng, pullable);
  const goals = pullable.slice(0, shape.boxes).sort((x, y) => x - y);
  const nProt = shape.boxes === 1 ? (rand(rng) < 0.5 ? 1 : 0) : shape.boxes % 2 === 0 ? shape.boxes / 2 : (shape.boxes + (rand(rng) < 0.5 ? 1 : -1)) / 2;
  const order = goals.map((_, i) => i);
  shuffle(rng, order);
  const goalKinds = goals.map((_, i) => (order[i] < nProt ? 0 : 1) as Kind);
  return { w, h, floor, goals, goalKinds };
}

/** Every position the probe can pull the solved chamber into, breadth first, up to `budget`
 *  positions. A position's depth is exactly the fewest pushes that solve it (every one at a
 *  smaller depth was found first), and its parent chain is an optimal plan. */
interface Tree {
  count: number;
  k: number;
  np: number;
  cells: Uint8Array;
  player: Uint8Array;
  parent: Int32Array;
  /** The pull that made the node: the nucleon's new cell and the way the probe stepped. */
  pc: Uint8Array;
  pd: Uint8Array;
  depth: Int16Array;
}

function pullTree(layout: Pick<PushState, 'w' | 'h' | 'floor' | 'goals' | 'goalKinds'>, budget: number): Tree {
  const r = roomOf(layout);
  const n = r.n, D = r.D, floor = r.floor;
  const k = r.goals.length;
  const prot: number[] = [], neut: number[] = [];
  r.goals.forEach((g, i) => (r.goalKinds[i] === 0 ? prot : neut).push(g));
  const np = prot.length;
  const start = [...prot, ...neut];
  const cap = budget + 64;
  const cells = new Uint8Array(cap * k);
  const player = new Uint8Array(cap);
  const parent = new Int32Array(cap);
  const pc = new Uint8Array(cap);
  const pd = new Uint8Array(cap);
  const depth = new Int16Array(cap);
  const seen = new Set<number>();
  // `vis` marks cells reached by the current flood; `occ` marks walls (for good) and the
  // current node's nucleons, so the flood tests one array for both.
  const vis = new Int32Array(n);
  const occ = new Int32Array(n);
  const WALL = 0x7fffffff;
  for (let c = 0; c < n; c++) if (!floor[c]) occ[c] = WALL;
  let stamp = 0, ostamp = 0;
  const queue = new Int16Array(n);
  const w = r.w;
  const flood = (from: number): number => {
    const st = ++stamp, os = ostamp;
    let head = 0, tail = 0, min = from;
    queue[tail++] = from;
    vis[from] = st;
    while (head < tail) {
      const c = queue[head++];
      let x = c - w;
      if (vis[x] !== st && occ[x] !== os && occ[x] !== WALL) { vis[x] = st; if (x < min) min = x; queue[tail++] = x; }
      x = c + 1;
      if (vis[x] !== st && occ[x] !== os && occ[x] !== WALL) { vis[x] = st; queue[tail++] = x; }
      x = c + w;
      if (vis[x] !== st && occ[x] !== os && occ[x] !== WALL) { vis[x] = st; queue[tail++] = x; }
      x = c - 1;
      if (vis[x] !== st && occ[x] !== os && occ[x] !== WALL) { vis[x] = st; if (x < min) min = x; queue[tail++] = x; }
    }
    return min;
  };
  // Keys pack the floor ranks six bits apiece: up to four nucleons and the probe in 30 bits,
  // a small integer the engine hashes fast.
  const rank = r.rank;
  const keyOf = (bs: ArrayLike<number>, norm: number): number => {
    let key = 0;
    for (let j = 0; j < k; j++) key = key * 64 + rank[bs[j]];
    return key * 64 + rank[norm];
  };
  let count = 0;
  // Sources: the solved layout with the probe in each separate part of the free floor.
  const seenCell = new Uint8Array(n);
  ostamp++;
  for (const g of start) occ[g] = ostamp;
  for (let c = 0; c < n; c++) {
    if (!floor[c] || occ[c] === ostamp || seenCell[c]) continue;
    const norm = flood(c);
    for (let x = 0; x < n; x++) if (vis[x] === stamp) seenCell[x] = 1;
    const key = keyOf(start, norm);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.set(start, count * k);
    player[count] = c; parent[count] = -1; depth[count] = 0;
    count++;
  }
  const child = new Uint8Array(k);
  const pulls = new Int32Array(k * 4);
  for (let u = 0; u < count && count < budget; u++) {
    const base = u * k;
    ostamp++;
    for (let j = 0; j < k; j++) occ[cells[base + j]] = ostamp;
    flood(player[u]);
    const rs = stamp;
    let np2 = 0;
    for (let j = 0; j < k; j++) {
      const b = cells[base + j];
      for (let d = 0; d < 4; d++) {
        const stand = b + D[d], back = stand + D[d];
        if (vis[stand] !== rs || !floor[back] || occ[back] === ostamp) continue;
        pulls[np2++] = j * 4 + d;
      }
    }
    for (let q = 0; q < np2; q++) {
      const pl = pulls[q];
      const j = pl >> 2, d = pl & 3;
      const stand = cells[base + j] + D[d], back = stand + D[d];
      for (let a = 0; a < k; a++) child[a] = cells[base + a];
      child[j] = stand;
      const lo = j < np ? 0 : np, hi = j < np ? np : k;
      for (let a = lo + 1; a < hi; a++) for (let c = a; c > lo && child[c - 1] > child[c]; c--) { const t = child[c]; child[c] = child[c - 1]; child[c - 1] = t; }
      ostamp++;
      for (let a = 0; a < k; a++) occ[child[a]] = ostamp;
      const key = keyOf(child, flood(back));
      if (seen.has(key)) continue;
      seen.add(key);
      cells.set(child, count * k);
      player[count] = back; parent[count] = u; pc[count] = stand; pd[count] = d; depth[count] = depth[u] + 1;
      count++;
      if (count >= cap) break;
    }
  }
  return { count, k, np, cells, player, parent, pc, pd, depth };
}

/** The state a tree node stands for. */
function nodeState(layout: Pick<PushState, 'w' | 'h' | 'floor' | 'goals' | 'goalKinds'>, t: Tree, v: number): PushState {
  const boxes = Array.from(t.cells.subarray(v * t.k, v * t.k + t.k));
  const kinds = boxes.map((_, j) => (j < t.np ? 0 : 1) as Kind);
  return { ...layout, boxes, kinds, player: t.player[v], moves: 0, par: t.depth[v] };
}

/** A node's optimal plan: its pulls, last first, each read backwards as a push. */
function nodePlan(t: Tree, v: number): PushMove[] {
  const out: PushMove[] = [];
  for (let u = v; t.parent[u] >= 0; u = t.parent[u]) {
    // The pull drew the nucleon onto pc, the probe stepping way pd; the push sends it back.
    out.push({ cell: t.pc[u], dir: ((t.pd[u] + 2) % 4) as Dir });
  }
  return out;
}

/** Picks the deal from a pull tree: within the par wanted, the one that most asks for pushes a
 *  straight-at-it player would not make; then checks the finer marks on the best few. */
function choose(rng: Rng, layout: Pick<PushState, 'w' | 'h' | 'floor' | 'goals' | 'goalKinds'>, t: Tree, shape: PushShape): { s: PushState; ok: boolean; score: number } | null {
  const r = roomOf(layout);
  const gp: number[] = [], gn: number[] = [];
  r.goalKinds.forEach((kk, i) => (kk === 0 ? gp : gn).push(i));
  const [lo, hi] = shape.par;
  let maxDepth = 0;
  for (let v = 0; v < t.count; v++) maxDepth = Math.max(maxDepth, t.depth[v]);
  const top = Math.min(hi, maxDepth);
  const floorPar = Math.min(lo, top);
  const cands: { v: number; score: number }[] = [];
  for (let v = 0; v < t.count; v++) {
    const dep = t.depth[v];
    if (dep < floorPar || dep > top || dep === 0) continue;
    const cs = t.cells.subarray(v * t.k, v * t.k + t.k);
    let off = 0;
    for (let j = 0; j < t.k; j++) if (!onOwnGoal(r, cs[j], j < t.np ? 0 : 1)) off++;
    if (off === 0) continue;
    const h0 = heuristic(r, cs, t.np, t.k, gp, gn);
    const slack = dep - h0;
    const score = Math.min(slack, shape.slack + 4) * 3 + dep * 0.6 + (off === t.k ? 2 : 0) + rand(rng) * 2;
    cands.push({ v, score });
  }
  if (!cands.length) return null;
  cands.sort((x, y) => y.score - x.score);
  let best: { s: PushState; ok: boolean; score: number } | null = null;
  for (const c of cands.slice(0, 10)) {
    const s = nodeState(layout, t, c.v);
    const plan = nodePlan(t, c.v);
    const rated = rate(s, plan, shape);
    if (rated.ok) return { s, ok: true, score: rated.score };
    if (!best || rated.score > best.score) best = { s, ok: false, score: rated.score };
  }
  return best;
}

/** How a solved candidate measures up: whether it meets the shape, and a score to keep the
 *  closest one when none does. */
function rate(s: PushState, plan: PushMove[], shape: PushShape): { ok: boolean; score: number } {
  const r = roomOf(s);
  const np = s.kinds.filter((k) => k === 0).length;
  const gp: number[] = [], gn: number[] = [];
  r.goalKinds.forEach((kk, i) => (kk === 0 ? gp : gn).push(i));
  const p: number[] = [], q: number[] = [];
  s.boxes.forEach((b, i) => (s.kinds[i] === 0 ? p : q).push(b));
  const h0 = heuristic(r, [...p, ...q], np, s.boxes.length, gp, gn);
  const par = plan.length;
  const slack = par - h0;
  const sw = switches(s, plan);
  const offAll = placed(s) === 0;
  const [lo, hi] = shape.par;
  const parOk = par >= lo && par <= hi;
  const greedy = shape.noGreedy ? greedySolves(s) : false;
  const ok = parOk && slack >= shape.slack && sw >= shape.switches && !greedy && (offAll || shape.boxes >= 3);
  const miss = (par < lo ? lo - par : par > hi ? (par - hi) * 0.5 : 0);
  const score = -miss * 3 - Math.max(0, shape.slack - slack) * 2 - Math.max(0, shape.switches - sw) - (greedy ? 6 : 0) - (offAll || shape.boxes >= 3 ? 0 : 4);
  return { ok, score };
}

/** How many times a plan moves on from one nucleon to another. */
export function switches(s: PushState, plan: PushMove[]): number {
  let cur = s;
  let last = -1, n = 0;
  for (const m of plan) {
    const i = boxAt(cur, m.cell);
    if (last >= 0 && i !== last) n++;
    last = i;
    const res = playPush(cur, m);
    if (!res) break;
    cur = res.state;
  }
  return n;
}

/** A plain chamber with some wall pieces set into it, its floor all one connected space. */
function makeRoom(rng: Rng, shape: PushShape): { w: number; h: number; floor: boolean[] } | null {
  const W = shape.cols, H = shape.rows;
  const w = W + 2, h = H + 2;
  const floor = Array<boolean>(w * h).fill(false);
  for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) floor[y * w + x] = true;
  const target = Math.round(shape.walls * W * H);
  const PIECES: [number, number][][] = [
    [[0, 0]], [[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]],
    [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 1]], [[1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]],
  ];
  let walls = 0;
  for (let tries = 0; walls < target && tries < 80; tries++) {
    const piece = PIECES[randInt(rng, PIECES.length)];
    if (walls + piece.length > target + 1) continue;
    // Half the pieces lean on the chamber's edge, making notches; the rest stand inside.
    let ax = 1 + randInt(rng, W), ay = 1 + randInt(rng, H);
    if (rand(rng) < 0.45) {
      const side = randInt(rng, 4);
      if (side === 0) ay = 1; else if (side === 1) ax = W; else if (side === 2) ay = H; else ax = 1;
    }
    const cells = piece.map(([dx, dy]) => (ay + dy) * w + ax + dx);
    if (!cells.every((c) => floor[c] && c % w >= 1 && c % w <= W && Math.floor(c / w) >= 1 && Math.floor(c / w) <= H)) continue;
    for (const c of cells) floor[c] = false;
    if (!connected(floor, w, h) || deadEnds(floor, w) > 2 || !roomy(floor, w, h)) {
      for (const c of cells) floor[c] = true;
      continue;
    }
    walls += cells.length;
  }
  return { w, h, floor };
}

function connected(floor: boolean[], w: number, h: number): boolean {
  const n = w * h;
  let start = -1, total = 0;
  for (let i = 0; i < n; i++) if (floor[i]) { total++; if (start < 0) start = i; }
  if (start < 0) return false;
  const seen = new Uint8Array(n);
  const q = [start];
  seen[start] = 1;
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    for (const x of [c - w, c + 1, c + w, c - 1]) if (floor[x] && !seen[x]) { seen[x] = 1; q.push(x); }
  }
  return q.length === total;
}

/** Floor cells with only one open neighbor. */
function deadEnds(floor: boolean[], w: number): number {
  let k = 0;
  for (let i = 0; i < floor.length; i++) {
    if (!floor[i]) continue;
    const open = (floor[i - w] ? 1 : 0) + (floor[i + 1] ? 1 : 0) + (floor[i + w] ? 1 : 0) + (floor[i - 1] ? 1 : 0);
    if (open <= 1) k++;
  }
  return k;
}

/** No wall piece may seal off a 1-wide corridor longer than three cells: chambers stay rooms. */
function roomy(floor: boolean[], w: number, h: number): boolean {
  let narrow = 0;
  for (let i = 0; i < w * h; i++) {
    if (!floor[i]) continue;
    const hz = floor[i - 1] || floor[i + 1];
    const vt = floor[i - w] || floor[i + w];
    const thinH = !floor[i - w] && !floor[i + w];
    const thinV = !floor[i - 1] && !floor[i + 1];
    if ((thinH && hz) || (thinV && vt)) narrow++;
  }
  return narrow <= Math.max(3, Math.round(w * h * 0.08));
}

function shuffle<T>(rng: Rng, a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
}

/** Never expected: a one-push chamber, so a deal always exists. */
function fallback(): PushState {
  const w = 6, h = 6;
  const floor = Array<boolean>(w * h).fill(false);
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) floor[y * w + x] = true;
  return { w, h, floor, goals: [2 * w + 3], goalKinds: [0], boxes: [2 * w + 2], kinds: [0], player: 2 * w + 1, moves: 0, par: 1 };
}
