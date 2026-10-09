import { describe, expect, it } from 'vitest';
import { check, clearPath, edgeKey, extend, newLines, pathEdges, regions, retract, satisfies, sizeFor, solved, verdict, type Pt } from '../src/puzzles/lines';

const SPREAD = [1, 6, 26, 50, 92, 118];

function drawPath(s0: ReturnType<typeof newLines>, path: Pt[]) {
  let s = s0;
  for (const n of path) {
    const next = extend(s, n);
    expect(next).not.toBeNull();
    s = next!;
  }
  return s;
}

describe('edges and regions', () => {
  it('names an edge the same from either end', () => {
    expect(edgeKey({ x: 1, y: 2 }, { x: 1, y: 1 })).toBe(edgeKey({ x: 1, y: 1 }, { x: 1, y: 2 }));
    expect(pathEdges([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]).size).toBe(2);
  });

  it('splits a 2x2 grid in two with a line down the middle', () => {
    const reg = regions(2, 2, [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }]);
    expect(reg[0]).toBe(reg[2]);
    expect(reg[1]).toBe(reg[3]);
    expect(reg[0]).not.toBe(reg[1]);
    expect(new Set(regions(2, 2, [])).size).toBe(1);
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    expect(newLines(50, 5)).toEqual(newLines(50, 5));
    expect(newLines(50, 5)).not.toEqual(newLines(50, 6));
  });

  it('is solvable by its hidden walk and has marks of every kind', () => {
    for (const z of SPREAD) for (let deal = 0; deal < 6; deal++) {
      const s = newLines(z, z * 31 + deal);
      const { cols, rows } = sizeFor(z);
      expect(s.cols).toBe(cols);
      expect(s.rows).toBe(rows);
      expect(s.path).toEqual([]);
      expect(s.moves).toBe(0);
      expect(s.par).toBe(1);
      expect(s.won).toBe(false);
      expect(s.solution[0]).toEqual(s.start);
      expect(s.solution[s.solution.length - 1]).toEqual(s.end);
      expect(s.dots.length).toBeGreaterThan(0);
      expect(s.colours.filter(Boolean).length).toBeGreaterThanOrEqual(2);
      expect(new Set(s.colours.filter(Boolean)).size).toBeGreaterThanOrEqual(2);
      expect(satisfies(s, s.solution)).toBe(true);
      // The walk never crosses itself.
      expect(new Set(s.solution.map((p) => `${p.x},${p.y}`)).size).toBe(s.solution.length);
      // An empty path and the bare start fail.
      expect(satisfies(s, [])).toBe(false);
      expect(satisfies(s, [s.start])).toBe(false);
    }
  });

  it('grows the grid with z', () => {
    expect(sizeFor(1).cols).toBe(4);
    expect(sizeFor(118).cols).toBe(6);
    expect(sizeFor(1).dots).toBeLessThan(sizeFor(118).dots);
  });
});

describe('drawing', () => {
  it('starts only at the start node, extends to neighbours, retracts over the previous node', () => {
    const s0 = newLines(6, 1);
    const off = { x: s0.start.x === 0 ? s0.cols : 0, y: s0.start.y };
    expect(extend(s0, off)).toBeNull();
    const s1 = extend(s0, s0.start)!;
    expect(s1.path).toEqual([s0.start]);
    const dx = s0.start.x === 0 ? 1 : -1;
    const n1 = { x: s0.start.x + dx, y: s0.start.y };
    const s2 = extend(s1, n1)!;
    expect(s2.path).toHaveLength(2);
    expect(extend(s2, { x: n1.x + dx * 2, y: n1.y })).toBeNull(); // not adjacent
    expect(extend(s2, s0.start)!.path).toEqual([s0.start]); // retract
    expect(retract(s2)!.path).toEqual([s0.start]);
    expect(clearPath(s2)!.path).toEqual([]);
    expect(s0.path).toEqual([]);
    expect(s1.path).toHaveLength(1);
  });

  it('never revisits a node', () => {
    const s0 = newLines(6, 2);
    const s = drawPath(s0, s0.solution);
    expect(extend(s, s0.solution[0])).toBeNull();
  });

  it('counts each check as a move and wins only on a complete, lawful path', () => {
    const s0 = newLines(26, 9);
    const partial = drawPath(s0, s0.solution.slice(0, 3));
    const miss = check(partial);
    expect(miss.moves).toBe(1);
    expect(solved(miss)).toBe(false);
    expect(miss.path).toEqual(partial.path); // the line stays for editing
    const full = drawPath(miss, s0.solution.slice(3));
    const win = check(full);
    expect(win.moves).toBe(2);
    expect(solved(win)).toBe(true);
    expect(extend(win, s0.start)).toBeNull();
  });

  it('reports which marks a wrong path breaks', () => {
    const s0 = newLines(92, 4);
    // Walk straight along the border from start to the nearest corner-adjacent path: no regions cut, dots likely missed.
    const v = verdict(s0, [s0.start]);
    expect(v.complete).toBe(false);
    expect(v.missed).toEqual(s0.dots);
    expect(v.clashes.length).toBeGreaterThan(0);
    const good = verdict(s0, s0.solution);
    expect(good).toEqual({ complete: true, missed: [], clashes: [] });
  });
});
