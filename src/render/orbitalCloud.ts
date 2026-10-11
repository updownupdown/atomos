// The atom split into its real orbitals, each as its own dense point cloud: the app's atom
// (Build and View) and the lab's Fingerprint and Explorer experiments. Every occupied orbital
// of every subshell is kept apart (a closed 3d is five clouds, not one round shell), so any
// one of them can be lit, tinted, dimmed or hidden on its own. Per-orbital looks live in a
// small float texture the vertex shader reads (texelFetch), so changing them costs one tiny
// upload per frame and the points themselves never change after sampling.
//
// Twinkle, glints and the tap ripple are all functions of time and each point's own seed, in
// the shader: zero CPU per point per frame.
//
// Sampling a heavy atom takes most of a second, so it runs a slice per frame
// (OrbitalSetBuilder) and the cloud thickens as it comes in; orbitalSet() does it all at once.

import * as THREE from 'three';
import { L_OF, type Block, type Element } from '../gallery/data';
import { mulberry32 } from '../gallery/orbital';
import { ADD_BLEND, POINT_FRAG } from './gl';
import { mChoices, sampleTerm, selectTerms, type Term } from './model';
import { LAB_BG, VolumePass } from './volume';

/** Most orbitals any atom has (oganesson: 59). */
export const MAX_ORBITALS = 64;

export interface OrbitalInfo {
  index: number;
  term: Term;
  /** Subshell key, '4d'. */
  key: string;
  /** '4dz²', '3s'. */
  label: string;
  n: number;
  l: number;
  block: Block;
  /** Index of the subshell in the atom (inner to outer), and of this orbital within it. */
  sub: number;
  mIndex: number;
  /** Electrons in it: 1 or 2. */
  electrons: number;
  /** Radii holding 50% and 90% of its points (a0). */
  r50: number;
  r90: number;
  /** Its most telling axis (scene frame), and whether it is the long axis of a cigar
   *  (prolate: p, dz²), the normal of a disc or cross (oblate: dxy, rings), or none (s). */
  axis: THREE.Vector3;
  shape: 'prolate' | 'oblate' | 'round';
  /** 0 (round) to about 0.6 (one sharp axis). */
  anisotropy: number;
  /** Where its points sit in the buffers. */
  start: number;
  count: number;
}

export interface OrbitalSet {
  element: Element;
  orbitals: OrbitalInfo[];
  geometry: THREE.BufferGeometry;
  total: number;
  /** Radius of the whole atom's 90% region (a0), the largest r90. */
  r90: number;
  /** Points sampled so far, per orbital: a set fills over several frames (OrbitalSetBuilder). */
  filled: Int32Array;
  complete: boolean;
}

/** The occupied real orbitals of an atom, inner subshells first (by mean radius), each with
 *  its electron count (Hund: one each, then pairing). */
function orbitalTerms(e: Element): { term: Term; key: string; label: string; sub: number; mIndex: number; electrons: number }[] {
  const subs = [...e.subshells].sort((a, b) => a.meanRadius - b.meanRadius);
  const out: { term: Term; key: string; label: string; sub: number; mIndex: number; electrons: number }[] = [];
  subs.forEach((s, si) => {
    const l = L_OF[s.l];
    const orbitals = 2 * l + 1;
    const names = l === 0 ? [s.key] : mChoices(s.key);
    for (let oi = 0; oi < orbitals; oi++) {
      const electrons = (s.count > oi ? 1 : 0) + (s.count > oi + orbitals ? 1 : 0);
      if (!electrons) continue;
      const [term] = selectTerms(e, { z: e.z, orbital: s.key, full: false, m: oi }, true);
      out.push({ term, key: s.key, label: names[oi] ?? s.key, sub: si, mIndex: oi, electrons });
    }
  });
  return out.slice(0, MAX_ORBITALS);
}

/** Eigen-decomposition of a symmetric 3×3 matrix (Jacobi), eigenvalues descending. */
function eigen3(m: number[][]): { values: number[]; vectors: THREE.Vector3[] } {
  const a = m.map((r) => [...r]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2;
    if (off < 1e-12) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-14) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: idx.map((i) => a[i][i]), vectors: idx.map((i) => new THREE.Vector3(v[0][i], v[1][i], v[2][i])) };
}

/** Points for the largest orbital, and the cap for the whole atom, per point level. */
export type PointLevel = 'low' | 'medium' | 'high' | 'ultra';
export const ORBITAL_POINTS: Record<PointLevel, { per: number; budget: number }> = {
  low: { per: 30_000, budget: 450_000 },
  medium: { per: 60_000, budget: 900_000 },
  high: { per: 100_000, budget: 1_600_000 },
  ultra: { per: 160_000, budget: 2_600_000 },
};

/** Pilot samples per orbital, for its size and shape. */
const PILOT = 1500;
/** Sampling runs in this many even turns: after each, every orbital holds the same share. */
const TURNS = 48;

interface Pilot { r50: number; r90: number; axis: THREE.Vector3; shape: OrbitalInfo['shape']; anisotropy: number }

/**
 * Samples an atom's orbitals a slice at a time, so a heavy atom (a million and a half points,
 * most of a second of CPU on a laptop, several on a phone) never stalls a frame: a quick pilot
 * per orbital sizes the buffers, then every orbital fills at the same pace, so the cloud
 * thickens evenly while it comes in. Points come in random order, so whatever share is filled
 * is a fair thinning of the whole. Each orbital draws from its own seeded stream, so the result
 * is the same however the work is sliced.
 */
export class OrbitalSetBuilder {
  /** Null until the pilots are done (the buffers are sized then). */
  set: OrbitalSet | null = null;
  private list: ReturnType<typeof orbitalTerms>;
  private pilots: Pilot[] = [];
  private rands: (() => number)[];
  private turn = 0;
  private buf = new Float32Array(3);

  constructor(readonly element: Element, readonly perOrbital: number, readonly budget: number) {
    this.list = orbitalTerms(element);
    this.rands = this.list.map((_, i) => mulberry32(element.z * 7919 + 17 + i * 104729));
  }

  get done(): boolean { return Boolean(this.set?.complete); }

  /** Work for about `ms` milliseconds (Infinity: to the end). True once every point is in. */
  step(ms: number): boolean {
    const until = performance.now() + ms;
    while (this.pilots.length < this.list.length) {
      this.pilots.push(this.pilot(this.pilots.length));
      if (performance.now() > until) return false;
    }
    if (!this.set) this.allocate();
    const set = this.set!;
    if (set.complete) return true;
    const g = set.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const seed = g.getAttribute('seed') as THREE.BufferAttribute;
    const sgn = g.getAttribute('sgn') as THREE.BufferAttribute;
    const P = pos.array as Float32Array, S = seed.array as Float32Array, G = sgn.array as Float32Array;
    const before = Int32Array.from(set.filled);
    const buf = this.buf;
    do {
      this.turn++;
      set.orbitals.forEach((o, i) => {
        const want = Math.min(o.count, Math.ceil((o.count * this.turn) / TURNS));
        const term = this.list[i].term, rand = this.rands[i];
        for (let k = set.filled[i]; k < want; k++) {
          const j = o.start + k;
          const s = sampleTerm(term, rand, buf, 0);
          // Physics (x, y, z) → scene (x, z, y).
          P[j * 3] = buf[0];
          P[j * 3 + 1] = buf[2];
          P[j * 3 + 2] = buf[1];
          S[j] = rand();
          G[j] = s;
        }
        set.filled[i] = want;
      });
    } while (this.turn < TURNS && performance.now() < until);
    // Upload only what this step wrote.
    set.orbitals.forEach((o, i) => {
      const a = before[i], b = set.filled[i];
      if (b <= a) return;
      pos.addUpdateRange((o.start + a) * 3, (b - a) * 3);
      seed.addUpdateRange(o.start + a, b - a);
      sgn.addUpdateRange(o.start + a, b - a);
    });
    pos.needsUpdate = true;
    seed.needsUpdate = true;
    sgn.needsUpdate = true;
    set.complete = this.turn >= TURNS;
    return set.complete;
  }

  private pilot(i: number): Pilot {
    const o = this.list[i];
    const rand = this.rands[i];
    const buf = this.buf;
    const radii: number[] = [];
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < PILOT; k++) {
      sampleTerm(o.term, rand, buf, 0);
      const x = buf[0], y = buf[2], z = buf[1];
      const r = Math.hypot(x, y, z) || 1e-9;
      radii.push(r);
      const d = [x / r, y / r, z / r];
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) m[p][q] += d[p] * d[q] / PILOT;
    }
    radii.sort((a, b) => a - b);
    const eg = eigen3(m);
    const [l1, l2, l3] = eg.values;
    const prolate = l1 - l2 >= l2 - l3;
    const anisotropy = Math.max(l1 - l2, l2 - l3);
    return {
      r50: radii[Math.floor(PILOT * 0.5)], r90: radii[Math.floor(PILOT * 0.9)],
      axis: (prolate ? eg.vectors[0] : eg.vectors[2]).normalize(),
      shape: o.term.l === 0 || anisotropy < 0.05 ? 'round' : prolate ? 'prolate' : 'oblate',
      anisotropy,
    };
  }

  private allocate(): void {
    const pilots = this.pilots;
    const rmax = Math.max(...pilots.map((p) => p.r90));
    let counts = pilots.map((p) => Math.round(this.perOrbital * Math.max(0.4, Math.min(1, Math.sqrt(p.r90 / rmax)))));
    const sum = counts.reduce((a, b) => a + b, 0);
    if (sum > this.budget) counts = counts.map((c) => Math.max(800, Math.round((c * this.budget) / sum)));
    const total = counts.reduce((a, b) => a + b, 0);
    const termA = new Float32Array(total);
    const orbitals: OrbitalInfo[] = [];
    let at = 0;
    this.list.forEach((o, i) => {
      const n = counts[i];
      termA.fill(i, at, at + n);
      const p = pilots[i];
      orbitals.push({
        index: i, term: o.term, key: o.key, label: o.label, n: o.term.n, l: o.term.l, block: o.term.block,
        sub: o.sub, mIndex: o.mIndex, electrons: o.electrons, r50: p.r50, r90: p.r90,
        axis: p.axis, shape: p.shape, anisotropy: p.anisotropy, start: at, count: n,
      });
      at += n;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(total), 1));
    g.setAttribute('orbital', new THREE.BufferAttribute(termA, 1));
    g.setAttribute('sgn', new THREE.BufferAttribute(new Float32Array(total), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rmax * 3);
    this.set = { element: this.element, orbitals, geometry: g, total, r90: rmax, filled: new Int32Array(orbitals.length), complete: false };
  }
}

/** Sets, finished or under way, the most recently used last. */
const builders = new Map<string, OrbitalSetBuilder>();
/** How many to keep: a heavy atom's set is tens of megabytes. */
const KEEP = 4;

/** The (cached) builder for an atom's set: finish it with step(), a slice per frame. */
export function orbitalSetBuilder(e: Element, perOrbital: number, budget: number): OrbitalSetBuilder {
  const key = `${e.z}/${perOrbital}/${budget}`;
  let b = builders.get(key);
  if (b) builders.delete(key);
  else b = new OrbitalSetBuilder(e, perOrbital, budget);
  builders.set(key, b);
  while (builders.size > KEEP) {
    const [oldKey, old] = builders.entries().next().value!;
    old.set?.geometry.dispose();
    builders.delete(oldKey);
  }
  return b;
}

/**
 * Sample every orbital of an atom at once. `perOrbital` points go to the largest orbital;
 * smaller ones get fewer (down to 40%), and the whole set is capped at `budget`.
 */
export function orbitalSet(e: Element, perOrbital: number, budget: number): OrbitalSet {
  const b = orbitalSetBuilder(e, perOrbital, budget);
  b.step(Infinity);
  return b.set!;
}

// ---- dense orbitals ------------------------------------------------------------------------

/**
 * A large extra sample of one orbital, for the one in focus (or lit): the base set gives every
 * orbital a modest share (enough for ghosts and the whole-atom view), and the orbital that has
 * the light gets hundreds of thousands more, so it reads as a solid luminous body, as the lab's
 * Dense cloud draws a single orbital. Sampled a slice at a time (step) and drawn as it arrives;
 * its buffers are only allocated once sampling starts, so wanting one costs nothing.
 */
export class DenseOrbital {
  geometry: THREE.BufferGeometry | null = null;
  filled = 0;
  private rand: () => number;
  private buf = new Float32Array(3);

  constructor(readonly set: OrbitalSet, readonly index: number, readonly count: number) {
    this.rand = mulberry32(set.element.z * 7919 + 17 + index * 104729 + 7_777_777);
  }

  /** Sample for about `ms` milliseconds, up to `upTo` points. True once there. */
  step(ms: number, upTo = this.count): boolean {
    const want = Math.min(this.count, Math.ceil(upTo));
    if (this.filled >= want) return true;
    if (!this.geometry) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
      g.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(this.count), 1));
      g.setAttribute('orbital', new THREE.BufferAttribute(new Float32Array(this.count).fill(this.index), 1));
      g.setAttribute('sgn', new THREE.BufferAttribute(new Float32Array(this.count), 1));
      g.boundingSphere = this.set.geometry.boundingSphere;
      g.setDrawRange(0, 0);
      this.geometry = g;
    }
    const g = this.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const seed = g.getAttribute('seed') as THREE.BufferAttribute;
    const sgn = g.getAttribute('sgn') as THREE.BufferAttribute;
    const P = pos.array as Float32Array, S = seed.array as Float32Array, G = sgn.array as Float32Array;
    const term = this.set.orbitals[this.index].term, rand = this.rand, buf = this.buf;
    const until = performance.now() + ms;
    const from = this.filled;
    let k = from;
    while (k < want) {
      // In chunks, checking the clock between them.
      const end = Math.min(want, k + 2000);
      for (; k < end; k++) {
        G[k] = sampleTerm(term, rand, buf, 0);
        P[k * 3] = buf[0];
        P[k * 3 + 1] = buf[2];
        P[k * 3 + 2] = buf[1];
        S[k] = rand();
      }
      if (performance.now() > until) break;
    }
    this.filled = k;
    pos.addUpdateRange(from * 3, (k - from) * 3);
    seed.addUpdateRange(from, k - from);
    sgn.addUpdateRange(from, k - from);
    pos.needsUpdate = true;
    seed.needsUpdate = true;
    sgn.needsUpdate = true;
    return k >= want;
  }

  dispose(): void {
    this.geometry?.dispose();
  }
}

/** Dense orbitals kept, most recently used last, so going back to one is instant. */
const denseCache = new Map<string, DenseOrbital>();
/** Points kept across all of them (about 24 bytes each). */
const DENSE_KEEP = 2_400_000;

/** The (cached) dense sample of one orbital of a set. */
export function denseOrbital(set: OrbitalSet, index: number, count: number): DenseOrbital {
  const key = `${set.element.z}/${set.total}/${index}/${count}`;
  let d = denseCache.get(key);
  if (d) denseCache.delete(key);
  else d = new DenseOrbital(set, index, count);
  denseCache.set(key, d);
  let total = 0;
  for (const x of denseCache.values()) total += x.geometry ? x.count : 0;
  for (const [k, x] of denseCache) {
    if (total <= DENSE_KEEP || x === d) break;
    if (x.geometry) total -= x.count;
    x.dispose();
    denseCache.delete(k);
  }
  return d;
}

/** An orbital that wants dense points, and how much (0 to 1: its emphasis now). */
export interface DenseWant { index: number; weight: number }

// ---- drawing ------------------------------------------------------------------------------

const VERT = /* glsl */ `
in float seed;
in float orbital;
in float sgn;
uniform float uTime;
uniform float uSize;
uniform float uAlpha;
uniform float uTwinkle;
uniform sampler2D uLook;   // per orbital: rows 0 pos color + gain, 1 neg color + saturation, 2 twinkle, breath, glint, flash
uniform vec3 uHalf;        // view-space half vector of the key light, for glints
uniform float uFire;       // glints in spectral colors (diamond fire) rather than white
uniform float uHue;        // turns every color round the wheel (radians)
uniform vec4 uPulse;       // ripple: front radius (a0), width, strength, unused
uniform vec3 uPulseCol;
out vec3 vColor;
out float vAlpha;

vec3 hueTurn(vec3 c, float a) {
  if (a == 0.0) return c;
  // Rotate about the gray axis (Rodrigues).
  vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}

vec3 spectrum(float t) {
  return clamp(abs(fract(t + vec3(0.0, 0.333, 0.667)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

void main() {
  int o = int(orbital + 0.5);
  vec4 a = texelFetch(uLook, ivec2(o, 0), 0);
  vec4 b = texelFetch(uLook, ivec2(o, 1), 0);
  vec4 c = texelFetch(uLook, ivec2(o, 2), 0);
  float gain = a.a;
  if (gain < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 col = sgn > 0.0 ? a.rgb : b.rgb;
  float sat = b.a;
  vec3 p = position * (1.0 + c.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  // Twinkle: a slow shimmer under brief, bright scintillations, throttled by uTwinkle and by
  // this orbital's own share.
  float tw = clamp(uTwinkle * c.x, 0.0, 1.5);
  float ph = seed * 43.98;
  float rate = 0.5 + fract(seed * 13.71) * 1.6;
  float s = sin(uTime * rate + ph);
  float spark = pow(max(s, 0.0), 60.0);
  float base = 0.6 + 0.25 * sin(uTime * rate * 0.37 + ph * 2.3);
  float lum = mix(1.0, base + spark * 3.0, min(tw, 1.0)) + spark * max(tw - 1.0, 0.0) * 3.0;

  // Glints: where a point's direction from the nucleus lines up with the light's half
  // vector, a few points (re-chosen every couple of seconds) flash, like facets catching
  // light as the atom turns.
  vec3 nrm = normalize(normalMatrix * position + vec3(1e-6));
  float facing = pow(max(dot(nrm, uHalf), 0.0), 18.0);
  float pick = step(fract(seed * 91.7 + floor(uTime * 0.6 + seed * 3.0) * 0.618), 0.12);
  float glint = facing * pick * c.z;
  vec3 glintCol = mix(vec3(1.0), spectrum(fract(seed * 7.3 + dot(nrm, vec3(0.6, 0.3, 0.2)) * 1.5)), uFire);

  // The tap ripple: a shell of light running out from the nucleus.
  float r = length(position);
  float wave = uPulse.z * exp(-pow((r - uPulse.x) / max(uPulse.y, 1e-3), 2.0));

  vec3 gray = vec3(dot(col, vec3(0.3, 0.59, 0.11))) * 0.75;
  col = hueTurn(mix(gray, col, sat), uHue);
  col = mix(col, vec3(1.0), spark * 0.35 * min(tw, 1.0));
  col = col + glintCol * glint * 1.2 + uPulseCol * wave;
  vColor = col;
  vAlpha = uAlpha * gain * (lum + glint * 5.0 + wave * 2.0 + c.w * 2.0);
  gl_PointSize = max(1.0, uSize * (1.0 + spark * 0.9 * min(tw, 1.0) + glint * 1.5) / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

/** One orbital's look, as the shader reads it. Colors are raw display RGB (0 to 1). */
export interface OrbitalLook {
  pos: [number, number, number];
  neg: [number, number, number];
  /** Light it gives (0 hides it). */
  gain: number;
  /** 0 gray to 1 full color. */
  sat: number;
  /** Its share of the twinkle (1 = as the slider says). */
  twinkle: number;
  /** Radial breathing: scale - 1. */
  breath: number;
  /** Glint strength. */
  glint: number;
  /** A brief extra flash (beats, taps). */
  flash: number;
  /** Share of its points to draw (0 to 1; default all). */
  share?: number;
}

/** What a cloud needs to draw a frame. The lab's LabContext is one. */
export interface CloudContext {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Drawing buffer size in device pixels. */
  width: number;
  height: number;
}

/** How a dense orbital's light per point falls with its count (balancedGain's 0.7 keeps the
 *  total rising gently with the count: a denser orbital is a little brighter and much smoother). */
const DENSE_GAIN = 0.72;

/** Draws an OrbitalSet as additive points into a tone-mapped half-float layer. */
export class OrbitalCloud {
  readonly scene = new THREE.Scene();
  readonly material: THREE.ShaderMaterial;
  private layer: VolumePass;
  /** One Points per orbital, all sharing the set's buffers, each with its own draw range:
   *  a dimmed orbital draws only a random share of its points (they were sampled in random
   *  order, so any prefix is a fair thinning), which is both the ghost look and the saving. */
  private parts: THREE.Points[] = [];
  /** Dense extra samples of the orbitals in focus (see DenseOrbital). */
  private dense = new Map<number, { d: DenseOrbital; weight: number; points: THREE.Points | null }>();
  private worldPerA0 = 1;
  /** The share of each dense orbital drawn (the quality governor's first saving). 0 = none. */
  denseShare = 1;
  private share: Float32Array = new Float32Array(MAX_ORBITALS);
  private look: THREE.DataTexture;
  private data: Float32Array;
  private w = 1;
  private h = 1;
  set: OrbitalSet | null = null;
  /** The share of every orbital's points drawn on top of its own (the quality governor's
   *  thinning); light per point rises to make up for most of it. 1 = all. */
  density = 1;
  /** What render() clears the screen to first; null leaves the screen as it is. */
  background: number | null = LAB_BG;

  constructor(opts: { halfFloat: boolean }) {
    this.data = new Float32Array(MAX_ORBITALS * 3 * 4);
    this.look = new THREE.DataTexture(this.data, MAX_ORBITALS, 3, THREE.RGBAFormat, THREE.FloatType);
    this.look.minFilter = THREE.NearestFilter;
    this.look.magFilter = THREE.NearestFilter;
    this.look.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: POINT_FRAG,
      uniforms: {
        uTime: { value: 0 }, uSize: { value: 2 }, uAlpha: { value: 0.3 }, uTwinkle: { value: 0.5 },
        uLook: { value: this.look }, uHalf: { value: new THREE.Vector3(0, 0, 1) }, uFire: { value: 0 }, uHue: { value: 0 },
        uPulse: { value: new THREE.Vector4(0, 1, 0, 0) }, uPulseCol: { value: new THREE.Vector3(1, 1, 1) },
      },
      ...ADD_BLEND,
    });
    this.layer = new VolumePass(null, {}, { halfFloat: opts.halfFloat, smooth: false, tone: true });
    this.layer.scale = 1;
  }

  setSet(set: OrbitalSet, worldPerA0: number): void {
    this.set = set;
    this.worldPerA0 = worldPerA0;
    this.wantDense([], 0);
    for (const p of this.parts) { this.scene.remove(p); p.geometry.dispose(); }
    this.parts = set.orbitals.map((o) => {
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'seed', 'orbital', 'sgn']) g.setAttribute(name, set.geometry.getAttribute(name));
      g.setDrawRange(o.start, o.count);
      g.boundingSphere = set.geometry.boundingSphere;
      const p = new THREE.Points(g, this.material);
      p.frustumCulled = false;
      p.scale.setScalar(worldPerA0);
      this.scene.add(p);
      return p;
    });
    this.share.fill(1);
  }

  /** Points drawn this frame. */
  get drawn(): number {
    let n = 0;
    for (const p of this.parts) if (p.visible) n += p.geometry.drawRange.count;
    for (const e of this.dense.values()) if (e.points?.visible) n += e.points.geometry.drawRange.count;
    return n;
  }

  /**
   * Which orbitals get dense extra points (`count` each at full weight), by weight (0 to 1:
   * drawn in proportion, so a focus moving on fades out). Ones no longer wanted are dropped
   * from the drawing (their samples stay cached).
   */
  wantDense(wants: DenseWant[], count: number): void {
    const set = this.set;
    const keep = new Set<number>();
    if (set && count >= 1) {
      for (const w of wants) {
        let e = this.dense.get(w.index);
        if (!e || e.d.set !== set || e.d.count !== Math.round(count)) {
          if (e?.points) this.scene.remove(e.points);
          e = { d: denseOrbital(set, w.index, Math.round(count)), weight: 0, points: null };
          this.dense.set(w.index, e);
        }
        e.weight = Math.max(0, Math.min(1, w.weight));
        keep.add(w.index);
      }
    }
    for (const [i, e] of this.dense) {
      if (keep.has(i)) continue;
      if (e.points) this.scene.remove(e.points);
      this.dense.delete(i);
    }
  }

  /** Sample the wanted dense orbitals (strongest first) for about `ms` milliseconds, only those
   *  weighted over `min`. True when nothing is left to sample. */
  sampleDense(ms: number, min = 0.5): boolean {
    if (this.denseShare <= 0) return true;
    const until = performance.now() + ms;
    const order = [...this.dense.values()].filter((e) => e.weight >= min).sort((a, b) => b.weight - a.weight);
    for (const e of order) {
      const left = until - performance.now();
      if (left <= 0) return false;
      if (!e.d.step(left, e.d.count * this.denseShare)) return false;
    }
    return true;
  }

  /** Set one orbital's look (uploaded on the next render). */
  setLook(i: number, l: OrbitalLook): void {
    this.share[i] = l.share ?? 1;
    const d = this.data;
    const row = (r: number) => (r * MAX_ORBITALS + i) * 4;
    d.set([l.pos[0], l.pos[1], l.pos[2], l.gain], row(0));
    d.set([l.neg[0], l.neg[1], l.neg[2], l.sat], row(1));
    d.set([l.twinkle, l.breath, l.glint, l.flash], row(2));
  }

  /** The key light for glints: from the upper left, in view space. */
  private static readonly HALF = new THREE.Vector3(-0.35, 0.45, 1).normalize();

  /** The layer's resolution as a share of the screen's, each side (1 = full). */
  get pixelScale(): number { return this.layer.scale; }
  set pixelScale(v: number) {
    if (v === this.layer.scale) return;
    this.layer.scale = v;
    // A coarse layer upscales smoothly (B-spline), so points don't turn into blocks.
    this.layer.smooth = v < 0.75;
    this.layer.resize(this.w, this.h);
  }

  resize(ctx: { width: number; height: number }): void {
    this.w = ctx.width;
    this.h = ctx.height;
    this.layer.resize(ctx.width, ctx.height);
  }

  /** Draw a whole frame: clear to the background (if any), then the cloud. */
  render(ctx: CloudContext, time: number): void {
    this.renderLayer(ctx, time);
    if (this.background != null) {
      ctx.renderer.setClearColor(this.background, 1);
      ctx.renderer.clear();
    }
    this.draw(ctx.renderer);
  }

  /** Render the points into the off-screen layer (draw() then puts it on the screen). */
  renderLayer(ctx: CloudContext, time: number): void {
    const { renderer, camera } = ctx;
    const u = this.material.uniforms;
    const density = Math.max(0.01, Math.min(1, this.density));
    u.uTime.value = time;
    // Point sizes follow the layer's resolution, so a coarser layer keeps the same look.
    u.uSize.value = Math.max(1.3, ctx.height / 560) * camera.position.length() * this.layer.scale;
    (u.uHalf.value as THREE.Vector3).copy(OrbitalCloud.HALF);
    this.look.needsUpdate = true;
    const set = this.set!;
    const base = this.drawnBase;
    this.parts.forEach((p, i) => {
      const o = set.orbitals[i];
      const n = Math.min(set.filled[i], Math.round(o.count * Math.max(0, Math.min(1, this.share[i] * density))));
      p.visible = n > 0 && this.data[i * 4 + 3] > 0.002;
      p.geometry.setDrawRange(o.start, n);
      base[i] = n;
    });
    // Dense orbitals: their points join the base ones, and every point of that orbital gives
    // less light, as balancedGain would for the larger count, so a denser orbital reads as a
    // smoother, fuller body rather than a brighter one.
    for (const [i, e] of this.dense) {
      const geo = e.d.geometry;
      const nb = base[i] ?? 0;
      const nd = geo && nb > 0 && this.data[i * 4 + 3] > 0.002 ? Math.min(e.d.filled, Math.round(e.d.count * this.denseShare * e.weight)) : 0;
      if (nd > 0 && !e.points) {
        e.points = new THREE.Points(geo!, this.material);
        e.points.frustumCulled = false;
        e.points.scale.setScalar(this.worldPerA0);
        this.scene.add(e.points);
      }
      if (!e.points) continue;
      e.points.visible = nd > 0;
      e.points.geometry.setDrawRange(0, nd);
      if (nd > 0) this.data[i * 4 + 3] *= Math.pow(nb / (nb + nd), DENSE_GAIN);
    }
    // Fewer points each carry more light, so thinning costs detail, not brightness.
    const alpha = u.uAlpha.value as number;
    u.uAlpha.value = alpha * Math.pow(1 / density, 0.75);
    this.layer.renderScene(renderer, this.scene, camera);
    u.uAlpha.value = alpha;
  }

  /** Composite the layer over the screen. */
  draw(renderer: THREE.WebGLRenderer): void {
    this.layer.draw(renderer);
  }

  get size(): string {
    return `${this.layer.width}×${this.layer.height}`;
  }

  private drawnBase = new Int32Array(MAX_ORBITALS);

  dispose(): void {
    for (const p of this.parts) p.geometry.dispose();
    this.wantDense([], 0);
    this.layer.dispose();
    this.material.dispose();
    this.look.dispose();
  }
}

// ---- colors -------------------------------------------------------------------------------

/** HSL (0-1 each) to raw display RGB, without three's color management. */
export function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Phase colors (lisyarus warm / blue) as raw RGB. */
export const PHASE: [[number, number, number], [number, number, number]] = [[0.91, 0.627, 0.376], [0.373, 0.604, 0.878]];

/** The app's subshell hues, with a deeper twin for the negative lobes. */
export const BLOCK_RGB: Record<Block, [[number, number, number], [number, number, number]]> = {
  s: [hsl(0.61, 0.66, 0.62), hsl(0.58, 0.6, 0.44)],
  p: [hsl(0.44, 0.6, 0.5), hsl(0.41, 0.55, 0.36)],
  d: [hsl(0.1, 0.72, 0.52), hsl(0.07, 0.65, 0.4)],
  f: [hsl(0.77, 0.58, 0.62), hsl(0.74, 0.5, 0.46)],
};

/** Light per point that keeps each orbital about as bright as the Dense cloud shows a single
 *  orbital (150k points), whatever its own count, for a view framed on radius `frame` (a0):
 *  an orbital much smaller than the view gives less, so the core never flares. */
export function balancedGain(o: OrbitalInfo, _set: OrbitalSet, frame: number): number {
  const area = Math.min(1.2, o.r90 / frame);
  return Math.pow(150_000 / o.count, 0.7) * Math.max(0.08, Math.pow(area, 1.4));
}

/** How much of a dimmed orbital's veil to keep for a view framed on `frame` (a0): orbitals far
 *  smaller than the view would pile their share into a bright dot, and ones far larger only
 *  scatter specks past the edges, so both thin out. */
export function veilScale(o: OrbitalInfo, frame: number): number {
  const k = o.r90 / frame;
  return k < 1 ? Math.pow(k, 1.2) : Math.pow(1 / k, 2);
}
