// Points for Nu's park games: one scale for every game, so a roulette of six (roulette.ts) comes
// out roughly even whichever six it picks. Each game counts in its own way (photons caught,
// levels, height, turns); its par is about what a fair run reaches, before it ends or the
// roulette's time runs out, and a par run is worth 10 points. Points have one decimal.

import type { GameId } from './games';

/** About what a fair run reaches, in the game's own count. */
export const PAR: Record<GameId, number> = {
  orbit: 12, sling: 4, shells: 4, echo: 6, herd: 3, course: 2, dive: 5,
  hockey: 3, pairs: 1.9, flash: 20, halo: 18, pulse: 8,
  ripple: 6, hop: 60, juggle: 15, loop: 10, pull: 10, spark: 3, twin: 12,
  grow: 25, rain: 22, spot: 8, tilt: 8,
  brick: 35, flip: 15, more: 10, stick: 8,
  blast: 15, bumper: 18, cross: 5, cue: 4, dodge: 20, hue: 10,
  land: 3, order: 5, pop: 25, ready: 12, recall: 5, swing: 8,
  carve: 3, trail: 15, bank: 10, surf: 30, shade: 25, spin: 3, bend: 30,
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
