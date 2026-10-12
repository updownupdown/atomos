import { describe, expect, it } from 'vitest';
import { chainFrom, fissionShape, newFission, plan, solved, tap, type FissionState } from '../src/puzzles/fission';
import { FissionView, INSTRUCTIONS, RULES } from '../src/puzzles/fissionView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const ZS = [1, 4, 5, 11, 20, 21, 37, 56, 57, 86, 87, 104, 105, 118];

/** A board from rows: '.' empty, '#' block, a hex digit a nucleus with that arrow mask. */
function board(rows: string[]): FissionState {
  const n = rows.length;
  const nuclei: FissionState['nuclei'] = [];
  const blocks: number[] = [];
  rows.forEach((line, y) => [...line].forEach((ch, x) => {
    if (ch === '#') blocks.push(y * n + x);
    else if (ch !== '.') nuclei.push({ cell: y * n + x, arrows: parseInt(ch, 16) });
  }));
  return { size: n, nuclei, blocks, split: 0, moves: 0, par: 0, last: null };
}

describe('chains', () => {
  it('flies straight, splits what it hits, and stops at blocks and edges', () => {
    const s = board(['2.4', '...', '#.8']);
    const c = chainFrom(s, 0);
    expect(c.splits.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(c.flights.map((f) => f.hit)).toEqual(['nucleus', 'nucleus', 'block']);
    expect(c.flights[2].step).toBe(2);
    expect(plan(s)).toEqual([0]);
    const t = tap(s, 0)!;
    expect(solved(t)).toBe(true);
    expect(t.moves).toBe(1);
    expect(tap(t, 0)).toBeNull();
  });

  it('needs two taps when a block cuts the chain', () => {
    const s = board(['2#2', '...', '...']);
    expect(plan(s)!.length).toBe(2);
    expect(chainFrom(s, 0).flights[0].hit).toBe('block');
  });
});

describe('deals', () => {
  it('deals every element at its par, with the shape it asks for', () => {
    for (const z of ZS) for (const seed of [1, 2, 3]) {
      const s = newFission(z, seed);
      const shape = fissionShape(z);
      expect(s.size).toBe(shape.size);
      expect(s.nuclei.length).toBe(shape.nuclei);
      expect(s.par).toBe(shape.par);
      expect(plan(s)!.length).toBe(s.par);
      const cells = new Set([...s.blocks, ...s.nuclei.map((n) => n.cell)]);
      expect(cells.size).toBe(s.blocks.length + s.nuclei.length);
      for (const n of s.nuclei) expect(n.arrows).toBeGreaterThan(0);
    }
  });

  it('deals quickly', () => {
    const t0 = performance.now();
    for (const z of ZS) newFission(z, 9);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('view', () => {
  it('draws inside its area, and Show me finishes a board in par taps', () => {
    for (const z of [1, 30, 118]) {
      const v = new FissionView(newFission(z, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.hint()).toMatch(/nucle(us|i) left/);
      const h = v.help(1)!;
      expect(h.moved).toBeUndefined();
      while (!v.won) expect(v.help(2)!.moved).toBe(true);
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      v.undo();
      expect(v.won).toBe(false);
    }
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Moderators', 'Fewest taps']);
    expect(RULES.map((r) => r.title)).toEqual(['Tap', 'Chain', 'Moderators', 'Fewest taps']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });
});
