// Sliding Block: clear the way for the key piece.
//
// A 6x6 board of bars, each sliding only along its own axis (Rush Hour). The
// red key bar sits on the exit row; slide the others out of its way until it
// can leave through the gap on the right. One move is one bar sliding any
// distance. Levels are dealt from a seed and checked by a breadth-first solver,
// whose optimal count is the par.

import { randInt, seeded, type Rng } from './rng';

export interface Block {
  id: number;
  x: number;
  y: number;
  len: number;
  horiz: boolean;
}

export interface SlidingState {
  size: number;
  /** The row the key block (id 0) travels on; the exit is at its right end. */
  exitRow: number;
  blocks: Block[];
  moves: number;
  par: number;
}

export interface SlideMove {
  id: number;
  /** Cells moved along the block's axis; negative is left or up. */
  by: number;
}

function occupied(size: number, blocks: Block[], skip = -1): Uint8Array {
  const grid = new Uint8Array(size * size);
  for (const b of blocks) {
    if (b.id === skip) continue;
    for (let i = 0; i < b.len; i++) grid[(b.horiz ? b.y : b.y + i) * size + (b.horiz ? b.x + i : b.x)] = 1;
  }
  return grid;
}

/** How far a block can slide each way without hitting anything. */
export function slack(s: SlidingState, id: number): { back: number; fwd: number } {
  const b = s.blocks.find((x) => x.id === id)!;
  const grid = occupied(s.size, s.blocks, id);
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < s.size && y < s.size && !grid[y * s.size + x];
  let back = 0, fwd = 0;
  if (b.horiz) {
    while (free(b.x - back - 1, b.y)) back++;
    while (free(b.x + b.len + fwd, b.y)) fwd++;
  } else {
    while (free(b.x, b.y - back - 1)) back++;
    while (free(b.x, b.y + b.len + fwd)) fwd++;
  }
  return { back, fwd };
}

export function applySlide(s: SlidingState, m: SlideMove): SlidingState | null {
  if (m.by === 0) return null;
  const { back, fwd } = slack(s, m.id);
  if (m.by < -back || m.by > fwd) return null;
  const blocks = s.blocks.map((b) => (b.id === m.id ? { ...b, x: b.horiz ? b.x + m.by : b.x, y: b.horiz ? b.y : b.y + m.by } : b));
  return { ...s, blocks, moves: s.moves + 1 };
}

export function solved(s: SlidingState): boolean {
  const key = s.blocks[0];
  return key.x + key.len >= s.size;
}

function keyOf(blocks: Block[]): string {
  return blocks.map((b) => (b.horiz ? b.x : b.y)).join(',');
}

/** Breadth-first search over bar positions; returns the optimal move count or null. */
export function solveSliding(s: SlidingState, limit = 200000): number | null {
  const size = s.size;
  const start = keyOf(s.blocks);
  const seen = new Set<string>([start]);
  let frontier: Block[][] = [s.blocks];
  let depth = 0;
  while (frontier.length && seen.size < limit) {
    const next: Block[][] = [];
    for (const blocks of frontier) {
      if (blocks[0].x + blocks[0].len >= size) return depth;
      const grid = occupied(size, blocks);
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        // Slide one cell at a time each way until blocked; every stop is a move.
        for (const dir of [-1, 1]) {
          for (let by = dir; ; by += dir) {
            const nx = b.horiz ? b.x + by : b.x, ny = b.horiz ? b.y : b.y + by;
            // The cell newly entered at the leading end.
            const ex = b.horiz ? (dir > 0 ? nx + b.len - 1 : nx) : nx;
            const ey = b.horiz ? ny : dir > 0 ? ny + b.len - 1 : ny;
            if (ex < 0 || ey < 0 || ex >= size || ey >= size || grid[ey * size + ex]) break;
            const moved = blocks.slice();
            moved[bi] = { ...b, x: nx, y: ny };
            const k = keyOf(moved);
            if (!seen.has(k)) {
              seen.add(k);
              next.push(moved);
            }
          }
        }
      }
    }
    frontier = next;
    depth++;
  }
  return null;
}

function deal(rng: Rng, size: number, exitRow: number, count: number): Block[] {
  const blocks: Block[] = [{ id: 0, x: randInt(rng, 2), y: exitRow, len: 2, horiz: true }];
  let tries = 0;
  while (blocks.length < count && tries++ < 400) {
    const horiz = randInt(rng, 3) === 0;
    const len = randInt(rng, 3) === 0 ? 3 : 2;
    const x = randInt(rng, size - (horiz ? len - 1 : 0));
    const y = randInt(rng, size - (horiz ? 0 : len - 1));
    // Other horizontal bars on the exit row would block it for good.
    if (horiz && y === exitRow) continue;
    const grid = occupied(size, blocks);
    let clear = true;
    for (let i = 0; i < len; i++) if (grid[(horiz ? y : y + i) * size + (horiz ? x + i : x)]) clear = false;
    if (!clear) continue;
    blocks.push({ id: blocks.length, x, y, len, horiz });
  }
  return blocks;
}

/** A level whose optimal solution takes at least a few moves, more for heavier elements. */
export function newSliding(z: number, seed: number): SlidingState {
  const rng = seeded(seed);
  const size = 6;
  const exitRow = 2;
  const want = Math.min(10, 3 + Math.floor(Math.max(0, z - 20) / 14));
  const count = Math.min(11, 6 + Math.floor(Math.max(0, z - 20) / 20));
  let best: SlidingState | null = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const blocks = deal(rng, size, exitRow, count);
    const s: SlidingState = { size, exitRow, blocks, moves: 0, par: 0 };
    if (solved(s)) continue;
    const par = solveSliding(s, 40000);
    if (par === null || par < 2) continue;
    const cand = { ...s, par };
    if (par >= want) return cand;
    if (!best || par > best.par) best = cand;
  }
  return best!;
}
