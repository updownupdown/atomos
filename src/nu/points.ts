// Points for Nu's park games: one scale for every game, so a roulette of six (roulette.ts) comes
// out roughly even whichever six it picks. Each game counts in its own way (photons caught,
// levels, height, turns); its par is about what a fair run reaches, before it ends or the
// roulette's time runs out, and a par run is worth 10 points. Points have one decimal.

import type { GameId } from './games';

/** About what a fair run reaches, in the game's own count. */
export const PAR: Record<GameId, number> = {
  orbit: 12, sling: 4, shells: 4, echo: 6, herd: 3, course: 2, dive: 4,
  hockey: 3, pairs: 1.9, flash: 20, halo: 15, pulse: 8,
  ripple: 6, hop: 60, juggle: 12, loop: 10, pull: 10, spark: 3, twin: 12,
  grow: 25, rain: 20, spot: 8, tilt: 8,
  brick: 25, flip: 15, more: 10, stick: 8,
  blast: 15, bumper: 12, cross: 3, cue: 4, dodge: 20, hue: 8,
  land: 4, order: 5, pop: 30, ready: 15, recall: 5, swing: 8,
};

/** Games whose count is better lower: Pairs counts turns for each pair. */
const LOWER = new Set<GameId>(['pairs']);

/** A run's points: 10 for a par run, more or less in proportion. */
export function points(id: GameId, raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const k = LOWER.has(id) ? PAR[id] / raw : raw / PAR[id];
  return Math.round(k * 100) / 10;
}

/** Points as shown: one decimal, always. */
export const fmt = (p: number): string => p.toFixed(1);
