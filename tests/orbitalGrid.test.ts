import { describe, expect, it } from 'vitest';
import { conflicts, countSolutions, cycleValue, EMPTY, moveTile, newOrbitalGrid, place, remaining, solveBySingles, solved, specFor, symbolOf, units, type OrbitalGridState } from '../src/puzzles/orbitalGrid';
import { INSTRUCTIONS, OrbitalGridView, RULES } from '../src/puzzles/orbitalGridView';
import type { Area, Point } from '../src/puzzles/view';

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

describe('moving and counting', () => {
  it('moves a placed tile as one placement, free right after placing it', () => {
    const s = newOrbitalGrid(30, 2);
    const [a, b] = s.cells.map((v, i) => (v === EMPTY ? i : -1)).filter((i) => i >= 0);
    let t = place(s, a, 0)!;
    expect(t.moves).toBe(1);
    t = moveTile(t, a, b)!;
    expect(t.cells[a]).toBe(EMPTY);
    expect(t.cells[b]).toBe(0);
    expect(t.moves).toBe(1);
    const given = s.givens.indexOf(true);
    expect(moveTile(t, b, given)).toBeNull();
    expect(moveTile(t, given, a)).toBeNull();
    expect(moveTile(t, a, b)).toBeNull();
  });

  it('counts how many of each symbol are still needed, never below zero', () => {
    const s = newOrbitalGrid(100, 4);
    const left = remaining(s);
    for (let v = 0; v < s.size; v++) expect(left[v]).toBe(s.size - s.cells.filter((x) => x === v).length);
    expect(left.reduce((a, b) => a + b, 0)).toBe(s.par);
    let full = s;
    for (let i = 0; i < s.cells.length; i++) if (full.cells[i] === EMPTY) full = place(full, i, s.solution[i])!;
    expect(remaining(full).every((n) => n === 0)).toBe(true);
    let over = s;
    for (let i = 0; i < s.cells.length; i++) if (over.cells[i] === EMPTY) over = place(over, i, 0)!;
    expect(remaining(over)[0]).toBe(0);
  });
});

/** A canvas stand-in that records every coordinate drawn. */
function mockCtx(): { ctx: CanvasRenderingContext2D; pts: [number, number][] } {
  const pts: [number, number][] = [];
  const rec = (x: number, y: number) => pts.push([x, y]);
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'moveTo' || k === 'lineTo') return rec;
      if (k === 'bezierCurveTo') return (...a: number[]) => { rec(a[0], a[1]); rec(a[2], a[3]); rec(a[4], a[5]); };
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'rect' || k === 'roundRect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, pts };
}

function inside(pts: [number, number][], a: Area, slack = 0.5): void {
  for (const [x, y] of pts) {
    expect(x).toBeGreaterThanOrEqual(a.x - slack);
    expect(x).toBeLessThanOrEqual(a.x + a.w + slack);
    expect(y).toBeGreaterThanOrEqual(a.y - slack);
    expect(y).toBeLessThanOrEqual(a.y + a.h + slack);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lay = (v: OrbitalGridView) => (v as any).lay as { cell: number; gx: number; gy: number; slotW: number; slotH: number; key: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const slot = (v: OrbitalGridView, k: number): Point => { const p = (v as any).slotPos(k); const L = lay(v); return { x: p.x + L.slotW / 2, y: p.y + L.slotH / 2 }; };
const cellAt = (v: OrbitalGridView, s: OrbitalGridState, i: number): Point => {
  const L = lay(v);
  return { x: L.gx + ((i % s.size) + 0.5) * L.cell, y: L.gy + (Math.floor(i / s.size) + 0.5) * L.cell };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (v: OrbitalGridView) => (v as any).state as OrbitalGridState;
/** Drags from p to where the dragged tile sits over cell i (the tile rides above the finger). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dragTo = (v: OrbitalGridView, from: Point, to: Point) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lift = (v as any).lift() as number;
  const end = { x: to.x, y: to.y + lift };
  v.down(from);
  v.move({ x: (from.x + end.x) / 2, y: (from.y + end.y) / 2 });
  v.move(end);
  v.up(end);
};

describe('orbital grid view', () => {
  const AREAS: Area[] = [{ x: 0, y: 0, w: 340, h: 430 }, { x: 10, y: 8, w: 1200, h: 700 }, { x: 0, y: 0, w: 640, h: 300 }];

  it('draws inside the area at any size, mid-drag too, with stacks big enough to touch', () => {
    for (const z of [1, 30, 100]) for (const area of AREAS) {
      const s = newOrbitalGrid(z, 3);
      const v = new OrbitalGridView(s, true);
      const first = mockCtx();
      v.draw(first.ctx, area, 0);
      inside(first.pts, area);
      const L = lay(v);
      expect(Math.min(L.slotW, L.slotH)).toBeGreaterThanOrEqual(40);
      // Drag a tile far past every edge: it stays in the area.
      for (const far of [{ x: -500, y: -500 }, { x: 5000, y: 5000 }]) {
        v.down(slot(v, 0));
        v.move(far);
        const mid = mockCtx();
        v.draw(mid.ctx, area, 0);
        inside(mid.pts, area);
        v.cancel();
      }
      expect(v.hint().length).toBeLessThanOrEqual(40);
    }
  });

  it('places by dragging from a stack, moves a placed tile, and clears it when dragged off the board', () => {
    const s = newOrbitalGrid(40, 5);
    const v = new OrbitalGridView(s, true);
    v.draw(mockCtx().ctx, AREAS[0], 0);
    const empties = s.cells.map((x, i) => (x === EMPTY ? i : -1)).filter((i) => i >= 0);
    const a = empties[empties.length - 1], b = empties[empties.length - 2];
    dragTo(v, slot(v, 3), cellAt(v, s, a));
    expect(state(v).cells[a]).toBe(3);
    expect(v.moves).toBe(1);
    // Onto a given: nothing changes.
    const given = s.givens.indexOf(true);
    dragTo(v, slot(v, 2), cellAt(v, s, given));
    expect(state(v).cells[given]).toBe(s.cells[given]);
    // Move the placed tile to another empty cell: still one placement.
    dragTo(v, cellAt(v, s, a), cellAt(v, s, b));
    expect(state(v).cells[a]).toBe(EMPTY);
    expect(state(v).cells[b]).toBe(3);
    expect(v.moves).toBe(1);
    // Off the board (far below the grid) clears it.
    const L = lay(v);
    v.down(cellAt(v, s, b));
    v.move({ x: L.gx - 4, y: 425 });
    v.up({ x: L.gx - 4, y: 425 });
    expect(state(v).cells[b]).toBe(EMPTY);
    expect(v.undo()).toBe(true);
    expect(state(v).cells[b]).toBe(3);
  });

  it('still places by tapping a cell and then a stack', () => {
    const s = newOrbitalGrid(5, 1);
    const v = new OrbitalGridView(s, true);
    v.draw(mockCtx().ctx, AREAS[1], 0);
    const i = s.cells.lastIndexOf(EMPTY);
    const tap = (p: Point) => { v.down(p); v.up(p); };
    tap(cellAt(v, s, i));
    tap(slot(v, 2));
    expect(state(v).cells[i]).toBe(2);
    // Tapping the same stack again clears it; tapping the cell cycles it.
    tap(slot(v, 2));
    expect(state(v).cells[i]).toBe(EMPTY);
    tap(cellAt(v, s, i));
    expect(state(v).cells[i]).toBe(0);
  });

  it('has rule cards with demos that stay in their box, and only the game meta in INSTRUCTIONS', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(6);
    for (const r of RULES) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.text).not.toMatch(/<|>/);
      for (const [w, h] of [[120, 96], [220, 160]]) for (let t = 0; t < 7; t += 0.13) {
        const { ctx, pts } = mockCtx();
        r.demo!(ctx, w, h, t);
        inside(pts, { x: 0, y: 0, w, h }, 1);
      }
    }
    expect(INSTRUCTIONS).toMatch(/<h3>In the game<\/h3>/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
  });
});
