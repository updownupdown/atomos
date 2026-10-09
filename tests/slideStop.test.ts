import { describe, expect, it } from 'vitest';
import { DIRS, newSlideStop, reachable, slide, slideEnd, solve, solved, type SlideStopState } from '../src/puzzles/slideStop';

const ZS = [1, 6, 26, 50, 92, 118];

describe('sliding', () => {
  const board: SlideStopState = {
    size: 3,
    // . # .
    // . . .
    // . . .
    rocks: [false, true, false, false, false, false, false, false, false],
    start: 0, goal: 6, pos: 0, moves: 0, par: 1,
  };

  it('slides until a rock or the edge', () => {
    expect(slideEnd(board, 0, 'right')).toBe(0);
    expect(slideEnd(board, 0, 'down')).toBe(6);
    expect(slideEnd(board, 3, 'right')).toBe(5);
    expect(slideEnd(board, 7, 'up')).toBe(4);
  });

  it('refuses a slide that goes nowhere and counts the ones that move', () => {
    expect(slide(board, 'right')).toBeNull();
    expect(slide(board, 'up')).toBeNull();
    const s = slide(board, 'down')!;
    expect(s.pos).toBe(6);
    expect(s.moves).toBe(1);
    expect(board.pos).toBe(0);
    expect(solved(s)).toBe(true);
  });

  it('finds the shortest route and reports dead ends', () => {
    expect(solve(board)).toEqual(['down']);
    expect(reachable({ ...board, goal: 1 })).toBe(false);
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    expect(newSlideStop(26, 7)).toEqual(newSlideStop(26, 7));
    expect(newSlideStop(26, 7)).not.toEqual(newSlideStop(26, 8));
  });

  it('is solvable, with par the shortest route, for a spread of elements and seeds', () => {
    for (const z of ZS) {
      for (let seed = 1; seed <= 12; seed++) {
        const level = newSlideStop(z, seed * 31 + z);
        expect(solved(level)).toBe(false);
        expect(level.pos).toBe(level.start);
        expect(level.rocks[level.start]).toBe(false);
        expect(level.rocks[level.goal]).toBe(false);
        const path = solve(level)!;
        expect(path).not.toBeNull();
        expect(path.length).toBe(level.par);
        expect(level.par).toBeGreaterThanOrEqual(3 + Math.floor(z / 40));
        let s = level;
        for (const d of path) s = slide(s, d)!;
        expect(solved(s)).toBe(true);
        expect(s.moves).toBe(level.par);
      }
    }
  });

  it('grows with the element', () => {
    expect(newSlideStop(1, 3).size).toBe(7);
    expect(newSlideStop(50, 3).size).toBe(8);
    expect(newSlideStop(118, 3).size).toBe(9);
  });

  it('never lets a slide land on a rock', () => {
    const level = newSlideStop(50, 99);
    for (const d of DIRS) {
      const s = slide(level, d);
      if (s) expect(s.rocks[s.pos]).toBe(false);
    }
  });
});
