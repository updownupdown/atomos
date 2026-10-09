import { describe, expect, it } from 'vitest';
import { differing, flip, newLight, reflect, solved, trace, type LightState } from '../src/puzzles/light';

const ZS = [1, 6, 26, 50, 92, 118];

describe('beam', () => {
  it('reflects off both mirror kinds', () => {
    expect(reflect('/', 'right')).toBe('up');
    expect(reflect('/', 'down')).toBe('left');
    expect(reflect('\\', 'right')).toBe('down');
    expect(reflect('\\', 'up')).toBe('left');
    expect(reflect('.', 'up')).toBe('up');
  });

  const grid: LightState = {
    size: 3,
    // . . .
    // / . #
    // . . .
    cells: ['.', '.', '.', '/', '.', '#', '.', '.', '.'],
    entry: 0, entryDir: 'down', targets: [4], solution: ['.', '.', '.', '\\', '.', '#', '.', '.', '.'], moves: 0, par: 1,
  };

  it('traces through mirrors and stops at blockers', () => {
    const b = trace(grid);
    expect(b.cells).toEqual([0, 3]);
    expect(b.exits).toBe(true);
    const f = flip(grid, 3)!;
    const b2 = trace(f);
    expect(b2.cells).toEqual([0, 3, 4]);
    expect(b2.exits).toBe(false);
    expect(solved(grid)).toBe(false);
    expect(solved(f)).toBe(true);
    expect(f.moves).toBe(1);
    expect(grid.cells[3]).toBe('/');
  });

  it('only flips mirrors', () => {
    expect(flip(grid, 0)).toBeNull();
    expect(flip(grid, 5)).toBeNull();
    expect(flip(flip(grid, 3)!, 3)!.cells).toEqual(grid.cells);
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    expect(newLight(50, 4)).toEqual(newLight(50, 4));
  });

  it('starts unsolved and is solved by flipping the differing mirrors, for a spread of elements', () => {
    for (const z of ZS) {
      for (let seed = 1; seed <= 12; seed++) {
        const level = newLight(z, seed * 17 + z);
        expect(solved(level)).toBe(false);
        expect(level.targets.length).toBeGreaterThanOrEqual(2);
        expect(level.targets.length).toBeLessThanOrEqual(3);
        for (const t of level.targets) expect(level.cells[t]).toBe('.');
        const diff = differing(level);
        expect(diff.length).toBe(level.par);
        expect(level.par).toBeGreaterThanOrEqual(1);
        let s = level;
        for (const i of diff) s = flip(s, i)!;
        expect(solved(s)).toBe(true);
        expect(s.moves).toBe(level.par);
        expect(s.cells).toEqual(level.solution);
      }
    }
  });

  it('grows with the element', () => {
    expect(newLight(1, 2).size).toBe(5);
    expect(newLight(50, 2).size).toBe(6);
    expect(newLight(118, 2).size).toBe(7);
    expect(newLight(118, 2).par).toBeGreaterThanOrEqual(2);
  });
});
