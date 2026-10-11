// Density inferno: moppel's volumetric mode. Log density from the shown region's edge (0) up
// to the atom's peak (1); each ray accumulates opacity by Beer-Lambert and a density position
// weighted by norm^8 (so the densest material along the ray decides the color), mapped once
// through the inferno colormap at the end: every pixel is a true legend color, black → purple
// → orange → yellow. Closed shells read from the radius table, so a whole heavy atom costs
// about what one orbital does.

import { FIELD_GLSL } from '../glsl';
import type { AtomModel } from '../../render/model';
import type { Settings } from '../types';
import { RayExperiment } from './base';

const FRAG = /* glsl */ `
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

export class InfernoDensity extends RayExperiment {
  id = 'inferno';
  name = 'Density inferno (log |ψ|²)';
  description = 'Electron density on a log scale through an inferno colormap, the whole atom summed by occupancy (after moppel). Cutaway shows the shells inside.';

  protected fragment(): string { return FRAG; }
  protected extraUniforms() { return { uLogLevel: { value: -3 }, uLogPeak: { value: 0 }, uExposure: { value: 1 } }; }
  protected useTable(): boolean { return true; }

  protected refresh(model: AtomModel, s: Settings): void {
    this.uniforms.uLogLevel.value = Math.log10(model.levels[s.threshold]);
    // Heavy atoms' cores are millions of times denser than their valence shells: cap the scale
    // four decades above the edge so the outer shells still get the colormap's middle.
    this.uniforms.uLogPeak.value = Math.min(Math.log10(model.peak), this.uniforms.uLogLevel.value + 4);
    this.uniforms.uExposure.value = s.brightness;
  }
}
