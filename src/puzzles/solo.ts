// Solo: one electron in every orbital.
//
// An N by N grid is split into N orbitals, each a connected patch of cells. Place one electron in
// every row, every column and every orbital, and no two electrons may touch, not even at a
// corner. Crosses are the player's own notes ("not here") and never count. Every deal has
// exactly one answer, and a step-by-step human-style solver can reach it without guessing.
//
// Game rule, not physics: a half-filled subshell does put one electron in each orbital (Hund's
// rule), but orbitals are not patches of a grid and electrons do not sit in rows and columns.

import { rand, randInt, seeded, type Rng } from './rng';

/** 0 empty, 1 a cross (the player's "not here"), 2 an electron. */
export type Mark = 0 | 1 | 2;
export const CROSS: Mark = 1;
export const ELECTRON: Mark = 2;

export interface SoloState {
  size: number;
  /** The orbital (0..size-1) each cell belongs to. */
  regions: number[];
  cells: Mark[];
  /** The one answer: the electron's column in each row. */
  solution: number[];
  /** Electrons placed (crosses are free). */
  moves: number;
  /** One electron per row. */
  par: number;
  /** How the solver rated the deal: steps that needed more than a single. */
  score: number;
}

// ---- board geometry -----------------------------------------------------------------------

/** The board's units: rows 0..n-1, columns n..2n-1, orbitals 2n..3n-1, each a list of cells. */
export interface Geometry {
  n: number;
  units: number[][];
  /** Each cell's three units: row, column, orbital. */
  unitsOf: [number, number, number][];
  /** The cells an electron here rules out: its row, column, orbital and eight neighbors. */
  seen: number[][];
  /** sees[i * n * n + j]: an electron at i rules out j. */
  sees: Uint8Array;
}

export function geometry(n: number, regions: number[]): Geometry {
  const units: number[][] = Array.from({ length: 3 * n }, () => []);
  const unitsOf: [number, number, number][] = [];
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = Math.floor(i / n);
    const u: [number, number, number] = [y, n + x, 2 * n + regions[i]];
    unitsOf.push(u);
    for (const k of u) units[k].push(i);
  }
  const seen: number[][] = [];
  for (let i = 0; i < n * n; i++) {
    const set = new Set<number>();
    for (const k of unitsOf[i]) for (const j of units[k]) set.add(j);
    const x = i % n, y = Math.floor(i / n);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < n && yy < n) set.add(yy * n + xx);
    }
    set.delete(i);
    seen.push([...set]);
  }
  const sees = new Uint8Array(n * n * n * n);
  seen.forEach((list, i) => { for (const j of list) sees[i * n * n + j] = 1; });
  return { n, units, unitsOf, seen, sees };
}

export type UnitKind = 'row' | 'column' | 'orbital';
export const unitKind = (n: number, u: number): UnitKind => (u < n ? 'row' : u < 2 * n ? 'column' : 'orbital');
export const touching = (n: number, a: number, b: number): boolean =>
  a !== b && Math.abs((a % n) - (b % n)) <= 1 && Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 1;

// ---- rules ----------------------------------------------------------------------------------

/** Electrons that break a rule: two in a row, column or orbital, or two touching. */
export function conflicts(s: SoloState): Set<number> {
  const n = s.size;
  const els: number[] = [];
  s.cells.forEach((v, i) => { if (v === ELECTRON) els.push(i); });
  const out = new Set<number>();
  for (let a = 0; a < els.length; a++) for (let b = a + 1; b < els.length; b++) {
    const i = els[a], j = els[b];
    const same = i % n === j % n || Math.floor(i / n) === Math.floor(j / n) || s.regions[i] === s.regions[j];
    if (same || touching(n, i, j)) { out.add(i); out.add(j); }
  }
  return out;
}

export const electrons = (s: SoloState): number => s.cells.filter((v) => v === ELECTRON).length;

export function solved(s: SoloState): boolean {
  return electrons(s) === s.size && conflicts(s).size === 0;
}

export const isAnswer = (s: SoloState, i: number): boolean => s.solution[Math.floor(i / s.size)] === i % s.size;

/** A mark against the answer: an electron off it, or a cross on it. -1 when every mark agrees. */
export function firstWrong(s: SoloState): number {
  for (let i = 0; i < s.cells.length; i++) {
    const v = s.cells[i];
    if (v === ELECTRON && !isAnswer(s, i)) return i;
    if (v === CROSS && isAnswer(s, i)) return i;
  }
  return -1;
}

// ---- moves ----------------------------------------------------------------------------------

export function cloneSolo(s: SoloState): SoloState {
  return { ...s, cells: s.cells.slice() };
}

/** A tap: empty to cross, cross to electron, electron to empty. */
export function tap(s: SoloState, i: number): SoloState {
  return setMark(s, i, ((s.cells[i] + 1) % 3) as Mark)!;
}

/** Sets cells to one mark as one move; null when nothing changes. Each electron placed counts. */
export function setMarks(s: SoloState, cells: number[], v: Mark): SoloState | null {
  const todo = cells.filter((i) => s.cells[i] !== v);
  if (!todo.length) return null;
  const next = cloneSolo(s);
  for (const i of todo) next.cells[i] = v;
  if (v === ELECTRON) next.moves += todo.length;
  return next;
}

export const setMark = (s: SoloState, i: number, v: Mark): SoloState | null => setMarks(s, [i], v);

// ---- counting answers -----------------------------------------------------------------------

/** Answers to the orbitals, up to `limit`, each as a column per row. The search branches on
 *  whichever row, column or orbital has the fewest cells left, so it stays quick. */
export function solutions(n: number, regions: number[], limit = 2): number[][] {
  const N = n * n;
  const units: number[][] = Array.from({ length: 3 * n }, () => []);
  for (let i = 0; i < N; i++) { units[Math.floor(i / n)].push(i); units[n + (i % n)].push(i); units[2 * n + regions[i]].push(i); }
  const blocked = new Int16Array(N);
  const done = new Uint8Array(3 * n);
  const cols: number[] = Array(n).fill(-1);
  const out: number[][] = [];
  const touch = (i: number, d: number): void => {
    const x = i % n, y = Math.floor(i / n), g = regions[i];
    for (let k = 0; k < n; k++) { blocked[y * n + k] += d; blocked[k * n + x] += d; }
    for (const j of units[2 * n + g]) blocked[j] += d;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < n && yy < n) blocked[yy * n + xx] += d;
    }
  };
  const step = (placed: number): void => {
    if (out.length >= limit) return;
    if (placed === n) { out.push(cols.slice()); return; }
    let best = -1, bestCount = 99;
    for (let u = 0; u < 3 * n; u++) {
      if (done[u]) continue;
      let c = 0;
      for (const i of units[u]) if (!blocked[i]) c++;
      if (c < bestCount) { bestCount = c; best = u; if (c === 0) return; }
    }
    for (const i of units[best]) {
      if (blocked[i]) continue;
      const y = Math.floor(i / n), x = i % n, g = 2 * n + regions[i];
      done[y] = 1; done[n + x] = 1; done[g] = 1;
      cols[y] = x;
      touch(i, 1);
      step(placed + 1);
      touch(i, -1);
      done[y] = 0; done[n + x] = 0; done[g] = 0;
      cols[y] = -1;
      if (out.length >= limit) return;
    }
  };
  step(0);
  return out;
}

export const countSolutions = (n: number, regions: number[], limit = 2): number => solutions(n, regions, limit).length;

// ---- the human-style solver ---------------------------------------------------------------

/**
 * One deduction. `single`: a unit with one free cell left gets its electron. `confined`: a unit's
 * free cells all lie in one unit of another kind, so the rest of that one is empty. `squeeze`:
 * an electron in these cells would leave a unit no room. `group`: k orbitals fill k rows (or
 * columns) between them, or k rows lie within k orbitals, so the rest is empty.
 */
export interface Step {
  kind: 'single' | 'confined' | 'squeeze' | 'group';
  /** The electron placed, or -1. */
  place: number;
  /** Cells crossed off. */
  cross: number[];
  /** The units the reasoning is about (the one with one cell left, the confined one, the one
   *  squeezed, or the group). */
  units: number[];
  /** The units it clears (confined and group). */
  into: number[];
  /** 0 for a single, 1 for confined and squeeze, 2 and up for a group of that size. */
  level: number;
}

/** The solver's knowledge: which cells may still hold an electron, and which do. */
export interface Knowledge { cand: Uint8Array; el: Uint8Array }

export function place(g: Geometry, k: Knowledge, i: number): void {
  k.el[i] = 1;
  k.cand[i] = 0;
  for (const j of g.seen[i]) k.cand[j] = 0;
}

const unitDone = (g: Geometry, k: Knowledge, u: number): boolean => g.units[u].some((i) => k.el[i]);
const free = (g: Geometry, k: Knowledge, u: number): number[] => g.units[u].filter((i) => k.cand[i]);

/** What the player knows from the board: electrons placed (and what they rule out) and crosses. */
export function knowledgeOf(s: SoloState, g: Geometry): Knowledge {
  const k: Knowledge = { cand: new Uint8Array(s.cells.length).fill(1), el: new Uint8Array(s.cells.length) };
  s.cells.forEach((v, i) => { if (v === CROSS) k.cand[i] = 0; });
  s.cells.forEach((v, i) => { if (v === ELECTRON) place(g, k, i); });
  return k;
}

function combos(items: number[], k: number, visit: (pick: number[]) => boolean): boolean {
  const pick: number[] = [];
  const go = (from: number): boolean => {
    if (pick.length === k) return visit(pick);
    for (let i = from; i <= items.length - (k - pick.length); i++) {
      pick.push(items[i]);
      if (go(i + 1)) return true;
      pick.pop();
    }
    return false;
  };
  return go(0);
}

/** The simplest deduction left, or null when none applies (or the board is already done). */
export function nextStep(g: Geometry, k: Knowledge, maxGroup = 4): Step | null {
  const n = g.n;
  const open: number[] = [];
  for (let u = 0; u < 3 * n; u++) if (!unitDone(g, k, u)) open.push(u);
  if (!open.length) return null;
  const freeOf = new Map<number, number[]>();
  for (const u of open) freeOf.set(u, free(g, k, u));
  // Singles: orbitals first (they read best), then rows and columns.
  const order = [...open.filter((u) => u >= 2 * n), ...open.filter((u) => u < 2 * n)];
  for (const u of order) {
    const f = freeOf.get(u)!;
    if (f.length === 0) return null;
    if (f.length === 1) {
      const i = f[0];
      return { kind: 'single', place: i, cross: g.seen[i].filter((j) => k.cand[j]), units: [u], into: [], level: 0 };
    }
  }
  // Confined: a unit's free cells inside one unit of another kind.
  for (const u of order) {
    const f = freeOf.get(u)!;
    const kind = unitKind(n, u);
    const targets = kind === 'orbital' ? [0, 1] : [2];
    for (const t of targets) {
      const v = g.unitsOf[f[0]][t];
      if (!f.every((i) => g.unitsOf[i][t] === v)) continue;
      const cross = g.units[v].filter((i) => k.cand[i] && g.unitsOf[i][kind === 'row' ? 0 : kind === 'column' ? 1 : 2] !== u);
      if (cross.length) return { kind: 'confined', place: -1, cross, units: [u], into: [v], level: 1 };
    }
  }
  // Squeeze: cells whose electron would see every free cell of some other open unit.
  for (const u of order) {
    const f = freeOf.get(u)!;
    const cross: number[] = [];
    for (let i = 0; i < n * n; i++) {
      if (!k.cand[i] || g.unitsOf[i].includes(u)) continue;
      const base = i * n * n;
      if (f.every((j) => g.sees[base + j])) cross.push(i);
    }
    if (cross.length) return { kind: 'squeeze', place: -1, cross, units: [u], into: [], level: 1 };
  }
  // Groups: k orbitals within k rows or columns, or k rows or columns within k orbitals.
  const regionsOpen = open.filter((u) => u >= 2 * n);
  const rowsOpen = open.filter((u) => u < n), colsOpen = open.filter((u) => u >= n && u < 2 * n);
  for (let size = 2; size <= maxGroup; size++) {
    let found: Step | null = null;
    const tryGroup = (from: number[], t: 0 | 1 | 2): void => {
      if (found || from.length <= size) return;
      combos(from, size, (pick) => {
        const into = new Set<number>();
        for (const u of pick) for (const i of freeOf.get(u)!) into.add(g.unitsOf[i][t]);
        if (into.size !== size) return false;
        const mine = new Set(pick);
        const fromSlot = unitKind(n, pick[0]) === 'row' ? 0 : unitKind(n, pick[0]) === 'column' ? 1 : 2;
        const cross: number[] = [];
        for (const v of into) for (const i of g.units[v]) if (k.cand[i] && !mine.has(g.unitsOf[i][fromSlot])) cross.push(i);
        if (!cross.length) return false;
        found = { kind: 'group', place: -1, cross, units: pick.slice(), into: [...into].sort((a, b) => a - b), level: size };
        return true;
      });
    };
    tryGroup(regionsOpen, 0);
    tryGroup(regionsOpen, 1);
    tryGroup(rowsOpen, 2);
    tryGroup(colsOpen, 2);
    if (found) return found;
  }
  return null;
}

export function applyStep(g: Geometry, k: Knowledge, st: Step): void {
  if (st.place >= 0) place(g, k, st.place);
  for (const i of st.cross) k.cand[i] = 0;
}

/**
 * Solves the orbitals the way a person would, simplest step first. Returns the rating (one per
 * confined or squeeze step, the group size squared per group step), or -1 when the steps run
 * out before every electron is placed.
 */
export function rate(n: number, regions: number[]): number {
  const g = geometry(n, regions);
  const k: Knowledge = { cand: new Uint8Array(n * n).fill(1), el: new Uint8Array(n * n) };
  let score = 0;
  for (let guard = 0; guard < 4 * n * n; guard++) {
    if (k.el.reduce((a, b) => a + b, 0) === n) return score;
    const st = nextStep(g, k);
    if (!st) return -1;
    if (st.level === 1) score += 1;
    else if (st.level >= 2) score += st.level * st.level;
    applyStep(g, k, st);
  }
  return -1;
}

// ---- dealing ------------------------------------------------------------------------------

/**
 * Board size and how hard a deal to pick, for the difficulty dial d (1..100). `spread` shapes
 * the orbitals: high, a few big ones and many small (more footholds); low, more even sizes
 * (fewer). `level` picks, among `pool` good deals, the easiest (0) to the hardest (1).
 */
export function soloShape(d: number): { size: number; level: number; pool: number; spread: number } {
  const dd = Math.max(1, Math.min(100, Math.round(d)));
  // Size bands: [first dial, size].
  const bands: [number, number][] = [[1, 5], [15, 6], [33, 7], [53, 8], [73, 9], [93, 10]];
  let b = 0;
  while (b + 1 < bands.length && dd >= bands[b + 1][0]) b++;
  const from = bands[b][0], to = b + 1 < bands.length ? bands[b + 1][0] - 1 : 100;
  const pos = to > from ? (dd - from) / (to - from) : 1;
  // Each bigger board starts a little above the easiest, so the dial never drops back far.
  const level = b === 0 ? pos : 0.15 + 0.85 * pos;
  const size = bands[b][1];
  const spread = Math.max(size >= 10 ? 1.5 : 1, 3 - (2 * (dd - 1)) / 99);
  const pool = Math.min(size >= 10 ? 3 : 6, 2 + Math.round(level * 4));
  return { size, level, pool, spread };
}

/** A random answer: a column per row with no two in a column and no two touching. */
function randomAnswer(n: number, rng: Rng): number[] {
  const cols: number[] = [];
  const used = new Set<number>();
  const go = (r: number): boolean => {
    if (r === n) return true;
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = randInt(rng, i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    for (const c of order) {
      if (used.has(c) || (r && Math.abs(c - cols[r - 1]) <= 1)) continue;
      cols[r] = c; used.add(c);
      if (go(r + 1)) return true;
      used.delete(c);
    }
    return false;
  };
  go(0);
  return cols;
}

const side = (n: number, i: number): number[] => {
  const x = i % n, y = Math.floor(i / n);
  const out: number[] = [];
  if (y > 0) out.push(i - n);
  if (x < n - 1) out.push(i + 1);
  if (y < n - 1) out.push(i + n);
  if (x > 0) out.push(i - 1);
  return out;
};

/** Orbitals grown from the answer's cells, one per row's electron, at uneven speeds. */
function growRegions(n: number, answer: number[], rng: Rng, spread: number, cap: number): number[] {
  const reg: number[] = Array(n * n).fill(-1);
  answer.forEach((c, r) => { reg[r * n + c] = r; });
  const speed = Array.from({ length: n }, () => 0.15 + 2 * Math.pow(rand(rng), spread));
  const size: number[] = Array(n).fill(1);
  let left = n * n - n;
  while (left > 0) {
    let pairs: [number, number][] = [];
    for (let i = 0; i < n * n; i++) {
      if (reg[i] >= 0) continue;
      for (const j of side(n, i)) if (reg[j] >= 0) pairs.push([i, reg[j]]);
    }
    // Orbitals at their cap stop growing, unless nothing else can take the cell.
    const open = pairs.filter((p) => size[p[1]] < cap);
    if (open.length) pairs = open;
    const total = pairs.reduce((a, p) => a + speed[p[1]], 0);
    let r = rand(rng) * total;
    let pickPair = pairs[pairs.length - 1];
    for (const p of pairs) { r -= speed[p[1]]; if (r < 0) { pickPair = p; break; } }
    reg[pickPair[0]] = pickPair[1];
    size[pickPair[1]]++;
    left--;
  }
  return reg;
}

/** Whether an orbital stays in one piece without cell i. */
function connectedWithout(n: number, reg: number[], i: number): boolean {
  const g = reg[i];
  const cells: number[] = [];
  for (let j = 0; j < n * n; j++) if (reg[j] === g && j !== i) cells.push(j);
  if (!cells.length) return false;
  const seen = new Set<number>([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const c = stack.pop()!;
    for (const j of side(n, c)) if (j !== i && reg[j] === g && !seen.has(j)) { seen.add(j); stack.push(j); }
  }
  return seen.size === cells.length;
}

/**
 * Reshapes the orbitals until the answer is the only one: a cell where another answer differs
 * passes to a neighboring orbital, kept when the count of answers does not grow.
 */
function makeUnique(n: number, reg: number[], answer: number[], rng: Rng, cap: number): boolean {
  const count = (g: number) => reg.reduce((a, r) => a + (r === g ? 1 : 0), 0);
  const seeds = new Set(answer.map((c, r) => r * n + c));
  const LIMIT = 6;
  let sols = solutions(n, reg, LIMIT);
  for (let iter = 0; iter < 3 * n && sols.length > 1; iter++) {
    // Every way to break one of the other answers: a cell it uses and the answer does not,
    // handed to a neighboring orbital. Take the first that leaves fewer answers, or else the
    // one that leaves the fewest.
    const moves: [number, number][] = [];
    const seenMove = new Set<number>();
    for (const alt of sols) {
      alt.forEach((c, r) => {
        const i = r * n + c;
        if (c === answer[r] || seeds.has(i) || seenMove.has(i)) return;
        seenMove.add(i);
        if (!connectedWithout(n, reg, i)) return;
        for (const j of side(n, i)) if (reg[j] !== reg[i] && count(reg[j]) < cap && !moves.some(([a, b]) => a === i && b === reg[j])) moves.push([i, reg[j]]);
      });
      if (moves.length >= 24) break;
    }
    // Too few: add random moves along the orbitals' borders, to shake the shapes loose.
    for (let tries = 0; moves.length < 8 && tries < 80; tries++) {
      const i = randInt(rng, n * n);
      if (seeds.has(i)) continue;
      const nb = side(n, i).filter((j) => reg[j] !== reg[i]);
      if (!nb.length || !connectedWithout(n, reg, i)) continue;
      const g = reg[nb[randInt(rng, nb.length)]];
      if (count(g) >= cap) continue;
      if (!moves.some(([a, b]) => a === i && b === g)) moves.push([i, g]);
    }
    if (!moves.length) return false;
    let best: number[][] | null = null, bestMove: [number, number] = moves[0];
    const offset = randInt(rng, moves.length);
    for (let m = 0; m < moves.length; m++) {
      const [i, g] = moves[(m + offset) % moves.length];
      const was = reg[i];
      reg[i] = g;
      const next = solutions(n, reg, LIMIT);
      reg[i] = was;
      if (!best || next.length < best.length) { best = next; bestMove = [i, g]; if (next.length < sols.length) break; }
    }
    reg[bestMove[0]] = bestMove[1];
    sols = best!;
  }
  return sols.length === 1;
}

/** Renumbers the orbitals in reading order of their first cell, so colors spread evenly. */
function renumber(n: number, reg: number[]): number[] {
  const map = new Map<number, number>();
  for (const g of reg) if (!map.has(g)) map.set(g, map.size);
  return reg.map((g) => map.get(g)!);
}

/** One candidate deal, or null when the orbitals would not come out unique or human-solvable. */
function candidate(n: number, spread: number, rng: Rng): { regions: number[]; answer: number[]; score: number } | null {
  const answer = randomAnswer(n, rng);
  // No orbital grows past a cap, so small boards stay balanced; big boards allow more.
  const cap = Math.round(n * (n <= 7 ? 2 : n <= 9 ? 2.6 : 3.4));
  const reg = growRegions(n, answer, rng, spread, cap);
  if (!makeUnique(n, reg, answer, rng, cap)) return null;
  const regions = renumber(n, reg);
  const score = rate(n, regions);
  if (score < 0) return null;
  return { regions, answer, score };
}

/**
 * Deals a board for dial d: a few unique, human-solvable deals for the size, and of those the
 * one whose rating sits where the dial asks (the easiest at the bottom of a size band, the
 * hardest at its top).
 */
export function newSolo(d: number, seed: number): SoloState {
  const rng = seeded(seed * 7919 + 17);
  const { size: n, level, pool, spread } = soloShape(d);
  const found: { regions: number[]; answer: number[]; score: number }[] = [];
  for (let tries = 0; found.length < pool && tries < pool * 12; tries++) {
    const c = candidate(n, spread, rng);
    if (c) found.push(c);
  }
  // A last resort that always ends: keep trying until one comes.
  while (!found.length) { const c = candidate(n, spread, rng); if (c) found.push(c); }
  found.sort((a, b) => a.score - b.score);
  const pick = found[Math.round(level * (found.length - 1))];
  return {
    size: n,
    regions: pick.regions,
    cells: Array(n * n).fill(0),
    solution: pick.answer,
    moves: 0,
    par: n,
    score: pick.score,
  };
}



