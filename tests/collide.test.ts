import { describe, expect, it } from 'vitest';
import {
  bestSwap, collideShape, findRuns, greedyMoves, JET_COL, JET_ROW, kindOf, legalSwaps, lookMoves, makeTile, newCollide, outOfMoves,
  rawCollide, SHOWER, SHOWER_TILE, solved, specOf, swap, type CollideState,
} from '../src/puzzles/collide';
import { CollideView, INSTRUCTIONS, RULES } from '../src/puzzles/collideView';
import { randInt, seeded } from '../src/puzzles/rng';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DS = [1, 10, 15, 16, 20, 21, 30, 31, 40, 41, 50, 60, 61, 75, 80, 81, 90, 100];

/** A board from rows of digits (kinds), with fixed refills per column. */
function board(rows: string[], feed: string[], extra: Partial<CollideState> = {}): CollideState {
  const h = rows.length, w = rows[0].length;
  const cells: number[] = [];
  for (const line of rows) for (const ch of line) cells.push(ch === '*' ? SHOWER_TILE : Number(ch));
  return {
    w, h, kinds: 6, seed: 1, cells, drawn: new Array(w).fill(0), targets: [{ kind: 0, need: 99 }], got: [0, 0, 0, 0, 0, 0],
    budget: 20, moves: 0, par: 20, feed: feed.map((f) => [...f].map(Number)), last: null, ...extra,
  };
}

describe('dial', () => {
  it('grows the board, the kinds and the targets along the dial', () => {
    expect(collideShape(1)).toMatchObject({ w: 7, h: 7, kinds: 5, targetKinds: 1 });
    expect(collideShape(100)).toMatchObject({ w: 8, h: 8, kinds: 6, targetKinds: 3 });
    let prevNeed = 0, prevTk = 0;
    for (let d = 1; d <= 100; d++) {
      const s = collideShape(d);
      expect(s.budget).toBeGreaterThan(5);
      if (s.targetKinds === prevTk && s.kinds === collideShape(d - 1).kinds) expect(s.need).toBeGreaterThanOrEqual(prevNeed);
      prevNeed = s.need;
      prevTk = s.targetKinds;
    }
  });
});

describe('deals', () => {
  it('is the same deal for the same dial and seed', () => {
    for (const d of [1, 50, 100]) {
      const a = newCollide(d, 42), b = newCollide(d, 42);
      expect(a.cells).toEqual(b.cells);
      expect(a.targets).toEqual(b.targets);
      expect(a.seed).toBe(b.seed);
      expect(newCollide(d, 43).cells).not.toEqual(a.cells);
    }
  });

  it('deals boards with no line yet, a swap to make, and a win greedy play reaches within the budget', () => {
    for (const d of DS) for (let seed = 1; seed <= 6; seed++) {
      const s = newCollide(d, seed);
      const shape = collideShape(d);
      expect(s.w).toBe(shape.w);
      expect(s.h).toBe(shape.h);
      expect(s.targets.length).toBe(shape.targetKinds);
      expect(new Set(s.targets.map((t) => t.kind)).size).toBe(shape.targetKinds);
      for (const t of s.targets) expect(t.kind).toBeLessThan(s.kinds);
      expect(findRuns(s.cells, s.w, s.h)).toEqual([]);
      expect(legalSwaps(s).length).toBeGreaterThan(0);
      expect(s.par).toBe(s.budget);
      expect(greedyMoves(s)).toBeLessThanOrEqual(s.budget);
    }
  });

  it('sets budgets greedy play nearly always meets, and a one-look player meets less often up the dial', () => {
    // The rates the budgets were tuned to (see BUDGETS in collide.ts), on raw deals before the
    // greedy check: greedy wins nearly all; the one-look player most at the bottom, about half
    // to two thirds at the top.
    const rate = (d: number, n: number, f: (s: CollideState) => boolean) => {
      let k = 0;
      for (let seed = 1; seed <= n; seed++) if (f(rawCollide(d, seed * 977))) k++;
      return k / n;
    };
    const greedy = (s: CollideState) => greedyMoves(s) <= s.budget;
    const look = (s: CollideState) => lookMoves(s, s.budget) <= s.budget;
    expect(rate(1, 30, greedy)).toBeGreaterThanOrEqual(0.95);
    expect(rate(100, 30, greedy)).toBeGreaterThanOrEqual(0.85);
    expect(rate(1, 30, look)).toBeGreaterThanOrEqual(0.9);
    const top = rate(100, 30, look);
    expect(top).toBeGreaterThan(0.25);
    expect(top).toBeLessThan(0.9);
  }, 30000);

  it('deals quickly, even at the top of the dial', () => {
    let worst = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const t0 = performance.now();
      newCollide(100, seed);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(300);
  });
});

describe('swaps', () => {
  it('clears a line, drops the tiles above and refills from the column streams', () => {
    // Swapping the 2 at (1,0) with the 0 below lines up three 0s along the top.
    const s = board(['0203', '1031', '2312'], ['3', '1', '2', '0']);
    expect(swap(s, 0, 2)).toBeNull();
    const t = swap(s, 1, 5)!;
    expect(t.moves).toBe(1);
    expect(t.got[0]).toBe(3);
    expect(t.last!.steps.length).toBe(1);
    expect(t.last!.steps[0].clear).toEqual([0, 1, 2]);
    expect(t.cells.slice(0, 4)).toEqual([3, 1, 2, 3]);
    expect(t.drawn).toEqual([1, 1, 1, 0]);
    // The same swap from the same board always plays out the same.
    expect(swap(s, 1, 5)!.cells).toEqual(t.cells);
  });

  it('slides back from a swap that makes nothing, without a move', () => {
    const s = board(['0203', '1031', '2312'], ['3', '1', '2', '0']);
    const t = swap(s, 6, 7)!;
    expect(t.last!.bounce).toBe(true);
    expect(t.moves).toBe(0);
    expect(t.cells).toEqual(s.cells);
    expect(swap(s, 6, 7, false)).toBeNull();
  });

  it('cascades when the fallen tiles line up', () => {
    const s = board(['1313', '3201', '0022'], ['4', '02', '43', '0']);
    const t = swap(s, 6, 10)!;
    expect(t.last!.steps.length).toBe(2);
    expect(t.got[0]).toBe(3);
    expect(t.got[2]).toBe(3);
  });

  it('makes a jet from four, and the jet clears its row when it goes', () => {
    const s = board(['0100', '0032', '3213'], ['24', '3', '02', '34']);
    const a = swap(s, 1, 5)!;
    expect(a.cells[1]).toBe(makeTile(0, JET_ROW));
    const b = swap(a, 0, 4)!;
    const st = b.last!.steps[0];
    expect(st.jets).toEqual([{ cell: 1, dir: 1 }]);
    expect(st.clear).toEqual([0, 1, 2, 3]);
    expect(specOf(b.cells[1])).toBe(0);
  });

  it('makes a column jet from four down a column', () => {
    const s = board(['01', '02', '10', '04', '25'], ['3', '4']);
    const n = swap(s, 4, 5)!;
    const jet = n.cells.find((c) => specOf(c) === JET_COL);
    expect(jet).toBeDefined();
    expect(kindOf(jet!)).toBe(0);
  });

  it('makes a shower from five, and a shower swapped with a tile clears its whole kind', () => {
    const s = board(['00100', '12021', '23432'], ['3', '4', '5', '4', '3']);
    const t = swap(s, 2, 7)!;
    expect(t.cells.filter((c) => specOf(c) === SHOWER).length).toBe(1);
    const sh = board(['*121', '1312', '2131'], ['30', '4', '04', '43']);
    const u = swap(sh, 0, 1)!;
    expect(u.got[1]).toBe(6);
    expect(u.last!.steps[0].showers[0].kind).toBe(1);
  });

  it('reshuffles a board left with no swap to make, the same way every time', () => {
    // Small boards of six kinds often run dry after a swap; each must come back with a swap.
    const base = newCollide(50, 3);
    let shuffled = 0;
    for (let seed = 1; seed <= 400 && shuffled < 5; seed++) {
      const rng = seeded(seed);
      const cells: number[] = [];
      for (let i = 0; i < 16; i++) {
        let k: number;
        do k = randInt(rng, 6); while ((i % 4 >= 2 && cells[i - 1] === k && cells[i - 2] === k) || (i >= 8 && cells[i - 4] === k && cells[i - 8] === k));
        cells.push(k);
      }
      const s: CollideState = { ...base, w: 4, h: 4, kinds: 6, seed, cells, drawn: [0, 0, 0, 0], targets: [{ kind: 0, need: 99 }] };
      const m = legalSwaps(s)[0];
      if (!m) continue;
      const t = swap(s, m[0], m[1])!;
      if (!t.last!.shuffledFrom) continue;
      shuffled++;
      expect(findRuns(t.cells, 4, 4)).toEqual([]);
      expect(legalSwaps(t).length).toBeGreaterThan(0);
      expect(swap(s, m[0], m[1])!.cells).toEqual(t.cells);
    }
    expect(shuffled).toBeGreaterThan(0);
  });

  it('stops at the budget: out of moves', () => {
    const s = board(['0203', '1031', '2312'], ['3', '1', '2', '0'], { budget: 1, par: 1 });
    const t = swap(s, 1, 5)!;
    expect(outOfMoves(t)).toBe(true);
    expect(swap(t, 4, 5)).toBeNull();
  });
});

describe('view', () => {
  it('draws inside its area, also partway through a swap', () => {
    for (const d of [1, 50, 100]) {
      const v = new CollideView(newCollide(d, 2), false);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.hint()).toMatch(/moves? left/);
      expect(v.stats().progress.label).toBe('Collected');
      expect(v.stats().par.label).toBe('Budget');
      v.help(2);
      const t0 = performance.now();
      for (let ms = 0; ms < 3000; ms += 37) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, AREAS_ALL[0], t0 + ms);
        expect(inside(pts, AREAS_ALL[0]), `${d} at ${ms}`).toBe(true);
      }
    }
  });

  it('wins with Show me alone within the budget, and Look here marks a swap first', () => {
    for (const d of [1, 30, 60, 100]) for (const seed of [1, 2]) {
      const v = new CollideView(newCollide(d, seed), true);
      const h1 = v.help(1)!;
      expect(h1.moved).toBeUndefined();
      expect(h1.text).toMatch(/^Swap these two/);
      let guard = 0;
      while (!v.won && guard++ < 200) {
        const h = v.help(2)!;
        expect(h).not.toBeNull();
        expect(h.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBeLessThanOrEqual(v.par!);
      expect(v.clean).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.undo()).toBe(true);
      expect(v.won).toBe(false);
    }
  });

  it('swaps by drag and by two taps, ignores a far tap, and undoes', () => {
    const v = new CollideView(newCollide(20, 5), true);
    const { ctx } = recCtx();
    const area = { x: 0, y: 0, w: 400, h: 600 };
    v.draw(ctx, area, 0);
    const s = (v as unknown as { state: CollideState }).state;
    const m = bestSwap(s)!;
    const geo = v as unknown as { origin: { x: number; y: number }; cell: number };
    const at = (i: number) => ({ x: geo.origin.x + ((i % s.w) + 0.5) * geo.cell, y: geo.origin.y + (Math.floor(i / s.w) + 0.5) * geo.cell });
    // Two taps.
    v.down(at(m.a)); v.up(at(m.a));
    v.down(at(m.b)); v.up(at(m.b));
    expect(v.moves).toBe(1);
    v.undo();
    expect(v.moves).toBe(0);
    // A drag from one onto the other.
    const pa = at(m.a), pb = at(m.b);
    v.down(pa); v.move({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }); v.move(pb); v.up(pb);
    expect(v.moves).toBe(1);
    v.restart();
    expect(v.moves).toBe(0);
    expect(v.canUndo()).toBe(false);
  });

  it('is stuck out of moves, and the hint says how far to go back', () => {
    const s = newCollide(80, 4);
    const v = new CollideView({ ...s, budget: 2, par: 2 }, true);
    // Two moves that are not the best: the last legal swaps on the board.
    for (let k = 0; k < 2; k++) {
      const st = (v as unknown as { state: CollideState }).state;
      const sw = legalSwaps(st);
      const [a, b] = sw[sw.length - 1];
      (v as unknown as { play(a: number, b: number): void }).play(a, b);
    }
    expect(v.stuck).toBe(true);
    expect(v.won).toBe(false);
    expect(v.hint()).toMatch(/Out of moves/);
    const h = v.help(1)!;
    expect(h.text).toMatch(/Undo|Restart/);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Swap', 'Targets']);
    expect(RULES.map((r) => r.title)).toEqual(['Swap', 'Falls', 'Jets', 'Showers', 'Targets']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });
});
