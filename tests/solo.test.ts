import { describe, expect, it } from 'vitest';
import {
  conflicts, countSolutions, CROSS, ELECTRON, firstWrong, newSolo, rate, setMark, solved, soloShape, tap, touching, type SoloState,
} from '../src/puzzles/solo';
import { INSTRUCTIONS, orbitalColors, RULES, SoloView } from '../src/puzzles/soloView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';


/** Node's CPU clock (the tests run in Node; the app's types leave it out). */
declare const process: { cpuUsage(prev?: { user: number; system: number }): { user: number; system: number } };
const DS = [1, 5, 10, 14, 15, 20, 32, 33, 40, 52, 53, 60, 72, 73, 80, 92, 93, 100];

/** Whether every orbital is one connected patch. */
function connected(s: SoloState): boolean {
  const n = s.size;
  for (let g = 0; g < n; g++) {
    const cells = s.regions.map((r, i) => (r === g ? i : -1)).filter((i) => i >= 0);
    if (!cells.length) return false;
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % n;
      for (const j of [c - n, c + n, x > 0 ? c - 1 : -1, x < n - 1 ? c + 1 : -1]) {
        if (j >= 0 && j < n * n && s.regions[j] === g && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    if (seen.size !== cells.length) return false;
  }
  return true;
}

describe('deals', () => {
  it('sizes the board smoothly along the dial', () => {
    expect(soloShape(1).size).toBe(5);
    expect(soloShape(100).size).toBe(10);
    let last = 0;
    for (let d = 1; d <= 100; d++) {
      const { size, level } = soloShape(d);
      expect(size).toBeGreaterThanOrEqual(last);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
      last = size;
    }
  });

  it('is the same deal for the same dial and seed', () => {
    expect(newSolo(50, 3)).toEqual(newSolo(50, 3));
    expect(newSolo(50, 3).regions).not.toEqual(newSolo(50, 4).regions);
  });

  it('deals exactly one answer, human-solvable, across the dial', () => {
    for (const d of DS) for (const seed of [1, 2, 3]) {
      const s = newSolo(d, seed);
      const n = s.size;
      expect(s.regions.length).toBe(n * n);
      expect(new Set(s.regions).size).toBe(n);
      expect(connected(s)).toBe(true);
      expect(countSolutions(n, s.regions, 3)).toBe(1);
      expect(rate(n, s.regions)).toBe(s.score);
      expect(s.score).toBeGreaterThanOrEqual(0);
      // The answer keeps every rule.
      const full: SoloState = { ...s, cells: s.cells.map((_, i) => (s.solution[Math.floor(i / n)] === i % n ? ELECTRON : 0)) };
      expect(solved(full)).toBe(true);
      expect(new Set(s.solution).size).toBe(n);
      expect(new Set(s.solution.map((c, r) => s.regions[r * n + c])).size).toBe(n);
      expect(s.par).toBe(n);
    }
  }, 60000);

  it('asks harder deals of a size as the dial rises', () => {
    const avg = (d: number) => { let t = 0; for (let seed = 1; seed <= 8; seed++) t += newSolo(d, seed).score; return t / 8; };
    expect(avg(72)).toBeGreaterThan(avg(53));
    expect(avg(92)).toBeGreaterThan(avg(73));
  }, 60000);

  it('deals quickly, even at the top of the dial', () => {
    let worst = 0;
    for (let seed = 1; seed <= 6; seed++) {
      // CPU time, not wall time, so a busy machine does not fail it.
      const t0 = process.cpuUsage();
      newSolo(100, seed);
      const t = process.cpuUsage(t0);
      worst = Math.max(worst, (t.user + t.system) / 1000);
    }
    expect(worst).toBeLessThan(400);
  }, 60000);
});

describe('play', () => {
  it('cycles a cell: cross, electron, empty; only electrons count as moves', () => {
    const s = newSolo(20, 1);
    const a = tap(s, 0);
    expect(a.cells[0]).toBe(CROSS);
    expect(a.moves).toBe(0);
    const b = tap(a, 0);
    expect(b.cells[0]).toBe(ELECTRON);
    expect(b.moves).toBe(1);
    expect(tap(b, 0).cells[0]).toBe(0);
    expect(s.cells[0]).toBe(0);
    expect(setMark(s, 0, 0)).toBeNull();
  });

  it('flags electrons that share a line or orbital, or touch', () => {
    const s = newSolo(20, 1);
    const n = s.size;
    expect(touching(n, 0, n + 1)).toBe(true);
    expect(touching(n, 0, 2)).toBe(false);
    const diag = setMark(setMark(s, 0, ELECTRON)!, n + 1, ELECTRON)!;
    expect([...conflicts(diag)].sort((a, b) => a - b)).toEqual([0, n + 1]);
    const row = setMark(setMark(s, 0, ELECTRON)!, 3, ELECTRON)!;
    expect(conflicts(row).size).toBe(2);
    // The answer's own electrons never clash.
    let ok = s;
    s.solution.forEach((c, r) => { ok = setMark(ok, r * n + c, ELECTRON)!; });
    expect(conflicts(ok).size).toBe(0);
    expect(solved(ok)).toBe(true);
  });

  it('finds a wrong electron or a cross on the answer', () => {
    const s = newSolo(30, 2);
    const n = s.size;
    const right = s.solution[0];
    expect(firstWrong(setMark(s, right, CROSS)!)).toBe(right);
    const off = (right + 2) % n;
    expect(firstWrong(setMark(s, off, ELECTRON)!)).toBe(off);
    expect(firstWrong(s)).toBe(-1);
  });
});

describe('view', () => {
  it('draws inside its area and reports progress', () => {
    for (const d of [1, 50, 100]) {
      const v = new SoloView(newSolo(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Placed');
      expect(v.hint()).toMatch(/electrons to place/);
    }
  });

  it('gives each orbital its own color, unlike its neighbors', () => {
    const s = newSolo(100, 1);
    const colors = orbitalColors(s.size, s.regions);
    expect(new Set(colors).size).toBe(s.size);
  });

  it('taps and drags through the pointer, and undoes', () => {
    const v = new SoloView(newSolo(10, 1), true);
    const { ctx } = recCtx();
    const area = { x: 0, y: 0, w: 400, h: 400 };
    v.draw(ctx, area, 0);
    const n = 5;
    // The board fills the square area, less the frame's room: find cell centers by probing.
    const at = (cx: number, cy: number) => ({ x: 200 + (cx - (n - 1) / 2) * 72, y: 200 + (cy - (n - 1) / 2) * 72 });
    v.down(at(0, 0)); v.up(at(0, 0));
    expect(v.hint()).toMatch(/5 electrons to place/);
    expect(v.canUndo()).toBe(true);
    // A drag along the bottom row crosses off every cell in it, as one move.
    v.down(at(0, 4)); for (let x = 0; x <= 4; x += 0.5) v.move(at(x, 4)); v.up(at(4, 4));
    v.undo();
    v.undo();
    expect(v.canUndo()).toBe(false);
    expect(v.moves).toBe(0);
  });

  it('plays itself to a win with Show me, every hint pointing somewhere', () => {
    for (const d of [1, 35, 70, 100]) for (const seed of [1, 2]) {
      const v = new SoloView(newSolo(d, seed), true);
      for (let k = 0; k < 400 && !v.won; k++) {
        const look = v.help(1);
        expect(look, `d${d} s${seed} step ${k}`).not.toBeNull();
        expect(look!.moved).toBeUndefined();
        const show = v.help(2)!;
        expect(show.moved).toBe(true);
        expect(show.text.length).toBeGreaterThan(5);
      }
      expect(v.won).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.clean).toBe(true);
      expect(v.hint()).toBe('One electron in every orbital');
    }
  }, 60000);

  it('owns up to a wrong electron and takes it away', () => {
    const s = newSolo(40, 1);
    const n = s.size;
    const off = (s.solution[0] + 2) % n;
    const v = new SoloView(s, true);
    const { ctx } = recCtx();
    v.draw(ctx, { x: 0, y: 0, w: 400, h: 400 }, 0);
    (v as unknown as { apply(x: SoloState | null): void }).apply(setMark(s, off, ELECTRON));
    expect(v.help(1)!.text).toMatch(/does not belong/);
    expect(v.help(2)!.moved).toBe(true);
    expect(v.help(1)!.text).not.toMatch(/does not belong/);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['One each', 'No touching']);
    expect(RULES.map((r) => r.title)).toEqual(['Electrons', 'One each', 'No touching', 'Drag to cross', 'Think ahead']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  });
});
