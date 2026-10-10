import { describe, expect, it } from 'vitest';
import { conflicts, countSolutions, cycleValue, EMPTY, newOrbitalGrid, place, solveBySingles, solved, specFor, symbolOf, units } from '../src/puzzles/orbitalGrid';

const SPREAD = [1, 2, 10, 18, 19, 36, 54, 55, 79, 92, 118];

describe('levels', () => {
  it('is the same grid for the same seed', () => {
    expect(newOrbitalGrid(40, 7)).toEqual(newOrbitalGrid(40, 7));
  });

  it('grows from 4x4 to 6x6 to 8x8 with the periods', () => {
    expect(specFor(1).size).toBe(4);
    expect(specFor(18).size).toBe(4);
    expect(specFor(19).size).toBe(6);
    expect(specFor(54).size).toBe(6);
    expect(specFor(55).size).toBe(8);
    expect(specFor(118).size).toBe(8);
    expect(specFor(1).spin).toBe(false);
    expect(specFor(19).spin).toBe(true);
  });

  it('has a valid full solution, a unique answer, singles-solvable givens and par = empty cells', () => {
    for (const z of SPREAD) {
      for (let seed = 1; seed <= 6; seed++) {
        const s = newOrbitalGrid(z, seed);
        const n = s.size;
        for (const u of units(n, s.rh, s.rw)) expect(new Set(u.map((i) => s.solution[i])).size).toBe(n);
        s.cells.forEach((v, i) => {
          if (v !== EMPTY) expect(v).toBe(s.solution[i]);
          expect(s.givens[i]).toBe(v !== EMPTY);
        });
        expect(solveBySingles(n, s.rh, s.rw, s.cells)).toEqual(s.solution);
        expect(countSolutions(n, s.rh, s.rw, s.cells, 2)).toBe(1);
        expect(s.par).toBe(s.cells.filter((v) => v === EMPTY).length);
        expect(s.par).toBe(specFor(z).empties);
      }
    }
  });

  it('leaves more cells empty for heavier elements within a size', () => {
    expect(specFor(18).empties).toBeGreaterThan(specFor(1).empties);
    expect(specFor(54).empties).toBeGreaterThan(specFor(19).empties);
    expect(specFor(118).empties).toBeGreaterThan(specFor(55).empties);
  });

  it('generates fast for every element', () => {
    for (let z = 1; z <= 118; z++) {
      const t = performance.now();
      newOrbitalGrid(z, z * 31 + 5);
      expect(performance.now() - t).toBeLessThan(150);
    }
  });
});

describe('symbols', () => {
  it('labels plain and spin symbols', () => {
    expect(symbolOf(false, 3)).toEqual({ orbital: 'f', up: null });
    expect(symbolOf(true, 0)).toEqual({ orbital: 's', up: true });
    expect(symbolOf(true, 5)).toEqual({ orbital: 'd', up: false });
    expect(symbolOf(true, 7)).toEqual({ orbital: 'f', up: false });
  });
});

describe('playing', () => {
  it('places, refuses givens, flags clashes and wins on the solution', () => {
    const s = newOrbitalGrid(5, 3);
    const given = s.givens.indexOf(true);
    expect(place(s, given, EMPTY)).toBeNull();
    const empties = s.cells.map((v, i) => (v === EMPTY ? i : -1)).filter((i) => i >= 0);
    // A clash: put a given's symbol into an empty cell of the same row.
    const n = s.size;
    let clashCell = -1, sym = -1;
    for (const i of empties) {
      const r = Math.floor(i / n);
      for (let c = 0; c < n; c++) if (s.givens[r * n + c]) { clashCell = i; sym = s.cells[r * n + c]; break; }
      if (clashCell >= 0) break;
    }
    const bad = place(s, clashCell, sym)!;
    expect(conflicts(bad)[clashCell]).toBe(true);
    let w = s;
    for (const i of empties) w = place(w, i, s.solution[i])!;
    expect(solved(w)).toBe(true);
    expect(w.moves).toBe(s.par);
    expect(conflicts(w).some(Boolean)).toBe(false);
  });

  it('counts a run of edits to one cell as one placement', () => {
    const s = newOrbitalGrid(30, 1);
    const i = s.cells.indexOf(EMPTY);
    let t = place(s, i, cycleValue(s, i))!;
    t = place(t, i, cycleValue(t, i))!;
    t = place(t, i, cycleValue(t, i))!;
    expect(t.moves).toBe(1);
    const j = t.cells.indexOf(EMPTY);
    t = place(t, j, 0)!;
    t = place(t, i, EMPTY)!;
    expect(t.moves).toBe(3);
  });

  it('cycles from empty through every symbol and back to empty', () => {
    const s = newOrbitalGrid(1, 1);
    const i = s.cells.indexOf(EMPTY);
    let t = s;
    const seen: number[] = [];
    for (let k = 0; k <= s.size; k++) {
      t = place(t, i, cycleValue(t, i))!;
      seen.push(t.cells[i]);
    }
    expect(seen).toEqual([0, 1, 2, 3, EMPTY]);
  });
});
