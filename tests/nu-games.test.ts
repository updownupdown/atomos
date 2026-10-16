import { describe, expect, it } from 'vitest';
import { GAMES, nuPick, nuReads } from '../src/nu/games';

describe("Nu's park games", () => {
  it('has thirty games, each once, A to Z', () => {
    expect(GAMES).toHaveLength(30);
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(30);
    const names = GAMES.map((g) => g.label);
    expect(names).toEqual(names.slice().sort((a, b) => a.localeCompare(b)));
  });

  it('wants to read one day in three, an atom that is real, the same all day', () => {
    const days = Array.from({ length: 300 }, (_, i) => 20000 + i);
    const reads = days.map((d) => nuReads(d, 118));
    expect(reads.filter((z) => z !== null)).toHaveLength(100);
    for (const z of reads) if (z !== null) expect(z >= 1 && z <= 118).toBe(true);
    expect(nuReads(20001, 118)).toBe(nuReads(20001, 118));
    expect(GAMES).toContain(nuPick(20000));
  });
});
