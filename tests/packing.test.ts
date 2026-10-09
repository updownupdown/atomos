import { describe, expect, it } from 'vitest';
import { applyMove, bounds, canPlace, cellsOf, newPacking, normalise, occupancy, rotated, sizeFor, solved, solvedState } from '../src/puzzles/packing';

const SPREAD = [1, 6, 26, 50, 92, 118];

describe('shapes', () => {
  it('normalises and rotates', () => {
    const l = normalise([{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }]);
    expect(l[0]).toEqual({ x: 0, y: 0 });
    expect(bounds(l)).toEqual({ w: 2, h: 3 });
    expect(bounds(rotated(l, 1))).toEqual({ w: 3, h: 2 });
    expect(rotated(l, 0)).toEqual(l);
    expect(rotated(rotated(l, 2), 2)).toEqual(l);
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    expect(newPacking(26, 7)).toEqual(newPacking(26, 7));
    expect(newPacking(26, 7)).not.toEqual(newPacking(26, 8));
  });

  it('carves pieces of two to five cells that exactly fill the outline', () => {
    for (const z of SPREAD) for (let deal = 0; deal < 8; deal++) {
      const s = newPacking(z, z * 100 + deal);
      const n = s.outline.filter(Boolean).length;
      expect(n).toBe(sizeFor(z).n);
      expect(s.pieces.length).toBeGreaterThanOrEqual(2);
      expect(s.par).toBe(s.pieces.length);
      expect(s.moves).toBe(0);
      let total = 0;
      for (const p of s.pieces) {
        expect(p.at).toBeNull();
        expect(p.shape.length).toBeGreaterThanOrEqual(2);
        expect(p.shape.length).toBeLessThanOrEqual(5);
        total += p.shape.length;
      }
      expect(total).toBe(n);
      expect(solved(s)).toBe(false);
    }
  });

  it('is solved by its own carved answer, placed one piece at a time', () => {
    for (const z of SPREAD) {
      const s0 = newPacking(z, 999 + z);
      let s = s0;
      for (const p of s0.pieces) {
        for (let k = 0; k < (4 - p.rot) % 4; k++) s = applyMove(s, { kind: 'rotate', piece: p.id })!;
        expect(canPlace(s, p.id, s0.solution[p.id])).toBe(true);
        s = applyMove(s, { kind: 'place', piece: p.id, at: s0.solution[p.id] })!;
      }
      expect(solved(s)).toBe(true);
      expect(s.moves).toBe(s0.par);
      expect(solved(solvedState(s0))).toBe(true);
    }
  });

  it('scales the outline gently with z', () => {
    expect(sizeFor(1).n).toBeLessThan(sizeFor(60).n);
    expect(sizeFor(60).n).toBeLessThan(sizeFor(118).n);
    expect(sizeFor(118).w * sizeFor(118).h).toBeLessThanOrEqual(36);
  });
});

describe('moves', () => {
  it('refuses placements outside the outline or over another piece', () => {
    const s0 = newPacking(6, 42);
    const full = solvedState(s0);
    const p = full.pieces[0];
    expect(applyMove(full, { kind: 'place', piece: p.id, at: { x: -1, y: 0 } })).toBeNull();
    expect(applyMove(full, { kind: 'place', piece: p.id, at: { x: s0.w, y: s0.h } })).toBeNull();
    const other = full.pieces[1];
    expect(applyMove(full, { kind: 'place', piece: p.id, at: other.at! })).toBeNull();
    // Re-placing a piece where it already sits changes nothing.
    expect(applyMove(full, { kind: 'place', piece: p.id, at: p.at! })).toBeNull();
  });

  it('lifts, rotates and never mutates the previous state', () => {
    const s0 = newPacking(26, 3);
    const p = s0.pieces[0];
    const before = JSON.stringify(s0);
    const r = applyMove(s0, { kind: 'rotate', piece: p.id })!;
    expect(r.pieces[0].rot).toBe((p.rot + 1) % 4);
    expect(r.moves).toBe(0);
    expect(cellsOf(r.pieces[0])).toEqual(rotated(p.shape, r.pieces[0].rot));
    expect(applyMove(s0, { kind: 'lift', piece: p.id })).toBeNull();
    const full = solvedState(s0);
    const lifted = applyMove(full, { kind: 'lift', piece: p.id })!;
    expect(lifted.pieces[0].at).toBeNull();
    expect(solved(lifted)).toBe(false);
    expect(occupancy(lifted).filter((id) => id === p.id)).toHaveLength(0);
    expect(JSON.stringify(s0)).toBe(before);
  });

  it('drops a turned piece back to the tray when it no longer fits', () => {
    const s0 = newPacking(50, 11);
    const full = solvedState(s0);
    for (const p of full.pieces) {
      const r = applyMove(full, { kind: 'rotate', piece: p.id })!;
      const q = r.pieces.find((x) => x.id === p.id)!;
      if (q.at) expect(canPlace(r, q.id, q.at)).toBe(true);
      const occ = occupancy(r);
      expect(occ.every((id, i) => id === -1 || s0.outline[i])).toBe(true);
    }
  });
});
