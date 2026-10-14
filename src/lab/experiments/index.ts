// Every experiment the lab offers, in picker order. Each is made fresh when picked and
// disposed when left, so only the one on screen holds GPU resources.

import type { Experiment } from '../types';
import { CloudStudy } from './cloudStudy';
import { CurrentLook } from './current';
import { DenseCloud } from './particles';
import { ExplorerView } from './explorer';
import { FingerprintView } from './fingerprint';
import { GlowSparks } from './glowSparks';
import { InfernoDensity } from './inferno';
import { Jewel } from './jewel';
import { PhaseGlow } from './phaseGlow';
import { PhaseSolid } from './phaseSolid';
import { Shells } from './shells';
import { Slice } from './slice';

export interface ExperimentEntry {
  id: string;
  name: string;
  make(): Experiment;
}

const entry = (make: () => Experiment): ExperimentEntry => {
  const probe = make();
  return { id: probe.id, name: probe.name, make };
};

export const EXPERIMENTS: ExperimentEntry[] = [
  entry(() => new CloudStudy()),
  entry(() => new FingerprintView()),
  entry(() => new ExplorerView()),
  entry(() => new GlowSparks()),
  entry(() => new PhaseGlow()),
  entry(() => new PhaseSolid()),
  entry(() => new Jewel()),
  entry(() => new Shells()),
  entry(() => new InfernoDensity()),
  entry(() => new Slice()),
  entry(() => new DenseCloud()),
  entry(() => new CurrentLook('cloud', 'Cloud')),
  entry(() => new CurrentLook('shapes', 'Shapes')),
  entry(() => new CurrentLook('hybrid', 'Hybrid')),
];
