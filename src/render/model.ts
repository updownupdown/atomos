// The atom the lab draws: which orbitals are shown, normalised so their densities add up in
// electrons per a0^3, plus everything the renderers need to frame and threshold them. The
// physics is the gallery's (src/gallery/orbital.ts): hydrogen-like radial functions with
// Slater's effective charge per subshell, real spherical harmonics, Hund filling in M_ORDER.
//
// Lengths are in Bohr radii. Physics z is screen up: a point (x, y, z) in the physics frame
// is drawn at (x, z, y) in the scene, as the gallery does.

import { L_OF, elementAt, type Block, type Element, type Subshell } from '../gallery/data';
import { M_ORDER, ORBITAL_NAMES, harmonic, mulberry32, radial, radialTable } from '../gallery/orbital';

/** Which part of the atom to show. */
export interface Selection {
  z: number;
  /** 'total', 'valence' or a subshell key such as '3d'. */
  orbital: string;
  /** Sum over m (the whole subshell, as its electrons fill it) instead of one real orbital. */
  full: boolean;
  /** For a single orbital: index into M_ORDER (0 = pz, dz², fz³ ...). */
  m: number;
}

/** One orbital (or one whole spherical subshell) in the sum. */
export interface Term {
  key: string; // '2p'
  n: number;
  l: number;
  block: Block;
  /** Real m (from M_ORDER), or null for a spherical average over all m. */
  m: number | null;
  zeff: number;
  /** Electrons in it (1 for a single orbital shown on its own). */
  weight: number;
  /** psi = norm * radial(n, l, zeff r) * harmonic(l, m, unit) (harmonic = 1 when m is null). */
  norm: number;
  /** No angular factor (s, or an m-sum: closed subshells are exactly round, by Unsöld), so it
   *  can be tabulated by radius. */
  spherical: boolean;
}

export interface AtomModel {
  element: Element;
  selection: Selection;
  label: string;
  terms: Term[];
  /** Electrons shown in total (sum of weights). */
  electrons: number;
  /** Radius of the sphere every renderer clips to (a0). */
  bound: number;
  /** Radius to frame the camera on (a0). */
  frame: number;
  /** Scene units per a0, matching the app's AtomView scale (outer layer edge at the vdW radius). */
  worldPerA0: number;
  /** Density level whose region {rho >= level} holds 50, 75, 90 and 99% of the electrons. */
  levels: Record<Threshold, number>;
  /** The largest density reached (a0^-3), for log colormaps. */
  peak: number;
  /** Probability-weighted samples (physics frame), shared by the particle experiments. */
  cache: Map<string, unknown>;
}

export type Threshold = 50 | 75 | 90 | 99;
export const THRESHOLDS: Threshold[] = [50, 75, 90, 99];

const FOUR_PI = 4 * Math.PI;

const radialNorms = new Map<string, number>();
/** Integral of radial(n, l, x)^2 x^2 dx: R(r) = sqrt(Z^3 / I) radial(n, l, Z r) is normalised. */
function radialIntegral(n: number, l: number): number {
  const key = `${n},${l}`;
  let v = radialNorms.get(key);
  if (v == null) {
    const xmax = 4 * n * n + 10 * n + 10;
    const steps = 6000;
    const h = xmax / steps;
    let s = 0;
    for (let i = 1; i < steps; i++) {
      const x = i * h;
      const r = radial(n, l, x);
      s += (i % 2 ? 4 : 2) * r * r * x * x;
    }
    v = (s * h) / 3;
    radialNorms.set(key, v);
  }
  return v;
}

const angularNorms = new Map<string, number>();
/** 1 / sqrt(integral of harmonic^2 over the sphere). */
export function angularNorm(l: number, m: number): number {
  const key = `${l},${m}`;
  let v = angularNorms.get(key);
  if (v == null) {
    const nt = 160, np = 320;
    let s = 0;
    for (let i = 0; i < nt; i++) {
      const th = ((i + 0.5) / nt) * Math.PI;
      const st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j < np; j++) {
        const ph = ((j + 0.5) / np) * 2 * Math.PI;
        const y = harmonic(l, m, st * Math.cos(ph), st * Math.sin(ph), ct);
        s += y * y * st;
      }
    }
    s *= (Math.PI / nt) * ((2 * Math.PI) / np);
    v = 1 / Math.sqrt(s);
    angularNorms.set(key, v);
  }
  return v;
}

const harmonicMax = new Map<string, number>();
function maxHarmonic2(l: number, m: number): number {
  const key = `${l},${m}`;
  let v = harmonicMax.get(key);
  if (v == null) {
    v = 0;
    for (let i = 0; i <= 90; i++) {
      const th = (i / 90) * Math.PI;
      for (let j = 0; j < 180; j++) {
        const ph = (j / 180) * 2 * Math.PI;
        v = Math.max(v, harmonic(l, m, Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)) ** 2);
      }
    }
    v *= 1.02;
    harmonicMax.set(key, v);
  }
  return v;
}

function makeTerm(sub: Subshell, m: number | null, weight: number): Term {
  const l = L_OF[sub.l];
  const rn = Math.sqrt(sub.zeff ** 3 / radialIntegral(sub.n, l));
  const an = m == null ? 1 / Math.sqrt(FOUR_PI) : angularNorm(l, m);
  return { key: sub.key, n: sub.n, l, block: sub.l, m, zeff: sub.zeff, weight, norm: rn * an, spherical: m == null };
}

/** The terms of a whole subshell: spherical when it is closed (or `full` asks for the m-sum),
 *  otherwise each real orbital its electrons occupy (Hund: one each, then pairing). */
function subshellTerms(sub: Subshell, full: boolean): Term[] {
  const l = L_OF[sub.l];
  const orbitals = 2 * l + 1;
  if (l === 0) return [makeTerm(sub, null, sub.count)];
  if (sub.count === sub.capacity) return [makeTerm(sub, null, sub.count)];
  if (full) return [makeTerm(sub, null, sub.count)];
  const out: Term[] = [];
  for (let oi = 0; oi < orbitals; oi++) {
    const e = (sub.count > oi ? 1 : 0) + (sub.count > oi + orbitals ? 1 : 0);
    if (e > 0) out.push(makeTerm(sub, M_ORDER[oi], e));
  }
  return out;
}

/** Excited orbitals offered for hydrogen and helium, as lisyarus shows them (one electron). */
const EXCITED = ['2s', '2p', '3s', '3p', '3d', '4s', '4p', '4d', '4f'];

/** The orbital choices for an element: Total, Valence (when it differs), then each subshell
 *  (and for H and He, excited hydrogen-like orbitals, marked *). */
export function orbitalChoices(e: Element): { id: string; label: string }[] {
  const out = [{ id: 'total', label: 'Total' }];
  if (e.subshells.some((s) => s.core)) out.push({ id: 'valence', label: 'Valence' });
  for (const s of e.subshells) out.push({ id: s.key, label: s.key });
  if (e.z <= 2) for (const k of EXCITED) if (!e.subshells.some((s) => s.key === k)) out.push({ id: k, label: k + '*' });
  return out;
}

/** One electron promoted to an empty subshell of H or He: it sees the nucleus screened by
 *  whatever is left below it (Z_eff = 1 either way). */
function excitedSubshell(e: Element, key: string): Subshell | null {
  if (e.z > 2 || !EXCITED.includes(key)) return null;
  const n = Number(key[0]);
  const l = key[1] as Block;
  const zeff = 1;
  const L = L_OF[l];
  return { key, n, l, count: 1, capacity: 2 * (2 * L + 1), core: false, zeff, meanRadius: (n * n * 1.5 - L * (L + 1) * 0.5) / zeff };
}

/** Real orbital names for a subshell key ('2p' → pz, px, py). */
export function mChoices(key: string): string[] {
  const block = key[key.length - 1] as Block;
  if (!(block in ORBITAL_NAMES)) return [];
  const n = key.slice(0, -1);
  return ORBITAL_NAMES[block].map((name) => n + name);
}

/**
 * The terms for a selection. `explicitSign` keeps every m of a summed subshell as its own term
 * so the sign of each lobe survives (phase coloring); otherwise sums are spherical averages.
 */
export function selectTerms(e: Element, sel: Selection, explicitSign: boolean): Term[] {
  const expandFull = (sub: Subshell): Term[] => {
    const l = L_OF[sub.l];
    if (!explicitSign || l === 0) return [makeTerm(sub, null, sub.count)];
    const orbitals = 2 * l + 1;
    return M_ORDER.slice(0, orbitals).map((m) => makeTerm(sub, m, sub.count / orbitals));
  };
  if (sel.orbital === 'total' || sel.orbital === 'valence') {
    const subs = e.subshells.filter((s) => sel.orbital === 'total' || !s.core);
    return subs.flatMap((s) => {
      // Closed subshells stay one spherical term even for phase coloring (their m-sum is round);
      // open ones show the orbitals their electrons occupy, or the m-sum when asked.
      if (sel.full && explicitSign && s.count !== s.capacity) return expandFull(s);
      return subshellTerms(s, sel.full);
    });
  }
  const sub = e.subshells.find((s) => s.key === sel.orbital) ?? excitedSubshell(e, sel.orbital) ?? e.subshells[e.subshells.length - 1];
  if (sel.full) return expandFull(sub);
  const l = L_OF[sub.l];
  const oi = Math.max(0, Math.min(2 * l, sel.m));
  return [makeTerm(sub, l === 0 ? null : M_ORDER[oi], 1)];
}

/** The wavefunction of one term at a physics-frame point. */
export function psi(t: Term, x: number, y: number, z: number): number {
  const r = Math.hypot(x, y, z);
  const rad = radial(t.n, t.l, t.zeff * r);
  if (t.m == null) return t.norm * rad;
  if (r < 1e-9) return t.l === 0 ? t.norm * rad : 0;
  return t.norm * rad * harmonic(t.l, t.m, x / r, y / r, z / r);
}

/** Electron density of all the terms at a physics-frame point (a0^-3). */
export function density(terms: Term[], x: number, y: number, z: number): number {
  let d = 0;
  for (const t of terms) {
    const p = psi(t, x, y, z);
    d += t.weight * p * p;
  }
  return d;
}

type Rand = () => number;

/** Draw one point from a term's |psi|^2; returns the sign of psi there. */
export function sampleTerm(t: Term, rand: Rand, out: Float32Array, o: number): number {
  const tab = radialTable(t.n, t.l);
  const u = rand() * 1024;
  const i = Math.min(1023, Math.floor(u));
  const j = Math.min(1023, i + 1);
  const r = (tab.quantiles[i] + (tab.quantiles[j] - tab.quantiles[i]) * (u - i)) / t.zeff;
  let x = 0, y = 0, z = 1, h = 1;
  const ymax = t.m == null ? 1 : maxHarmonic2(t.l, t.m);
  for (let tries = 0; tries < 200; tries++) {
    const c = 2 * rand() - 1;
    const ph = 2 * Math.PI * rand();
    const s = Math.sqrt(1 - c * c);
    x = s * Math.cos(ph); y = s * Math.sin(ph); z = c;
    if (t.m == null) break;
    h = harmonic(t.l, t.m, x, y, z);
    if (rand() * ymax < h * h) break;
  }
  out[o] = x * r; out[o + 1] = y * r; out[o + 2] = z * r;
  const rs = radial(t.n, t.l, t.zeff * r);
  return (rs >= 0 ? 1 : -1) * (h >= 0 ? 1 : -1);
}

export interface Samples {
  /** Physics-frame xyz per point (a0). */
  positions: Float32Array;
  /** Index of the term each point came from. */
  term: Uint8Array;
  /** Sign of psi at the point (+1 / -1). */
  sign: Int8Array;
}

/** `count` points from the whole density, terms chosen by their electron count. */
export function sampleModel(terms: Term[], count: number, seed = 7): Samples {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const term = new Uint8Array(count);
  const sign = new Int8Array(count);
  const total = terms.reduce((a, t) => a + t.weight, 0);
  const cdf: number[] = [];
  let acc = 0;
  for (const t of terms) { acc += t.weight / total; cdf.push(acc); }
  for (let i = 0; i < count; i++) {
    const u = rand();
    let k = 0;
    while (k < terms.length - 1 && cdf[k] < u) k++;
    term[i] = k;
    sign[i] = sampleTerm(terms[k], rand, positions, i * 3);
  }
  return { positions, term, sign };
}

/** Scene units per a0 so the outer layer's 85% edge lands on the vdW radius (as AtomView). */
export function worldPerA0(e: Element): number {
  const outer = Math.max(...e.subshells.map((s) => radialTable(s.n, L_OF[s.l]).edge / s.zeff));
  return e.vdw / 100 / outer;
}

const models = new Map<string, AtomModel>();

/** Build (or fetch) the model for a selection. */
export function buildModel(sel: Selection, explicitSign: boolean): AtomModel {
  const key = `${sel.z}/${sel.orbital}/${sel.full ? 1 : 0}/${sel.m}/${explicitSign ? 1 : 0}`;
  const hit = models.get(key);
  if (hit) return hit;
  const e = elementAt(sel.z);
  const terms = selectTerms(e, sel, explicitSign);
  const electrons = terms.reduce((a, t) => a + t.weight, 0);
  // Levels and extent from samples of the density itself: the share of probability inside
  // {rho >= L} is the share of samples whose density is at least L.
  const N = 24000;
  const s = sampleModel(terms, N, 12345);
  const dens = new Float64Array(N);
  const radii = new Float64Array(N);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const x = s.positions[i * 3], y = s.positions[i * 3 + 1], z = s.positions[i * 3 + 2];
    dens[i] = density(terms, x, y, z);
    radii[i] = Math.hypot(x, y, z);
    peak = Math.max(peak, dens[i]);
  }
  // s orbitals peak at the nucleus itself.
  peak = Math.max(peak, density(terms, 1e-5, 0, 0), density(terms, 0, 0, 1e-3 / Math.max(...terms.map((t) => t.zeff))));
  const sorted = Float64Array.from(dens).sort();
  const levels = {} as Record<Threshold, number>;
  for (const th of THRESHOLDS) levels[th] = sorted[Math.floor((1 - th / 100) * (N - 1))];
  const rs = Float64Array.from(radii).sort();
  const r995 = rs[Math.floor(0.997 * (N - 1))];
  // Frame on the 90% region's extent (its far edge, past the odd stray sample).
  const inside = radii.filter((_, i) => dens[i] >= levels[90]).sort();
  const rFrame = inside.length ? inside[Math.floor(0.995 * (inside.length - 1))] : rs[Math.floor(0.97 * (N - 1))];
  const label = sel.orbital === 'total' ? 'Total' : sel.orbital === 'valence' ? 'Valence'
    : sel.full || terms[0].l === 0 ? `${sel.orbital} (all m)` : mChoices(sel.orbital)[Math.min(sel.m, 2 * terms[0].l)];
  const model: AtomModel = {
    element: e, selection: { ...sel }, label, terms, electrons,
    bound: r995 * 1.12, frame: Math.min(r995, rFrame * 1.2), worldPerA0: worldPerA0(e), levels, peak, cache: new Map(),
  };
  if (models.size > 40) {
    // Drop old models and any GPU buffers cached on them.
    for (const m of models.values()) for (const v of m.cache.values()) (v as { dispose?: () => void }).dispose?.();
    models.clear();
  }
  models.set(key, model);
  return model;
}

/**
 * Spherical terms tabulated by radius for the shaders: an RGBA row of `size` texels holding
 * the s, p, d and f density (divided by `peak`) at r = bound * u^2, u = i / (size - 1). The
 * square-root spacing resolves the dense core of heavy atoms.
 */
export function sphericalTable(model: AtomModel, size = 2048): Float32Array {
  const out = new Float32Array(size * 4);
  const terms = model.terms.filter((t) => t.spherical);
  const ch: Record<Block, number> = { s: 0, p: 1, d: 2, f: 3 };
  for (let i = 0; i < size; i++) {
    const u = i / (size - 1);
    const r = model.bound * u * u;
    for (const t of terms) {
      const p = t.norm * radial(t.n, t.l, t.zeff * r);
      out[i * 4 + ch[t.block]] += (t.weight * p * p) / model.peak;
    }
  }
  return out;
}
