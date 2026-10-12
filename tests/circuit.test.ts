import { describe, expect, it } from 'vitest';
import { circuitShape, countSolutions, cw, deduce, firstWrong, newCircuit, nextStep, powerOf, rotations, shortest, solved, toggleLock, turn, turnsTo, type CircuitState } from '../src/puzzles/circuit';
import { CircuitView, INSTRUCTIONS, RULES } from '../src/puzzles/circuitView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DIALS = [1, 8, 15, 20, 21, 30, 40, 41, 50, 60, 61, 70, 80, 81, 90, 100];

/** A board from rows of tiles written as their wires ('u', 'r', 'd', 'l'), '*' on the cell. */
function board(rows: string[]): CircuitState {
  const cells = rows.map((r) => r.trim().split(/\s+/));
  const tiles: number[] = [];
  let source = 0;
  cells.forEach((row) => row.forEach((t) => {
    if (t.includes('*')) source = tiles.length;
    tiles.push((t.includes('u') ? 1 : 0) | (t.includes('r') ? 2 : 0) | (t.includes('d') ? 4 : 0) | (t.includes('l') ? 8 : 0));
  }));
  return { cols: cells[0].length, rows: cells.length, tiles, solution: tiles.slice(), source, locked: tiles.map(() => false), moves: 0, par: 0, order: [] };
}

describe('tiles', () => {
  it('turns wires clockwise and counts their ways', () => {
    expect(cw(1)).toBe(2);
    expect(cw(8)).toBe(1);
    expect(cw(5)).toBe(10);
    expect(rotations(5)).toEqual([5, 10]);
    expect(rotations(15)).toEqual([15]);
    expect(rotations(3).length).toBe(4);
    expect(turnsTo(1, 8)).toBe(3);
    expect(shortest(1, 8)).toBe(-1);
    expect(shortest(1, 4)).toBe(2);
    expect(shortest(5, 5)).toBe(0);
  });

  it('finds live tiles, loose ends and loops', () => {
    const tree = board(['rd* l', 'u .']);
    const p = powerOf(tree.cols, tree.rows, tree.tiles, tree.source);
    expect(p.live).toEqual([true, true, true, false]);
    expect(p.loose).toEqual([]);
    expect(p.depth.slice(0, 3)).toEqual([0, 1, 1]);
    const off = board(['ur* l', 'u .']);
    expect(powerOf(off.cols, off.rows, off.tiles, off.source).loose).toEqual([[0, 0]]);
    const loop = board(['rd* ld', 'ur ul']);
    const q = powerOf(loop.cols, loop.rows, loop.tiles, loop.source);
    expect(q.loops.size).toBe(4);
    expect(solved(loop)).toBe(false);
    expect(solved(board(['rd* l', 'ur l']))).toBe(true);
  });
});

describe('deals', () => {
  it('sizes the grid from 4 by 4 to 8 by 8 in steps', () => {
    expect(circuitShape(1)).toMatchObject({ cols: 4, rows: 4 });
    expect(circuitShape(100)).toMatchObject({ cols: 8, rows: 8 });
    const sizes = new Set<string>();
    let last = 0;
    for (let d = 1; d <= 100; d++) {
      const s = circuitShape(d);
      expect(s.cols * s.rows).toBeGreaterThanOrEqual(last);
      last = s.cols * s.rows;
      sizes.add(`${s.cols}x${s.rows}`);
    }
    expect(sizes.size).toBe(9);
  });

  it('deals the same board for the same dial and seed', () => {
    expect(newCircuit(60, 3)).toEqual(newCircuit(60, 3));
    expect(newCircuit(60, 3)).not.toEqual(newCircuit(60, 4));
  });

  it('deals one answer, a tree over the whole grid, worked out without guessing', () => {
    for (const d of DIALS) for (let seed = 1; seed <= 5; seed++) {
      const s = newCircuit(d, seed);
      const shape = circuitShape(d);
      expect([s.cols, s.rows]).toEqual([shape.cols, shape.rows]);
      expect(solved({ ...s, tiles: s.solution })).toBe(true);
      expect(solved(s)).toBe(false);
      expect(countSolutions(s.cols, s.rows, s.tiles, 2)).toBe(1);
      const w = deduce(s.cols, s.rows, s.tiles);
      expect(w.done).toBe(true);
      expect(w.answer).toEqual(s.solution);
      expect(new Set(s.order.map((o) => o.cell)).size).toBe(s.tiles.length);
      // Each tile is its answer turned; par is the fewest quarter turns either way.
      s.tiles.forEach((m, i) => expect(turnsTo(m, s.solution[i])).toBeGreaterThanOrEqual(0));
      expect(s.par).toBe(s.tiles.reduce((a, m, i) => a + Math.abs(shortest(m, s.solution[i])), 0));
      // Easy boards need no look ahead.
      if (d <= 20) expect(s.order.every((o) => o.why !== 'ahead')).toBe(true);
    }
  }, 30000);

  it('deals fewer straight pieces on harder boards', () => {
    const share = (d: number) => {
      let st = 0, all = 0;
      for (let seed = 1; seed <= 8; seed++) for (const m of newCircuit(d, seed).solution) { all++; if (rotations(m).length === 2) st++; }
      return st / all;
    };
    expect(share(1)).toBeGreaterThan(share(100));
  }, 30000);

  it('deals quickly, even the biggest boards', () => {
    // The median of ten, so one stall on a busy machine does not fail it.
    const times: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const t0 = performance.now();
      newCircuit(100, seed);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[5]).toBeLessThan(300);
  }, 30000);
});

describe('play', () => {
  it('turns tiles either way, never a locked one or a cross', () => {
    const s = newCircuit(30, 2);
    const i = s.tiles.findIndex((m) => rotations(m).length === 4);
    const a = turn(s, i)!;
    expect(a.tiles[i]).toBe(cw(s.tiles[i]));
    expect(a.moves).toBe(1);
    expect(turn(a, i, -1)!.tiles[i]).toBe(s.tiles[i]);
    expect(turn(a, i, -1)!.moves).toBe(2);
    const locked = toggleLock(s, i);
    expect(locked.moves).toBe(0);
    expect(turn(locked, i)).toBeNull();
    expect(turn(board(['urdl* .']), 0)).toBeNull();
  });

  it('points at a wrong locked tile first, then the solver order', () => {
    const s = newCircuit(40, 1);
    const step = nextStep(s)!;
    expect(s.tiles[step.cell]).not.toBe(s.solution[step.cell]);
    const wrong = s.tiles.findIndex((m, i) => m !== s.solution[i]);
    expect(firstWrong(toggleLock(s, wrong))).toBe(wrong);
    expect(firstWrong(s)).toBe(-1);
  });
});

describe('view', () => {
  const area = { x: 0, y: 0, w: 400, h: 400 };
  const centerOf = (v: CircuitView, i: number) => {
    const o = v as unknown as { origin: { x: number; y: number }; cell: number; state: CircuitState };
    return { x: o.origin.x + ((i % o.state.cols) + 0.5) * o.cell, y: o.origin.y + (Math.floor(i / o.state.cols) + 0.5) * o.cell };
  };

  it('draws inside its area and reports live tiles', () => {
    for (const d of [1, 50, 100]) {
      const v = new CircuitView(newCircuit(d, 2), false);
      for (const a of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, a, 0);
        expect(inside(pts, a)).toBe(true);
      }
      expect(v.stats().progress.label).toBe('Live');
      expect(v.hint()).toMatch(/dead|loose|loop/);
    }
  });

  it('turns on a tap, back on a left swipe, and locks on a hold', () => {
    let now = 1000;
    const s = newCircuit(30, 5);
    const v = new CircuitView(s, true, () => now);
    v.draw(recCtx().ctx, area, now);
    const i = s.tiles.findIndex((m, k) => rotations(m).length === 4 && k !== s.source);
    const p = centerOf(v, i);
    const tiles = () => (v as unknown as { state: CircuitState }).state.tiles;
    v.down(p); v.up(p);
    expect(tiles()[i]).toBe(cw(s.tiles[i]));
    expect(v.moves).toBe(1);
    v.down(p); v.move({ x: p.x - 15, y: p.y }); v.up({ x: p.x - 30, y: p.y + 2 });
    expect(tiles()[i]).toBe(s.tiles[i]);
    expect(v.moves).toBe(2);
    // A short vertical drag does nothing.
    v.down(p); v.up({ x: p.x, y: p.y + 30 });
    expect(v.moves).toBe(2);
    // Hold: locks while still pressed, then taps leave it alone.
    v.down(p); now += 500; v.draw(recCtx().ctx, area, now); v.up(p);
    expect((v as unknown as { state: CircuitState }).state.locked[i]).toBe(true);
    v.down(p); v.up(p);
    expect(tiles()[i]).toBe(s.tiles[i]);
    expect(v.moves).toBe(2);
    // Undo unlocks, then undoes the turns.
    expect(v.undo()).toBe(true);
    expect((v as unknown as { state: CircuitState }).state.locked[i]).toBe(false);
    v.undo(); v.undo();
    expect(v.moves).toBe(0);
    expect(v.canUndo()).toBe(false);
  });

  it('Look here and Show me play through to a win in exactly par', () => {
    for (const d of [1, 45, 100]) {
      const v = new CircuitView(newCircuit(d, 4), true);
      for (let k = 0; k < 100 && !v.won; k++) {
        const look = v.help(1)!;
        expect(look.text.length).toBeGreaterThan(10);
        expect(look.moved).toBeUndefined();
        expect(v.help(2)!.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.hint()).toBe('Every tile live');
    }
  });

  it('fixes a tile locked the wrong way', () => {
    let s = newCircuit(10, 2);
    const wrong = s.tiles.findIndex((m, i) => m !== s.solution[i]);
    s = toggleLock(s, wrong);
    const v = new CircuitView(s, true);
    expect(v.help(1)!.text).toMatch(/locked/);
    v.help(2);
    const st = (v as unknown as { state: CircuitState }).state;
    expect(st.tiles[wrong]).toBe(s.solution[wrong]);
    expect(st.locked[wrong]).toBe(true);
  });

  it('waits for a turn to show before it counts as won', () => {
    let now = 0;
    const s = newCircuit(1, 1);
    const v = new CircuitView(s, false, () => now);
    for (let k = 0; k < 60 && !(v as unknown as { done(): boolean }).done(); k++) { v.help(2); now += 1000; }
    // The last Show me just played: not won until its turn has shown.
    v.undo(); now += 1000; v.help(2);
    expect(v.won).toBe(false);
    now += 1000;
    expect(v.won).toBe(true);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['No loose ends', 'One tree']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });
});
