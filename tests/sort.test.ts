import { describe, expect, it } from 'vitest';
import { jammed, legalPours, newSort, plan, pour, pourCount, searchVials, solved, sortable, sortShape, topRun, vialDone, type SortState } from '../src/puzzles/sort';
import { INSTRUCTIONS, layoutSort, RULES, SortView, vialAt } from '../src/puzzles/sortView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DS = [1, 5, 8, 10, 11, 20, 21, 35, 40, 41, 55, 60, 64, 65, 75, 80, 81, 90, 91, 95, 96, 100];

/** A board from strings of hue letters, bottom first ('a' is color 0). */
function board(vials: string[], cap: number): SortState {
  const v = vials.map((t) => [...t].map((ch) => ch.charCodeAt(0) - 97));
  return { cap, colors: new Set(v.flat()).size, vials: v, moves: 0, par: 0, last: null };
}

describe('dial', () => {
  it('grows the board smoothly and takes a spare away at the top of Expert', () => {
    let prev = sortShape(1);
    expect(prev).toMatchObject({ colors: 3, cap: 3, spares: 2 });
    for (let d = 2; d <= 90; d++) {
      const s = sortShape(d);
      expect(s.colors).toBeGreaterThanOrEqual(prev.colors);
      expect(s.cap).toBeGreaterThanOrEqual(prev.cap);
      expect(s.mix).toBeGreaterThanOrEqual(prev.mix);
      expect(s.colors - prev.colors).toBeLessThanOrEqual(1);
      prev = s;
    }
    expect(sortShape(90)).toMatchObject({ colors: 9, cap: 5, spares: 2 });
    expect(sortShape(91).spares).toBe(1);
    expect(sortShape(100)).toMatchObject({ colors: 7, cap: 4, spares: 1 });
  });
});

describe('deals', () => {
  it('deals the same board for the same seed', () => {
    for (const d of [1, 50, 100]) expect(newSort(d, 7).vials).toEqual(newSort(d, 7).vials);
    expect(newSort(50, 1).vials).not.toEqual(newSort(50, 2).vials);
  });

  it('deals full vials of every color, none sorted, with par the proved fewest pours', () => {
    for (const d of DS) for (const seed of [1, 2, 3]) {
      const s = newSort(d, seed);
      const shape = sortShape(d);
      expect(s.colors).toBe(shape.colors);
      expect(s.cap).toBe(shape.cap);
      expect(s.vials.length).toBe(shape.colors + shape.spares);
      expect(s.vials.filter((v) => !v.length).length).toBe(shape.spares);
      const counts = new Array(s.colors).fill(0);
      for (const v of s.vials) {
        expect(v.length === 0 || v.length === s.cap).toBe(true);
        for (const c of v) counts[c]++;
      }
      expect(counts.every((n) => n === s.cap)).toBe(true);
      expect(s.vials.some((_, i) => vialDone(s, i))).toBe(false);
      expect(s.par).toBeGreaterThanOrEqual(shape.minPar);
      // The solver proves par the fewest, and its pours really sort the board.
      const r = searchVials(s.vials, s.cap, s.colors, { budget: 200_000 });
      expect(r.exact).toBe(true);
      expect(r.path!.length).toBe(s.par);
      let t = s;
      for (const [a, b] of r.path!) t = pour(t, a, b)!;
      expect(solved(t)).toBe(true);
    }
  });

  it('deals quickly, even at the top of the dial', () => {
    for (const d of [60, 90, 100]) {
      let worst = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const t0 = performance.now();
        newSort(d, seed);
        worst = Math.max(worst, performance.now() - t0);
      }
      expect(worst).toBeLessThan(300);
    }
  });
});

describe('pours', () => {
  it('moves the whole top run onto its color or into an empty vial, as much as fits', () => {
    const s = board(['abb', 'ab', '', 'ba'], 3);
    expect(topRun(s.vials[0])).toEqual({ color: 1, len: 2 });
    expect(pourCount(s, 0, 1)).toBe(1); // room for one
    expect(pourCount(s, 0, 2)).toBe(2);
    expect(pourCount(s, 0, 3)).toBe(0); // blue on top
    expect(pourCount(s, 2, 0)).toBe(0); // nothing to pour
    expect(pourCount(s, 0, 0)).toBe(0);
    const t = pour(s, 0, 1)!;
    expect(t.vials[0]).toEqual([0, 1]);
    expect(t.vials[1]).toEqual([0, 1, 1]);
    expect(t.moves).toBe(1);
    expect(t.last).toEqual({ from: 0, to: 1, color: 1, count: 1 });
    expect(s.vials[0]).toEqual([0, 1, 1]); // the old board is left alone
    expect(pour(s, 0, 3)).toBeNull();
  });

  it('is solved only when every color sits whole in one vial', () => {
    expect(solved(board(['aa', 'bb', ''], 2))).toBe(true);
    expect(solved(board(['a', 'a', 'bb'], 2))).toBe(false);
    expect(solved(board(['ab', 'ba', ''], 2))).toBe(false);
  });

  it('knows a jammed board and one that can no longer be sorted', () => {
    const j = board(['ab', 'ba'], 2);
    expect(legalPours(j)).toEqual([]);
    expect(jammed(j)).toBe(true);
    expect(sortable(j)).toBe(false);
    expect(sortable(board(['ab', 'ba', ''], 2))).toBe(true);
    expect(plan(board(['ab', 'ba', ''], 2))!.length).toBe(3);
  });
});

describe('view', () => {
  it('lays vials out inside the area and finds them by touch', () => {
    for (const area of AREAS_ALL) for (const count of [5, 8, 11]) {
      const L = layoutSort(area, count, 5);
      for (const b of L.box) expect(inside([[b.x, b.y], [b.x + b.w, b.y + b.h]], area)).toBe(true);
      L.box.forEach((b, i) => expect(vialAt(L, { x: b.x + b.w / 2, y: b.y + b.h / 2 })).toBe(i));
    }
  });

  it('draws inside its area, still and mid-pour', () => {
    for (const d of [1, 50, 90, 100]) {
      const v = new SortView(newSort(d, 2), false);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, performance.now());
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.help(2)!.moved).toBe(true);
      const t0 = performance.now();
      for (const ms of [0, 80, 200, 350, 500, 900]) for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, t0 + ms);
        expect(inside(pts, area), `d ${d} at ${ms} ms`).toBe(true);
      }
      expect(v.hint()).toMatch(/of \d+ lines sorted/);
      expect(v.stats().progress.label).toBe('Sorted');
    }
  });

  it('lifts a vial on tap and pours on the next tap; a drag pours too; undo is free', () => {
    const s0 = { ...board(['abb', 'ab', '', 'a'], 3), par: 3 };
    const v = new SortView(s0, true);
    const area = { x: 0, y: 0, w: 400, h: 500 };
    v.draw(recCtx().ctx, area, 0);
    const L = layoutSort(area, 4, 3);
    const tapAt = (i: number) => { const b = L.box[i]; const p = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; v.down(p); v.up(p); };
    tapAt(0);
    expect(v.moves).toBe(0);
    tapAt(3); // orange cannot go onto blue: vial 3 is lifted instead
    expect(v.moves).toBe(0);
    tapAt(0);
    tapAt(2);
    expect(v.moves).toBe(1);
    expect(v.canUndo()).toBe(true);
    expect(v.undo()).toBe(true);
    expect(v.moves).toBe(0);
    const a = L.box[0], b = L.box[1];
    v.down({ x: a.x + a.w / 2, y: a.y + a.h / 2 });
    v.up({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    expect(v.moves).toBe(1);
    v.restart();
    expect(v.moves).toBe(0);
    expect(v.canUndo()).toBe(false);
  });

  it('Look here marks without moving; Show me plays the board out in par pours', () => {
    for (const d of [1, 30, 60, 90, 100]) {
      const v = new SortView(newSort(d, 4), true);
      const h1 = v.help(1)!;
      expect(h1.moved).toBeUndefined();
      expect(h1.text).toMatch(/^Pour /);
      expect(v.moves).toBe(0);
      for (let k = 0; k < 80 && !v.won; k++) {
        const h = v.help(2)!;
        expect(h).not.toBeNull();
        expect(h.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.hint()).toBe('Every line sorted');
    }
  });

  it('says how far to go back from a board that can no longer be sorted, and when jammed', () => {
    const jam = new SortView({ ...board(['ab', 'ba'], 2), par: 1 }, true);
    expect(jam.stuck).toBe(true);
    expect(jam.hint()).toMatch(/undo or restart/);
    expect(jam.help(1)!.text).toMatch(/Restart/);
    // A deal at the top of the dial, played badly until it cannot be sorted.
    for (let seed = 1; seed <= 20; seed++) {
      const deal = newSort(100, seed);
      const v = new SortView(deal, true);
      let s = deal;
      let lost = false;
      for (let k = 0; k < 12 && !lost; k++) {
        const moves = legalPours(s).filter(([a, b]) => s.vials[b].length);
        const [a, b] = moves[0] ?? legalPours(s)[0] ?? [-1, -1];
        if (a < 0) break;
        const area = { x: 0, y: 0, w: 400, h: 500 };
        v.draw(recCtx().ctx, area, 0);
        const L = layoutSort(area, s.vials.length, s.cap);
        const at = (i: number) => ({ x: L.box[i].x + L.box[i].w / 2, y: L.box[i].y + L.box[i].h / 2 });
        v.down(at(a)); v.up(at(a)); v.down(at(b)); v.up(at(b));
        s = pour(s, a, b)!;
        lost = sortable(s) === false;
      }
      if (!lost) continue;
      expect(v.help(1)!.text).toMatch(/^Undo (your last move|\d+ moves) to get back on track\.$/);
      return;
    }
    throw new Error('no lost board found');
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Same color', 'Whole lines']);
    expect(RULES.map((r) => r.title)).toEqual(['Pour', 'Same color', 'Room', 'Whole lines']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  });
});
