import { describe, expect, it } from 'vitest';
import { clean, MARGIN, moveAtom, moved, newPlanar, nextMove, planarShape, problemsOf, segmentsCross, solved, worstAtom, type PlanarState } from '../src/puzzles/planar';
import { INSTRUCTIONS, PlanarView, RULES } from '../src/puzzles/planarView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DIALS = [1, 5, 12, 20, 21, 33, 40, 41, 55, 60, 61, 72, 80, 81, 90, 100];

describe('deals', () => {
  it('grows the board smoothly with the dial', () => {
    expect(planarShape(1).atoms).toBe(6);
    expect(planarShape(100).atoms).toBe(22);
    let last = 0;
    const sizes = new Set<number>();
    for (let d = 1; d <= 100; d++) {
      const a = planarShape(d).atoms;
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
      sizes.add(a);
    }
    expect(sizes.size).toBe(17);
    expect(planarShape(100).perAtom).toBeGreaterThan(planarShape(1).perAtom);
  });

  it('deals the same board for the same dial and seed', () => {
    expect(newPlanar(50, 9)).toEqual(newPlanar(50, 9));
    expect(newPlanar(50, 9)).not.toEqual(newPlanar(50, 10));
  });

  it('deals a tangle with a clean hidden layout, and par counts the atoms it moves', () => {
    for (const d of DIALS) for (let seed = 1; seed <= 6; seed++) {
      const s = newPlanar(d, seed);
      expect(s.pos.length).toBe(planarShape(d).atoms);
      expect(clean(s.solution, s.edges)).toBe(true);
      expect(solved(s)).toBe(false);
      const dealt = problemsOf(s.pos, s.edges);
      expect(dealt.crossings.length).toBeGreaterThanOrEqual(2);
      // Dealt tangled, but no bond grazes an atom and no atoms overlap.
      expect(dealt.through).toEqual([]);
      expect(dealt.overlaps).toEqual([]);
      expect(s.par).toBe(moved(s.solution, s.pos).length);
      expect(s.par).toBeGreaterThan(0);
      expect(s.par).toBeLessThanOrEqual(s.pos.length);
      for (const p of [...s.pos, ...s.solution]) {
        expect(p.x).toBeGreaterThanOrEqual(MARGIN);
        expect(p.x).toBeLessThanOrEqual(1 - MARGIN);
        expect(p.y).toBeGreaterThanOrEqual(MARGIN);
        expect(p.y).toBeLessThanOrEqual(1 - MARGIN);
      }
      // Connected, no repeated bond, every atom with two bonds or more.
      const deg = Array(s.pos.length).fill(0);
      const seen = new Set<string>();
      for (const [a, b] of s.edges) { deg[a]++; deg[b]++; seen.add(`${Math.min(a, b)}-${Math.max(a, b)}`); }
      expect(seen.size).toBe(s.edges.length);
      expect(Math.min(...deg)).toBeGreaterThanOrEqual(2);
    }
  }, 30000);

  it('deals quickly, even the biggest boards', () => {
    // The median of ten, so one stall on a busy machine does not fail it.
    const times: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const t0 = performance.now();
      newPlanar(100, seed);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[5]).toBeLessThan(300);
  }, 30000);
});

describe('play', () => {
  it('finds crossings, bonds through atoms and atoms on atoms', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 })).toBe(true);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(false);
    const pos = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.51, y: 0.51 }];
    const p = problemsOf(pos, [[0, 1], [2, 3]]);
    expect(p.crossings).toEqual([[0, 1]]);
    expect(p.through.map(([, k]) => k).sort()).toEqual([4, 4, 5, 5]);
    expect(p.overlaps).toEqual([[4, 5]]);
  });

  it('moves an atom as one drag, kept inside the board', () => {
    const s = newPlanar(30, 1);
    const t = moveAtom(s, 0, { x: -3, y: 2 })!;
    expect(t.moves).toBe(1);
    expect(t.pos[0]).toEqual({ x: MARGIN, y: 1 - MARGIN });
    expect(moveAtom(t, 0, { x: -3, y: 2 })).toBeNull();
    expect(s.pos[0]).not.toEqual(t.pos[0]);
  });

  it('untangles itself one atom at a time, within par', () => {
    for (const d of [1, 30, 60, 100]) for (const seed of [1, 2, 3]) {
      let s: PlanarState = newPlanar(d, seed);
      let left = Infinity;
      for (let k = 0; k < 40 && !solved(s); k++) {
        const m = nextMove(s)!;
        expect(m.left).toBeLessThan(left);
        left = m.left;
        expect(worstAtom(s)).toBeGreaterThanOrEqual(0);
        s = moveAtom(s, m.atom, m.to)!;
      }
      expect(solved(s)).toBe(true);
      expect(s.moves).toBeLessThanOrEqual(s.par);
      expect(nextMove(s)).toBeNull();
    }
  }, 30000);
});

describe('view', () => {
  it('draws inside its area and reports crossings', () => {
    for (const d of [1, 50, 100]) {
      const v = new PlanarView(newPlanar(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Crossings');
      expect(v.hint()).toMatch(/crossings? left/);
    }
  });

  it('drags an atom, counts the drag, and undoes it', () => {
    const s = newPlanar(20, 4);
    const v = new PlanarView(s, true);
    const area = { x: 0, y: 0, w: 400, h: 400 };
    v.draw(recCtx().ctx, area, 0);
    // The board square: find atom 0 on screen by drawing geometry (centered square).
    const room = (400 - (v as unknown as { geo: { s: number } }).geo.s) / 2;
    const side = (v as unknown as { geo: { s: number } }).geo.s;
    const at = (p: { x: number; y: number }) => ({ x: room + p.x * side, y: room + p.y * side });
    const a = at(s.pos[0]);
    v.down(a);
    v.move({ x: a.x + 30, y: a.y + 10 });
    v.up({ x: a.x + 40, y: a.y + 10 });
    expect(v.moves).toBe(1);
    expect(v.canUndo()).toBe(true);
    // A tap without moving is not a drag.
    v.down(a);
    v.up(a);
    expect(v.moves).toBe(1);
    expect(v.undo()).toBe(true);
    expect(v.moves).toBe(0);
    // Cancel puts the atom back.
    v.down(a);
    v.move({ x: a.x + 50, y: a.y });
    v.cancel();
    expect(v.moves).toBe(0);
    expect(v.canUndo()).toBe(false);
  });

  it('points at the worst atom, and Show me plays through to a win within par', () => {
    for (const d of [1, 40, 100]) {
      const v = new PlanarView(newPlanar(d, 3), true);
      for (let k = 0; k < 40 && !v.won; k++) {
        const look = v.help(1);
        expect(look).not.toBeNull();
        expect(look!.moved).toBeUndefined();
        const show = v.help(2)!;
        expect(show.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.clean).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.help(2)).toBeNull();
      expect(v.hint()).toMatch(/Untangled/);
      v.restart();
      expect(v.moves).toBe(0);
      expect(v.won).toBe(false);
    }
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['No crossing', 'Not through atoms']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });
});
