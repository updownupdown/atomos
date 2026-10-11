// Probability shells: neon contours. Light is emitted only near the four region boundaries
// (50, 75, 90, 99% of the electrons, in log density), so the atom reads as nested glowing
// skins, brightest where a ray grazes them: a soap-bubble Fresnel for free. The chosen
// threshold's shell glows strongest; colors are the phase or subshell at each point. The skins
// (render/gl.ts NEON_GLSL) also draw the app's nucleons.

import { NEON_GLSL } from '../../render/gl';
import { FIELD_GLSL } from '../glsl';
import type { AtomModel } from '../../render/model';
import { THRESHOLDS } from '../../render/model';
import type { QualitySpec, Settings } from '../types';
import * as THREE from 'three';
import { COLOR_OPTION, RayExperiment } from './base';

const FRAG = /* glsl */ `
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

export class Shells extends RayExperiment {
  id = 'shells';
  name = 'Probability shells (neon)';
  description = 'Nested glowing skins at the 50/75/90/99% boundaries, brightest where you see them edge-on. The chosen threshold glows strongest.';
  options = [COLOR_OPTION];

  // The outermost (99%) shell is the widest thing drawn: fit it.
  frame(model: AtomModel): number { return model.bound * 0.8 * model.worldPerA0; }
  protected fragment(): string { return FRAG; }
  protected extraUniforms() {
    return { uLogLevels: { value: new THREE.Vector4() }, uWeights: { value: new THREE.Vector4() }, uWidth: { value: 0.08 }, uEmit: { value: 1 } };
  }
  protected volumeOptions() { return { smooth: true, halo: true, tone: true }; }
  protected stepsFor(q: QualitySpec): number { return Math.round(q.steps * 1.6); }

  protected refresh(model: AtomModel, s: Settings): void {
    const u = this.uniforms;
    (u.uLogLevels.value as THREE.Vector4).set(...(THRESHOLDS.map((t) => Math.log10(model.levels[t])) as [number, number, number, number]));
    (u.uWeights.value as THREE.Vector4).set(...(THRESHOLDS.map((t) => (t === s.threshold ? 1 : 0.3)) as [number, number, number, number]));
    u.uEmit.value = (5 * s.brightness) / model.bound;
    this.pass.haloAmount = 0.6;
  }
}
