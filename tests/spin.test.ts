import { describe, expect, it } from 'vitest';
import { countSolutions, flaws, newSpin, nextForced, set, solved, spinSize, tap, type SpinState } from '../src/puzzles/spin';
import { INSTRUCTIONS, RULES, SpinView } from '../src/puzzles/spinView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const ZS = [1, 2, 3, 10, 18, 36, 56, 57, 86, 104, 118];

describe('deals', () => {
  it('sizes the grid by element and deals one answer that keeps every rule', () => {
    expect(spinSize(1)).toBe(4);
    expect(spinSize(20)).toBe(6);
    expect(spinSize(57)).toBe(8);
    for (const z of ZS) for (const seed of [1, 2]) {
      const s = newSpin(z, seed);
      expect(s.cells.length).toBe(s.size * s.size);
      expect(countSolutions(s.size, s.cells, s.links)).toBe(1);
      const full: SpinState = { ...s, cells: s.solution };
      expect(solved(full)).toBe(true);
      expect(flaws(full).size).toBe(0);
      // Givens agree with the answer, and every link reads off it.
      s.given.forEach((g, i) => { if (g) expect(s.cells[i]).toBe(s.solution[i]); });
      for (const l of s.links) expect(s.solution[l.a] === s.solution[l.b]).toBe(l.same);
      expect(s.par).toBeGreaterThan(0);
    }
  });

  it('deals fewer givens for heavier elements', () => {
    const share = (z: number) => { const s = newSpin(z, 3); return s.given.filter(Boolean).length / s.cells.length; };
    expect(share(2)).toBeGreaterThan(share(40));
    expect(share(40)).toBeGreaterThan(share(118));
  });

  it('deals quickly', () => {
    const t0 = performance.now();
    for (const z of ZS) newSpin(z, 7);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('play', () => {
  it('cycles a cell with taps, never a given', () => {
    const s = newSpin(10, 1);
    const i = s.given.indexOf(false);
    const g = s.given.indexOf(true);
    expect(tap(s, g)).toBeNull();
    const a = tap(s, i)!;
    expect(a.cells[i]).toBe(1);
    expect(tap(a, i)!.cells[i]).toBe(2);
    expect(tap(tap(a, i)!, i)!.cells[i]).toBe(0);
    expect(a.moves).toBe(1);
  });

  it('flags a run of three, an overfull line and a broken link', () => {
    const base = newSpin(1, 1);
    const empty: SpinState = { ...base, cells: Array(16).fill(0), given: Array(16).fill(false), links: [] };
    const run = { ...empty, cells: empty.cells.map((_, i) => (i < 3 ? 1 : 0)) as SpinState['cells'] };
    expect([...flaws(run)].sort()).toEqual([0, 1, 2]);
    const over = { ...empty, cells: empty.cells.map((_, i) => (i === 0 || i === 1 || i === 3 ? 1 : 0)) as SpinState['cells'] };
    expect(flaws(over).has(3)).toBe(true);
    const linked = { ...empty, cells: empty.cells.map((_, i) => (i === 0 ? 1 : i === 1 ? 2 : 0)) as SpinState['cells'], links: [{ a: 0, b: 1, same: true }] };
    expect([...flaws(linked)].sort()).toEqual([0, 1]);
  });

  it('solves itself one forced cell at a time', () => {
    for (const z of [1, 10, 36, 86]) {
      let s = newSpin(z, 5);
      for (let k = 0; k < 200 && !solved(s); k++) {
        const f = nextForced(s)!;
        expect(f.spin).toBe(s.solution[f.cell]);
        s = set(s, f.cell, f.spin)!;
      }
      expect(solved(s)).toBe(true);
    }
  });
});

describe('view', () => {
  it('draws inside its area and reports progress', () => {
    for (const z of [1, 20, 118]) {
      const v = new SpinView(newSpin(z, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Filled');
      expect(v.hint()).toMatch(/cells? left/);
    }
  });

  it('points at a wrong spin, then at a forced one, and Show me plays it', () => {
    const v = new SpinView(newSpin(10, 1), true);
    const h1 = v.help(1)!;
    expect(h1.moved).toBeUndefined();
    const h2 = v.help(2)!;
    expect(h2.moved).toBe(true);
    expect(v.moves).toBe(1);
    expect(v.canUndo()).toBe(true);
    v.undo();
    expect(v.moves).toBe(0);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Balance', 'No three', 'Links']);
    expect(RULES.map((r) => r.title)).toEqual(['Spins', 'Balance', 'No three', 'Links']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  });
});
