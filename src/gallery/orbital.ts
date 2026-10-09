// Hydrogen-like orbitals for the gallery: real spherical harmonics up to f,
// the true radial functions R_nl (associated Laguerre polynomials, with their
// radial nodes), point sampling of |psi|^2 and the idealised boundary surfaces
// that textbooks draw. Lengths are in units of a0 / Z_eff, so one set of
// samples per (n, l) serves every atom; the renderer scales each layer.

import type { Block } from './data';
import { L_OF } from './data';

type Rand = () => number;

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unitVector(rand: Rand): [number, number, number] {
  const u = 2 * rand() - 1;
  const phi = 2 * Math.PI * rand();
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(phi), s * Math.sin(phi), u];
}

/**
 * Real spherical harmonics (unnormalised, as polynomials of the unit vector).
 * The order of m for each l matches the order electrons fill the orbitals.
 */
export const M_ORDER = [0, 1, -1, 2, -2, 3, -3];

export function harmonic(l: number, m: number, x: number, y: number, z: number): number {
  switch (l) {
    case 0: return 1;
    case 1: return m === -1 ? y : m === 0 ? z : x;
    case 2:
      switch (m) {
        case -2: return x * y;
        case -1: return y * z;
        case 0: return (3 * z * z - 1) / (2 * Math.sqrt(3));
        case 1: return x * z;
        default: return (x * x - y * y) / 2;
      }
    default:
      switch (m) {
        case -3: return y * (3 * x * x - y * y);
        case -2: return x * y * z;
        case -1: return y * (5 * z * z - 1);
        case 0: return z * (5 * z * z - 3);
        case 1: return x * (5 * z * z - 1);
        case 2: return z * (x * x - y * y);
        default: return x * (x * x - 3 * y * y);
      }
  }
}

/** Common names for the orbitals, in fill order. */
export const ORBITAL_NAMES: Record<Block, string[]> = {
  s: ['s'],
  p: ['pz', 'px', 'py'],
  d: ['dz²', 'dxz', 'dyz', 'dx²−y²', 'dxy'],
  f: ['fz³', 'fxz²', 'fyz²', 'fz(x²−y²)', 'fxyz', 'fx(x²−3y²)', 'fy(3x²−y²)'],
};

const harmonicMax = new Map<string, number>();
function maxHarmonic2(l: number, m: number): number {
  const key = `${l},${m}`;
  let v = harmonicMax.get(key);
  if (v == null) {
    const rand = mulberry32(99 + l * 10 + m);
    v = 0;
    for (let i = 0; i < 8000; i++) {
      const [x, y, z] = unitVector(rand);
      v = Math.max(v, harmonic(l, m, x, y, z) ** 2);
    }
    v *= 1.03;
    harmonicMax.set(key, v);
  }
  return v;
}

/** Generalised Laguerre polynomial L_k^alpha(x) by the three-term recurrence. */
export function laguerre(k: number, alpha: number, x: number): number {
  if (k === 0) return 1;
  let l0 = 1;
  let l1 = 1 + alpha - x;
  for (let i = 1; i < k; i++) {
    const l2 = ((2 * i + 1 + alpha - x) * l1 - (i + alpha) * l0) / (i + 1);
    l0 = l1;
    l1 = l2;
  }
  return l1;
}

/** Radial wavefunction R_nl at x = Z r / a0 (unnormalised). */
export function radial(n: number, l: number, x: number): number {
  const rho = (2 * x) / n;
  return Math.pow(rho, l) * Math.exp(-rho / 2) * laguerre(n - l - 1, 2 * l + 1, rho);
}

interface RadialTable {
  /** Inverse CDF of the radial density x^2 R^2, sampled at 1024 quantiles. */
  quantiles: Float32Array;
  /** x inside which 85% of the density lies: the layer's drawn edge. */
  edge: number;
  mean: number;
}

const radialTables = new Map<string, RadialTable>();

/** The radial density of (n, l), tabulated once. */
export function radialTable(n: number, l: number): RadialTable {
  const key = `${n},${l}`;
  const hit = radialTables.get(key);
  if (hit) return hit;
  const xmax = 3 * n * n + 6 * n;
  const steps = 4000;
  const cdf = new Float64Array(steps + 1);
  let mean = 0;
  for (let i = 1; i <= steps; i++) {
    const x = (i / steps) * xmax;
    const r = radial(n, l, x);
    const d = x * x * r * r;
    cdf[i] = cdf[i - 1] + d;
    mean += x * d;
  }
  const total = cdf[steps];
  mean /= total;
  const quantiles = new Float32Array(1024);
  let j = 0;
  for (let q = 0; q < 1024; q++) {
    const target = ((q + 0.5) / 1024) * total;
    while (j < steps && cdf[j] < target) j++;
    quantiles[q] = (j / steps) * xmax;
  }
  const table = { quantiles, edge: quantiles[Math.floor(1024 * 0.85)], mean };
  radialTables.set(key, table);
  return table;
}

export function sampleRadius(n: number, l: number, rand: Rand): number {
  const t = radialTable(n, l);
  const u = rand() * 1024;
  const i = Math.min(1023, Math.floor(u));
  const next = Math.min(1023, i + 1);
  return t.quantiles[i] + (t.quantiles[next] - t.quantiles[i]) * (u - i);
}

export interface OrbitalCloud {
  /** xyz per point in units of a0 / Z_eff. */
  positions: Float32Array;
  /** Which electron slot each point belongs to (0-based, fill order). */
  slot: Float32Array;
  /** Which orbital (m index in fill order) each point belongs to. */
  orbital: Float32Array;
  /** 1 where the wavefunction is positive. */
  sign: Float32Array;
}

/**
 * Point samples of a whole subshell: `perSlot` points for each of its 2(2l+1)
 * electron slots, each slot drawn from |R_nl|^2 |Y_lm|^2 for the orbital it
 * fills in order (Hund's rule: one per orbital, then pairing). Lobes are
 * sharpened slightly (|Y|^2 raised to a power) so shapes read on a phone.
 */
export function sampleSubshell(n: number, block: Block, perSlot: number, sharpen = 1.6): OrbitalCloud {
  const l = L_OF[block];
  const orbitals = 2 * l + 1;
  const slots = 2 * orbitals;
  const total = slots * perSlot;
  const positions = new Float32Array(total * 3);
  const slot = new Float32Array(total);
  const orbital = new Float32Array(total);
  const sign = new Float32Array(total);
  const rand = mulberry32(1000 * n + 37 * l + 11 * perSlot);
  let p = 0;
  for (let s = 0; s < slots; s++) {
    const oi = s % orbitals;
    const m = M_ORDER[oi];
    const ymax = maxHarmonic2(l, m);
    for (let i = 0; i < perSlot; i++) {
      let v: [number, number, number] = unitVector(rand);
      let y = 1;
      if (l > 0) {
        for (let tries = 0; tries < 400; tries++) {
          v = unitVector(rand);
          y = harmonic(l, m, v[0], v[1], v[2]);
          if (rand() < Math.pow((y * y) / ymax, sharpen)) break;
        }
      }
      const r = sampleRadius(n, l, rand);
      positions[p * 3] = v[0] * r;
      positions[p * 3 + 1] = v[2] * r; // z up on screen
      positions[p * 3 + 2] = v[1] * r;
      slot[p] = s;
      orbital[p] = oi;
      sign[p] = y >= 0 ? 1 : 0;
      p++;
    }
  }
  return { positions, slot, orbital, sign };
}

/**
 * The idealised boundary surface of one orbital: r(theta, phi) proportional to
 * |Y_lm|, the shape chemistry books draw, on a (segments x rings) grid. Returns
 * positions on a unit-scale surface plus a sign per vertex for two-tone shading.
 */
export function orbitalSurface(block: Block, oi: number, segments = 48, rings = 32): {
  positions: Float32Array; sign: Float32Array; index: Uint16Array;
} {
  const l = L_OF[block];
  const m = M_ORDER[oi];
  const count = (segments + 1) * (rings + 1);
  const positions = new Float32Array(count * 3);
  const sign = new Float32Array(count);
  let ymax = 0;
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI;
    for (let j = 0; j <= segments; j++) {
      const ph = (j / segments) * Math.PI * 2;
      ymax = Math.max(ymax, Math.abs(harmonic(l, m, Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th))));
    }
  }
  let k = 0;
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI;
    for (let j = 0; j <= segments; j++) {
      const ph = (j / segments) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.sin(th) * Math.sin(ph), z = Math.cos(th);
      const h = l === 0 ? 1 : harmonic(l, m, x, y, z) / ymax;
      const r = Math.abs(h);
      positions[k * 3] = x * r;
      positions[k * 3 + 1] = z * r;
      positions[k * 3 + 2] = y * r;
      sign[k] = h >= 0 ? 1 : 0;
      k++;
    }
  }
  const index = new Uint16Array(segments * rings * 6);
  let q = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      index[q++] = a; index[q++] = b; index[q++] = a + 1;
      index[q++] = b; index[q++] = b + 1; index[q++] = a + 1;
    }
  }
  return { positions, sign, index };
}
