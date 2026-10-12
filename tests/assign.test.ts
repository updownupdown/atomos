import { describe, expect, it } from 'vitest';
import TABLE from '../src/data/atom-games.json';
import ISOTOPES from '../src/data/isotope-games.json';
import { POOLS, assignAtomGames, loadOf, tally, type AtomGames } from '../src/core/assign';
import { atomGame } from '../src/core/atomGames';
import { atomDial, dialFor, difficulty, difficultyRange, difficultyWord, fleetingDial, halfLifeBump, levelSpan, zForDial } from '../src/puzzles/difficulty';
import { nextStep } from '../src/core/next';
import { defaultSave } from '../src/core/save';
import { PUZZLES, puzzleType } from '../src/puzzles/catalog';

const table = TABLE as AtomGames;

describe('atom steps from two pools', () => {
  it('match what the algorithm makes from the pools (run npm run atoms:assign after a change)', () => {
    expect(assignAtomGames(loadOf(ISOTOPES as Record<string, string>, 0.5))).toEqual(table);
  });

  it('cover every atom, nucleus from the nucleus pool and electrons from the electron pool', () => {
    const nuc = new Set(POOLS.nucleus.map((g) => g.id));
    const ele = new Set(POOLS.shells.map((g) => g.id));
    for (let z = 1; z <= 118; z++) {
      const row = table[z];
      expect(row, `z ${z}`).toBeTruthy();
      if (z === 1) expect(row.nucleus).toBeUndefined();
      else expect(nuc.has(row.nucleus!), `z ${z} nucleus ${row.nucleus}`).toBe(true);
      expect(ele.has(row.shells), `z ${z} shells ${row.shells}`).toBe(true);
      expect(row.nucleus).not.toBe(row.shells);
      // Every game in the table is a built, non-reserve catalog game.
      for (const g of [row.nucleus, row.shells]) if (g) expect(puzzleType(g).deal && puzzleType(g).tier !== 'reserve').toBe(true);
    }
  });

  it('never put one game on the same step of two neighbors, and wait for a game\'s first element', () => {
    for (let z = 2; z <= 118; z++) {
      if (z > 2) expect(table[z].nucleus).not.toBe(table[z - 1].nucleus);
      expect(table[z].shells).not.toBe(table[z - 1].shells);
      for (const step of ['nucleus', 'shells'] as const) {
        const g = POOLS[step].find((p) => p.id === table[z][step]);
        if (g) expect(z).toBeGreaterThanOrEqual(g.from ?? 1);
      }
    }
  });

  it('start with Quanta on hydrogen and Tokamak on helium, and play neither more than about 50 times', () => {
    expect(atomGame(1, 'shells')).toBe('orbitalGrid');
    expect(atomGame(2, 'nucleus')).toBe('merge');
    const n = tally(table);
    expect(n.merge).toBeLessThanOrEqual(50);
    expect(n.orbitalGrid).toBeLessThanOrEqual(55);
    expect(Object.values(n).reduce((a, b) => a + b, 0)).toBe(117 + 118);
  });

  it('feed the Next button the step\'s own game', () => {
    const save = defaultSave();
    const step = nextStep(save)!;
    expect(step.game).toBe(atomGame(step.z, step.kind === 'nucleus' ? 'nucleus' : 'shells'));
  });

  it('spread every planned game once they join the pools', () => {
    // A preview of the table with every reserve game in, as the comment on POOLS plans: no game
    // comes near today's 118, and Tokamak and Quanta fall to about 20.
    const w = (ids: string) => ids.split(' ').map((p) => ({ id: p.split(':')[0], weight: Number(p.split(':')[1]) }));
    const more = {
      nucleus: [...POOLS.nucleus, ...w('fission:7 sort:7 bond:8 planar:7 drop:6 collide:7 annihil:6 shells:6 push:7')],
      shells: [...POOLS.shells, ...w('spin:7 solo:7 valence:7 blocks:6 emit:6 dipole:6 circuit:7 trace:6')],
    };
    const n = tally(assignAtomGames(loadOf(ISOTOPES as Record<string, string>, 0.5), more));
    expect(Math.max(...Object.values(n))).toBeLessThan(25);
    expect(n.merge).toBeLessThan(20);
  });
});

describe('the difficulty dial', () => {
  it('climbs gently across the table for atoms, never reaching Expert', () => {
    expect([1, 26, 54, 86, 118].map(atomDial)).toEqual([5, 24, 41, 58, 75]);
    for (let z = 2; z <= 118; z++) expect(atomDial(z)).toBeGreaterThanOrEqual(atomDial(z - 1));
    expect(difficultyWord(atomDial(118))).toBe('Hard');
  });

  it('adds one point per factor of ten a fleeting half-life falls short of a year, sixteen at most', () => {
    expect(halfLifeBump(3.0e7)).toBe(0);
    expect(halfLifeBump(86400)).toBe(3);
    expect(halfLifeBump(1)).toBe(7);
    expect(halfLifeBump(1e-9)).toBe(16);
    expect(halfLifeBump(1e-21)).toBe(16);
    expect(halfLifeBump(null)).toBe(13);
    expect(fleetingDial(118, 1e-9)).toBe(91);
  });

  it('buckets 1 to 100 into five words', () => {
    expect([1, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(difficultyWord)).toEqual(['Very easy', 'Very easy', 'Easy', 'Easy', 'Medium', 'Medium', 'Hard', 'Hard', 'Expert', 'Expert']);
    expect(levelSpan(3)).toEqual({ lo: 41, hi: 60 });
  });

  it('deals every built game at any dial, clamped into its span', () => {
    for (const p of PUZZLES.filter((q) => q.makeAt)) {
      const { lo, hi } = difficultyRange(p.id);
      expect(lo, p.id).toBeGreaterThanOrEqual(1);
      expect(hi, p.id).toBeLessThanOrEqual(100);
      expect(dialFor(p.id, 1)).toBe(lo);
      expect(dialFor(p.id, 100)).toBe(hi);
    }
  });

  it('walks a ladder game\'s elements, and keeps a bound game on its own element', () => {
    expect(zForDial('sliding', 25, 50)).toBe(27);
    expect(zForDial('sliding', 85, 50)).toBe(118);
    expect(zForDial('orbitalGrid', 99, 50)).toBe(50);
    expect(zForDial('merge', 99, 50)).toBe(50);
    expect(difficulty('sliding', 1)).toBe(25);
    expect(difficulty('lines', 118)).toBe(75);
  });
});
