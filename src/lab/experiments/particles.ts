// Dense scintillating cloud: tens to hundreds of thousands of electrons as GPU points, sampled
// once on the CPU from |psi|^2 (inverse-CDF radius, rejection-sampled angle) and never touched
// again: every point's twinkle is a function of time and its own seed in the vertex shader,
// so a frame costs no CPU at all. Points add up in a half-float layer that is tone-mapped onto
// the screen, so dense cores roll off to bright instead of clipping to a white blot.

import * as THREE from 'three';
import { POINT_FRAG } from '../../render/gl';
import { ADD_BLEND, PHASE_NEG, PHASE_POS, termColors, type ColorMode } from '../../render/field';
import { sampleModel, type AtomModel, type Term } from '../../render/model';
import { QUALITY, type Experiment, type LabContext, type Settings } from '../types';
import { LAB_BG, VolumePass } from '../../render/volume';

export const POINT_VERT = /* glsl */ `
in vec3 color;
in float seed;
uniform float uTime;
uniform float uSize;
uniform float uAlpha;
uniform float uTwinkle;
out vec3 vColor;
out float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float ph = seed * 43.98;
  float rate = 0.5 + fract(seed * 13.71) * 1.6;
  // A slow shimmer under a brief, bright scintillation now and then.
  float s = sin(uTime * rate + ph);
  float spark = pow(max(s, 0.0), 60.0);
  float base = 0.6 + 0.25 * sin(uTime * rate * 0.37 + ph * 2.3);
  float lum = mix(1.0, base + spark * 3.0, uTwinkle);
  vColor = mix(color, vec3(1.0), spark * 0.35 * uTwinkle);
  vAlpha = uAlpha * lum;
  gl_PointSize = max(1.0, uSize * (1.0 + spark * 0.9 * uTwinkle) / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

export { POINT_FRAG };
/** Mean radius of a term (a0), for evening out the brightness of inner shells. */
function meanRadius(t: Term): number {
  return (t.n * t.n * 1.5 - t.l * (t.l + 1) * 0.5) / t.zeff;
}

/**
 * Points for a model, cached on it: scene-frame positions (a0), a color per point and a seed.
 * `balance` dims the inner shells, which pack their electrons into a far smaller volume.
 */
export function cloudGeometry(model: AtomModel, count: number, mode: ColorMode, balance: boolean): THREE.BufferGeometry {
  const key = `points/${count}/${mode}/${balance ? 1 : 0}`;
  const hit = model.cache.get(key) as THREE.BufferGeometry | undefined;
  if (hit) return hit;
  const sampleKey = `samples/${count}`;
  let s = model.cache.get(sampleKey) as ReturnType<typeof sampleModel> | undefined;
  if (!s) {
    s = sampleModel(model.terms, count, 99);
    model.cache.set(sampleKey, s);
  }
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const outer = Math.max(...model.terms.map(meanRadius));
  const colors = model.terms.map((t) => termColors(t, mode));
  const dims = model.terms.map((t) => (balance ? Math.pow(Math.max(0.05, Math.min(1, meanRadius(t) / outer)), 1.3) : 1));
  for (let i = 0; i < count; i++) {
    // Physics z up → scene y up.
    pos[i * 3] = s.positions[i * 3];
    pos[i * 3 + 1] = s.positions[i * 3 + 2];
    pos[i * 3 + 2] = s.positions[i * 3 + 1];
    const k = s.term[i];
    const c = mode === 'phase' ? (s.sign[i] > 0 ? PHASE_POS : PHASE_NEG) : colors[k][s.sign[i] > 0 ? 0 : 1];
    col[i * 3] = c.r * dims[k];
    col[i * 3 + 1] = c.g * dims[k];
    col[i * 3 + 2] = c.b * dims[k];
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), model.bound);
  model.cache.set(key, g);
  return g;
}

export function pointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    uniforms: { uTime: { value: 0 }, uSize: { value: 2 }, uAlpha: { value: 0.3 }, uTwinkle: { value: 1 } },
    ...ADD_BLEND,
  });
}

export class DenseCloud implements Experiment {
  id = 'dense-cloud';
  name = 'Dense scintillating cloud';
  description = '50k–500k electrons sampled once from |ψ|² and drawn as GPU points; each twinkles from its own seed in the vertex shader (zero CPU per frame). Quality sets the count.';
  uses = { brightness: true };
  options = [
    { id: 'color', label: 'Color', choices: [{ id: 'block', label: 'Subshell' }, { id: 'phase', label: 'Phase (sign of ψ)' }] },
    { id: 'twinkle', label: 'Twinkle', choices: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Steady' }] },
    { id: 'balance', label: 'Inner shells', choices: [{ id: 'on', label: 'Balanced' }, { id: 'off', label: 'True density' }] },
  ];
  private ctx!: LabContext;
  private layer!: VolumePass;
  private scene = new THREE.Scene();
  private points: THREE.Points | null = null;
  private material = pointMaterial();
  private model: AtomModel | null = null;
  private settings: Settings | null = null;
  private count = 0;

  wantsSign(): boolean { return true; }

  init(ctx: LabContext): void {
    this.ctx = ctx;
    this.layer = new VolumePass(null, {}, { halfFloat: ctx.halfFloat, smooth: false, tone: true });
    this.layer.scale = 1;
  }

  private rebuild(): void {
    if (!this.model || !this.settings) return;
    const o = this.settings.options;
    this.count = QUALITY[this.settings.quality].particles;
    const g = cloudGeometry(this.model, this.count, (o.color ?? 'block') as ColorMode, (o.balance ?? 'on') === 'on');
    if (this.points) this.scene.remove(this.points);
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.scale.setScalar(this.model.worldPerA0);
    this.scene.add(this.points);
    const u = this.material.uniforms;
    u.uTwinkle.value = (o.twinkle ?? 'on') === 'on' ? 1 : 0;
    // Fewer points each carry more light, so the cloud reads about as bright at any count.
    u.uAlpha.value = 0.55 * this.settings.brightness * Math.pow(150_000 / this.count, 0.7);
  }

  setAtom(model: AtomModel): void { this.model = model; this.rebuild(); }
  setSettings(s: Settings): void { this.settings = s; this.rebuild(); }

  resize(ctx: LabContext): void {
    this.ctx = ctx;
    this.layer.resize(ctx.width, ctx.height);
  }

  render(_dt: number, time: number): void {
    const { renderer, camera } = this.ctx;
    const u = this.material.uniforms;
    u.uTime.value = time;
    // About two device pixels at the nucleus' depth, whatever the zoom.
    u.uSize.value = Math.max(1.3, this.ctx.height / 560) * camera.position.length();
    this.layer.renderScene(renderer, this.scene, camera);
    renderer.setClearColor(LAB_BG, 1);
    renderer.clear();
    this.layer.draw(renderer);
  }

  stats(): string {
    return `${Math.round(this.count / 1000)}k pts · ${this.layer.width}×${this.layer.height}`;
  }

  dispose(): void {
    this.layer.dispose();
    this.material.dispose();
    // Geometries stay cached on their models.
  }
}
