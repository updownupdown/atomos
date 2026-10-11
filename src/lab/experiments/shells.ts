// Probability shells: neon contours. Light is emitted only near the four region boundaries
// (50, 75, 90, 99% of the electrons, in log density), so the atom reads as nested glowing
// skins, brightest where a ray grazes them: a soap-bubble Fresnel for free. The chosen
// threshold's shell glows strongest; colors are the phase or subshell at each point. The skins
// (render/gl.ts NEON_GLSL) also draw the app's nucleons.

import type { AtomModel } from '../../render/model';
import { THRESHOLDS } from '../../render/model';
import type { QualitySpec, Settings } from '../types';
import * as THREE from 'three';
import { COLOR_OPTION, RayExperiment } from './base';
import { NEON_FRAG } from '../../render/rayLooks';

export class Shells extends RayExperiment {
  id = 'shells';
  name = 'Probability shells (neon)';
  description = 'Nested glowing skins at the 50/75/90/99% boundaries, brightest where you see them edge-on. The chosen threshold glows strongest.';
  options = [COLOR_OPTION];

  // The outermost (99%) shell is the widest thing drawn: fit it.
  frame(model: AtomModel): number { return model.bound * 0.8 * model.worldPerA0; }
  protected fragment(): string { return NEON_FRAG; }
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
