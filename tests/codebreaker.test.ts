import { describe, expect, it } from 'vitest';
import { consistent, cycleSlot, EMPTY, MAX_ROWS, newCodebreaker, score, setSlot, SLOTS, solved, stuck, submit, SYMBOLS } from '../src/puzzles/codebreaker';
import { INSTRUCTIONS, RULES } from '../src/puzzles/codebreakerView';
import { C } from '../src/puzzles/palette';
import type { RuleCard } from '../src/puzzles/view';

const ZS = [1, 6, 26, 50, 92, 118];

describe('clues', () => {
  it('counts exact and near matches the Mastermind way', () => {
    expect(score([0, 1, 2, 3], [0, 1, 2, 3])).toEqual({ exact: 4, near: 0 });
    expect(score([0, 1, 2, 3], [3, 2, 1, 0])).toEqual({ exact: 0, near: 4 });
    expect(score([0, 1, 2, 3], [0, 3, 5, 5])).toEqual({ exact: 1, near: 1 });
    expect(score([0, 0, 1, 1], [0, 1, 0, 5])).toEqual({ exact: 1, near: 2 });
    expect(score([0, 0, 0, 1], [1, 1, 1, 0])).toEqual({ exact: 0, near: 2 });
  });
});

describe('guessing', () => {
  it('cycles slots and refuses an incomplete guess', () => {
    const s = newCodebreaker(1, 1);
    expect(submit(s)).toBeNull();
    let d = cycleSlot(s, 0);
    expect(d.draft[0]).toBe(0);
    d = cycleSlot(d, 0, -1);
    expect(d.draft[0]).toBe(SYMBOLS - 1);
    expect(cycleSlot(s, 0, -1).draft[0]).toBe(SYMBOLS - 1);
    expect(s.draft[0]).toBe(EMPTY);
  });

  it('submits a row with its clue, clears the draft and wins on the secret', () => {
    const s = newCodebreaker(6, 2);
    let d = s;
    for (let k = 0; k < SLOTS; k++) d = setSlot(d, k, (s.secret[k] + 1) % SYMBOLS);
    const r = submit(d)!;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].exact).toBe(0);
    expect(r.draft.every((x) => x === EMPTY)).toBe(true);
    expect(r.moves).toBe(1);
    expect(solved(r)).toBe(false);
    let w = r;
    for (let k = 0; k < SLOTS; k++) w = setSlot(w, k, s.secret[k]);
    w = submit(w)!;
    expect(solved(w)).toBe(true);
    expect(w.moves).toBe(2);
    expect(submit(setSlot(setSlot(setSlot(setSlot(w, 0, 0), 1, 0), 2, 0), 3, 0))).toBeNull();
  });

  it('is stuck after ten wrong guesses', () => {
    const s = newCodebreaker(1, 3);
    const wrong = s.secret.map((k) => (k + 1) % SYMBOLS);
    let d = s;
    for (let i = 0; i < MAX_ROWS; i++) {
      wrong.forEach((k, j) => (d = setSlot(d, j, k)));
      d = submit(d)!;
    }
    expect(stuck(d)).toBe(true);
    expect(solved(d)).toBe(false);
    wrong.forEach((k, j) => (d = setSlot(d, j, k)));
    expect(submit(d)).toBeNull();
  });
});

describe('levels', () => {
  it('is the same code for the same seed', () => {
    expect(newCodebreaker(110, 9)).toEqual(newCodebreaker(110, 9));
  });

  it('has four symbols from six, distinct below the heaviest elements, with par 5', () => {
    for (const z of ZS) {
      for (let seed = 1; seed <= 10; seed++) {
        const s = newCodebreaker(z, seed);
        expect(s.secret).toHaveLength(SLOTS);
        for (const k of s.secret) expect(k >= 0 && k < SYMBOLS).toBe(true);
        if (z < 112) expect(new Set(s.secret).size).toBe(SLOTS);
        expect(s.par).toBe(5);
        expect(s.rows).toEqual([]);
      }
    }
  });

  it('is always solvable: the secret stays consistent with every clue', () => {
    const s = newCodebreaker(104, 5);
    let d = s;
    [0, 1, 2, 3].forEach((k, j) => (d = setSlot(d, j, k)));
    d = submit(d)!;
    [2, 3, 4, 5].forEach((k, j) => (d = setSlot(d, j, k)));
    d = submit(d)!;
    expect(consistent(d, s.secret)).toBe(true);
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
    expect(RULES.map((r) => r.title)).toEqual(['The sealed code', 'Make a guess', 'Filled dot', 'Hollow dot', 'Six symbols', 'Repeats', 'Ten guesses', 'Keyboard']);
    checkPictures(RULES);
    for (const r of RULES) expect(Boolean(r.good), r.title).toBe(r.title !== 'Keyboard');
  });

  it('shows the move that fails beside the one that works, flagged in amber, never red', () => {
    expect(RULES.filter((r) => r.bad).map((r) => r.title)).toEqual(['Make a guess', 'Ten guesses']);
    for (const r of RULES.filter((x) => x.bad)) {
      const bad = record((ctx) => r.bad!.draw(ctx, 140, 104, r.bad!.duration)).colors;
      expect(bad.has(C.warn), r.title).toBe(true);
      expect(bad.has(C.bad) || bad.has(C.target), r.title).toBe(false);
      expect(record((ctx) => r.good!.draw(ctx, 140, 104, r.good!.duration)).colors.has(C.warn), r.title).toBe(false);
    }
  });

  it('keeps only the game meta in INSTRUCTIONS', () => {
    expect(INSTRUCTIONS).toMatch(/<h3>In the game<\/h3>/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
  });
});
