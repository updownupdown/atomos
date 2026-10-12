// Tokamak's difficulty, measured: how a greedy player (two swipes of look-ahead) and a random
// swiper fare on each period's boards, before any vetting. Slow, so it only runs on request:
//   MEASURE=1 npx vitest run tests/merge.measure.test.ts
// Prints a table per period: climb, walls, greedy win %, random win %, greedy swipes, par.

import { describe, it } from 'vitest';
import { element } from '../src/core/elements';
import {
  captureMix, captureShape, clusterUnit, dealMerge, greedyRun, mergeShape, newCapture, newMerge,
  slide, spawnMix, wallLayouts, won, type Dir, type MergeShape, type MergeState,
} from '../src/puzzles/merge';
import { seeded, randInt } from '../src/puzzles/rng';

// No Node types in this project: reach the environment and stdout through globalThis.
const proc = (globalThis as { process?: { env: Record<string, string | undefined>; stdout: { write(s: string): void } } }).process;
const env = proc?.env ?? {};
const print = (s: string) => proc?.stdout.write(s);

const PERIODS: [number, number, number][] = [[1, 2, 2], [2, 3, 10], [3, 11, 18], [4, 19, 36], [5, 37, 54], [6, 55, 86], [7, 87, 118]];
const DIRS: Dir[] = ['left', 'up', 'right', 'down'];

function raw(z: number, seed: number, shape: MergeShape): MergeState {
  const target = { z, a: element(z).commonA };
  const walls = shape.walls ? wallLayouts(seed, shape.walls, shape.inner)[0] : [];
  return dealMerge(target, seed, { walls, mix: spawnMix(target, shape.climb), unit: clusterUnit(target.a, shape.climb) });
}

function randomRun(s0: MergeState, seed: number, limit = 3000): boolean {
  const rng = seeded(seed);
  let s = s0;
  for (let k = 0; k < limit && !won(s); k++) {
    const opts = DIRS.map((d) => slide(s, d)).filter((x): x is MergeState => x !== null);
    if (!opts.length) return false;
    s = opts[randInt(rng, opts.length)];
  }
  return won(s);
}

const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(1, d))}%`;

describe.skipIf(!env.MEASURE)('Tokamak measurements', () => {
  it('per period', () => {
    const seeds = Number(env.SEEDS ?? 3);
    const step = Number(env.STEP ?? 3);
    const override = env.SHAPE ? (JSON.parse(env.SHAPE) as Record<string, MergeShape>) : {};
    const rows: string[] = ['period | z | climb | walls | greedy win | random win | greedy swipes (avg, max) | par (avg) | vetted walls kept | deal ms (max)'];
    for (const [p, lo, hi] of PERIODS) {
      if (lo < 2 && hi < 2) continue;
      let n = 0, gw = 0, rw = 0, swipes = 0, maxSw = 0, par = 0, kept = 0, dealMax = 0;
      const shape = override[p] ?? mergeShape(lo);
      for (let z = Math.max(2, lo); z <= hi; z += step) {
        for (let seed = 1; seed <= seeds; seed++) {
          const s = raw(z, seed * 977 + z, shape);
          const g = greedyRun(s, 2, 900);
          n++;
          if (g.won) { gw++; swipes += g.plan.dirs.length; maxSw = Math.max(maxSw, g.plan.dirs.length); }
          if (randomRun(s, seed)) rw++;
          const t0 = performance.now();
          const v = newMerge({ z, a: element(z).commonA }, seed * 977 + z, shape);
          dealMax = Math.max(dealMax, performance.now() - t0);
          par += v.par;
          if (v.walls.length === shape.walls) kept++;
        }
      }
      rows.push(`${p} | ${lo}-${hi} | ${shape.climb} | ${shape.walls} | ${pct(gw, n)} | ${pct(rw, n)} | ${Math.round(swipes / Math.max(1, gw))}, ${maxSw} | ${Math.round(par / n)} | ${pct(kept, n)} | ${Math.round(dealMax)}`);
    }
    print(`\n${rows.join('\n')}\n`);
  }, 600_000);

  it('capture mode', () => {
    const seeds = Number(env.SEEDS ?? 3);
    const rows: string[] = ['z range | A | seed x 2^levels + neutrons | greedy win | random win | greedy swipes | par | deal ms'];
    for (const [lo, hi] of [[27, 36], [37, 54], [55, 86], [87, 118]]) {
      let n = 0, gw = 0, rw = 0, swipes = 0, par = 0, dealMax = 0;
      const eg = captureShape(element(hi).commonA);
      for (let z = lo; z <= hi; z += 3) {
        for (let seed = 1; seed <= seeds; seed++) {
          const target = { z, a: element(z).commonA };
          const c = captureShape(target.a);
          const s = dealMerge(target, seed * 31 + z, { mode: 'capture', mix: captureMix(target.a), unit: c.seed });
          const g = greedyRun(s, 2, 900);
          n++;
          if (g.won) { gw++; swipes += g.plan.dirs.length; }
          if (randomRun(s, seed)) rw++;
          const t0 = performance.now();
          const v = newCapture(target, seed * 31 + z);
          dealMax = Math.max(dealMax, performance.now() - t0);
          par += v.par;
        }
      }
      rows.push(`${lo}-${hi} | ${element(hi).commonA} | ${eg.seed} x ${2 ** eg.levels} + ${eg.neutrons} | ${pct(gw, n)} | ${pct(rw, n)} | ${Math.round(swipes / Math.max(1, gw))} | ${Math.round(par / n)} | ${Math.round(dealMax)}`);
    }
    print(`\n${rows.join('\n')}\n`);
  }, 600_000);
});
