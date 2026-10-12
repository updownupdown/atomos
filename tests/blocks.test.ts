import { describe, expect, it } from 'vitest';
import {
  blocksShape, candidatesFor, cellsOf, covered, drawRect, firstWrong, flawOf, newBlocks, rate, removeAt, sameRect, solutions, solved, spanning, type BlocksState,
} from '../src/puzzles/blocks';
import { BlocksView, fillOf, INSTRUCTIONS, RULES, subshellOf } from '../src/puzzles/blocksView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';


/** Node's CPU clock (the tests run in Node; the app's types leave it out). */
declare const process: { cpuUsage(prev?: { user: number; system: number }): { user: number; system: number } };
const DS = [1, 5, 10, 14, 15, 25, 32, 33, 45, 50, 51, 60, 68, 69, 80, 86, 87, 100];

describe('deals', () => {
  it('grows the board and the rectangles along the dial', () => {
    expect(blocksShape(1)).toMatchObject({ size: 5, maxArea: 5 });
    expect(blocksShape(100)).toMatchObject({ size: 10, maxArea: 14 });
    let size = 0, area = 0;
    for (let d = 1; d <= 100; d++) {
      const sh = blocksShape(d);
      expect(sh.size).toBeGreaterThanOrEqual(size);
      expect(sh.maxArea).toBeGreaterThanOrEqual(area);
      size = sh.size; area = sh.maxArea;
    }
  });

  it('is the same deal for the same dial and seed', () => {
    expect(newBlocks(60, 3)).toEqual(newBlocks(60, 3));
    expect(newBlocks(60, 3).clues).not.toEqual(newBlocks(60, 4).clues);
  });

  it('deals exactly one answer, human-solvable, across the dial', () => {
    for (const d of DS) for (const seed of [1, 2, 3]) {
      const s = newBlocks(d, seed);
      const n = s.size;
      const { maxArea } = blocksShape(d);
      expect(s.solution.length).toBe(s.clues.length);
      expect(s.clues.reduce((a, c) => a + c.area, 0)).toBe(n * n);
      expect(solutions(n, s.clues, 3).length).toBe(1);
      expect(sameRect(solutions(n, s.clues, 1)[0][0], s.solution[0])).toBe(true);
      expect(rate(n, s.clues)).toBe(s.score);
      s.clues.forEach((c, k) => {
        const r = s.solution[k];
        expect(r.w * r.h).toBe(c.area);
        expect(c.area).toBeGreaterThanOrEqual(2);
        expect(c.area).toBeLessThanOrEqual(maxArea);
        expect(cellsOf(r, n)).toContain(c.cell);
      });
      // The answer, drawn, is a win.
      let full: BlocksState = s;
      for (const r of s.solution) full = drawRect(full, r)!;
      expect(solved(full)).toBe(true);
      expect(full.moves).toBe(s.par);
    }
  }, 60000);

  it('asks harder deals of a size as the dial rises', () => {
    const avg = (d: number) => { let t = 0; for (let seed = 1; seed <= 8; seed++) t += newBlocks(d, seed).score; return t / 8; };
    expect(avg(68)).toBeGreaterThan(avg(51));
    expect(avg(100)).toBeGreaterThan(avg(87));
  }, 60000);

  it('deals quickly, even at the top of the dial', () => {
    let worst = 0;
    for (let seed = 1; seed <= 6; seed++) {
      // CPU time, not wall time, so a busy machine does not fail it.
      const t0 = process.cpuUsage();
      newBlocks(100, seed);
      const t = process.cpuUsage(t0);
      worst = Math.max(worst, (t.user + t.system) / 1000);
    }
    expect(worst).toBeLessThan(400);
  }, 60000);
});

describe('play', () => {
  const s0 = (): BlocksState => newBlocks(20, 1);

  it('lists the ways a number can fit', () => {
    const s = s0();
    s.clues.forEach((c, k) => {
      const ways = candidatesFor(s.size, s.clues, k);
      expect(ways.some((r) => sameRect(r, s.solution[k]))).toBe(true);
      for (const r of ways) expect(r.w * r.h).toBe(c.area);
    });
  });

  it('draws, replaces what a new rectangle overlaps, and removes on tap', () => {
    const s = s0();
    const a = drawRect(s, s.solution[0])!;
    expect(a.rects.length).toBe(1);
    expect(a.moves).toBe(1);
    expect(drawRect(a, s.solution[0])).toBeNull();
    const big = drawRect(a, { x: 0, y: 0, w: s.size, h: 1 })!;
    expect(big.rects.length).toBe(1);
    expect(sameRect(big.rects[0], { x: 0, y: 0, w: s.size, h: 1 })).toBe(true);
    const r0 = s.solution[0];
    const gone = removeAt(a, r0.y * s.size + r0.x)!;
    expect(gone.rects.length).toBe(0);
    expect(gone.moves).toBe(1);
    expect(removeAt(gone, 0)).toBeNull();
    expect(covered(a)).toBe(r0.w * r0.h);
  });

  it('flags no number, two numbers and a wrong area', () => {
    const s = s0();
    const n = s.size;
    const free = Array.from({ length: n * n }, (_, i) => i).filter((i) => !s.clues.some((c) => c.cell === i));
    const blank = free.find((i) => i % n < n - 1 && free.includes(i + 1))!;
    expect(flawOf(s, spanning(n, blank, blank + 1))).toBe('none');
    expect(flawOf(s, { x: 0, y: 0, w: n, h: n })).toBe('many');
    const c = s.clues[0];
    const r = s.solution[0];
    expect(flawOf(s, r)).toBeNull();
    const wrongArea = r.w * r.h === 1 ? { ...r, w: 2 } : { x: c.cell % n, y: Math.floor(c.cell / n), w: 1, h: 1 };
    expect(flawOf(s, wrongArea)).not.toBeNull();
    expect(firstWrong(drawRect(s, { x: 0, y: 0, w: n, h: n })!)).toBe(0);
  });

  it('names a size by its subshell', () => {
    expect([1, 2, 3, 6, 7, 10, 11, 14].map(subshellOf).join('')).toBe('ssppddff');
    expect(fillOf(4)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('view', () => {
  it('draws inside its area and reports progress', () => {
    for (const d of [1, 50, 100]) {
      const v = new BlocksView(newBlocks(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Boxed');
      expect(v.hint()).toMatch(/cells left/);
    }
  });

  it('drags a rectangle out and taps it away, through the pointer', () => {
    const s = newBlocks(1, 1);
    const v = new BlocksView(s, true);
    const { ctx } = recCtx();
    v.draw(ctx, { x: 0, y: 0, w: 400, h: 400 }, 0);
    const n = s.size;
    const at = (cx: number, cy: number) => ({ x: 200 + (cx - (n - 1) / 2) * 72, y: 200 + (cy - (n - 1) / 2) * 72 });
    const r = s.solution[0];
    v.down(at(r.x, r.y));
    v.move(at(r.x + r.w - 1, r.y + r.h - 1));
    // Mid-drag the preview draws, with its size beside it.
    const mid = recCtx();
    v.draw(mid.ctx, { x: 0, y: 0, w: 400, h: 400 }, 0);
    v.up(at(r.x + r.w - 1, r.y + r.h - 1));
    expect(v.moves).toBe(1);
    expect(v.stats().progress.value).toBe(`1/${s.clues.length}`);
    v.down(at(r.x, r.y)); v.up(at(r.x, r.y));
    expect(v.stats().progress.value).toBe(`0/${s.clues.length}`);
    expect(v.moves).toBe(1);
    v.undo(); v.undo();
    expect(v.canUndo()).toBe(false);
  });

  it('plays itself to a win with Show me, every hint pointing somewhere', () => {
    for (const d of [1, 35, 70, 100]) for (const seed of [1, 2]) {
      const v = new BlocksView(newBlocks(d, seed), true);
      for (let k = 0; k < 200 && !v.won; k++) {
        const look = v.help(1);
        expect(look, `d${d} s${seed} step ${k}`).not.toBeNull();
        expect(look!.moved).toBeUndefined();
        expect(v.help(2)!.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.clean).toBe(true);
      expect(v.hint()).toBe('Every number boxed');
    }
  }, 60000);

  it('points at a wrong rectangle first, then clears it', () => {
    const s = newBlocks(30, 1);
    const n = s.size;
    const v = new BlocksView(s, true);
    (v as unknown as { apply(x: BlocksState | null): void }).apply(drawRect(s, { x: 0, y: 0, w: n, h: 1 }));
    expect(v.help(1)!.text).toMatch(/rectangle/);
    expect(v.help(2)!.text).toMatch(/Removed/);
    expect(v.help(1)!.text).not.toMatch(/Removed|rectangle holds/);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['One number', 'Area']);
    expect(RULES.map((r) => r.title)).toEqual(['Rectangles', 'One number', 'Area', 'Fill the grid', 'Colors']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });
});
