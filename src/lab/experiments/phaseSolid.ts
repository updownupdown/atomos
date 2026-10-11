// Phase solid: the boundary surface holding X% of the electrons, ray-marched and lit like an
// object (half-Lambert diffuse, Blinn specular, a soft rim), each lobe colored by the sign of
// psi, after lisyarus' isosurface mode. The cutaway opens a wedge; its faces show the inside,
// shaded by how dense it is there.

import * as THREE from 'three';
import { FIELD_GLSL } from '../glsl';
import type { AtomModel } from '../model';
import type { QualitySpec, Settings } from '../types';
import { COLOR_OPTION, RayExperiment } from './base';
import { SURFACE_GLSL, cameraLight } from './surface';

const FRAG = /* glsl */ `
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

export class PhaseSolid extends RayExperiment {
  id = 'phase-solid';
  name = 'Phase solid (isosurface)';
  description = 'The surface holding X% of the electrons, lit as a solid and colored by the sign of ψ (lisyarus isosurface mode).';
  options = [COLOR_OPTION];
  private light = new THREE.Vector3();
  protected autoSmooth = true;

  protected fragment(): string { return FRAG; }
  protected extraUniforms() {
    return { uLevel: { value: 1 }, uLight: { value: new THREE.Vector3(0, 1, 0) }, uBrightness: { value: 1 }, uPeak: { value: 1 } };
  }
  protected volumeOptions() { return { smooth: false }; }
  // Surfaces want sharp edges: more pixels than the soft volumes, steps are cheap (density only).
  protected resFor(q: QualitySpec): number { return Math.min(1, q.res * 1.35); }
  protected stepsFor(q: QualitySpec): number { return Math.round(q.steps * 1.5); }

  protected refresh(model: AtomModel, s: Settings): void {
    this.uniforms.uLevel.value = model.levels[s.threshold];
    this.uniforms.uPeak.value = model.peak;
    this.uniforms.uBrightness.value = Math.sqrt(s.brightness);
  }

  protected beforeRender(): void {
    cameraLight(this.ctx.camera, this.light);
    (this.uniforms.uLight.value as THREE.Vector3).copy(this.light);
  }
}
