import { describe, expect, it } from 'vitest';
import { blocker, counts, countSolutions, cycle, grade, lanesFor, nextForced, newValence, pieces, setBonds, solved, valenceShape, type ValenceState } from '../src/puzzles/valence';
import { INSTRUCTIONS, RULES, ValenceView } from '../src/puzzles/valenceView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DS = [1, 10, 20, 21, 35, 40, 41, 55, 60, 61, 75, 80, 81, 90, 100];

/** A hand-made board: atoms as [x, y, need]. */
function board(cols: number, rows: number, atoms: [number, number, number][]): ValenceState {
  const at = atoms.map(([x, y, need]) => ({ x, y, need }));
  const lanes = lanesFor(cols, rows, at);
  return { cols, rows, atoms: at, lanes, bonds: lanes.map(() => 0), solution: lanes.map(() => 0), moves: 0, par: 0, depth: 0, looks: 0 };
}

describe('lanes', () => {
  it('joins atoms that see each other and finds lanes that cross', () => {
    const s = board(3, 3, [[1, 0, 1], [0, 1, 1], [2, 1, 1], [1, 2, 1]]);
    expect(s.lanes.length).toBe(2);
    expect(s.lanes[0].cross).toEqual([1]);
    const a = cycle(s, 0)!;
    expect(a.bonds[0]).toBe(1);
    expect(blocker(a, 1)).toBe(0);
    expect(cycle(a, 1)).toBeNull();
  });

  it('cycles none, single, double, none and counts a move each time', () => {
    const s = board(3, 1, [[0, 0, 2], [2, 0, 2]]);
    let t = cycle(s, 0)!;
    expect(t.bonds[0]).toBe(1);
    t = cycle(t, 0)!;
    expect(t.bonds[0]).toBe(2);
    expect(counts(t)).toEqual([2, 2]);
    expect(solved(t)).toBe(true);
    t = cycle(t, 0)!;
    expect(t.bonds[0]).toBe(0);
    expect(t.moves).toBe(3);
  });

  it('needs one molecule, not just every count met', () => {
    const s = board(3, 3, [[0, 0, 1], [2, 0, 1], [0, 2, 1], [2, 2, 1]]);
    const top = s.lanes.findIndex((l) => l.a === 0 && l.b === 1);
    const bottom = s.lanes.findIndex((l) => l.a === 2 && l.b === 3);
    const t = setBonds(setBonds(s, top, 1)!, bottom, 1)!;
    expect(counts(t)).toEqual([1, 1, 1, 1]);
    expect(new Set(pieces(t)).size).toBe(2);
    expect(solved(t)).toBe(false);
    // That board has no answer at all, and the solver says so.
    expect(countSolutions(s.atoms, s.lanes)).toBe(0);
    expect(grade(s.atoms, s.lanes).ok).toBe(false);
  });
});

describe('deals', () => {
  it('grows the board along the dial', () => {
    expect(valenceShape(1)).toMatchObject({ cols: 7, rows: 7 });
    expect(valenceShape(100)).toMatchObject({ cols: 10, rows: 13 });
    let last = 0;
    for (let d = 1; d <= 100; d++) {
      const sh = valenceShape(d);
      const cells = sh.cols * sh.rows;
      expect(cells).toBeGreaterThanOrEqual(last);
      last = cells;
    }
  });

  it('is the same deal for the same dial and seed', () => {
    expect(newValence(55, 9)).toEqual(newValence(55, 9));
    expect(newValence(55, 9).solution).not.toEqual(newValence(55, 10).solution);
  });

  it('deals boards with exactly one answer, found by deduction, across the dial', () => {
    for (const d of DS) for (const seed of [1, 2, 3]) {
      const s = newValence(d, seed);
      const sh = valenceShape(d);
      expect(s.cols).toBe(sh.cols);
      expect(s.rows).toBe(sh.rows);
      for (const a of s.atoms) { expect(a.need).toBeGreaterThanOrEqual(1); expect(a.need).toBeLessThanOrEqual(8); }
      const full = { ...s, bonds: s.solution };
      expect(solved(full)).toBe(true);
      const g = grade(s.atoms, s.lanes, sh.maxDepth);
      expect(g.solved).toBe(true);
      expect(g.depth).toBe(s.depth);
      expect(s.depth).toBeLessThanOrEqual(sh.maxDepth);
      expect(countSolutions(s.atoms, s.lanes)).toBe(1);
      expect(s.par).toBe(s.solution.reduce((a, b) => a + b, 0));
    }
  });

  it('needs deeper deduction higher on the dial', () => {
    const depth = (d: number) => [1, 2, 3, 4, 5, 6].map((seed) => newValence(d, seed).depth);
    expect(depth(5).every((v) => v === 0)).toBe(true);
    expect(Math.max(...depth(95))).toBe(2);
  });

  it('deals quickly', () => {
    const t0 = performance.now();
    for (const seed of [1, 2, 3, 4, 5]) newValence(100, seed);
    // A few milliseconds to a couple of hundred each; roomy here so a busy machine does not fail it.
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe('hints', () => {
  it('solves itself one forced bond at a time', () => {
    for (const d of [1, 30, 50, 70, 100]) for (const seed of [4, 5]) {
      let s = newValence(d, seed);
      for (let k = 0; k < 300 && !solved(s); k++) {
        const f = nextForced(s)!;
        expect(f).not.toBeNull();
        expect(f.bonds).toBeLessThanOrEqual(s.solution[f.lane]);
        s = setBonds(s, f.lane, f.bonds)!;
      }
      expect(solved(s)).toBe(true);
    }
  });
});

describe('view', () => {
  it('draws inside its area and reports progress', () => {
    for (const d of [1, 60, 100]) {
      const v = new ValenceView(newValence(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Bonded');
      expect(v.hint()).toMatch(/atoms? to bond/);
    }
  });

  it('bonds by a drag from an atom, refuses a crossing, and undoes', () => {
    const v = new ValenceView(newValence(1, 1), true);
    const { ctx } = recCtx();
    const area = { x: 0, y: 0, w: 400, h: 400 };
    v.draw(ctx, area, 0);
    const s = (v as unknown as { state: ValenceState }).state;
    const l = s.lanes[0];
    const c = (v as unknown as { cell: number }).cell;
    const o = (v as unknown as { origin: { x: number; y: number } }).origin;
    const a = s.atoms[l.a], b = s.atoms[l.b];
    const at = (p: { x: number; y: number }) => ({ x: o.x + (p.x + 0.5) * c, y: o.y + (p.y + 0.5) * c });
    v.down(at(a));
    v.move(at(b));
    v.up(at(b));
    expect(v.moves).toBe(1);
    expect((v as unknown as { state: ValenceState }).state.bonds[0]).toBe(1);
    expect(v.canUndo()).toBe(true);
    v.undo();
    expect(v.moves).toBe(0);
  });

  it('points somewhere, Show me plays, and the chain of hints wins', () => {
    for (const d of [1, 50, 100]) {
      const v = new ValenceView(newValence(d, 3), true);
      const h1 = v.help(1)!;
      expect(h1.text.length).toBeGreaterThan(0);
      expect(h1.moved).toBeUndefined();
      let k = 0;
      while (!v.won && k++ < 400) {
        expect(v.help(1)).not.toBeNull();
        expect(v.help(2)!.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.hint()).toBe('One molecule, every atom bonded');
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      const { ctx, pts } = recCtx();
      v.draw(ctx, AREAS_ALL[0], 0);
      expect(inside(pts, AREAS_ALL[0])).toBe(true);
    }
  });

  it('corrects a wrong bond first', () => {
    const v = new ValenceView(newValence(30, 1), true);
    const s = (v as unknown as { state: ValenceState }).state;
    const k = s.solution.findIndex((x, i) => x === 0 && s.lanes[i].cross.length === 0);
    if (k < 0) return;
    (v as unknown as { state: ValenceState }).state = setBonds(s, k, 1)!;
    expect(v.help(1)!.text).toMatch(/not part of the molecule/);
    expect(v.help(2)!.moved).toBe(true);
    expect((v as unknown as { state: ValenceState }).state.bonds[k]).toBe(0);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Bond count', 'No crossing', 'One molecule']);
    expect(RULES.map((r) => r.title)).toEqual(['Bonds', 'Bond count', 'No crossing', 'One molecule']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  });
});
