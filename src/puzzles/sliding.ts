// Sliding Block: clear the way for the key piece.
//
// Bars slide only along their own length (Rush Hour). The red key bar sits on
// the exit row; slide the others out of its way until it can leave through the
// gap in the right wall. One move is one piece sliding any distance. Heavier
// elements add fixed wall cells that never move and small free blocks that
// slide any of the four ways.
//
// Levels are generated the way designed Rush Hour sets are: deal a random
// board, walk its whole state space breadth first, then measure every state's
// distance from the nearest solved one and start from the farthest. A small
// hill climb nudges the deal (add, drop or shift a piece) to push that distance
// toward the element's target. Everything is bounded by a state budget, so a
// level is dealt in a few tens of milliseconds and the same seed always deals
// the same board.

import { rand, randInt, seeded, type Rng } from './rng';

export interface Block {
  id: number;
  x: number;
  y: number;
  len: number;
  /** A bar's axis; ignored for a free block. */
  horiz: boolean;
  /** A 1x1 free block, which slides any of the four ways. */
  free: boolean;
}

export interface SlidingState {
  w: number;
  h: number;
  /** The row the key block (id 0) travels on; the exit is at its right end. */
  exitRow: number;
  /** Fixed wall cells, as row-major indices. Nothing moves through them. */
  walls: number[];
  blocks: Block[];
  moves: number;
  /** The fewest moves that free the key bar, from the solver. */
  par: number;
}

/** One piece sliding: exactly one of dx, dy is non-zero. */
export interface SlideMove {
  id: number;
  dx: number;
  dy: number;
}

export interface Reach { left: number; right: number; up: number; down: number }

function occupied(s: SlidingState, skip = -1): Uint8Array {
  const grid = new Uint8Array(s.w * s.h);
  for (const i of s.walls) grid[i] = 1;
  for (const b of s.blocks) {
    if (b.id === skip) continue;
    for (const c of cellsOf(b)) grid[c.y * s.w + c.x] = 1;
  }
  return grid;
}

/** The cells a block covers. */
export function cellsOf(b: Block): { x: number; y: number }[] {
  const out = [];
  const n = b.free ? 1 : b.len;
  for (let i = 0; i < n; i++) out.push(b.free || b.horiz ? { x: b.x + i, y: b.y } : { x: b.x, y: b.y + i });
  return out;
}

/** How far a block can slide each way without hitting anything (0 off its axis). */
export function reach(s: SlidingState, id: number): Reach {
  const b = s.blocks.find((x) => x.id === id)!;
  const grid = occupied(s, id);
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h && !grid[y * s.w + x];
  const r: Reach = { left: 0, right: 0, up: 0, down: 0 };
  const w = !b.free && b.horiz ? b.len : 1;
  const h = !b.free && !b.horiz ? b.len : 1;
  if (b.free || b.horiz) {
    while (free(b.x - r.left - 1, b.y)) r.left++;
    while (free(b.x + w + r.right, b.y)) r.right++;
  }
  if (b.free || !b.horiz) {
    while (free(b.x, b.y - r.up - 1)) r.up++;
    while (free(b.x, b.y + h + r.down)) r.down++;
  }
  return r;
}

export function applySlide(s: SlidingState, m: SlideMove): SlidingState | null {
  if ((m.dx === 0) === (m.dy === 0)) return null;
  const b = s.blocks.find((x) => x.id === m.id);
  if (!b) return null;
  if (!b.free && (b.horiz ? m.dy !== 0 : m.dx !== 0)) return null;
  const r = reach(s, m.id);
  if (m.dx < -r.left || m.dx > r.right || m.dy < -r.up || m.dy > r.down) return null;
  const blocks = s.blocks.map((q) => (q.id === m.id ? { ...q, x: q.x + m.dx, y: q.y + m.dy } : q));
  return { ...s, blocks, moves: s.moves + 1 };
}

/** The key bar touches the right wall at the exit gap. */
export function solved(s: SlidingState): boolean {
  const key = s.blocks[0];
  return key.x + key.len >= s.w;
}

// ---- the state-space engine ------------------------------------------------------
//
// A board's shape is fixed (walls, each bar's row or column and length); a
// state is just each piece's position along its axis (a cell index for a free
// block). Positions combine into one integer key, so a slide changes the key by
// a single multiply-add.

interface Shape {
  w: number;
  h: number;
  exitRow: number;
  wall: Uint8Array;
  /** Per piece: length (1 for free), horizontal, free, and the fixed row or column of a bar. */
  len: number[];
  horiz: boolean[];
  free: boolean[];
  fix: number[];
}

interface Space {
  count: number;
  /** count * pieces positions, one state after another. */
  pos: Int8Array;
  /** Distance of each state from the nearest solved state. */
  dist: Int16Array;
  maxDist: number;
}

function mults(sh: Shape): number[] {
  const out: number[] = [];
  let m = 1;
  for (let i = 0; i < sh.len.length; i++) {
    out.push(m);
    m *= sh.free[i] ? sh.w * sh.h : (sh.horiz[i] ? sh.w : sh.h) - sh.len[i] + 1;
  }
  return out;
}

function keyOf(p: ArrayLike<number>, mult: number[]): number {
  let k = 0;
  for (let i = 0; i < mult.length; i++) k += p[i] * mult[i];
  return k;
}

/** Marks a state's pieces on a copy of the wall grid. */
function paint(sh: Shape, p: ArrayLike<number>, occ: Uint8Array): void {
  occ.set(sh.wall);
  const w = sh.w;
  for (let i = 0; i < sh.len.length; i++) {
    if (sh.free[i]) occ[p[i]] = 1;
    else if (sh.horiz[i]) for (let k = 0; k < sh.len[i]; k++) occ[sh.fix[i] * w + p[i] + k] = 1;
    else for (let k = 0; k < sh.len[i]; k++) occ[(p[i] + k) * w + sh.fix[i]] = 1;
  }
}

const MAX_MOVES = 256;

/** Lists every single move out of a state as (piece, new position) pairs; returns how many. */
function listMoves(sh: Shape, p: ArrayLike<number>, occ: Uint8Array, mi: Int32Array, mp: Int32Array): number {
  const { w, h } = sh;
  paint(sh, p, occ);
  let m = 0;
  for (let i = 0; i < sh.len.length; i++) {
    const at = p[i], L = sh.len[i];
    if (sh.free[i]) {
      const x = at % w, y = (at - x) / w;
      for (let nx = x - 1; nx >= 0 && !occ[y * w + nx]; nx--) { mi[m] = i; mp[m++] = y * w + nx; }
      for (let nx = x + 1; nx < w && !occ[y * w + nx]; nx++) { mi[m] = i; mp[m++] = y * w + nx; }
      for (let ny = y - 1; ny >= 0 && !occ[ny * w + x]; ny--) { mi[m] = i; mp[m++] = ny * w + x; }
      for (let ny = y + 1; ny < h && !occ[ny * w + x]; ny++) { mi[m] = i; mp[m++] = ny * w + x; }
    } else if (sh.horiz[i]) {
      const row = sh.fix[i] * w;
      for (let nx = at - 1; nx >= 0 && !occ[row + nx]; nx--) { mi[m] = i; mp[m++] = nx; }
      for (let e = at + L; e < w && !occ[row + e]; e++) { mi[m] = i; mp[m++] = e - L + 1; }
    } else {
      const col = sh.fix[i];
      for (let ny = at - 1; ny >= 0 && !occ[ny * w + col]; ny--) { mi[m] = i; mp[m++] = ny; }
      for (let e = at + L; e < h && !occ[e * w + col]; e++) { mi[m] = i; mp[m++] = e - L + 1; }
    }
  }
  return m;
}

const moveI = new Int32Array(MAX_MOVES);
const moveP = new Int32Array(MAX_MOVES);

// Work buffers and an open-addressing table from state key to state index,
// reused between walks. A Space returned by explore() views them, so keep a copy.
let posBuf = new Int8Array(0);
let firstBuf = new Int32Array(0);
let edgeBuf = new Int32Array(1 << 16);
let tableKeys = new Float64Array(0);
let tableVals = new Int32Array(0);

function tableReset(cap: number): number {
  let size = 1024;
  while (size < cap * 2) size *= 2;
  if (tableKeys.length !== size) {
    tableKeys = new Float64Array(size);
    tableVals = new Int32Array(size);
  }
  tableKeys.fill(-1);
  return size - 1;
}

function slot(key: number, mask: number): number {
  let h = Math.imul((key >>> 0) ^ Math.imul((key / 4294967296) | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 15;
  let i = h & mask;
  while (tableKeys[i] !== -1 && tableKeys[i] !== key) i = (i + 1) & mask;
  return i;
}

/**
 * Walks every state reachable from `start` and measures each one's distance
 * from the nearest solved state. Null when the space outgrows `cap` or holds
 * no solved state.
 */
function explore(sh: Shape, start: ArrayLike<number>, cap: number): Space | null {
  const n = sh.len.length;
  const mult = mults(sh);
  const mask = tableReset(cap);
  if (posBuf.length < cap * n) posBuf = new Int8Array(cap * n);
  if (firstBuf.length < cap + 1) firstBuf = new Int32Array(cap + 1);
  const pos = posBuf, first = firstBuf;
  let edges = edgeBuf;
  let edgeCount = 0;
  let count = 1;
  for (let i = 0; i < n; i++) pos[i] = start[i];
  const k0 = keyOf(start, mult);
  const s0 = slot(k0, mask);
  tableKeys[s0] = k0;
  tableVals[s0] = 0;
  const occ = new Uint8Array(sh.w * sh.h);
  const cur = new Int8Array(n);
  let overflow = false;
  for (let s = 0; s < count && !overflow; s++) {
    first[s] = edgeCount;
    for (let i = 0; i < n; i++) cur[i] = pos[s * n + i];
    const base = keyOf(cur, mult);
    const moves = listMoves(sh, cur, occ, moveI, moveP);
    if (edgeCount + moves > edges.length) {
      const grown = new Int32Array(Math.max(edges.length * 2, edgeCount + moves));
      grown.set(edges);
      edges = edgeBuf = grown;
    }
    for (let m = 0; m < moves; m++) {
      const i = moveI[m], np = moveP[m];
      const key = base + (np - cur[i]) * mult[i];
      let h = Math.imul((key >>> 0) ^ Math.imul((key / 4294967296) | 0, 0x9e3779b1), 0x85ebca6b);
      h ^= h >>> 15;
      let at = h & mask;
      while (tableKeys[at] !== -1 && tableKeys[at] !== key) at = (at + 1) & mask;
      let j: number;
      if (tableKeys[at] === key) j = tableVals[at];
      else {
        if (count >= cap) { overflow = true; break; }
        j = count++;
        tableKeys[at] = key;
        tableVals[at] = j;
        const o = j * n;
        for (let q = 0; q < n; q++) pos[o + q] = cur[q];
        pos[o + i] = np;
      }
      edges[edgeCount++] = j;
    }
  }
  if (overflow) return null;
  first[count] = edgeCount;

  // Moves are reversible, so distance to the solved set is a plain multi-source BFS.
  const dist = new Int16Array(count).fill(-1);
  const queue = new Int32Array(count);
  let qn = 0;
  const goalX = sh.w - sh.len[0];
  for (let s = 0; s < count; s++) {
    if (pos[s * n] === goalX) { dist[s] = 0; queue[qn++] = s; }
  }
  if (!qn) return null;
  let maxDist = 0;
  for (let qi = 0; qi < qn; qi++) {
    const s = queue[qi];
    for (let e = first[s]; e < first[s + 1]; e++) {
      const t = edges[e];
      if (dist[t] >= 0) continue;
      dist[t] = dist[s] + 1;
      if (dist[t] > maxDist) maxDist = dist[t];
      queue[qn++] = t;
    }
  }
  return { count, pos: pos.subarray(0, count * n), dist, maxDist };
}

function shapeOf(s: SlidingState): { sh: Shape; p: number[] } {
  const wall = new Uint8Array(s.w * s.h);
  for (const i of s.walls) wall[i] = 1;
  const sh: Shape = { w: s.w, h: s.h, exitRow: s.exitRow, wall, len: [], horiz: [], free: [], fix: [] };
  const p: number[] = [];
  for (const b of s.blocks) {
    sh.len.push(b.free ? 1 : b.len);
    sh.horiz.push(b.horiz);
    sh.free.push(b.free);
    sh.fix.push(b.free ? 0 : b.horiz ? b.y : b.x);
    p.push(b.free ? b.y * s.w + b.x : b.horiz ? b.x : b.y);
  }
  return { sh, p };
}

function blocksOf(sh: Shape, p: ArrayLike<number>): Block[] {
  return sh.len.map((len, id) => {
    if (sh.free[id]) return { id, x: p[id] % sh.w, y: Math.floor(p[id] / sh.w), len: 1, horiz: true, free: true };
    return sh.horiz[id]
      ? { id, x: p[id], y: sh.fix[id], len, horiz: true, free: false }
      : { id, x: sh.fix[id], y: p[id], len, horiz: false, free: false };
  });
}

/** Breadth-first search from a state; the fewest moves to free the key bar, or null. */
export function solveSliding(s: SlidingState, limit = 200000): number | null {
  if (solved(s)) return 0;
  const { sh, p } = shapeOf(s);
  const mult = mults(sh);
  const seen = new Set<number>([keyOf(p, mult)]);
  let frontier: Int8Array[] = [Int8Array.from(p)];
  const occ = new Uint8Array(sh.w * sh.h);
  const goalX = sh.w - sh.len[0];
  for (let depth = 1; frontier.length && seen.size < limit; depth++) {
    const next: Int8Array[] = [];
    let found = false;
    for (const cur of frontier) {
      const base = keyOf(cur, mult);
      const moves = listMoves(sh, cur, occ, moveI, moveP);
      for (let m = 0; m < moves; m++) {
        const i = moveI[m], np = moveP[m];
        const key = base + (np - cur[i]) * mult[i];
        if (seen.has(key)) continue;
        seen.add(key);
        const q = Int8Array.from(cur);
        q[i] = np;
        if (q[0] === goalX) found = true;
        next.push(q);
      }
      if (found) return depth;
    }
    frontier = next;
  }
  return null;
}

// ---- generation -----------------------------------------------------------------

export interface SlidingPlan {
  w: number;
  h: number;
  exitRow: number;
  /** The par the generator aims for. */
  target: number;
  /** Bars besides the key. */
  bars: number;
  walls: number;
  frees: number;
  /** Chance a bar is three long. */
  long: number;
  /** Which bank of deep boards seeds the level, or null to deal from scratch. */
  bank: keyof typeof BANK | null;
}

/** How a level scales with the element: par from 4 at cobalt to 21 at the end of the table. */
export function slidingPlan(z: number): SlidingPlan {
  const t = Math.max(0, Math.min(1, (z - 27) / 91));
  const tall = z >= 106;
  return {
    w: 6,
    h: tall ? 7 : 6,
    exitRow: tall ? 3 : 2,
    target: Math.round(4 + 17 * t),
    bars: Math.round(8 + 3 * t) + (tall ? 2 : 0),
    walls: z >= 92 ? 2 : z >= 45 ? 1 : 0,
    frees: z >= 75 ? 1 : 0,
    long: 0.25 + 0.15 * t,
    bank: tall ? 'E' : z >= 92 ? 'D' : z >= 75 ? 'C' : z >= 60 ? 'B' : null,
  };
}

// Deep boards found offline by the same search run for minutes instead of
// milliseconds (fresh deals plus a long hill climb), kept in their solved
// position. Random deals rarely run past a dozen moves, so from z 60 a level
// starts from one of these, mirrored at random and remixed by a few
// depth-keeping mutations, which keeps every deal different but deep.
// Format: "<w><h><exitRow>:<wall cells>:<pieces>", cells in base 62, each
// piece a kind (h/H horizontal 2/3, v/V vertical 2/3, o free) and its top-left cell.
const BANK = {
  B: [
    '662:n:hgv9vtH0hihvvlvovev4vsv5hph7', '662:o:hgvnv5huv4Hqhlv9hyhwv6v8vjh1', '662:z:hghjvmvihuh3vnHph6v2v5h0vfhw',
    '662:y:hgvevtHohiv0h4h1vmv3vfhw', '662:y:hgvth0Vlh3hmhvv5Veh8vdv6', '662:x:hgVnv9VchqVmv5hkhvv8vdv0h3',
    '662:x:hghqhlv7v8viv5hjv9v4h2h0vn', '662:9:hghahjH1v8hxh6hovcvthvh4vl', '662:3:hgHlvtvqhxhav9h4v7huhrvevc',
    '662:y:hgvtH6v5h0h9vkhmvfh2hrvchv', '662:o:hgh6VmVeh9H2vchwVnvdv5h0Vf', '662:u:hghahlv9vchohxvdh4veVnhrvq',
    '662:b:hgvlvmHwhuv6hoh1vkv8v7v9vn', '662:x:hgv9H2vqv7hohuvsv5v8hl', '662:y:hghiv7v5h8h1vmv6vehpVnvlh3',
    '662:m:hgvfv4HuhrH1v0hxvtvcv7v5v8', '662:8:hgVnvrhvhah4h1vkhiv0hov3vm', '662:q:hgv3Huv5h0hxhrv6v4vjhkhmvt',
    '662:z:hgvmvivnH9Vlhjv8H0huh4v6', '662:j:hghqhuhkv9v8vtvsh3hwv5v7vch0', '662:6:hgh0hshpvoV7hkv4hmv5v8hvhxv9',
    '662:3:hgVcvnV9v5v0hpv7Huvmv2v4hx', '662:s:hgH2v5Hxhiv1voVeH8v0vnvl', '662:0:hgV6vdh1v9vlhmv5v4Vevthu',
    '662:b:hghyHoV0h1vnh3hvvmVlvehi', '662:j:hgvsHuH2hlviv7v5hpv0v9vevt', '662:t:hghxh0h6v3v8vchphlhvv5hrvo',
    '662:u:hgVch1v0v9hlv4Hxv8hpvdv5vn', '662:l:hgv4hmv2v7v5hovshuv6h0hwv3', '662:q:hgv5H8VmH2huvjveVchwh6vlvn',
    '662:y:hgv7vovmv8V0hjhqV9Hvv5h3', '662:o:hgv9v4vcvth2hjVmvrhuv0v1v5', '662:8:hgv6v3hah1vnv7hoHuvlvkvmhy',
    '662:q:hghwv7v5h1Vmh3vivpvtVfv6H8', '662:9:hgH0V6hkv5hmhwvjh7vsvth3hq', '662:r:hgH2v5v8vqv0VchuhxvmhkvdVn',
    '662:p:hghjvov7H2h0hvvlV6Vnvmv8v5', '662:s:hgV3hlh0vovnv7v5V6v4vjHxvk', '662:s:hgh2h6h0v4h8vlvov5hxVkvcvjvn',
    '662:1:hgVnhxv9vehrvpv0hlh3v2vchavo',
  ],
  C: [
    '662:u:hgH2Hpvmoov8hxhvvch9vfv1Vnv5', '662:i:hgvjVnocVehvvrvov4vmH1vfv5v0', '662:k:hgVch0v4vlVnv5o6vjHwv3vmv8hu',
    '662:m:hgHjv6Hwopv9Vnhav7huh4vihrv8', '662:q:hgVnH2hkv5Vmv8ofh9hwvcv0huv1', '662:3:hgHov4Vnhrodhlv1v0hxvcv8Huhj',
    '662:7:hgHpv6oih0h3vfHvH8hyhshmvov5', '662:6:hgVlH8hyvev5o0hiv7vmhpH1Huvn', '662:o:hgv7H1Vkv5v6v4vto0Hlhrvjhuhx',
    '662:w:hgH1Vfhjvchuo9v7hxhovmvnv8v4v5', '662:k:hgHvv5oaH2v0v8V9vmv7hyhpvnvc', '662:i:hghmh2h0vpozv4vov5hxh7VfVkv6',
    '662:j:hgh3vfh1oth6hvHxh8hrvohmvcv5vk', '662:q:hghyoehoVfh3v5Hvh1h9hjvnvmH6', '662:v:hgHov3hjHwo1h4h6vmvchavtvlv2',
    '662:x:hghsveH8vlv5odH2huvih6vjhyvq', '662:7:hgvjV6h2v9h0obHvvkv4Vmvnvo', '662:o:hgVlhjVnv2huo6vqvmv5h0v9v4vc',
    '662:y:hgH0vtvkoxh3VfHuv5hmv6hohi', '662:k:hgVch6o4vrh0Vmv2hvVnVdv3v5', '662:8:hgvoVnVfh3Hvo6vmH0vev5vcvjh9',
    '662:6:hgv5o3hyhwV7vpHkh1vnhrViv4v8', '662:o:hgopH1h7hwvtv5vcHkvdv0vshuv4', '662:7:hgvlodhyH0v4v8hphmhshwhuhjviv3',
    '662:s:hgv0hwv5oyv4h2huvnvcvdhlVev9', '662:5:hgvnh6Vmodhwv9Hjv8hqh2vchuha', '662:y:hgHkvov4H0osVnhwv8hqhiv9v6',
    '662:o:hgh3H8orvshlvev5huvcvjvnvqH0', '662:l:hgv4hmvsoeVcHvv3hpvdh6v2v5', '662:r:hgv8H2Vdv5ofh0vsVnhlvohvh6vk',
    '662:q:hgH8vev7vto1H2v5VlHuvjv0vm', '662:6:hgHwH2Hih0ozvovlvpv5v8vnvm', '662:m:hgV3hropvdhxvnV0v4h1v5hvVi',
    '662:t:hgv3v8okv5Vmh0hwv4Vdh6huvlvc', '662:w:hghmhrveo2h7hxvfHohah3vtV6', '662:v:hgVkv5h3oaVlv2Vnvmvjv9Vc',
    '662:z:hgH6hpvdo1v4hrv5huv3VcvnhlHw', '662:s:hgVev5h7Hxomh3huh1h9vlv0vnvcvj', '662:r:hgv5ozvcv4hsvdvohwh7hmv0vfh1',
    '662:5:hgHjvporviVnv0Hwvmh3v7v9v2ha',
  ],
  D: [
    '662:in:hghjV2v6hsv4v5voomhvv7h0v3vf', '662:7i:hgveHpvnhyovv5v4vohwv9H0hlv6', '662:uy:hghqolH2H8hohvh6vcvtvmh0vdv5',
    '662:3z:hgvjH7Vehxv5ofv0hsvlv4hvvc', '662:7j:hgV6v5Vnoahqh0hohkhwVmh3huh8', '662:67:hgobh4Vdhuvehlhrv3hxv2vih0Vn',
    '662:7u:hgvtvev2o3Hqhvh0vcvjhmv9v5hx', '662:bt:hghwv9Vco5v7v8h3vlhjh1huVm', '662:67:hgH3ViVnvjodvqhxhavmv9hkv2',
    '662:ao:hgHvv7oqh4hkV6Vnvsv8h0vjv9', '662:18:hghuhjodhpV0Hwvih2Vnvmv4vl', '662:jy:hgHqodH9vchlveh3v2hwvnv1v0',
    '662:0v:hgV9hmoiv5Vkv8vohyhrh3h6', '662:py:hgH1huhjo7vtVlv6v8v5v4v9hm', '662:1k:hgh9h2o4v6HpvfhxVnvmvih7v5Hu',
    '662:0w:hgh3vnh1oxhjhyvpv6ViH7vfv5vm', '662:jv:hgh0vmh3v8Vnhkorvov9hxV6hp', '662:6v:hgvlVcVnv9odhxH1v5hjh7v4hp',
    '662:6q:hgvlveVdHvH2vnv5o9h7Vmvoh0', '662:bw:hgo6H1huVnvlvmviv7hxv4vjv8', '662:8o:hghwhuoiv5v4hph2vnv9vdv6hyhlve',
    '662:ai:hgH1vtv8onVmv5Hvv0vjvovlv7vk', '662:bu:hgvjVmhvoqv7v0h8v4vivth1veVf', '662:uz:hgv4Vlh0h2h8oevmv6Hov7vnhihvv5',
    '662:bq:hghvoahyh4VfV6v3vnvmh1vjvov8', '662:8r:hgvmvcv4vjVehuoyhwv5vth2v9', '662:9k:hgh3Vfv8oxv5h1vmv0VdhvVcvt',
    '662:sx:hgvpVehiH2owvnvfhyh8v5h0vo', '662:uv:hgv0hrVno9Hkv8h1V7vch3Hwhoha', '662:7k:hghxVnhuvcHqo2v8Vdh4vfh9v0',
    '662:2r:hgV7hxh0v6vfopvmh8Vnh4hvvkhavi', '662:6r:hgvcv9VkhuobvjhmHxv4v8h2', '662:jn:hgv7huH8o0hpvlvtvshwH1vev5vc',
    '662:ko:hghiV9hvh2h0v5ouVmvnhqv7v6', '662:bm:hgVdh0Hqh4oaVivnv2h6vev9hw', '662:jx:hgH0v7vfV6voo3vshvv4vthmv5ve',
    '662:ln:hgVehovcv5h0ofhwh2vtvmvdh8v4', '662:5z:hgv4vcHvh0omh2vohsvkh8vfvjh6', '662:1n:hgv3huofv5v0vjvtv2v4vmVeVcvl',
    '662:8i:hgh0v5h2hlo4vpv6vevsvnhwv9V7',
  ],
  E: [
    '673:5h:hmHwV9ovvjv2V4vthrhAvoh0V6VehC', '673:op:hmV9vbVkhdh4ojhuh0v2hEhxhBvtvavchr', '673:2E:hmHBHcVtV5o8h3vkvuh6vahwvihrv9',
    '673:AC:hmhpvbvth4vso1V8HvHDhcvlv0viv9va', '673:1C:hmhDhoH6vcoBvdHqhuvbvtvah2veh4hw', '673:ov:hmvsV5v3v6hfhEo4V8h1hCVlvuVdvq',
    '673:ad:hmHfv5hAveoov1HwhrVth3v0hCv2vchp', '673:9o:hmV5V4H1v0VtvcVlvyosvvvuvdhCv8vk', '673:rt:hmH0hdvavwh3oAvxv6v9vkVpvsvoV5vz',
    '673:3o:hmHqH7hdHwhuhAhEofv0h1vtvavchCv5vj', '673:hv:hmHDvfhpV1voh3ojvrvwvsv0hAvtvch8', '673:eo:hmVsh1owvrV9V4V5vkhCvuVdvcv0',
    '673:fD:hmhpHuV5oEV2hxhchrh0hAh6v4vivz',
  ],
};

const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A bank board as a deal, optionally flipped top to bottom. */
function decodeBank(code: string, flip: boolean): { plan: Pick<SlidingPlan, 'w' | 'h' | 'exitRow'>; deal: Deal } {
  const [dims, walls, pieces] = code.split(':');
  const w = Number(dims[0]), h = Number(dims[1]);
  let exitRow = Number(dims[2]);
  const cell = (ch: string) => B62.indexOf(ch);
  const deal: Deal = { walls: [...walls].map(cell), pieces: [] };
  for (let i = 0; i < pieces.length; i += 2) {
    const kind = pieces[i], c = cell(pieces[i + 1]);
    const free = kind === 'o';
    deal.pieces.push({ len: free ? 1 : kind === 'H' || kind === 'V' ? 3 : 2, horiz: free || kind === 'h' || kind === 'H', free, x: c % w, y: Math.floor(c / w) });
  }
  if (flip) {
    exitRow = h - 1 - exitRow;
    deal.walls = deal.walls.map((c) => (h - 1 - Math.floor(c / w)) * w + (c % w));
    for (const p of deal.pieces) p.y = h - p.y - (p.horiz ? 1 : p.len);
  }
  return { plan: { w, h, exitRow }, deal };
}

interface Piece { len: number; horiz: boolean; free: boolean; x: number; y: number }

interface Deal { walls: number[]; pieces: Piece[] }

function fits(plan: SlidingPlan, d: Deal, q: Piece, skip = -1): boolean {
  const { w, h } = plan;
  const cells: number[] = [];
  const L = q.free ? 1 : q.len;
  for (let k = 0; k < L; k++) {
    const x = q.horiz || q.free ? q.x + k : q.x, y = q.horiz || q.free ? q.y : q.y + k;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    cells.push(y * w + x);
  }
  const taken = new Set<number>(d.walls);
  d.pieces.forEach((p, i) => {
    if (i === skip) return;
    const n = p.free ? 1 : p.len;
    for (let k = 0; k < n; k++) taken.add(p.horiz || p.free ? p.y * w + p.x + k : (p.y + k) * w + p.x);
  });
  return cells.every((c) => !taken.has(c));
}

function randomPiece(rng: Rng, plan: SlidingPlan, free: boolean): Piece {
  const { w, h, exitRow } = plan;
  if (free) return { len: 1, horiz: true, free: true, x: randInt(rng, w), y: randInt(rng, h) };
  const len = rand(rng) < plan.long ? 3 : 2;
  // Vertical bars are what cross the exit row, so they come up more often.
  let horiz = rand(rng) < 0.42;
  let y = randInt(rng, horiz ? h : h - len + 1);
  // A second horizontal bar on the exit row would block the key for good.
  if (horiz && y === exitRow) horiz = false, y = randInt(rng, h - len + 1);
  const x = randInt(rng, horiz ? w - len + 1 : w);
  return { len, horiz, free: false, x, y };
}

function addPiece(rng: Rng, plan: SlidingPlan, d: Deal, free: boolean): boolean {
  for (let tries = 0; tries < 40; tries++) {
    const q = randomPiece(rng, plan, free);
    if (fits(plan, d, q)) { d.pieces.push(q); return true; }
  }
  return false;
}

function addWall(rng: Rng, plan: SlidingPlan, d: Deal): void {
  for (let tries = 0; tries < 40; tries++) {
    const x = randInt(rng, plan.w), y = randInt(rng, plan.h);
    // Never on the exit row: a wall there would block the key for good.
    if (y === plan.exitRow) continue;
    const c = y * plan.w + x;
    if (d.walls.includes(c) || !fits(plan, { walls: [], pieces: d.pieces }, { len: 1, horiz: true, free: true, x, y })) continue;
    d.walls.push(c);
    return;
  }
}

function freshDeal(rng: Rng, plan: SlidingPlan): Deal {
  const d: Deal = { walls: [], pieces: [{ len: 2, horiz: true, free: false, x: plan.w - 2, y: plan.exitRow }] };
  for (let i = 0; i < plan.walls; i++) addWall(rng, plan, d);
  for (let i = 0; i < plan.frees; i++) addPiece(rng, plan, d, true);
  for (let i = 0; i < plan.bars; i++) addPiece(rng, plan, d, false);
  return d;
}

/** One small change to a deal, for the hill climb. */
function mutate(rng: Rng, plan: SlidingPlan, d0: Deal): Deal {
  const d: Deal = { walls: [...d0.walls], pieces: d0.pieces.map((p) => ({ ...p })) };
  const bars = d.pieces.map((p, i) => i).filter((i) => i > 0 && !d.pieces[i].free);
  const roll = rand(rng);
  if (roll < 0.4 && bars.length) {
    // Shift a bar to another spot on its line, or re-deal it elsewhere.
    const i = bars[randInt(rng, bars.length)];
    const q = rand(rng) < 0.5 ? { ...d.pieces[i], ...(d.pieces[i].horiz ? { x: randInt(rng, plan.w - d.pieces[i].len + 1) } : { y: randInt(rng, plan.h - d.pieces[i].len + 1) }) } : randomPiece(rng, plan, false);
    if (fits(plan, d, q, i)) d.pieces[i] = q;
  } else if (roll < 0.7 && bars.length > plan.bars - 2) {
    d.pieces.splice(bars[randInt(rng, bars.length)], 1);
    addPiece(rng, plan, d, false);
  } else if (bars.length < plan.bars + 2) {
    addPiece(rng, plan, d, false);
  } else {
    d.pieces.splice(bars[randInt(rng, bars.length)], 1);
  }
  return d;
}

function shapeOfDeal(plan: SlidingPlan, d: Deal): { sh: Shape; p: number[] } {
  const wall = new Uint8Array(plan.w * plan.h);
  for (const c of d.walls) wall[c] = 1;
  const sh: Shape = { w: plan.w, h: plan.h, exitRow: plan.exitRow, wall, len: [], horiz: [], free: [], fix: [] };
  const p: number[] = [];
  for (const q of d.pieces) {
    sh.len.push(q.free ? 1 : q.len);
    sh.horiz.push(q.horiz);
    sh.free.push(q.free);
    sh.fix.push(q.free ? 0 : q.horiz ? q.y : q.x);
    p.push(q.free ? q.y * plan.w + q.x : q.horiz ? q.x : q.y);
  }
  return { sh, p };
}

/** States one deal's space may hold, and states one level may walk in all (about a millisecond per thousand). */
const SPACE_CAP = 8000;
const BUDGET = 110000;

interface Found { deal: Deal; sh: Shape; count: number; pos: Int8Array; dist: Int16Array; maxDist: number }

/** How far past the target a par may run: one move for the lightest, three for the heaviest. */
const parSlack = (goal: number): number => Math.min(3, 1 + Math.floor(goal / 7));

/** A level for an element: a board whose best solution is near the element's target par. */
export function newSliding(z: number, seed: number): SlidingState {
  const rng = seeded(seed);
  let plan = slidingPlan(z);
  const goal = plan.target;
  let spent = 0;
  let best: Found | null = null;
  const measure = (deal: Deal): Found | null => {
    const { sh, p } = shapeOfDeal(plan, deal);
    const space = explore(sh, p, SPACE_CAP);
    spent += space ? space.count : SPACE_CAP;
    if (!space || space.maxDist < 2) return null;
    return { deal, sh, count: space.count, pos: space.pos.slice(), dist: space.dist, maxDist: space.maxDist };
  };
  if (plan.bank) {
    // A deep board from the bank, flipped or not, then remixed: each change is kept only while the board stays deep enough.
    const list = BANK[plan.bank];
    const { plan: dims, deal } = decodeBank(list[randInt(rng, list.length)], rand(rng) < 0.5);
    plan = { ...plan, ...dims };
    best = measure(deal);
    let kept = 0;
    for (let i = 0; i < 200 && spent < BUDGET && best && kept < 6; i++) {
      const next = measure(mutate(rng, plan, best.deal));
      if (next && next.maxDist >= goal) { best = next; kept++; }
    }
  } else {
    // Over the target by a little is as good as on it; more is trimmed when picking the start.
    const score = (m: number) => (m >= goal ? 1000 - Math.max(0, m - goal - parSlack(goal)) : m);
    const consider = (deal: Deal): void => {
      const f = measure(deal);
      if (f && (!best || score(f.maxDist) >= score(best.maxDist))) best = f;
    };
    const done = () => best !== null && best.maxDist >= goal;
    // Fresh deals (each built around a solved position, so every one is solvable), then a hill climb.
    for (let i = 0; i < 2000 && spent < BUDGET * 0.55 && !done(); i++) consider(freshDeal(rng, plan));
    for (let i = 0; i < 2000 && spent < BUDGET && best && !done(); i++) consider(mutate(rng, plan, (best as Found).deal));
  }
  if (!best) return fallback(plan);
  const f: Found = best;
  // Start from the farthest state, or from one just past the target when the space runs deeper.
  const want = Math.min(f.maxDist, goal + parSlack(goal));
  const at: number[] = [];
  for (let s = 0; s < f.count; s++) if (f.dist[s] === want) at.push(s);
  const pick = at[randInt(rng, at.length)];
  const n = f.sh.len.length;
  const blocks = blocksOf(f.sh, f.pos.subarray(pick * n, pick * n + n));
  const walls = [...f.deal.walls].sort((a, b) => a - b);
  return { w: plan.w, h: plan.h, exitRow: plan.exitRow, walls, blocks, moves: 0, par: want };
}

/** A tiny fixed board, only if every deal failed (never seen in tests). */
function fallback(plan: SlidingPlan): SlidingState {
  const blocks: Block[] = [
    { id: 0, x: 0, y: plan.exitRow, len: 2, horiz: true, free: false },
    { id: 1, x: 3, y: plan.exitRow - 1, len: 2, horiz: false, free: false },
  ];
  return { w: plan.w, h: plan.h, exitRow: plan.exitRow, walls: [], blocks, moves: 0, par: 2 };
}
