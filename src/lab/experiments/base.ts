// What every ray-marched experiment shares: the field uniforms, one reduced-resolution volume
// pass, camera and model plumbing, quality and the FPS readout. Subclasses supply the shader
// and how settings map to its uniforms.

import type * as THREE from 'three';
import { applyCamera, applyModel, fieldUniforms, type ColorMode } from '../../render/field';
import type { AtomModel } from '../../render/model';
import { QUALITY, type Experiment, type ExperimentOption, type LabContext, type QualitySpec, type Settings } from '../types';
import { LAB_BG, VolumePass, type VolumeOptions } from '../../render/volume';

export const COLOR_OPTION: ExperimentOption = {
  id: 'color', label: 'Color',
  choices: [{ id: 'phase', label: 'Phase (sign of ψ)' }, { id: 'block', label: 'Subshell' }],
};

export abstract class RayExperiment implements Experiment {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  uses: Experiment['uses'] = { threshold: true, cutaway: true, brightness: true };
  options?: ExperimentOption[];
  protected ctx!: LabContext;
  protected pass!: VolumePass;
  protected uniforms: Record<string, THREE.IUniform> = fieldUniforms();
  protected model: AtomModel | null = null;
  protected settings: Settings | null = null;
  protected steps = 64;
  /** Upscale softly only when rendering below full resolution (for surfaces). */
  protected autoSmooth = false;

  protected abstract fragment(): string;
  /** Uniforms the shader adds to the field's. */
  protected extraUniforms(): Record<string, THREE.IUniform> { return {}; }
  protected volumeOptions(): Omit<VolumeOptions, 'halfFloat'> { return { smooth: true }; }
  /** Steps and resolution share for a quality level. */
  protected stepsFor(q: QualitySpec): number { return q.steps; }
  protected resFor(q: QualitySpec): number { return q.res; }
  /** Push settings and model into uniforms (both are set when this runs). */
  protected abstract refresh(model: AtomModel, s: Settings): void;
  /** How much of a wedge the cutaway removes (0 to 1). */
  protected wedge(): number { return this.uses.cutaway ? this.settings?.cutaway ?? 0 : 0; }
  /** Per-frame uniforms, before the march. */
  protected beforeRender(_dt: number, _time: number): void {}
  /** Draw on top of the volume (points, sprites). */
  protected overlay(_dt: number, _time: number): void {}

  protected colorMode(s: Settings | null = this.settings): ColorMode {
    return (s?.options.color ?? this.options?.find((o) => o.id === 'color')?.choices[0].id ?? 'phase') as ColorMode;
  }

  /** Tabulate round terms by radius (fast, but loses their sign) unless coloring by phase. */
  protected useTable(s: Settings | null = this.settings): boolean {
    return this.colorMode(s) !== 'phase';
  }

  wantsSign(s: Settings): boolean { return !this.useTable(s); }

  init(ctx: LabContext): void {
    this.ctx = ctx;
    Object.assign(this.uniforms, { uSteps: { value: 64 }, uTime: { value: 0 } }, this.extraUniforms());
    this.pass = new VolumePass(this.fragment(), this.uniforms, { halfFloat: ctx.halfFloat, ...this.volumeOptions() });
  }

  setAtom(model: AtomModel): void {
    this.model = model;
    applyModel(this.uniforms, model, this.colorMode(), this.useTable());
    if (this.settings) this.refresh(model, this.settings);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    const q = QUALITY[s.quality];
    this.steps = this.stepsFor(q);
    this.uniforms.uSteps.value = this.steps;
    this.pass.scale = this.resFor(q);
    // Crisp surfaces alias when upscaled from a reduced target: soften them there.
    if (this.autoSmooth) this.pass.smooth = this.pass.scale < 0.95;
    this.pass.resize(this.ctx.width, this.ctx.height);
    if (this.model) this.refresh(this.model, s);
  }

  resize(ctx: LabContext): void {
    this.ctx = ctx;
    this.pass.resize(ctx.width, ctx.height);
  }

  render(dt: number, time: number): void {
    const { renderer, camera } = this.ctx;
    this.uniforms.uTime.value = time;
    this.beforeRender(dt, time);
    applyCamera(this.uniforms, camera, this.wedge());
    this.pass.render(renderer);
    renderer.setRenderTarget(null);
    renderer.setClearColor(LAB_BG, 1);
    renderer.clear();
    this.pass.draw(renderer);
    this.overlay(dt, time);
  }

  stats(): string {
    return `${this.steps} steps · ${this.pass.width}×${this.pass.height}`;
  }

  dispose(): void {
    this.pass.dispose();
    (this.uniforms.uTable.value as THREE.Texture).dispose();
  }
}
