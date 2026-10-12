// The difficulty dial: one scale from 1 to 100 for every game, meaning the same felt difficulty
// in each. Players see it in five buckets, Very easy (1 to 20), Easy, Medium, Hard and Expert
// (81 to 100), as a word and five pips; the Puzzles screen shows the number too.
//
// Every board is dealt at a dial. An atom's own steps and its lasting isotopes are dealt at the
// atom's dial (atomDial), which climbs gently across the table from 5 to 75, so atoms never
// reach Expert. A fleeting isotope adds a little for a short half-life (fleetingDial). A game
// whose boards cannot reach that dial deals its nearest: its easiest or its hardest.
//
// How a game turns a dial into a board:
// - Native games (the newer ones) take the dial directly: their generators are built on it.
// - Ladder games (the first thirteen) were built on the element: their boards grow harder from
//   one element to another. The dial walks that ladder, so a dial in the game's span picks the
//   element whose board it deals (zForDial). Their spans come from the distribution study's
//   measured 1 to 10 ratings (rating r is dial 10r - 5), to be retuned one game at a time.
// - Bound games deal for the real element whatever the dial, and their dial is what that
//   element's board measures: Quanta's grid size is the atom's own orbitals, and Tokamak's
//   sockets are the nucleus's own mass number.

export const LEVELS = 5;
const WORDS = ['Very easy', 'Easy', 'Medium', 'Hard', 'Expert'];

export const DIAL_MIN = 1;
export const DIAL_MAX = 100;

/** How each game sits on the dial: the span its boards cover and, for a ladder game, the
 *  elements its easiest and hardest boards are dealt for. `bound` games deal for the real
 *  element whatever the dial. */
interface Span { lo: number; hi: number; from?: number; to?: number; bound?: boolean }

const SPAN: Record<string, Span> = {
  merge: { lo: 5, hi: 25, from: 2, to: 26, bound: true },
  orbitalGrid: { lo: 15, hi: 45, from: 1, to: 118, bound: true },
  sliding: { lo: 25, hi: 85, from: 27, to: 118 },
  packing: { lo: 15, hi: 65, from: 1, to: 118 },
  lines: { lo: 25, hi: 75, from: 1, to: 118 },
  slideStop: { lo: 25, hi: 65, from: 1, to: 118 },
  light: { lo: 15, hi: 75, from: 1, to: 118 },
  rutherford: { lo: 35, hi: 55, from: 1, to: 118 },
  codebreaker: { lo: 45, hi: 55, from: 1, to: 118 },
  colorCharge: { lo: 15, hi: 65, from: 1, to: 118 },
  bond: { lo: 15, hi: 65, from: 1, to: 118 },
  spin: { lo: 15, hi: 65, from: 1, to: 118 },
  fission: { lo: 15, hi: 55, from: 1, to: 118 },
};

/** Registers a native game's span (the catalog does, for games that deal from the dial). */
export function nativeSpan(game: string, lo = DIAL_MIN, hi = DIAL_MAX): void {
  SPAN[game] = { lo, hi };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The dial an atom's boards are dealt at: 5 for hydrogen, 24 for iron, 41 for xenon, 58 for
 *  radon, 75 for oganesson. */
export function atomDial(z: number): number {
  const t = (clamp(z, 1, 118) - 1) / 117;
  return Math.round(5 + 70 * Math.pow(t, 0.85));
}

/** The atom whose boards are dealt nearest a dial (oganesson for anything past 75). */
export function atomForDial(d: number): number {
  let best = 1;
  for (let z = 1; z <= 118; z++) if (Math.abs(atomDial(z) - d) < Math.abs(atomDial(best) - d)) best = z;
  return best;
}

/** One dial point for every factor of ten a half-life falls short of a year, 16 at most;
 *  unmeasured half-lives count as a microsecond. */
export function halfLifeBump(halfLife: number | null): number {
  const YEAR = 3.156e7;
  const t = halfLife ?? 1e-6;
  return clamp(Math.round(Math.log10(YEAR / Math.max(t, 1e-30))), 0, 16);
}

/** The dial a fleeting isotope of element z is dealt at. */
export function fleetingDial(z: number, halfLife: number | null): number {
  return Math.min(DIAL_MAX, atomDial(z) + halfLifeBump(halfLife));
}

/** The dial a game deals a fleeting isotope of element z at (a bound game: its atom's board). */
export function fleetingDialFor(game: string, z: number, halfLife: number | null): number {
  return SPAN[game]?.bound ? difficulty(game, z) : dialFor(game, fleetingDial(z, halfLife));
}

/** The dial span a game's boards cover. */
export function difficultyRange(game: string): { lo: number; hi: number } {
  const s = SPAN[game];
  return s ? { lo: s.lo, hi: s.hi } : { lo: 41, hi: 60 };
}

/** A dial brought into a game's span: what it actually deals for that dial. */
export function dialFor(game: string, d: number): number {
  const { lo, hi } = difficultyRange(game);
  return clamp(Math.round(d), lo, hi);
}

/** The dial a game's board for atom z is dealt at (and so shown at). */
export function difficulty(game: string, z: number): number {
  const s = SPAN[game];
  if (s?.bound) return dialOnLadder(s, z);
  return dialFor(game, atomDial(z));
}

/** Where element z's board sits on a ladder game's span. */
function dialOnLadder(s: Span, z: number): number {
  const from = s.from ?? 1, to = s.to ?? 118;
  const t = clamp((z - from) / Math.max(1, to - from), 0, 1);
  return Math.round(s.lo + (s.hi - s.lo) * t);
}

/** The element whose board a ladder game deals for a dial, or `z` itself for a native or bound
 *  game. */
export function zForDial(game: string, d: number, z: number): number {
  const s = SPAN[game];
  if (!s || s.bound || s.from === undefined || s.to === undefined) return z;
  const t = s.hi > s.lo ? clamp((d - s.lo) / (s.hi - s.lo), 0, 1) : 0;
  return Math.round(s.from + (s.to - s.from) * t);
}

/** The element the Puzzles screen deals a dial for: for a bound game, the element whose board
 *  measures that dial; for any other, the atom dealt nearest it. */
export function elementForDial(game: string, d: number): number {
  const s = SPAN[game];
  if (s?.bound && s.from !== undefined && s.to !== undefined) {
    const t = s.hi > s.lo ? clamp((d - s.lo) / (s.hi - s.lo), 0, 1) : 0;
    return Math.round(s.from + (s.to - s.from) * t);
  }
  return atomForDial(d);
}

/** True for a game whose boards come straight from the dial. */
export function isNative(game: string): boolean {
  const s = SPAN[game];
  return Boolean(s && s.from === undefined && !s.bound);
}

/** The bucket, 1 (Very easy) to 5 (Expert), a dial falls in: how many pips are lit. */
export function difficultyLevel(d: number): number {
  return clamp(Math.ceil(d / 20), 1, LEVELS);
}

/** The word for a bucket, 1 to 5. */
export function levelWord(level: number): string {
  return WORDS[clamp(level, 1, LEVELS) - 1];
}

/** The word for a dial. */
export function difficultyWord(d: number): string {
  return levelWord(difficultyLevel(d));
}

/** The dials a bucket covers. */
export function levelSpan(level: number): { lo: number; hi: number } {
  return { lo: (level - 1) * 20 + 1, hi: level * 20 };
}

/** The dials of a bucket a game can deal, or null when its span misses the bucket. */
export function levelInGame(game: string, level: number): { lo: number; hi: number } | null {
  const b = levelSpan(level), g = difficultyRange(game);
  const lo = Math.max(b.lo, g.lo), hi = Math.min(b.hi, g.hi);
  return lo <= hi ? { lo, hi } : null;
}

/** Before the dial: an element's spot on a 1 to 100 line. Kept for games written against it. */
export const zDial = (z: number): number => Math.round(1 + (99 * (clamp(z, 1, 118) - 1)) / 117);
