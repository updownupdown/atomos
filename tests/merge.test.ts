import { describe, expect, it } from 'vitest';
import { jammed, newMerge, slide, socketsFor, wanted, won, type MergeState, type Tile } from '../src/puzzles/merge';
import { INSTRUCTIONS, RULES } from '../src/puzzles/mergeView';

const t = (v: number, id = 1): Tile => ({ id, v, spoiled: false });

function board(target: { z: number; a: number }, tiles: (Tile | null)[]): MergeState {
  const s = newMerge(target, 1);
  s.cells = tiles.map((x) => (x ? { ...x } : null));
  s.nextId = 100;
  return s;
}

const C12 = { z: 6, a: 12 };
const empty = (n: number) => Array<Tile | null>(n).fill(null);

describe('sockets', () => {
  it('writes the mass number as clusters, largest first', () => {
    expect(socketsFor(12)).toEqual([8, 4]);
    expect(socketsFor(7)).toEqual([4, 2, 1]);
    expect(socketsFor(56)).toEqual([32, 16, 8]);
    expect(socketsFor(4)).toEqual([4]);
  });

  it('wants the largest cluster first', () => {
    expect(wanted(newMerge(C12, 1))).toBe(8);
  });
});

describe('sliding', () => {
  it('slides tiles to the wall and merges the equal pair that meets', () => {
    const s = board(C12, [t(1, 1), null, t(1, 2), null, ...empty(12)]);
    const n = slide(s, 'right')!;
    expect(n).not.toBeNull();
    expect(n.cells[3]).toMatchObject({ v: 2 });
    expect(n.moves).toBe(1);
    expect(n.cells.filter(Boolean)).toHaveLength(2); // one new tile dealt
  });

  it('does not merge clusters of different sizes', () => {
    const s = board(C12, [t(1, 1), null, t(2, 2), null, ...empty(12)]);
    const n = slide(s, 'right')!;
    expect(n.cells[3]).toMatchObject({ v: 2 });
    expect(n.cells[2]).toMatchObject({ v: 1 });
  });

  it('is not a move when nothing can shift', () => {
    const s = board(C12, [null, null, null, t(1, 1), ...empty(12)]);
    expect(slide(s, 'right')).toBeNull();
  });

  it('merges each tile at most once per swipe', () => {
    const s = board(C12, [t(1, 1), t(1, 2), t(1, 3), null, ...empty(12)]);
    const n = slide(s, 'left')!;
    expect(n.cells[0]).toMatchObject({ v: 2 });
    expect(n.cells[1]).toMatchObject({ v: 1 });
  });

  it('sends a wanted cluster into the nucleus the moment it forms', () => {
    const s = board(C12, [t(4, 1), t(4, 2), null, null, ...empty(12)]);
    const n = slide(s, 'left')!;
    expect(n.filled).toBe(1);
    expect(n.flown[0].tile.v).toBe(8);
    expect(n.cells.some((c) => c?.v === 8)).toBe(false);
    expect(wanted(n)).toBe(4);
  });

  it('spoils a cluster bigger than anything still wanted, which crumbles next swipe', () => {
    const s = board({ z: 2, a: 7 }, [t(4, 1), t(4, 2), null, null, ...empty(12)]);
    s.filled = 1; // the 4 is in; now 2 and 1 are wanted
    const n = slide(s, 'left')!;
    expect(n.cells[0]).toMatchObject({ v: 8, spoiled: true });
    expect(n.spoils).toBe(1);
    const m = slide({ ...n, cells: [n.cells[0], null, null, null, ...empty(11), t(1, 50)] }, 'up')!;
    expect(m.cells.some((x) => x?.spoiled)).toBe(false);
  });

  it('wins when every socket is filled', () => {
    const s = board({ z: 2, a: 4 }, [t(2, 1), t(2, 2), null, null, ...empty(12)]);
    expect(won(s)).toBe(false);
    const n = slide(s, 'left')!;
    expect(won(n)).toBe(true);
    expect(n.cells.filter(Boolean)).toHaveLength(0); // no deal after the win
  });

  it('reports a jam when no swipe changes anything', () => {
    const stuck: Tile[] = [];
    for (let i = 0; i < 16; i++) stuck.push(t(((i + Math.floor(i / 4)) % 2) ? 1 : 2, i + 1));
    expect(jammed(board(C12, stuck))).toBe(true);
  });

  it('deals the same tiles for the same seed', () => {
    const a = newMerge(C12, 42), b = newMerge(C12, 42);
    expect(a.cells.map((x) => x && x.v)).toEqual(b.cells.map((x) => x && x.v));
  });

  it('can be won by play for a spread of elements', () => {
    // Greedy play: prefer the swipe that merges most; a win within a few hundred swipes.
    for (const target of [{ z: 2, a: 4 }, { z: 3, a: 7 }, C12, { z: 26, a: 56 }]) {
      let s = newMerge(target, 7);
      let swipes = 0;
      while (!won(s) && swipes < 2000) {
        const options = (['left', 'up', 'right', 'down'] as const).map((d) => slide(s, d)).filter((x): x is MergeState => x !== null);
        if (!options.length) { s = newMerge(target, 7 + swipes); continue; }
        options.sort((a, b) => a.cells.filter(Boolean).length - b.cells.filter(Boolean).length);
        s = options[0];
        swipes++;
      }
      expect(won(s)).toBe(true);
    }
  });
});

/** Records every coordinate a rule demo draws. */
function demoPoints(draw: (ctx: CanvasRenderingContext2D) => void): [number, number][] {
  const pts: [number, number][] = [];
  const rec = (x: number, y: number) => pts.push([x, y]);
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'moveTo' || k === 'lineTo') return rec;
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'rect' || k === 'roundRect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  draw(ctx);
  return pts;
}

describe('rule cards', () => {
  it('have plain text and demos that stay in their box, and INSTRUCTIONS keeps only the game meta', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(5);
    for (const r of RULES) {
      expect(r.text).not.toMatch(/<|>/);
      for (const [w, h] of [[120, 96], [220, 160]]) for (let s = 0; s < 7; s += 0.1) {
        for (const [x, y] of demoPoints((ctx) => r.demo!(ctx, w, h, s))) {
          expect(x).toBeGreaterThanOrEqual(-1);
          expect(x).toBeLessThanOrEqual(w + 1);
          expect(y).toBeGreaterThanOrEqual(-1);
          expect(y).toBeLessThanOrEqual(h + 1);
        }
      }
    }
    expect(INSTRUCTIONS).toMatch(/<h3>In the game<\/h3>/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
  });
});
