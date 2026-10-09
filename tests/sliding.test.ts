import { describe, expect, it } from 'vitest';
import { applySlide, newSliding, slack, solveSliding, solved } from '../src/puzzles/sliding';

describe('sliding block', () => {
  it('deals the same level for the same seed', () => {
    expect(newSliding(30, 5)).toEqual(newSliding(30, 5));
  });

  it('deals solvable levels with a positive par across the table', () => {
    for (const z of [27, 40, 60, 80, 100, 118]) {
      const s = newSliding(z, 100 + z);
      expect(solved(s)).toBe(false);
      expect(s.par).toBeGreaterThanOrEqual(2);
      expect(solveSliding(s)).toBe(s.par);
    }
  });

  it('only slides along a bar\'s axis within its slack', () => {
    const s = newSliding(27, 3);
    const key = s.blocks[0];
    const { back, fwd } = slack(s, 0);
    expect(applySlide(s, { id: 0, by: fwd + 1 })).toBeNull();
    expect(applySlide(s, { id: 0, by: 0 })).toBeNull();
    if (back > 0) expect(applySlide(s, { id: 0, by: -1 })!.blocks[0].x).toBe(key.x - 1);
  });

  it('is solved when the key bar reaches the right edge', () => {
    const s = { size: 6, exitRow: 2, blocks: [{ id: 0, x: 3, y: 2, len: 2, horiz: true }], moves: 0, par: 1 };
    expect(solved(s)).toBe(false);
    expect(solved(applySlide(s, { id: 0, by: 1 })!)).toBe(true);
  });
});
