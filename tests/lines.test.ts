import { describe, expect, it } from 'vitest';
import { cellSides, check, clearPath, edgeKey, extend, INTRO, newLines, normalize, pathEdges, regions, retract, rulesFor, satisfies, sizeFor, solved, tiles, verdict, type LinesState, type Mark, type Pt } from '../src/puzzles/lines';
import { seeded } from '../src/puzzles/rng';

const SPREAD = [1, 6, 12, 18, 26, 36, 44, 50, 60, 64, 80, 92, 118];

function drawPath(s0: LinesState, path: Pt[]) {
  let s = s0;
  for (const n of path) {
    const next = extend(s, n);
    expect(next).not.toBeNull();
    s = next!;
  }
  return s;
}

/** A bare 3x3 board from (0,3) to (3,0) for hand-built rule checks. */
function board(marks: Record<number, Mark>, extra: Partial<LinesState> = {}): LinesState {
  const m: (Mark | null)[] = Array(9).fill(null);
  for (const [i, v] of Object.entries(marks)) m[Number(i)] = v;
  return { cols: 3, rows: 3, starts: [{ x: 0, y: 3 }], ends: [{ x: 3, y: 0 }], dots: [], gaps: [], marks: m, rules: [], path: [], moves: 0, par: 1, won: false, solution: [], ...extra };
}

const P = (...xy: number[]): Pt[] => { const out: Pt[] = []; for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] }); return out; };
// Up the line x=1, then along the top: left column (cells 0,3,6) is one pocket, the rest another.
const HOOK = P(0, 3, 1, 3, 1, 2, 1, 1, 1, 0, 2, 0, 3, 0);

describe('edges and regions', () => {
  it('names an edge the same from either end', () => {
    expect(edgeKey({ x: 1, y: 2 }, { x: 1, y: 1 })).toBe(edgeKey({ x: 1, y: 1 }, { x: 1, y: 2 }));
    expect(pathEdges([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]).size).toBe(2);
  });

  it('splits a 2x2 grid in two with a line down the middle', () => {
    const reg = regions(2, 2, [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }]);
    expect(reg[0]).toBe(reg[2]);
    expect(reg[1]).toBe(reg[3]);
    expect(reg[0]).not.toBe(reg[1]);
    expect(new Set(regions(2, 2, [])).size).toBe(1);
  });

  it('fits shapes into a pocket only the right way up', () => {
    const L = normalize(P(0, 0, 0, 1, 1, 1)); // an L of three
    expect(tiles(3, 3, [0, 3, 4], [L])).toBe(true);
    expect(tiles(3, 3, [0, 1, 3], [L])).toBe(false); // same cells rotated
    const bar = normalize(P(0, 0, 1, 0));
    expect(tiles(3, 3, [0, 1, 3, 4], [bar, bar])).toBe(true);
    expect(tiles(3, 3, [0, 1, 3, 4], [bar])).toBe(false); // too few cells
    const col = normalize(P(0, 0, 0, 1));
    expect(tiles(3, 3, [0, 1, 2, 3, 4, 5], [L, normalize(P(0, 0, 1, 0, 1, 1))])).toBe(true);
    expect(tiles(3, 3, [0, 1, 2], [col, normalize(P(0, 0))])).toBe(false);
  });
});

describe('rules', () => {
  it('colors: two colors in one pocket fail', () => {
    const ok = board({ 0: { type: 'color', c: 's' }, 4: { type: 'color', c: 'p' } });
    expect(verdict(ok, HOOK).ok).toBe(true);
    const bad = board({ 0: { type: 'color', c: 's' }, 3: { type: 'color', c: 'p' } });
    expect(verdict(bad, HOOK).failed).toEqual([0, 3]);
  });

  it('dots and gaps', () => {
    const s = board({}, { dots: [edgeKey({ x: 1, y: 1 }, { x: 1, y: 2 })] });
    expect(verdict(s, HOOK).ok).toBe(true);
    const off = board({}, { dots: [edgeKey({ x: 2, y: 1 }, { x: 2, y: 2 })] });
    expect(verdict(off, HOOK).missed).toHaveLength(1);
    const gap = edgeKey({ x: 1, y: 1 }, { x: 1, y: 2 });
    const g = board({}, { gaps: [gap] });
    expect(verdict(g, HOOK).crossed).toEqual([gap]);
    expect(verdict(g, HOOK).ok).toBe(false);
    // Drawing refuses to cross a gap.
    let st = drawPath(g, HOOK.slice(0, 3));
    expect(extend(st, { x: 1, y: 1 })).toBeNull();
    st = drawPath(g, P(0, 3, 1, 3));
    expect(extend(st, { x: 1, y: 2 })).not.toBeNull();
  });

  it('counts: exactly that many sides on the path', () => {
    // Cell 3 (0,1) has its right side on the hook; cell 1 (1,0) has top side; cell 4 (1,1) has its left side.
    expect(cellSides(3, 3).filter((k) => pathEdges(HOOK).has(k))).toHaveLength(1);
    const ok = board({ 3: { type: 'count', n: 1 }, 1: { type: 'count', n: 2 } });
    expect(verdict(ok, HOOK).failed).toEqual([]);
    const bad = board({ 3: { type: 'count', n: 2 }, 8: { type: 'count', n: 1 } });
    expect(verdict(bad, HOOK).failed).toEqual([3, 8]);
  });

  it('pairs: exactly two of the ring color in its pocket, tiles included', () => {
    const two = board({ 1: { type: 'pair', c: 'd' }, 8: { type: 'pair', c: 'd' } });
    expect(verdict(two, HOOK).ok).toBe(true);
    const withTile = board({ 1: { type: 'pair', c: 'd' }, 8: { type: 'color', c: 'd' } });
    expect(verdict(withTile, HOOK).ok).toBe(true);
    const lonely = board({ 1: { type: 'pair', c: 'd' }, 0: { type: 'pair', c: 'd' } });
    expect(verdict(lonely, HOOK).failed).toEqual([0, 1]);
    const three = board({ 1: { type: 'pair', c: 'd' }, 2: { type: 'pair', c: 'd' }, 5: { type: 'color', c: 'd' } });
    expect(verdict(three, HOOK).failed).toEqual([1, 2]);
    const otherColor = board({ 1: { type: 'pair', c: 'd' }, 2: { type: 'pair', c: 'd' }, 5: { type: 'color', c: 's' } });
    expect(verdict(otherColor, HOOK).ok).toBe(true);
  });

  it('shapes: the pocket must be exactly the shape', () => {
    const col3 = normalize(P(0, 0, 0, 1, 0, 2));
    expect(verdict(board({ 3: { type: 'shape', cells: col3 } }), HOOK).ok).toBe(true);
    const row3 = normalize(P(0, 0, 1, 0, 2, 0));
    expect(verdict(board({ 3: { type: 'shape', cells: row3 } }), HOOK).failed).toEqual([3]);
    // The big pocket (six cells) is not a three-shape.
    expect(verdict(board({ 4: { type: 'shape', cells: col3 } }), HOOK).failed).toEqual([4]);
    // But two shapes that tile it together pass.
    const six = { 4: { type: 'shape', cells: normalize(P(0, 0, 1, 0, 1, 1)) }, 5: { type: 'shape', cells: normalize(P(0, 0, 0, 1, 1, 1)) } } as Record<number, Mark>;
    expect(verdict(board(six), HOOK).ok).toBe(true);
  });

  it('needs a start and an end, and a lawful path', () => {
    const s = board({});
    expect(verdict(s, HOOK.slice(0, 4)).complete).toBe(false);
    expect(verdict(s, [...HOOK].reverse()).complete).toBe(false);
    expect(verdict(s, P(0, 3, 2, 3)).complete).toBe(false);
    const two = board({}, { ends: [{ x: 3, y: 0 }, { x: 1, y: 0 }] });
    expect(verdict(two, HOOK.slice(0, 5)).complete).toBe(true);
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    expect(newLines(50, 5)).toEqual(newLines(50, 5));
    expect(newLines(50, 5)).not.toEqual(newLines(50, 6));
  });

  it('is solvable by its hidden walk, for every element', () => {
    for (let z = 1; z <= 118; z++) for (let deal = 0; deal < 4; deal++) {
      const s = newLines(z, z * 31 + deal);
      const { cols, rows } = sizeFor(z);
      expect(s.cols).toBe(cols);
      expect(s.rows).toBe(rows);
      expect(s.path).toEqual([]);
      expect(s.moves).toBe(0);
      expect(s.par).toBe(1);
      expect(s.won).toBe(false);
      expect(s.starts.some((p) => p.x === s.solution[0].x && p.y === s.solution[0].y)).toBe(true);
      expect(satisfies(s, s.solution)).toBe(true);
      expect(new Set(s.solution.map((p) => `${p.x},${p.y}`)).size).toBe(s.solution.length);
      expect(s.rules.length).toBeGreaterThanOrEqual(2);
      expect(s.rules.length).toBeLessThanOrEqual(3);
      // Every rule it names is on the board.
      if (s.rules.includes('dots')) expect(s.dots.length).toBeGreaterThan(0);
      if (s.rules.includes('gaps')) expect(s.gaps.length).toBeGreaterThan(0);
      for (const r of ['color', 'count', 'pair', 'shape'] as const) {
        const want = s.rules.includes(`${r}s` as never);
        expect(s.marks.some((m) => m?.type === r)).toBe(want);
      }
      // Ends sit on the rim, so the tail can point out.
      for (const e of s.ends) expect(e.x === 0 || e.y === 0 || e.x === s.cols || e.y === s.rows).toBe(true);
      expect(satisfies(s, [])).toBe(false);
      expect(satisfies(s, [s.starts[0]])).toBe(false);
      // Drawing the walk is allowed (no gap in its way) and wins on the first check.
      const won = check(drawPath(s, s.solution));
      expect(solved(won)).toBe(true);
    }
  });

  it('introduces rules gradually', () => {
    const seen = (z: number) => { const out = new Set<string>(); for (let d = 0; d < 30; d++) newLines(z, d).rules.forEach((r) => out.add(r)); return out; };
    expect([...seen(5)].sort()).toEqual(['colors', 'dots']);
    expect(seen(INTRO.counts)).toContain('counts');
    expect(seen(INTRO.counts).has('gaps')).toBe(false);
    expect(seen(INTRO.gaps)).toContain('gaps');
    expect(seen(INTRO.pairs)).toContain('pairs');
    expect(seen(INTRO.pairs).has('shapes')).toBe(false);
    expect(seen(INTRO.shapes)).toContain('shapes');
    expect(seen(110).size).toBeGreaterThanOrEqual(5);
    for (const z of SPREAD) for (let d = 0; d < 20; d++) {
      const r = rulesFor(z, seeded(d)).rules;
      expect(r.length).toBeGreaterThanOrEqual(2);
      expect(r.length).toBeLessThanOrEqual(3);
    }
  });

  it('builds fast', () => {
    for (let z = 1; z <= 118; z += 3) {
      const t0 = performance.now();
      newLines(z, 7);
      expect(performance.now() - t0).toBeLessThan(150);
    }
  });

  it('grows the grid with z', () => {
    expect(sizeFor(1).cols).toBe(4);
    expect(sizeFor(30).cols).toBe(5);
    expect(sizeFor(118).cols).toBe(6);
  });
});

describe('drawing', () => {
  it('starts only at a start node, extends to neighbors, retracts over the previous node', () => {
    const s0 = board({});
    expect(extend(s0, { x: 3, y: 3 })).toBeNull();
    const s1 = extend(s0, s0.starts[0])!;
    expect(s1.path).toEqual([s0.starts[0]]);
    const s2 = extend(s1, { x: 1, y: 3 })!;
    expect(s2.path).toHaveLength(2);
    expect(extend(s2, { x: 3, y: 3 })).toBeNull(); // not adjacent
    expect(extend(s2, s0.starts[0])!.path).toEqual([s0.starts[0]]); // retract
    expect(retract(s2)!.path).toEqual([s0.starts[0]]);
    expect(clearPath(s2)!.path).toEqual([]);
    expect(s0.path).toEqual([]);
  });

  it('never revisits a node', () => {
    const s = drawPath(board({}), HOOK);
    expect(extend(s, { x: 1, y: 2 })).toBeNull();
  });

  it('counts each check as a move and wins only on a complete, lawful path', () => {
    const s0 = newLines(26, 9);
    const partial = drawPath(s0, s0.solution.slice(0, 3));
    const miss = check(partial);
    expect(miss.moves).toBe(1);
    expect(solved(miss)).toBe(false);
    expect(miss.path).toEqual(partial.path); // the line stays for editing
    const full = drawPath(miss, s0.solution.slice(3));
    const win = check(full);
    expect(win.moves).toBe(2);
    expect(solved(win)).toBe(true);
    expect(extend(win, s0.starts[0])).toBeNull();
  });

  it('reports which marks a wrong path breaks', () => {
    for (const z of [5, 40, 70, 110]) {
      const s0 = newLines(z, 4);
      const v = verdict(s0, [s0.starts[0]]);
      expect(v.complete).toBe(false);
      expect(v.missed).toEqual(s0.dots);
      const good = verdict(s0, s0.solution);
      expect(good).toEqual({ complete: true, missed: [], crossed: [], failed: [], ok: true });
    }
  });
});
