import { describe, expect, it } from 'vitest';
import { ALPHA, fuse, jammed, NEUTRON, newMerge, overshoots, PROTON, slide, won, type MergeState, type Tile } from '../src/puzzles/merge';

const t = (z: number, a: number, id = 1): Tile => ({ z, a, id, spoiled: false });

function board(target: { z: number; a: number }, tiles: (Tile | null)[]): MergeState {
  const s = newMerge(target, 1);
  s.cells = tiles.map((x) => (x ? { ...x } : null));
  s.nextId = 100;
  return s;
}

describe('fusion rule', () => {
  it('fuses a proton and a neutron into deuterium, and two deuterons into an alpha', () => {
    expect(fuse(PROTON, NEUTRON)).toEqual({ z: 1, a: 2 });
    expect(fuse({ z: 1, a: 2 }, { z: 1, a: 2 })).toEqual(ALPHA);
  });

  it('refuses sums that are not real nuclides', () => {
    expect(fuse(PROTON, PROTON)).toBeNull(); // helium-2 does not exist
    expect(fuse(NEUTRON, NEUTRON)).toBeNull();
  });

  it('only lets a light nucleus do the slamming', () => {
    expect(fuse({ z: 3, a: 7 }, { z: 3, a: 7 })).toBeNull();
    expect(fuse({ z: 3, a: 6 }, PROTON)).toEqual({ z: 4, a: 7 });
    expect(fuse(ALPHA, ALPHA)).toEqual({ z: 4, a: 8 });
  });

  it('knows when a nucleus has gone past the target', () => {
    expect(overshoots({ z: 4, a: 8 }, { z: 3, a: 7 })).toBe(true);
    expect(overshoots({ z: 3, a: 8 }, { z: 3, a: 7 })).toBe(true);
    expect(overshoots({ z: 3, a: 6 }, { z: 3, a: 7 })).toBe(false);
  });
});

describe('sliding', () => {
  const Li7 = { z: 3, a: 7 };

  it('slides tiles to the wall and fuses the pair that meets', () => {
    const s = board(Li7, [t(1, 1, 1), null, t(0, 1, 2), null, ...Array(12).fill(null)]);
    const n = slide(s, 'right')!;
    expect(n).not.toBeNull();
    expect(n.cells[3]).toMatchObject({ z: 1, a: 2 });
    expect(n.moves).toBe(1);
    // One new tile dealt somewhere on the board.
    expect(n.cells.filter(Boolean)).toHaveLength(2);
  });

  it('is not a move when nothing can shift', () => {
    const s = board(Li7, [null, null, null, t(1, 1, 1), ...Array(12).fill(null)]);
    expect(slide(s, 'right')).toBeNull();
  });

  it('fuses each tile at most once per swipe', () => {
    // p n n in a row: p+n make D, but D must not then swallow the next n in the same swipe.
    const s = board(Li7, [t(1, 1, 1), t(0, 1, 2), t(0, 1, 3), null, ...Array(12).fill(null)]);
    const n = slide(s, 'left')!;
    expect(n.cells[0]).toMatchObject({ z: 1, a: 2 });
    expect(n.cells[1]).toMatchObject({ z: 0, a: 1 });
  });

  it('spoils a fusion that overshoots the target, then crumbles it next swipe', () => {
    const s = board({ z: 3, a: 7 }, [t(2, 4, 1), t(2, 4, 2), null, null, ...Array(12).fill(null)]);
    const n = slide(s, 'left')!;
    expect(n.cells[0]).toMatchObject({ z: 4, a: 8, spoiled: true });
    expect(n.spoils).toBe(1);
    const m = slide({ ...n, cells: [n.cells[0], null, null, null, null, null, null, null, null, null, null, null, null, null, null, t(1, 1, 50)] }, 'up')!;
    expect(m.cells.some((x) => x?.spoiled)).toBe(false);
  });

  it('wins when the target nucleus appears', () => {
    const s = board(Li7, [t(3, 6, 1), t(0, 1, 2), null, null, ...Array(12).fill(null)]);
    expect(won(s)).toBe(false);
    const n = slide(s, 'left')!;
    expect(won(n)).toBe(true);
  });

  it('reports a jam when no swipe changes anything', () => {
    const full: Tile[] = [];
    for (let i = 0; i < 16; i++) full.push(t(i % 2 ? 1 : 0, 1, i + 1));
    // Alternating p and n would fuse; make it alternating p and lithium-7 instead, which cannot.
    const stuck = full.map((x, i) => (i % 2 ? t(3, 7, x.id) : t(3, 7, x.id)));
    expect(jammed(board({ z: 10, a: 20 }, stuck))).toBe(true);
  });

  it('deals the same tiles for the same seed', () => {
    const a = newMerge(Li7, 42), b = newMerge(Li7, 42);
    expect(a.cells.map((x) => x && [x.z, x.a])).toEqual(b.cells.map((x) => x && [x.z, x.a]));
  });
});
