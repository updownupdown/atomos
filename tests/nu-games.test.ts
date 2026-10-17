import { describe, expect, it } from 'vitest';
import { GAMES, nuPick } from '../src/nu/games';
import { PAR, points } from '../src/nu/points';
import { pickSix } from '../src/nu/roulette';

describe("Nu's park games", () => {
  it('has forty-eight games, each once, A to Z', () => {
    expect(GAMES).toHaveLength(49);
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(49);
    const names = GAMES.map((g) => g.label);
    expect(names).toEqual(names.slice().sort((a, b) => a.localeCompare(b)));
  });

  it('fancies one of the games each day', () => {
    expect(GAMES).toContain(nuPick(20000));
  });

  it('scores every game on one scale: a par run is 10 points, with one decimal', () => {
    for (const g of GAMES) {
      expect(PAR[g.id]).toBeGreaterThan(0);
      expect(points(g.id, PAR[g.id])).toBe(10);
    }
    expect(points('orbit', 18)).toBe(15);
    expect(points('orbit', 0)).toBe(0);
    // Pairs counts turns for each pair: fewer is better.
    expect(points('pairs', PAR.pairs / 2)).toBe(20);
  });

  it('picks six different games for a roulette', () => {
    for (let k = 0; k < 20; k++) {
      const six = pickSix();
      expect(six).toHaveLength(6);
      expect(new Set(six).size).toBe(6);
    }
  });
});
