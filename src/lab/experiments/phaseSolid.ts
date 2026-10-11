// Phase solid: the boundary surface holding X% of the electrons, ray-marched and lit like an
// object (half-Lambert diffuse, Blinn specular, a soft rim), each lobe colored by the sign of
// psi, after lisyarus' isosurface mode. The cutaway opens a wedge; its faces show the inside,
// shaded by how dense it is there.

import * as THREE from 'three';
import type { AtomModel } from '../../render/model';
import type { QualitySpec, Settings } from '../types';
import { COLOR_OPTION, RayExperiment } from './base';
import { cameraLight } from '../../render/surface';
import { SOLID_FRAG } from '../../render/rayLooks';

export class PhaseSolid extends RayExperiment {
  id = 'phase-solid';
  name = 'Phase solid (isosurface)';
  description = 'The surface holding X% of the electrons, lit as a solid and colored by the sign of ψ (lisyarus isosurface mode).';
  options = [COLOR_OPTION];
  private light = new THREE.Vector3();
  protected autoSmooth = true;

  protected fragment(): string { return SOLID_FRAG; }
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
