// A rough difficulty for each puzzle as dealt for an atom, on one 1 to 10 scale for all ten games
// (10 = an expert sliding-block level). The ranges come from the puzzle distribution study: each
// game's easiest board to its hardest, measured from the generators, rising with the element.

/** Each game's rating on its easiest and hardest boards, and the elements those are dealt for. */
const RANGE: Record<string, { lo: number; hi: number; from: number; to: number }> = {
  merge: { lo: 1, hi: 3, from: 2, to: 26 },
  orbitalGrid: { lo: 2, hi: 5, from: 1, to: 118 },
  sliding: { lo: 3, hi: 9, from: 27, to: 118 },
  packing: { lo: 2, hi: 7, from: 1, to: 118 },
  lines: { lo: 3, hi: 8, from: 1, to: 118 },
  slideStop: { lo: 3, hi: 7, from: 1, to: 118 },
  light: { lo: 2, hi: 8, from: 1, to: 118 },
  rutherford: { lo: 4, hi: 6, from: 1, to: 118 },
  codebreaker: { lo: 5, hi: 6, from: 1, to: 118 },
  colorCharge: { lo: 2, hi: 7, from: 1, to: 118 },
};

/** The rating, 1 to 10, of a game's board for element z. */
export function difficulty(game: string, z: number): number {
  const r = RANGE[game];
  if (!r) return 5;
  const t = Math.min(1, Math.max(0, (z - r.from) / Math.max(1, r.to - r.from)));
  return Math.round(r.lo + (r.hi - r.lo) * t);
}

/** A word for a rating. */
export function difficultyWord(rating: number): string {
  return rating <= 2 ? 'Very easy' : rating <= 4 ? 'Easy' : rating <= 6 ? 'Medium' : rating <= 8 ? 'Hard' : 'Expert';
}

/** A game's ratings on its easiest and hardest boards (5 for a game with no measured range). */
export function difficultyRange(game: string): { lo: number; hi: number } {
  const r = RANGE[game];
  return r ? { lo: r.lo, hi: r.hi } : { lo: 5, hi: 5 };
}

/** The five difficulty levels, two ratings each: 1 is Very easy, 5 is Expert. */
export const LEVELS = 5;

/** The level, 1 to 5, a rating falls in: how many pips of the gauge are lit. */
export function difficultyLevel(rating: number): number {
  return Math.min(LEVELS, Math.max(1, Math.ceil(rating / 2)));
}

/** The word for a level, 1 to 5. */
export function levelWord(level: number): string {
  return difficultyWord(level * 2);
}

/** The elements whose boards for this game are dealt at a level, within the game's range. */
export function elementsAtLevel(game: string, level: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let z = lo; z <= hi; z++) if (difficultyLevel(difficulty(game, z)) === level) out.push(z);
  return out;
}
