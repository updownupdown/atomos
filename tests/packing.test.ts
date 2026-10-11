import { describe, expect, it } from 'vitest';
import { applyMove, bounds, canonical, canPlace, cellsLeft, cellsOf, completion, fallbackPacking, measure, mirrored, newPacking, normalize, occupancy, oriented, rotated, sizeFor, solved, solvedState, type PackingMove, type PackingState, type Rot } from '../src/puzzles/packing';
import { INSTRUCTIONS, PackingView, RULES, stonesFor } from '../src/puzzles/packingView';
import { C } from '../src/puzzles/palette';
import { undoHelp, type Area, type RuleCard } from '../src/puzzles/view';

const SPREAD = [1, 6, 12, 26, 30, 40, 50, 80, 92, 100, 118];

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
      if (k === 'fillText') return (_s: string, x: number, y: number) => rec(x, y);
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, pts };
}

const AREAS: Area[] = [
  { x: 0, y: 0, w: 340, h: 430 },
  { x: 12, y: 8, w: 360, h: 600 },
  { x: 0, y: 0, w: 1200, h: 700 },
  { x: 100, y: 8, w: 560, h: 520 },
];

describe('shapes', () => {
  it('normalizes, rotates and mirrors', () => {
    const l = normalize([{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }]);
    expect(l[0]).toEqual({ x: 0, y: 0 });
    expect(bounds(l)).toEqual({ w: 2, h: 3 });
    expect(bounds(rotated(l, 1))).toEqual({ w: 3, h: 2 });
    expect(rotated(l, 0)).toEqual(l);
    expect(rotated(rotated(l, 2), 2)).toEqual(l);
    expect(mirrored(mirrored(l))).toEqual(l);
    expect(mirrored(l)).not.toEqual(l);
    expect(canonical(mirrored(l))).toBe(canonical(rotated(l, 3)));
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    for (const z of [1, 26, 60, 90, 118]) {
      expect(newPacking(z, 7)).toEqual(newPacking(z, 7));
      expect(newPacking(z, 7)).not.toEqual(newPacking(z, 8));
    }
  });

  /** The cut-out cells of a level, as indices. */
  const holesOf = (s: PackingState) => s.outline.flatMap((on, i) => (on ? [] : [i]));

  it('has exactly one answer, on every element, flips included', () => {
    let deals = 0;
    for (let z = 1; z <= 118; z += 3) for (const seed of [z, z + 500, z + 1000]) {
      const s = newPacking(z, seed);
      // The dancing links solver, not the one the level was made with, counts every distinct set
      // of placements, turned or mirrored copies of the whole answer included.
      const m = measure(s, 2, 1e7);
      expect(m.complete, `z${z} seed ${seed}`).toBe(true);
      expect(m.answers, `z${z} seed ${seed}`).toBe(1);
      deals++;
    }
    expect(deals).toBe(120);
    const f = fallbackPacking();
    expect(measure(f, 2, 1e7)).toMatchObject({ answers: 1, complete: true });
    expect(solved(solvedState(f))).toBe(true);
  });

  it('is a square with one to three single holes, filled exactly by every piece in the tray', () => {
    for (const z of SPREAD) for (let deal = 0; deal < 6; deal++) {
      const s = newPacking(z, z * 100 + deal);
      const plan = sizeFor(z);
      expect(s.w).toBe(s.h);
      expect(s.w).toBeLessThanOrEqual(plan.side);
      expect(s.outline).toHaveLength(s.w * s.h);
      const holes = holesOf(s);
      expect(holes.length).toBeGreaterThanOrEqual(1);
      expect(holes.length).toBeLessThanOrEqual(3);
      // Single cells: no two holes side by side.
      for (const a of holes) for (const b of holes) {
        if (a < b) expect(Math.abs((a % s.w) - (b % s.w)) + Math.abs(Math.floor(a / s.w) - Math.floor(b / s.w))).toBeGreaterThan(1);
      }
      // The open cells are one region.
      const open = s.outline.flatMap((on, i) => (on ? [i] : []));
      const seen = new Set([open[0]]);
      const stack = [open[0]];
      while (stack.length) {
        const c = stack.pop()!;
        for (const d of [c % s.w > 0 ? c - 1 : -1, c % s.w < s.w - 1 ? c + 1 : -1, c - s.w, c + s.w]) {
          if (d >= 0 && d < s.outline.length && s.outline[d] && !seen.has(d)) { seen.add(d); stack.push(d); }
        }
      }
      expect(seen.size).toBe(open.length);
      // Nothing filled in advance, nothing spare.
      expect(Object.keys(s).sort()).toEqual(['flips', 'h', 'moves', 'outline', 'par', 'pieces', 'solution', 'w']);
      expect(s.flips).toBe(plan.flips);
      expect(s.par).toBe(s.pieces.length);
      expect(s.moves).toBe(0);
      expect(s.pieces.reduce((a, p) => a + p.shape.length, 0)).toBe(open.length);
      expect(cellsLeft(s)).toBe(open.length);
      expect(solved(s)).toBe(false);
      for (const p of s.pieces) {
        expect(p.at).toBeNull();
        expect(s.solution[p.id]).toBeTruthy();
        if (!s.flips) expect(p.flip).toBe(false);
      }
    }
  });

  it('deals every piece a different shape, three to six cells, few easy fits', () => {
    for (const z of SPREAD) for (let deal = 0; deal < 6; deal++) {
      const s = newPacking(z, z * 31 + deal);
      const sizes = s.pieces.map((p) => p.shape.length);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(z >= 60 ? 6 : 5);
      expect(sizes.filter((n) => n === 3).length).toBeLessThanOrEqual(1);
      expect(new Set(s.pieces.map((p) => canonical(p.shape))).size).toBe(s.pieces.length);
      // Straight bars and the 2 by 2 square fit almost anywhere: at most one on the larger boards.
      const easy = s.pieces.filter((p) => { const b = bounds(p.shape); return b.w === 1 || b.h === 1 || (p.shape.length === 4 && b.w === 2 && b.h === 2); });
      expect(easy.length).toBeLessThanOrEqual(s.w >= 6 ? 1 : 2);
      // The carved answer covers every open cell, each once, and no hole.
      const cover = occupancy(solvedState(s));
      expect(cover.every((id, i) => (id >= 0) === s.outline[i])).toBe(true);
    }
  });

  it('is solved by its own carved answer, placed one piece at a time', () => {
    for (const z of SPREAD) {
      const s0 = newPacking(z, 999 + z);
      let s: PackingState = s0;
      for (const p of s0.pieces) {
        const home = s0.solution[p.id];
        if (p.flip) s = applyMove(s, { kind: 'flip', piece: p.id })!;
        while (s.pieces[p.id].rot !== 0) s = applyMove(s, { kind: 'rotate', piece: p.id })!;
        expect(s.pieces[p.id].flip).toBe(false);
        expect(canPlace(s, p.id, home)).toBe(true);
        s = applyMove(s, { kind: 'place', piece: p.id, at: home })!;
      }
      expect(solved(s)).toBe(true);
      expect(s.moves).toBe(s0.par);
      expect(solved(solvedState(s0))).toBe(true);
    }
  });

  it('is finished by the solver the one way, using every piece', () => {
    for (let z = 1; z <= 118; z += 13) for (const seed of [1, 2]) {
      const s = newPacking(z, seed);
      const way = completion(s)!;
      expect(way).not.toBeNull();
      expect(new Set(way.map((pl) => pl.piece)).size).toBe(s.pieces.length);
      let t = s;
      for (const pl of way) t = applyMove(t, { kind: 'place', ...pl })!;
      expect(solved(t)).toBe(true);
      expect(occupancy(t)).toEqual(occupancy(solvedState(s)));
    }
  });

  it('grows the square and its pieces with z, and the proof of the one answer gets longer', () => {
    const sides: number[] = [];
    for (let z = 1; z <= 118; z++) sides.push(sizeFor(z).side);
    for (let i = 1; i < sides.length; i++) expect(sides[i]).toBeGreaterThanOrEqual(sides[i - 1]);
    expect(sizeFor(1).side).toBe(4);
    expect(sizeFor(118).side).toBe(7);
    expect(sizeFor(89).flips).toBe(false);
    expect(sizeFor(90).flips).toBe(true);
    const avg = (z: number, f: (s: PackingState) => number) => [0, 1, 2, 3, 4, 5].reduce((a, d) => a + f(newPacking(z, d)), 0) / 6;
    const cells = (s: PackingState) => s.pieces.reduce((a, p) => a + p.shape.length, 0) / s.pieces.length;
    expect(avg(1, (s) => s.pieces.length)).toBeLessThan(avg(20, (s) => s.pieces.length));
    expect(avg(20, (s) => s.pieces.length)).toBeLessThan(avg(50, (s) => s.pieces.length));
    expect(avg(50, cells)).toBeLessThan(avg(110, cells));
    // Search steps the second solver takes to prove the answer the only one: up with each board
    // size, and up from the start of a size to its end.
    const proof = (z: number) => avg(z, (s) => measure(s, 2, 1e7).nodes);
    expect(proof(5)).toBeLessThan(proof(20));
    expect(proof(20)).toBeLessThan(proof(50));
    expect(proof(50)).toBeLessThan(proof(100));
    expect(proof(37)).toBeLessThan(proof(76));
    expect(proof(11)).toBeLessThan(proof(36));
  });

  it('deals fast', () => {
    newPacking(60, 1);
    let worst = 0, total = 0, count = 0;
    const time = (z: number) => {
      const t = performance.now();
      newPacking(z, z * 7 + 1);
      return performance.now() - t;
    };
    for (let z = 1; z <= 118; z += 3) {
      let ms = time(z);
      // A deal is deterministic: one over the limit is timed twice more and keeps its best, so a
      // garbage collection or a busy shared runner can't fail it, while a truly slow deal still does.
      if (ms >= 150) ms = Math.min(ms, time(z), time(z));
      worst = Math.max(worst, ms);
      total += ms;
      count++;
    }
    expect(total / count).toBeLessThan(40);
    expect(worst).toBeLessThan(150);
  });
});

describe('moves', () => {
  it('refuses placements off the square, on a hole or over another piece', () => {
    const s0 = newPacking(50, 42);
    const full = solvedState(s0);
    const p = full.pieces.find((q) => q.at)!;
    expect(applyMove(full, { kind: 'place', piece: p.id, at: { x: -1, y: 0 } })).toBeNull();
    expect(applyMove(full, { kind: 'place', piece: p.id, at: { x: s0.w, y: s0.h } })).toBeNull();
    const other = full.pieces.find((q) => q.at && q.id !== p.id)!;
    expect(applyMove(full, { kind: 'place', piece: p.id, at: other.at! })).toBeNull();
    expect(applyMove(full, { kind: 'place', piece: p.id, at: p.at! })).toBeNull();
    // Lifted, it goes back where it was; hanging off the far corner it does not.
    const lifted = applyMove(full, { kind: 'lift', piece: p.id })!;
    expect(canPlace(lifted, p.id, p.at!)).toBe(true);
    expect(canPlace(lifted, p.id, { x: s0.w - 1, y: s0.h - 1 })).toBe(false);
    // On the empty board, no piece goes down over a hole, whatever its turn.
    const hole = s0.outline.indexOf(false);
    for (const q of s0.pieces) for (let r = 0; r < 4; r++) {
      const c = oriented(q.shape, r as Rot, q.flip)[0];
      expect(canPlace(s0, q.id, { x: (hole % s0.w) - c.x, y: Math.floor(hole / s0.w) - c.y }, r as Rot)).toBe(false);
    }
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
    expect(applyMove(s0, { kind: 'flip', piece: p.id })).toBeNull();
    const full = solvedState(s0);
    const placed = full.pieces.find((q) => q.at)!;
    const lifted = applyMove(full, { kind: 'lift', piece: placed.id })!;
    expect(lifted.pieces[placed.id].at).toBeNull();
    expect(solved(lifted)).toBe(false);
    expect(occupancy(lifted).filter((id) => id === placed.id)).toHaveLength(0);
    expect(JSON.stringify(s0)).toBe(before);
  });

  it('flips a piece left to right on screen', () => {
    const s0 = newPacking(100, 5);
    for (const p of s0.pieces) {
      const f = applyMove(s0, { kind: 'flip', piece: p.id })!;
      expect(cellsOf(f.pieces[p.id])).toEqual(mirrored(cellsOf(p)));
    }
  });

  it('drops a turned piece back to the tray when it no longer fits', () => {
    const s0 = newPacking(50, 11);
    const full = solvedState(s0);
    for (const p of full.pieces) {
      const r = applyMove(full, { kind: 'rotate', piece: p.id })!;
      const q = r.pieces.find((x) => x.id === p.id)!;
      if (q.at) expect(canPlace(r, q.id, q.at)).toBe(true);
      // No two pieces on one cell.
      const covered = occupancy(r).filter((id) => id >= 0).length;
      expect(covered).toBe(r.pieces.filter((x) => x.at).reduce((a, x) => a + x.shape.length, 0));
    }
  });
});

describe('stones', () => {
  it('never tints two pieces that touch in the carved answer alike', () => {
    for (const z of SPREAD) for (const seed of [1, 2]) {
      const s = newPacking(z, seed);
      const stones = stonesFor(s);
      expect(stones).toHaveLength(s.pieces.length);
      const occ = occupancy(solvedState(s));
      for (let i = 0; i < occ.length; i++) {
        const x = i % s.w;
        if (occ[i] < 0) continue;
        if (x < s.w - 1 && occ[i + 1] >= 0 && occ[i] !== occ[i + 1]) expect(stones[occ[i]]).not.toBe(stones[occ[i + 1]]);
        if (i + s.w < occ.length && occ[i + s.w] >= 0 && occ[i] !== occ[i + s.w]) expect(stones[occ[i]]).not.toBe(stones[occ[i + s.w]]);
      }
      // Spread over the stones, not all one color.
      expect(new Set(stones).size).toBeGreaterThanOrEqual(Math.min(3, s.pieces.length));
    }
  });
});

describe('view', () => {
  it('draws inside the area, tray included, from a phone to a desktop', () => {
    for (const z of [1, 50, 118]) for (const area of AREAS) {
      const v = new PackingView(newPacking(z, 4), true);
      const { ctx, pts } = mockCtx();
      v.draw(ctx, area, 0);
      expect(pts.length).toBeGreaterThan(10);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(area.x - 0.5);
        expect(x).toBeLessThanOrEqual(area.x + area.w + 0.5);
        expect(y).toBeGreaterThanOrEqual(area.y - 0.5);
        expect(y).toBeLessThanOrEqual(area.y + area.h + 0.5);
      }
      expect(v.hint().length).toBeLessThanOrEqual(40);
    }
  });

  it('solves a level by touch alone: taps to turn, the flip button, drags to place', () => {
    for (const area of [AREAS[0], AREAS[2]]) {
      const level = newPacking(118, 9);
      const v = new PackingView(level, true);
      const { ctx } = mockCtx();
      const draw = () => v.draw(ctx, area, 0);
      draw();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lay = (v as any).lay;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const st = () => (v as any).state as PackingState;
      for (const p of level.pieces) {
        const home = level.solution[p.id];
        const slot = lay.slots.find((sl: { id: number }) => sl.id === p.id);
        const centerOf = () => {
          const q = st().pieces[p.id];
          const b = bounds(cellsOf(q));
          const c = cellsOf(q)[0];
          return { x: slot.x + (slot.side - b.w * lay.tc) / 2 + (c.x + 0.5) * lay.tc, y: slot.y + (slot.side - b.h * lay.tc) / 2 + (c.y + 0.5) * lay.tc, c };
        };
        if (st().pieces[p.id].flip) {
          const t = centerOf();
          v.down(t); v.up(t); // select (turns it too)
          const f = lay.flip;
          v.down({ x: f.x + 5, y: f.y + 5 }); v.up({ x: f.x + 5, y: f.y + 5 });
        }
        while (st().pieces[p.id].rot !== 0) { const t = centerOf(); v.down(t); v.up(t); }
        expect(st().pieces[p.id].flip).toBe(false);
        const from = centerOf();
        const to = { x: lay.board.x + (home.x + from.c.x + 0.5) * lay.board.cell, y: lay.board.y + (home.y + from.c.y + 0.5) * lay.board.cell };
        v.down(from);
        v.move({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
        v.move(to);
        draw();
        v.up(to);
        expect(st().pieces[p.id].at).toEqual(home);
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBe(level.par);
    }
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

describe('hints', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st = (v: PackingView) => (v as any).state as PackingState;
  /** A move played the way a drag, tap or key plays it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const play = (v: PackingView, m: PackingMove) => (v as any).apply(m) as boolean;
  const plain = (text: string) => {
    expect(text).toMatch(/^[A-Z][^—<>]*\.$/);
    expect(text.length).toBeLessThanOrEqual(60);
  };
  /** Every placement of every tray piece, in every orientation and corner. */
  const placements = (s: PackingState): PackingMove[] => {
    const out: PackingMove[] = [];
    for (const p of s.pieces) if (!p.at) for (const flip of s.flips ? [false, true] : [false]) for (let r = 0; r < 4; r++)
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        const m: PackingMove = { kind: 'place', piece: p.id, at: { x, y }, rot: r as Rot, flip };
        if (applyMove(s, m)) out.push(m);
      }
    return out;
  };

  it('places a piece turned (and flipped where offered) as one move', () => {
    const s = newPacking(118, 3);
    const p = s.pieces[0];
    const home = s.solution[p.id];
    const next = applyMove(s, { kind: 'place', piece: p.id, at: home, rot: 0, flip: false })!;
    expect(next.moves).toBe(1);
    expect(next.pieces[p.id]).toMatchObject({ at: home, rot: 0, flip: false });
    const plainLevel = newPacking(30, 3);
    const q = plainLevel.pieces[0];
    expect(applyMove(plainLevel, { kind: 'place', piece: q.id, at: { x: 0, y: 0 }, flip: true })).toBeNull();
  });

  it('Look here outlines where one piece goes and changes nothing', () => {
    for (const z of SPREAD) for (const seed of [1, 2]) {
      const v = new PackingView(newPacking(z, seed), true);
      const before = st(v);
      const snap = JSON.stringify(before);
      const h = v.help(1)!;
      plain(h.text);
      expect(h.text).toMatch(/^This piece fits here( once turned| once flipped over)?\.$/);
      expect(h.moved).toBeUndefined();
      expect(st(v)).toBe(before);
      expect(JSON.stringify(st(v))).toBe(snap);
      expect(v.moves).toBe(0);
      // The marked place is part of a way to finish.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (v as any).mark;
      expect(m.state).toBe(before);
      const after = applyMove(before, { kind: 'place', ...m.place })!;
      expect(completion(after)).not.toBeNull();
      for (const area of [AREAS[0], AREAS[2]]) {
        const { ctx, pts } = mockCtx();
        v.draw(ctx, area, 0);
        for (const [x, y] of pts) expect(x >= area.x - 0.5 && x <= area.x + area.w + 0.5 && y >= area.y - 0.5 && y <= area.y + area.h + 0.5).toBe(true);
      }
    }
  });

  it('Show me fills the square, one counted, undoable placement per call', () => {
    for (const z of SPREAD) for (const seed of [1, 2, 3]) {
      const level = newPacking(z, seed);
      const v = new PackingView(level, true);
      let calls = 0;
      while (!v.won && calls < level.par * 3 + 10) {
        const before = v.moves;
        const h = v.help(2)!;
        expect(h).toEqual({ text: 'Placed a piece where it fits.', moved: true });
        expect(v.moves).toBe(before + 1);
        calls++;
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBe(st(v).pieces.filter((p) => p.at).length);
      expect(v.help(1)).toBeNull();
      expect(v.help(2)).toBeNull();
      expect(v.undo()).toBe(true);
      expect(v.moves).toBe(calls - 1);
      expect(v.won).toBe(false);
    }
  });

  it('counts the undos back to a board that can still be filled', () => {
    let found = 0;
    for (const z of SPREAD) for (const seed of [1, 2]) {
      const level = newPacking(z, seed);
      const v = new PackingView(level, true);
      // One good piece first, so there is a board worth going back to.
      v.help(2);
      const bad = placements(st(v)).find((m) => !completion(applyMove(st(v), m)!));
      if (!bad) continue;
      found++;
      expect(play(v, bad)).toBe(true);
      const moves = v.moves;
      expect(v.help(1)).toEqual(undoHelp(1));
      expect(v.help(2)).toEqual(undoHelp(1));
      expect(v.moves).toBe(moves);
      // Turning a tray piece is one more step to undo.
      const tray = st(v).pieces.find((p) => !p.at);
      if (tray && play(v, { kind: 'rotate', piece: tray.id })) {
        expect(v.help(1)).toEqual(undoHelp(2));
        v.undo();
      }
      v.undo();
      expect(v.help(1)!.text).toMatch(/^This piece fits here/);
      expect(v.help(2)!.moved).toBe(true);
    }
    expect(found).toBeGreaterThanOrEqual(10);
  });

  it('answers well within 200 ms, dead ends included', () => {
    let worst = 0;
    const time = (v: PackingView, level: 1 | 2) => {
      const t0 = performance.now();
      v.help(level);
      worst = Math.max(worst, performance.now() - t0);
    };
    for (let z = 1; z <= 118; z += 9) for (const seed of [1, 2]) {
      const v = new PackingView(newPacking(z, seed), true);
      time(v, 1);
      time(v, 2);
      // A few placements that leave the board unfillable, then the walk back.
      for (let k = 0; k < 4; k++) {
        const ms = placements(st(v));
        if (!ms.length) break;
        play(v, ms[(k * 7919 + z) % ms.length]);
        time(v, 1);
      }
    }
    expect(worst).toBeLessThan(200);
  });
});

describe('rule cards', () => {
  it('have a title, plain text and pictures that stay in their box', () => {
    expect(RULES.map((r) => r.title)).toEqual(['Fill the square', 'Landing shadow', 'Turn', 'Move or lift', 'Gaps stay empty', 'Flip', 'Keyboard']);
    checkPictures(RULES);
    for (const r of RULES) expect(Boolean(r.good), r.title).toBe(r.title !== 'Keyboard');
  });

  it('shows the move that fails beside the one that works, flagged in amber, never red', () => {
    expect(RULES.filter((r) => r.bad).map((r) => r.title)).toEqual(['Fill the square', 'Landing shadow', 'Gaps stay empty', 'Flip']);
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
    // Nothing left of the outlines, blocks and spare pieces the game used to have.
    for (const text of [INSTRUCTIONS, ...RULES.map((r) => `${r.title} ${r.text} ${r.good?.caption ?? ''} ${r.bad?.caption ?? ''}`)]) {
      expect(text).not.toMatch(/outline|spare|decoy|block|belongs nowhere/i);
    }
  });
});
