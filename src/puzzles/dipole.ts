// Dipole: a grid tiled with dominoes, each one a magnet or a blank.
//
// Every domino is either a magnet, with a + pole at one end and a − pole at the other, or a
// blank with no poles at all. The numbers round the edge say how many + poles and how many −
// poles each row and column holds (some are left out on harder boards), and two like poles never
// sit side by side, across a shared edge. Every deal has exactly one answer.
//
// Game rule, not physics: real magnets come with both poles, as here, but nothing stops two like
// poles touching except the push between them.

import { rand, randInt, seeded, type Rng } from './rng';

/** A domino's setting: 0 not yet set, 1 + at its first cell (left or top), 2 − at its first
 *  cell, 3 a blank. */
export type Setting = 0 | 1 | 2 | 3;

/** A pole in a cell: 0 none, 1 +, 2 −. */
export type Pole = 0 | 1 | 2;

export interface Domino {
  /** Its two cells, the first left of or above the second. */
  a: number;
  b: number;
}

export interface Clues {
  /** + and − counts for each row (top to bottom) and column (left to right); -1 when hidden. */
  rowPlus: number[];
  rowMinus: number[];
  colPlus: number[];
  colMinus: number[];
}

export interface DipoleState {
  cols: number;
  rows: number;
  dominoes: Domino[];
  /** The domino each cell belongs to. */
  owner: number[];
  /** Each domino's setting as the player has it. */
  set: Setting[];
  /** Dominoes dealt already set; they cannot change. */
  given: boolean[];
  clues: Clues;
  /** The one answer, every domino 1, 2 or 3. */
  solution: Setting[];
  /** Magnets placed: taps that leave a domino as a magnet (blanks are free notes). */
  moves: number;
  /** One tap per magnet not dealt, on its + end. */
  par: number;
}

/** Board size and how much is hidden, for the difficulty dial d (1 to 100). */
export function dipoleShape(d: number): { cols: number; rows: number; hide: number; givens: number; blanks: number; rounds: number } {
  const t = Math.min(1, Math.max(0, (d - 1) / 99));
  const sizes: [number, number][] = [[5, 6], [6, 6], [6, 7], [7, 8], [8, 8], [8, 9], [9, 10], [10, 10]];
  const cuts = [12, 24, 36, 50, 64, 78, 90];
  let k = 0;
  while (k < cuts.length && d > cuts[k]) k++;
  const [cols, rows] = sizes[k];
  // Share of the edge numbers taken away (only while the answer stays the only one).
  const hide = d <= 14 ? 0 : Math.min(0.6, 0.06 + 0.54 * ((d - 14) / 86));
  // A few magnets dealt in place on the first boards, to show how the numbers work.
  const givens = d <= 6 ? 3 : d <= 12 ? 2 : d <= 18 ? 1 : 0;
  // Share of blank dominoes: a touch more on bigger boards, where they make the numbers subtler.
  const blanks = 0.26 + 0.1 * t;
  // Rounds of one-step trials the deduction may need: none on the easiest boards, where the
  // numbers and neighbors settle everything directly, more and more toward Expert.
  const rounds = d <= 20 ? 0 : d <= 40 ? 1 : d <= 60 ? 2 : d <= 80 ? 4 : 99;
  return { cols, rows, hide, givens, blanks, rounds };
}

// ---- poles and rules ----------------------------------------------------------------------

/** The pole a setting puts in a domino's first (end 0) or second (end 1) cell. */
export function poleAt(v: Setting, end: 0 | 1): Pole {
  if (v === 1) return end === 0 ? 1 : 2;
  if (v === 2) return end === 0 ? 2 : 1;
  return 0;
}

/** The pole in a cell, as the board is set. */
export function cellPole(s: DipoleState, cell: number, set: Setting[] = s.set): Pole {
  const d = s.dominoes[s.owner[cell]];
  return poleAt(set[s.owner[cell]], d.a === cell ? 0 : 1);
}

export function neighbors(cols: number, rows: number, cell: number): number[] {
  const x = cell % cols, y = Math.floor(cell / cols);
  const out: number[] = [];
  if (y > 0) out.push(cell - cols);
  if (x < cols - 1) out.push(cell + 1);
  if (y < rows - 1) out.push(cell + cols);
  if (x > 0) out.push(cell - 1);
  return out;
}

/** How many + and − poles each row and column holds as set. */
export function counts(s: DipoleState, set: Setting[] = s.set): Clues {
  const rowPlus = Array(s.rows).fill(0), rowMinus = Array(s.rows).fill(0);
  const colPlus = Array(s.cols).fill(0), colMinus = Array(s.cols).fill(0);
  for (let c = 0; c < s.cols * s.rows; c++) {
    const p = cellPole(s, c, set);
    if (!p) continue;
    const x = c % s.cols, y = Math.floor(c / s.cols);
    if (p === 1) { rowPlus[y]++; colPlus[x]++; } else { rowMinus[y]++; colMinus[x]++; }
  }
  return { rowPlus, rowMinus, colPlus, colMinus };
}

/** Cells whose pole touches a like pole across an edge. */
export function clashes(s: DipoleState, set: Setting[] = s.set): Set<number> {
  const out = new Set<number>();
  for (let c = 0; c < s.cols * s.rows; c++) {
    const p = cellPole(s, c, set);
    if (!p) continue;
    const x = c % s.cols;
    if (x < s.cols - 1 && cellPole(s, c + 1, set) === p) { out.add(c); out.add(c + 1); }
    if (c + s.cols < s.cols * s.rows && cellPole(s, c + s.cols, set) === p) { out.add(c); out.add(c + s.cols); }
  }
  return out;
}

/** A line's state against its clue: 'open' still short, 'met' exactly, 'over' past it, or 'none'
 *  when the clue is hidden. */
export type LineState = 'open' | 'met' | 'over' | 'none';

export function lineState(clue: number, have: number): LineState {
  return clue < 0 ? 'none' : have === clue ? 'met' : have > clue ? 'over' : 'open';
}

/** Solved: unset dominoes count as blanks, every shown number is met and no like poles touch.
 *  With one answer, that board is the answer. */
export function solved(s: DipoleState): boolean {
  const k = counts(s);
  const ok = (clue: number[], have: number[]) => clue.every((v, i) => v < 0 || v === have[i]);
  return ok(s.clues.rowPlus, k.rowPlus) && ok(s.clues.rowMinus, k.rowMinus) && ok(s.clues.colPlus, k.colPlus)
    && ok(s.clues.colMinus, k.colMinus) && clashes(s).size === 0;
}

// ---- the solver ---------------------------------------------------------------------------
//
// Each domino keeps a set of settings it may still take (bit 1: + first, bit 2: − first, bit 4:
// blank). Propagation narrows the sets until nothing changes: a row or column whose + (or −)
// count can only be met one way fixes the dominoes in it, and a settled magnet's poles strike
// the like pole out of every domino touching them. Then the search splits on the domino with
// fewest settings left.

const BIT: Record<1 | 2 | 3, number> = { 1: 1, 2: 2, 3: 4 };
const SETTINGS: (1 | 2 | 3)[] = [1, 2, 3];
const bits = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);

/** How many poles of kind p (1 +, 2 −, 0 either) a setting puts in a line, given which of its
 *  cells lie there (kind 0 both, 1 the first only, 2 the second only). */
function lineCount(v: 1 | 2 | 3, p: 0 | 1 | 2, kind: number): number {
  const is = (q: Pole) => (p === 0 ? q !== 0 : q === p);
  return (kind !== 2 && is(poleAt(v, 0)) ? 1 : 0) + (kind !== 1 && is(poleAt(v, 1)) ? 1 : 0);
}

/** Least and most poles of kind p a domino can add to a line, by kind and settings mask:
 *  index (p * 3 + kind) * 8 + mask. */
const LO = new Int8Array(72), HI = new Int8Array(72);
for (const p of [0, 1, 2] as const) for (let kind = 0; kind < 3; kind++) for (let m = 0; m < 8; m++) {
  let mn = 9, mx = -1;
  for (const v of SETTINGS) {
    if (!(m & BIT[v])) continue;
    const k = lineCount(v, p, kind);
    mn = Math.min(mn, k); mx = Math.max(mx, k);
  }
  const i = (p * 3 + kind) * 8 + m;
  LO[i] = mn; HI[i] = mx;
}

interface Geometry {
  dominoes: Domino[];
  owner: number[];
  /** For each line (rows, then columns): its dominoes and which of their cells lie in it. */
  lineD: number[][];
  lineKind: number[][];
  /** The lines each domino lies in. */
  dLines: number[][];
  /** Each line's clues by kind of pole: either (both numbers shown), + and −. */
  clue: [number[], number[], number[]];
  /** For each domino: [its end, a neighboring cell in another domino, that cell's domino, its end]. */
  touch: [0 | 1, number, number, 0 | 1][][];
}

function geometry(cols: number, rows: number, dominoes: Domino[], owner: number[], clues: Clues): Geometry {
  const L = rows + cols;
  const lineD: number[][] = Array.from({ length: L }, () => []);
  const lineKind: number[][] = Array.from({ length: L }, () => []);
  const dLines: number[][] = dominoes.map(() => []);
  const add = (l: number, d: number, kind: number) => { lineD[l].push(d); lineKind[l].push(kind); dLines[d].push(l); };
  dominoes.forEach((dm, d) => {
    const ay = Math.floor(dm.a / cols), ax = dm.a % cols, by = Math.floor(dm.b / cols), bx = dm.b % cols;
    if (ay === by) { add(ay, d, 0); add(rows + ax, d, 1); add(rows + bx, d, 2); }
    else { add(rows + ax, d, 0); add(ay, d, 1); add(by, d, 2); }
  });
  const touch = dominoes.map((dm, d) => {
    const out: [0 | 1, number, number, 0 | 1][] = [];
    for (const end of [0, 1] as const) {
      for (const o of neighbors(cols, rows, end ? dm.b : dm.a)) {
        const od = owner[o];
        if (od !== d) out.push([end, o, od, dominoes[od].a === o ? 0 : 1]);
      }
    }
    return out;
  });
  const plus = [...clues.rowPlus, ...clues.colPlus], minus = [...clues.rowMinus, ...clues.colMinus];
  const both = plus.map((v, i) => (v >= 0 && minus[i] >= 0 ? v + minus[i] : -1));
  return { dominoes, owner, lineD, lineKind, dLines, touch, clue: [both, plus, minus] };
}

/**
 * Narrows the domains in place, starting from the lines and dominoes given (all of them when
 * none are). False when some domino has nothing left.
 */
function propagate(g: Geometry, dom: Uint8Array, start: number[] | null = null): boolean {
  const nLines = g.lineD.length;
  const queued = new Uint8Array(nLines);
  const lines: number[] = [];
  const settled: number[] = [];
  const touchLines = (d: number) => { for (const l of g.dLines[d]) if (!queued[l]) { queued[l] = 1; lines.push(l); } };
  if (start) for (const d of start) { touchLines(d); if (dom[d] === 1 || dom[d] === 2) settled.push(d); }
  else {
    for (let l = 0; l < nLines; l++) { queued[l] = 1; lines.push(l); }
    for (let d = 0; d < dom.length; d++) if (dom[d] === 1 || dom[d] === 2) settled.push(d);
  }
  const narrow = (d: number, m: number): boolean => {
    if (m === dom[d]) return true;
    dom[d] = m;
    if (!m) return false;
    touchLines(d);
    if (m === 1 || m === 2) settled.push(d);
    return true;
  };
  while (lines.length || settled.length) {
    while (settled.length) {
      const d = settled.pop()!;
      const v = dom[d] === 1 ? 1 : 2;
      for (const [end, , od, oend] of g.touch[d]) {
        // Strike the setting of od that puts this end's pole in the touching cell.
        const p = poleAt(v, end);
        const bad = poleAt(1, oend) === p ? 1 : 2;
        if (dom[od] & bad && !narrow(od, dom[od] & ~bad)) return false;
      }
    }
    if (!lines.length) break;
    const l = lines.pop()!;
    queued[l] = 0;
    const ds = g.lineD[l], ks = g.lineKind[l];
    for (const p of [1, 2, 0] as const) {
      const clue = g.clue[p][l];
      if (clue < 0) continue;
      const base = p * 24;
      let lo = 0, hi = 0;
      for (let i = 0; i < ds.length; i++) { const j = base + ks[i] * 8 + dom[ds[i]]; lo += LO[j]; hi += HI[j]; }
      if (lo > clue || hi < clue) return false;
      if (lo === hi || (lo !== clue && hi !== clue)) continue;
      // Every domino here must take its least (or its most) poles of this kind.
      const atLo = lo === clue;
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i], m = dom[d], j = base + ks[i] * 8 + m;
        if (LO[j] === HI[j]) continue;
        const keep = atLo ? LO[j] : HI[j];
        let nm = 0;
        for (const v of SETTINGS) if (m & BIT[v] && lineCount(v, p, ks[i]) === keep) nm |= BIT[v];
        if (!narrow(d, nm)) return false;
      }
    }
  }
  return true;
}

/** Counts the answers (up to `limit`) given the clues and any settings fixed in `fixed`
 *  (0 means free). Returns -1 when the search runs past `budget` nodes. */
export function countSolutions(cols: number, rows: number, dominoes: Domino[], owner: number[], clues: Clues, fixed: Setting[], limit = 2, budget = 200_000, keep?: Setting[][]): number {
  const g = geometry(cols, rows, dominoes, owner, clues);
  const start = new Uint8Array(dominoes.length);
  for (let d = 0; d < dominoes.length; d++) start[d] = fixed[d] ? BIT[fixed[d] as 1 | 2 | 3] : 7;
  let found = 0, nodes = 0, over = false;
  const rec = (dom: Uint8Array, from: number[] | null): void => {
    if (over || found >= limit) return;
    if (++nodes > budget) { over = true; return; }
    if (!propagate(g, dom, from)) return;
    let pick = -1, best = 9;
    for (let d = 0; d < dom.length; d++) {
      const b = bits(dom[d]);
      if (b > 1 && b < best) { best = b; pick = d; if (b === 2) break; }
    }
    if (pick < 0) {
      found++;
      keep?.push(Array.from(dom, (m) => (m === 1 ? 1 : m === 2 ? 2 : 3) as Setting));
      return;
    }
    for (const v of SETTINGS) {
      if (!(dom[pick] & BIT[v])) continue;
      const next = dom.slice();
      next[pick] = BIT[v];
      rec(next, [pick]);
    }
  };
  rec(start, null);
  return over ? -1 : found;
}

/** The settings propagation alone pins down from the clues and the fixed settings: per domino
 *  a bit mask of what it may still be (1 + first, 2 − first, 4 blank); null on a contradiction. */
export function narrowed(s: DipoleState, fixed: Setting[]): Uint8Array | null {
  const g = geometry(s.cols, s.rows, s.dominoes, s.owner, s.clues);
  const dom = new Uint8Array(s.dominoes.length);
  for (let d = 0; d < dom.length; d++) dom[d] = fixed[d] ? BIT[fixed[d] as 1 | 2 | 3] : 7;
  return propagate(g, dom) ? dom : null;
}

/**
 * Propagation, then trying each setting left on each domino in turn: one that propagates to a
 * contradiction is struck out, and propagation runs again. Stops when no trial strikes anything.
 * Returns the domains (null on a contradiction) and how many trial rounds it took.
 */
function deduce(g: Geometry, dom: Uint8Array, maxRounds = 99): { dom: Uint8Array | null; rounds: number } {
  if (!propagate(g, dom)) return { dom: null, rounds: 0 };
  let rounds = 0;
  for (let again = true; again && rounds < maxRounds;) {
    again = false;
    for (let d = 0; d < dom.length; d++) {
      if (bits(dom[d]) < 2) continue;
      for (const v of SETTINGS) {
        if (!(dom[d] & BIT[v])) continue;
        const trial = dom.slice();
        trial[d] = BIT[v];
        if (propagate(g, trial, [d])) continue;
        dom[d] &= ~BIT[v];
        if (!propagate(g, dom, [d])) return { dom: null, rounds };
        again = true;
      }
    }
    if (again) rounds++;
  }
  return { dom, rounds };
}

/** Whether a board is settled by plain deduction (propagation and one-step trials), with no
 *  search; the rounds of trials it needs, or -1 when it is not. */
export function logicRounds(cols: number, rows: number, dominoes: Domino[], owner: number[], clues: Clues, fixed: Setting[], maxRounds = 99): number {
  const g = geometry(cols, rows, dominoes, owner, clues);
  const dom = new Uint8Array(dominoes.length);
  for (let d = 0; d < dom.length; d++) dom[d] = fixed[d] ? BIT[fixed[d] as 1 | 2 | 3] : 7;
  const r = deduce(g, dom, maxRounds);
  return r.dom && r.dom.every((m) => bits(m) === 1) ? r.rounds : -1;
}

/** The domains after one round of trials from the clues and fixed settings, for hints. */
export function probed(s: DipoleState, fixed: Setting[]): Uint8Array | null {
  const g = geometry(s.cols, s.rows, s.dominoes, s.owner, s.clues);
  const dom = new Uint8Array(s.dominoes.length);
  for (let d = 0; d < dom.length; d++) dom[d] = fixed[d] ? BIT[fixed[d] as 1 | 2 | 3] : 7;
  return deduce(g, dom, 1).dom;
}

// ---- dealing ------------------------------------------------------------------------------

/** A random tiling of the board by dominoes: plain columns (or rows) of them, then many random
 *  turns of two side-by-side dominoes in a 2 by 2 square, which reach every tiling. */
export function tiling(cols: number, rows: number, rng: Rng): { dominoes: Domino[]; owner: number[] } {
  const n = cols * rows;
  const mate = new Int32Array(n).fill(-1);
  // Start from plain columns of dominoes (or rows, when the height is odd).
  for (let c = 0; c < n; c++) {
    if (mate[c] >= 0) continue;
    const o = rows % 2 === 0 ? c + cols : c + 1;
    mate[c] = o; mate[o] = c;
  }
  for (let k = 0; k < n * 200; k++) {
    const x = randInt(rng, cols - 1), y = randInt(rng, rows - 1);
    const c = y * cols + x;
    // Two across in the square turn to two down, and back.
    if (mate[c] === c + 1 && mate[c + cols] === c + cols + 1) {
      mate[c] = c + cols; mate[c + cols] = c; mate[c + 1] = c + cols + 1; mate[c + cols + 1] = c + 1;
    } else if (mate[c] === c + cols && mate[c + 1] === c + cols + 1) {
      mate[c] = c + 1; mate[c + 1] = c; mate[c + cols] = c + cols + 1; mate[c + cols + 1] = c + cols;
    }
  }
  const dominoes: Domino[] = [];
  const owner: number[] = Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    if (owner[c] >= 0) continue;
    owner[c] = owner[mate[c]] = dominoes.length;
    dominoes.push({ a: Math.min(c, mate[c]), b: Math.max(c, mate[c]) });
  }
  return { dominoes, owner };
}

/** Random settings with no like poles touching: magnets laid one by one, each turned whichever
 *  way fits (or left blank when neither does, or by chance). */
export function assign(cols: number, rows: number, dominoes: Domino[], owner: number[], blanks: number, rng: Rng): Setting[] {
  const set: Setting[] = dominoes.map(() => 0);
  const order = dominoes.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const pole = (c: number): Pole => poleAt(set[owner[c]], dominoes[owner[c]].a === c ? 0 : 1);
  const fits = (d: number, v: 1 | 2): boolean => {
    const dm = dominoes[d];
    for (const end of [0, 1] as const) {
      const c = end ? dm.b : dm.a;
      const p = poleAt(v, end);
      for (const o of neighbors(cols, rows, c)) if (owner[o] !== d && pole(o) === p) return false;
    }
    return true;
  };
  for (const d of order) {
    if (rand(rng) < blanks) { set[d] = 3; continue; }
    const first: 1 | 2 = rand(rng) < 0.5 ? 1 : 2;
    const second: 1 | 2 = first === 1 ? 2 : 1;
    set[d] = fits(d, first) ? first : fits(d, second) ? second : 3;
  }
  return set;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}

/**
 * Deals a board for dial d: a random tiling, random magnets that never touch like to like, and
 * every edge number read off them. The layout is kept only when plain deduction (see
 * logicRounds) settles every domino from the numbers, within the rounds of trials the dial
 * allows, so a board never needs a guess and so has exactly one answer. Then numbers are taken
 * away one at a time while that still holds, up to the share the dial asks for.
 */
export function newDipole(d: number, seed: number): DipoleState {
  const rng = seeded(seed);
  const shape = dipoleShape(d);
  const { cols, rows, rounds } = shape;
  let deal: { dominoes: Domino[]; owner: number[]; solution: Setting[]; clues: Clues; fixed: Setting[] } | null = null;
  for (let attempt = 0; !deal; attempt++) {
    const { dominoes, owner } = tiling(cols, rows, rng);
    const solution = assign(cols, rows, dominoes, owner, shape.blanks, rng);
    const clues = counts({ cols, rows, dominoes, owner } as DipoleState, solution);
    const fixed: Setting[] = dominoes.map(() => 0);
    // Starter magnets on the easiest boards.
    const magnets = shuffle(dominoes.map((_, i) => i).filter((i) => solution[i] !== 3), rng);
    for (let k = 0; k < shape.givens; k++) fixed[magnets[k]] = solution[magnets[k]];
    // After many tries, allow more trial rounds rather than deal nothing.
    const allowed = attempt < 12 ? rounds : 99;
    if (logicRounds(cols, rows, dominoes, owner, clues, fixed, allowed) >= 0) deal = { dominoes, owner, solution, clues, fixed };
  }
  const { dominoes, owner, solution, clues, fixed } = deal;
  // Take numbers away while deduction still settles the board.
  const total = 2 * (rows + cols);
  let hide = Math.round(total * shape.hide);
  const slots: [keyof Clues, number][] = [];
  for (let y = 0; y < rows; y++) slots.push(['rowPlus', y], ['rowMinus', y]);
  for (let x = 0; x < cols; x++) slots.push(['colPlus', x], ['colMinus', x]);
  shuffle(slots, rng);
  for (const [key, i] of slots) {
    if (hide <= 0) break;
    const v = clues[key][i];
    clues[key][i] = -1;
    if (logicRounds(cols, rows, dominoes, owner, clues, fixed, rounds) >= 0) hide--;
    else clues[key][i] = v;
  }
  const given = fixed.map((v) => v !== 0);
  const par = solution.filter((v, i) => v !== 3 && !given[i]).length;
  return { cols, rows, dominoes, owner, set: fixed.slice(), given, clues, solution, moves: 0, par };
}

export function cloneDipole(s: DipoleState): DipoleState {
  return { ...s, set: s.set.slice() };
}

// ---- moves --------------------------------------------------------------------------------

/** The settings a tap steps through, seen from the tapped end: + here, − here, blank, unset. */
export function cycle(s: DipoleState, cell: number): Setting[] {
  const d = s.dominoes[s.owner[cell]];
  return d.a === cell ? [0, 1, 2, 3] : [0, 2, 1, 3];
}

/** Tapping a cell: its domino steps to + at that end, then − at that end, then blank, then
 *  unset. Null for a dealt domino. */
export function tap(s: DipoleState, cell: number): DipoleState | null {
  const d = s.owner[cell];
  if (d < 0 || s.given[d]) return null;
  const order = cycle(s, cell);
  const next = order[(order.indexOf(s.set[d]) + 1) % order.length];
  return put(s, d, next);
}

/** Sets a domino straight to a setting (Show me). Null for a dealt domino or no change. */
export function put(s: DipoleState, d: number, v: Setting): DipoleState | null {
  if (s.given[d] || s.set[d] === v) return null;
  const next = cloneDipole(s);
  next.set[d] = v;
  if (v === 1 || v === 2) next.moves++;
  return next;
}

/** A domino set against the answer (a blank where a magnet goes, a magnet turned the wrong way
 *  or where a blank goes), or -1 when none is. */
export function firstWrong(s: DipoleState): number {
  for (let d = 0; d < s.set.length; d++) if (s.set[d] && s.set[d] !== s.solution[d]) return d;
  return -1;
}

/**
 * The next domino a solver would settle, and why, from what is set and right so far: first one
 * the numbers and neighbors settle directly, then one a single trial settles (each other way
 * breaks something), then one deeper deduction settles. Magnets come before blanks, which are
 * only notes. Null when every magnet is in.
 */
export function nextForced(s: DipoleState): { domino: number; setting: Setting; why: string } | null {
  const fixed = s.set.map((v, i) => (v && v === s.solution[i] ? v : 0) as Setting);
  const magnetsLeft = s.solution.some((v, d) => v !== 3 && !fixed[d]);
  if (!magnetsLeft) return null;
  const pick = (m: number): Setting => (m === 1 ? 1 : m === 2 ? 2 : 3);
  const stages: [Uint8Array | null, number][] = [];
  const direct = narrowed(s, fixed);
  stages.push([direct, 0]);
  const g = geometry(s.cols, s.rows, s.dominoes, s.owner, s.clues);
  const start = () => Uint8Array.from(fixed, (v) => (v ? BIT[v as 1 | 2 | 3] : 7));
  stages.push([deduce(g, start(), 1).dom, 1]);
  stages.push([deduce(g, start()).dom, 2]);
  for (const [dom, stage] of stages) {
    if (!dom) continue;
    let best: { domino: number; setting: Setting; why: string; rank: number } | null = null;
    for (let d = 0; d < dom.length; d++) {
      if (fixed[d] || bits(dom[d]) !== 1) continue;
      const v = pick(dom[d]);
      // A blank only when it is what makes a magnet's place clear: blanks are free notes.
      if (v === 3) continue;
      const r = stage === 0 ? reason(s, fixed, d, v)
        : stage === 1 ? { why: 'Try it each other way: every one breaks a number or puts like poles together.', rank: 5 }
          : { why: 'Follow each other way a few steps: each ends in a broken number.', rank: 6 };
      if (!best || r.rank < best.rank) best = { domino: d, setting: v, ...r };
    }
    if (best) return { domino: best.domino, setting: best.setting, why: best.why };
  }
  for (let d = 0; d < s.solution.length; d++) {
    if (!fixed[d] && s.solution[d] !== 3) return { domino: d, setting: s.solution[d], why: 'Try it each way round and see which one the numbers allow.' };
  }
  return null;
}

/** Why domino d must take magnet setting v, as plainly as can be said: a like pole beside it, or
 *  a line that needs it. A lower rank is plainer. */
function reason(s: DipoleState, fixed: Setting[], d: number, v: Setting): { why: string; rank: number } {
  const dm = s.dominoes[d];
  for (const end of [0, 1] as const) {
    const c = end ? dm.b : dm.a;
    for (const o of neighbors(s.cols, s.rows, c)) {
      if (s.owner[o] === d) continue;
      const p = cellPole(s, o, fixed);
      if (p && p === poleAt(v, 1 - end as 0 | 1)) return { why: `The ${p === 1 ? '+' : '−'} beside it sets which way round this magnet turns.`, rank: 1 };
    }
  }
  const across = Math.floor(dm.a / s.cols) === Math.floor(dm.b / s.cols);
  return { why: `Its ${across ? 'row' : 'column'} and the lines across it leave only this way.`, rank: 3 };
}
