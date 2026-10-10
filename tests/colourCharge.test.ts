import { describe, expect, it } from 'vitest';
import { bind, canBind, canFinish, countClearances, groupKind, newColourCharge, solved, specFor, type Quark } from '../src/puzzles/colourCharge';

const SPREAD = [1, 10, 11, 30, 31, 54, 55, 86, 87, 118];

describe('groups', () => {
  const q = (colour: 0 | 1 | 2, anti = false): Quark => ({ colour, anti });

  it('binds one of each colour, or a colour and its anticolour', () => {
    expect(groupKind([q(0), q(1), q(2)], [0, 1, 2])).toBe('baryon');
    expect(groupKind([q(0, true), q(1, true), q(2, true)], [0, 1, 2])).toBe('antibaryon');
    expect(groupKind([q(0), q(0, true)], [0, 1])).toBe('meson');
    expect(groupKind([q(0), q(1), q(1)], [0, 1, 2])).toBeNull();
    expect(groupKind([q(0), q(1, true), q(2)], [0, 1, 2])).toBeNull();
    expect(groupKind([q(0), q(1, true)], [0, 1])).toBeNull();
    expect(groupKind([q(0), q(1)], [0, 1])).toBeNull();
  });
});

describe('levels', () => {
  it('is the same deal for the same seed', () => {
    expect(newColourCharge(60, 4)).toEqual(newColourCharge(60, 4));
  });

  it('is dealt from a tiling into neutral connected groups, with par = groups', () => {
    for (const z of SPREAD) {
      for (let seed = 1; seed <= 8; seed++) {
        const s = newColourCharge(z, seed);
        const spec = specFor(z);
        expect(s.tiles).toHaveLength(spec.cols * spec.rows);
        const covered = s.solution.flat().sort((a, b) => a - b);
        expect(covered).toEqual(Array.from({ length: s.tiles.length }, (_, i) => i));
        expect(s.solution.filter((p) => p.length === 2)).toHaveLength(spec.mesons);
        expect(s.par).toBe(s.solution.length);
        expect(canFinish(s)).toBe(true);
        // Playing the dealt tiling clears the board.
        let t = s;
        for (const p of s.solution) {
          expect(canBind(t, p)).toBe(true);
          t = bind(t, p)!;
        }
        expect(solved(t)).toBe(true);
        expect(t.moves).toBe(s.par);
      }
    }
  });

  it('only has antiquarks once mesons arrive', () => {
    expect(newColourCharge(20, 1).tiles.some((t) => t.anti)).toBe(false);
    expect(newColourCharge(100, 1).tiles.some((t) => t.anti)).toBe(true);
  });

  it('generates fast for every element', () => {
    for (let z = 1; z <= 118; z++) {
      const t = performance.now();
      newColourCharge(z, z * 13 + 1);
      expect(performance.now() - t).toBeLessThan(150);
    }
  });
});

describe('binding', () => {
  it('refuses bound, disconnected or charged groups and spots a stranded tile', () => {
    const s = newColourCharge(5, 2);
    const [a] = s.solution;
    const t = bind(s, a)!;
    expect(bind(t, a)).toBeNull();
    // Two cells that are not neighbours never bind.
    const far = [0, s.tiles.length - 1];
    expect(canBind(s, far)).toBe(false);
    // A hand-made board where the greedy pick strands a tile.
    const tiles: Quark[] = [
      { colour: 0, anti: false }, { colour: 1, anti: false }, { colour: 2, anti: false },
      { colour: 1, anti: false }, { colour: 2, anti: false }, { colour: 0, anti: false },
    ];
    const board = { cols: 3, rows: 2, tiles, bound: Array(6).fill(-1), groups: [], solution: [[0, 1, 2], [3, 4, 5]], moves: 0, par: 2 };
    expect(canFinish(board)).toBe(true);
    const other = bind(board, [1, 2, 5])!; // g b r, leaving r g b in an L: fine
    expect(canFinish(other)).toBe(true);
    const strand = bind(board, [0, 1, 4])!; // r g b in an L, leaving 2, 3, 5 apart
    expect(canFinish(strand)).toBe(false);
  });
});

describe('one answer', () => {
  it('deals grids with exactly one clearance across the range', () => {
    for (const z of SPREAD) {
      for (let d = 0; d < 4; d++) {
        const s = newColourCharge(z, 7000 + 31 * z + d);
        expect(countClearances(s.tiles, s.cols, s.rows, 3)).toBe(1);
      }
    }
  });
});
