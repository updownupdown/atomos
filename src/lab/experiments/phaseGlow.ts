// Phase glow: lisyarus' volumetric cloud. A full-screen pass marches each ray through the
// bounding sphere, evaluating psi analytically at every step; each step emits and absorbs in
// proportion to |psi|^2 (front-to-back, so dense lobes saturate softly instead of clipping) and
// takes the color of psi's sign, warm for + and blue for -. Per-pixel jittered start offsets
// turn step banding into fine noise.

import { FIELD_GLSL } from '../glsl';
import type { AtomModel } from '../../render/model';
import type { Settings } from '../types';
import { COLOR_OPTION, RayExperiment } from './base';

const FRAG = /* glsl */ `
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

export class PhaseGlow extends RayExperiment {
  id = 'phase-glow';
  name = 'Phase glow (volumetric)';
  description = 'Ray-marched |ψ|² as a soft glowing cloud, colored by the sign of ψ (orange +, blue −), after lisyarus.';
  options = [COLOR_OPTION];

  protected fragment(): string { return FRAG; }
  protected extraUniforms() { return { uDensityK: { value: 1 }, uLevel: { value: 1 } }; }

  protected refresh(model: AtomModel, s: Settings): void {
    this.uniforms.uLevel.value = model.levels[s.threshold];
    // Scale-free: a chord of half the bound through the region's edge collects ~0.2 of optical
    // depth (a faint rim); inside the lobes density climbs and the glow saturates softly.
    this.uniforms.uDensityK.value = (0.4 * s.brightness) / model.bound;
  }
}
