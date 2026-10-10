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
