import { describe, expect, it } from 'vitest';
import { bestGuess, candidates, consistent, cycleSlot, decided, EMPTY, MAX_ROWS, newCodebreaker, score, setSlot, SLOTS, solved, stuck, submit, SYMBOLS, type CodebreakerState } from '../src/puzzles/codebreaker';
import { CodebreakerView, INSTRUCTIONS, RULES } from '../src/puzzles/codebreakerView';
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

describe('help', () => {
  type Inside = { state: CodebreakerState; cursor: number; mark: { state: CodebreakerState; slots: number[]; keys: number[]; submit: boolean } | null; put(k: number): void; trySubmit(): void };
  const inside = (v: CodebreakerView) => v as unknown as Inside;
  // Glyph plays elements 104 to 117: distinct codes below 112, repeats allowed from there.
  const DEALS = [104, 106, 108, 110, 111, 112, 114, 115, 117].flatMap((z) => [1, 2, 3, 4].map((seed) => ({ z, seed })));

  /** One plain sentence: no markup, no em dash. */
  const plain = (text: string) => {
    expect(text).toMatch(/^[A-Z][^<>\u2014]*\.$/);
    expect(text.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length).toBe(1);
  };

  /** Types a whole guess the player's way and guesses. */
  const guess = (v: CodebreakerView, code: number[]) => {
    code.forEach((k, slot) => { inside(v).cursor = slot; inside(v).put(k); });
    inside(v).trySubmit();
  };

  it('knows which codes still fit, and what they decide', () => {
    const s = newCodebreaker(104, 1);
    expect(candidates(s)).toHaveLength(360);
    expect(candidates(newCodebreaker(112, 1))).toHaveLength(SYMBOLS ** SLOTS);
    let d = s;
    [0, 1, 2, 3].forEach((k, j) => (d = setSlot(d, j, k)));
    d = submit(d)!;
    const codes = candidates(d);
    expect(codes.some((c) => c.join() === s.secret.join())).toBe(true);
    for (const c of codes) expect(consistent(d, c)).toBe(true);
    const { can, outCode } = decided(codes);
    for (let k = 0; k < SYMBOLS; k++) expect(outCode[k]).toBe(!s.secret.includes(k) && can.every((row) => !row[k]));
  });

  it('Look here marks a symbol or a slot and leaves the board alone', () => {
    for (const { z, seed } of DEALS) {
      const v = new CodebreakerView(newCodebreaker(z, seed), true);
      for (let round = 0; round < 3 && !v.won; round++) {
        const before = inside(v).state, snap = JSON.stringify(before), moves = v.moves;
        const h = v.help(1)!;
        plain(h.text);
        expect(h.moved).toBeUndefined();
        expect(inside(v).state).toBe(before);
        expect(JSON.stringify(inside(v).state)).toBe(snap);
        expect(v.moves).toBe(moves);
        const m = inside(v).mark!;
        expect(m.state).toBe(before);
        expect(m.slots.length + m.keys.length + (m.submit ? 1 : 0)).toBeGreaterThan(0);
        // What it says is so: a symbol said to be out is in no code that fits, and so on.
        const codes = candidates(before);
        if (/rule this symbol out/.test(h.text)) for (const c of codes) expect(c.includes(m.keys[0])).toBe(false);
        if (/is in the code/.test(h.text)) for (const c of codes) expect(c.includes(m.keys[0])).toBe(true);
        if (/put this symbol in this slot/.test(h.text)) for (const c of codes) expect(c[m.slots[0]]).toBe(m.keys[0]);
        if (/can't go in this slot/.test(h.text)) for (const c of codes) expect(c[m.slots[0]]).not.toBe(m.keys[0]);
        v.help(2);
        // A guess clears the mark.
        expect(inside(v).mark?.state).not.toBe(inside(v).state);
      }
    }
  });

  it('Show me guesses a code that fits every clue, one guess per call, and cracks every code', () => {
    let most = 0;
    for (const { z, seed } of DEALS) {
      const s = newCodebreaker(z, seed);
      const v = new CodebreakerView(s, true);
      let calls = 0;
      while (!v.won) {
        const a = inside(v).state;
        const h = v.help(2)!;
        plain(h.text);
        expect(h.moved).toBe(true);
        const b = inside(v).state;
        const g = b.rows[b.rows.length - 1].guess;
        // Exactly what typing g and tapping Guess does: one more move, one more row.
        let typed = a;
        g.forEach((k, slot) => (typed = setSlot(typed, slot, k)));
        expect(JSON.stringify(b)).toBe(JSON.stringify(submit(typed)));
        expect(v.moves).toBe(a.moves + 1);
        expect(consistent(a, g)).toBe(true);
        if (a.distinct) expect(new Set(g).size).toBe(SLOTS);
        calls++;
      }
      expect(v.won).toBe(true);
      most = Math.max(most, calls);
      expect(v.help(1)).toBeNull();
      expect(v.help(2)).toBeNull();
    }
    // Within par and then some; never near the ten rows.
    expect(most).toBeLessThanOrEqual(7);
  });

  it('keeps what the player typed when it fits', () => {
    const s = newCodebreaker(110, 7);
    const v = new CodebreakerView(s, true);
    guess(v, [0, 1, 2, 3]);
    const codes = candidates(inside(v).state);
    const c = codes[codes.length - 1];
    inside(v).cursor = 0;
    inside(v).put(c[0]);
    inside(v).put(c[1]);
    v.help(2);
    const row = inside(v).state.rows[1].guess;
    expect(row.slice(0, 2)).toEqual(c.slice(0, 2));
    expect(bestGuess({ ...inside(v).state, draft: [c[0], c[1], EMPTY, EMPTY] })).not.toBeNull();
  });

  it('points at a symbol the clues rule out, and Show me swaps it without spending a guess', () => {
    for (const { z, seed } of DEALS) {
      const s = newCodebreaker(z, seed);
      const v = new CodebreakerView(s, true);
      guess(v, [0, 1, 2, 3]);
      guess(v, [2, 3, 4, 5]);
      if (v.won) continue;
      const after = inside(v).state;
      const { can } = decided(candidates(after));
      let slot = -1, sym = -1;
      for (let k = 0; k < SLOTS && slot < 0; k++) for (let x = 0; x < SYMBOLS; x++) if (!can[k][x]) { slot = k; sym = x; break; }
      if (slot < 0) continue;
      inside(v).cursor = slot;
      inside(v).put(sym);
      const wrong = inside(v).state;
      const h = v.help(1)!;
      expect(h.text).toMatch(/^This symbol can't (be in the code|go in this slot)\.$/);
      expect(inside(v).mark!.slots).toEqual([slot]);
      expect(inside(v).mark!.keys).toEqual([sym]);
      expect(inside(v).state).toBe(wrong);
      const fix = v.help(2)!;
      expect(fix).toEqual({ text: 'Swapped out a symbol the clues rule out.', moved: true });
      const now = inside(v).state;
      expect(now.rows).toHaveLength(2);
      expect(v.moves).toBe(wrong.moves);
      expect(can[slot][now.draft[slot]]).toBe(true);
      // A draft edit, so undo takes it back like the player's own.
      expect(v.undo()).toBe(true);
      expect(inside(v).state).toBe(wrong);
    }
  });

  it('points at a symbol typed twice in a code with no repeats', () => {
    const v = new CodebreakerView(newCodebreaker(105, 3), true);
    guess(v, [0, 1, 2, 3]);
    inside(v).cursor = 0;
    const a = candidates(inside(v).state)[0][0];
    inside(v).put(a);
    inside(v).cursor = 1;
    inside(v).put(a);
    expect(v.help(1)!.text).toBe('No symbol appears twice in this code.');
    expect(inside(v).mark!.slots).toEqual([1]);
    v.help(2);
    expect(inside(v).state.draft[0]).toBe(a);
    expect(inside(v).state.draft[1]).not.toBe(a);
  });

  it('says to restart when the guesses run out', () => {
    const s = newCodebreaker(104, 3);
    const v = new CodebreakerView(s, true);
    const wrong = s.secret.map((k) => (k + 1) % SYMBOLS);
    for (let i = 0; i < MAX_ROWS; i++) guess(v, wrong);
    expect(v.stuck).toBe(true);
    expect(v.help(1)!.text).toBe('Restart to try this code again.');
    expect(v.help(2)!.moved).toBeUndefined();
    expect(v.moves).toBe(MAX_ROWS);
  });

  it('answers in well under 200 ms on every element', () => {
    let worst = 0;
    const time = (f: () => void) => { const t = performance.now(); f(); worst = Math.max(worst, performance.now() - t); };
    for (let z = 104; z <= 117; z++) {
      for (let seed = 1; seed <= 4; seed++) {
        const v = new CodebreakerView(newCodebreaker(z, seed), true);
        while (!v.won) { time(() => v.help(1)); time(() => v.help(2)); }
      }
    }
    expect(worst).toBeLessThan(50);
  });
});
