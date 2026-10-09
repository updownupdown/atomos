import { describe, expect, it } from 'vitest';
import { allowedMoves, applyDecay, cellAt, COLS, destination, newDecay, ROWS, shortestPath, solved, stuck, targetLength, type CellKind, type DecayState } from '../src/puzzles/decay';

const SPREAD = [1, 2, 6, 26, 50, 79, 83, 92, 104, 118];

describe('levels', () => {
  it('is the same level for the same seed', () => {
    for (const z of SPREAD) expect(newDecay(z, 7 * z)).toEqual(newDecay(z, 7 * z));
  });

  it('starts on an unstable known tile with a 2–6 step walk to a stable one, and par is that walk', () => {
    for (const z of SPREAD) {
      for (let deal = 0; deal < 4; deal++) {
        const s = newDecay(z, 1000 * z + deal);
        expect(s.cells).toHaveLength(ROWS);
        expect(s.cells.every((r) => r.length === COLS)).toBe(true);
        expect(cellAt(s, s.start)).toBe('unstable');
        expect(solved(s)).toBe(false);
        expect(s.moves).toBe(0);
        const path = shortestPath(s)!;
        expect(path).not.toBeNull();
        expect(path.length).toBeGreaterThanOrEqual(2);
        expect(path.length).toBeLessThanOrEqual(6);
        expect(s.par).toBe(path.length);
        let t = s;
        for (const m of path) t = applyDecay(t, m)!;
        expect(solved(t)).toBe(true);
        expect(t.moves).toBe(s.par);
        expect(t.path).toHaveLength(s.par + 1);
      }
    }
  });

  it('generates for every element', () => {
    for (let z = 1; z <= 118; z++) expect(newDecay(z, z).par).toBeGreaterThanOrEqual(2);
  });

  it('asks for longer walks from heavier elements', () => {
    expect(targetLength(1)).toBe(2);
    expect(targetLength(118)).toBe(5);
    expect(targetLength(50)).toBeGreaterThanOrEqual(targetLength(6));
  });
});

describe('steps', () => {
  it('moves by the three decay shapes', () => {
    expect(destination({ z: 10, n: 12 }, 'alpha')).toEqual({ z: 8, n: 10 });
    expect(destination({ z: 10, n: 12 }, 'betaMinus')).toEqual({ z: 11, n: 11 });
    expect(destination({ z: 10, n: 12 }, 'betaPlus')).toEqual({ z: 9, n: 13 });
  });

  it('only steps onto known nuclides and never mutates the old state', () => {
    const s = newDecay(26, 3);
    const before = JSON.stringify(s);
    for (const m of ['alpha', 'betaMinus', 'betaPlus'] as const) {
      const next = applyDecay(s, m);
      if (allowedMoves(s).includes(m)) {
        expect(next).not.toBeNull();
        expect(next!.pos).toEqual(destination(s.pos, m));
        expect(next!.moves).toBe(1);
        expect(cellAt(s, next!.pos)).not.toBe('none');
      } else {
        expect(next).toBeNull();
      }
    }
    expect(JSON.stringify(s)).toBe(before);
  });

  it('refuses further steps once stable, and knows a dead end', () => {
    const s = newDecay(6, 11);
    let t = s;
    for (const m of shortestPath(s)!) t = applyDecay(t, m)!;
    expect(applyDecay(t, 'betaMinus')).toBeNull();
    expect(stuck(t)).toBe(false);
    const dead: DecayState = { ...t, pos: { z: t.z0, n: t.n0 }, cells: t.cells.map((r) => r.map((): CellKind => 'none')) };
    dead.cells[0][0] = 'unstable';
    expect(stuck(dead)).toBe(true);
    expect(shortestPath(dead)).toBeNull();
  });
});
