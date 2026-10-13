import { describe, expect, it } from 'vitest';
import { allJumps, annihilShape, deadEnd, jump, jumpsFrom, newAnnihil, nextJump, pieceCount, randomOdds, Solver, solved, type AnnihilState, type Piece } from '../src/puzzles/annihil';
import { AnnihilView, INSTRUCTIONS, RULES } from '../src/puzzles/annihilView';
import { AREAS_ALL, checkRules, inside, recCtx } from './rulesCheck';

const DS = [1, 5, 12, 13, 25, 35, 36, 50, 65, 66, 80, 90, 100];

/** A board from rows: '#' no hole, '.' empty, 'm' particle, 'a' antiparticle. */
function board(rows: string[]): AnnihilState {
  const h = rows.length, w = rows[0].length;
  const mask: boolean[] = [], cells: Piece[] = [];
  for (const line of rows) for (const ch of line) { mask.push(ch !== '#'); cells.push(ch === 'm' ? 1 : ch === 'a' ? 2 : 0); }
  return { w, h, mask, cells, moves: 0, par: 0, last: null };
}

describe('jumps', () => {
  it('jumps only an opposite neighbor, straight, into an empty hole, and annihilates it', () => {
    const s = board(['ma.', 'a..', '.#.']);
    expect(jumpsFrom(s, 0).map((j) => j.to).sort()).toEqual([2, 6]);
    const t = jump(s, 0, 2)!;
    expect(t.cells).toEqual([0, 0, 1, 2, 0, 0, 0, 0, 0]);
    expect(t.moves).toBe(1);
    expect(t.last).toEqual({ from: 0, over: 1, to: 2 });
    // Like over like, diagonals, landing on a piece or off the board: never.
    expect(jump(board(['mm.']), 0, 2)).toBeNull();
    expect(jump(board(['m..', '.a.', '...']), 0, 8)).toBeNull();
    expect(jump(board(['mam']), 0, 2)).toBeNull();
    expect(jump(board(['ma#']), 0, 2)).toBeNull();
  });

  it('knows a dead end and a cleared board', () => {
    expect(deadEnd(board(['m.m']))).toBe(true);
    expect(deadEnd(board(['ma.']))).toBe(false);
    expect(solved(board(['..m']))).toBe(true);
  });

  it('solves forward and weighs the wrong turns', () => {
    const good = board(['ma.a.']);
    const sv = new Solver(good.w, good.h, good.mask);
    expect(sv.canClear(good.cells)).toBe(true);
    expect(sv.odds(good.cells)).toBe(1);
    const bad = board(['mama.']);
    expect(new Solver(bad.w, bad.h, bad.mask).canClear(bad.cells)).toBe(false);
    // Either first jump clears this one.
    const fork = board(['.am.', '....', '....']);
    expect(new Solver(fork.w, fork.h, fork.mask).odds(fork.cells)).toBe(1);
    // A dealt board holds some wrong turns.
    const dealt = newAnnihil(50, 1);
    const p = new Solver(dealt.w, dealt.h, dealt.mask).odds(dealt.cells)!;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(nextJump(good)).toEqual({ from: 0, over: 1, to: 2 });
  });
});

describe('deals', () => {
  it('grows the board and the pieces along the dial', () => {
    expect(annihilShape(1)).toMatchObject({ w: 4, h: 4, pieces: 4 });
    expect(annihilShape(100)).toMatchObject({ w: 7, h: 7, pieces: 15 });
    for (let d = 2; d <= 100; d++) {
      expect(annihilShape(d).pieces).toBeGreaterThanOrEqual(annihilShape(d - 1).pieces);
      expect(annihilShape(d).w).toBeGreaterThanOrEqual(annihilShape(d - 1).w);
    }
  });

  it('is the same deal for the same dial and seed', () => {
    for (const d of [1, 50, 100]) {
      const a = newAnnihil(d, 9), b = newAnnihil(d, 9);
      expect(a.cells).toEqual(b.cells);
      expect(a.mask).toEqual(b.mask);
    }
  });

  it('deals boards that clear to one piece, with par one fewer than the pieces', () => {
    for (const d of DS) for (let seed = 1; seed <= 5; seed++) {
      const s = newAnnihil(d, seed);
      const shape = annihilShape(d);
      expect(pieceCount(s)).toBe(shape.pieces);
      expect(s.par).toBe(shape.pieces - 1);
      s.cells.forEach((p, i) => { if (p) expect(s.mask[i]).toBe(true); });
      expect(new Solver(s.w, s.h, s.mask).canClear(s.cells)).toBe(true);
      expect(allJumps(s).length).toBeGreaterThan(0);
    }
  });

  it('deals boards with more dead ends up the dial', () => {
    const mean = (d: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 6; seed++) sum += randomOdds(newAnnihil(d, seed)) ?? 0;
      return sum / 6;
    };
    const lo = mean(5), mid = mean(50), hi = mean(90);
    expect(lo).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(hi);
  }, 30000);

  it('deals quickly, even at the top of the dial', () => {
    newAnnihil(100, 99);
    let worst = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const t0 = performance.now();
      newAnnihil(100, seed);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(400);
  }, 20000);
});

describe('view', () => {
  it('draws inside its area, also partway through a jump', () => {
    for (const d of [1, 50, 100]) {
      const v = new AnnihilView(newAnnihil(d, 2), false);
      for (const area of AREAS_ALL) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, area, 0);
        expect(inside(pts, area)).toBe(true);
      }
      expect(v.hint()).toMatch(/pieces left/);
      v.help(2);
      const t0 = performance.now();
      for (let ms = 0; ms < 500; ms += 23) {
        const { ctx, pts } = recCtx();
        v.draw(ctx, AREAS_ALL[0], t0 + ms);
        expect(inside(pts, AREAS_ALL[0])).toBe(true);
      }
    }
  });

  it('clears the board with Show me alone, in par jumps', () => {
    for (const d of [1, 30, 60, 100]) {
      const v = new AnnihilView(newAnnihil(d, 3), true);
      const h1 = v.help(1)!;
      expect(h1.moved).toBeUndefined();
      expect(h1.text).toMatch(/can jump next/);
      let guard = 0;
      while (!v.won && guard++ < 40) expect(v.help(2)!.moved).toBe(true);
      expect(v.won).toBe(true);
      expect(v.moves).toBe(v.par);
      expect(v.clean).toBe(true);
      expect(v.help(1)).toBeNull();
      expect(v.hint()).toBe('One piece left');
    }
  });

  it('jumps by tap then tap, and by drag; a piece pressed again is put down', () => {
    const v = new AnnihilView(board(['#..#', '.ma.', '#..#']), true);
    const { ctx } = recCtx();
    v.draw(ctx, { x: 0, y: 0, w: 400, h: 400 }, 0);
    const geo = v as unknown as { origin: { x: number; y: number }; cell: number };
    const at = (x: number, y: number) => ({ x: geo.origin.x + (x + 0.5) * geo.cell, y: geo.origin.y + (y + 0.5) * geo.cell });
    const tap = (p: { x: number; y: number }) => { v.down(p); v.up(p); };
    tap(at(1, 1));
    tap(at(1, 1));
    tap(at(3, 1));
    expect(v.moves).toBe(0);
    tap(at(1, 1));
    tap(at(3, 1));
    expect(v.moves).toBe(1);
    expect(v.won).toBe(true);
    v.undo();
    expect(v.moves).toBe(0);
    v.down(at(1, 1)); v.move(at(2, 1)); v.move(at(3, 1)); v.up(at(3, 1));
    expect(v.moves).toBe(1);
    v.restart();
    expect(v.moves).toBe(0);
    // A drag let go anywhere else puts the piece back.
    v.down(at(1, 1)); v.move(at(1, 0)); v.up(at(1, 0));
    expect(v.moves).toBe(0);
  });

  it('is stuck at a dead end, and the hint says how far to go back', () => {
    const v = new AnnihilView(board(['mama.']), true);
    expect(v.help(1)!.text).toMatch(/Restart/);
    // A dealt board, a jump that strands it, and the hint asks for one undo.
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      const s0 = newAnnihil(40, seed);
      const sv = new Solver(s0.w, s0.h, s0.mask);
      const wrong = allJumps(s0).find((j) => !sv.canClear(jump(s0, j.from, j.to)!.cells));
      if (!wrong) continue;
      found = true;
      const w = new AnnihilView(s0, true);
      (w as unknown as { go(f: number, t: number): boolean }).go(wrong.from, wrong.to);
      expect(w.help(1)!.text).toBe('Undo your last move to get back on track.');
      expect(w.help(2)!.moved).toBeUndefined();
    }
    expect(found).toBe(true);
  });

  it('has rule cards with pictures', () => {
    checkRules(RULES, ['Opposites', 'Straight lines', 'One left']);
    expect(RULES.map((r) => r.title)).toEqual(['Jump', 'Opposites', 'Straight lines', 'One left']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
  });
});
