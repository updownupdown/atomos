import { describe, expect, it } from 'vitest';
import { applySlide, newSliding, reach, slidingPlan, solveSliding, solved, type SlidingState } from '../src/puzzles/sliding';
import { INSTRUCTIONS, RULES, SlidingView } from '../src/puzzles/slidingView';
import type { Area } from '../src/puzzles/view';

const ZS = [27, 40, 44, 45, 59, 60, 74, 75, 91, 92, 105, 106, 118];

describe('sliding block rules', () => {
  const board = (): SlidingState => ({
    w: 6, h: 6, exitRow: 2, walls: [5 * 6 + 0], moves: 0, par: 1,
    blocks: [
      { id: 0, x: 0, y: 2, len: 2, horiz: true, free: false },
      { id: 1, x: 3, y: 1, len: 2, horiz: false, free: false },
      { id: 2, x: 0, y: 4, len: 1, horiz: true, free: true },
    ],
  });

  it('slides bars only along their axis, within their slack', () => {
    const s = board();
    expect(reach(s, 0)).toEqual({ left: 0, right: 1, up: 0, down: 0 });
    expect(applySlide(s, { id: 0, dx: 2, dy: 0 })).toBeNull();
    expect(applySlide(s, { id: 0, dx: 0, dy: 1 })).toBeNull();
    expect(applySlide(s, { id: 0, dx: 0, dy: 0 })).toBeNull();
    expect(applySlide(s, { id: 1, dx: 0, dy: 2 })!.blocks[1].y).toBe(3);
    expect(applySlide(s, { id: 1, dx: 1, dy: 0 })).toBeNull();
  });

  it('lets a free block slide any way but not through a wall', () => {
    const s = board();
    expect(reach(s, 2)).toEqual({ left: 0, right: 5, up: 1, down: 0 });
    expect(applySlide(s, { id: 2, dx: 0, dy: 1 })).toBeNull();
    expect(applySlide(s, { id: 2, dx: 3, dy: 0 })!.blocks[2].x).toBe(3);
    expect(applySlide(s, { id: 2, dx: 1, dy: 1 })).toBeNull();
  });

  it('is solved when the key bar reaches the right wall, and the solver agrees', () => {
    const s = board();
    expect(solved(s)).toBe(false);
    expect(solveSliding(s)).toBe(2);
    const t = applySlide(applySlide(s, { id: 1, dx: 0, dy: 2 })!, { id: 0, dx: 4, dy: 0 })!;
    expect(solved(t)).toBe(true);
    expect(t.moves).toBe(2);
  });
});

describe('sliding block levels', () => {
  it('deals the same level for the same seed', () => {
    expect(newSliding(30, 5)).toEqual(newSliding(30, 5));
    expect(newSliding(100, 5)).toEqual(newSliding(100, 5));
    expect(newSliding(100, 5)).not.toEqual(newSliding(100, 6));
  });

  it('deals solvable levels whose par is the solver optimum and near the target', () => {
    for (const z of ZS) for (const seed of [1, 2, 3]) {
      const s = newSliding(z, seed * 7919 + z);
      const plan = slidingPlan(z);
      expect(solved(s)).toBe(false);
      expect(s.w).toBe(plan.w);
      expect(s.h).toBe(plan.h);
      expect(solveSliding(s, 400000)).toBe(s.par);
      expect(s.par).toBeGreaterThanOrEqual(Math.max(3, plan.target - 2));
      expect(s.par).toBeLessThanOrEqual(plan.target + 3);
      // Nothing overlaps, nothing sits on a wall, the key is on the exit row.
      const seen = new Set(s.walls);
      for (const b of s.blocks) {
        const cells = b.free ? [[b.x, b.y]] : Array.from({ length: b.len }, (_, i) => (b.horiz ? [b.x + i, b.y] : [b.x, b.y + i]));
        for (const [x, y] of cells) {
          expect(x >= 0 && y >= 0 && x < s.w && y < s.h).toBe(true);
          expect(seen.has(y * s.w + x)).toBe(false);
          seen.add(y * s.w + x);
        }
      }
      expect(s.blocks[0].y).toBe(s.exitRow);
      expect(s.blocks[0].horiz).toBe(true);
    }
  });

  it('rises with the element: walls, free blocks and a taller board', () => {
    expect(slidingPlan(27).target).toBe(4);
    expect(slidingPlan(118).target).toBeGreaterThanOrEqual(20);
    expect(newSliding(30, 1).walls).toHaveLength(0);
    expect(newSliding(60, 1).walls.length).toBeGreaterThanOrEqual(1);
    expect(newSliding(95, 1).blocks.some((b) => b.free)).toBe(true);
    expect(newSliding(110, 1).h).toBe(7);
  });

  it('deals fast enough for every element', () => {
    newSliding(60, 1);
    let worst = 0;
    for (let z = 27; z <= 118; z += 3) {
      const t = performance.now();
      newSliding(z, z * 13 + 1);
      worst = Math.max(worst, performance.now() - t);
    }
    expect(worst).toBeLessThan(250);
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
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'arcTo') return (x1: number, y1: number, x2: number, y2: number) => { rec(x1, y1); rec(x2, y2); };
      if (k === 'rect' || k === 'roundRect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, pts };
}

describe('sliding block view', () => {
  const AREAS: Area[] = [{ x: 0, y: 0, w: 340, h: 430 }, { x: 10, y: 8, w: 1200, h: 700 }, { x: 0, y: 0, w: 640, h: 300 }];

  it('draws inside the area at any size', () => {
    for (const z of [27, 80, 118]) for (const area of AREAS) {
      const v = new SlidingView(newSliding(z, 2), true);
      const { ctx, pts } = mockCtx();
      v.draw(ctx, area, 0);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(area.x - 0.5);
        expect(x).toBeLessThanOrEqual(area.x + area.w + 0.5);
        expect(y).toBeGreaterThanOrEqual(area.y - 0.5);
        expect(y).toBeLessThanOrEqual(area.y + area.h + 0.5);
      }
      expect(v.hint().length).toBeLessThanOrEqual(40);
    }
  });

  it('drags a bar along its track, clamped to its slack, and snaps to a cell', () => {
    const s: SlidingState = {
      w: 6, h: 6, exitRow: 2, walls: [], moves: 0, par: 2,
      blocks: [
        { id: 0, x: 0, y: 2, len: 2, horiz: true, free: false },
        { id: 1, x: 3, y: 1, len: 2, horiz: false, free: false },
      ],
    };
    const v = new SlidingView(s, true);
    v.draw(mockCtx().ctx, AREAS[0], 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { cell, origin } = v as any;
    const at = (x: number, y: number) => ({ x: origin.x + x * cell, y: origin.y + y * cell });
    // Pull the upright bar far down: it stops at the bottom wall (two cells).
    v.down(at(3.5, 1.5));
    v.move(at(3.5, 3));
    v.move(at(3.5, 9));
    v.up(at(3.5, 9));
    expect(v.moves).toBe(1);
    // A sideways tug on an upright bar does nothing.
    v.down(at(3.5, 3.5));
    v.up(at(5.5, 3.5));
    expect(v.moves).toBe(1);
    // Now the key bar slides all the way out.
    v.down(at(0.5, 2.5));
    v.up(at(6, 2.5));
    expect(v.won).toBe(true);
    expect(v.moves).toBe(2);
    expect(v.clean).toBe(true);
    expect(v.undo()).toBe(true);
    expect(v.won).toBe(false);
  });
});

/** Records every coordinate a rule demo draws. */
function demoPoints(draw: (ctx: CanvasRenderingContext2D) => void): [number, number][] {
  const pts: [number, number][] = [];
  const rec = (x: number, y: number) => pts.push([x, y]);
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'moveTo' || k === 'lineTo') return rec;
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'rect' || k === 'roundRect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  draw(ctx);
  return pts;
}

describe('rule cards', () => {
  it('have plain text and demos that stay in their box, and INSTRUCTIONS keeps only the game meta', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(5);
    for (const r of RULES) {
      expect(r.text).not.toMatch(/<|>/);
      for (const [w, h] of [[120, 96], [220, 160]]) for (let s = 0; s < 7; s += 0.1) {
        for (const [x, y] of demoPoints((ctx) => r.demo!(ctx, w, h, s))) {
          expect(x).toBeGreaterThanOrEqual(-1);
          expect(x).toBeLessThanOrEqual(w + 1);
          expect(y).toBeGreaterThanOrEqual(-1);
          expect(y).toBeLessThanOrEqual(h + 1);
        }
      }
    }
    expect(INSTRUCTIONS).toMatch(/<h3>In the game<\/h3>/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
  });
});
