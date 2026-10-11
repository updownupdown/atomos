import { describe, expect, it } from 'vitest';
import {
  bind, canBind, canFinish, canSwap, countClearances, gluonsLeft, groupKind, newColorCharge, nextStep, onTrack, solved, specFor, stranded, swap, tally,
  type ColorChargeState, type Quark,
} from '../src/puzzles/colorCharge';
import { undoHelp, type ViewAction } from '../src/puzzles/view';
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
    // The gluon is a button beside the message line now, not a token under the grid.
    expect(geom.tokens).toHaveLength(0);
    const at = (i: number) => ({ x: geom.x + (i % s.cols + 0.5) * geom.cell, y: geom.y + (Math.floor(i / s.cols) + 0.5) * geom.cell });
    const tap = (p: { x: number; y: number }) => { v.down(p); v.up(p); };
    const acts = v.action() as ViewAction[];
    expect(acts.map((a) => a.label)).toEqual(['Gluons (1)', 'Test']);
    // The swap first: arm the gluon, tap the two tiles.
    acts[0].run();
    expect((v.action() as ViewAction[])[0].pressed).toBe(true);
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

  it('never draws a negative size, even squeezed to a few pixels', () => {
    // roundRect throws on a negative radius, as the browser's does, which would stop the frame loop.
    const strict = (): CanvasRenderingContext2D => {
      const c = ctx() as unknown as Record<string, unknown>;
      c.roundRect = (_x: number, _y: number, w: number, h: number, r: number) => {
        if (r < 0 || w < 0 || h < 0) throw new RangeError(`roundRect ${w} ${h} ${r}`);
      };
      return c as unknown as CanvasRenderingContext2D;
    };
    for (const z of [1, 60, 110]) {
      const s = newColorCharge(z, 2);
      const v = new ColorChargeView(s, false, () => 0);
      const inside = v as unknown as { sel: number[]; tryBind(): void };
      inside.sel = [...s.solution.find((g) => canBind(s, g))!];
      inside.tryBind();
      for (const area of [{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 12, h: 9 }, { x: 0, y: 0, w: 40, h: 30 }, { x: 0, y: 0, w: 340, h: 430 }]) {
        for (const t of [0, 200, 400, 2000]) expect(() => v.draw(strict(), area, t)).not.toThrow();
      }
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

  describe('a swap that strands tiles', () => {
    const area = { x: 0, y: 0, w: 340, h: 430 };
    type Inside = { state: ColorChargeState; geom: { cell: number; x: number; y: number } };
    /** A gluon level, a view on a hand-driven clock, and a swap that strands tiles on it. */
    function setup(reduced: boolean) {
      const s = newColorCharge(25, 3);
      const clock = { now: 1000 };
      const v = new ColorChargeView(s, reduced, () => clock.now);
      v.draw(ctx(), area, clock.now);
      const inside = v as unknown as Inside;
      const at = (i: number) => ({ x: inside.geom.x + (i % s.cols + 0.5) * inside.geom.cell, y: inside.geom.y + (Math.floor(i / s.cols) + 0.5) * inside.geom.cell });
      const tap = (i: number) => { v.down(at(i)); v.up(at(i)); };
      let wrong: [number, number] | null = null;
      for (let a = 0; a < s.tiles.length && !wrong; a++) {
        for (const b of [a + 1, a + s.cols]) if (canSwap(s, a, b) && stranded(swap(s, a, b)!).length) { wrong = [a, b]; break; }
      }
      const doSwap = ([a, b]: [number, number]) => {
        expect(v.key({ key: 'g' } as KeyboardEvent)).toBe(true);
        tap(a);
        tap(b);
      };
      const frame = (ms: number) => { clock.now += ms; v.draw(ctx(), area, clock.now); };
      return { s, v, inside, at, tap, wrong: wrong!, doSwap, frame };
    }

    it('stays put, unmarked, until Test shows the stranded tiles for two seconds', () => {
      const { v, inside, wrong, doSwap, frame } = setup(false);
      doSwap(wrong);
      expect(v.moves).toBe(1);
      expect(gluonsLeft(inside.state)).toBe(0);
      expect(v.hint()).not.toMatch(/strand/i);
      frame(5000);
      expect(v.moves).toBe(1);
      const test = (v.action() as ViewAction[]).find((a) => a.label === 'Test')!;
      test.run();
      expect(v.hint()).toBe('Stranded tiles: undo to free them');
      expect(v.hint().length).toBeLessThanOrEqual(40);
      frame(1990);
      expect(v.hint()).toMatch(/strand/i);
      frame(20);
      expect(v.hint()).not.toMatch(/strand/i);
    });

    it('comes back with Undo, refunding the gluon', () => {
      const { s, v, inside, wrong, doSwap } = setup(false);
      doSwap(wrong);
      expect(v.undo()).toBe(true);
      expect(v.moves).toBe(0);
      expect(gluonsLeft(inside.state)).toBe(1);
      expect(inside.state.tiles).toEqual(s.tiles);
      expect(v.canUndo()).toBe(false);
    });

    it('leaves the right swap alone', () => {
      const { s, v, doSwap, frame } = setup(false);
      doSwap(s.solutionSwaps[0]);
      expect(v.hint()).not.toMatch(/strands/);
      frame(5000);
      expect(v.moves).toBe(1);
    });

  });

  describe('a group that strands tiles', () => {
    const area = { x: 0, y: 0, w: 340, h: 430 };
    type Inside = { state: ColorChargeState; sel: number[]; tryBind(): void; pending: { group: number } | null };
    /** A neutral group of free tiles that is not one of the clearance's (so it strands tiles). */
    const wrongGroup = (s: ColorChargeState): number[] | null => {
      const keys = new Set(s.solution.map((g) => [...g].sort((a, b) => a - b).join()));
      for (let a = 0; a < s.tiles.length; a++) for (let b = a + 1; b < s.tiles.length; b++) {
        for (const g of [[a, b], ...Array.from({ length: s.tiles.length }, (_, c) => [a, b, c]).filter(([, , c]) => c > b)]) {
          if (canBind(s, g) && !keys.has(g.join())) return g;
        }
      }
      return null;
    };
    function setup(z: number, reduced: boolean) {
      for (let seed = 1; seed < 40; seed++) {
        const s = newColorCharge(z, seed);
        const g = wrongGroup(s);
        if (!g) continue;
        const clock = { now: 1000 };
        const v = new ColorChargeView(s, reduced, () => clock.now);
        v.draw(ctx(), area, clock.now);
        const inside = v as unknown as Inside;
        const frame = (ms: number) => { clock.now += ms; v.draw(ctx(), area, clock.now); };
        const bindIt = (cells: number[]) => { inside.sel = [...cells]; inside.tryBind(); };
        return { s, v, g, inside, frame, bindIt };
      }
      throw new Error(`no wrong group at z ${z}`);
    }

    it('stays bound; Test rings it amber and the good ones green', () => {
      const { s, v, inside, frame, bindIt } = setup(60, false);
      const good = s.solution.find((c) => canBind(s, c))!;
      bindIt(good);
      const g = wrongGroup(inside.state)!;
      bindIt(g);
      expect(v.moves).toBe(2);
      expect(v.hint()).not.toMatch(/strand/i);
      frame(3000);
      expect(v.moves).toBe(2);
      frame(1000);
      const acts = v.action();
      const test = (Array.isArray(acts) ? acts : [acts!]).find((a) => a.label === 'Test')!;
      test.run();
      const marks = (v as unknown as { testing(): { ok: boolean[] } | null }).testing()!;
      expect(marks.ok).toEqual([true, false]);
      expect(v.undo()).toBe(true);
      expect(v.moves).toBe(1);
      expect(inside.state.groups).toEqual([good]);
    });

    it('leaves a good group alone', () => {
      const { s, v, frame, bindIt } = setup(1, false);
      bindIt(s.solution.find((c) => canBind(s, c))!);
      expect(v.hint()).not.toMatch(/strands/);
      frame(5000);
      expect(v.moves).toBe(1);
    });
  });

  it('tallies the particles to make, by kind, leaving out one about to be undone', () => {
    for (const z of [1, 31, 60, 110]) {
      const s = newColorCharge(z, 2);
      const spec = specFor(z);
      const t0 = tally(s);
      expect(t0.map((t) => t.kind)).toEqual(['baryon', ...(spec.antibaryons ? ['antibaryon'] : []), ...(spec.mesons ? ['meson'] : [])]);
      expect(t0.reduce((a, t) => a + t.need, 0)).toBe(s.solution.length);
      expect(t0.find((t) => t.kind === 'meson')?.need ?? 0).toBe(spec.mesons);
      expect(t0.find((t) => t.kind === 'antibaryon')?.need ?? 0).toBe(spec.antibaryons);
      expect(t0.every((t) => t.done === 0)).toBe(true);
      const done = playAnswer(s);
      expect(tally(done).every((t) => t.done === t.need)).toBe(true);
      expect(tally(done, 0).reduce((a, t) => a + t.done, 0)).toBe(s.solution.length - 1);
    }
  });

  it('keeps the tally under the board and inside the area', () => {
    for (const z of [1, 25, 60, 110]) {
      for (const area of [{ x: 0, y: 0, w: 358, h: 430 }, { x: 0, y: 0, w: 1200, h: 700 }]) {
        const s = newColorCharge(z, 2);
        const v = new ColorChargeView(s, true);
        v.draw(ctx(), area, 0);
        const g = (v as unknown as { geom: { cell: number; y: number; legend: number; tokens: { y: number; h: number }[] } }).geom;
        expect(g.legend).toBeGreaterThanOrEqual(g.y + g.cell * s.rows);
        for (const t of g.tokens) expect(g.legend).toBeGreaterThan(t.y + t.h);
        expect(g.legend + 23).toBeLessThanOrEqual(area.y + area.h);
      }
    }
  });

  it('has rule cards with a good and a bad picture each, and only the meta in the instructions', () => {
    expect(RULES.map((r) => r.title)).toEqual(['Baryon', 'Stranded tiles', 'Gluon', 'Antiquark', 'Meson', 'Antibaryon']);
    for (const r of RULES) {
      expect(r.text).not.toMatch(/</);
      expect(r.demo).toBeUndefined();
      for (const pic of [r.good, r.bad]) {
        expect(pic).toBeDefined();
        expect(pic!.duration).toBeGreaterThanOrEqual(1.5);
        expect(pic!.duration).toBeLessThanOrEqual(4);
        expect(pic!.caption!.length).toBeGreaterThan(0);
        expect(pic!.caption!.length).toBeLessThanOrEqual(28);
        for (const [w, h] of [[140, 104], [120, 90]]) {
          for (const t of [0, 0.4, 0.9, 1.4, 2.1, 2.9, 3.6, pic!.duration, pic!.duration + 2]) pic!.draw(ctx(), w, h, t);
        }
      }
    }
    expect(INSTRUCTIONS).toMatch(/<h3>In the game<\/h3>\s*<p class="meta">/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
  });
});

describe('hints', () => {
  const SEEDS = [1, 2, 5, 9];
  const ctx = (): CanvasRenderingContext2D => {
    const noop = () => {};
    return new Proxy({ measureText: () => ({ width: 30 }) } as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : noop),
      set: (t, k, v) => { t[k as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
  };
  type Inside = { state: ColorChargeState; history: ColorChargeState[]; tryBind(): void; sel: number[] };
  const inside = (v: ColorChargeView) => v as unknown as Inside;
  const snapshot = (v: ColorChargeView) => JSON.stringify(inside(v).state);
  /** Binds a group as the player would, by picking its tiles. */
  const pick = (v: ColorChargeView, cells: number[]) => { inside(v).sel = [...cells]; inside(v).tryBind(); };
  /** A neutral group of free tiles that is not one of the clearance's. */
  const wrongGroup = (s: ColorChargeState): number[] | null => {
    const keys = new Set(s.solution.map((g) => [...g].sort((a, b) => a - b).join()));
    for (let a = 0; a < s.tiles.length; a++) for (let b = 0; b < s.tiles.length; b++) {
      if (b <= a) continue;
      for (const g of [[a, b], ...Array.from({ length: s.tiles.length }, (_, c) => [a, b, c]).filter(([, , c]) => c > b)]) {
        if (canBind(s, g) && !keys.has(g.join())) return g;
      }
    }
    return null;
  };

  it('Look here rings a group that must bind and says why, leaving the board alone', () => {
    for (const z of SPREAD) for (const seed of SEEDS) {
      const v = new ColorChargeView(newColorCharge(z, seed), false);
      const before = snapshot(v);
      const h = v.help(1)!;
      expect(h.text, `z ${z} seed ${seed}`).toMatch(/^(This (quark|antiquark) can join only this (baryon|antibaryon|meson)|This (baryon|antibaryon|meson) is part of the only way to clear the grid|These two need to trade colors with a gluon)\.$/);
      expect(h.moved).toBeUndefined();
      expect(snapshot(v)).toBe(before);
      expect(v.moves).toBe(0);
      expect(v.canUndo()).toBe(false);
      v.draw(ctx(), { x: 0, y: 0, w: 340, h: 430 }, 0);
    }
  });

  it('Show me plays the clearance one move at a time, each counted and undoable', () => {
    for (const z of SPREAD) for (const seed of SEEDS) {
      const s = newColorCharge(z, seed);
      const v = new ColorChargeView(s, true);
      let calls = 0;
      while (!v.won && calls < s.par * 3 + 10) {
        const before = v.moves;
        const h = v.help(2)!;
        calls++;
        expect(h.moved).toBe(true);
        expect(h.text).toMatch(/^(Bound an? (baryon|antibaryon|meson)|Swapped their colors with a gluon)\.$/);
        expect(v.moves).toBe(before + 1);
        expect(v.canUndo()).toBe(true);
      }
      expect(v.won, `z ${z} seed ${seed}`).toBe(true);
      // The one clearance, so exactly par moves.
      expect(calls).toBe(s.par);
      expect(v.clean).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.help(2)).toBeNull();
      // Undo takes back Show me's moves like any other.
      expect(v.undo()).toBe(true);
      expect(v.won).toBe(false);
      expect(v.moves).toBe(s.par - 1);
    }
  });

  it('Show me picks up from a board played partway', () => {
    for (const z of [21, 60, 104]) {
      const s = newColorCharge(z, 3);
      const v = new ColorChargeView(s, true);
      // The player binds a group that needs no swap first.
      const g = s.solution.find((c) => canBind(s, c));
      if (g) pick(v, g);
      for (let k = 0; k < s.par * 3 + 10 && !v.won; k++) v.help(2);
      expect(v.won).toBe(true);
      expect(v.moves).toBe(s.par);
    }
  });

  it('says how far to undo from a dead end, at either level, and moves nothing', () => {
    let tried = 0;
    for (const z of SPREAD) for (const seed of SEEDS) {
      const s = newColorCharge(z, seed);
      const v = new ColorChargeView(s, true);
      // One good move, then a wrong group.
      v.help(2);
      const g = wrongGroup(inside(v).state);
      if (!g) continue;
      tried++;
      pick(v, g);
      expect(onTrack(inside(v).state)).toBe(false);
      const before = snapshot(v);
      expect(v.help(1)).toEqual(undoHelp(1));
      expect(v.help(2)).toEqual(undoHelp(1));
      expect(snapshot(v)).toBe(before);
      expect(v.moves).toBe(2);
      // Another group on top of the dead end: now two undos.
      const more = s.solution.find((c) => canBind(inside(v).state, c)) ?? wrongGroup(inside(v).state);
      if (more) {
        pick(v, more);
        expect(v.help(1)).toEqual(undoHelp(2));
        expect(v.help(2)).toEqual(undoHelp(2));
        v.undo();
      }
      v.undo();
      // Back on track: Show me finishes.
      for (let k = 0; k < s.par * 3 + 10 && !v.won; k++) v.help(2);
      expect(v.won).toBe(true);
    }
    expect(tried).toBeGreaterThan(30);
  });

  it('says to undo a swap that strands tiles while it waits to undo itself', () => {
    const s = newColorCharge(25, 3);
    const v = new ColorChargeView(s, true, () => 1000);
    let wrong: [number, number] | null = null;
    for (let a = 0; a < s.tiles.length && !wrong; a++) {
      for (const b of [a + 1, a + s.cols]) if (canSwap(s, a, b) && stranded(swap(s, a, b)!).length) { wrong = [a, b]; break; }
    }
    (v as unknown as { trySwap(a: number, b: number): void }).trySwap(...wrong!);
    expect(v.help(1)).toEqual(undoHelp(1));
    expect(v.help(2)).toEqual(undoHelp(1));
    expect(v.undo()).toBe(true);
    expect(v.help(1)!.text).not.toMatch(/Undo/);
  });

  it('knows a board is on track exactly when it can still be cleared', () => {
    for (const z of SPREAD) {
      const s = newColorCharge(z, 7);
      // Random play: any neutral group or swap, until nothing is left to do.
      let t = s;
      let seed = z;
      const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
      for (let k = 0; k < 20; k++) {
        expect(onTrack(t), `z ${z} step ${k}`).toBe(canFinish(t));
        expect(nextStep(t) !== null).toBe(onTrack(t) && !solved(t));
        const moves: ColorChargeState[] = [];
        for (let a = 0; a < t.tiles.length; a++) for (let b = a + 1; b < t.tiles.length; b++) {
          const w = swap(t, a, b);
          if (w) moves.push(w);
          for (const g of [[a, b], [a, b, b + 1], [a, b, b + t.cols], [a, b, a + t.cols]]) { const u = bind(t, g); if (u) moves.push(u); }
        }
        if (!moves.length) break;
        t = moves[rnd(moves.length)];
      }
    }
  });

  it('answers quickly, even deep in a dead end', () => {
    let worst = 0;
    const time = (f: () => unknown) => { const t0 = performance.now(); f(); worst = Math.max(worst, performance.now() - t0); };
    for (const z of SPREAD) for (const seed of SEEDS) {
      const s = newColorCharge(z, seed);
      const v = new ColorChargeView(s, true);
      time(() => v.help(1));
      time(() => v.help(2));
      // A wrong group, then as many more as will bind, so the walk back is long.
      const g = wrongGroup(inside(v).state);
      if (g) pick(v, g);
      for (let more = wrongGroup(inside(v).state); more; more = wrongGroup(inside(v).state)) pick(v, more);
      time(() => v.help(1));
      time(() => v.help(2));
    }
    expect(worst).toBeLessThan(200);
  }, 30000);
});

function adjacentPair(cols: number, a: number, b: number): boolean {
  return Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) + Math.abs((a % cols) - (b % cols)) === 1;
}

/** The group's cells in an order where each follows a neighbor, so a drag can cross them. */
function chain(cols: number, g: number[]): number[] | null {
  const perms = g.length === 2 ? [g] : [[0, 1, 2], [1, 0, 2], [0, 2, 1]].map((p) => p.map((k) => g[k]));
  return perms.find((p) => p.every((x, k) => k === 0 || adjacentPair(cols, p[k - 1], x))) ?? null;
}
