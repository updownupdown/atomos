import { beforeEach, describe, expect, it } from 'vitest';
import { dailyFor, dailyPuzzle, dailyStreak, recordDaily } from '../src/puzzles/daily';
import { levelInGame } from '../src/puzzles/difficulty';
import { PUZZLES } from '../src/puzzles/catalog';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe('dailyFor', () => {
  it('picks the same board for a day on every call, and a playable game at a level it deals', () => {
    for (let i = 20000; i < 20060; i++) {
      const a = dailyFor(i, 'k');
      expect(dailyFor(i, 'k')).toEqual(a);
      const p = PUZZLES.find((g) => g.id === a.game)!;
      expect(p.makeAt).toBeTypeOf('function');
      const span = levelInGame(a.game, a.level)!;
      expect(a.dial).toBeGreaterThanOrEqual(span.lo);
      expect(a.dial).toBeLessThanOrEqual(span.hi);
    }
  });

  it('visits every playable game before any comes back, never the same game two days running', () => {
    const n = PUZZLES.filter((p) => p.make && p.makeAt).length;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(dailyFor(20000 + i, 'k').game);
    expect(seen.size).toBe(n);
    for (let i = 20000; i < 20100; i++) expect(dailyFor(i, 'k').game).not.toBe(dailyFor(i + 1, 'k').game);
  });

  it('aims at an easy Monday and a hard Sunday', () => {
    const mon = dailyPuzzle(at(2026, 10, 12));
    const sun = dailyPuzzle(at(2026, 10, 18));
    expect(levelInGame(mon.game, 1) ? mon.level : 1).toBe(1);
    expect(levelInGame(sun.game, 5) ? sun.level : 5).toBe(5);
  });
});

describe('streak', () => {
  it('counts days in a row, kept open through today until it is solved', () => {
    recordDaily('2026-10-13', false, at(2026, 10, 13));
    recordDaily('2026-10-14', true, at(2026, 10, 14));
    expect(dailyStreak(at(2026, 10, 15))).toMatchObject({ streak: 2, today: false });
    expect(recordDaily('2026-10-15', true, at(2026, 10, 15))).toBe(3);
    expect(dailyStreak(at(2026, 10, 15))).toMatchObject({ streak: 3, today: true, flawless: true, best: 3 });
  });

  it('breaks once a whole day goes by, and keeps the best', () => {
    recordDaily('2026-10-13', false, at(2026, 10, 13));
    recordDaily('2026-10-14', false, at(2026, 10, 14));
    expect(dailyStreak(at(2026, 10, 16))).toMatchObject({ streak: 0, best: 2 });
    recordDaily('2026-10-16', false, at(2026, 10, 16));
    expect(dailyStreak(at(2026, 10, 16))).toMatchObject({ streak: 1, best: 2 });
  });

  it('runs across a month end', () => {
    recordDaily('2026-09-30', false, at(2026, 9, 30));
    recordDaily('2026-10-01', false, at(2026, 10, 1));
    expect(dailyStreak(at(2026, 10, 1)).streak).toBe(2);
  });
});
