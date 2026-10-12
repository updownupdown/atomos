import { describe, expect, it } from 'vitest';
import { clashes, CROSS, countSolutions, emitShape, firstWrong, grade, LAMP, light, nextForced, newEmit, NONE, OPEN, overfull, setMark, setMarks, solved, tap, WALL, type EmitState } from '../src/puzzles/emit';
import { EmitView, INSTRUCTIONS, RULES } from '../src/puzzles/emitView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DS = [1, 10, 20, 21, 35, 45, 46, 60, 61, 75, 80, 81, 90, 100];

/** A board from rows: '.' open, '#' wall, a digit a numbered wall, '*' a lamp. */
function board(rows: string[]): EmitState {
  const n = rows.length;
  const walls: number[] = [], marks: number[] = [];
  rows.forEach((line) => [...line].forEach((ch) => {
    walls.push(ch === '#' ? WALL : /[0-4]/.test(ch) ? Number(ch) : OPEN);
    marks.push(ch === '*' ? LAMP : NONE);
  }));
  return { size: n, walls, marks, solution: walls.map(() => false), moves: 0, par: 0, depth: 0, looks: 0 };
}

describe('light', () => {
  it('runs along the row and column until a wall', () => {
    const s = board(['.*.#', '..#.', '.1..', '....']);
    const lit = light(s);
    expect([...lit].map((v, i) => (s.walls[i] === OPEN ? (v ? 'L' : '.') : '#')).join('')).toBe('LLL#.L#..#......');
  });

  it('flags lamps in each other’s light and numbers with too many lamps', () => {
    const s = board(['*.*', '...', '#..']);
    expect([...clashes(s)].sort()).toEqual([0, 2]);
    const t = board(['*1*', '...', '...']);
    expect(overfull(t)).toEqual([1]);
    expect(clashes(t).size).toBe(0);
  });

  it('wins only with every cell lit, no clash and every number met', () => {
    expect(solved(board(['*.#', '.#.', '#*.']))).toBe(false);
    expect(solved(board(['*..', '.#*', '.##']))).toBe(true);
    expect(solved(board(['*1.', '.#*', '.##']))).toBe(true);
    expect(solved(board(['*2.', '.#*', '.##']))).toBe(false);
  });

  it('cycles a tap through lamp, cross and empty, counting lamps placed', () => {
    const s = board(['...', '.#.', '...']);
    const a = tap(s, 0)!;
    expect(a.marks[0]).toBe(LAMP);
    expect(a.moves).toBe(1);
    const b = tap(a, 0)!;
    expect(b.marks[0]).toBe(CROSS);
    expect(tap(b, 0)!.marks[0]).toBe(NONE);
    expect(tap(b, 0)!.moves).toBe(1);
    expect(tap(s, 4)).toBeNull();
    const c = setMarks(s, [0, 1, 2, 4], CROSS)!;
    expect(c.marks.slice(0, 5)).toEqual([CROSS, CROSS, CROSS, NONE, NONE]);
    expect(c.moves).toBe(0);
  });
});

describe('deals', () => {
  it('grows the board along the dial', () => {
    expect(emitShape(1).size).toBe(6);
    expect(emitShape(100).size).toBe(10);
    for (let d = 2; d <= 100; d++) {
      expect(emitShape(d).size).toBeGreaterThanOrEqual(emitShape(d - 1).size);
      expect(emitShape(d).numbered).toBeLessThanOrEqual(emitShape(d - 1).numbered);
    }
  });

  it('is the same deal for the same dial and seed', () => {
    expect(newEmit(70, 4)).toEqual(newEmit(70, 4));
    expect(newEmit(70, 4).walls).not.toEqual(newEmit(70, 5).walls);
  });

  it('deals boards with exactly one answer, found by deduction, across the dial', () => {
    for (const d of DS) for (const seed of [1, 2, 3]) {
      const s = newEmit(d, seed);
      const sh = emitShape(d);
      expect(s.size).toBe(sh.size);
      const full = { ...s, marks: s.solution.map((v) => (v ? LAMP : NONE)) };
      expect(solved(full)).toBe(true);
      const g = grade(s.size, s.walls, sh.maxDepth);
      expect(g.solved).toBe(true);
      expect(g.depth).toBe(s.depth);
      expect(countSolutions(s.size, s.walls)).toBe(1);
      expect(s.par).toBe(s.solution.filter(Boolean).length);
      expect(s.marks.every((m) => m === NONE)).toBe(true);
    }
  });

  it('keeps fewer numbers and needs deeper deduction higher on the dial', () => {
    const share = (d: number) => {
      let sum = 0;
      for (const seed of [1, 2, 3, 4]) {
        const w = newEmit(d, seed).walls.filter((v) => v !== OPEN);
        sum += w.filter((v) => v >= 0).length / w.length;
      }
      return sum / 4;
    };
    expect(share(1)).toBeGreaterThan(share(100));
    expect([1, 2, 3, 4].every((seed) => newEmit(5, seed).depth === 0)).toBe(true);
    expect(Math.max(...[1, 2, 3, 4].map((seed) => newEmit(95, seed).depth))).toBe(2);
  });

  it('deals quickly', () => {
    const t0 = performance.now();
    for (const seed of [1, 2, 3, 4, 5]) newEmit(100, seed);
    // A few milliseconds to a couple of hundred each; roomy here so a busy machine does not fail it.
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe('hints', () => {
  it('solves itself one forced step at a time', () => {
    for (const d of [1, 30, 50, 70, 100]) for (const seed of [4, 5]) {
      let s = newEmit(d, seed);
      for (let k = 0; k < 300 && !solved(s); k++) {
        const f = nextForced(s)!;
        expect(f).not.toBeNull();
        expect(f.lamp).toBe(s.solution[f.cell]);
        s = setMark(s, f.cell, f.lamp ? LAMP : CROSS)!;
      }
      expect(solved(s)).toBe(true);
      expect(s.moves).toBe(s.par);
    }
  });

  it('finds a wrong lamp or a wrong cross first', () => {
    const s = newEmit(30, 2);
    const off = s.solution.findIndex((v, i) => !v && s.walls[i] === OPEN);
    const on = s.solution.indexOf(true);
    expect(firstWrong(setMark(s, off, LAMP)!)).toBe(off);
    expect(firstWrong(setMark(s, on, CROSS)!)).toBe(on);
    expect(firstWrong(setMark(s, on, LAMP)!)).toBe(-1);
  });
});

describe('view', () => {
  it('draws inside its area and reports progress', () => {
    for (const d of [1, 60, 100]) {
      const v = new EmitView(newEmit(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Lit');
      expect(v.hint()).toMatch(/cells? still dark/);
    }
  });

  it('taps a lamp, drags crosses, and undoes each as one step', () => {
    const v = new EmitView(newEmit(1, 1), true);
    const { ctx } = recCtx();
    v.draw(ctx, { x: 0, y: 0, w: 400, h: 400 }, 0);
    const st = () => (v as unknown as { state: EmitState }).state;
    const c = (v as unknown as { cell: number }).cell;
    const o = (v as unknown as { origin: { x: number; y: number } }).origin;
    const n = st().size;
    const at = (i: number) => ({ x: o.x + ((i % n) + 0.5) * c, y: o.y + (Math.floor(i / n) + 0.5) * c });
    const open = st().walls.map((w, i) => (w === OPEN ? i : -1)).filter((i) => i >= 0);
    v.down(at(open[0])); v.up(at(open[0]));
    expect(st().marks[open[0]]).toBe(LAMP);
    expect(v.moves).toBe(1);
    // A drag along the first open run of a row crosses its empty cells.
    const row = open.filter((i) => Math.floor(i / n) === Math.floor(open[0] / n) && i !== open[0]);
    const run = [row[0]];
    for (const i of row.slice(1)) if (i === run[run.length - 1] + 1) run.push(i); else break;
    if (run.length >= 2) {
      v.down(at(run[0])); v.move(at(run[run.length - 1])); v.up(at(run[run.length - 1]));
      for (const i of run) expect(st().marks[i]).toBe(CROSS);
      v.undo();
      for (const i of run) expect(st().marks[i]).toBe(NONE);
    }
    v.undo();
    expect(st().marks[open[0]]).toBe(NONE);
    expect(v.canUndo()).toBe(false);
  });

  it('points somewhere, Show me plays, and the chain of hints wins at par', () => {
    for (const d of [1, 50, 100]) {
      const v = new EmitView(newEmit(d, 3), true);
      const h1 = v.help(1)!;
      expect(h1.text.length).toBeGreaterThan(0);
      expect(h1.moved).toBeUndefined();
      let k = 0;
      while (!v.won && k++ < 400) {
        expect(v.help(1)).not.toBeNull();
        expect(v.help(2)!.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.help(2)).toBeNull();
      expect(v.hint()).toBe('Every cell lit');
    }
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Light every cell', 'No lamp lit', 'Numbers']);
    expect(RULES.map((r) => r.title)).toEqual(['Lamps', 'Light every cell', 'No lamp lit', 'Numbers', 'Crosses']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });
});
