// Emit: light the grid with photon emitters.
//
// A grid of open cells and walls; some walls carry a number, 0 to 4. Place lamps on open cells.
// Each lamp lights its own cell and shines along its row and its column until a wall stops it.
// Light every open cell; no lamp may sit in another lamp's light; a numbered wall has exactly that
// many lamps on the cells beside it (not corners). Each board has exactly one answer, which a chain
// of deductions reaches.
//
// Game rule, not physics: real lamps shine every way, and two beams pass through each other.
//
// The solver keeps, for each open cell, lamp / no lamp / unknown, and narrows it with rules of
// rising depth:
//   0  a lamp's light holds no other lamp; a numbered wall with all its lamps has no more, and one
//      with only as many free sides as lamps still owed fills them; a dark cell that only one
//      spot can still light gets a lamp there;
//   1  a spot whose lamp would leave some dark cell with nothing able to light it, or a numbered
//      wall short of lamps, stays empty;
//   2  a step of lookahead: a choice that runs, by the depth 0 rules, into a contradiction is out.
// A board the solver finishes this way has exactly one answer, and its depth is how hard it is.

import { rand, randInt, seeded, type Rng } from './rng';

/** An open cell. Walls are -1 (plain) or their number, 0 to 4. */
export const OPEN = -2;
export const WALL = -1;

/** A player's mark on an open cell. */
export const NONE = 0, LAMP = 1, CROSS = 2;

export interface EmitState {
  size: number;
  /** Per cell: OPEN, WALL, or a numbered wall's number. Shared between copies; never changed. */
  walls: number[];
  /** Per cell: NONE, LAMP or CROSS (open cells only). */
  marks: number[];
  /** The one answer: a lamp on these cells. */
  solution: boolean[];
  /** Lamps placed. */
  moves: number;
  /** Lamps in the answer. */
  par: number;
  /** The deepest rule the solver needed, and its lookahead steps. */
  depth: number;
  looks: number;
}

export interface EmitShape {
  size: number;
  /** Share of cells that are walls. */
  walls: number;
  /** Share of walls that keep their number, at most. */
  numbered: number;
  maxDepth: number;
  wantDepth: number;
  tries: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Board parameters for the difficulty dial d, 1 to 100. */
export function emitShape(d: number): EmitShape {
  const t = (clamp(Math.round(d), 1, 100) - 1) / 99;
  return {
    size: Math.round(6 + 4 * t),
    walls: 0.22 - 0.05 * t,
    numbered: 1 - 0.6 * t,
    maxDepth: d <= 20 ? 0 : d <= 45 ? 1 : 2,
    wantDepth: d <= 25 ? 0 : d <= 60 ? 1 : 2,
    tries: d <= 60 ? 3 : 6,
  };
}

// ---- sight lines ---------------------------------------------------------------------------

export interface Sight {
  n: number;
  /** For each open cell, the open cells it sees along its row and column (not itself). */
  sees: number[][];
  /** For each cell, its up to four neighbors across sides. */
  nb: number[][];
  open: number[];
}

const sightCache = new WeakMap<number[], Sight>();

/** Sight lines for a board's walls (cached per walls array). */
export function sight(n: number, walls: number[]): Sight {
  const hit = sightCache.get(walls);
  if (hit) return hit;
  const sees: number[][] = Array.from({ length: n * n }, () => []);
  const nb: number[][] = Array.from({ length: n * n }, () => []);
  const open: number[] = [];
  for (let c = 0; c < n * n; c++) {
    const x = c % n, y = Math.floor(c / n);
    if (y > 0) nb[c].push(c - n);
    if (x < n - 1) nb[c].push(c + 1);
    if (y < n - 1) nb[c].push(c + n);
    if (x > 0) nb[c].push(c - 1);
    if (walls[c] !== OPEN) continue;
    open.push(c);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      let xx = x + dx, yy = y + dy;
      while (xx >= 0 && yy >= 0 && xx < n && yy < n && walls[yy * n + xx] === OPEN) { sees[c].push(yy * n + xx); xx += dx; yy += dy; }
    }
  }
  const out = { n, sees, nb, open };
  sightCache.set(walls, out);
  return out;
}

/** The cells one lamp's light runs over, ray by ray (up, right, down, left), nearest first. */
export function rays(n: number, walls: number[], c: number): number[][] {
  const x = c % n, y = Math.floor(c / n);
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => {
    const out: number[] = [];
    let xx = x + dx, yy = y + dy;
    while (xx >= 0 && yy >= 0 && xx < n && yy < n && walls[yy * n + xx] === OPEN) { out.push(yy * n + xx); xx += dx; yy += dy; }
    return out;
  });
}

// ---- the rules on a board in play ---------------------------------------------------------

/** How many lamps light each cell (a lamp lights its own cell). */
export function light(s: EmitState): Uint8Array {
  const { sees } = sight(s.size, s.walls);
  const out = new Uint8Array(s.walls.length);
  for (let c = 0; c < s.marks.length; c++) {
    if (s.marks[c] !== LAMP) continue;
    out[c]++;
    for (const d of sees[c]) out[d]++;
  }
  return out;
}

/** Lamps that sit in another lamp's light. */
export function clashes(s: EmitState): Set<number> {
  const { sees } = sight(s.size, s.walls);
  const out = new Set<number>();
  for (let c = 0; c < s.marks.length; c++) {
    if (s.marks[c] !== LAMP) continue;
    if (sees[c].some((d) => s.marks[d] === LAMP)) out.add(c);
  }
  return out;
}

/** Lamps beside a wall. */
export function lampsBeside(s: EmitState, w: number): number {
  const { nb } = sight(s.size, s.walls);
  return nb[w].filter((c) => s.marks[c] === LAMP).length;
}

/** Numbered walls with too many lamps beside them. */
export function overfull(s: EmitState): number[] {
  const out: number[] = [];
  s.walls.forEach((v, w) => { if (v >= 0 && lampsBeside(s, w) > v) out.push(w); });
  return out;
}

export function solved(s: EmitState): boolean {
  const lit = light(s);
  for (let c = 0; c < s.walls.length; c++) {
    if (s.walls[c] === OPEN) { if (!lit[c]) return false; }
    else if (s.walls[c] >= 0 && lampsBeside(s, c) !== s.walls[c]) return false;
  }
  return clashes(s).size === 0;
}

export function cloneEmit(s: EmitState): EmitState {
  return { ...s, marks: s.marks.slice() };
}

/** A tap: empty to lamp, lamp to a cross, cross to empty. Null on a wall. */
export function tap(s: EmitState, c: number): EmitState | null {
  if (s.walls[c] !== OPEN) return null;
  return setMark(s, c, (s.marks[c] + 1) % 3);
}

/** Sets an open cell's mark. Placing a lamp is a move; crosses are free. Null when nothing changes. */
export function setMark(s: EmitState, c: number, m: number): EmitState | null {
  if (s.walls[c] !== OPEN || s.marks[c] === m) return null;
  const next = cloneEmit(s);
  next.marks[c] = m;
  if (m === LAMP) next.moves++;
  return next;
}

/** Sets several cells' marks at once (a drag), as one step. Null when nothing changes. */
export function setMarks(s: EmitState, cells: number[], m: number): EmitState | null {
  const next = cloneEmit(s);
  let changed = false;
  for (const c of cells) {
    if (s.walls[c] !== OPEN || next.marks[c] === m) continue;
    next.marks[c] = m;
    if (m === LAMP) next.moves++;
    changed = true;
  }
  return changed ? next : null;
}

/** A mark against the answer: a lamp where none goes, or a cross where one does. -1 when none. */
export function firstWrong(s: EmitState): number {
  for (let c = 0; c < s.marks.length; c++) {
    if (s.marks[c] === LAMP && !s.solution[c]) return c;
    if (s.marks[c] === CROSS && s.solution[c]) return c;
  }
  return -1;
}

// ---- the solver ----------------------------------------------------------------------------

/** What a rule decided about a cell, for hints. */
export interface Step {
  depth: number;
  cell: number;
  lamp: boolean;
  /** 'needs' (a wall fills its free sides), 'only' (the one spot left to light a cell), 'full'
   *  (a wall has its lamps), 'lit' (in a lamp's light), 'darken' (would leave a cell unlightable),
   *  'starve' (would leave a wall short), 'look' (lookahead). */
  rule: 'needs' | 'only' | 'full' | 'lit' | 'darken' | 'starve' | 'look';
  /** The wall or the dark cell the rule turned on. */
  about?: number;
}

type Watch = (step: Step) => boolean;
class Halt extends Error {}

const U = 0, L = 1, X = 2;

interface Net {
  n: number;
  walls: number[];
  sight: Sight;
  /** Numbered walls and their open neighbors. */
  clues: { w: number; k: number; cells: number[] }[];
}

function netOf(n: number, walls: number[]): Net {
  const sg = sight(n, walls);
  const clues: Net['clues'] = [];
  walls.forEach((v, w) => { if (v >= 0) clues.push({ w, k: v, cells: sg.nb[w].filter((c) => walls[c] === OPEN) }); });
  return { n, walls, sight: sg, clues };
}

/** Puts a lamp on c and darkens every spot it lights. False on a contradiction. */
function place(net: Net, st: Int8Array, c: number, step: Step, watch?: Watch): boolean {
  if (st[c] === X) return false;
  if (st[c] === L) return true;
  st[c] = L;
  for (const d of net.sight.sees[c]) {
    if (st[d] === L) return false;
    st[d] = X;
  }
  if (watch?.(step)) throw new Halt();
  return true;
}

function forbid(st: Int8Array, c: number, step: Step, watch?: Watch): boolean {
  if (st[c] === L) return false;
  if (st[c] === X) return true;
  st[c] = X;
  if (watch?.(step)) throw new Halt();
  return true;
}

/** Whether cell c is in some lamp's light. */
function isLit(net: Net, st: Int8Array, c: number): boolean {
  if (st[c] === L) return true;
  for (const d of net.sight.sees[c]) if (st[d] === L) return true;
  return false;
}

/** Depth 0 to a fixpoint. False on a contradiction. */
function basics(net: Net, st: Int8Array, watch?: Watch): boolean {
  const { sees, open } = net.sight;
  let changed = true;
  while (changed) {
    changed = false;
    for (const { w, k, cells } of net.clues) {
      let l = 0;
      const free: number[] = [];
      for (const c of cells) { if (st[c] === L) l++; else if (st[c] === U) free.push(c); }
      if (l > k || l + free.length < k) return false;
      if (!free.length) continue;
      if (l === k) {
        for (const c of free) if (!forbid(st, c, { depth: 0, cell: c, lamp: false, rule: 'full', about: w }, watch)) return false;
        changed = true;
      } else if (l + free.length === k) {
        for (const c of free) if (!place(net, st, c, { depth: 0, cell: c, lamp: true, rule: 'needs', about: w }, watch)) return false;
        changed = true;
      }
    }
    for (const c of open) {
      if (isLit(net, st, c)) continue;
      let only = -1, count = 0;
      if (st[c] === U) { only = c; count++; }
      for (const d of sees[c]) if (st[d] === U) { only = d; count++; if (count > 1) break; }
      if (count === 0) return false;
      if (count === 1) {
        if (!place(net, st, only, { depth: 0, cell: only, lamp: true, rule: 'only', about: c }, watch)) return false;
        changed = true;
      }
    }
  }
  return true;
}

/** Depth 1, one narrowing: 1 when it found one, 0 when none. */
function lookOne(net: Net, st: Int8Array, watch?: Watch): number {
  const { sees, open } = net.sight;
  // The dark cells, each with the spots that could still light it.
  const dark: { u: number; spots: number[] }[] = [];
  for (const u of open) {
    if (isLit(net, st, u)) continue;
    const spots: number[] = [];
    if (st[u] === U) spots.push(u);
    for (const d of sees[u]) if (st[d] === U) spots.push(d);
    dark.push({ u, spots });
  }
  const mark = new Int32Array(st.length);
  let stamp = 0;
  for (const c of open) {
    if (st[c] !== U) continue;
    stamp++;
    // What a lamp on c would light, and so darken for other lamps (c itself included).
    mark[c] = stamp;
    for (const d of sees[c]) mark[d] = stamp;
    // A dark cell it does not light, whose every remaining spot it would take away.
    for (const { u, spots } of dark) {
      if (mark[u] === stamp) continue;
      if (spots.every((d) => mark[d] === stamp)) {
        forbid(st, c, { depth: 1, cell: c, lamp: false, rule: 'darken', about: u }, watch);
        return 1;
      }
    }
    // A numbered wall it would leave short.
    for (const { w, k, cells } of net.clues) {
      let l = 0, room = 0;
      for (const d of cells) {
        if (st[d] === L || d === c) l++;
        else if (st[d] === U && mark[d] !== stamp) room++;
      }
      if (l <= k && l + room < k) {
        forbid(st, c, { depth: 1, cell: c, lamp: false, rule: 'starve', about: w }, watch);
        return 1;
      }
    }
  }
  return 0;
}

function settle(net: Net, st: Int8Array, maxDepth: number, watch?: Watch, used?: { depth: number }): boolean {
  for (;;) {
    if (!basics(net, st, watch)) return false;
    if (maxDepth < 1) return true;
    if (!lookOne(net, st, watch)) return true;
    if (used) used.depth = Math.max(used.depth, 1);
  }
}

export interface Grade { solved: boolean; ok: boolean; depth: number; looks: number; st: Int8Array }

function run(net: Net, st: Int8Array, maxDepth: number, watch?: Watch): Grade {
  const used = { depth: 0 };
  let looks = 0;
  let from = 0;
  const { open } = net.sight;
  const done = (): boolean => open.every((c) => st[c] !== U);
  for (;;) {
    if (!settle(net, st, maxDepth, watch, used)) return { solved: false, ok: false, depth: used.depth, looks, st };
    if (done()) return { solved: true, ok: true, depth: used.depth, looks, st };
    if (maxDepth < 2) return { solved: false, ok: true, depth: used.depth, looks, st };
    // Lookahead, settled by the basic rules only: quick, and as strong as deeper settling on
    // nearly every board.
    let hit = false;
    for (let j = 0; j < open.length && !hit; j++) {
      const c = open[(from + j) % open.length];
      if (st[c] !== U) continue;
      for (const lamp of [true, false]) {
        const trial = st.slice();
        const fine = lamp ? place(net, trial, c, { depth: 2, cell: c, lamp, rule: 'look' }) : forbid(trial, c, { depth: 2, cell: c, lamp, rule: 'look' });
        if (fine && settle(net, trial, 0)) continue;
        // That choice fails, so the other holds.
        hit = true;
        from = (from + j) % open.length;
        looks++;
        used.depth = 2;
        const step: Step = { depth: 2, cell: c, lamp: !lamp, rule: 'look' };
        const ok = lamp ? forbid(st, c, step, watch) : place(net, st, c, step, watch);
        if (!ok) return { solved: false, ok: false, depth: 2, looks, st };
        break;
      }
    }
    if (!hit) return { solved: false, ok: true, depth: used.depth, looks, st };
  }
}

/** How the solver fares on a board from scratch. */
export function grade(n: number, walls: number[], maxDepth = 2): Grade {
  const st = new Int8Array(n * n);
  for (let c = 0; c < st.length; c++) if (walls[c] !== OPEN) st[c] = X;
  return run(netOf(n, walls), st, maxDepth);
}

/** Counts answers up to `limit` by search (for checking the solver). */
export function countSolutions(n: number, walls: number[], limit = 2): number {
  const net = netOf(n, walls);
  let found = 0;
  const rec = (st: Int8Array): void => {
    if (found >= limit) return;
    if (!settle(net, st, 0)) return;
    const c = net.sight.open.find((q) => st[q] === U);
    if (c === undefined) { found++; return; }
    const a = st.slice();
    if (place(net, a, c, { depth: 0, cell: c, lamp: true, rule: 'look' })) rec(a);
    const b = st.slice();
    b[c] = X;
    rec(b);
  };
  const st = new Int8Array(n * n);
  for (let c = 0; c < st.length; c++) if (walls[c] !== OPEN) st[c] = X;
  rec(st);
  return found;
}

/**
 * The next deduction from the board as it stands (its marks taken as right so far): the first
 * lamp the rules place, or the first spot a deeper rule rules out. Null when nothing follows.
 */
export function nextForced(s: EmitState): Step | null {
  const net = netOf(s.size, s.walls);
  const st = new Int8Array(s.walls.length);
  for (let c = 0; c < st.length; c++) if (s.walls[c] !== OPEN) st[c] = X;
  for (let c = 0; c < st.length; c++) {
    if (s.marks[c] === LAMP && !place(net, st, c, { depth: 0, cell: c, lamp: true, rule: 'look' })) return null;
  }
  for (let c = 0; c < st.length; c++) if (s.marks[c] === CROSS && st[c] === U) st[c] = X;
  let hit: Step | null = null;
  const watch: Watch = (step) => {
    if (step.lamp ? s.marks[step.cell] !== LAMP : step.depth >= 1 && s.marks[step.cell] !== CROSS) { hit = step; return true; }
    return false;
  };
  try {
    run(net, st, 2, watch);
  } catch (e) {
    if (!(e instanceof Halt)) throw e;
  }
  return hit;
}

// ---- dealing ------------------------------------------------------------------------------

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Lamps on dark cells, in a random order, until every open cell is lit. */
function lightUp(n: number, walls: number[], lamps: boolean[], rng: Rng): void {
  const { sees, open } = sight(n, walls);
  const lit = new Uint8Array(n * n);
  for (const c of open) if (lamps[c]) { lit[c] = 1; for (const d of sees[c]) lit[d] = 1; }
  for (const c of shuffle(open.slice(), rng)) {
    if (lit[c]) continue;
    lamps[c] = true;
    lit[c] = 1;
    for (const d of sees[c]) lit[d] = 1;
  }
}

function number(n: number, walls: number[], lamps: boolean[]): number[] {
  const { nb } = sight(n, walls);
  return walls.map((v, w) => (v === OPEN ? OPEN : nb[w].filter((c) => lamps[c]).length));
}

interface Candidate { walls: number[]; lamps: boolean[]; depth: number; looks: number; share: number }

/**
 * One board: walls laid in a half-turn pattern, lamps put on dark cells at random until all is
 * lit, and every wall numbered. While the solver cannot finish it, a cell it is unsure of (and no
 * lamp) becomes a wall, the light is mended, and the walls are numbered again. Then numbers are
 * taken off, in a random order, while the solver can still finish it, down to the share asked.
 */
function attempt(sh: EmitShape, rng: Rng): Candidate | null {
  const n = sh.size;
  let walls: number[] = Array(n * n).fill(OPEN);
  for (let i = 0; i < n * n; i++) {
    const j = n * n - 1 - i;
    if (j < i) break;
    if (rand(rng) < sh.walls) { walls[i] = WALL; walls[j] = WALL; }
  }
  const lamps: boolean[] = Array(n * n).fill(false);
  lightUp(n, walls, lamps, rng);
  walls = number(n, walls, lamps);
  let g = grade(n, walls, sh.maxDepth);
  for (let fix = 0; !g.solved && fix < 12; fix++) {
    const unsure = sight(n, walls).open.filter((c) => g.st[c] === U && !lamps[c]);
    if (!unsure.length) return null;
    const c = unsure[randInt(rng, unsure.length)];
    const plain = walls.map((v) => (v === OPEN ? OPEN : WALL));
    plain[c] = WALL;
    lightUp(n, plain, lamps, rng);
    walls = number(n, plain, lamps);
    g = grade(n, walls, sh.maxDepth);
  }
  if (!g.solved) return null;
  // Take numbers off.
  const numbered = walls.map((v, w) => (v >= 0 ? w : -1)).filter((w) => w >= 0);
  const total = walls.filter((v) => v !== OPEN).length;
  let have = numbered.length;
  const keep = Math.ceil(total * sh.numbered);
  for (const w of shuffle(numbered, rng)) {
    if (have <= keep) break;
    const v = walls[w];
    walls[w] = WALL;
    const t = grade(n, walls, sh.maxDepth);
    if (t.solved) { have--; g = t; } else walls[w] = v;
  }
  return { walls, lamps, depth: g.depth, looks: g.looks, share: total ? have / total : 0 };
}

/** Deals a board for dial d: a few boards are made, and the one that best matches the dial is
 *  kept. Every board the solver finishes has one answer. */
export function newEmit(d: number, seed: number): EmitState {
  const rng = seeded(seed);
  const sh = emitShape(d);
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < 80 && (i < sh.tries || !best); i++) {
    const c = attempt(sh, rng);
    if (!c) continue;
    const score = Math.abs(c.depth - sh.wantDepth) * 100 - (sh.wantDepth >= 2 ? Math.min(c.looks, 6) : 0) + Math.round(Math.max(0, c.share - sh.numbered) * 20);
    if (score < bestScore) { best = c; bestScore = score; }
    if (score <= (sh.wantDepth >= 2 ? -2 : 0)) break;
  }
  if (!best) throw new Error('Emit: no board');
  const lamps = best.lamps;
  return {
    size: sh.size,
    walls: best.walls,
    marks: best.walls.map(() => NONE),
    solution: lamps,
    moves: 0,
    par: lamps.filter(Boolean).length,
    depth: best.depth,
    looks: best.looks,
  };
}
