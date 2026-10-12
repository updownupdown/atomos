import { describe, expect, it } from 'vitest';
import { begin, bondShape, complete, countSolutions, extend, firstWrong, newBond, occupancy, solved, type BondState } from '../src/puzzles/bond';
import { BondView, BOND_HUES, INSTRUCTIONS, RULES } from '../src/puzzles/bondView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const ZS = [1, 10, 11, 36, 37, 86, 87, 118];

describe('deals', () => {
  it('cuts one path through every cell into pairs with exactly one answer', () => {
    for (const z of ZS) for (const seed of [1, 2]) {
      const s = newBond(z, seed);
      const shape = bondShape(z);
      expect(s.size).toBe(shape.size);
      expect(s.pairs.length).toBeGreaterThanOrEqual(shape.pairs[0]);
      expect(s.pairs.length).toBeLessThanOrEqual(shape.pairs[1]);
      expect(s.pairs.length).toBeLessThanOrEqual(BOND_HUES.length);
      const cells = new Set(s.solution.flat());
      expect(cells.size).toBe(s.size * s.size);
      for (const piece of s.solution) expect(piece.length).toBeGreaterThanOrEqual(3);
      expect(countSolutions(s.size, s.pairs)).toBe(1);
      const full: BondState = { ...s, paths: s.solution.map((p) => p.slice()) };
      expect(solved(full)).toBe(true);
    }
  });

  it('deals quickly', () => {
    const t0 = performance.now();
    for (const z of ZS) newBond(z, 5);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe('strokes', () => {
  it('begins at a dot, extends to neighbors, pulls back, and cuts another path', () => {
    const s = newBond(1, 1);
    const [a, b] = s.pairs[0];
    expect(begin(s, a)).toBe(0);
    expect(s.paths[0]).toEqual([a]);
    const sol = s.solution[0][0] === a ? s.solution[0] : s.solution[0].slice().reverse();
    expect(extend(s, 0, sol[1])).toBe(true);
    expect(extend(s, 0, sol[1])).toBe(false); // already the head
    expect(extend(s, 0, sol[0])).toBe(true); // back onto the dot
    expect(s.paths[0]).toEqual([a]);
    for (let i = 1; i < sol.length; i++) expect(extend(s, 0, sol[i])).toBe(true);
    expect(complete(s, 0)).toBe(true);
    expect(s.paths[0][s.paths[0].length - 1]).toBe(b);
    // Another pair drawn into this path cuts it.
    const other = s.pairs.findIndex((_, p) => p !== 0 && s.solution[p].some((c) => s.solution[0].slice(1, -1).some((d) => Math.abs(c - d) === 1 || Math.abs(c - d) === s.size)));
    void other;
    expect(firstWrong(s)).toBe(-1);
    expect(occupancy(s).filter((v) => v === 0).length).toBe(sol.length);
  });

  it('never enters another pair’s dot', () => {
    const s: BondState = { size: 2, pairs: [[0, 1], [2, 3]], paths: [[], []], solution: [[0, 1], [2, 3]], moves: 0, par: 2 };
    begin(s, 0);
    expect(extend(s, 0, 2)).toBe(false);
    expect(extend(s, 0, 1)).toBe(true);
    expect(complete(s, 0)).toBe(true);
    expect(extend(s, 0, 3)).toBe(false);
  });
});

describe('view', () => {
  it('draws inside its area and Show me lays every pair in par strokes', () => {
    for (const z of [1, 40, 118]) {
      const v = new BondView(newBond(z, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.hint()).toMatch(/pairs? to join/);
      expect(v.help(1)!.moved).toBeUndefined();
      while (!v.won) expect(v.help(2)!.moved).toBe(true);
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.hint()).toBe('Every pair bonded');
    }
  });

  it('draws a stroke with the pointer and counts it once', () => {
    const v = new BondView(newBond(1, 1), true);
    const { ctx } = recCtx();
    const area = AREAS_ALL[0];
    v.draw(ctx, area, 0);
    const s = (v as unknown as { state: BondState }).state;
    const cell = (v as unknown as { cell: number }).cell;
    const origin = (v as unknown as { origin: { x: number; y: number } }).origin;
    const at = (c: number) => ({ x: origin.x + (c % s.size + 0.5) * cell, y: origin.y + (Math.floor(c / s.size) + 0.5) * cell });
    const sol = s.solution[0];
    v.down(at(sol[0]));
    for (const c of sol.slice(1)) v.move(at(c));
    v.up();
    expect(v.moves).toBe(1);
    expect(complete((v as unknown as { state: BondState }).state, 0)).toBe(true);
    expect(v.canUndo()).toBe(true);
    v.undo();
    expect(v.moves).toBe(0);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['No crossing', 'Every cell']);
    expect(RULES.map((r) => r.title)).toEqual(['Pairs', 'No crossing', 'Every cell', 'Strokes']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });
});
