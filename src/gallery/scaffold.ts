// How far an atom is collected, as the one picture Collect and its Build page draw: the cloud
// in color over a slice of the circle (from noon, clockwise) and gray over the rest, with
// scaffolding rings standing over the gray part and gone from the colored one. The slice counts
// games, since each part is a game: the stable parts (nucleus, electrons, lasting isotopes)
// share the circle with the fleeting isotopes by their numbers, the stable parts keeping at least
// a tenth so the first wins show. Completing the stable parts is what sets the atom turning.
//
// The rings are display only, with no legend: thin lines sized to the canvas (the same on every
// atom), the middle one solid, the inner and outer dashed, close together round the atom.

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

/** The rings' radii as shares of half the canvas's shorter side, and which are dashed. */
const RINGS: { k: number; dashed: boolean }[] = [{ k: 0.6, dashed: true }, { k: 0.69, dashed: false }, { k: 0.78, dashed: true }];
/** Line thickness, dash and gap, in CSS pixels. */
const THICK_PX = 1.5;
const DASH_PX = 7;
const GAP_PX = 5;

/** The scaffolding: rings facing the camera round the atom, each an arc that leaves the colored
 *  slice open (from noon, clockwise). Drawn after the cloud, in the renderer's own frame. */
export class Scaffold {
  readonly scene = new THREE.Scene();
  private group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private material: THREE.MeshBasicMaterial;
  private half = 0;
  private px = 0;
  private seg = 0;

  constructor(color = 0xe4e8ea, opacity = 0.55) {
    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.scene.add(this.group);
  }

  /** Lay the rings out for `camera` looking at the origin, on a canvas whose shorter side is
   *  `shortPx` CSS pixels, with `pct` of the circle open; `scale` shrinks them when only part of
   *  the canvas shows. */
  set(camera: THREE.PerspectiveCamera, shortPx: number, pct: number, scale = 1): void {
    pct = Math.max(0, Math.min(1, pct));
    const seg = Math.round(pct * 240);
    // Half the shorter side of the view at the origin, in scene units.
    const dist = camera.position.length();
    const halfH = dist * Math.tan((camera.fov * Math.PI) / 360);
    const view = Math.min(halfH, halfH * camera.aspect);
    const half = view * scale;
    if (!(half > 0) || !(shortPx > 0)) return;
    // Rebuild only when the slice or the view's scale moves enough to see.
    if (seg === this.seg && Math.abs(half - this.half) < this.half * 0.004 && shortPx === this.px) return;
    this.half = half;
    this.px = shortPx;
    this.seg = seg;
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    const open = seg / 240;
    if (open >= 1) return;
    const unit = view / (shortPx / 2);
    // The visible arc starts at noon and runs counterclockwise round to the slice's far edge.
    const length = (1 - open) * Math.PI * 2;
    for (const ring of RINGS) {
      const r = half * ring.k;
      const geo = arc(r, THICK_PX * unit, Math.PI / 2, length, ring.dashed ? { dash: (DASH_PX * unit) / r, gap: (GAP_PX * unit) / r } : null);
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

/** A flat arc of radius `r` and width `thick` from angle `start` for `length` radians, solid or
 *  in dashes (`dash` and `gap` in radians), as one geometry. */
function arc(r: number, thick: number, start: number, length: number, dashes: { dash: number; gap: number } | null): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const r0 = r - thick / 2, r1 = r + thick / 2;
  const strip = (a0: number, a1: number) => {
    const n = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 180));
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r0, s * r0, 0, c * r1, s * r1, 0);
      if (i) {
        const k = base + i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
  };
  if (!dashes) strip(start, start + length);
  else {
    const step = dashes.dash + dashes.gap;
    for (let a = 0; a < length; a += step) strip(start + a, start + Math.min(length, a + dashes.dash));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}
