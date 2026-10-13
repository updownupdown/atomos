import { describe, expect, it } from 'vitest';
import { cellPole, clashes, countSolutions, counts, dipoleShape, firstWrong, logicRounds, newDipole, nextForced, put, solved, tap, tiling, type DipoleState, type Setting } from '../src/puzzles/dipole';
import { seeded } from '../src/puzzles/rng';
import { DipoleView, INSTRUCTIONS, RULES } from '../src/puzzles/dipoleView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DS = [1, 6, 12, 13, 20, 25, 37, 45, 51, 60, 65, 79, 85, 91, 100];

const fixedOf = (s: DipoleState): Setting[] => s.set.map((v, i) => (s.given[i] ? v : 0));

describe('tiling', () => {
  it('covers every cell with dominoes of two side-by-side cells', () => {
    for (const [cols, rows] of [[5, 6], [6, 7], [9, 10], [10, 10]]) {
      const { dominoes, owner } = tiling(cols, rows, seeded(cols * rows));
      expect(dominoes.length * 2).toBe(cols * rows);
      expect(owner.every((d) => d >= 0)).toBe(true);
      for (const d of dominoes) {
        const across = d.b === d.a + 1 && d.a % cols !== cols - 1;
        expect(across || d.b === d.a + cols).toBe(true);
      }
    }
  }, 60_000);
});

describe('deals', () => {
  it('is the same deal for the same dial and seed', () => {
    const a = newDipole(50, 9), b = newDipole(50, 9);
    expect(a.solution).toEqual(b.solution);
    expect(a.clues).toEqual(b.clues);
    expect(a.dominoes).toEqual(b.dominoes);
  }, 60_000);

  it('deals exactly one answer, reachable by deduction, keeping every rule, across the dial', () => {
    for (const d of DS) for (const seed of [1, 2, 3, 4]) {
      const s = newDipole(d, seed);
      const shape = dipoleShape(d);
      expect([s.cols, s.rows]).toEqual([shape.cols, shape.rows]);
      expect(countSolutions(s.cols, s.rows, s.dominoes, s.owner, s.clues, fixedOf(s), 2, 1e7)).toBe(1);
      expect(logicRounds(s.cols, s.rows, s.dominoes, s.owner, s.clues, fixedOf(s))).toBeGreaterThanOrEqual(0);
      const done: DipoleState = { ...s, set: s.solution };
      expect(clashes(done).size).toBe(0);
      expect(solved(done)).toBe(true);
      // Shown numbers read off the answer.
      const k = counts(done);
      for (const key of ['rowPlus', 'rowMinus', 'colPlus', 'colMinus'] as const) s.clues[key].forEach((v, i) => { if (v >= 0) expect(v).toBe(k[key][i]); });
      s.given.forEach((g, i) => { if (g) expect(s.set[i]).toBe(s.solution[i]); });
      expect(s.par).toBe(s.solution.filter((v, i) => v !== 3 && !s.given[i]).length);
    }
  }, 60_000);

  it('grows the board and hides more numbers up the dial', () => {
    const hidden = (d: number) => {
      let h = 0;
      for (const seed of [1, 2, 3]) {
        const s = newDipole(d, seed);
        const all = [...s.clues.rowPlus, ...s.clues.rowMinus, ...s.clues.colPlus, ...s.clues.colMinus];
        h += all.filter((v) => v < 0).length / all.length;
      }
      return h;
    };
    expect(hidden(1)).toBe(0);
    expect(hidden(100)).toBeGreaterThan(hidden(35));
    expect(dipoleShape(1).cols * dipoleShape(1).rows).toBeLessThan(dipoleShape(50).cols * dipoleShape(50).rows);
    expect([dipoleShape(100).cols, dipoleShape(100).rows]).toEqual([10, 10]);
    expect(dipoleShape(1).givens).toBeGreaterThan(0);
    expect(dipoleShape(40).givens).toBe(0);
  }, 60_000);

  it('deals quickly, even at the top of the dial', () => {
    for (const d of [100, 90, 75]) {
      const t0 = performance.now();
      for (const seed of [11, 12, 13]) newDipole(d, seed);
      expect((performance.now() - t0) / 3).toBeLessThan(300);
    }
  }, 60_000);
});

describe('play', () => {
  it('cycles a domino from the tapped end: + here, − here, blank, unset', () => {
    const s = newDipole(30, 1);
    const d = s.given.indexOf(false);
    const { a, b } = s.dominoes[d];
    const t1 = tap(s, b)!;
    expect(cellPole(t1, b)).toBe(1);
    expect(cellPole(t1, a)).toBe(2);
    expect(t1.moves).toBe(1);
    const t2 = tap(t1, b)!;
    expect(cellPole(t2, b)).toBe(2);
    const t3 = tap(t2, b)!;
    expect(t3.set[d]).toBe(3);
    expect(t3.moves).toBe(2);
    expect(tap(t3, b)!.set[d]).toBe(0);
    const g = newDipole(1, 1);
    expect(tap(g, g.dominoes[g.given.indexOf(true)].a)).toBeNull();
  }, 60_000);

  it('flags like poles touching', () => {
    const s = newDipole(40, 2);
    // Find two dominoes side by side and set them so like poles meet.
    for (let c = 0; c < s.cols * s.rows; c++) {
      const o = c + 1;
      if (c % s.cols === s.cols - 1 || s.owner[c] === s.owner[o]) continue;
      const set = s.set.map(() => 0) as Setting[];
      const da = s.owner[c], db = s.owner[o];
      set[da] = s.dominoes[da].a === c ? 1 : 2;
      set[db] = s.dominoes[db].a === o ? 1 : 2;
      expect(clashes({ ...s, set }).has(c)).toBe(true);
      return;
    }
  }, 60_000);

  it('solves itself one hint at a time, each step right', () => {
    for (const d of [1, 30, 60, 100]) {
      let s = newDipole(d, 5);
      for (let k = 0; k < 200 && !solved(s); k++) {
        const f = nextForced(s)!;
        expect(f.setting).toBe(s.solution[f.domino]);
        s = put(s, f.domino, f.setting)!;
      }
      expect(solved(s)).toBe(true);
      expect(s.moves).toBe(s.par);
    }
  }, 60_000);

  it('finds a wrong domino', () => {
    const s = newDipole(20, 3);
    const d = s.solution.findIndex((v, i) => v !== 3 && !s.given[i]);
    const w = put(s, d, s.solution[d] === 1 ? 2 : 1)!;
    expect(firstWrong(w)).toBe(d);
    expect(firstWrong(s)).toBe(-1);
  }, 60_000);
});

describe('view', () => {
  it('draws inside its area and reports progress', () => {
    for (const d of [1, 50, 100]) {
      const v = new DipoleView(newDipole(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Met');
      expect(v.hint()).toMatch(/numbers met/);
    }
  }, 60_000);

  it('taps a domino, and undo puts it back', () => {
    const v = new DipoleView(newDipole(30, 4), false);
    const { ctx } = recCtx();
    const area = { x: 0, y: 0, w: 400, h: 500 };
    v.draw(ctx, area, 0);
    // Tap every cell until one changes the board.
    for (let y = 60; y < 460 && !v.canUndo(); y += 10) for (let x = 40; x < 380 && !v.canUndo(); x += 10) { v.down({ x, y }); v.up({ x, y }); }
    expect(v.canUndo()).toBe(true);
    v.draw(ctx, area, 100);
    expect(v.undo()).toBe(true);
    expect(v.canUndo()).toBe(false);
  }, 60_000);

  it('Look here and Show me lead all the way to a win at par', () => {
    for (const d of [1, 40, 80, 100]) {
      const v = new DipoleView(newDipole(d, 7), true);
      const h1 = v.help(1)!;
      expect(h1.text.length).toBeGreaterThan(0);
      expect(h1.moved).toBeUndefined();
      for (let k = 0; k < 200 && !v.won; k++) {
        expect(v.help(1)).not.toBeNull();
        expect(v.help(2)!.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      const { ctx, pts } = recCtx();
      v.draw(ctx, AREAS_ALL[0], 500);
      expect(inside(pts, AREAS_ALL[0])).toBe(true);
    }
  }, 60_000);

  it('Show me mends a wrong magnet first', () => {
    const s = newDipole(30, 6);
    const d = s.solution.findIndex((v, i) => v !== 3 && !s.given[i]);
    const v = new DipoleView(put(s, d, s.solution[d] === 1 ? 2 : 1)!, true);
    expect(v.help(1)!.text).toMatch(/wrong way round/);
    expect(v.help(2)!.moved).toBe(true);
  }, 60_000);

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Numbers', 'Like poles']);
    expect(RULES.map((r) => r.title)).toEqual(['Magnets', 'Numbers', 'Like poles', 'Blanks']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  }, 60_000);
});
