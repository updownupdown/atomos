// How far an atom is collected, as the one picture Collect and its Build page draw: the cloud
// in color over a slice of the circle (from noon, clockwise) and gray over the rest, with
// scaffolding rings standing over the gray part and gone from the colored one. The slice counts
// games, since each part is a game: the stable parts (nucleus, electrons, lasting isotopes)
// share the circle with the fleeting isotopes by their numbers, the stable parts keeping at least
// a tenth so the first wins show. Completing the stable parts is what sets the atom turning.

import * as THREE from 'three';
import { fleetingCount, segmentsOf } from '../core/progress';
import type { SaveData } from '../core/save';
import { fleetingOpen } from './locks';

export interface AtomSlice {
  /** The share of the circle in color, 0 to 1. */
  pct: number;
  /** The stable parts are all built: the atom turns. */
  spin: boolean;
  stableBuilt: number;
  stableTotal: number;
  fleetingBuilt: number;
  fleetingTotal: number;
  /** Fleeting isotopes can be built (they open later than the atoms). */
  fleetingOn: boolean;
}

/** The least of the circle the stable parts take, however many fleeting isotopes there are. */
export const STABLE_MIN_SHARE = 0.1;

/** The counts and shares behind atom `z`'s slice. */
export function atomSlice(z: number, save: SaveData): AtomSlice {
  const segs = segmentsOf(z, save);
  const stableBuilt = segs.filter((s) => s.done).length;
  const f = fleetingCount(z, save);
  const on = fleetingOpen(save);
  const total = segs.length + f.total;
  const stableShare = f.total ? Math.max(STABLE_MIN_SHARE, segs.length / total) : 1;
  const stable = segs.length ? stableBuilt / segs.length : 0;
  const fleeting = f.total && on ? f.built / f.total : 0;
  const pct = Math.max(0, Math.min(1, stableShare * stable + (1 - stableShare) * fleeting));
  return { pct, spin: segs.length > 0 && stableBuilt >= segs.length, stableBuilt, stableTotal: segs.length, fleetingBuilt: f.built, fleetingTotal: f.total, fleetingOn: on };
}

/** The rings' radii as shares of the framed radius, and their thickness. */
const RINGS = [0.5, 0.7, 0.9];
const THICK = 0.016;

/** The scaffolding: rings facing the camera round the atom, each an arc that leaves the colored
 *  slice open (from noon, clockwise). Drawn after the cloud, in the renderer's own frame. */
export class Scaffold {
  readonly scene = new THREE.Scene();
  private group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private material: THREE.MeshBasicMaterial;
  private r = 0;
  private pct = -1;
  private seg = 0;

  constructor(color = 0xe4e8ea, opacity = 0.5) {
    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.scene.add(this.group);
  }

  /** Lay the rings out for a framed radius `r` (scene units) with `pct` of the circle open. */
  set(r: number, pct: number): void {
    pct = Math.max(0, Math.min(1, pct));
    const seg = Math.round(pct * 240);
    if (r === this.r && seg === this.seg) return;
    this.r = r;
    this.pct = pct;
    this.seg = seg;
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    const open = seg / 240;
    if (open >= 1) return;
    // The visible arc starts at noon and runs counterclockwise round to the slice's far edge.
    const length = (1 - open) * Math.PI * 2;
    for (const k of RINGS) {
      const geo = new THREE.RingGeometry(r * (k - THICK / 2), r * (k + THICK / 2), 180, 1, Math.PI / 2, length);
      const m = new THREE.Mesh(geo, this.material);
      m.frustumCulled = false;
      this.group.add(m);
      this.meshes.push(m);
    }
  }

  get shown(): boolean { return this.meshes.length > 0; }

  /** Draw the rings facing `camera`, over whatever is on the screen. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this.meshes.length) return;
    this.group.quaternion.copy(camera.quaternion);
    renderer.render(this.scene, camera);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
  }
}
