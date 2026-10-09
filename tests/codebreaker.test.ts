import { describe, expect, it } from 'vitest';
import { consistent, cycleSlot, EMPTY, MAX_ROWS, newCodebreaker, score, setSlot, SLOTS, solved, stuck, submit, SYMBOLS } from '../src/puzzles/codebreaker';

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
