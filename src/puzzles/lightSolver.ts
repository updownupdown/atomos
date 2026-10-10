// Lumen's generator and solver: a fast numeric copy of the beam rules in light.ts, an exhaustive
// search by number of placements, and the level generator that keeps only boards with exactly one
// answer. Measured in the redesign study (puzzle-distribution/lumen-study.md).
//
// Cells are small numbers here: 0 empty, 1 blocker, 2 and 3 a mirror / and \, 4 and 5 a splitter
// / and \, 6 to 9 a filter of hue 1 to 4 (s, p, d, f). Directions: 0 up, 1 right, 2 down, 3 left.
// A placement is cell * 16 + code.

import { rand, randInt, seeded, type Rng } from './rng';

export const EMPTY = 0, BLOCK = 1, M_SL = 2, M_BS = 3, S_SL = 4, S_BS = 5;
export const filterCode = (h: number): number => 5 + h;
export const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const SL = [1, 0, 3, 2];
const BS = [3, 2, 1, 0];

export interface NTarget { cell: number; hue: number }
export interface NBoard {
  size: number;
  /** The fixed board: blockers, fixed mirrors and filters. */
  cells: Int8Array;
  entry: number;
  entryDir: number;
  /** hue 0 takes any light. */
  targets: NTarget[];
  darks: number[];
  tray: { mirrors: number; splitters: number };
  /** Cells a tray piece may go on. */
  placeable: number[];
  /** The layout the level was built from. */
  intended: number[];
}

/** Traces the light; afterwards `mask(i)` holds a bit per hue (bit 0 white) reaching cell i. */
export class Tracer {
  private lit: Uint8Array;
  private litStamp: Uint32Array;
  private seen: Uint32Array;
  private q: Int32Array;
  readonly litList: Int32Array;
  litCount = 0;
  private stamp = 0;

  constructor(private readonly size: number) {
    const n = size * size;
    this.lit = new Uint8Array(n);
    this.litStamp = new Uint32Array(n);
    this.seen = new Uint32Array(n * 20);
    this.q = new Int32Array(n * 20 + 8);
    this.litList = new Int32Array(n);
  }

  trace(cells: Int8Array, entry: number, entryDir: number): void {
    const s = ++this.stamp, size = this.size;
    this.litCount = 0;
    let head = 0, tail = 0;
    this.q[tail++] = (entry * 4 + entryDir) * 5;
    while (head < tail) {
      const key = this.q[head++];
      if (this.seen[key] === s) continue;
      this.seen[key] = s;
      const hue = key % 5, cd = (key - hue) / 5, dir = cd & 3, i = cd >> 2;
      const c = cells[i];
      if (c === BLOCK) continue;
      if (this.litStamp[i] !== s) { this.litStamp[i] = s; this.lit[i] = 0; this.litList[this.litCount++] = i; }
      this.lit[i] |= 1 << hue;
      let o1 = -1, o2 = -1, oh = hue;
      if (c >= 6) { const f = c - 5; if (hue !== 0 && hue !== f) continue; oh = f; o1 = dir; }
      else if (c === S_SL) { o1 = dir; o2 = SL[dir]; }
      else if (c === S_BS) { o1 = dir; o2 = BS[dir]; }
      else if (c === M_SL) o1 = SL[dir];
      else if (c === M_BS) o1 = BS[dir];
      else o1 = dir;
      const x = i % size, y = (i - x) / size;
      for (const o of [o1, o2]) {
        if (o < 0) continue;
        const nx = x + DX[o], ny = y + DY[o];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (tail >= this.q.length) { const q = new Int32Array(this.q.length * 2); q.set(this.q); this.q = q; }
        this.q[tail++] = ((ny * size + nx) * 4 + o) * 5 + oh;
      }
    }
  }

  mask(i: number): number { return this.litStamp[i] === this.stamp ? this.lit[i] : 0; }

  won(b: Pick<NBoard, 'targets' | 'darks'>): boolean {
    for (const t of b.targets) { const m = this.mask(t.cell); if (t.hue === 0 ? !m : !(m & (1 << t.hue))) return false; }
    for (const d of b.darks) if (this.mask(d)) return false;
    return true;
  }
}

export function applyPlacements(cells: Int8Array, ps: number[], into: Int8Array = new Int8Array(cells.length)): Int8Array {
  into.set(cells);
  for (const p of ps) into[p >> 4] = p & 15;
  return into;
}

const sorted = (ps: number[]): string => [...ps].sort((a, b) => a - b).join(',');

export interface Solve {
  /** Fewest placements that light every ring, or null. */
  par: number | null;
  /** Winning layouts found, smallest first. */
  solutions: number[][];
  /** The node budget ran out before the search finished. */
  capped: boolean;
}

/**
 * Exhaustive search by number of placements. Only layouts where every placed piece is lit are
 * kept: a piece the light never reaches changes nothing, and any winning layout can be built one
 * piece at a time on lit cells. With `stopOnAlt`, returns at the first winning layout that is not
 * the level's own.
 */
export function solve(b: NBoard, o: { stopOnAlt?: boolean; nodeCap?: number } = {}): Solve {
  const tr = new Tracer(b.size);
  const k = b.tray.mirrors + b.tray.splitters;
  const placeable = new Uint8Array(b.cells.length);
  for (const i of b.placeable) placeable[i] = 1;
  const own = sorted(b.intended);
  const nodeCap = o.nodeCap ?? 2e6;
  const cells = new Int8Array(b.cells.length);
  const solutions: number[][] = [];
  let layer: number[][] = [[]];
  let par: number | null = null, nodes = 0;
  for (let d = 0; d <= k && layer.length; d++) {
    const next: number[][] = [];
    const seen = new Set<string>();
    for (const ps of layer) {
      nodes++;
      applyPlacements(b.cells, ps, cells);
      tr.trace(cells, b.entry, b.entryDir);
      if (ps.some((p) => !tr.mask(p >> 4))) continue;
      if (tr.won(b)) {
        if (par === null) par = d;
        solutions.push(ps);
        if (o.stopOnAlt && sorted(ps) !== own) return { par, solutions, capped: false };
      }
      if (d === k) continue;
      let m = 0, s = 0;
      for (const p of ps) { const c = p & 15; if (c === M_SL || c === M_BS) m++; else s++; }
      const codes: number[] = [];
      if (m < b.tray.mirrors) codes.push(M_SL, M_BS);
      if (s < b.tray.splitters) codes.push(S_SL, S_BS);
      const taken = new Set(ps.map((p) => p >> 4));
      for (let li = 0; li < tr.litCount; li++) {
        const i = tr.litList[li];
        if (!placeable[i] || taken.has(i)) continue;
        for (const code of codes) {
          const np = [...ps, i * 16 + code].sort((a, c) => a - c);
          const key = np.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(np);
        }
      }
      if (nodes + next.length > nodeCap) return { par, solutions, capped: true };
    }
    layer = next;
  }
  return { par, solutions, capped: false };
}

// ---- generation ------------------------------------------------------------------

/** One step of the difficulty ladder. */
export interface Cfg {
  size: number;
  mirrors: number;
  splitters: number;
  /** Fixed mirrors along the solution's path (part of the board). */
  fixed: number;
  /** Fixed mirrors off the path, as scenery. */
  decoys: number;
  /** Color filters fixed on cells the white light crosses. */
  filters: number;
  targets: number;
  /** Of the targets, how many need a color. */
  colored: number;
  darksInit: number;
  darksMax: number;
  blockers: [number, number];
  blockersMax: number;
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Walks a solved beam out piece by piece, picks rings that only the tray pieces light, adds dark
 * sensors where a wrong slant or a missing piece would send light, then takes the tray pieces
 * off. While another layout also solves it, a dark sensor (up to the cap) or a blocker goes on a
 * cell only that other layout lights. Returns null when no attempt makes a level with exactly one
 * answer whose fewest placements is the whole tray.
 */
export function generate(cfg: Cfg, seed: number, attempts = 80): NBoard | null {
  const rng = seeded(seed);
  const size = cfg.size, n = size * size;
  const tr = new Tracer(size);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const level = attemptOnce(cfg, rng, tr, size, n);
    if (level) return level;
  }
  return null;
}

function attemptOnce(cfg: Cfg, rng: Rng, tr: Tracer, size: number, n: number): NBoard | null {
  const cells = new Int8Array(n);
  const side = randInt(rng, 4), e = randInt(rng, size);
  const entry = side === 0 ? e : side === 1 ? (size - 1) * size + e : side === 2 ? e * size : e * size + size - 1;
  const entryDir = side === 0 ? 2 : side === 1 ? 0 : side === 2 ? 1 : 3;
  const roles: string[] = [];
  for (let i = 0; i < cfg.mirrors; i++) roles.push('M');
  for (let i = 0; i < cfg.fixed; i++) roles.push('X');
  for (let i = 0; i < cfg.splitters; i++) roles.push('S');
  shuffle(rng, roles);
  const hues = shuffle(rng, [1, 2, 3, 4]);
  let hueIdx = 0;
  const onPath = new Set<number>([entry]);
  const intended: number[] = [];
  let x = entry % size, y = Math.floor(entry / size), dir = entryDir;
  for (const role of roles) {
    const steps = 1 + randInt(rng, size - 1);
    let moved = 0;
    for (; moved < steps; moved++) {
      const nx = x + DX[dir], ny = y + DY[dir];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size || onPath.has(ny * size + nx)) break;
      x = nx; y = ny; onPath.add(y * size + x);
    }
    if (!moved) return null;
    const i = y * size + x;
    const free = (d: number) => { const nx = x + DX[d], ny = y + DY[d]; return nx >= 0 && ny >= 0 && nx < size && ny < size && !onPath.has(ny * size + nx); };
    let chosen = -1, nd = -1;
    for (const s of shuffle(rng, [0, 1])) {
      const r = s === 0 ? SL[dir] : BS[dir];
      if (role === 'S') {
        const outs = shuffle(rng, [r, dir]).filter(free);
        if (outs.length) { chosen = s; nd = outs[0]; break; }
      } else if (free(r)) { chosen = s; nd = r; break; }
    }
    if (chosen < 0) return null;
    if (role === 'M') intended.push(i * 16 + (chosen === 0 ? M_SL : M_BS));
    else if (role === 'S') intended.push(i * 16 + (chosen === 0 ? S_SL : S_BS));
    else cells[i] = chosen === 0 ? M_SL : M_BS;
    dir = nd;
  }
  // The main beam's tail, past the last piece: a blocker may cut it, but not right away.
  const tail: number[] = [];
  for (let tx = x + DX[dir], ty = y + DY[dir]; tx >= 0 && ty >= 0 && tx < size && ty < size; tx += DX[dir], ty += DY[dir]) {
    const i = ty * size + tx;
    if (onPath.has(i)) break;
    tail.push(i);
  }
  const pieceCells = new Set(intended.map((p) => p >> 4));
  const keep = new Set(tail.slice(0, 1));
  const put = (code: number): boolean => {
    for (let k = 0; k < 20; k++) {
      const i = randInt(rng, n);
      if (cells[i] === EMPTY && !onPath.has(i) && !keep.has(i) && !pieceCells.has(i)) { cells[i] = code; return true; }
    }
    return false;
  };
  let blockers = 0;
  for (let k = cfg.blockers[0] + randInt(rng, cfg.blockers[1] - cfg.blockers[0] + 1); k > 0; k--) if (put(BLOCK)) blockers++;
  for (let k = 0; k < cfg.decoys; k++) put(rand(rng) < 0.5 ? M_SL : M_BS);
  let full = applyPlacements(cells, intended);
  for (let f = 0; f < cfg.filters; f++) {
    tr.trace(full, entry, entryDir);
    const spots: number[] = [];
    for (let li = 0; li < tr.litCount; li++) { const i = tr.litList[li]; if (i !== entry && full[i] === EMPTY && tr.mask(i) === 1) spots.push(i); }
    if (!spots.length) return null;
    cells[spots[randInt(rng, spots.length)]] = filterCode(hues[hueIdx++ % 4]);
    full = applyPlacements(cells, intended);
  }
  tr.trace(full, entry, entryDir);
  if (intended.some((p) => !tr.mask(p >> 4))) return null;
  const solLit = new Map<number, number>();
  for (let li = 0; li < tr.litCount; li++) solLit.set(tr.litList[li], tr.mask(tr.litList[li]));
  // Rings go only where the bare board's light does not reach.
  tr.trace(cells, entry, entryDir);
  const cand: number[] = [];
  for (const [i] of solLit) if (i !== entry && cells[i] === EMPTY && !pieceCells.has(i) && !tr.mask(i)) cand.push(i);
  if (cand.length < cfg.targets) return null;
  shuffle(rng, cand);
  const targets: NTarget[] = [];
  const tinted = cand.filter((i) => (solLit.get(i)! & ~1) !== 0);
  if (tinted.length < cfg.colored) return null;
  for (const i of tinted.slice(0, cfg.colored)) {
    const hs = [1, 2, 3, 4].filter((h) => solLit.get(i)! & (1 << h));
    targets.push({ cell: i, hue: hs[randInt(rng, hs.length)] });
  }
  // The last lit cell of the main tail pins the whole path.
  const end = [...tail].reverse().find((i) => cand.includes(i));
  if (end !== undefined && !targets.some((t) => t.cell === end) && targets.length < cfg.targets) targets.push({ cell: end, hue: 0 });
  for (const i of cand) {
    if (targets.length >= cfg.targets) break;
    if (!targets.some((t) => t.cell === i)) targets.push({ cell: i, hue: 0 });
  }
  targets.sort((a, b) => a.cell - b.cell);
  const ringAt = new Set(targets.map((t) => t.cell));
  const darks: number[] = [];
  if (cfg.darksInit) {
    const tempting = new Set<number>();
    intended.forEach((p, j) => {
      const c = p & 15;
      const other = c === M_SL ? M_BS : c === M_BS ? M_SL : c === S_SL ? S_BS : S_SL;
      for (const alt of [other, -1]) {
        const ps = intended.filter((_, k) => k !== j);
        if (alt >= 0) ps.push((p >> 4) * 16 + alt);
        tr.trace(applyPlacements(cells, ps), entry, entryDir);
        for (let li = 0; li < tr.litCount; li++) tempting.add(tr.litList[li]);
      }
    });
    const spots = shuffle(rng, [...tempting].filter((i) => i !== entry && cells[i] === EMPTY && !solLit.has(i) && !ringAt.has(i)));
    darks.push(...spots.slice(0, cfg.darksInit));
  }
  const board: NBoard = {
    size, cells, entry, entryDir, targets, darks, intended,
    tray: { mirrors: cfg.mirrors, splitters: cfg.splitters }, placeable: [],
  };
  const refresh = () => {
    board.placeable = [];
    for (let i = 0; i < n; i++) if (cells[i] === EMPTY && i !== entry && !ringAt.has(i) && !board.darks.includes(i)) board.placeable.push(i);
  };
  refresh();
  const k = intended.length;
  for (let round = 0; round < 16; round++) {
    const r = solve(board, { stopOnAlt: true, nodeCap: 4e5 });
    if (r.capped) return null;
    const alt = r.solutions.find((s) => sorted(s) !== sorted(intended));
    if (!alt) {
      if (r.par !== k) return null;
      board.darks.sort((a, b) => a - b);
      return board;
    }
    // Shut the other answer out: a sensor or a blocker on a cell only it lights.
    tr.trace(applyPlacements(cells, alt), entry, entryDir);
    const spots: number[] = [];
    for (let li = 0; li < tr.litCount; li++) {
      const i = tr.litList[li];
      if (cells[i] === EMPTY && i !== entry && !ringAt.has(i) && !board.darks.includes(i) && !solLit.has(i)) spots.push(i);
    }
    if (!spots.length) return null;
    const i = spots[randInt(rng, spots.length)];
    if (board.darks.length < cfg.darksMax) board.darks.push(i);
    else if (blockers < cfg.blockersMax) { cells[i] = BLOCK; blockers++; }
    else return null;
    refresh();
  }
  return null;
}
