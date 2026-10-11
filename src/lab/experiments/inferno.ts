// Density inferno: moppel's volumetric mode. Log density from the shown region's edge (0) up
// to the atom's peak (1); each ray accumulates opacity by Beer-Lambert and a density position
// weighted by norm^8 (so the densest material along the ray decides the color), mapped once
// through the inferno colormap at the end: every pixel is a true legend color, black → purple
// → orange → yellow. Closed shells read from the radius table, so a whole heavy atom costs
// about what one orbital does.

import type { AtomModel } from '../../render/model';
import type { Settings } from '../types';
import { RayExperiment } from './base';
import { INFERNO_FRAG } from '../../render/rayLooks';

export class InfernoDensity extends RayExperiment {
  id = 'inferno';
  name = 'Density inferno (log |ψ|²)';
  description = 'Electron density on a log scale through an inferno colormap, the whole atom summed by occupancy (after moppel). Cutaway shows the shells inside.';

  protected fragment(): string { return INFERNO_FRAG; }
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
