import { describe, expect, it } from 'vitest';
import { begin, blocked, countSolutions, edgeKey, endedShort, extend, firstWrong, neighbors, newTrace, nextStep, solved, traceShape, type TraceState } from '../src/puzzles/trace';
import { INSTRUCTIONS, RULES, TraceView } from '../src/puzzles/traceView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DS = [1, 12, 13, 22, 23, 36, 37, 50, 68, 69, 80, 92, 100];

describe('deals', () => {
  it('is the same deal for the same dial and seed', () => {
    const a = newTrace(60, 4), b = newTrace(60, 4);
    expect(a.solution).toEqual(b.solution);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.walls).toEqual(b.walls);
  }, 60_000);

  it('deals one trail through every cell, numbered in order, with one answer, across the dial', () => {
    for (const d of DS) for (const seed of [1, 2, 3, 4]) {
      const s = newTrace(d, seed);
      const n = s.size;
      expect(n).toBe(traceShape(d).size);
      expect(new Set(s.solution).size).toBe(n * n);
      for (let i = 1; i < s.solution.length; i++) {
        expect(neighbors(n, s.solution[i - 1])).toContain(s.solution[i]);
        expect(s.walls).not.toContain(edgeKey(s.solution[i - 1], s.solution[i]));
      }
      expect(s.checkpoints[0]).toBe(s.solution[0]);
      expect(s.checkpoints[s.checkpoints.length - 1]).toBe(s.solution[n * n - 1]);
      const order = s.checkpoints.map((c) => s.solution.indexOf(c));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(s.walls.length).toBe(traceShape(d).walls);
      expect(countSolutions(n, s.checkpoints, s.walls, 2, 1e8)).toBe(1);
      expect(s.par).toBe(s.checkpoints.length - 1);
    }
  }, 60_000);

  it('gets bigger, sparer and walled up the dial', () => {
    const share = (d: number) => [1, 2, 3].reduce((a, seed) => { const s = newTrace(d, seed); return a + s.checkpoints.length / (s.size * s.size); }, 0);
    expect(share(1)).toBeGreaterThan(share(50));
    expect(share(50)).toBeGreaterThan(share(100));
    expect(traceShape(1).size).toBe(5);
    expect(traceShape(100).size).toBe(8);
    expect(traceShape(1).walls).toBe(0);
    expect(traceShape(100).walls).toBeGreaterThan(traceShape(50).walls);
  }, 60_000);

  it('deals quickly, even at the top of the dial', () => {
    for (const d of [100, 85, 70]) {
      const t0 = performance.now();
      for (const seed of [21, 22, 23]) newTrace(d, seed);
      expect((performance.now() - t0) / 3).toBeLessThan(300);
    }
  }, 60_000);
});

describe('play', () => {
  it('starts only on the 1, pulls back, refuses walls, numbers out of turn and steps past the end', () => {
    const s: TraceState = { size: 3, checkpoints: [0, 2, 8], walls: [edgeKey(1, 4)], path: [], solution: [0, 1, 2, 5, 4, 3, 6, 7, 8], moves: 0, par: 2 };
    expect(begin(s, 1)).toBe(false);
    expect(begin(s, 0)).toBe(true);
    expect(extend(s, 1)).toBe(true);
    expect(blocked(s, 4)).toBe('wall');
    expect(extend(s, 4)).toBe(false);
    // Back onto the trail pulls it in.
    expect(extend(s, 0)).toBe(true);
    expect(s.path).toEqual([0]);
    for (const c of [3, 6, 7]) expect(extend(s, c)).toBe(true);
    // The 3 cannot come before the 2.
    expect(blocked(s, 8)).toBe('order');
    begin(s, 0);
    for (const c of [1, 2, 5, 4, 3, 6, 7, 8]) expect(extend(s, c)).toBe(true);
    expect(solved(s)).toBe(true);
    // Reaching the end early is allowed but leaves cells missed, and nothing goes past it.
    begin(s, 2);
    expect(extend(s, 5)).toBe(true);
    expect(extend(s, 8)).toBe(true);
    expect(endedShort(s)).toBe(true);
    expect(blocked(s, 7)).toBe('end');
    expect(solved(s)).toBe(false);
  }, 60_000);

  it('finds where the trail strays, and the next step follows the answer', () => {
    const s = newTrace(40, 3);
    begin(s, s.checkpoints[0]);
    for (let k = 0; k < 4; k++) {
      const step = nextStep(s)!;
      expect(step.cell).toBe(s.solution[s.path.length]);
      expect(step.why.length).toBeGreaterThan(0);
      extend(s, step.cell);
    }
    expect(firstWrong(s)).toBe(-1);
    const head = s.path[s.path.length - 1];
    const off = neighbors(s.size, head).find((c) => !s.path.includes(c) && c !== s.solution[s.path.length] && !blocked(s, c));
    if (off !== undefined) {
      extend(s, off);
      expect(firstWrong(s)).toBe(s.path.length - 1);
    }
  }, 60_000);
});

describe('view', () => {
  it('draws inside its area and reports progress', () => {
    for (const d of [1, 50, 100]) {
      const v = new TraceView(newTrace(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Cells');
      expect(v.hint()).toBe('Start on the 1');
    }
  }, 60_000);

  it('draws a stroke by dragging, counts it once, and undo takes it back', () => {
    const s = newTrace(1, 5);
    const v = new TraceView(s, false);
    const area = { x: 0, y: 0, w: 400, h: 400 };
    const { ctx } = recCtx();
    v.draw(ctx, area, 0);
    // Find the board's geometry from a known fit: cells are square inside the area.
    const geo = (v as unknown as { geo: { x: number; y: number; c: number } }).geo;
    const at = (cell: number) => ({ x: geo.x + ((cell % s.size) + 0.5) * geo.c, y: geo.y + (Math.floor(cell / s.size) + 0.5) * geo.c });
    v.down(at(s.solution[0]));
    for (let i = 1; i < 6; i++) v.move(at(s.solution[i]));
    v.up();
    expect(v.moves).toBe(1);
    expect(v.stats().progress.value).toBe(`6/${s.size * s.size}`);
    v.draw(ctx, area, 50);
    expect(v.undo()).toBe(true);
    expect(v.stats().progress.value).toBe(`0/${s.size * s.size}`);
    // A drag that changes nothing costs nothing.
    v.down(at(s.solution[3]));
    v.up();
    expect(v.moves).toBe(0);
  }, 60_000);

  it('Look here and Show me lead all the way to a win at par', () => {
    for (const d of [1, 40, 80, 100]) {
      const v = new TraceView(newTrace(d, 7), true);
      const h1 = v.help(1)!;
      expect(h1.moved).toBeUndefined();
      expect(h1.text).toMatch(/1/);
      for (let k = 0; k < 100 && !v.won; k++) {
        expect(v.help(1)).not.toBeNull();
        expect(v.help(2)!.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.hint()).toBe('Every cell traced');
      const { ctx, pts } = recCtx();
      v.draw(ctx, AREAS_ALL[0], 0);
      expect(inside(pts, AREAS_ALL[0])).toBe(true);
    }
  }, 60_000);

  it('Show me pulls a stray trail back first', () => {
    const s = newTrace(30, 8);
    const v = new TraceView(s, true);
    v.help(2);
    const st = (v as unknown as { state: TraceState }).state;
    const head = st.path[st.path.length - 1];
    const off = neighbors(st.size, head).find((c) => !st.path.includes(c) && c !== st.solution[st.path.length] && !blocked(st, c));
    if (off === undefined) return;
    st.path.push(off);
    expect(v.help(1)!.text).toMatch(/astray/);
    expect(v.help(2)!.moved).toBe(true);
    expect(firstWrong((v as unknown as { state: TraceState }).state)).toBe(-1);
  }, 60_000);

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['In order', 'Every cell', 'Walls']);
    expect(RULES.map((r) => r.title)).toEqual(['Trail', 'In order', 'Every cell', 'Walls']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  }, 60_000);
});
