import { describe, expect, it } from 'vitest';
import { aligned, alignment, chainEnd, fewest, naive, newShells, nextTurn, remaining, shellsShape, solved, touched, turn, type ShellsState } from '../src/puzzles/shells';
import { INSTRUCTIONS, RULES, ShellsView } from '../src/puzzles/shellsView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DIALS = [1, 5, 12, 13, 20, 30, 31, 45, 46, 62, 63, 80, 81, 90, 100];

const key = (s: ShellsState) => s.offsets.join(',');

/** The fewest turns by breadth-first search over every ring's offset; a turn is any amount. */
function bfs(s0: ShellsState): number {
  const seen = new Set([key(s0)]);
  let wave = [s0];
  for (let depth = 0; wave.length; depth++) {
    const next: ShellsState[] = [];
    for (const s of wave) {
      if (solved(s)) return depth;
      for (let k = 0; k < s.beads.length; k++) for (let v = 1; v < s.slots; v++) {
        const t = turn(s, k, v)!;
        if (seen.has(key(t))) continue;
        seen.add(key(t));
        next.push(t);
      }
    }
    wave = next;
  }
  return -1;
}

describe('rules', () => {
  const s: ShellsState = {
    slots: 6,
    beads: [[true, true, false, false, false, false], [true, false, true, true, false, false], [true, true, false, true, false, false]],
    links: [true, false],
    offsets: [0, 0, 0],
    moves: 0,
    par: 0,
  };

  it('lines up at home, and a linked turn carries the next ring', () => {
    expect(solved(s)).toBe(true);
    expect(chainEnd(s.links, 0)).toBe(1);
    expect(chainEnd(s.links, 1)).toBe(1);
    const t = turn(s, 0, 2)!;
    expect(t.offsets).toEqual([2, 2, 0]);
    expect(t.moves).toBe(1);
    // The pair inside the chain keeps; the one past its end shifts.
    expect(alignment(t)).toEqual([true, false, true]);
    expect(touched(s.links, 0)).toEqual([1]);
    expect(touched(s.links, 2)).toEqual([1, 2]);
    expect(turn(s, 1, 6)).toBeNull();
    expect(turn(t, 0, -2)!.offsets).toEqual([0, 0, 0]);
  });

  it('counts the fewest turns the way a full search does', () => {
    for (const links of [[false, false], [true, false], [false, true], [true, true]]) {
      for (let a = 0; a < 6; a += 2) for (let b = 0; b < 6; b += 3) for (let c = 0; c < 6; c++) {
        const t = { ...s, links, offsets: [a, b, c] };
        expect(fewest(t), `${links} ${a},${b},${c}`).toBe(bfs(t));
      }
    }
  });
});

describe('deals', () => {
  it('deals the shape the dial asks for, solvable in par, deterministically', () => {
    for (const d of DIALS) for (const seed of [1, 2, 3, 4]) {
      const s = newShells(d, seed);
      const shape = shellsShape(d);
      expect(s.beads.length).toBe(shape.rings);
      expect(s.slots).toBe(shape.slots);
      s.beads.forEach((b, k) => expect(b.filter(Boolean).length).toBe(shape.beads[k]));
      expect(s.links.filter(Boolean).length).toBeGreaterThanOrEqual(shape.links[0]);
      expect(s.links.filter(Boolean).length).toBeLessThanOrEqual(shape.links[1]);
      expect(s.par).toBeGreaterThanOrEqual(shape.par);
      expect(s.par).toBe(fewest(s));
      expect(solved(s)).toBe(false);
      expect(Math.min(naive(s), naive(s, true)) - s.par).toBeGreaterThanOrEqual(shape.trap);
      expect(key(newShells(d, seed))).toBe(key(s));
      // Following the remaining turns, ring by ring, solves it in par.
      let t = s;
      remaining(s).forEach((v, k) => { if (v) t = turn(t, k, v)!; });
      expect(solved(t)).toBe(true);
      expect(t.moves).toBe(s.par);
    }
  });

  it('matches a full search on small boards', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = newShells(20, seed);
      expect(bfs(s)).toBe(s.par);
    }
  });

  it('grows with the dial', () => {
    expect(shellsShape(1).rings).toBe(3);
    expect(shellsShape(100).rings).toBe(5);
    expect(shellsShape(1).links).toEqual([0, 0]);
    for (let d = 2; d <= 100; d++) {
      expect(shellsShape(d).slots).toBeGreaterThanOrEqual(shellsShape(d - 1).slots);
      expect(shellsShape(d).rings).toBeGreaterThanOrEqual(shellsShape(d - 1).rings);
    }
  });

  it('deals quickly', () => {
    for (const d of [1, 50, 100]) {
      const t0 = performance.now();
      for (let seed = 1; seed <= 10; seed++) newShells(d, seed);
      expect((performance.now() - t0) / 10).toBeLessThan(60);
    }
  });
});

describe('hints', () => {
  it('each next turn lines up a pair for good, and walks to the win in par', () => {
    for (const d of DIALS) for (const seed of [1, 2]) {
      let s = newShells(d, seed);
      const kept = new Set<number>();
      for (let i = 0; i < s.par; i++) {
        const t = nextTurn(s)!;
        s = turn(s, t.ring, t.steps)!;
        expect(aligned(s, t.pair)).toBe(true);
        for (const p of kept) expect(aligned(s, p)).toBe(true);
        kept.add(t.pair);
      }
      expect(solved(s)).toBe(true);
      expect(nextTurn(s)).toBeNull();
    }
  });
});

describe('view', () => {
  it('draws inside its area, and Show me finishes a board in par turns', () => {
    for (const d of [1, 50, 100]) {
      const v = new ShellsView(newShells(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.hint()).toMatch(/to line up/);
      const h = v.help(1)!;
      expect(h.moved).toBeUndefined();
      expect(h.text.length).toBeGreaterThan(0);
      let guard = 0;
      while (!v.won && guard++ < 20) {
        const r = v.help(2)!;
        expect(r.moved).toBe(true);
        const { ctx } = recCtx();
        v.draw(ctx, AREAS_ALL[0], guard * 16);
      }
      expect(v.won).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.undo()).toBe(true);
      expect(v.won).toBe(false);
      v.restart();
      expect(v.moves).toBe(0);
      expect(v.canUndo()).toBe(false);
    }
  });

  it('turns a ring by dragging it, snapping to whole slots', () => {
    const s = newShells(40, 3);
    const v = new ShellsView(s, true);
    const area = { x: 0, y: 0, w: 400, h: 400 };
    v.draw(recCtx().ctx, area, 0);
    // Grab the outermost ring at the top and drag it a little over one slot clockwise.
    const R = s.beads.length;
    const cx = 200, cy = 200;
    // The outermost ring sits a little inside the dial: find it by trying radii outward.
    let grabbed = -1;
    for (let r = 190; r > 20 && grabbed < 0; r -= 2) {
      v.down({ x: cx, y: cy - r });
      if ((v as unknown as { drag: { ring: number } | null }).drag?.ring === R - 1) grabbed = r;
      else v.cancel();
    }
    expect(grabbed).toBeGreaterThan(0);
    const step = (Math.PI * 2) / s.slots;
    const a = -Math.PI / 2 + step * 1.3;
    v.move({ x: cx + Math.cos(-Math.PI / 2 + step * 0.6) * grabbed, y: cy + Math.sin(-Math.PI / 2 + step * 0.6) * grabbed });
    v.move({ x: cx + Math.cos(a) * grabbed, y: cy + Math.sin(a) * grabbed });
    v.up();
    expect(v.moves).toBe(1);
    const end = chainEnd(s.links, R - 1);
    expect(end).toBe(R - 1);
    expect((v as unknown as { state: ShellsState }).state.offsets[R - 1]).toBe((s.offsets[R - 1] + 1) % s.slots);
    // A drag that comes back where it started is no move.
    v.down({ x: cx, y: cy - grabbed });
    v.move({ x: cx + 10, y: cy - grabbed });
    v.move({ x: cx, y: cy - grabbed });
    v.up();
    expect(v.moves).toBe(1);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Line up', 'Fewest turns']);
    expect(RULES.map((r) => r.title)).toEqual(['Turn a ring', 'Line up', 'Linked rings', 'Fewest turns']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });
});
