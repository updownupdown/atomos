// Shared GLSL for the lab's ray-marched experiments: the wavefunction of every shown orbital,
// evaluated analytically per sample (hydrogen-like radial functions with Slater's effective
// charge, real spherical harmonics), the radius table for spherical terms, the camera ray,
// the cutaway wedge, noise and colormaps. Plus the uniforms that feed it and the code that
// loads a model into them.

import * as THREE from 'three';
import { BLOCK_COLOUR, type Block } from '../gallery/data';
import { sphericalTable, type AtomModel, type Term } from './model';

export const MAX_TERMS = 24;
export const TABLE_N = 2048;

/** A CSS hex color as raw display values: the lab's shaders write display colors directly. */
export function srgb(hex: string): THREE.Color {
  return new THREE.Color().setHex(parseInt(hex.replace('#', ''), 16), THREE.LinearSRGBColorSpace);
}

/** Phase colors: warm for psi > 0, blue for psi < 0 (after lisyarus). */
export const PHASE_POS = srgb('#e8a060');
export const PHASE_NEG = srgb('#5f9ae0');

/** Pure additive blending (ONE, ONE): shaders write premultiplied light and alpha 0, so the
 *  background is never darkened. three's AdditiveBlending scales by source alpha instead. */
export const ADD_BLEND = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

export const BLOCK_INDEX: Record<Block, number> = { s: 0, p: 1, d: 2, f: 3 };

export type ColorMode = 'phase' | 'block';

export const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const FIELD_GLSL = /* glsl */ `
#define MAX_TERMS ${MAX_TERMS}
#define TABLE_N ${TABLE_N}
#define PI 3.14159265359
uniform int uTerms;
uniform vec4 uTermA[MAX_TERMS]; // n, l, m (99 = no angular factor), zeff
uniform vec4 uTermB[MAX_TERMS]; // sqrt(electrons) * norm, block
uniform vec3 uTermPos[MAX_TERMS];
uniform vec3 uTermNeg[MAX_TERMS];
uniform sampler2D uTable;      // spherical terms by radius, s/p/d/f in rgba, divided by uTablePeak
uniform float uTableOn;
uniform float uTablePeak;
uniform float uBound;          // a0
uniform vec3 uBlockCol[4];

uniform mat4 uInvViewProj;
uniform vec3 uCamPos;          // scene units
uniform float uWorldPerA0;
uniform vec3 uCutDir;          // horizontal, toward the camera
uniform float uCut;            // 0 none, 1 the front half

float laguerreG(int k, float a, float x) {
  if (k == 0) return 1.0;
  float l0 = 1.0;
  float l1 = 1.0 + a - x;
  for (int i = 1; i < 8; i++) {
    if (i >= k) break;
    float fi = float(i);
    float l2 = ((2.0 * fi + 1.0 + a - x) * l1 - (fi + a) * l0) / (fi + 1.0);
    l0 = l1;
    l1 = l2;
  }
  return l1;
}

// The gallery's radial(n, l, x), x = Z r.
float radialH(int n, int l, float x) {
  float rho = 2.0 * x / float(n);
  float p = 1.0;
  for (int i = 0; i < 4; i++) { if (i >= l) break; p *= rho; }
  return p * exp(-0.5 * rho) * laguerreG(n - l - 1, float(2 * l + 1), rho);
}

// The gallery's harmonic(l, m, x, y, z) on a unit vector (physics frame, z up).
float harmonicR(int l, int m, vec3 u) {
  float x = u.x, y = u.y, z = u.z;
  if (l == 0) return 1.0;
  if (l == 1) return m == -1 ? y : (m == 0 ? z : x);
  if (l == 2) {
    if (m == -2) return x * y;
    if (m == -1) return y * z;
    if (m == 0) return (3.0 * z * z - 1.0) * 0.28867513;
    if (m == 1) return x * z;
    return (x * x - y * y) * 0.5;
  }
  if (m == -3) return y * (3.0 * x * x - y * y);
  if (m == -2) return x * y * z;
  if (m == -1) return y * (5.0 * z * z - 1.0);
  if (m == 0) return z * (5.0 * z * z - 3.0);
  if (m == 1) return x * (5.0 * z * z - 1.0);
  if (m == 2) return z * (x * x - y * y);
  return x * (x * x - 3.0 * y * y);
}

// psi of term i at q (physics frame, a0), scaled so psi^2 is its electron density.
float termPsi(int i, vec3 q, float r) {
  vec4 a = uTermA[i];
  int n = int(a.x + 0.5), l = int(a.y + 0.5), m = int(a.z + (a.z < 0.0 ? -0.5 : 0.5));
  float v = uTermB[i].x * radialH(n, l, a.w * r);
  if (m != 99) v *= harmonicR(l, m, q / max(r, 1e-6));
  return v;
}

vec4 tableAt(float r) {
  float u = sqrt(clamp(r / uBound, 0.0, 1.0)) * float(TABLE_N - 1);
  int i = int(u);
  float f = u - float(i);
  vec4 a = texelFetch(uTable, ivec2(i, 0), 0);
  vec4 b = texelFetch(uTable, ivec2(min(i + 1, TABLE_N - 1), 0), 0);
  return mix(a, b, f) * uTablePeak;
}

// Electron density at q (a0^-3).
float fieldDensity(vec3 q) {
  float r = length(q);
  float d = 0.0;
  if (uTableOn > 0.5) { vec4 t = tableAt(r); d = t.x + t.y + t.z + t.w; }
  for (int i = 0; i < MAX_TERMS; i++) {
    if (i >= uTerms) break;
    float p = termPsi(i, q, r);
    d += p * p;
  }
  return d;
}

// Electron density at q, with col the density-weighted color (phase or block) of what is there.
float fieldColor(vec3 q, out vec3 col) {
  float r = length(q);
  float d = 0.0;
  col = vec3(0.0);
  if (uTableOn > 0.5) {
    vec4 t = tableAt(r);
    d = t.x + t.y + t.z + t.w;
    col = t.x * uBlockCol[0] + t.y * uBlockCol[1] + t.z * uBlockCol[2] + t.w * uBlockCol[3];
  }
  for (int i = 0; i < MAX_TERMS; i++) {
    if (i >= uTerms) break;
    float p = termPsi(i, q, r);
    float pd = p * p;
    d += pd;
    col += pd * (p >= 0.0 ? uTermPos[i] : uTermNeg[i]);
  }
  return d;
}

// Signed: the sum of psi over the terms (one orbital: its psi), for isosurfaces by sign.
float fieldPsi(vec3 q) {
  float r = length(q);
  float s = 0.0;
  for (int i = 0; i < MAX_TERMS; i++) {
    if (i >= uTerms) break;
    s += termPsi(i, q, r);
  }
  return s;
}

// Scene (y up) to physics frame (z up).
vec3 toPhys(vec3 p) { return vec3(p.x, p.z, p.y); }

// The camera ray through this pixel, in a0.
void cameraRay(vec2 uv, out vec3 ro, out vec3 rd) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 a = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(ndc, 1.0, 1.0);
  a /= a.w;
  b /= b.w;
  ro = uCamPos / uWorldPerA0;
  rd = normalize(b.xyz - a.xyz);
}

bool sphereHit(vec3 ro, vec3 rd, float R, out float t0, out float t1) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return false;
  float s = sqrt(disc);
  t0 = max(-b - s, 0.0);
  t1 = -b + s;
  return t1 > t0;
}

// The cutaway: a wedge round the vertical axis, facing the camera, removed.
bool cutAway(vec3 p) {
  if (uCut <= 0.001) return false;
  float h = length(p.xz);
  if (h < 1e-6) return false;
  return dot(p.xz / h, uCutDir.xz) > cos(uCut * 1.5707963);
}

// Interleaved gradient noise: a cheap blue-ish per-pixel offset that hides step banding.
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 inferno(float t) {
  t = clamp(t, 0.0, 1.0);
  const vec3 c0 = vec3(0.0002189403691192265, 0.001651004631001012, -0.01948089843709184);
  const vec3 c1 = vec3(0.1065134194856116, 0.5639564367884091, 3.932712388889277);
  const vec3 c2 = vec3(11.60249308247187, -3.972853965665698, -15.9423941062914);
  const vec3 c3 = vec3(-41.70399613139459, 17.43639888205313, 44.35414519872813);
  const vec3 c4 = vec3(77.162935699427, -33.40235894210092, -81.80730925738993);
  const vec3 c5 = vec3(-71.31942824499214, 32.62606426397723, 73.20951985803202);
  const vec3 c6 = vec3(25.13112622477341, -12.24266895238567, -23.07032500287172);
  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), 0.0, 1.0);
}
`;

/** Fresh uniforms for FIELD_GLSL. */
export function fieldUniforms(): Record<string, THREE.IUniform> {
  const table = new THREE.DataTexture(new Float32Array(TABLE_N * 4), TABLE_N, 1, THREE.RGBAFormat, THREE.FloatType);
  table.needsUpdate = true;
  return {
    uTerms: { value: 0 },
    uTermA: { value: Array.from({ length: MAX_TERMS }, () => new THREE.Vector4()) },
    uTermB: { value: Array.from({ length: MAX_TERMS }, () => new THREE.Vector4()) },
    uTermPos: { value: Array.from({ length: MAX_TERMS }, () => new THREE.Vector3()) },
    uTermNeg: { value: Array.from({ length: MAX_TERMS }, () => new THREE.Vector3()) },
    uTable: { value: table },
    uTableOn: { value: 0 },
    uTablePeak: { value: 1 },
    uBound: { value: 1 },
    uBlockCol: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    uInvViewProj: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uWorldPerA0: { value: 1 },
    uCutDir: { value: new THREE.Vector3(0, 0, 1) },
    uCut: { value: 0 },
  };
}

/** The app's subshell colors, brightened a touch for light on black. */
export function blockColor(b: Block): THREE.Color {
  return srgb(BLOCK_COLOUR[b]);
}

/** A term's two colors: phase (warm / blue by sign), or its block color with the negative
 *  lobes a little deeper so the sign still reads. */
export function termColors(t: Term, mode: ColorMode): [THREE.Color, THREE.Color] {
  if (mode === 'phase') return [PHASE_POS.clone(), PHASE_NEG.clone()];
  const c = blockColor(t.block);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const neg = new THREE.Color().setHSL((hsl.h + 0.975) % 1, hsl.s * 0.9, hsl.l * 0.72);
  return [c, neg];
}

/**
 * Load a model into field uniforms. With `table`, spherical terms go into the radius table
 * (one texture read per sample however many closed shells there are); without, every term
 * is evaluated analytically and keeps its sign.
 */
export function applyModel(u: Record<string, THREE.IUniform>, model: AtomModel, mode: ColorMode, table: boolean): void {
  const explicit = table ? model.terms.filter((t) => !t.spherical) : model.terms;
  const n = Math.min(MAX_TERMS, explicit.length);
  u.uTerms.value = n;
  for (let i = 0; i < n; i++) {
    const t = explicit[i];
    (u.uTermA.value[i] as THREE.Vector4).set(t.n, t.l, t.m == null ? 99 : t.m, t.zeff);
    (u.uTermB.value[i] as THREE.Vector4).set(Math.sqrt(t.weight) * t.norm, BLOCK_INDEX[t.block], 0, 0);
    const [pos, neg] = termColors(t, mode);
    (u.uTermPos.value[i] as THREE.Vector3).set(pos.r, pos.g, pos.b);
    (u.uTermNeg.value[i] as THREE.Vector3).set(neg.r, neg.g, neg.b);
  }
  const hasTable = table && model.terms.some((t) => t.spherical);
  u.uTableOn.value = hasTable ? 1 : 0;
  if (hasTable) {
    const tex = u.uTable.value as THREE.DataTexture;
    (tex.image.data as Float32Array).set(sphericalTable(model, TABLE_N));
    tex.needsUpdate = true;
  }
  u.uTablePeak.value = model.peak;
  u.uBound.value = model.bound;
  u.uWorldPerA0.value = model.worldPerA0;
  (['s', 'p', 'd', 'f'] as Block[]).forEach((b, i) => {
    const c = mode === 'phase' ? PHASE_POS : blockColor(b);
    (u.uBlockCol.value[i] as THREE.Vector3).set(c.r, c.g, c.b);
  });
}

/** Camera uniforms for this frame. */
export function applyCamera(u: Record<string, THREE.IUniform>, camera: THREE.PerspectiveCamera, cut: number): void {
  camera.updateMatrixWorld();
  (u.uInvViewProj.value as THREE.Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
  (u.uCamPos.value as THREE.Vector3).copy(camera.position);
  const d = new THREE.Vector3(camera.position.x, 0, camera.position.z);
  if (d.lengthSq() < 1e-8) d.set(0, 0, 1);
  (u.uCutDir.value as THREE.Vector3).copy(d.normalize());
  u.uCut.value = cut;
}
