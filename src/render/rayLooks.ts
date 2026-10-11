// The atom View's ray-marched styles, beside the particle cloud (OrbitalCloud): each is one of
// the lab's experiments with its settings fixed (no cutaway, brightness 1, the region holding
// 80% of the electrons), drawn into a reduced-resolution VolumePass layer:
//   Volumetric  "Phase glow (volumetric)", colored by the atom's fingerprint palette;
//   Solid       "Phase solid (isosurface)", phase colors;
//   Density     "Density inferno";
//   Neon        "Probability shells (neon)", phase colors, the 80% skin strongest.
// The fragment shaders live here and the lab's experiments use them too.
//
// What they draw follows the Orbital explorer: the focused orbital alone (with its sign, so the
// phase colors read) while the focus is solo or ghost, the whole atom once it opens up to all.
// Models are built on first use, from fewer samples than the lab's (quicker, a little rougher),
// cached per orbital, and the next ones along the ladder are built ahead on quiet frames.

import * as THREE from 'three';
import { FIELD_GLSL, PHASE_NEG, PHASE_POS, applyCamera, applyModel, fieldUniforms } from './field';
import { NEON_GLSL } from './gl';
import { buildModel, type AtomModel, type Level, type Term } from './model';
import type { Fingerprint } from './fingerprint';
import type { QualityLevel } from './governor';
import type { OrbitalExplorer } from './explorer';
import type { OrbitalSet } from './orbitalCloud';
import { SURFACE_GLSL, cameraLight } from './surface';
import { VolumePass, type VolumeOptions } from './volume';

// ---- the shaders (shared with the lab) --------------------------------------------------------

/** Phase glow: front-to-back emission and absorption in proportion to |psi|^2, each step the
 *  color of psi's sign (or whatever colors the terms carry). */
export const GLOW_FRAG = /* glsl */ `
precision highp float;
${FIELD_GLSL}
in vec2 vUv;
uniform int uSteps;
uniform float uDensityK; // optical depth per a0 at the shown level
uniform float uLevel;    // density at the shown region's edge
out vec4 fragColor;

void main() {
  vec3 ro, rd;
  cameraRay(vUv, ro, rd);
  float t0, t1;
  if (!sphereHit(ro, rd, uBound, t0, t1)) { fragColor = vec4(0.0); return; }
  float dt = (t1 - t0) / float(uSteps);
  float jitter = ign(gl_FragCoord.xy);
  vec3 light = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 400; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (t0 + dt * (float(i) + jitter));
    if (cutAway(p)) continue;
    vec3 col;
    float d = fieldColor(toPhys(p), col);
    if (d <= 0.0) continue;
    // Emission and absorption alike scale with density relative to the shown level.
    float a = 1.0 - exp(-uDensityK * d / uLevel * dt);
    light += (1.0 - alpha) * a * (col / d);
    alpha += (1.0 - alpha) * a;
    if (alpha > 0.995) break;
  }
  fragColor = vec4(light, alpha);
}`;

/** Phase solid: the region's boundary surface, lit as an object (half-Lambert, Blinn, rim). */
export const SOLID_FRAG = /* glsl */ `
precision highp float;
${FIELD_GLSL}
${SURFACE_GLSL}
in vec2 vUv;
uniform int uSteps;
uniform vec3 uLight;
uniform float uBrightness;
uniform float uPeak;
out vec4 fragColor;

void main() {
  vec3 ro, rd;
  cameraRay(vUv, ro, rd);
  float t0, t1;
  if (!sphereHit(ro, rd, uBound, t0, t1)) { fragColor = vec4(0.0); return; }
  bool cutFace;
  float glow;
  float t = findSurface(ro, rd, t0, t1, uSteps, cutFace, glow);
  if (t < 0.0) { fragColor = vec4(0.0); return; }
  vec3 p = ro + rd * t;
  vec3 col;
  float d = fieldColor(toPhys(p), col);
  vec3 base = col / max(d, 1e-30);
  vec3 n;
  if (cutFace) {
    n = cutNormal(p);
    // Inside: brighter where denser (log scale up to the peak), like a cross-section.
    float k = clamp(log(d / uLevel) / log(max(uPeak / uLevel, 1.001)), 0.0, 1.0);
    base *= 0.35 + 0.9 * sqrt(k);
  } else {
    n = densityNormal(p, max(uBound * 0.002, length(p) * 0.004));
  }
  vec3 v = -rd;
  vec3 h = normalize(uLight + v);
  float diff = 0.5 + 0.5 * dot(n, uLight);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.45;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 c = base * (0.16 + 0.95 * diff * diff) + vec3(spec) + base * rim * 0.35;
  fragColor = vec4(c * uBrightness, 1.0);
}`;

/** Density inferno: log density from the region's edge (0) to the peak (1), the densest
 *  material along the ray choosing the color, through the inferno colormap. */
export const INFERNO_FRAG = /* glsl */ `
precision highp float;
${FIELD_GLSL}
in vec2 vUv;
uniform int uSteps;
uniform float uLogLevel; // log10 of the shown region's edge density
uniform float uLogPeak;
uniform float uExposure;
out vec4 fragColor;

void main() {
  vec3 ro, rd;
  cameraRay(vUv, ro, rd);
  float t0, t1;
  if (!sphereHit(ro, rd, uBound, t0, t1)) { fragColor = vec4(0.0); return; }
  float dt = (t1 - t0) / float(uSteps);
  float jitter = ign(gl_FragCoord.xy);
  float alpha = 0.0, wSum = 0.0, wnSum = 0.0;
  for (int i = 0; i < 400; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (t0 + dt * (float(i) + jitter));
    if (cutAway(p)) continue;
    float d = fieldDensity(toPhys(p));
    if (d <= 0.0) continue;
    float norm = (log(d) * 0.4342945 - uLogLevel) / max(uLogPeak - uLogLevel, 1e-3);
    if (norm <= 0.0) continue;
    norm = min(norm, 1.0);
    float a = 1.0 - exp(-40.0 * norm * uExposure * dt / uBound);
    float n2 = norm * norm, n4 = n2 * n2;
    float w = (1.0 - alpha) * a * n4 * n4;
    wSum += w;
    wnSum += w * norm;
    alpha += (1.0 - alpha) * a;
    if (alpha > 0.98) break;
  }
  float nm = wSum > 0.0 ? wnSum / wSum : 0.0;
  fragColor = vec4(inferno(nm) * alpha, alpha);
}`;

/** Probability shells: light only near four region boundaries (log density), nested skins. */
export const NEON_FRAG = /* glsl */ `
precision highp float;
${FIELD_GLSL}
${NEON_GLSL}
in vec2 vUv;
uniform int uSteps;
uniform vec4 uLogLevels;
uniform vec4 uWeights;
uniform float uWidth;
uniform float uEmit;
out vec4 fragColor;

void main() {
  vec3 ro, rd;
  cameraRay(vUv, ro, rd);
  float t0, t1;
  if (!sphereHit(ro, rd, uBound, t0, t1)) { fragColor = vec4(0.0); return; }
  float dt = (t1 - t0) / float(uSteps);
  float jitter = ign(gl_FragCoord.xy);
  vec3 light = vec3(0.0);
  for (int i = 0; i < 400; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (t0 + dt * (float(i) + jitter));
    if (cutAway(p)) continue;
    vec3 col;
    float d = fieldColor(toPhys(p), col);
    if (d <= 0.0) continue;
    float lg = log(d) * 0.4342945;
    float e = neonSkins(lg, uLogLevels, uWeights, uWidth);
    light += (col / d) * e * uEmit * dt;
  }
  fragColor = vec4(light, 0.0);
}`;

// ---- the app's styles -------------------------------------------------------------------------

export type ViewLook = 'particles' | 'volumetric' | 'solid' | 'density' | 'neon';
export type RayLook = Exclude<ViewLook, 'particles'>;

export const VIEW_LOOKS: { id: ViewLook; label: string }[] = [
  { id: 'particles', label: 'Particles' },
  { id: 'volumetric', label: 'Volumetric' },
  { id: 'solid', label: 'Solid' },
  { id: 'density', label: 'Density' },
  { id: 'neon', label: 'Neon' },
];

export function isViewLook(v: unknown): v is ViewLook {
  return VIEW_LOOKS.some((l) => l.id === v);
}

/** The share of the electrons the shown region holds. */
const REGION: Level = 80;
/** Neon's four skins, the region's the strongest. */
const NEON_SKINS: Level[] = [50, 80, 90, 99];
/** Samples per model: a third of the lab's, so a new orbital costs a few ms, not tens. */
const MODEL_SAMPLES = 8000;
/** The whole atom puts its closed subshells in the radius table (one texture read a sample,
 *  losing their sign) once it has more terms than this to evaluate. */
const MAX_EXPLICIT = 12;
/** What the explorer shows at or above this context: the whole atom. */
const ALL_FROM = 0.75;

type RGB = [number, number, number];

interface StyleSpec {
  frag: string;
  colors: 'print' | 'phase' | 'none';
  /** Base ray-march steps (at the best quality level). */
  steps: number;
  /** Ray samples per CSS pixel each side, at the best quality level. */
  res: number;
  volume: Omit<VolumeOptions, 'halfFloat'>;
  extras(): Record<string, THREE.IUniform>;
  /** Settings into uniforms for a model (the lab's refresh at 80%, brightness 1, no cut). */
  refresh(u: Record<string, THREE.IUniform>, m: AtomModel, pass: VolumePass): void;
}

const STYLES: Record<RayLook, StyleSpec> = {
  volumetric: {
    frag: GLOW_FRAG, colors: 'print', steps: 80, res: 0.75, volume: { smooth: true },
    extras: () => ({ uDensityK: { value: 1 }, uLevel: { value: 1 } }),
    refresh(u, m) {
      u.uLevel.value = m.levels[REGION];
      u.uDensityK.value = 0.4 / m.bound;
    },
  },
  solid: {
    // Surfaces want sharp edges: more pixels than the soft volumes; steps are cheap.
    frag: SOLID_FRAG, colors: 'phase', steps: 108, res: 1, volume: { smooth: false },
    extras: () => ({ uLevel: { value: 1 }, uLight: { value: new THREE.Vector3(0, 1, 0) }, uBrightness: { value: 1 }, uPeak: { value: 1 } }),
    refresh(u, m) {
      u.uLevel.value = m.levels[REGION];
      u.uPeak.value = m.peak;
      u.uBrightness.value = 1;
    },
  },
  density: {
    frag: INFERNO_FRAG, colors: 'none', steps: 80, res: 0.75, volume: { smooth: true },
    extras: () => ({ uLogLevel: { value: -3 }, uLogPeak: { value: 0 }, uExposure: { value: 1 } }),
    refresh(u, m) {
      u.uLogLevel.value = Math.log10(m.levels[REGION]);
      // Cap the scale four decades above the edge so the outer shells keep the colormap's middle.
      u.uLogPeak.value = Math.min(Math.log10(m.peak), u.uLogLevel.value + 4);
      u.uExposure.value = 1;
    },
  },
  neon: {
    frag: NEON_FRAG, colors: 'phase', steps: 112, res: 0.75, volume: { smooth: true, halo: true, tone: true },
    extras: () => ({ uLogLevels: { value: new THREE.Vector4() }, uWeights: { value: new THREE.Vector4() }, uWidth: { value: 0.08 }, uEmit: { value: 1 } }),
    refresh(u, m, pass) {
      (u.uLogLevels.value as THREE.Vector4).set(...(NEON_SKINS.map((t) => Math.log10(m.levels[t])) as [number, number, number, number]));
      (u.uWeights.value as THREE.Vector4).set(...(NEON_SKINS.map((t) => (t === REGION ? 1 : 0.3)) as [number, number, number, number]));
      u.uEmit.value = 5 / m.bound;
      pass.haloAmount = 0.6;
    },
  },
};

/** One style's GPU side, made on first use. */
interface StyleState {
  spec: StyleSpec;
  uniforms: Record<string, THREE.IUniform>;
  pass: VolumePass;
  /** What its uniforms hold: the model, and the hue its colors were turned by. */
  model: AtomModel | null;
  hue: number;
}

/** What to draw: one orbital of the set (its index), or the whole atom. */
export type RayTarget = number | 'all';

export interface RayContext {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Drawing buffer, device pixels. */
  width: number;
  height: number;
}

export class RayLooks {
  look: RayLook = 'volumetric';
  /** Turns the fingerprint colors round the wheel (radians), as the explorer's twist does. */
  hue = 0;
  /** Fades the whole style out (0) or in (1), as the cloud fades on the dive to the nucleus. */
  opacity = 1;
  private styles = new Map<RayLook, StyleState>();
  private set: OrbitalSet | null = null;
  private fp: Fingerprint | null = null;
  private models = new Map<RayTarget, AtomModel>();
  private target: RayTarget = 'all';
  private pixel = 1;
  private pixelRatio = 1;
  private w = 1;
  private h = 1;
  private light = new THREE.Vector3();
  /** A model was built this frame: build none ahead. */
  private built = false;

  constructor(private halfFloat: boolean) {}

  /** The atom (its orbitals and palette). A new atom drops the old one's models. */
  setSet(set: OrbitalSet, fp: Fingerprint): void {
    if (set === this.set && fp === this.fp) return;
    if (set.element.z !== this.set?.element.z) this.models.clear();
    this.set = set;
    this.fp = fp;
    for (const s of this.styles.values()) s.model = null;
  }

  /** What the explorer shows now: the focused orbital alone, or (opened up to all) the atom. */
  targetOf(ex: OrbitalExplorer): RayTarget {
    const last = Math.max(0, (this.set?.orbitals.length ?? 1) - 1);
    return ex.context >= ALL_FROM ? 'all' : Math.max(0, Math.min(last, Math.round(ex.focus)));
  }

  /** The radius (a0) to frame for what is drawn: the focused orbital as the explorer frames it
   *  solo (however far the focus opens toward ghost); the whole atom by the reach of its 80%
   *  region (for a heavy atom its dense core, far inside the outermost orbital the particles
   *  frame). Neon reaches out to its 99% skin, so it frames most of its bounding sphere, as the
   *  lab does. */
  frame(ex: OrbitalExplorer, fallback: number): number {
    const set = this.set;
    if (!set || !set.orbitals.length) return fallback;
    const t = this.targetOf(ex);
    if (t === 'all') {
      const m = this.model('all');
      return this.look === 'neon' ? m.bound * 0.8 : Math.min(m.bound, m.extent[REGION] * 1.25);
    }
    const last = set.orbitals.length - 1;
    const f = Math.max(0, Math.min(last, ex.focus));
    const i0 = Math.floor(f), i1 = Math.min(last, i0 + 1), fr = f - i0;
    const solo = (set.orbitals[i0].r90 * (1 - fr) + set.orbitals[i1].r90 * fr) * 1.25;
    return this.look === 'neon' ? Math.max(solo, this.model(t).bound * 0.85) : solo;
  }

  /** Take on the quality governor's level (and the screen's pixel ratio). Its pixel share
   *  scales the layer; the steps that only thin the particles' dense points (pixel 1) take a
   *  little resolution here too, so the styles get cheaper from the first step down. */
  quality(q: QualityLevel, pixelRatio: number): void {
    const pixel = Math.min(1, q.pixel * (0.7 + 0.3 * q.dense));
    if (pixel === this.pixel && pixelRatio === this.pixelRatio) return;
    this.pixel = pixel;
    this.pixelRatio = pixelRatio;
    for (const s of this.styles.values()) this.size(s);
  }

  /** Ray-march what the explorer shows into the style's layer. */
  renderLayer(ctx: RayContext, ex: OrbitalExplorer, time: number): void {
    if (!this.set || !this.fp) return;
    if (ctx.width !== this.w || ctx.height !== this.h) {
      this.w = ctx.width;
      this.h = ctx.height;
      for (const s of this.styles.values()) this.size(s);
    }
    this.built = false;
    this.target = this.targetOf(ex);
    const s = this.style(this.look);
    const m = this.model(this.target);
    if (s.model !== m) {
      this.load(s, m);
    } else if (s.spec.colors === 'print' && Math.abs(s.hue - this.hue) > 0.004) {
      this.colorPrint(s, m);
    }
    s.uniforms.uTime.value = time;
    if (this.look === 'solid') (s.uniforms.uLight.value as THREE.Vector3).copy(cameraLight(ctx.camera, this.light));
    applyCamera(s.uniforms, ctx.camera, 0);
    s.pass.render(ctx.renderer);
    // Quiet frame (nothing built): build the next orbitals along the ladder ahead of time.
    if (!this.built && ex.context < ALL_FROM) this.ahead(ex);
  }

  /** Composite the layer over the screen. */
  draw(renderer: THREE.WebGLRenderer): void {
    const s = this.styles.get(this.look);
    if (!s) return;
    s.pass.opacity = this.opacity;
    s.pass.draw(renderer);
  }

  /** The layer's size and steps, for the console. */
  get stats(): string {
    const s = this.styles.get(this.look);
    return s ? `${s.uniforms.uSteps.value} steps · ${s.pass.width}×${s.pass.height}` : '';
  }

  dispose(): void {
    for (const s of this.styles.values()) {
      s.pass.dispose();
      (s.uniforms.uTable.value as THREE.Texture).dispose();
    }
    this.styles.clear();
    this.models.clear();
  }

  // ---- inside ----

  private style(look: RayLook): StyleState {
    let s = this.styles.get(look);
    if (!s) {
      const spec = STYLES[look];
      const uniforms = Object.assign(fieldUniforms(), { uSteps: { value: spec.steps }, uTime: { value: 0 } }, spec.extras());
      const pass = new VolumePass(spec.frag, uniforms, { halfFloat: this.halfFloat, ...spec.volume });
      s = { spec, uniforms, pass, model: null, hue: 0 };
      this.styles.set(look, s);
      this.size(s);
    }
    return s;
  }

  /** Resolution and steps for the current quality: the governor's pixel share scales the
   *  style's samples per CSS pixel; steps ease down with it, to 55% at the coarsest level. */
  private size(s: StyleState): void {
    const pr = Math.max(1, this.pixelRatio);
    const scale = Math.max(0.2 / pr, Math.min(1, (s.spec.res * this.pixel) / pr));
    const t = Math.max(0, Math.min(1, (this.pixel - 0.25) / 0.75));
    s.uniforms.uSteps.value = Math.round(s.spec.steps * (0.55 + 0.45 * t));
    if (s.pass.scale !== scale || s.pass.width <= 1) {
      s.pass.scale = scale;
      // Crisp surfaces alias when upscaled from a reduced layer: soften them there.
      if (s.spec.volume.smooth === false) s.pass.smooth = scale < 0.95;
      s.pass.resize(this.w, this.h);
    }
  }

  private model(t: RayTarget): AtomModel {
    let m = this.models.get(t);
    if (!m) {
      const set = this.set!;
      const z = set.element.z;
      const o = t === 'all' ? null : set.orbitals[t];
      m = buildModel(o ? { z, orbital: o.key, full: false, m: o.mIndex } : { z, orbital: 'total', full: false, m: 0 }, true, MODEL_SAMPLES);
      this.models.set(t, m);
      this.built = true;
    }
    return m;
  }

  /** Build one model ahead: the neighbours of the focus, the way it is moving first. */
  private ahead(ex: OrbitalExplorer): void {
    const set = this.set;
    if (!set) return;
    const i = Math.round(ex.focus);
    const dir = ex.goal >= ex.focus ? 1 : -1;
    for (const j of [i + dir, i - dir, i + 2 * dir]) {
      if (j < 0 || j >= set.orbitals.length || this.models.has(j)) continue;
      this.model(j);
      return;
    }
  }

  /** Whether the closed subshells go into the radius table. */
  private useTable(s: StyleState, m: AtomModel): boolean {
    if (s.spec.colors === 'none') return true;
    return m.terms.length > MAX_EXPLICIT;
  }

  private load(s: StyleState, m: AtomModel): void {
    const table = this.useTable(s, m);
    applyModel(s.uniforms, m, 'phase', table);
    if (s.spec.colors === 'print') this.colorPrint(s, m);
    s.spec.refresh(s.uniforms, m, s.pass);
    s.model = m;
  }

  /** The fingerprint's colors on each term: an orbital its own pair; a closed subshell (one
   *  round term) its first orbital's (a mean over the palette would wash out to gray); the
   *  radius table each block's mean by electrons. */
  private colorPrint(s: StyleState, m: AtomModel): void {
    const set = this.set!, fp = this.fp!, u = s.uniforms;
    const table = this.useTable(s, m);
    const explicit = table ? m.terms.filter((t) => !t.spherical) : m.terms;
    const turn = (c: RGB) => hueTurn(c, this.hue);
    const colorsOf = (t: Term): [RGB, RGB] => {
      const o = set.orbitals.find((x) => x.key === t.key && (t.m == null || x.term.m === t.m));
      if (!o) return [PHASE_POS.toArray() as RGB, PHASE_NEG.toArray() as RGB];
      const [pos, neg] = fp.colors[o.index];
      return [turn(pos), turn(neg)];
    };
    const n = Math.min(u.uTerms.value as number, explicit.length);
    for (let i = 0; i < n; i++) {
      const [pos, neg] = colorsOf(explicit[i]);
      (u.uTermPos.value[i] as THREE.Vector3).set(...pos);
      (u.uTermNeg.value[i] as THREE.Vector3).set(...neg);
    }
    if (table) {
      const blocks = ['s', 'p', 'd', 'f'];
      blocks.forEach((b, bi) => {
        const c: RGB = [0, 0, 0];
        let w = 0;
        for (const t of m.terms) {
          if (!t.spherical || t.block !== b) continue;
          const [pos] = colorsOf(t);
          for (let j = 0; j < 3; j++) c[j] += pos[j] * t.weight;
          w += t.weight;
        }
        if (w > 0) (u.uBlockCol.value[bi] as THREE.Vector3).set(c[0] / w, c[1] / w, c[2] / w);
      });
    }
    s.hue = this.hue;
  }
}

/** Turn a color round the gray axis by `a` radians (the particle shader's hueTurn). */
function hueTurn(c: RGB, a: number): RGB {
  if (a === 0) return c;
  // c cos a + (k × c) sin a + k (k · c)(1 - cos a), with k = (1, 1, 1) / √3.
  const k = 0.57735, ca = Math.cos(a), sa = Math.sin(a);
  const d = ((c[0] + c[1] + c[2]) / 3) * (1 - ca);
  return [
    Math.max(0, c[0] * ca + k * (c[2] - c[1]) * sa + d),
    Math.max(0, c[1] * ca + k * (c[0] - c[2]) * sa + d),
    Math.max(0, c[2] * ca + k * (c[1] - c[0]) * sa + d),
  ];
}
