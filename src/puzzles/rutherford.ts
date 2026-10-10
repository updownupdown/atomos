// Rutherford Probe: find the hidden nuclei in a sheet of foil.
//
// A square plate hides a scatter of nuclei. Probing a cell sends an alpha
// particle through it and reports what the cell detects: normally the number of
// nuclei in the eight cells around it. Two kinds of cell bend that rule. A
// scatter cell (drawn with outward ticks) counts every nucleus in its whole row
// and column instead. A quiet cell shows only "?" and gives no count. Probing a
// nucleus is a direct hit: it is shown and counted against a flawless run, but
// play goes on. Probe every empty cell to win; marks are only notes.
//
// Alpha beams, the experiment's own move: each rim of the plate has a port at
// the end of every row and column. A beam fired from a port runs along its
// line, opening every cell it crosses, and bounces straight back off the first
// nucleus in its way, which it reveals. A line with no nucleus it passes
// straight through. Each plate grants a few beams (its beam par); firing more is
// allowed but, like a direct hit, costs the flawless run.
//
// Every plate opens with a small region already probed and is checked by a
// constraint solver that finishes it from there without ever guessing: each
// step follows from a single clue (all of its unknowns safe, or all nuclei),
// from comparing two overlapping clues, or from the count of nuclei left. When
// those run dry it fires a beam, chosen only from what a player can see, never
// from where the nuclei really are. The beams it needed are the plate's par.
//
// Game rule, not physics: Rutherford's team found the nucleus from how alpha
// particles scattered off gold foil, not by probing a grid, and a real alpha
// particle is deflected by the electric force at every angle rather than only
// stopping head-on. The idea, mapping something unseen from what probes report,
// is his.

import { rand, randInt, seeded, type Rng } from './rng';

export type CellKind = 'plain' | 'scatter' | 'quiet';

export interface RutherfordState {
  size: number;
  nuclei: boolean[];
  /** What a safe cell reports once probed; nuclei are 'plain'. */
  kind: CellKind[];
  /** The count each safe cell reports (unused for quiet cells). */
  clue: number[];
  probed: boolean[];
  marked: boolean[];
  /** Nuclei revealed by a beam bouncing off them. */
  found: boolean[];
  /** Which rim ports have fired, 4 x size (see `portLine`). */
  fired: boolean[];
  /** Nuclei probed by mistake. */
  hits: number;
  /** Beams fired. */
  beams: number;
  /** Beams the plate grants: the solver's count. More spoils a flawless run. */
  beamPar: number;
  /** Actions taken: probes, chords and beams. */
  moves: number;
  total: number;
}

export function cloneRutherford(s: RutherfordState): RutherfordState {
  return { ...s, probed: [...s.probed], marked: [...s.marked], found: [...s.found], fired: [...s.fired] };
}

// ---- geometry ------------------------------------------------------------------------

export function neighbors(size: number, i: number): number[] {
  const r = Math.floor(i / size), c = i % size;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(rr * size + cc);
    }
  }
  return out;
}

/** Every other cell in the same row and column. */
export function cross(size: number, i: number): number[] {
  const r = Math.floor(i / size), c = i % size;
  const out: number[] = [];
  for (let k = 0; k < size; k++) {
    if (k !== c) out.push(r * size + k);
    if (k !== r) out.push(k * size + c);
  }
  return out;
}

/** The cells a probed cell's count covers. */
export function scope(s: Pick<RutherfordState, 'size' | 'kind'>, i: number): number[] {
  return s.kind[i] === 'scatter' ? cross(s.size, i) : neighbors(s.size, i);
}

/** Rim sides, clockwise from the top. A port's beam travels away from its side. */
export type Side = 0 | 1 | 2 | 3;

/**
 * Port p sits on side floor(p / size) at row or column k = p % size: top ports
 * fire down column k, right ports fire left along row k, bottom ports fire up
 * column k, left ports fire right along row k. Returns the cells in travel order.
 */
export function portLine(size: number, port: number): { side: Side; k: number; cells: number[] } {
  const side = Math.floor(port / size) as Side, k = port % size;
  const cells: number[] = [];
  for (let t = 0; t < size; t++) {
    if (side === 0) cells.push(t * size + k);
    else if (side === 1) cells.push(k * size + (size - 1 - t));
    else if (side === 2) cells.push((size - 1 - t) * size + k);
    else cells.push(k * size + t);
  }
  return { side, k, cells };
}

/** Where a beam goes: the cells it crosses, then the nucleus it bounces off (null if it passes through). */
export function traceBeam(s: Pick<RutherfordState, 'size' | 'nuclei'>, port: number): { path: number[]; stop: number | null } {
  const path: number[] = [];
  for (const i of portLine(s.size, port).cells) {
    if (s.nuclei[i]) return { path, stop: i };
    path.push(i);
  }
  return { path, stop: null };
}

// ---- rules ---------------------------------------------------------------------------

/** Probes a cell; a count of zero opens everything it covers, and so on. Null if nothing changes. */
export function probe(s: RutherfordState, i: number): RutherfordState | null {
  if (i < 0 || i >= s.nuclei.length || s.probed[i] || s.marked[i] || s.found[i]) return null;
  const next = cloneRutherford(s);
  next.moves = s.moves + 1;
  open(next, [i]);
  return next;
}

function open(s: RutherfordState, cells: number[]): void {
  const queue = [...cells];
  while (queue.length) {
    const i = queue.pop()!;
    if (s.probed[i]) continue;
    s.probed[i] = true;
    s.marked[i] = false;
    if (s.nuclei[i]) { s.hits++; continue; }
    if (s.kind[i] !== 'quiet' && s.clue[i] === 0) for (const j of scope(s, i)) if (!s.probed[j] && !s.marked[j]) queue.push(j);
  }
}

/** Fires the beam from a rim port: opens the cells it crosses and reveals the nucleus it bounces off. */
export function fire(s: RutherfordState, port: number): RutherfordState | null {
  if (port < 0 || port >= s.fired.length || s.fired[port]) return null;
  const next = cloneRutherford(s);
  next.fired[port] = true;
  next.beams = s.beams + 1;
  next.moves = s.moves + 1;
  reveal(next, port);
  return next;
}

function reveal(s: RutherfordState, port: number): void {
  const { path, stop } = traceBeam(s, port);
  // A beam crosses marked cells too: they are safe, so the mark goes.
  for (const i of path) s.marked[i] = false;
  open(s, path);
  if (stop !== null && !s.probed[stop]) {
    s.found[stop] = true;
    s.marked[stop] = false;
  }
}

export function toggleMark(s: RutherfordState, i: number): RutherfordState | null {
  if (i < 0 || i >= s.nuclei.length || s.probed[i] || s.found[i]) return null;
  const next = cloneRutherford(s);
  next.marked[i] = !s.marked[i];
  return next;
}

/** A nucleus the player already knows for sure: found by a beam or probed by mistake. */
function shown(s: RutherfordState, j: number): boolean {
  return s.found[j] || (s.probed[j] && s.nuclei[j]);
}

/**
 * On a probed cell whose count is already met by marks (and known nuclei),
 * probes everything else it covers. Null when the marks do not match the count.
 */
export function chord(s: RutherfordState, i: number): RutherfordState | null {
  if (!s.probed[i] || s.nuclei[i] || s.kind[i] === 'quiet') return null;
  const sc = scope(s, i);
  const known = sc.filter((j) => s.marked[j] || shown(s, j)).length;
  const rest = sc.filter((j) => !s.probed[j] && !s.marked[j] && !s.found[j]);
  if (known !== s.clue[i] || !rest.length) return null;
  const next = cloneRutherford(s);
  next.moves = s.moves + 1;
  open(next, rest);
  return next;
}

export function solved(s: RutherfordState): boolean {
  return s.nuclei.every((n, i) => n || s.probed[i]);
}

/** Nuclei not yet marked or found. */
export function remaining(s: RutherfordState): number {
  let n = s.total;
  for (let i = 0; i < s.nuclei.length; i++) if (s.marked[i] || shown(s, i)) n--;
  return n;
}

// ---- the no-guess solver ---------------------------------------------------------------

interface Constraint {
  cells: number[];
  need: number;
}

/**
 * Picks the beam a careful player would fire next, from what they can see:
 * the unfired port whose line crosses the most unknown cells before any known
 * nucleus, cells beside a count weighing double, each later cell discounted by
 * the chance the beam has already stopped. Never reads where the nuclei are.
 * `nucleus` is what the solver knows; -1 when no beam would tell anything.
 */
export function choosePort(s: RutherfordState, nucleus: boolean[]): number {
  const n = s.nuclei.length;
  let unknown = 0, known = 0;
  for (let j = 0; j < n; j++) {
    if (nucleus[j]) known++;
    else if (!s.probed[j]) unknown++;
  }
  if (!unknown) return -1;
  const p = Math.min(0.95, (s.total - known) / unknown);
  const besideCount = (j: number) => neighbors(s.size, j).some((k) => s.probed[k] && !s.nuclei[k] && s.kind[k] !== 'quiet');
  let best = -1, bestScore = 0;
  for (let port = 0; port < s.fired.length; port++) {
    if (s.fired[port]) continue;
    let reach = 1, score = 0;
    for (const j of portLine(s.size, port).cells) {
      if (nucleus[j]) break;
      if (s.probed[j]) continue;
      score += reach * (besideCount(j) ? 2 : 1);
      reach *= 1 - p;
    }
    if (score > bestScore + 1e-9) { best = port; bestScore = score; }
  }
  return best;
}

/**
 * Plays the plate by deduction alone from its current state, probing every
 * cell it can prove safe. Returns the state it reached; it is finished when
 * `solved` holds. Deductions: a clue whose unknowns must be all safe or all
 * nuclei; two overlapping clues compared; the total count of nuclei. With
 * `beams`, it fires a beam (see `choosePort`) whenever deduction stalls.
 */
export function deduce(start: RutherfordState, opts: { beams?: boolean } = {}): { state: RutherfordState; steps: number; beams: number } {
  const s = cloneRutherford(start);
  const n = s.nuclei.length;
  // The solver's own knowledge of nuclei: shown ones and nuclei it proved.
  const nucleus = s.nuclei.map((_, i) => shown(s, i));
  let steps = 0, beams = 0;
  for (;;) {
    if (solved(s)) break;
    const unknown = (j: number) => !s.probed[j] && !nucleus[j];
    const cons: Constraint[] = [];
    for (let i = 0; i < n; i++) {
      if (!s.probed[i] || s.nuclei[i] || s.kind[i] === 'quiet') continue;
      const sc = scope(s, i);
      const cells = sc.filter(unknown);
      if (!cells.length) continue;
      cons.push({ cells, need: s.clue[i] - sc.filter((j) => nucleus[j]).length });
    }
    const all: number[] = [];
    let found = 0;
    for (let j = 0; j < n; j++) { if (unknown(j)) all.push(j); if (nucleus[j]) found++; }
    cons.push({ cells: all, need: s.total - found });

    const safe = new Set<number>(), hot = new Set<number>();
    const judge = (cells: number[], lo: number, hi: number) => {
      if (!cells.length) return;
      if (hi <= 0) for (const j of cells) safe.add(j);
      else if (lo >= cells.length) for (const j of cells) hot.add(j);
    };
    for (const c of cons) judge(c.cells, c.need, c.need);
    if (!safe.size && !hot.size) {
      const inA = new Uint8Array(n);
      for (let a = 0; a < cons.length && !safe.size && !hot.size; a++) {
        const A = cons[a];
        for (const j of A.cells) inA[j] = 1;
        for (let b = 0; b < cons.length; b++) {
          if (a === b) continue;
          const B = cons[b];
          let both = 0;
          const bOnly: number[] = [];
          for (const j of B.cells) { if (inA[j]) both++; else bOnly.push(j); }
          if (!both) continue;
          const aOnly = A.cells.length - both;
          const maxI = Math.min(A.need, B.need, both);
          const minI = Math.max(0, A.need - aOnly, B.need - bOnly.length);
          judge(bOnly, B.need - maxI, B.need - minI);
          if (safe.size || hot.size) break;
        }
        for (const j of A.cells) inA[j] = 0;
      }
    }
    if (!safe.size && !hot.size) {
      if (!opts.beams) break;
      const port = choosePort(s, nucleus);
      if (port < 0) break;
      s.fired[port] = true;
      s.beams++;
      reveal(s, port);
      for (let j = 0; j < n; j++) if (s.found[j]) nucleus[j] = true;
      beams++;
      steps++;
      continue;
    }
    for (const j of hot) nucleus[j] = true;
    if (safe.size) open(s, [...safe]);
    steps++;
  }
  return { state: s, steps, beams };
}

// ---- generation ----------------------------------------------------------------------

export interface PlateSpec {
  size: number;
  nuclei: number;
  /** Shares of the safe cells that are scatter and quiet cells. */
  scatter: number;
  quiet: number;
  /** The beam par the generator aims for, and the most it accepts. */
  beams: number;
  maxBeams: number;
}

export function specFor(z: number): PlateSpec {
  const t = Math.max(0, Math.min(1, (z - 1) / 117));
  const size = z <= 20 ? 7 : z <= 50 ? 8 : z <= 85 ? 9 : 10;
  const density = 0.15 + 0.05 * t;
  const beams = z <= 50 ? 2 : 3;
  return { size, nuclei: Math.round(size * size * density), scatter: 0.06 + 0.06 * t, quiet: 0.04 + 0.06 * t, beams, maxBeams: beams + 1 };
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deal(rng: Rng, spec: PlateSpec): RutherfordState {
  const { size } = spec;
  const n = size * size;
  // The opening probe sits away from the rim and has no nucleus around it.
  const start = (1 + randInt(rng, size - 2)) * size + 1 + randInt(rng, size - 2);
  const clear = new Set([start, ...neighbors(size, start)]);
  const nuclei = Array(n).fill(false);
  for (const i of shuffle(rng, Array.from({ length: n }, (_, k) => k)).filter((i) => !clear.has(i)).slice(0, spec.nuclei)) nuclei[i] = true;
  const kind: CellKind[] = Array(n).fill('plain');
  for (let i = 0; i < n; i++) {
    if (nuclei[i] || i === start) continue;
    const r = rand(rng);
    if (r < spec.scatter) kind[i] = 'scatter';
    else if (r < spec.scatter + spec.quiet && !clear.has(i)) kind[i] = 'quiet';
  }
  const base = { size, kind };
  const clue = nuclei.map((_, i) => scope(base, i).filter((j) => nuclei[j]).length);
  const blank = (): RutherfordState => ({
    size, nuclei, kind, clue,
    probed: Array(n).fill(false), marked: Array(n).fill(false), found: Array(n).fill(false), fired: Array(4 * size).fill(false),
    hits: 0, beams: 0, beamPar: 0, moves: 0, total: spec.nuclei,
  });
  // Open from whichever empty-around cell gives the smallest opening, so the
  // plate starts small and the beams have work to do.
  let best: RutherfordState | null = null, bestOpen = Infinity;
  for (let i = 0; i < n; i++) {
    if (nuclei[i] || kind[i] !== 'plain' || clue[i] !== 0) continue;
    const r = Math.floor(i / size), c = i % size;
    if (r === 0 || c === 0 || r === size - 1 || c === size - 1) continue;
    const st = blank();
    open(st, [i]);
    const opened = st.probed.filter(Boolean).length;
    if (opened < bestOpen || (opened === bestOpen && i === start)) { best = st; bestOpen = opened; }
  }
  return best!;
}

export function newRutherford(z: number, seed: number): RutherfordState {
  const rng = seeded(seed);
  const spec = specFor(z);
  // Among deals the solver finishes with beams, but not without, keep the one
  // whose beam count is closest to the aim, then the one with the smallest opening.
  let best: { state: RutherfordState; score: number } | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = deal(rng, spec);
    const run = deduce(state, { beams: true });
    if (!solved(run.state) || run.beams < 1 || run.beams > spec.maxBeams) continue;
    const opened = state.probed.filter(Boolean).length / state.nuclei.length;
    const score = Math.abs(run.beams - spec.beams) + opened;
    if (!best || score < best.score) best = { state: { ...state, beamPar: run.beams }, score };
    if (run.beams === spec.beams && opened < 0.25) break;
  }
  if (best) return best.state;
  // No clean deal: open one more safe cell wherever the solver stalls until it
  // finishes within the beams allowed.
  const state = deal(rng, spec);
  for (;;) {
    const run = deduce(state, { beams: true });
    if (solved(run.state) && run.beams <= spec.maxBeams) return { ...state, beamPar: run.beams };
    const end = deduce(state).state;
    const frontier: number[] = [];
    const pool0: number[] = [];
    for (let i = 0; i < state.nuclei.length; i++) {
      if (state.nuclei[i] || end.probed[i]) continue;
      pool0.push(i);
      if (neighbors(state.size, i).some((j) => end.probed[j])) frontier.push(i);
    }
    const pool = frontier.length ? frontier : pool0;
    open(state, [pool[randInt(rng, pool.length)]]);
  }
}
