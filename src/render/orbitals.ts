// Point samples of hydrogen-like orbitals, drawn from the true probability density
// |psi|^2 in units of the Bohr radius for an effective charge of 1. The renderer
// scales them by 1 / Z_eff for each atom.

import type { Axis } from '../core/physics';

export interface OrbitalSamples {
  positions: Float32Array; // the orbital's shape
  alt: Float32Array; // a matching spherical cloud, used to morph during Slice the Wave
  sign: Float32Array; // 1 where the wavefunction is positive, 0 where negative
  rank: Float32Array; // uniform 0..1 per point, used to reveal one electron at a time
  radius90: number; // radius containing 90% of points (Bohr radii, Z_eff = 1)
}

type Rand = () => number;

function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gamma(k, 1) for integer k: sum of k exponentials. */
function gammaInt(k: number, rand: Rand): number {
  let s = 0;
  for (let i = 0; i < k; i++) s -= Math.log(1 - rand());
  return s;
}

function unitVector(rand: Rand): [number, number, number] {
  const u = 2 * rand() - 1;
  const phi = 2 * Math.PI * rand();
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(phi), s * Math.sin(phi), u];
}

function percentile90(radii: number[]): number {
  const sorted = [...radii].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.9)];
}

/** 1s: radial density r^2 e^{-2r}, i.e. r ~ Gamma(3)/2. */
export function sample1s(count: number, seed = 1): OrbitalSamples {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const sign = new Float32Array(count).fill(1);
  const rank = new Float32Array(count);
  const radii: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = gammaInt(3, rand) / 2;
    const [x, y, z] = unitVector(rand);
    positions.set([x * r, y * r, z * r], i * 3);
    rank[i] = rand();
    radii.push(r);
  }
  return { positions, alt: positions.slice(), sign, rank, radius90: percentile90(radii) };
}

/** 2s: psi ~ (2 - r) e^{-r/2}; radial density r^2 (2 - r)^2 e^{-r}, by rejection sampling. */
export function sample2s(count: number, seed = 2): OrbitalSamples {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const sign = new Float32Array(count);
  const rank = new Float32Array(count);
  const radii: number[] = [];
  // Rejection sampling of the radial density f(r) = r^2 (2-r)^2 e^-r on [0, 30].
  const f = (r: number) => r * r * (2 - r) * (2 - r) * Math.exp(-r);
  let fmax = 0;
  for (let r = 0; r < 30; r += 0.01) fmax = Math.max(fmax, f(r));
  let i = 0;
  while (i < count) {
    const r = 30 * rand();
    if (rand() * fmax > f(r)) continue;
    const [x, y, z] = unitVector(rand);
    positions.set([x * r, y * r, z * r], i * 3);
    // Sign convention: the large outer region takes the main colour, the inner core the second.
    sign[i] = r < 2 ? 0 : 1;
    rank[i] = rand();
    radii.push(r);
    i++;
  }
  return { positions, alt: positions.slice(), sign, rank, radius90: percentile90(radii) };
}

/** 2p along an axis: psi ~ r e^{-r/2} cos(theta); radial r^4 e^{-r} = Gamma(5). */
export function sample2p(count: number, axis: Axis, seed = 3): OrbitalSamples {
  const rand = mulberry32(seed + axis.charCodeAt(0));
  const positions = new Float32Array(count * 3);
  const alt = new Float32Array(count * 3);
  const sign = new Float32Array(count);
  const rank = new Float32Array(count);
  const radii: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = gammaInt(5, rand);
    // Angular density cos^2(theta): sample c = cos(theta) with density c^2 on [-1,1].
    let c: number;
    do c = 2 * rand() - 1; while (rand() > c * c);
    const s = Math.sqrt(1 - c * c);
    const phi = 2 * Math.PI * rand();
    const a = s * Math.cos(phi), b = s * Math.sin(phi);
    const v: [number, number, number] =
      axis === 'x' ? [c, a, b] : axis === 'y' ? [a, c, b] : [a, b, c];
    positions.set([v[0] * r, v[1] * r, v[2] * r], i * 3);
    // The morph source: the same radius, direction spread uniformly (a 2s-like sphere).
    const [ux, uy, uz] = unitVector(rand);
    alt.set([ux * r, uy * r, uz * r], i * 3);
    sign[i] = c > 0 ? 1 : 0;
    rank[i] = rand();
    radii.push(r);
  }
  return { positions, alt, sign, rank, radius90: percentile90(radii) };
}
