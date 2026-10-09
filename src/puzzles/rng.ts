// A small seeded generator (mulberry32), so every puzzle level is the same for
// everyone and a restart replays the same deal.

export interface Rng {
  s: number;
}

export function seeded(seed: number): Rng {
  return { s: seed >>> 0 };
}

/** Advances the generator and returns a number in [0, 1). */
export function rand(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(rng: Rng, n: number): number {
  return Math.floor(rand(rng) * n);
}

export function pick<T>(rng: Rng, items: T[]): T {
  return items[randInt(rng, items.length)];
}

/** Picks an index with probability proportional to its weight. */
export function weighted(rng: Rng, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand(rng) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
