import { describe, expect, it } from 'vitest';
import { applySlide, newSliding, reach, slidingPlan, solveSliding, solved, type SlidingState } from '../src/puzzles/sliding';
import { INSTRUCTIONS, RULES, SlidingView } from '../src/puzzles/slidingView';
import { C } from '../src/puzzles/palette';
import type { Area, RuleCard } from '../src/puzzles/view';

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

/**
 * Records every coordinate a picture draws (through translate and scale), and every color it
 * paints with. Shapes drawn under a clip (a piece leaving through a gap, cut off at the edge)
 * are cut by the clip, so they are skipped.
 */
function record(draw: (ctx: CanvasRenderingContext2D) => void): { pts: [number, number][]; colors: Set<unknown> } {
  const pts: [number, number][] = [];
  const colors = new Set<unknown>();
  let m = { tx: 0, ty: 0, s: 1 };
  const stack: { m: typeof m; clipped: boolean }[] = [];
  let clipped = false;
  const rec = (x: number, y: number) => { if (!clipped) pts.push([m.tx + x * m.s, m.ty + y * m.s]); };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'save') return () => { stack.push({ m: { ...m }, clipped }); };
      if (k === 'restore') return () => { const top = stack.pop(); if (top) { m = top.m; clipped = top.clipped; } };
      if (k === 'clip') return () => { clipped = true; };
      if (k === 'translate') return (x: number, y: number) => { m = { ...m, tx: m.tx + x * m.s, ty: m.ty + y * m.s }; };
      if (k === 'scale') return (sx: number) => { m = { ...m, s: m.s * sx }; };
      if (k === 'moveTo' || k === 'lineTo') return rec;
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'ellipse') return (x: number, y: number, rx: number, ry: number) => { rec(x - rx, y - ry); rec(x + rx, y + ry); };
      if (k === 'rect' || k === 'roundRect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      return () => {};
    },
    set(o, k, v) {
      o[k] = v;
      if (k === 'strokeStyle' || k === 'fillStyle') colors.add(v);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  draw(ctx);
  return { pts, colors };
}

/** Every card has a title and plain text; every picture stays in its box all through its play. */
function checkPictures(rules: RuleCard[]): void {
  for (const r of rules) {
    expect(r.title.length, r.title).toBeGreaterThan(0);
    expect(r.text.length, r.title).toBeGreaterThan(0);
    expect(r.text, r.title).not.toMatch(/[<>]/);
    expect(r.demo, r.title).toBeUndefined();
    if (r.bad) expect(r.good, r.title).toBeDefined();
    for (const pic of [r.good, r.bad]) {
      if (!pic) continue;
      expect(pic.duration, r.title).toBeGreaterThanOrEqual(1.5);
      expect(pic.duration, r.title).toBeLessThanOrEqual(4);
      for (const [w, h] of [[140, 104], [120, 90]]) {
        for (let i = 0; i <= 40; i++) {
          const t = (pic.duration * i) / 40;
          const { pts } = record((ctx) => pic.draw(ctx, w, h, t));
          for (const [x, y] of pts) {
            expect(x, `${r.title} ${w}x${h} at ${t.toFixed(2)}s`).toBeGreaterThanOrEqual(-0.5);
            expect(x, `${r.title} ${w}x${h} at ${t.toFixed(2)}s`).toBeLessThanOrEqual(w + 0.5);
            expect(y, `${r.title} ${w}x${h} at ${t.toFixed(2)}s`).toBeGreaterThanOrEqual(-0.5);
            expect(y, `${r.title} ${w}x${h} at ${t.toFixed(2)}s`).toBeLessThanOrEqual(h + 0.5);
          }
        }
      }
    }
  }
}

describe('rule cards', () => {
  it('have a title, plain text and pictures that stay in their box', () => {
    expect(RULES.map((r) => r.title)).toEqual(['The key bar', 'Bars slide lengthwise', 'Walls', 'Loose pieces', 'Clear the way', 'Keyboard']);
    checkPictures(RULES);
    for (const r of RULES) expect(Boolean(r.good), r.title).toBe(r.title !== 'Keyboard');
  });

  it('shows the move that fails beside the one that works, flagged in amber', () => {
    expect(RULES.filter((r) => r.bad).map((r) => r.title)).toEqual(['Bars slide lengthwise', 'Walls', 'Loose pieces', 'Clear the way']);
    for (const r of RULES.filter((x) => x.bad)) {
      expect(record((ctx) => r.bad!.draw(ctx, 140, 104, r.bad!.duration)).colors.has(C.warn), r.title).toBe(true);
      expect(record((ctx) => r.good!.draw(ctx, 140, 104, r.good!.duration)).colors.has(C.warn), r.title).toBe(false);
    }
  });

  it('keeps only the game meta in INSTRUCTIONS', () => {
    expect(INSTRUCTIONS).toMatch(/<h3>In the game<\/h3>/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
  });
});
