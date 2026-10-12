import { describe, expect, it } from 'vitest';
import { element } from '../src/core/elements';
import {
  bestSwipe, captureMix, captureShape, clusterUnit, inReach, jammed, joined, mergeShape, newCapture, newMerge, slide, socketsFor, spawnMix,
  wanted, won, type MergeState, type Tile,
} from '../src/puzzles/merge';
import { CAPTURE_INSTRUCTIONS, CAPTURE_RULES, INSTRUCTIONS, MergeView, RULES } from '../src/puzzles/mergeView';
import { mergeLevel } from '../src/puzzles/levels';
import { puzzleType } from '../src/puzzles/catalog';
import { GAME_NAMES } from '../src/core/next';
import { checkRules, inside } from './rulesCheck';
import { C } from '../src/puzzles/palette';
import type { RuleCard } from '../src/puzzles/view';

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

describe('hints', () => {
  const ZS = [2, 3, 6, 8, 13, 20, 26, 30, 47, 56, 79, 92, 118];
  const deal = (z: number, seed: number) => newMerge({ z, a: element(z).commonA }, seed * 977 + z);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stateOf = (v: MergeView): MergeState => (v as any).state;
  const press = (v: MergeView, key: string) => v.key({ key } as KeyboardEvent);
  /** One short plain sentence: a capital, a full stop, no markup or dashes. */
  const plain = (text: string) => {
    expect(text).toMatch(/^[A-Z][^<>—–]*\.$/);
    expect(text).not.toMatch(/\. /);
    expect(text.length).toBeLessThanOrEqual(80);
  };

  it('Look here rings clusters and leaves the board and the count alone', () => {
    for (const z of ZS) for (const seed of [1, 2, 3]) {
      const v = new MergeView(deal(z, seed), true);
      // On the fresh deal, and a few swipes in when the nucleus is not finished by then.
      for (let k = 0; k < 3 && !v.won; k++, v.help(2)) {
        const before = stateOf(v), cells = JSON.stringify(before.cells), moves = v.moves;
        const h = v.help(1)!;
        plain(h.text);
        expect(h.moved).toBeUndefined();
        expect(stateOf(v)).toBe(before);
        expect(JSON.stringify(stateOf(v).cells)).toBe(cells);
        expect(v.moves).toBe(moves);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mark = (v as any).mark;
        expect(mark.state).toBe(before);
        for (const i of mark.cells) expect(before.cells[i]).not.toBeNull();
      }
    }
  });

  it('Show me plays one swipe at a time and finishes the nucleus within a few times par', () => {
    for (const z of ZS) for (const seed of [1, 2, 3]) {
      const v = new MergeView(deal(z, seed), true);
      const limit = v.par! * 3 + 10;
      let calls = 0;
      while (!v.won && calls < limit) {
        const moves = v.moves;
        const h = v.help(2)!;
        plain(h.text);
        expect(h.moved).toBe(true);
        expect(v.moves).toBe(moves + 1);
        expect(v.canUndo()).toBe(true);
        calls++;
      }
      expect(v.won, `z ${z} seed ${seed}`).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.help(2)).toBeNull();
    }
  });

  it('marks the merge the best swipe makes, and undo clears the mark', () => {
    const s = board(C12, [t(4, 1), null, t(4, 2), null, ...empty(12)]);
    const v = new MergeView(s, true);
    expect(v.help(1)!.text).toBe('These two 4s can merge into the 8 the nucleus wants.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect([...(v as any).mark.cells].sort()).toEqual([0, 2]);
    expect(v.help(2)!.text).toMatch(/^Swiped (left|right), and an 8 flew into the nucleus\.$/);
    expect(v.moves).toBe(1);
    v.undo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((v as any).mark).toBeNull();
  });

  it('draws the Look here rings and the Show me arrow inside the area', () => {
    const area = { x: 0, y: 0, w: 360, h: 520 };
    const v = new MergeView(deal(26, 1), false);
    const drawn = () => record((ctx) => v.draw(ctx, area, performance.now())).pts;
    const plainBoard = drawn().length;
    for (const level of [1, 2] as const) {
      v.help(level);
      const pts = drawn();
      // The rings (level 1) or the arrow (level 2) add to the picture, and stay in the area.
      expect(pts.length).toBeGreaterThan(plainBoard);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(area.x - 0.5);
        expect(x).toBeLessThanOrEqual(area.x + area.w + 0.5);
        expect(y).toBeGreaterThanOrEqual(area.y - 0.5);
        expect(y).toBeLessThanOrEqual(area.y + area.h + 0.5);
      }
    }
  });

  it('counts back to the last board that can still be finished when a line of play jams', () => {
    // A full board with no equal neighbors bar one gap. Swiping down leaves it unable to escape a jam
    // (the board deals from its seed, so this is certain); swiping left then jams it outright.
    const s = newMerge({ z: 26, a: 56 }, 1706);
    s.cells = [4, 2, 1, 4, 0, 4, 2, 1, 4, 2, 1, 2, 1, 4, 2, 4].map((x, i) => (x ? t(x, i + 1) : null));
    s.nextId = 100;
    expect(inReach(s)).toBe(true);
    const v = new MergeView(s, true);
    expect(press(v, 'ArrowDown')).toBe(true);
    expect(inReach(stateOf(v))).toBe(false);
    expect(v.help(1)).toEqual({ text: 'Undo your last move to get back on track.' });
    press(v, 'ArrowLeft');
    expect(v.moves).toBe(2);
    expect(v.stuck).toBe(true);
    const before = stateOf(v);
    expect(v.help(1)).toEqual({ text: 'Undo 2 moves to get back on track.' });
    // Show me says so too, and does not undo for the player.
    expect(v.help(2)).toEqual({ text: 'Undo 2 moves to get back on track.' });
    expect(stateOf(v)).toBe(before);
    expect(v.moves).toBe(2);
    v.undo();
    expect(v.help(2)).toEqual({ text: 'Undo your last move to get back on track.' });
    v.undo();
    // Back on track: the hint now picks a swipe that keeps the nucleus in reach.
    expect(v.help(1)!.text).not.toMatch(/Undo/);
    const d = bestSwipe(stateOf(v))!;
    expect(d).not.toBe('down');
    expect(inReach(slide(stateOf(v), d)!)).toBe(true);
    expect(v.help(2)!.moved).toBe(true);
  });

  it('answers well within 200 ms on every element', () => {
    let worst = 0;
    const time = (f: () => void) => { const t0 = performance.now(); f(); worst = Math.max(worst, performance.now() - t0); };
    for (let z = 2; z <= 118; z += 4) {
      const v = new MergeView(deal(z, 5), true);
      while (!v.won && v.moves < 200) {
        time(() => v.help(1));
        time(() => v.help(2));
      }
    }
    expect(worst).toBeLessThan(150);
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
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
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
    expect(RULES.map((r) => r.title)).toEqual(['Swipe', 'Merge', 'Clusters', 'The nucleus', 'Into the nucleus', 'Cracks', 'Tungsten blocks', 'Jammed']);
    checkPictures(RULES);
    for (const r of RULES) expect(r.good, r.title).toBeDefined();
  });

  it('shows the mistake beside the right move where there is one to make', () => {
    expect(RULES.filter((r) => r.bad).map((r) => r.title)).toEqual(['Merge', 'Into the nucleus', 'Cracks', 'Tungsten blocks', 'Jammed']);
    // The mistake is flagged in amber (the board's own crack is amber too).
    for (const r of RULES.filter((x) => x.bad)) {
      const { colors } = record((ctx) => r.bad!.draw(ctx, 140, 104, r.bad!.duration));
      expect(colors.has(C.warn), r.title).toBe(true);
      expect(colors.has(C.bad), r.title).toBe(false);
    }
    // The right move's still flags nothing.
    for (const r of RULES) expect(record((ctx) => r.good!.draw(ctx, 140, 104, r.good!.duration)).colors.has(C.warn), r.title).toBe(false);
  });

  it('keeps only the game meta in INSTRUCTIONS', () => {
    expect(INSTRUCTIONS).toMatch(/<h3>In the game<\/h3>/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
  });
});

// ---- harder boards: climb, tungsten blocks, par as a budget, jams lost ------------------------------

describe('harder boards', () => {
  const real = (z: number, seed: number) => newMerge({ z, a: element(z).commonA }, seed);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stateOf = (v: MergeView): MergeState => (v as any).state;

  it('shapes the board by period', () => {
    expect(mergeShape(18)).toMatchObject({ climb: 32, walls: 0, budget: false });
    expect(mergeShape(19)).toMatchObject({ climb: 64, walls: 0, budget: true });
    expect(mergeShape(37)).toMatchObject({ climb: 64, walls: 1, inner: 1 });
    expect(mergeShape(55)).toMatchObject({ climb: 128, walls: 1, inner: 1 });
    expect(mergeShape(87)).toMatchObject({ climb: 128, walls: 2, inner: 0 });
    // The climb caps the biggest socket over the smallest dealt cluster; labels stay true.
    expect(clusterUnit(238, 128)).toBe(1);
    expect(clusterUnit(131, 64)).toBe(2);
    expect(spawnMix({ z: 54, a: 131 }, 64).kinds).toEqual([2, 4, 8]);
  });

  it('places tungsten blocks by seed, where the greedy player still wins', () => {
    for (const z of [37, 50, 79, 92, 118]) for (const seed of [1, 2, 3, 4]) {
      const s = real(z, seed);
      const again = real(z, seed);
      expect(again.walls).toEqual(s.walls);
      expect(again.cells.map((t) => t?.v ?? 0)).toEqual(s.cells.map((t) => t?.v ?? 0));
      const shape = mergeShape(z);
      expect(s.walls.length).toBeLessThanOrEqual(shape.walls);
      for (const w of s.walls) expect(s.cells[w]).toBeNull();
      // Two blocks never share a row or a column; an inner block sits in the middle four.
      if (s.walls.length === 2) {
        const [a, b] = s.walls;
        expect(a % 4).not.toBe(b % 4);
        expect(Math.floor(a / 4)).not.toBe(Math.floor(b / 4));
      }
      if (shape.inner && s.walls.length === 1) expect([5, 6, 9, 10]).toContain(s.walls[0]);
      // The plan is a winning line: replaying it finishes the nucleus, within par.
      let p: MergeState = s;
      for (const d of s.plan!.dirs) p = slide(p, d)!;
      expect(won(p)).toBe(true);
      expect(s.plan!.dirs.length).toBeLessThan(s.par);
    }
    // Most heavy deals keep every block their period asks for.
    let kept = 0;
    for (let seed = 1; seed <= 12; seed++) if (real(100, seed).walls.length === 2) kept++;
    expect(kept).toBeGreaterThanOrEqual(10);
  });

  it('stops tiles against a block and never merges through one', () => {
    const s = board(C12, [t(1, 1), null, null, t(2, 2), ...empty(12)]);
    s.walls = [1];
    const n = slide(s, 'left')!;
    expect(n.cells[0]).toMatchObject({ v: 1 });
    expect(n.cells[1]).toBeNull();
    expect(n.cells[2]).toMatchObject({ v: 2 });
    const m = board(C12, [t(2, 1), null, null, t(2, 2), ...empty(12)]);
    m.walls = [1];
    const k = slide(m, 'left')!;
    expect(k.cells[0]).toMatchObject({ v: 2 });
    expect(k.cells[2]).toMatchObject({ v: 2 });
    // Nothing is ever dealt onto a block.
    let q = real(60, 3);
    for (let i = 0; i < 40 && !won(q); i++) {
      q = slide(q, (['left', 'up', 'right', 'down'] as const)[i % 4]) ?? slide(q, 'down') ?? q;
      for (const w of q.walls) expect(q.cells[w]).toBeNull();
    }
  });

  it('loses a jammed board, and undo steps back from it', () => {
    const stuck: Tile[] = [];
    for (let i = 0; i < 16; i++) stuck.push(t(((i + Math.floor(i / 4)) % 2) ? 1 : 2, i + 1));
    const v = new MergeView(board(C12, stuck), true);
    expect(v.failed).toBe(true);
    expect(v.loss).toEqual({ headline: 'Jammed', undo: true });
    expect(v.hint()).toBe('Jammed, undo or restart');
    const w = new MergeView(board(C12, [t(1, 1), null, null, null, ...empty(12)]), true);
    expect(w.failed).toBe(false);
  });

  it('costs the star past par', () => {
    const s = board({ z: 2, a: 4 }, [t(2, 1), t(2, 2), null, null, ...empty(12)]);
    const v = new MergeView(s, true);
    v.key({ key: 'ArrowLeft' } as KeyboardEvent);
    expect(v.won).toBe(true);
    expect(v.clean).toBe(true);
    const over = new MergeView({ ...s, par: 0 }, true);
    over.key({ key: 'ArrowLeft' } as KeyboardEvent);
    expect(over.won).toBe(true);
    expect(over.clean).toBe(false);
  });

  it('Show me follows the vetted line and wins within par on walled boards', () => {
    for (const z of [40, 79, 92, 118]) {
      const v = new MergeView(real(z, 5), true);
      const plan = stateOf(v).plan!;
      while (!v.won && v.moves < 600) expect(v.help(2)!.moved).toBe(true);
      expect(v.won).toBe(true);
      expect(v.moves).toBe(plan.dirs.length);
      expect(v.clean).toBe(true);
    }
  });

  it('keeps every build seed working and deals fast', () => {
    let worst = 0;
    for (let z = 1; z <= 118; z += 3) {
      const t0 = performance.now();
      const s = mergeLevel(z);
      worst = Math.max(worst, performance.now() - t0);
      expect(s.target.z).toBe(z);
      expect(s.cells.filter(Boolean).length).toBe(3);
    }
    expect(worst).toBeLessThan(600);
  });

  it('draws the blocks inside the area', () => {
    const area = { x: 0, y: 0, w: 360, h: 520 };
    const v = new MergeView(real(92, 2), false);
    expect(stateOf(v).walls.length).toBeGreaterThan(0);
    // record() (below) also measures text, which the goal row needs.
    expect(inside(record((ctx) => v.draw(ctx, area, performance.now())).pts, area)).toBe(true);
  });
});

// ---- capture mode ---------------------------------------------------------------------------------

describe('capture mode', () => {
  const U = { z: 92, a: 238 };
  const capture = (target: { z: number; a: number }, tiles: (Tile | null)[]) => {
    const s = newCapture(target, 1);
    s.cells = tiles.map((x) => (x ? { ...x } : null));
    s.nextId = 100;
    return s;
  };
  const plain = (text: string) => {
    expect(text).toMatch(/^[A-Z][^<>—–]*\.$/);
    expect(text).not.toMatch(/\. /);
    expect(text.length).toBeLessThanOrEqual(80);
  };

  it('splits the mass number into seeds, doublings and a few neutrons', () => {
    for (let a = 56; a <= 300; a++) {
      const c = captureShape(a);
      expect(c.seed * 2 ** c.levels + c.neutrons).toBe(a);
      expect(c.neutrons).toBeLessThanOrEqual(6);
      expect(c.levels).toBeGreaterThanOrEqual(2);
    }
    expect(captureShape(238)).toEqual({ seed: 29, levels: 3, neutrons: 6 });
    expect(captureShape(295)).toEqual({ seed: 73, levels: 2, neutrons: 3 });
    expect(captureShape(132)).toEqual({ seed: 8, levels: 4, neutrons: 4 });
    expect(captureMix(238).kinds).toEqual([1, 29, 58]);
  });

  it('doubles equal clusters and captures a lone neutron into a cluster of 8 or more', () => {
    expect(joined('capture', 27, 27)).toBe(54);
    expect(joined('capture', 27, 28)).toBe(0);
    expect(joined('capture', 1, 8)).toBe(9);
    expect(joined('capture', 29, 1)).toBe(30);
    expect(joined('capture', 1, 7)).toBe(0);
    expect(joined('capture', 1, 1)).toBe(0);
    expect(joined('sockets', 1, 1)).toBe(2);
    expect(joined('sockets', 1, 8)).toBe(0);
    const s = capture(U, [t(29, 1), null, null, t(1, 2), ...empty(12)]);
    const n = slide(s, 'left')!;
    expect(n.cells[0]).toMatchObject({ v: 30 });
    // Two neutrons slide together and stay two.
    const m = slide(capture(U, [t(1, 1), t(1, 2), null, null, ...empty(12)]), 'right')!;
    expect(m.cells[2]).toMatchObject({ v: 1 });
    expect(m.cells[3]).toMatchObject({ v: 1 });
  });

  it('wins on exactly the mass number and spoils an overshoot', () => {
    const fe = { z: 26, a: 56 };
    const w = slide(capture(fe, [t(28, 1), t(28, 2), null, null, ...empty(12)]), 'left')!;
    expect(won(w)).toBe(true);
    const o = slide(capture(fe, [t(29, 1), t(29, 2), null, null, ...empty(12)]), 'left')!;
    expect(won(o)).toBe(false);
    expect(o.cells[0]).toMatchObject({ v: 58, spoiled: true });
    expect(o.spoils).toBe(1);
  });

  it('says capture mode in the status line, and shows the biggest cluster', () => {
    const v = new MergeView(newCapture(U, 3), true);
    expect(v.hint()).toBe('Capture mode: build exactly 238');
    expect(v.stats().progress.label).toBe('Capture');
    expect(v.stats().progress.value).toMatch(/^\d+\/238$/);
    const stuck: Tile[] = [];
    for (let i = 0; i < 16; i++) stuck.push(t(((i + Math.floor(i / 4)) % 2) ? 3 : 5, i + 1));
    expect(new MergeView(capture(U, stuck), true).hint()).toBe('Capture mode: jammed, undo or restart');
  });

  it('Show me finishes capture boards, and Look here explains in plain lines', () => {
    for (const z of [27, 47, 79, 92, 118]) for (const seed of [1, 2]) {
      const v = new MergeView(newCapture({ z, a: element(z).commonA }, seed), true);
      for (let k = 0; k < 400 && !v.won; k++) {
        if (k % 5 === 0) plain(v.help(1)!.text);
        const h = v.help(2)!;
        plain(h.text);
        expect(h.moved).toBe(true);
      }
      expect(v.won, `z ${z} seed ${seed}`).toBe(true);
      expect(v.moves).toBeLessThanOrEqual(v.par!);
    }
  });

  it('deals the same board for a seed, fast', () => {
    let worst = 0;
    for (let z = 27; z <= 118; z += 7) {
      const t0 = performance.now();
      const a = newCapture({ z, a: element(z).commonA }, z);
      worst = Math.max(worst, performance.now() - t0);
      const b = newCapture({ z, a: element(z).commonA }, z);
      expect(a.cells.map((x) => x?.v ?? 0)).toEqual(b.cells.map((x) => x?.v ?? 0));
      expect(a.plan).not.toBeNull();
    }
    // Typically well under 100 ms; the margin is for a busy test machine.
    expect(worst).toBeLessThan(500);
  });

  it('has rule cards that follow the house rules', () => {
    checkRules(CAPTURE_RULES, ['Doubling', 'Neutron capture', 'Exactly']);
    expect(CAPTURE_INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
  });

  it('is in the catalog as Capture, dealt in capture mode', () => {
    const type = puzzleType('capture');
    expect(type.name).toBe('Capture');
    expect(type.tier).toBe('reserve');
    expect(GAME_NAMES.capture).toBe('Capture');
    const v = type.make!(92, 0, true);
    expect(v.hint()).toBe('Capture mode: build exactly 238');
    const area = { x: 0, y: 0, w: 360, h: 520 };
    expect(inside(record((ctx) => v.draw(ctx, area, performance.now())).pts, area)).toBe(true);
  });
});
