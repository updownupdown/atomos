// Phase glow: lisyarus' volumetric cloud. A full-screen pass marches each ray through the
// bounding sphere, evaluating psi analytically at every step; each step emits and absorbs in
// proportion to |psi|^2 (front-to-back, so dense lobes saturate softly instead of clipping) and
// takes the color of psi's sign, warm for + and blue for -. Per-pixel jittered start offsets
// turn step banding into fine noise.

import type { AtomModel } from '../../render/model';
import type { Settings } from '../types';
import { COLOR_OPTION, RayExperiment } from './base';
import { GLOW_FRAG } from '../../render/rayLooks';

export class PhaseGlow extends RayExperiment {
  id = 'phase-glow';
  name = 'Phase glow (volumetric)';
  description = 'Ray-marched |ψ|² as a soft glowing cloud, colored by the sign of ψ (orange +, blue −), after lisyarus.';
  options = [COLOR_OPTION];

  protected fragment(): string { return GLOW_FRAG; }
  protected extraUniforms() { return { uDensityK: { value: 1 }, uLevel: { value: 1 } }; }

  protected refresh(model: AtomModel, s: Settings): void {
    this.uniforms.uLevel.value = model.levels[s.threshold];
    // Scale-free: a chord of half the bound through the region's edge collects ~0.2 of optical
    // depth (a faint rim); inside the lobes density climbs and the glow saturates softly.
    this.uniforms.uDensityK.value = (0.4 * s.brightness) / model.bound;
  }
}
