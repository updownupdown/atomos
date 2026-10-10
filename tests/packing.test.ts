import { describe, expect, it } from 'vitest';
import { applyMove, bounds, canonical, canPlace, cellsLeft, cellsOf, mirrored, newPacking, normalize, occupancy, rotated, sizeFor, solved, solvedState, type PackingState } from '../src/puzzles/packing';
import { INSTRUCTIONS, PackingView, RULES } from '../src/puzzles/packingView';
import { C } from '../src/puzzles/palette';
import type { Area, RuleCard } from '../src/puzzles/view';

const SPREAD = [1, 6, 12, 26, 30, 40, 50, 80, 92, 118];

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
    expect(newPacking(26, 7)).toEqual(newPacking(26, 7));
    expect(newPacking(26, 7)).not.toEqual(newPacking(26, 8));
  });

  it('carves pieces of two to five cells that exactly fill the open cells', () => {
    for (const z of SPREAD) for (let deal = 0; deal < 8; deal++) {
      const s = newPacking(z, z * 100 + deal);
      const plan = sizeFor(z);
      expect(s.outline.filter(Boolean).length).toBe(plan.n);
      expect(s.blocked.filter(Boolean).length).toBe(plan.blocked);
      expect(s.blocked.every((b, i) => !b || s.outline[i])).toBe(true);
      expect(s.decoys).toBe(plan.decoys);
      expect(s.flips).toBe(plan.flips);
      expect(s.par).toBe(s.pieces.length - s.decoys);
      expect(s.moves).toBe(0);
      let total = 0;
      for (const p of s.pieces) {
        expect(p.at).toBeNull();
        expect(p.shape.length).toBeGreaterThanOrEqual(2);
        expect(p.shape.length).toBeLessThanOrEqual(5);
        if (s.solution[p.id]) total += p.shape.length;
        if (!s.flips) expect(p.flip).toBe(false);
      }
      expect(total).toBe(plan.n - plan.blocked);
      expect(cellsLeft(s)).toBe(plan.n - plan.blocked);
      expect(solved(s)).toBe(false);
      // The decoy matches no real piece in any orientation.
      const decoy = s.pieces.filter((p) => !s.solution[p.id]);
      expect(decoy).toHaveLength(s.decoys);
      for (const dp of decoy) for (const p of s.pieces) if (p !== dp) expect(canonical(p.shape)).not.toBe(canonical(dp.shape));
    }
  });

  it('is solved by its own carved answer, placed one piece at a time', () => {
    for (const z of SPREAD) {
      const s0 = newPacking(z, 999 + z);
      let s: PackingState = s0;
      for (const p of s0.pieces) {
        const home = s0.solution[p.id];
        if (!home) continue;
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

  it('grows with z and offers every outline kind', () => {
    expect(sizeFor(1).n).toBeLessThan(sizeFor(60).n);
    expect(sizeFor(60).n).toBeLessThan(sizeFor(118).n);
    expect(sizeFor(118).w * sizeFor(118).h).toBeLessThanOrEqual(49);
    for (let d = 0; d < 10; d++) { const s = newPacking(118, d); expect(s.w).toBeLessThanOrEqual(7); expect(s.h).toBeLessThanOrEqual(7); }
    expect(sizeFor(1).decoys).toBe(0);
    expect(sizeFor(118).flips).toBe(true);
    const styles = new Set<string>();
    for (let d = 0; d < 40; d++) styles.add(newPacking(80, d).style);
    expect([...styles].sort()).toEqual(['arms', 'blob', 'mirror', 'ring']);
  });

  it('deals fast', () => {
    let worst = 0;
    for (let z = 1; z <= 118; z += 3) {
      const t = performance.now();
      newPacking(z, z * 7 + 1);
      worst = Math.max(worst, performance.now() - t);
    }
    expect(worst).toBeLessThan(150);
  });
});

describe('moves', () => {
  it('refuses placements outside the outline, on a block or over another piece', () => {
    const s0 = newPacking(50, 42);
    const full = solvedState(s0);
    const p = full.pieces.find((q) => q.at)!;
    expect(applyMove(full, { kind: 'place', piece: p.id, at: { x: -1, y: 0 } })).toBeNull();
    expect(applyMove(full, { kind: 'place', piece: p.id, at: { x: s0.w, y: s0.h } })).toBeNull();
    const other = full.pieces.find((q) => q.at && q.id !== p.id)!;
    expect(applyMove(full, { kind: 'place', piece: p.id, at: other.at! })).toBeNull();
    expect(applyMove(full, { kind: 'place', piece: p.id, at: p.at! })).toBeNull();
    // A single-cell probe onto each block is refused.
    const lifted = applyMove(full, { kind: 'lift', piece: p.id })!;
    const b = s0.blocked.findIndex(Boolean);
    const cell0 = cellsOf(lifted.pieces[p.id])[0];
    expect(canPlace(lifted, p.id, { x: (b % s0.w) - cell0.x, y: Math.floor(b / s0.w) - cell0.y })).toBe(false);
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
      const occ = occupancy(r);
      expect(occ.every((id, i) => id === -1 || (s0.outline[i] && !s0.blocked[i]))).toBe(true);
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
        if (!home) continue;
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

describe('rule cards', () => {
  it('have a title, plain text and pictures that stay in their box', () => {
    expect(RULES.map((r) => r.title)).toEqual(['Fill the outline', 'Landing shadow', 'Turn', 'Move or lift', 'Filled blocks', 'Spare piece', 'Flip', 'Keyboard']);
    checkPictures(RULES);
    for (const r of RULES) expect(Boolean(r.good), r.title).toBe(r.title !== 'Keyboard');
  });

  it('shows the move that fails beside the one that works, flagged in amber, never red', () => {
    expect(RULES.filter((r) => r.bad).map((r) => r.title)).toEqual(['Fill the outline', 'Landing shadow', 'Filled blocks', 'Spare piece', 'Flip']);
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
