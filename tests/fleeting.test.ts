import { describe, expect, it } from 'vitest';
import { FLEETING_GAMES, ISOTOPE_GAMES_LIST, fleetingIsotopes } from '../src/core/progress';
import { PUZZLES, puzzleType } from '../src/puzzles/catalog';
import { fleetingDialFor } from '../src/puzzles/difficulty';
import { newCapture } from '../src/puzzles/merge';

describe('fleeting isotope games', () => {
  it('offers every game that deals boards, but Quanta and Glyph', () => {
    const dealing = PUZZLES.filter((p) => p.dealAt).map((p) => p.id).filter((id) => id !== 'orbitalGrid' && id !== 'codebreaker');
    expect([...FLEETING_GAMES].sort()).toEqual(dealing.sort());
    for (const g of ISOTOPE_GAMES_LIST) expect(FLEETING_GAMES).toContain(g);
    for (const g of FLEETING_GAMES) expect(g).not.toContain('-');
  });

  it('deals a board in every Puzzles-screen game at every dial a fleeting isotope asks for', () => {
    const extra = FLEETING_GAMES.filter((g) => !(ISOTOPE_GAMES_LIST as readonly string[]).includes(g) && g !== 'capture');
    for (const g of extra) {
      const t = puzzleType(g);
      const seen = new Set<number>();
      for (let z = 1; z <= 118; z++) {
        for (const i of fleetingIsotopes(z)) {
          const d = fleetingDialFor(g, z, i.halfLife);
          if (seen.has(d)) continue;
          seen.add(d);
          expect(() => t.dealAt!(d, 7, true, z, i.a), `${g} at ${d}`).not.toThrow();
        }
      }
    }
  }, 120_000);

  it('deals Kiln for the lightest and heaviest fleeting isotope of every atom past iron', () => {
    for (let z = 27; z <= 118; z++) {
      const all = fleetingIsotopes(z);
      for (const i of new Set([all[0], all[all.length - 1]].filter(Boolean))) {
        const s = newCapture({ z, a: i.a }, 7);
        expect(s.cells.length, `${z}-${i.a}`).toBeGreaterThan(0);
      }
    }
  }, 120_000);
});
