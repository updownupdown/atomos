// Glow + sparks: blurry orbitals with scintillating electrons, the combination the owner asked
// for. Three cheap layers:
//   1. The orbital glow, ray-marched at a fraction of the screen's resolution (it is soft, so
//      nothing is lost) with a luminous emission model, a slow shimmer, and a halo blurred from
//      the same low-resolution image: bloom for the price of four tiny blur passes.
//   2. Sparks: electrons that flash for a moment at a point drawn from |psi|^2, then reappear
//      elsewhere. Each spark picks its next position from a pool of samples in a float texture
//      by hashing its index with its cycle number, all in the vertex shader: endless fresh
//      positions, no CPU per frame, and over time the flashes trace the density themselves.
//      A handful of hero sparks get a four-point star glint.
//   3. A faint warm nucleus at the heart.

import * as THREE from 'three';
import { ADD_BLEND, FIELD_GLSL, PHASE_NEG, PHASE_POS, srgb, termColors, type ColorMode } from '../../render/field';
import { sampleModel, type AtomModel } from '../../render/model';
import type { QualitySpec, Settings } from '../types';
import { RayExperiment } from './base';

const POOL = 256; // pool texture side: 65,536 sampled positions

const FRAG = /* glsl */ `
precision highp float;
${FIELD_GLSL}
in vec2 vUv;
uniform int uSteps;
uniform float uLevel;
uniform float uEmit;
uniform float uAbsorb;
uniform float uShimmer;
uniform float uTime;
out vec4 fragColor;

void main() {
  vec3 ro, rd;
  cameraRay(vUv, ro, rd);
  float t0, t1;
  if (!sphereHit(ro, rd, uBound, t0, t1)) { fragColor = vec4(0.0); return; }
  float dt = (t1 - t0) / float(uSteps);
  float jitter = ign(gl_FragCoord.xy);
  vec3 light = vec3(0.0);
  float T = 1.0;
  float k = 6.0 / uBound;
  for (int i = 0; i < 400; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (t0 + dt * (float(i) + jitter));
    if (cutAway(p)) continue;
    vec3 col;
    float d = fieldColor(toPhys(p), col);
    if (d <= 0.0) continue;
    float x = d / uLevel;
    // Soft knee: dense cores glow brighter but do not drown the outer lobes.
    float e = x / (1.0 + 0.15 * x);
    // A slow shimmer, as if the cloud were breathing.
    vec3 w = p * k + vec3(uTime * 0.31, uTime * -0.23, uTime * 0.17);
    e *= 1.0 + uShimmer * sin(w.x + sin(w.y * 1.3)) * sin(w.z * 1.1 + sin(w.x * 0.7 + uTime * 0.2));
    light += T * (col / d) * e * uEmit * dt;
    T *= exp(-uAbsorb * e * dt);
    if (T < 0.01) break;
  }
  fragColor = vec4(light, 1.0 - T);
}`;

const SPARK_VERT = /* glsl */ `
uniform sampler2D uPool;
uniform sampler2D uPoolColor;
uniform float uTime;
uniform float uSize;
uniform float uAlpha;
uniform float uScale;
uniform float uHero;
out vec3 vColor;
out float vAlpha;
float h11(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
void main() {
  float i = float(gl_VertexID);
  float seed = h11(i * 0.618 + uHero * 7.0);
  float rate = uHero > 0.5 ? 0.22 + seed * 0.2 : 0.35 + seed * 0.9;
  float c = uTime * rate + seed * 17.0;
  float cycle = floor(c);
  float f = c - cycle;
  // A new place every cycle, drawn from the pool of |psi|^2 samples.
  float pick = h11(i * 1.731 + cycle * 9.137 + uHero * 3.0);
  int idx = int(pick * ${POOL * POOL}.0);
  ivec2 tc = ivec2(idx % ${POOL}, idx / ${POOL});
  vec4 pp = texelFetch(uPool, tc, 0);
  vec3 col = texelFetch(uPoolColor, tc, 0).rgb;
  // Lit for a short flash in each cycle: a quick rise and a longer fade.
  float on = smoothstep(0.0, 0.06, f) * pow(1.0 - f, 3.0);
  vec4 mv = modelViewMatrix * vec4(pp.xyz * uScale, 1.0);
  vColor = mix(col * 1.25, vec3(1.0), 0.2 + 0.35 * on);
  vAlpha = uAlpha * on * pp.w;
  gl_PointSize = on > 0.003 ? max(1.0, uSize * (0.6 + 0.6 * on) / -mv.z) : 0.0;
  gl_Position = on > 0.003 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const SPARK_FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
uniform float uHero;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  float core = exp(-d2 * (uHero > 0.5 ? 60.0 : 5.0));
  float a = core;
  if (uHero > 0.5) {
    // Four-point star: thin crossed rays, fading out.
    vec2 q = abs(c) * 2.0;
    float rays = exp(-q.y * 40.0) * (1.0 - q.x) + exp(-q.x * 40.0) * (1.0 - q.y);
    a += max(rays, 0.0) * 0.7 + exp(-d2 * 9.0) * 0.25;
  }
  fragColor = vec4(vColor * a * vAlpha, 0.0);
}`;

const NUCLEUS_VERT = /* glsl */ `
uniform float uSize;
uniform float uTime;
out float vPulse;
void main() {
  vPulse = 1.0 + 0.08 * sin(uTime * 1.7);
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = uSize;
  gl_Position = projectionMatrix * mv;
}`;

const NUCLEUS_FRAG = /* glsl */ `
precision highp float;
in float vPulse;
uniform vec3 uColor;
uniform float uAlpha;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  float a = exp(-d2 * 26.0) + exp(-d2 * 5.0) * 0.18;
  fragColor = vec4(mix(uColor, vec3(1.0), exp(-d2 * 60.0)) * a * uAlpha * vPulse, 0.0);
}`;

const additive = { ...ADD_BLEND, glslVersion: THREE.GLSL3 } as const;

export class GlowSparks extends RayExperiment {
  id = 'glow-sparks';
  name = 'Glow + sparks (jewel)';
  description = 'Soft low-res orbital glow with a bloom halo, scintillating electrons that flash at places drawn from |ψ|², and a warm nucleus. Cheap enough for phones.';
  options = [
    { id: 'color', label: 'Color', choices: [{ id: 'block', label: 'Subshell' }, { id: 'phase', label: 'Phase (sign of ψ)' }] },
    { id: 'sparks', label: 'Sparks', choices: [{ id: 'some', label: 'Some' }, { id: 'many', label: 'Many' }, { id: 'none', label: 'None' }] },
  ];
  private scene = new THREE.Scene();
  private sparks: THREE.Points;
  private heroes: THREE.Points;
  private nucleus: THREE.Points;
  private sparkMat: THREE.ShaderMaterial;
  private heroMat: THREE.ShaderMaterial;
  private nucleusMat: THREE.ShaderMaterial;
  private pool = new THREE.DataTexture(new Float32Array(POOL * POOL * 4), POOL, POOL, THREE.RGBAFormat, THREE.FloatType);
  private poolColor = new THREE.DataTexture(new Float32Array(POOL * POOL * 4), POOL, POOL, THREE.RGBAFormat, THREE.FloatType);
  private sparkCount = 0;
  private poolModel: AtomModel | null = null;
  private poolMode: ColorMode | null = null;

  constructor() {
    super();
    const sparkUniforms = () => ({
      uPool: { value: this.pool }, uPoolColor: { value: this.poolColor }, uTime: { value: 0 }, uSize: { value: 3 },
      uAlpha: { value: 1 }, uScale: { value: 1 }, uHero: { value: 0 },
    });
    this.sparkMat = new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, uniforms: sparkUniforms(), ...additive });
    this.heroMat = new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, uniforms: sparkUniforms(), ...additive });
    this.heroMat.uniforms.uHero.value = 1;
    this.nucleusMat = new THREE.ShaderMaterial({
      vertexShader: NUCLEUS_VERT, fragmentShader: NUCLEUS_FRAG, ...additive,
      uniforms: { uSize: { value: 40 }, uTime: { value: 0 }, uColor: { value: srgb('#ffc58f') }, uAlpha: { value: 0.9 } },
    });
    const dummy = (n: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      return g;
    };
    this.sparks = new THREE.Points(dummy(1), this.sparkMat);
    this.heroes = new THREE.Points(dummy(18), this.heroMat);
    this.nucleus = new THREE.Points(dummy(1), this.nucleusMat);
    for (const p of [this.sparks, this.heroes, this.nucleus]) {
      p.frustumCulled = false;
      this.scene.add(p);
    }
  }

  protected fragment(): string { return FRAG; }
  protected extraUniforms() {
    return { uLevel: { value: 1 }, uEmit: { value: 1 }, uAbsorb: { value: 0.1 }, uShimmer: { value: 0.12 } };
  }
  protected volumeOptions() { return { smooth: true, halo: true, tone: true }; }
  // The glow is soft: half the volume pass's usual resolution, fewer steps.
  protected resFor(q: QualitySpec): number { return q.res * 0.5; }
  protected stepsFor(q: QualitySpec): number { return Math.max(24, Math.round(q.steps * 0.6)); }

  protected refresh(model: AtomModel, s: Settings): void {
    const u = this.uniforms;
    u.uLevel.value = model.levels[s.threshold];
    u.uEmit.value = (0.6 * s.brightness) / model.bound;
    u.uAbsorb.value = 0.25 / model.bound;
    this.pass.haloAmount = 1;
    this.fillPool(model, this.colorMode(s));
    const many = s.options.sparks === 'many', none = s.options.sparks === 'none';
    const q = s.quality === 'low' ? 0.5 : s.quality === 'medium' ? 1 : s.quality === 'high' ? 1.5 : 2;
    this.sparkCount = none ? 0 : Math.round((many ? 9000 : 2500) * q);
    const g = this.sparks.geometry;
    const n = Math.max(1, this.sparkCount);
    if (g.getAttribute('position').count !== n) g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.sparks.visible = this.heroes.visible = !none;
    // Fewer sparks each a little brighter.
    this.sparkMat.uniforms.uAlpha.value = (many ? 0.9 : 1.2) * Math.min(2, s.brightness);
    this.heroMat.uniforms.uAlpha.value = 1.1 * Math.min(2, s.brightness);
    for (const m of [this.sparkMat, this.heroMat]) m.uniforms.uScale.value = model.worldPerA0;
  }

  /** Sample the pool of spark positions (scene frame, a0) and their colors. */
  private fillPool(model: AtomModel, mode: ColorMode): void {
    if (this.poolModel === model && this.poolMode === mode) return;
    this.poolModel = model;
    this.poolMode = mode;
    const key = `pool/${mode}`;
    let data = model.cache.get(key) as { pos: Float32Array; col: Float32Array } | undefined;
    if (!data) {
      const n = POOL * POOL;
      const s = sampleModel(model.terms, n, 4242);
      const pos = new Float32Array(n * 4), col = new Float32Array(n * 4);
      const colors = model.terms.map((t) => termColors(t, mode));
      const outer = Math.max(...model.terms.map((t) => (t.n * t.n) / t.zeff));
      for (let i = 0; i < n; i++) {
        const k = s.term[i], t = model.terms[k];
        pos[i * 4] = s.positions[i * 3];
        pos[i * 4 + 1] = s.positions[i * 3 + 2];
        pos[i * 4 + 2] = s.positions[i * 3 + 1];
        // Inner-shell sparks are many and packed tight: dim them so the core does not boil.
        pos[i * 4 + 3] = Math.max(0.15, Math.min(1, (t.n * t.n) / t.zeff / outer));
        const c = mode === 'phase' ? (s.sign[i] > 0 ? PHASE_POS : PHASE_NEG) : colors[k][s.sign[i] > 0 ? 0 : 1];
        col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b; col[i * 4 + 3] = 1;
      }
      data = { pos, col };
      model.cache.set(key, data);
    }
    (this.pool.image.data as Float32Array).set(data.pos);
    (this.poolColor.image.data as Float32Array).set(data.col);
    this.pool.needsUpdate = true;
    this.poolColor.needsUpdate = true;
  }

  protected overlay(_dt: number, time: number): void {
    const { renderer, camera } = this.ctx;
    const dist = camera.position.length();
    const px = Math.max(1.5, this.ctx.height / 380);
    this.sparkMat.uniforms.uTime.value = time;
    this.sparkMat.uniforms.uSize.value = px * 2.4 * dist;
    this.heroMat.uniforms.uTime.value = time;
    this.heroMat.uniforms.uSize.value = px * 16 * dist;
    this.nucleusMat.uniforms.uTime.value = time;
    // The nucleus: a small warm point, about 3% of the view.
    this.nucleusMat.uniforms.uSize.value = this.ctx.height * 0.05 * Math.min(2.5, Math.max(0.6, this.orbitScale()));
    renderer.render(this.scene, camera);
  }

  /** How zoomed the view is relative to fitting the model (1 = fitted). */
  private orbitScale(): number {
    if (!this.model) return 1;
    const c = this.ctx.camera;
    const fit = (this.model.frame * this.model.worldPerA0) / Math.sin((c.fov * Math.PI) / 360);
    return fit / c.position.length();
  }

  stats(): string {
    return `${this.steps} steps · ${this.pass.width}×${this.pass.height} · ${(this.sparkCount / 1000).toFixed(1)}k sparks`;
  }

  dispose(): void {
    super.dispose();
    this.sparkMat.dispose();
    this.heroMat.dispose();
    this.nucleusMat.dispose();
    this.pool.dispose();
    this.poolColor.dispose();
    this.sparks.geometry.dispose();
    this.heroes.geometry.dispose();
    this.nucleus.geometry.dispose();
  }
}
