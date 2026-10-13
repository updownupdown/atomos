import { describe, expect, it } from 'vitest';
import { alive, boxW, current, drop, dropShape, facings, heights, landing, newDrop, nextStep, place, plan, rotate, sealed, slide, solved, traps, turned, type Cell, type DropState } from '../src/puzzles/drop';
import { DropView, INSTRUCTIONS, RULES } from '../src/puzzles/dropView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DIALS = [1, 8, 9, 15, 16, 20, 21, 28, 29, 45, 46, 62, 63, 80, 81, 100];

function well(width: number, depth: number, pieces: Cell[][]): DropState {
  return {
    width, depth, grid: Array(width * depth).fill(-1),
    pieces: pieces.map((cells) => ({ cells, protons: cells.map(() => true) })),
    next: 0, rot: 0, col: 0, preview: 3, turns: pieces.map(() => 0), moves: 0, par: 0,
  };
}

describe('rules', () => {
  it('turns pieces in place and keeps each cell with its nucleon', () => {
    const L: Cell[] = [[0, 0], [0, 1], [0, 2], [1, 2]];
    expect(turned(L, 1)).toEqual([[2, 0], [1, 0], [0, 0], [0, 1]]);
    expect(turned(L, 4)).toEqual(L);
    expect(facings([[0, 0], [1, 0], [0, 1], [1, 1]]).length).toBe(1);
    expect(facings([[0, 0], [1, 0]]).length).toBe(2);
    expect(facings(L).length).toBe(4);
  });

  it('drops straight down onto what is there, and flags sealed gaps', () => {
    let s = well(3, 2, [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]]]);
    s = drop(s)!;
    expect(s.grid).toEqual([-1, -1, -1, 0, -1, -1]);
    expect(s.moves).toBe(1);
    expect(landing(s, current(s)!, 0)).toBe(0);
    const bad = drop(s)!;
    expect(sealed(bad)).toEqual([4]);
    expect(heights(bad)).toBeNull();
    expect(alive(bad)).toBe(false);
    s = drop(slide(s, 1)!)!;
    expect(sealed(s)).toEqual([]);
    expect(heights(s)).toEqual([1, 1, 1]);
    // A row of three fits the flat top; nothing fits that would stick out.
    expect(landing(s, current(s)!, 1)).toBeNull();
    s = drop(s)!;
    expect(solved(s)).toBe(true);
    expect(drop(s)).toBeNull();
  });

  it('turns the hanging piece and keeps it inside the well', () => {
    let s = well(3, 3, [[[0, 0], [0, 1], [0, 2]]]);
    s = slide(s, 5)!;
    expect(s.col).toBe(2);
    s = rotate(s)!;
    expect(s.moves).toBe(1);
    expect(boxW(current(s)!)).toBe(3);
    expect(s.col).toBe(0);
  });

  it('plans the cheapest answer, counting turns', () => {
    // The bar must lie flat on top: dealt upright, it takes one turn.
    const s = well(3, 2, [[[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]]]);
    const p = plan(s)!;
    expect(p.cost).toBe(3);
    expect(p.steps.map((x) => x.taps)).toEqual([0, 1]);
  });
});

describe('deals', () => {
  it('deals the shape the dial asks for, always fillable, deterministically', () => {
    for (const d of DIALS) for (const seed of [1, 2, 3]) {
      const s = newDrop(d, seed);
      const shape = dropShape(d);
      expect(s.width).toBe(shape.width);
      expect(s.depth).toBe(shape.depth);
      expect(s.preview).toBe(shape.preview);
      expect(s.pieces.reduce((a, p) => a + p.cells.length, 0)).toBe(s.width * s.depth);
      for (const p of s.pieces) {
        expect(p.cells.length).toBeGreaterThanOrEqual(1);
        expect(p.cells.length).toBeLessThanOrEqual(4);
        expect(p.protons.length).toBe(p.cells.length);
        if (p.cells.length === 2) expect(p.protons.filter(Boolean).length).toBe(1);
        if (p.cells.length === 4) expect(p.protons.filter(Boolean).length).toBe(2);
      }
      const p = plan(s)!;
      expect(p.cost).toBe(s.par);
      expect(s.par).toBeGreaterThanOrEqual(s.pieces.length);
      // Playing the plan fills the well in par.
      let t = s;
      for (const step of p.steps) {
        for (let k = 0; k < step.taps; k++) t = rotate(t)!;
        t = drop({ ...t, col: step.col })!;
      }
      expect(solved(t)).toBe(true);
      expect(t.moves).toBe(s.par);
      expect(JSON.stringify(newDrop(d, seed))).toBe(JSON.stringify(s));
    }
  });

  it('grows with the dial and holds more traps when harder', () => {
    for (let d = 2; d <= 100; d++) {
      expect(dropShape(d).width).toBeGreaterThanOrEqual(dropShape(d - 1).width);
      expect(dropShape(d).preview).toBeLessThanOrEqual(dropShape(d - 1).preview);
    }
    expect(dropShape(1).width).toBe(4);
    expect(dropShape(100).width).toBe(7);
    const avg = (d: number) => [1, 2, 3, 4, 5, 6].reduce((a, seed) => a + traps(newDrop(d, seed)), 0) / 6;
    expect(avg(90)).toBeGreaterThan(avg(10));
    for (const seed of [1, 2, 3, 4]) expect(traps(newDrop(100, seed))).toBeGreaterThanOrEqual(dropShape(100).traps);
  });

  it('deals quickly', () => {
    for (const d of [1, 50, 100]) {
      const t0 = performance.now();
      for (let seed = 1; seed <= 6; seed++) newDrop(d, seed);
      expect((performance.now() - t0) / 6).toBeLessThan(300);
    }
  });
});

describe('hints', () => {
  it('next steps play through to a full well', () => {
    for (const d of [1, 40, 100]) {
      let s = newDrop(d, 5);
      while (!solved(s)) {
        const st = nextStep(s)!;
        expect(st).not.toBeNull();
        s = place(s, st.rot, st.col)!;
        expect(sealed(s)).toEqual([]);
      }
      expect(nextStep(s)).toBeNull();
    }
  });
});

describe('view', () => {
  it('draws inside its area, and Show me fills the well in par', () => {
    for (const d of [1, 50, 100]) {
      const v = new DropView(newDrop(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.hint()).toMatch(/to drop/);
      const h = v.help(1)!;
      expect(h.moved).toBeUndefined();
      let guard = 0;
      while (!v.won && guard++ < 40) {
        expect(v.help(2)!.moved).toBe(true);
        const { ctx, pts } = recCtx();
        v.draw(ctx, AREAS_ALL[0], guard * 20);
        expect(inside(pts, AREAS_ALL[0])).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.undo()).toBe(true);
      expect(v.won).toBe(false);
      v.restart();
      expect(v.moves).toBe(0);
    }
  });

  it('says how far to undo after a sealed gap', () => {
    const v = new DropView(newDrop(30, 4), true);
    const s = (v as unknown as { state: DropState }).state;
    // Find a drop that seals a gap, after one good drop.
    v.help(2);
    const t = (v as unknown as { state: DropState }).state;
    let col = -1;
    for (let c = 0; c + boxW(current(t)!) <= t.width && col < 0; c++) {
      const after = drop({ ...t, col: c });
      if (after && !alive(after)) col = c;
    }
    expect(s.next).toBe(0);
    if (col < 0) return;
    (v as unknown as { state: DropState }).state = { ...t, col };
    v.key(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(v.help(1)!.text).toMatch(/Undo your last move/);
  });

  it('turns on a tap of the hanging cluster and drops where the well is tapped', () => {
    const v = new DropView(newDrop(30, 6), true);
    const area = { x: 0, y: 0, w: 400, h: 500 };
    v.draw(recCtx().ctx, area, 0);
    const L = (v as unknown as { L: { c: number; x: number; y: number; hang: number } }).L;
    const s0 = (v as unknown as { state: DropState }).state;
    const cells = current(s0)!;
    const px = L.x + (s0.col + 0.5) * L.c, py = L.hang - L.c * 0.5;
    const hit = cells.find(([x, y]) => x === 0 && y === Math.max(...cells.map(([, yy]) => yy)));
    v.down({ x: px, y: hit ? py : L.hang - (Math.max(...cells.filter(([x]) => x === 0).map(([, y]) => y)) + 0.5 - (Math.max(...cells.map(([, y]) => y)) + 1)) * L.c });
    v.up({ x: px, y: py });
    expect(v.moves).toBe(1);
    expect((v as unknown as { state: DropState }).state.rot).toBe(1);
    // A tap low in the well's first column drops the cluster there.
    v.down({ x: L.x + L.c * 0.5, y: L.y + L.c * 0.5 });
    v.up({ x: L.x + L.c * 0.5, y: L.y + L.c * 0.5 });
    const s1 = (v as unknown as { state: DropState }).state;
    expect(s1.next).toBe(1);
    expect(v.moves).toBe(2);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['No gaps', 'Look ahead']);
    expect(RULES.map((r) => r.title)).toEqual(['Drop', 'Turn', 'No gaps', 'Look ahead']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  });
});
