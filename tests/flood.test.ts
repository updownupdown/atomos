import { describe, expect, it } from 'vitest';
import { crystal, floodShape, gain, newFlood, outOfMoves, pick, solved, solveFlood, type FloodState } from '../src/puzzles/flood';
import { FloodView, INSTRUCTIONS, layoutFlood, RULES } from '../src/puzzles/floodView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DS = [1, 10, 12, 13, 14, 15, 30, 31, 38, 39, 50, 51, 66, 67, 80, 86, 87, 100];

/** A board from rows of hue letters ('a' is color 0). */
function board(rows: string[], budget = 9): FloodState {
  const cells = rows.join('').split('').map((ch) => ch.charCodeAt(0) - 97);
  return { size: rows.length, colors: Math.max(...cells) + 1, cells, moves: 0, par: budget, budget, exact: true, solution: [], last: null };
}

/** Brute force: the fewest picks that fill a small board. */
function fewest(s: FloodState, limit = 8): number {
  const seen = new Map<string, number>();
  let best = Infinity;
  const rec = (st: FloodState, depth: number) => {
    if (solved(st)) { best = Math.min(best, depth); return; }
    if (depth + 1 >= best || depth >= limit) return;
    const key = st.cells.join('');
    if ((seen.get(key) ?? Infinity) <= depth) return;
    seen.set(key, depth);
    for (let c = 0; c < st.colors; c++) {
      if (!gain(st, c).length) continue;
      rec({ ...pick({ ...st, budget: 99 }, c)!, budget: 99 }, depth + 1);
    }
  };
  rec({ ...s, budget: 99 }, 0);
  return best;
}

describe('dial', () => {
  it('grows the board and its colors, and spends the slack, a step at a time', () => {
    expect(floodShape(1)).toEqual({ size: 5, colors: 3, slack: 4 });
    expect(floodShape(100)).toEqual({ size: 12, colors: 6, slack: 0 });
    let prev = floodShape(1);
    for (let d = 2; d <= 100; d++) {
      const s = floodShape(d);
      expect(s.size - prev.size).toBeGreaterThanOrEqual(0);
      expect(s.size - prev.size).toBeLessThanOrEqual(1);
      expect(s.colors - prev.colors).toBeGreaterThanOrEqual(0);
      expect(s.colors - prev.colors).toBeLessThanOrEqual(1);
      expect(s.slack).toBeLessThanOrEqual(prev.slack);
      prev = s;
    }
  });
});

describe('deals', () => {
  it('deals the same board for the same seed', () => {
    for (const d of [1, 50, 100]) expect(newFlood(d, 7).cells).toEqual(newFlood(d, 7).cells);
    expect(newFlood(50, 1).cells).not.toEqual(newFlood(50, 2).cells);
  });

  it('deals every color, a small crystal, and a par the solver can play', () => {
    for (const d of DS) for (const seed of [1, 2, 3]) {
      const s = newFlood(d, seed);
      const shape = floodShape(d);
      expect(s.size).toBe(shape.size);
      expect(s.cells.length).toBe(s.size * s.size);
      expect(new Set(s.cells).size).toBe(shape.colors);
      expect(crystal(s).size).toBeLessThanOrEqual(Math.max(3, (s.size * s.size) / 8));
      expect(s.budget).toBe(s.par + shape.slack);
      expect(s.solution.length).toBe(s.par);
      let t = { ...s };
      for (const c of s.solution) t = pick(t, c)!;
      expect(solved(t)).toBe(true);
    }
  });

  it('proves par the fewest on small boards', () => {
    for (const d of [1, 10, 20]) for (const seed of [1, 2, 3, 4]) {
      const s = newFlood(d, seed);
      expect(s.exact).toBe(true);
      expect(fewest(s)).toBe(s.par);
    }
    // The bigger boards up to medium are still proved.
    expect([40, 50, 60].map((d) => newFlood(d, 1).exact)).toEqual([true, true, true]);
  });

  it('deals quickly, even at the top of the dial', () => {
    for (const d of [70, 86, 100]) {
      let worst = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const t0 = performance.now();
        newFlood(d, seed);
        worst = Math.max(worst, performance.now() - t0);
      }
      // About 100 ms on a quiet machine; the margin is for a busy test run.
      expect(worst).toBeLessThan(1000);
    }
  });
});

describe('picks', () => {
  it('recolors the crystal, joins touching cells of the color, and counts the pick', () => {
    const s = board(['aab', 'cbb', 'bca']);
    expect([...crystal(s)].sort()).toEqual([0, 1]);
    expect(gain(s, 1).sort((a, b) => a - b)).toEqual([2, 4, 5]);
    expect(gain(s, 0)).toEqual([]);
    const t = pick(s, 1)!;
    expect([...crystal(t)].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5]);
    expect(t.moves).toBe(1);
    expect(t.last!.joined.sort((a, b) => a - b)).toEqual([2, 4, 5]);
    expect(t.last!.dist.get(0)).toBe(0);
    expect(t.last!.dist.get(5)).toBe(3);
    expect(pick(s, 0)).toBeNull(); // the crystal's own color
    expect(s.cells[0]).toBe(0); // the old board is left alone
  });

  it('runs out of picks at the budget', () => {
    let s = board(['abc', 'bca', 'cab'], 2);
    s = pick(s, 2)!;
    s = pick(s, 1)!;
    expect(outOfMoves(s)).toBe(true);
    expect(pick(s, 0)).toBeNull();
  });

  it('the solver finds the fewest on a small board', () => {
    const s = board(['baaa', 'caaa', 'bbbb', 'bbaa']);
    const r = solveFlood(s);
    expect(r.exact).toBe(true);
    expect(r.path).toEqual([2, 1, 0]);
    expect(fewest(s)).toBe(3);
  });
});

describe('view', () => {
  it('draws inside its area, still and mid-ripple', () => {
    for (const d of [1, 50, 100]) {
      const v = new FloodView(newFlood(d, 2), false);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, performance.now());
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.help(2)!.moved).toBe(true);
      const t0 = performance.now();
      for (const ms of [0, 60, 200, 500, 1200]) for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, t0 + ms);
        expect(inside(pts, area), `d ${d} at ${ms} ms`).toBe(true);
      }
      expect(v.hint()).toMatch(/picks? left/);
      expect(v.stats().progress.label).toBe('Grown');
    }
  });

  it('picks by tapping a swatch or a cell, previews while held, and undoes for free', () => {
    const s0 = { ...board(['aab', 'cbb', 'bca'], 4), par: 3 };
    const v = new FloodView(s0, true);
    const area = { x: 0, y: 0, w: 400, h: 500 };
    v.draw(recCtx().ctx, area, 0);
    const L = layoutFlood(area, 3, 3);
    const sw = L.swatches[1];
    const at = { x: sw.x + sw.s / 2, y: sw.y + sw.s / 2 };
    v.down(at);
    v.draw(recCtx().ctx, area, 0); // the preview
    expect(v.moves).toBe(0);
    v.up(at);
    expect(v.moves).toBe(1);
    // A tap on a cell picks its color; on the crystal it does nothing.
    const g = L.board;
    const cell = (i: number) => ({ x: g.x + (i % 3 + 0.5) * g.c, y: g.y + (Math.floor(i / 3) + 0.5) * g.c });
    v.down(cell(0)); v.up(cell(0));
    expect(v.moves).toBe(1);
    v.down(cell(3)); v.up(cell(3));
    expect(v.moves).toBe(2);
    // Sliding off a color drops the pick.
    v.down(cell(8)); v.move({ x: -50, y: -50 }); v.up(cell(8));
    expect(v.moves).toBe(2);
    expect(v.undo()).toBe(true);
    expect(v.moves).toBe(1);
    v.restart();
    expect(v.moves).toBe(0);
    expect(v.canUndo()).toBe(false);
  });

  it('Look here marks without picking; Show me fills the board in par picks', () => {
    for (const d of [1, 30, 60, 86, 100]) {
      const v = new FloodView(newFlood(d, 4), true);
      const h1 = v.help(1)!;
      expect(h1.moved).toBeUndefined();
      expect(h1.text).toMatch(/^Pick /);
      expect(v.moves).toBe(0);
      for (let k = 0; k < 60 && !v.won; k++) expect(v.help(2)!.moved).toBe(true);
      expect(v.won).toBe(true);
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.help(1)).toBeNull();
    }
  });

  it('out of picks: stuck, offers a restart, and says how far to go back', () => {
    const deal = newFlood(30, 3);
    const v = new FloodView(deal, true);
    // Waste picks on colors that join nothing, until the budget is spent.
    for (let k = 0; k < deal.budget; k++) {
      const own = (v as unknown as { state: FloodState }).state;
      const idle = [...Array(own.colors).keys()].find((c) => c !== own.cells[0] && !gain(own, c).length) ?? [...Array(own.colors).keys()].find((c) => c !== own.cells[0])!;
      v.key({ key: String(idle + 1) } as KeyboardEvent);
    }
    expect(v.moves).toBe(deal.budget);
    expect(v.stuck).toBe(true);
    expect(v.won).toBe(false);
    expect(v.hint()).toBe('Out of picks: undo or restart');
    expect(v.action()!.label).toBe('Restart');
    expect(v.help(1)!.text).toMatch(/^(Undo (your last move|\d+ moves) to get back on track|Restart to get back on track)\.$/);
    v.action()!.run();
    expect(v.moves).toBe(0);
    expect(v.stuck).toBe(false);
    expect(v.action()).toBeNull();
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Picks', 'Plan the growth']);
    expect(RULES.map((r) => r.title)).toEqual(['Grow', 'Touching only', 'Picks', 'Plan the growth']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });

  it('plays its rule pictures as their captions say', () => {
    const fill = (rows: string[], picks: number[]) => { let s = board(rows, 9); for (const c of picks) s = pick(s, c)!; return s; };
    expect(solved(fill(['abb', 'bcc', 'cca'], [1, 2, 0]))).toBe(true);
    expect(solved(fill(['abb', 'bcc', 'cca'], [2, 1, 2]))).toBe(false);
    expect(solved(fill(['baaa', 'caaa', 'bbbb', 'bbaa'], [2, 1, 0]))).toBe(true);
    expect(solved(fill(['baaa', 'caaa', 'bbbb', 'bbaa'], [0, 2, 1]))).toBe(false);
  });
});
