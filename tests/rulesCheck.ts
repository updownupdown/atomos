// Shared checks for a game's rule cards and board drawing, used by the newer games' tests.
import { expect } from 'vitest';
import { C } from '../src/puzzles/palette';
import type { Illustration, RuleCard } from '../src/puzzles/view';

/** A canvas stand-in that records every coordinate drawn and every color set. */
export function recCtx(): { ctx: CanvasRenderingContext2D; pts: [number, number][]; colors: Set<unknown> } {
  const pts: [number, number][] = [];
  const colors = new Set<unknown>();
  const rec = (x: number, y: number) => pts.push([x, y]);
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'moveTo' || k === 'lineTo') return rec;
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'ellipse') return (x: number, y: number, rx: number, ry: number) => { const r = Math.max(rx, ry); rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'roundRect' || k === 'rect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      if (k === 'fillText') return (s: string, x: number, y: number) => { rec(x, y - 12); rec(x + s.length * 7, y); };
      return () => {};
    },
    set(t, k, v) {
      if (k === 'strokeStyle' || k === 'fillStyle') colors.add(v);
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, pts, colors };
}

export function inside(pts: [number, number][], a: { x: number; y: number; w: number; h: number }): boolean {
  return pts.every(([x, y]) => x >= a.x - 0.5 && x <= a.x + a.w + 0.5 && y >= a.y - 0.5 && y <= a.y + a.h + 0.5);
}

export const AREAS_ALL = [{ x: 0, y: 0, w: 340, h: 430 }, { x: 10, y: 8, w: 1200, h: 700 }, { x: 0, y: 0, w: 600, h: 300 }];

export function checkRules(rules: RuleCard[], withBad: string[]): void {
  expect(rules.length).toBeGreaterThan(3);
  expect(rules.filter((r) => r.bad).map((r) => r.title)).toEqual(withBad);
  for (const r of rules) {
    expect(r.title.trim().length, r.title).toBeGreaterThan(0);
    expect(r.title.length, r.title).toBeLessThanOrEqual(24);
    expect(r.text.trim().length, r.title).toBeGreaterThan(0);
    expect(r.text, r.title).not.toMatch(/[<>]/);
    expect(r.text.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, r.title).toBeLessThanOrEqual(2);
    expect(r.demo, r.title).toBeUndefined();
    expect(r.good, r.title).toBeDefined();
    const pics: [string, Illustration][] = [['good', r.good!]];
    if (r.bad) pics.push(['bad', r.bad]);
    for (const [kind, ill] of pics) {
      const name = `${r.title} (${kind})`;
      expect(ill.duration, name).toBeGreaterThanOrEqual(1.5);
      expect(ill.duration, name).toBeLessThanOrEqual(4);
      if (ill.caption !== undefined) expect(ill.caption.length, name).toBeLessThanOrEqual(21);
      const times: number[] = [];
      for (let t = 0; t < ill.duration; t += 0.07) times.push(t);
      times.push(ill.duration);
      for (const [w, h] of [[140, 104], [120, 90]]) for (const t of times) {
        const { ctx, pts } = recCtx();
        ill.draw(ctx, w, h, t);
        expect(inside(pts, { x: 0, y: 0, w, h }), `${name} at ${t.toFixed(2)}s, ${w}x${h}`).toBe(true);
      }
      for (const [w, h] of [[140, 104], [120, 90]]) {
        const { ctx, colors } = recCtx();
        ill.draw(ctx, w, h, ill.duration);
        expect(colors.has(C.warn), name).toBe(kind === 'bad');
        expect(colors.has(C.bad), name).toBe(false);
      }
    }
  }
}
