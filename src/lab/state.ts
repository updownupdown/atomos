// The lab's state: what is shown and how, remembered between visits (localStorage, best
// effort) and overridable from the URL (?exp=phase-glow&z=26&orbital=3d) for sharing.

import { MAX_Z } from '../gallery/data';
import { THRESHOLDS, type Threshold } from './model';
import { QUALITIES, type Quality } from './types';

export interface LabState {
  exp: string;
  z: number;
  orbital: string;
  full: boolean;
  m: number;
  quality: Quality;
  brightness: number;
  threshold: Threshold;
  cutaway: number;
  autoRotate: boolean;
  panelOpen: boolean;
  /** Per experiment, its own option choices. */
  options: Record<string, Record<string, string>>;
}

const KEY = 'atomos-lab-v1';

export const DEFAULT_STATE: LabState = {
  exp: 'glow-sparks',
  z: 6,
  orbital: 'total',
  full: false,
  m: 0,
  quality: 'medium',
  brightness: 1,
  threshold: 90,
  cutaway: 0,
  autoRotate: true,
  panelOpen: true,
  options: {},
};

export function loadState(): LabState {
  let s: LabState = { ...DEFAULT_STATE, options: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = { ...s, ...JSON.parse(raw) };
  } catch {
    // Storage blocked or corrupt: start fresh.
  }
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('exp')) s.exp = q.get('exp')!;
    if (q.get('z')) s.z = Number(q.get('z'));
    if (q.get('orbital')) s.orbital = q.get('orbital')!;
    if (q.get('full')) s.full = q.get('full') === '1';
    if (q.get('m')) s.m = Number(q.get('m'));
    if (q.get('quality')) s.quality = q.get('quality') as Quality;
    if (q.get('panel')) s.panelOpen = q.get('panel') === '1';
    if (q.get('rotate')) s.autoRotate = q.get('rotate') === '1';
  } catch {
    // No URL to read.
  }
  // Sanitise whatever came in.
  s.z = Math.max(1, Math.min(MAX_Z, Math.round(Number(s.z) || 1)));
  if (!QUALITIES.some((q) => q.id === s.quality)) s.quality = 'medium';
  if (!THRESHOLDS.includes(s.threshold)) s.threshold = 90;
  s.brightness = Math.max(0.1, Math.min(4, Number(s.brightness) || 1));
  s.cutaway = Math.max(0, Math.min(1, Number(s.cutaway) || 0));
  s.m = Math.max(0, Math.min(6, Math.round(Number(s.m) || 0)));
  if (typeof s.options !== 'object' || !s.options) s.options = {};
  return s;
}

export function saveState(s: LabState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or full: the lab still works, it just forgets.
  }
}
