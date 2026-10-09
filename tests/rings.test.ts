import { describe, expect, it } from 'vitest';
import { applyMove, canHop, inverse, moveCost, newRings, shellCounts, solved, solvedRings, solveGreedy, stepsToTop, topSlot } from '../src/puzzles/rings';

describe('shells', () => {
  it('fills shells in the real order', () => {
    expect(shellCounts(1)).toEqual([1]);
    expect(shellCounts(10)).toEqual([2, 8]);
    expect(shellCounts(19)).toEqual([2, 8, 8, 1]); // potassium: 4s before 3d
    expect(shellCounts(26)).toEqual([2, 8, 14, 2]);
  });

  it('lays out 2n² slots per ring with one spare ring outside', () => {
    const rings = solvedRings(3);
    expect(rings.map((r) => r.slots)).toEqual([2, 8, 18]);
    expect(rings[0].sockets.filter(Boolean)).toHaveLength(2);
    expect(rings[1].sockets.filter(Boolean)).toHaveLength(1);
    expect(rings[2].sockets.filter(Boolean)).toHaveLength(0);
    expect(solved({ rings, moves: 0, par: 0 })).toBe(true);
  });

  it('colours neon\'s second shell as two s sockets and six p sockets', () => {
    const r = solvedRings(10)[1];
    expect(r.sockets.filter((k) => k === 's')).toHaveLength(2);
    expect(r.sockets.filter((k) => k === 'p')).toHaveLength(6);
  });
});

describe('moves', () => {
  it('rotation brings the chosen slot to the gate', () => {
    const r = solvedRings(10)[1];
    for (let slot = 0; slot < r.slots; slot++) {
      const steps = stepsToTop(r, slot);
      expect(Math.abs(steps)).toBeLessThanOrEqual(4);
      const s = applyMove({ rings: [r], moves: 0, par: 0 }, { kind: 'rotate', ring: 0, steps })!;
      expect(topSlot(steps ? s.rings[0] : r)).toBe(slot);
    }
  });

  it('hops only from a filled gate slot to an empty one', () => {
    const s = { rings: solvedRings(1), moves: 0, par: 0 };
    expect(canHop(s, 0, true)).toBe(true);
    expect(canHop(s, 1, false)).toBe(false);
    const out = applyMove(s, { kind: 'hop', ring: 0, outward: true })!;
    expect(out.rings[0].cells[topSlot(out.rings[0])]).toBe(false);
    expect(out.rings[1].cells[topSlot(out.rings[1])]).toBe(true);
    expect(solved(out)).toBe(false);
    const back = applyMove(out, inverse({ kind: 'hop', ring: 0, outward: true }))!;
    expect(solved(back)).toBe(true);
  });
});

describe('levels', () => {
  it('generates a scrambled level the planner can solve, for every prototype element', () => {
    for (let z = 1; z <= 10; z++) {
      const level = newRings(z, 1000 + z);
      expect(solved(level)).toBe(false);
      expect(level.moves).toBe(0);
      const plan = solveGreedy(level)!;
      expect(plan).not.toBeNull();
      let s = level;
      for (const m of plan) s = applyMove(s, m)!;
      expect(solved(s)).toBe(true);
      expect(level.par).toBe(plan.reduce((c, m) => c + moveCost(m), 0));
      expect(level.par).toBeGreaterThan(0);
    }
  });

  it('is the same level for the same seed', () => {
    expect(newRings(6, 5)).toEqual(newRings(6, 5));
  });
});
