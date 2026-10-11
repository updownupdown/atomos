// The contract every lab experiment follows, and the settings the panel hands them.

import type * as THREE from 'three';
import type { AtomModel, Threshold } from './model';
import type { Orbit } from './orbit';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITIES: { id: Quality; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Med' },
  { id: 'high', label: 'High' },
  { id: 'ultra', label: 'Ultra' },
];

/** What a quality level buys: ray-march steps, the share of the screen's pixels a volume pass
 *  renders (each side), and particles. */
export interface QualitySpec {
  steps: number;
  res: number;
  particles: number;
}
export const QUALITY: Record<Quality, QualitySpec> = {
  low: { steps: 40, res: 0.35, particles: 50_000 },
  medium: { steps: 72, res: 0.5, particles: 150_000 },
  high: { steps: 120, res: 0.75, particles: 300_000 },
  ultra: { steps: 200, res: 1, particles: 500_000 },
};

export interface Settings {
  quality: Quality;
  /** 0.1 to 4, 1 = as designed. */
  brightness: number;
  /** The share of the electrons the shown region holds. */
  threshold: Threshold;
  /** 0 to 1: the wedge cut away facing the camera (1 = the front half). */
  cutaway: number;
  /** Experiment-specific choices, by option id. */
  options: Record<string, string>;
}

export interface LabContext {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** The orbit camera: an experiment can take over its touch input (`input = false`) and
   *  turn or zoom it itself. */
  orbit?: Orbit;
  /** The canvas, for experiments that read gestures themselves. */
  canvas?: HTMLCanvasElement;
  /** The overlay layer (pointer-events off; children opt back in), for an experiment's HUD. */
  ui?: HTMLElement;
  /** Drawing buffer size in device pixels. */
  width: number;
  height: number;
  /** Whether half-float render targets work here. */
  halfFloat: boolean;
}

export interface ExperimentOption {
  id: string;
  label: string;
  /** A segmented choice; or, with `range`, a slider (choices empty; values stored as strings). */
  choices: { id: string; label: string }[];
  range?: { min: number; max: number; step: number; format?: (v: number) => string };
  /** The starting value for a slider. */
  default?: string;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  /** Needs the sign of every lobe (phase coloring), so m-sums stay separate orbitals. */
  wantsSign(s: Settings): boolean;
  /** Which shared controls mean something here. */
  uses: { threshold?: boolean; cutaway?: boolean; brightness?: boolean; /** false hides the orbital picker (the experiment shows the whole atom its own way). */ orbital?: boolean };
  options?: ExperimentOption[];
  /** Radius (scene units) the camera should fit; defaults to the model's frame. */
  frame?(model: AtomModel): number;
  init(ctx: LabContext): void;
  setAtom(model: AtomModel): void;
  setSettings(s: Settings): void;
  resize(ctx: LabContext): void;
  /** Draw a whole frame (clearing first). `time` in seconds. */
  render(dt: number, time: number): void;
  /** A short readout for the FPS box: steps, resolution, particles. */
  stats(): string;
  dispose(): void;
}
