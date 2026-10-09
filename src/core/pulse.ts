// Pulse: a beat that never stops. Tap n beats in a row and the electron goes to level n.
//
// Level n holds n whole waves in de Broglie's picture (see physics.ts), so counting n beats
// is counting n crests. The beat is a steady grid; the phrase ends on the first beat the
// player leaves silent. Nothing here depends on reflexes: the beat is predictable, and the
// timing window is a generous fraction of each beat.

/** How far from a beat, as a fraction of the beat, a tap still counts as on it. */
export const WINDOW = 0.28;

export const TEMPOS = { slow: 800, medium: 640, brisk: 500 } as const;
export type Tempo = keyof typeof TEMPOS;

/** Which beat a tap is nearest to, counting from the grid's phase. */
export function nearestBeat(t: number, period: number, phase: number): number {
  return Math.round((t - phase) / period);
}

/** Signed distance from a tap to its nearest beat, as a fraction of the beat, in [-0.5, 0.5]. */
export function beatOffset(t: number, period: number, phase: number): number {
  const b = (t - phase) / period;
  return b - Math.round(b);
}

/** When a phrase closes if no more taps arrive: the beat after the last tap, plus its window. */
export function phraseCloses(lastTap: number, period: number, phase: number): number {
  return phase + (nearestBeat(lastTap, period, phase) + 1 + WINDOW) * period;
}

export type PhraseVerdict =
  | { kind: 'level'; n: number; precision: number }
  /** A tap landed outside the window round its beat, or two taps hit one beat. */
  | { kind: 'off'; n: number; worst: number }
  | { kind: 'low'; n: number; lowest: number }
  | { kind: 'free'; n: number; highest: number };

/** Judge a finished phrase of taps against the beat grid. */
export function judgePhrase(taps: number[], period: number, phase: number, levels: number[]): PhraseVerdict {
  const n = taps.length;
  const lowest = levels[0], highest = levels[levels.length - 1];
  if (n > highest) return { kind: 'free', n, highest };
  let worst = 0;
  const beats = new Set<number>();
  for (const t of taps) {
    worst = Math.max(worst, Math.abs(beatOffset(t, period, phase)));
    beats.add(nearestBeat(t, period, phase));
  }
  if (beats.size < n) return { kind: 'off', n, worst: 0.5 };
  if (worst > WINDOW) return { kind: 'off', n, worst };
  if (n < lowest) return { kind: 'low', n, lowest };
  return { kind: 'level', n, precision: 1 - worst / WINDOW };
}
