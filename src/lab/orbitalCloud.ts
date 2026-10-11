// The atom split into its real orbitals, each as its own dense point cloud, for the
// Fingerprint and Explorer experiments. Every occupied orbital of every subshell is kept
// apart (a closed 3d is five clouds, not one round shell), so any one of them can be lit,
// tinted, dimmed or hidden on its own. Per-orbital looks live in a small float texture the
// vertex shader reads (texelFetch), so changing them costs one tiny upload per frame and the
// points themselves never change after sampling.
//
// Twinkle, glints and the tap ripple are all functions of time and each point's own seed, in
// the shader: zero CPU per point per frame.

import * as THREE from 'three';
import { L_OF, type Block, type Element } from '../gallery/data';
import { mulberry32 } from '../gallery/orbital';
import { ADD_BLEND } from './glsl';
import { mChoices, sampleTerm, selectTerms, type Term } from './model';
import { POINT_FRAG } from './experiments/particles';
import { LAB_BG, VolumePass } from './volume';
import type { LabContext } from './types';

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

const sets = new Map<string, OrbitalSet>();

/**
 * Sample every orbital of an atom. `perOrbital` points go to the largest orbital; smaller
 * ones get fewer (down to 40%), and the whole set is capped at `budget`.
 */
export function orbitalSet(e: Element, perOrbital: number, budget: number): OrbitalSet {
  const key = `${e.z}/${perOrbital}/${budget}`;
  const hit = sets.get(key);
  if (hit) return hit;
  const list = orbitalTerms(e);
  const rand = mulberry32(e.z * 7919 + 17);
  // A quick pilot per orbital for its size and shape.
  const PILOT = 1500;
  const buf = new Float32Array(3);
  const pilots = list.map((o) => {
    const radii: number[] = [];
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < PILOT; i++) {
      sampleTerm(o.term, rand, buf, 0);
      // Physics (x, y, z) → scene (x, z, y).
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
      shape: (o.term.l === 0 || anisotropy < 0.05 ? 'round' : prolate ? 'prolate' : 'oblate') as OrbitalInfo['shape'],
      anisotropy,
    };
  });
  const rmax = Math.max(...pilots.map((p) => p.r90));
  let counts = pilots.map((p) => Math.round(perOrbital * Math.max(0.4, Math.min(1, Math.sqrt(p.r90 / rmax)))));
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum > budget) counts = counts.map((c) => Math.max(800, Math.round((c * budget) / sum)));
  const total = counts.reduce((a, b) => a + b, 0);

  const pos = new Float32Array(total * 3);
  const seed = new Float32Array(total);
  const termA = new Float32Array(total);
  const sign = new Float32Array(total);
  const orbitals: OrbitalInfo[] = [];
  let at = 0;
  list.forEach((o, i) => {
    const n = counts[i];
    for (let k = 0; k < n; k++) {
      const s = sampleTerm(o.term, rand, buf, 0);
      const j = at + k;
      pos[j * 3] = buf[0];
      pos[j * 3 + 1] = buf[2];
      pos[j * 3 + 2] = buf[1];
      seed[j] = rand();
      termA[j] = i;
      sign[j] = s;
    }
    const p = pilots[i];
    orbitals.push({
      index: i, term: o.term, key: o.key, label: o.label, n: o.term.n, l: o.term.l, block: o.term.block,
      sub: o.sub, mIndex: o.mIndex, electrons: o.electrons, r50: p.r50, r90: p.r90,
      axis: p.axis, shape: p.shape, anisotropy: p.anisotropy, start: at, count: n,
    });
    at += n;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('orbital', new THREE.BufferAttribute(termA, 1));
  g.setAttribute('sgn', new THREE.BufferAttribute(sign, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rmax * 3);
  const set: OrbitalSet = { element: e, orbitals, geometry: g, total, r90: rmax };
  if (sets.size > 6) {
    for (const s of sets.values()) s.geometry.dispose();
    sets.clear();
  }
  sets.set(key, set);
  return set;
}

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

/** Draws an OrbitalSet as additive points into a tone-mapped half-float layer. */
export class OrbitalCloud {
  readonly scene = new THREE.Scene();
  readonly material: THREE.ShaderMaterial;
  private layer: VolumePass;
  /** One Points per orbital, all sharing the set's buffers, each with its own draw range:
   *  a dimmed orbital draws only a random share of its points (they were sampled in random
   *  order, so any prefix is a fair thinning), which is both the ghost look and the saving. */
  private parts: THREE.Points[] = [];
  private share: Float32Array = new Float32Array(MAX_ORBITALS);
  private look: THREE.DataTexture;
  private data: Float32Array;
  set: OrbitalSet | null = null;

  constructor(ctx: LabContext) {
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
    this.layer = new VolumePass(null, {}, { halfFloat: ctx.halfFloat, smooth: false, tone: true });
    this.layer.scale = 1;
  }

  setSet(set: OrbitalSet, worldPerA0: number): void {
    this.set = set;
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
    return n;
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

  resize(ctx: LabContext): void {
    this.layer.resize(ctx.width, ctx.height);
  }

  render(ctx: LabContext, time: number): void {
    const { renderer, camera } = ctx;
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uSize.value = Math.max(1.3, ctx.height / 560) * camera.position.length();
    (u.uHalf.value as THREE.Vector3).copy(OrbitalCloud.HALF);
    this.look.needsUpdate = true;
    this.parts.forEach((p, i) => {
      const o = this.set!.orbitals[i];
      const n = Math.round(o.count * Math.max(0, Math.min(1, this.share[i])));
      p.visible = n > 0 && this.data[i * 4 + 3] > 0.002;
      p.geometry.setDrawRange(o.start, n);
    });
    this.layer.renderScene(renderer, this.scene, camera);
    renderer.setClearColor(LAB_BG, 1);
    renderer.clear();
    this.layer.draw(renderer);
  }

  get size(): string {
    return `${this.layer.width}×${this.layer.height}`;
  }

  dispose(): void {
    for (const p of this.parts) p.geometry.dispose();
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
