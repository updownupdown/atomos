import { describe, expect, it } from 'vitest';
import { cellX, cellY, deadCells, greedySolves, lastDeal, newPush, onSocket, placed, playPush, pushShape, solve, solved, step, stuckBoxes, walkTo, type PushState } from '../src/puzzles/push';
import { board, INSTRUCTIONS, PushView, RULES } from '../src/puzzles/pushView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DIALS = [1, 5, 12, 13, 20, 21, 30, 40, 41, 50, 60, 61, 74, 75, 80, 81, 90, 100];

const kb = (key: string) => ({ key, preventDefault() {} }) as unknown as KeyboardEvent;
const at = (s: PushState, x: number, y: number) => (y + 1) * s.w + x + 1;

describe('shape', () => {
  it('grows the chamber, the nucleons and par with the dial, in small steps', () => {
    let prev = pushShape(1);
    expect(prev.boxes).toBe(1);
    expect([prev.cols, prev.rows]).toEqual([4, 4]);
    for (let d = 2; d <= 100; d++) {
      const s = pushShape(d);
      expect(s.boxes).toBeGreaterThanOrEqual(prev.boxes);
      expect(s.cols * s.rows).toBeGreaterThanOrEqual(prev.cols * prev.rows);
      expect(s.par[0]).toBeGreaterThanOrEqual(prev.par[0]);
      expect(s.par[0] - prev.par[0]).toBeLessThanOrEqual(1);
      prev = s;
    }
    expect(prev.boxes).toBe(4);
    expect([prev.cols, prev.rows]).toEqual([7, 7]);
  });
});

describe('moves', () => {
  it('walks freely and pushes one nucleon a cell, counting only pushes', () => {
    const s = board(['@.p.+', '.....']);
    const a = step(s, 1)!;
    expect(a.player).toBe(at(s, 1, 0));
    expect(a.moves).toBe(0);
    const b = step(a, 1)!;
    expect(b.boxes[0]).toBe(at(s, 3, 0));
    expect(b.player).toBe(at(s, 2, 0));
    expect(b.moves).toBe(1);
    expect(solved(b)).toBe(false);
    const c = step(b, 1)!;
    expect(solved(c)).toBe(true);
    expect(placed(c)).toBe(1);
    expect(onSocket(c, 0)).toBe(true);
    // Into the wall: nothing moves.
    expect(step(c, 1)).toBeNull();
  });

  it('never pushes two in a row, and never pulls', () => {
    const s = board(['@pn..', '.....']);
    expect(step(s, 1)).toBeNull();
    const t = board(['.p@..', '.....']);
    const back = step(t, 1)!;
    expect(back.boxes[0]).toBe(t.boxes[0]);
    expect(back.moves).toBe(0);
  });

  it('only counts a proton on a proton socket', () => {
    const s = board(['@p.o', '....']);
    const end = step(step(s, 1)!, 1)!;
    expect(end.boxes[0]).toBe(end.goals[0]);
    expect(solved(end)).toBe(false);
    expect(placed(end)).toBe(0);
  });

  it('walks the shortest way round walls and nucleons', () => {
    const s = board(['@#..', '.p..', '....']);
    const path = walkTo(s, at(s, 2, 0))!;
    expect(path.length).toBe(6);
    expect(walkTo(s, at(s, 1, 1))).toBeNull();
    expect(walkTo(s, s.player)).toEqual([]);
  });

  it('knows dead squares and frozen nucleons', () => {
    const s = board(['@...', '.p..', '...+']);
    const dead = deadCells(s, 0);
    expect(dead).toContain(at(s, 0, 0));
    expect(dead).toContain(at(s, 3, 0));
    expect(dead).not.toContain(at(s, 3, 2));
    expect(dead).not.toContain(at(s, 1, 1));
    expect(stuckBoxes(s)).toEqual([]);
    expect(stuckBoxes(board(['p..@', '...+']))).toEqual([0]);
    // Two nucleons side by side against a wall freeze each other.
    const frozen = board(['pn..', '....', '..@.', '.+o.']);
    expect(stuckBoxes(frozen).sort()).toEqual([0, 1]);
  });
});

describe('solver', () => {
  it('finds the fewest pushes, walking free', () => {
    const s = board(['@.p.+', '.....']);
    expect(solve(s).moves!.length).toBe(2);
    // The proton has to go round: push it down, along, then up.
    const t = board(['....', '.@p#', '...+']);
    const r = solve(t);
    expect(r.moves!.length).toBe(2);
    expect(solve(board(['p..@', '...+']))).toMatchObject({ moves: null, proven: true });
  });

  it('plays a plan push by push to the solved chamber', () => {
    const s = newPush(50, 3);
    let cur = s;
    for (const m of solve(s).moves!) cur = playPush(cur, m)!.state;
    expect(solved(cur)).toBe(true);
    expect(cur.moves).toBe(s.par);
  });
});

describe('deals', () => {
  it('deals the same chamber for the same dial and seed', () => {
    for (const d of [1, 50, 100]) expect(newPush(d, 4)).toEqual(newPush(d, 4));
    expect(newPush(60, 1)).not.toEqual(newPush(60, 2));
  }, 30000);

  it('deals solvable chambers whose par the forward solver proves, across the dial', () => {
    for (const d of DIALS) for (const seed of [1, 2, 3]) {
      const s = newPush(d, seed);
      const shape = pushShape(d);
      expect(s.boxes.length, `d${d} s${seed}`).toBe(shape.boxes);
      expect(s.w - 2).toBe(shape.cols);
      expect(s.h - 2).toBe(shape.rows);
      expect(new Set(s.boxes).size).toBe(s.boxes.length);
      expect(new Set(s.goals).size).toBe(s.goals.length);
      expect([...s.kinds].sort()).toEqual([...s.goalKinds].sort());
      for (const b of s.boxes) expect(s.floor[b]).toBe(true);
      expect(s.floor[s.player]).toBe(true);
      expect(s.boxes).not.toContain(s.player);
      expect(solved(s)).toBe(false);
      expect(stuckBoxes(s)).toEqual([]);
      const r = solve(s, 400000);
      expect(r.moves?.length, `d${d} s${seed}`).toBe(s.par);
      expect(s.par).toBeGreaterThan(0);
    }
  }, 60000);

  it('keeps to the par wanted, and off the straight-at-it deals higher up', () => {
    let ok = 0, n = 0;
    for (const d of [10, 30, 50, 70, 90, 100]) for (let seed = 1; seed <= 6; seed++) {
      const s = newPush(d, seed);
      const [lo, hi] = pushShape(d).par;
      n++;
      if (lastDeal.ok) ok++;
      expect(s.par).toBeGreaterThanOrEqual(Math.min(lo, 4) - 0);
      expect(s.par).toBeLessThanOrEqual(hi);
      if (d >= 50 && lastDeal.ok) expect(greedySolves(s)).toBe(false);
    }
    expect(ok / n).toBeGreaterThan(0.8);
  }, 60000);

  it('deals quickly, even at the top of the dial', () => {
    // The search is capped by positions visited, not by the clock, so deals stay deterministic;
    // the cap keeps a deal at d 100 to a few hundred milliseconds on a phone.
    const cap = pushShape(100).budget;
    const t0 = performance.now();
    for (let seed = 1; seed <= 8; seed++) {
      newPush(100, seed);
      expect(lastDeal.nodes).toBeLessThanOrEqual(cap * 4 + 64);
    }
    expect((performance.now() - t0) / 8).toBeLessThan(1000);
  }, 60000);
});

/** The pixel at the middle of a chamber cell, from the view's last drawn geometry. */
function px(v: PushView, s: PushState, cell: number): { x: number; y: number } {
  const g = (v as unknown as { geo: { x: number; y: number; c: number } }).geo;
  return { x: g.x + (cellX(s, cell) - 0.5) * g.c, y: g.y + (cellY(s, cell) - 0.5) * g.c };
}

describe('view', () => {
  it('draws inside its area, and Show me plays a chamber through in par pushes', () => {
    for (const d of [1, 35, 60, 100]) {
      const v = new PushView(newPush(d, 2), true);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.hint()).toMatch(/nucleons? to place/);
      expect(v.help(1)!.moved).toBeUndefined();
      let guard = 0;
      while (!v.won && guard++ < 200) {
        expect(v.help(1)).not.toBeNull();
        expect(v.help(2)!.moved).toBe(true);
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.stats().progress.value).toMatch(/^(\d)\/\1$/);
      v.undo();
      expect(v.won).toBe(false);
      v.restart();
      expect(v.moves).toBe(0);
    }
  }, 30000);

  it('walks on a tap, pushes on a swipe or a tap beside the probe, and undoes pushes', () => {
    const s = board(['@....', '..p..', '....+']);
    const v = new PushView(s, true);
    v.draw(recCtx().ctx, { x: 0, y: 0, w: 400, h: 400 }, 0);
    // Tap the cell above the proton: the probe walks there, no move counted.
    const target = px(v, s, at(s, 2, 0));
    v.down(target); v.up(target);
    expect(v.moves).toBe(0);
    expect(v.canUndo()).toBe(false);
    // Tap the proton beside it: pushed down.
    const p = px(v, s, at(s, 2, 1));
    v.down(p); v.up(p);
    expect(v.moves).toBe(1);
    // Round to its left by the arrow keys (the wall below stops the last one), then swipe right twice.
    expect(v.key(kb('ArrowLeft'))).toBe(true);
    v.key(kb('ArrowDown'));
    v.key(kb('ArrowDown'));
    const start = { x: 100, y: 100 };
    v.down(start); v.up({ x: 160, y: 104 });
    expect(v.moves).toBe(2);
    v.down(start); v.up({ x: 160, y: 104 });
    expect(v.won).toBe(true);
    expect(v.undo()).toBe(true);
    expect(v.moves).toBe(2);
    expect(v.won).toBe(false);
  });

  it('flags a stuck nucleon and says how far to undo', () => {
    const s = board(['.....', '.p@..', '...+.']);
    const v = new PushView(s, true);
    v.key(kb('ArrowLeft'));
    expect(v.moves).toBe(1);
    expect(v.hint()).toMatch(/stuck/);
    expect(v.help(1)!.text).toBe('Undo your last move to get back on track.');
    const { ctx, colors } = recCtx();
    v.draw(ctx, { x: 0, y: 0, w: 300, h: 300 }, 0);
    expect(colors.size).toBeGreaterThan(0);
  });

  it('animates walks and pushes without drawing outside its area', () => {
    const v = new PushView(newPush(60, 5), false);
    const area = { x: 0, y: 0, w: 360, h: 420 };
    v.draw(recCtx().ctx, area, performance.now());
    for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) v.key(kb(key));
    v.help(2);
    const t0 = performance.now();
    for (let t = 0; t < 2000; t += 40) {
      const { ctx, pts } = recCtx();
      v.draw(ctx, area, t0 + t);
      expect(inside(pts, area)).toBe(true);
    }
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Push', 'Sockets', 'Corners']);
    expect(RULES.map((r) => r.title)).toEqual(['Walk', 'Push', 'Sockets', 'Corners']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  });
});
