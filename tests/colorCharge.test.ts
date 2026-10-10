import { describe, expect, it } from 'vitest';
import {
  bind, canBind, canFinish, canSwap, countClearances, gluonsLeft, groupKind, newColorCharge, solved, specFor, stranded, swap,
  type ColorChargeState, type Quark,
} from '../src/puzzles/colorCharge';
import { ColorChargeView, INSTRUCTIONS, RULES } from '../src/puzzles/colorChargeView';

const SPREAD = [1, 10, 11, 20, 21, 30, 31, 44, 45, 54, 55, 70, 71, 86, 87, 103, 104, 118];
const q = (color: 0 | 1 | 2, anti = false): Quark => ({ color, anti });

/** A hand-made board from letters: r g b quarks, R G B antiquarks. */
function board(cols: number, rows: number, letters: string, gluons = 0): ColorChargeState {
  const tiles = [...letters.replace(/\s/g, '')].map((ch) => q('rgb'.indexOf(ch.toLowerCase()) as 0 | 1 | 2, ch !== ch.toLowerCase()));
  return { cols, rows, tiles, bound: Array(tiles.length).fill(-1), groups: [], gluons, swaps: [], solution: [], solutionSwaps: [], moves: 0, par: 0 };
}

/** Plays a deal's one answer: its swaps, then its groups. */
function playAnswer(s: ColorChargeState): ColorChargeState {
  let t = s;
  for (const [a, b] of s.solutionSwaps) {
    expect(canSwap(t, a, b)).toBe(true);
    t = swap(t, a, b)!;
  }
  for (const p of s.solution) {
    expect(canBind(t, p)).toBe(true);
    t = bind(t, p)!;
  }
  return t;
}

describe('groups', () => {
  it('binds one of each color, or a color and its anticolor', () => {
    expect(groupKind([q(0), q(1), q(2)], [0, 1, 2])).toBe('baryon');
    expect(groupKind([q(0, true), q(1, true), q(2, true)], [0, 1, 2])).toBe('antibaryon');
    expect(groupKind([q(0), q(0, true)], [0, 1])).toBe('meson');
    expect(groupKind([q(0), q(1), q(1)], [0, 1, 2])).toBeNull();
    expect(groupKind([q(0), q(1, true), q(2)], [0, 1, 2])).toBeNull();
    expect(groupKind([q(0), q(1, true)], [0, 1])).toBeNull();
    expect(groupKind([q(0), q(1)], [0, 1])).toBeNull();
  });
});

describe('levels', () => {
  it('is the same deal for the same seed', () => {
    expect(newColorCharge(60, 4)).toEqual(newColorCharge(60, 4));
    expect(newColorCharge(110, 4)).toEqual(newColorCharge(110, 4));
  });

  it('is dealt from a tiling into neutral connected groups, with par = groups + swaps', () => {
    for (const z of SPREAD) {
      for (let seed = 1; seed <= 8; seed++) {
        const s = newColorCharge(z, seed);
        const spec = specFor(z);
        expect(s.tiles).toHaveLength(spec.cols * spec.rows);
        const covered = s.solution.flat().sort((a, b) => a - b);
        expect(covered).toEqual(Array.from({ length: s.tiles.length }, (_, i) => i));
        expect(s.solution.filter((p) => p.length === 2)).toHaveLength(spec.mesons);
        expect(s.gluons).toBe(spec.gluons);
        expect(s.solutionSwaps).toHaveLength(spec.gluons);
        expect(s.par).toBe(s.solution.length + spec.gluons);
        expect(canFinish(s)).toBe(true);
        const t = playAnswer(s);
        expect(solved(t)).toBe(true);
        expect(t.moves).toBe(s.par);
        expect(gluonsLeft(t)).toBe(0);
      }
    }
  });

  it('deals antiquarks with mesons and antibaryons on purpose at high z', () => {
    expect(newColorCharge(20, 1).tiles.some((t) => t.anti)).toBe(false);
    for (const z of [60, 80, 100, 118]) {
      for (let seed = 1; seed <= 4; seed++) {
        const s = newColorCharge(z, seed);
        // Count antibaryons in the answer, on the tiles as the answer's swaps leave them.
        let t = s;
        for (const [a, b] of s.solutionSwaps) t = swap(t, a, b)!;
        const anti = s.solution.filter((p) => groupKind(t.tiles, p) === 'antibaryon');
        expect(anti).toHaveLength(specFor(z).antibaryons);
      }
    }
  });

  it('generates fast for every element', () => {
    for (let z = 1; z <= 118; z++) {
      for (const deal of [0, 1]) {
        const t = performance.now();
        newColorCharge(z, z * 13 + 1 + deal * 7919);
        expect(performance.now() - t).toBeLessThan(150);
      }
    }
  });
});

describe('one answer', () => {
  it('deals grids with exactly one clearance across the range', () => {
    for (const z of SPREAD) {
      for (let d = 0; d < 4; d++) {
        const s = newColorCharge(z, 7000 + 31 * z + d);
        expect(countClearances(s.tiles, s.cols, s.rows, 3, s.gluons)).toBe(1);
      }
    }
  });

  it('cannot clear a gluon level without spending every gluon', () => {
    for (const z of [21, 30, 45, 54, 71, 86, 87, 103, 104, 118]) {
      for (let d = 0; d < 4; d++) {
        const s = newColorCharge(z, 500 + z + d);
        expect(s.gluons).toBeGreaterThan(0);
        expect(countClearances(s.tiles, s.cols, s.rows, 1, s.gluons - 1)).toBe(0);
      }
    }
  });

  it('counts swaps as part of a clearance', () => {
    // r g g / r b b: no split works as dealt; four single swaps each leave one split (two rows, or two Ls).
    const s = board(3, 2, 'rgg rbb', 1);
    expect(countClearances(s.tiles, 3, 2, 9, 0)).toBe(0);
    expect(countClearances(s.tiles, 3, 2, 9, 1)).toBe(4);
    expect(countClearances(s.tiles, 3, 2, 2, 1)).toBe(2);
  });
});

describe('binding', () => {
  it('refuses bound, disconnected or charged groups', () => {
    const s = newColorCharge(5, 2);
    const [a] = s.solution;
    const t = bind(s, a)!;
    expect(bind(t, a)).toBeNull();
    expect(canBind(s, [0, s.tiles.length - 1])).toBe(false);
  });
});

describe('gluons', () => {
  it('swaps two free neighbors of one kind and different colors, once per gluon', () => {
    const s = board(3, 2, 'rgG brB', 1);
    expect(canSwap(s, 0, 1)).toBe(true); // r g: quarks
    expect(canSwap(s, 0, 4)).toBe(false); // not neighbors
    expect(canSwap(s, 1, 2)).toBe(false); // a quark and an antiquark
    expect(canSwap(s, 3, 0)).toBe(true);
    expect(canSwap(s, 2, 5)).toBe(true); // two antiquarks
    const t = swap(s, 0, 1)!;
    expect(t.tiles[0]).toEqual(q(1));
    expect(t.tiles[1]).toEqual(q(0));
    expect(t.moves).toBe(1);
    expect(t.swaps).toEqual([[0, 1]]);
    expect(gluonsLeft(t)).toBe(0);
    expect(swap(t, 3, 4)).toBeNull(); // none left
    expect(canSwap(board(2, 1, 'rr', 1), 0, 1)).toBe(false); // same color: nothing to trade
    expect(canSwap(board(2, 1, 'rg', 0), 0, 1)).toBe(false); // no gluon
    // A bound tile cannot be swapped.
    const u = bind(board(3, 2, 'rgb rgb', 1), [0, 1, 2])!;
    expect(canSwap(u, 2, 5)).toBe(false);
  });
});

describe('stranded tiles', () => {
  it('finds the tiles a greedy pick strands', () => {
    // r g b / g b r: the L r g b over 0, 1, 4 leaves 2, 3 and 5 apart.
    const s = board(3, 2, 'rgb gbr');
    expect(stranded(s)).toEqual([]);
    expect(stranded(bind(s, [1, 2, 5])!)).toEqual([]);
    const strand = bind(s, [0, 1, 4])!;
    expect(stranded(strand)).toEqual([2, 3, 5]);
    expect(canFinish(strand)).toBe(false);
  });

  it('only marks the region that cannot close', () => {
    // r g b / g b r / b r r: binding the middle row leaves a good top row and a bad bottom one.
    const s = board(3, 3, 'rgb gbr brr');
    const t = bind(s, [3, 4, 5])!;
    expect(stranded(t)).toEqual([6, 7, 8]);
  });

  it('counts the gluons left before calling a tile stranded', () => {
    // r g g / r b b cannot split as dealt, but one gluon fixes it.
    const s = board(3, 2, 'rgg rbb', 1);
    expect(stranded(s)).toEqual([]);
    expect(canFinish(s)).toBe(true);
    expect(stranded({ ...s, gluons: 0 })).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stranded(swap(s, 2, 5)!)).toEqual([]);
  });

  it('strands the board after any swap but the answer', () => {
    for (const z of [25, 50]) {
      const s = newColorCharge(z, 9);
      const [answer] = s.solutionSwaps;
      let wrong = 0;
      for (let a = 0; a < s.tiles.length; a++) {
        for (const b of [a + 1, a + s.cols]) {
          if (!canSwap(s, a, b) || (a === answer[0] && b === answer[1]) || (a === answer[1] && b === answer[0])) continue;
          expect(stranded(swap(s, a, b)!).length).toBeGreaterThan(0);
          wrong++;
        }
      }
      expect(wrong).toBeGreaterThan(3);
      expect(stranded(swap(s, answer[0], answer[1])!)).toEqual([]);
    }
  });
});

describe('view', () => {
  const ctx = (): CanvasRenderingContext2D => {
    const noop = () => {};
    return new Proxy({ measureText: () => ({ width: 30 }) } as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : noop),
      set: (t, k, v) => { t[k as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
  };

  it('binds by drag, swaps with an armed gluon, and undoes for free', () => {
    const s = newColorCharge(25, 3);
    const v = new ColorChargeView(s, true);
    const area = { x: 0, y: 0, w: 340, h: 430 };
    v.draw(ctx(), area, 0);
    const geom = (v as unknown as { geom: { cell: number; x: number; y: number; tokens: { x: number; y: number; w: number; h: number }[] } }).geom;
    expect(geom.tokens).toHaveLength(1);
    const at = (i: number) => ({ x: geom.x + (i % s.cols + 0.5) * geom.cell, y: geom.y + (Math.floor(i / s.cols) + 0.5) * geom.cell });
    const tap = (p: { x: number; y: number }) => { v.down(p); v.up(p); };
    const tok = geom.tokens[0];
    // The swap first: arm the gluon, tap the two tiles.
    tap({ x: tok.x + tok.w / 2, y: tok.y + tok.h / 2 });
    expect(v.hint()).toBe('Gluon ready: pick two neighbors');
    const [a, b] = s.solutionSwaps[0];
    tap(at(a));
    tap(at(b));
    expect(v.moves).toBe(1);
    // Then each group by dragging across it in a connected order.
    for (const g of s.solution) {
      const path = chain(s.cols, g)!;
      v.down(at(path[0]));
      for (const i of path.slice(1)) v.move(at(i));
      v.up(at(path[path.length - 1]));
    }
    expect(v.won).toBe(true);
    expect(v.moves).toBe(s.par);
    expect(v.clean).toBe(true);
    expect(v.undo()).toBe(true);
    expect(v.won).toBe(false);
    expect(v.moves).toBe(s.par - 1);
    v.restart();
    expect(v.moves).toBe(0);
    expect(v.canUndo()).toBe(false);
  });

  it('shows stranded tiles and keeps hints short', () => {
    const v = new ColorChargeView(newColorCharge(3, 1), true);
    expect(v.hint().length).toBeLessThanOrEqual(40);
    for (const z of [1, 25, 60, 110]) {
      const w = new ColorChargeView(newColorCharge(z, 2), false);
      for (const area of [{ x: 0, y: 0, w: 340, h: 430 }, { x: 0, y: 0, w: 1200, h: 700 }]) w.draw(ctx(), area, 1000);
      expect(w.hint().length).toBeLessThanOrEqual(40);
    }
  });

  it('keeps the board and the gluons inside the area', () => {
    for (const z of [1, 25, 60, 110]) {
      const s = newColorCharge(z, 2);
      for (const area of [{ x: 0, y: 0, w: 340, h: 430 }, { x: 0, y: 0, w: 1200, h: 700 }, { x: 0, y: 0, w: 430, h: 340 }]) {
        const v = new ColorChargeView(s, true);
        v.draw(ctx(), area, 0);
        const g = (v as unknown as { geom: { cell: number; x: number; y: number; tokens: { x: number; y: number; w: number; h: number }[] } }).geom;
        expect(g.x).toBeGreaterThanOrEqual(area.x);
        expect(g.y).toBeGreaterThanOrEqual(area.y);
        expect(g.x + g.cell * s.cols).toBeLessThanOrEqual(area.x + area.w);
        expect(g.y + g.cell * s.rows).toBeLessThanOrEqual(area.y + area.h);
        for (const t of g.tokens) {
          expect(t.y + t.h).toBeLessThanOrEqual(area.y + area.h);
          expect(t.w).toBeGreaterThanOrEqual(40);
        }
        if (area.w <= 430) expect(g.cell).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('has rule cards with demos, and only the meta in the instructions', () => {
    expect(RULES.map((r) => r.title)).toEqual(['Baryon', 'Stranded tiles', 'Gluon', 'Antiquark', 'Meson', 'Antibaryon']);
    for (const r of RULES) {
      expect(r.text).not.toMatch(/</);
      for (const t of [0, 0.7, 1.4, 1.9, 2.5, 3.3, 4.2, 5.7, 8.1]) r.demo!(ctx(), 120, 96, t);
    }
    expect(INSTRUCTIONS).toMatch(/<h3>In the game<\/h3>\s*<p class="meta">/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
  });
});

function adjacentPair(cols: number, a: number, b: number): boolean {
  return Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) + Math.abs((a % cols) - (b % cols)) === 1;
}

/** The group's cells in an order where each follows a neighbor, so a drag can cross them. */
function chain(cols: number, g: number[]): number[] | null {
  const perms = g.length === 2 ? [g] : [[0, 1, 2], [1, 0, 2], [0, 2, 1]].map((p) => p.map((k) => g[k]));
  return perms.find((p) => p.every((x, k) => k === 0 || adjacentPair(cols, p[k - 1], x))) ?? null;
}
