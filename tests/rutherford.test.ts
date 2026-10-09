import { describe, expect, it } from 'vitest';
import { canSubmit, connectedSets, fire, lookalikes, markedCount, newRutherford, nucleusSize, SIZE, SLOTS, slotEntry, slotOf, slotUsed, solved, submit, toggle, trace, type Cell } from '../src/puzzles/rutherford';

const SPREAD = [1, 6, 26, 50, 79, 92, 118];

const connected = (cells: Cell[]): boolean => {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    cells.forEach((c, j) => {
      if (!seen.has(j) && Math.abs(c.r - cells[i].r) + Math.abs(c.c - cells[i].c) === 1) { seen.add(j); queue.push(j); }
    });
  }
  return seen.size === cells.length;
};

describe('slots', () => {
  it('walks the 24 slots clockwise from the top left and finds its way back', () => {
    for (let slot = 0; slot < SLOTS; slot++) {
      const { pos, dir } = slotEntry(slot);
      expect(slotOf(pos)).toBe(slot);
      expect(Math.abs(dir.r) + Math.abs(dir.c)).toBe(1);
      const first = { r: pos.r + dir.r, c: pos.c + dir.c };
      expect(first.r).toBeGreaterThanOrEqual(0);
      expect(first.c).toBeGreaterThanOrEqual(0);
      expect(first.r).toBeLessThan(SIZE);
      expect(first.c).toBeLessThan(SIZE);
    }
  });
});

describe('probe rules', () => {
  const nucleus: Cell[] = [{ r: 2, c: 2 }, { r: 2, c: 3 }];

  it('passes straight through an empty lane', () => {
    const t = trace(nucleus, 0); // down column 0
    expect(t.outcome).toEqual({ kind: 'pass', exit: 2 * SIZE + 0 });
    expect(t.track).toHaveLength(SIZE);
  });

  it('hits a cell straight ahead', () => {
    expect(trace(nucleus, 2).outcome).toEqual({ kind: 'hit' });
    expect(trace(nucleus, 3 * SIZE + 2).outcome).toEqual({ kind: 'hit' });
  });

  it('turns 90° away from a cell on the diagonal', () => {
    // Down column 1: the nucleus cell at (2,2) is on its diagonal when it is at (1,1), so it turns left (west).
    const t = trace(nucleus, 1);
    expect(t.outcome).toEqual({ kind: 'pass', exit: 3 * SIZE + 1 });
    // Down column 4: turns east at row 1.
    expect(trace(nucleus, 4).outcome).toEqual({ kind: 'pass', exit: SIZE + 1 });
  });

  it('turns right round between two diagonal cells', () => {
    const wide: Cell[] = [{ r: 3, c: 1 }, { r: 3, c: 3 }];
    expect(trace(wide, 2).outcome).toEqual({ kind: 'reflect' });
  });

  it('turns back at the edge when a cell sits beside the entry lane', () => {
    const edge: Cell[] = [{ r: 0, c: 3 }];
    expect(trace(edge, 2).outcome).toEqual({ kind: 'reflect' });
    expect(trace(edge, 4).outcome).toEqual({ kind: 'reflect' });
    expect(trace(edge, 3).outcome).toEqual({ kind: 'hit' });
  });

  it('is symmetric: firing back from the exit returns to the entry', () => {
    for (const z of SPREAD) {
      const s = newRutherford(z, 99);
      for (let slot = 0; slot < SLOTS; slot++) {
        const o = trace(s.nucleus, slot).outcome;
        if (o.kind === 'pass') expect(trace(s.nucleus, o.exit).outcome).toEqual({ kind: 'pass', exit: slot });
      }
    }
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    for (const z of SPREAD) expect(newRutherford(z, 5 * z)).toEqual(newRutherford(z, 5 * z));
  });

  it('grows with the element and hides a connected nucleus the probes can pin down', () => {
    expect(nucleusSize(1)).toBe(2);
    expect(nucleusSize(79)).toBe(4);
    expect(nucleusSize(118)).toBe(5);
    for (const z of SPREAD) {
      for (let deal = 0; deal < 3; deal++) {
        const s = newRutherford(z, 100 * z + deal);
        expect(s.nucleus).toHaveLength(nucleusSize(z));
        expect(connected(s.nucleus)).toBe(true);
        expect(new Set(s.nucleus.map((c) => c.r * SIZE + c.c)).size).toBe(s.nucleus.length);
        expect(lookalikes(s.nucleus)).toBe(1);
        expect(s.par).toBe(s.nucleus.length + 3);
        expect(s.moves).toBe(0);
        expect(solved(s)).toBe(false);
      }
    }
  });

  it('enumerates connected sets without duplicates', () => {
    const sets = connectedSets(2);
    expect(sets).toHaveLength(2 * SIZE * (SIZE - 1)); // dominoes in a 6×6 box
    expect(connectedSets(3).every(connected)).toBe(true);
  });
});

describe('play', () => {
  it('fires once per slot, counts moves, and never mutates the old state', () => {
    const s = newRutherford(26, 1);
    const before = JSON.stringify(s);
    const a = fire(s, 0)!;
    expect(a).not.toBeNull();
    expect(a.moves).toBe(1);
    expect(a.probes).toHaveLength(1);
    expect(slotUsed(a, 0)).toBe(true);
    expect(fire(a, 0)).toBeNull();
    const o = a.probes[0].outcome;
    if (o.kind === 'pass') {
      expect(slotUsed(a, o.exit)).toBe(true);
      expect(fire(a, o.exit)).toBeNull();
      expect(a.probes[0].label).toBe(1);
    } else {
      expect(a.probes[0].label).toBe(0);
    }
    expect(JSON.stringify(s)).toBe(before);
  });

  it('wins on the right marks, counts a wrong guess, and lets play go on', () => {
    const s = newRutherford(50, 2);
    expect(canSubmit(s)).toBe(false);
    expect(submit(s)).toBeNull();
    // Mark the wrong cells: shift the whole nucleus is not always possible, so mark the first n empty cells.
    let wrong = s;
    for (let i = 0; markedCount(wrong) < s.nucleus.length; i++) {
      if (!s.nucleus.some((n) => n.r * SIZE + n.c === i)) wrong = toggle(wrong, { r: Math.floor(i / SIZE), c: i % SIZE })!;
    }
    expect(canSubmit(wrong)).toBe(true);
    const after = submit(wrong)!;
    expect(after.won).toBe(false);
    expect(after.wrong).toBe(1);
    expect(after.moves).toBe(1);
    expect(fire(after, 0)).not.toBeNull();
    // Now mark the right ones.
    let right = s;
    for (const n of s.nucleus) right = toggle(right, n)!;
    const win = submit(right)!;
    expect(win.won).toBe(true);
    expect(solved(win)).toBe(true);
    expect(win.wrong).toBe(0);
    expect(toggle(win, { r: 0, c: 0 })).toBeNull();
    expect(fire(win, 0)).toBeNull();
  });
});
