// Valence: bond the atoms into one molecule.
//
// Atoms sit on a grid, each printed with how many bonds it takes, 1 to 8. Join atoms in straight
// lines across or down to the next atom, with a single or a double bond, so that every atom has
// exactly its number of bonds, no two bonds cross, and every atom ends up in one connected
// molecule. Each board has exactly one answer, which a chain of deductions reaches.
//
// Game rule, not chemistry: the numbers are bond counts, not elements, and real molecules are not
// laid out on a grid.
//
// The solver works on a domain per bond lane (which of 0, 1 or 2 bonds it can still hold) and
// narrows it with rules of rising depth:
//   0  counts: an atom's need against what its lanes can still give or must already take, and
//      crossing lanes shutting each other;
//   1  the molecule: a lane that is the only link between two parts must hold a bond, and no bond
//      may close off a finished group from the rest;
//   2  a step of lookahead: a choice that runs, by the rules above, into a contradiction is out.
// A board the solver finishes this way has exactly one answer, and its depth is how hard it is.

import { rand, randInt, seeded, type Rng } from './rng';

export interface Atom {
  x: number;
  y: number;
  /** Bonds it takes, 1 to 8. */
  need: number;
}

/** A lane between two atoms that see each other along a row or a column. */
export interface Lane {
  a: number;
  b: number;
  /** Along a row (true) or a column. */
  horiz: boolean;
  /** Cells strictly between the two atoms. */
  cells: number[];
  /** Lanes that cross this one. */
  cross: number[];
}

export interface ValenceState {
  cols: number;
  rows: number;
  atoms: Atom[];
  lanes: Lane[];
  /** Bonds on each lane: 0, 1 or 2. */
  bonds: number[];
  /** The one answer. */
  solution: number[];
  moves: number;
  /** One drag per bond in the answer: a double takes two. */
  par: number;
  /** The deepest rule the solver needed (0, 1 or 2), and how many lookahead steps. */
  depth: number;
  looks: number;
}

export interface ValenceShape {
  cols: number;
  rows: number;
  atoms: number;
  /** Share of bonds dealt double. */
  doubles: number;
  /** Chance that two atoms that see each other, not yet joined, are joined too (rings). */
  rings: number;
  /** The deepest rule a board may need, and the depth it should need if it can. */
  maxDepth: number;
  wantDepth: number;
  /** Boards grown to choose from. */
  tries: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Board parameters for the difficulty dial d, 1 to 100. */
export function valenceShape(d: number): ValenceShape {
  const t = (clamp(Math.round(d), 1, 100) - 1) / 99;
  const cols = Math.round(7 + 3 * t);
  const rows = Math.round(7 + 6 * t);
  const atoms = Math.round(cols * rows * (0.16 + 0.06 * t));
  return {
    cols,
    rows,
    atoms,
    doubles: 0.5 - 0.22 * t,
    rings: 0.05 + 0.45 * t,
    maxDepth: d <= 20 ? 0 : d <= 50 ? 1 : 2,
    wantDepth: d <= 30 ? 0 : d <= 65 ? 1 : 2,
    tries: d <= 60 ? 4 : d <= 80 ? 8 : 11,
  };
}

// ---- the board's lanes -------------------------------------------------------------------

/** Every lane between atoms that see each other (nothing but empty cells between them). */
export function lanesFor(cols: number, rows: number, atoms: { x: number; y: number }[]): Lane[] {
  const at = new Int32Array(cols * rows).fill(-1);
  atoms.forEach((p, i) => { at[p.y * cols + p.x] = i; });
  const lanes: Lane[] = [];
  atoms.forEach((p, i) => {
    // Only right and down, so each lane is found once.
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const cells: number[] = [];
      let x = p.x + dx, y = p.y + dy;
      while (x < cols && y < rows && at[y * cols + x] < 0) { cells.push(y * cols + x); x += dx; y += dy; }
      if (x < cols && y < rows) lanes.push({ a: i, b: at[y * cols + x], horiz: dx === 1, cells, cross: [] });
    }
  });
  // Lanes cross where a row lane and a column lane share a cell.
  const byCell = new Map<number, number>();
  lanes.forEach((l, k) => { if (l.horiz) for (const c of l.cells) byCell.set(c, k); });
  lanes.forEach((l, k) => {
    if (l.horiz) return;
    for (const c of l.cells) {
      const h = byCell.get(c);
      if (h !== undefined) { l.cross.push(h); lanes[h].cross.push(k); }
    }
  });
  return lanes;
}

/** The lanes at each atom. */
export function lanesAt(s: { atoms: unknown[]; lanes: Lane[] }): number[][] {
  const out: number[][] = s.atoms.map(() => []);
  s.lanes.forEach((l, k) => { out[l.a].push(k); out[l.b].push(k); });
  return out;
}

/** The lane from atom i in a direction (0 up, 1 right, 2 down, 3 left), or -1. */
export function laneToward(s: ValenceState, i: number, dir: number): number {
  const p = s.atoms[i];
  for (let k = 0; k < s.lanes.length; k++) {
    const l = s.lanes[k];
    if (l.a !== i && l.b !== i) continue;
    const o = s.atoms[l.a === i ? l.b : l.a];
    const d = o.y < p.y ? 0 : o.x > p.x ? 1 : o.y > p.y ? 2 : 3;
    if (d === dir) return k;
  }
  return -1;
}

// ---- the rules on a board in play ---------------------------------------------------------

/** Bonds at each atom. */
export function counts(s: ValenceState): number[] {
  const out = s.atoms.map(() => 0);
  s.lanes.forEach((l, k) => { out[l.a] += s.bonds[k]; out[l.b] += s.bonds[k]; });
  return out;
}

/** The atoms in pieces, by the bonds drawn: each atom's piece number. */
export function pieces(s: ValenceState): number[] {
  const piece = s.atoms.map(() => -1);
  const adj = lanesAt(s);
  let next = 0;
  for (let i = 0; i < s.atoms.length; i++) {
    if (piece[i] >= 0) continue;
    const stack = [i];
    piece[i] = next;
    while (stack.length) {
      const a = stack.pop()!;
      for (const k of adj[a]) {
        if (!s.bonds[k]) continue;
        const b = s.lanes[k].a === a ? s.lanes[k].b : s.lanes[k].a;
        if (piece[b] < 0) { piece[b] = next; stack.push(b); }
      }
    }
    next++;
  }
  return piece;
}

export function solved(s: ValenceState): boolean {
  const c = counts(s);
  if (c.some((v, i) => v !== s.atoms[i].need)) return false;
  for (let k = 0; k < s.lanes.length; k++) if (s.bonds[k]) for (const f of s.lanes[k].cross) if (s.bonds[f]) return false;
  return pieces(s).every((p) => p === 0);
}

/** A bonded lane that crosses lane k, or -1. */
export function blocker(s: ValenceState, k: number): number {
  for (const f of s.lanes[k].cross) if (s.bonds[f]) return f;
  return -1;
}

export function cloneValence(s: ValenceState): ValenceState {
  return { ...s, bonds: s.bonds.slice() };
}

/** One drag along lane k: none to single, single to double, double to none. Null when a bond
 *  crossing it is in the way. */
export function cycle(s: ValenceState, k: number): ValenceState | null {
  if (s.bonds[k] === 0 && blocker(s, k) >= 0) return null;
  const next = cloneValence(s);
  next.bonds[k] = (s.bonds[k] + 1) % 3;
  next.moves++;
  return next;
}

/** Sets lane k straight to a count (Show me), counting the drags it would take to get there.
 *  Null when nothing changes or a bond is in the way. */
export function setBonds(s: ValenceState, k: number, v: number): ValenceState | null {
  if (s.bonds[k] === v) return null;
  if (v > 0 && blocker(s, k) >= 0) return null;
  const next = cloneValence(s);
  next.moves += (v - s.bonds[k] + 3) % 3;
  next.bonds[k] = v;
  return next;
}

/** A lane with more bonds than the answer has, or -1. */
export function firstWrong(s: ValenceState): number {
  for (let k = 0; k < s.lanes.length; k++) if (s.bonds[k] > s.solution[k]) return k;
  return -1;
}

// ---- the solver ----------------------------------------------------------------------------

/** What a rule did to a lane's domain, for hints. */
export interface Step {
  depth: number;
  lane: number;
  /** The rule: 'count' (an atom's need), 'cross', 'link' (only link between two parts),
   *  'seal' (would close off a finished group), 'look' (lookahead). */
  rule: 'count' | 'cross' | 'link' | 'seal' | 'look';
  /** The atom whose count fired, for 'count'. */
  atom?: number;
}

interface Net {
  n: number;
  need: number[];
  lanes: Lane[];
  at: number[][];
}

const lo = (d: number): number => (d & 1 ? 0 : d & 2 ? 1 : d & 4 ? 2 : 3);
const hi = (d: number): number => (d & 4 ? 2 : d & 2 ? 1 : d & 1 ? 0 : -1);
const single = (d: number): boolean => d === 1 || d === 2 || d === 4;
const ALL = 7;

/** Calls back on every narrowing; returning true stops the solver there. */
type Watch = (step: Step, dom: Uint8Array) => boolean;

class Halt extends Error {}

/** Narrows a domain to values in [a, b]. Returns whether it changed; throws on empty via the caller. */
function clip(dom: Uint8Array, k: number, a: number, b: number): boolean {
  let m = 0;
  for (let v = Math.max(0, a); v <= Math.min(2, b); v++) m |= 1 << v;
  const nd = dom[k] & m;
  if (nd === dom[k]) return false;
  dom[k] = nd;
  return true;
}

/**
 * Depth 0 to a fixpoint: each atom's need against its lanes' bounds, and crossing lanes. Returns
 * false on a contradiction.
 */
function counts0(net: Net, dom: Uint8Array, watch?: Watch): boolean {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < net.n; i++) {
      let sLo = 0, sHi = 0;
      for (const k of net.at[i]) { sLo += lo(dom[k]); sHi += hi(dom[k]); }
      const need = net.need[i];
      if (sLo > need || sHi < need) return false;
      for (const k of net.at[i]) {
        const a = need - (sHi - hi(dom[k])), b = need - (sLo - lo(dom[k]));
        if (clip(dom, k, a, b)) {
          if (!dom[k]) return false;
          changed = true;
          if (watch?.({ depth: 0, lane: k, rule: 'count', atom: i }, dom)) throw new Halt();
          sLo = 0; sHi = 0;
          for (const q of net.at[i]) { sLo += lo(dom[q]); sHi += hi(dom[q]); }
        }
      }
    }
    for (let k = 0; k < net.lanes.length; k++) {
      if (lo(dom[k]) < 1) continue;
      for (const f of net.lanes[k].cross) {
        if (!(dom[f] & 6)) continue;
        dom[f] &= 1;
        if (!dom[f]) return false;
        changed = true;
        if (watch?.({ depth: 0, lane: f, rule: 'cross' }, dom)) throw new Halt();
      }
    }
  }
  return true;
}

/** Atoms joined by lanes whose bonds pass the test, from atom `from`. */
function reach(net: Net, from: number, ok: (k: number) => boolean, seen: Int32Array, stamp: number): number[] {
  const out = [from];
  seen[from] = stamp;
  for (let j = 0; j < out.length; j++) {
    const a = out[j];
    for (const k of net.at[a]) {
      if (!ok(k)) continue;
      const b = net.lanes[k].a === a ? net.lanes[k].b : net.lanes[k].a;
      if (seen[b] !== stamp) { seen[b] = stamp; out.push(b); }
    }
  }
  return out;
}

/**
 * Depth 1, one narrowing at a time: returns 1 when it narrowed a lane, 0 when it found nothing,
 * -1 on a contradiction (the lanes that can still hold bonds no longer join every atom, or a
 * finished group is closed off).
 */
function molecule1(net: Net, dom: Uint8Array, watch?: Watch): number {
  const n = net.n, L = net.lanes.length;
  const seen = new Int32Array(n);
  // Everything still joinable?
  if (reach(net, 0, (k) => hi(dom[k]) >= 1, seen, 1).length < n) return -1;
  // A finished group closed off already?
  const sumLo = (i: number, k = -1, v = 0): number => { let s = 0; for (const q of net.at[i]) s += q === k ? v : lo(dom[q]); return s; };
  {
    const done = new Uint8Array(n);
    let stamp = 2;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      const g = reach(net, i, (k) => lo(dom[k]) >= 1, seen, stamp++);
      for (const a of g) done[a] = 1;
      if (g.length < n && g.every((a) => sumLo(a) === net.need[a])) return -1;
    }
  }
  // The only link: a lane whose removal splits the joinable atoms (a bridge, by Tarjan).
  const tin = new Int32Array(n).fill(-1), low = new Int32Array(n);
  let timer = 0;
  let found = -1;
  const dfs = (v: number, parentLane: number): void => {
    tin[v] = low[v] = timer++;
    for (const k of net.at[v]) {
      if (k === parentLane || hi(dom[k]) < 1) continue;
      const u = net.lanes[k].a === v ? net.lanes[k].b : net.lanes[k].a;
      if (tin[u] >= 0) low[v] = Math.min(low[v], tin[u]);
      else {
        dfs(u, k);
        low[v] = Math.min(low[v], low[u]);
        if (low[u] > tin[v] && lo(dom[k]) === 0 && found < 0) found = k;
      }
    }
  };
  dfs(0, -1);
  if (found >= 0) {
    dom[found] &= 6;
    if (!dom[found]) return -1;
    if (watch?.({ depth: 1, lane: found, rule: 'link' }, dom)) throw new Halt();
    return 1;
  }
  // Sealing: a bond that would close a finished group off from the rest is out.
  let stamp = 1000;
  for (let k = 0; k < L; k++) {
    if (single(dom[k])) continue;
    for (let v = 1; v <= 2; v++) {
      if (!(dom[k] & (1 << v))) continue;
      // Both ends must be finished by it before a group can be sealed.
      const { a, b } = net.lanes[k];
      if (sumLo(a, k, v) !== net.need[a] || sumLo(b, k, v) !== net.need[b]) continue;
      const ok = (q: number) => (q === k ? v : lo(dom[q])) >= 1;
      const g = reach(net, net.lanes[k].a, ok, seen, stamp++);
      if (g.length >= n) continue;
      if (g.every((a) => sumLo(a, k, v) === net.need[a])) {
        dom[k] &= ~(1 << v);
        if (!dom[k]) return -1;
        if (watch?.({ depth: 1, lane: k, rule: 'seal' }, dom)) throw new Halt();
        return 1;
      }
    }
  }
  return 0;
}

/** Depths 0 and 1 to a fixpoint. False on a contradiction. */
function settle(net: Net, dom: Uint8Array, maxDepth: number, watch?: Watch, used?: { depth: number }): boolean {
  for (;;) {
    if (!counts0(net, dom, watch)) return false;
    if (maxDepth < 1) return true;
    const r = molecule1(net, dom, watch);
    if (r < 0) return false;
    if (r === 0) return true;
    if (used) used.depth = Math.max(used.depth, 1);
  }
}

export interface Grade {
  /** Every lane fixed. */
  solved: boolean;
  /** False when the rules ran into a contradiction (no answer). */
  ok: boolean;
  depth: number;
  looks: number;
  dom: Uint8Array;
}

/** Runs the solver's rules, no deeper than maxDepth, from the given domains. */
function run(net: Net, dom: Uint8Array, maxDepth: number, watch?: Watch): Grade {
  const used = { depth: 0 };
  let looks = 0;
  let from = 0;
  const fail = (): Grade => ({ solved: false, ok: false, depth: used.depth, looks, dom });
  for (;;) {
    if (!settle(net, dom, maxDepth, watch, used)) return fail();
    if (dom.every(single)) return { solved: true, ok: true, depth: used.depth, looks, dom };
    if (maxDepth < 2) return { solved: false, ok: true, depth: used.depth, looks, dom };
    // Lookahead: a value that settles into a contradiction is out. The scan carries on round the
    // lanes from where the last one was found.
    let hit = false;
    for (let j = 0; j < dom.length && !hit; j++) {
      const k = (from + j) % dom.length;
      if (single(dom[k])) continue;
      for (let v = 0; v <= 2 && !hit; v++) {
        if (!(dom[k] & (1 << v))) continue;
        const trial = dom.slice();
        trial[k] = 1 << v;
        if (!settle(net, trial, 1)) {
          dom[k] &= ~(1 << v);
          hit = true;
          from = k;
          looks++;
          used.depth = 2;
          if (!dom[k]) return fail();
          if (watch?.({ depth: 2, lane: k, rule: 'look' }, dom)) throw new Halt();
        }
      }
    }
    if (!hit) return { solved: false, ok: true, depth: used.depth, looks, dom };
  }
}

function netOf(atoms: Atom[], lanes: Lane[]): Net {
  const at: number[][] = atoms.map(() => []);
  lanes.forEach((l, k) => { at[l.a].push(k); at[l.b].push(k); });
  return { n: atoms.length, need: atoms.map((a) => a.need), lanes, at };
}

/** How the solver fares on a board from scratch. */
export function grade(atoms: Atom[], lanes: Lane[], maxDepth = 2): Grade {
  return run(netOf(atoms, lanes), new Uint8Array(lanes.length).fill(ALL), maxDepth);
}

/** Counts answers up to `limit` by search (for checking the solver). */
export function countSolutions(atoms: Atom[], lanes: Lane[], limit = 2): number {
  const net = netOf(atoms, lanes);
  let found = 0;
  const rec = (dom: Uint8Array): void => {
    if (found >= limit) return;
    if (!settle(net, dom, 1)) return;
    let k = -1;
    for (let q = 0; q < dom.length; q++) if (!single(dom[q])) { k = q; break; }
    if (k < 0) { found++; return; }
    for (let v = 0; v <= 2; v++) {
      if (!(dom[k] & (1 << v))) continue;
      const next = dom.slice();
      next[k] = 1 << v;
      rec(next);
    }
  };
  rec(new Uint8Array(lanes.length).fill(ALL));
  return found;
}

/**
 * The next deduction from the board as it stands (bonds taken as right so far): the first lane
 * the rules show needs more bonds than it has, with how many, and the deepest rule that led
 * there. Null when the rules find nothing (never expected on a fair board).
 */
export function nextForced(s: ValenceState): { lane: number; bonds: number; step: Step; why: Step } | null {
  const net = netOf(s.atoms, s.lanes);
  const dom = new Uint8Array(s.lanes.length);
  for (let k = 0; k < dom.length; k++) dom[k] = ALL & ~((1 << s.bonds[k]) - 1);
  let hit: { lane: number; bonds: number; step: Step; why: Step } | null = null;
  let deepest: Step | null = null;
  const watch: Watch = (step, d) => {
    if (step.depth >= 1 && (!deepest || step.depth >= deepest.depth)) deepest = step;
    if (lo(d[step.lane]) > s.bonds[step.lane]) {
      hit = { lane: step.lane, bonds: lo(d[step.lane]), step, why: deepest && deepest.depth > step.depth ? deepest : step };
      return true;
    }
    return false;
  };
  try {
    run(net, dom, 2, watch);
  } catch (e) {
    if (!(e instanceof Halt)) throw e;
  }
  return hit;
}

// ---- dealing ------------------------------------------------------------------------------

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** A random tree of atoms grown by straight bonds, then a few rings closed. */
function grow(sh: ValenceShape, rng: Rng): { atoms: { x: number; y: number }[]; links: Map<string, number> } {
  const { cols, rows } = sh;
  // -1 empty, -2 a bond along a row, -3 a bond down a column, else an atom.
  const occ = new Int32Array(cols * rows).fill(-1);
  const atoms: { x: number; y: number }[] = [];
  const links = new Map<string, number>();
  const used: number[][] = [];
  const place = (x: number, y: number): number => {
    occ[y * cols + x] = atoms.length;
    atoms.push({ x, y });
    used.push([0, 0, 0, 0]);
    return atoms.length - 1;
  };
  const isAtom = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows && occ[y * cols + x] >= 0;
  place(1 + randInt(rng, cols - 2), 1 + randInt(rng, rows - 2));
  const maxLen = Math.max(3, Math.round(Math.min(cols, rows) / 2));
  for (let tries = 0; atoms.length < sh.atoms && tries < sh.atoms * 60; tries++) {
    const a = randInt(rng, atoms.length);
    const dir = randInt(rng, 4);
    if (used[a][dir]) continue;
    const len = 2 + Math.floor(Math.pow(rand(rng), 1.6) * (maxLen - 1));
    const p = atoms[a];
    const tx = p.x + DX[dir] * len, ty = p.y + DY[dir] * len;
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
    let clear = true;
    for (let s = 1; s <= len && clear; s++) if (occ[(p.y + DY[dir] * s) * cols + p.x + DX[dir] * s] !== -1) clear = false;
    if (!clear) continue;
    // No atom right beside the new one.
    if ([0, 1, 2, 3].some((d) => isAtom(tx + DX[d], ty + DY[d]))) continue;
    const b = place(tx, ty);
    for (let s = 1; s < len; s++) occ[(p.y + DY[dir] * s) * cols + p.x + DX[dir] * s] = dir % 2 ? -2 : -3;
    used[a][dir] = 1;
    used[b][(dir + 2) % 4] = 1;
    links.set(key(a, b), rand(rng) < sh.doubles ? 2 : 1);
  }
  // Rings: join some atoms that see each other with nothing in the way.
  for (const l of lanesFor(cols, rows, atoms)) {
    if (links.has(key(l.a, l.b)) || l.cells.length === 0) continue;
    if (rand(rng) >= sh.rings) continue;
    if (l.cells.some((c) => occ[c] !== -1)) continue;
    for (const c of l.cells) occ[c] = l.horiz ? -2 : -3;
    links.set(key(l.a, l.b), rand(rng) < sh.doubles ? 2 : 1);
  }
  return { atoms, links };
}

const key = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

function needsOf(atoms: { x: number; y: number }[], lanes: Lane[], sol: number[]): Atom[] {
  const need = atoms.map(() => 0);
  lanes.forEach((l, k) => { need[l.a] += sol[k]; need[l.b] += sol[k]; });
  return atoms.map((p, i) => ({ x: p.x, y: p.y, need: need[i] }));
}

interface Candidate { atoms: Atom[]; lanes: Lane[]; sol: number[]; depth: number; looks: number }

/**
 * One board: a grown molecule, then, while the solver cannot finish it, one of the lanes it is
 * unsure of changed in the answer (a bond added, or a single made double or a double single),
 * which changes the counts it reads. Null when it does not come out within the depth allowed.
 */
function attempt(sh: ValenceShape, rng: Rng): Candidate | null {
  const { atoms: pts, links } = grow(sh, rng);
  if (pts.length < Math.max(3, sh.atoms * 0.8)) return null;
  const lanes = lanesFor(sh.cols, sh.rows, pts);
  const sol = lanes.map((l) => links.get(key(l.a, l.b)) ?? 0);
  for (let fix = 0; fix < 24; fix++) {
    const atoms = needsOf(pts, lanes, sol);
    const g = grade(atoms, lanes, sh.maxDepth);
    if (g.solved) return { atoms, lanes, sol: sol.slice(), depth: g.depth, looks: g.looks };
    const open: number[] = [];
    for (let k = 0; k < lanes.length; k++) if (!single(g.dom[k])) open.push(k);
    // Prefer a change that cannot cross a bond of the answer.
    const ok = open.filter((k) => sol[k] > 0 || lanes[k].cross.every((f) => !sol[f]));
    if (!ok.length) return null;
    const k = ok[randInt(rng, ok.length)];
    sol[k] = sol[k] === 0 ? 1 : sol[k] === 1 ? 2 : 1;
  }
  return null;
}

/**
 * Deals a board for dial d: several molecules are grown and made solvable, and the one whose
 * hardest step best matches the dial is kept. Every board the solver finishes has one answer.
 */
export function newValence(d: number, seed: number): ValenceState {
  const rng = seeded(seed);
  const sh = valenceShape(d);
  let best: Candidate | null = null;
  let bestScore = Infinity;
  const tries = sh.tries;
  for (let i = 0; i < 60 && (i < tries || !best); i++) {
    const c = attempt(sh, rng);
    if (!c) continue;
    // Closest depth first; among the deepest, more lookahead steps on the hardest boards.
    const score = Math.abs(c.depth - sh.wantDepth) * 100 - (sh.wantDepth >= 2 ? Math.min(c.looks, 8) : 0) + Math.abs(c.atoms.length - sh.atoms);
    if (score < bestScore) { best = c; bestScore = score; }
    if (score <= (sh.wantDepth >= 2 ? -2 : 0)) break;
  }
  if (!best) throw new Error('Valence: no board');
  return {
    cols: sh.cols,
    rows: sh.rows,
    atoms: best.atoms,
    lanes: best.lanes,
    bonds: best.lanes.map(() => 0),
    solution: best.sol,
    moves: 0,
    par: best.sol.reduce((a, b) => a + b, 0),
    depth: best.depth,
    looks: best.looks,
  };
}
