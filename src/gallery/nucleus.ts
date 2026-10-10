// The nucleus up close (opened once with Glyph): every proton and neutron of the atom's most
// common isotope as a small ball, packed into a ball of radius 1.2 fm x A^(1/3). Drawn at one
// fixed scale for all elements, with reference circles of 2, 4, 6 and 8 fm, so hydrogen's lone
// proton and oganesson's 294 nucleons compare fairly. The packing is a picture of size and count,
// not of where nucleons really sit: they have no fixed places.

import * as THREE from 'three';
import type { Element } from './data';
import { token } from './tokens';

/** Reference circles round the nucleus, by radius. */
export const NUCLEUS_RINGS: { fm: number; style: 'solid' | 'dashed' }[] = [
  { fm: 2, style: 'solid' }, { fm: 4, style: 'dashed' }, { fm: 6, style: 'solid' }, { fm: 8, style: 'dashed' },
];

/** Radius of one nucleon in the picture, in fm. */
export const NUCLEON_R = 0.85;

/** A small seeded random source, so each nucleus always packs the same way. */
function rng(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Centres for `a` touching balls of radius NUCLEON_R, packed round the origin (fm). */
export function packNucleons(a: number, seed: number): THREE.Vector3[] {
  const rand = rng(seed);
  const radius = 1.2 * Math.cbrt(a);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < a; i++) {
    // Start spread through the ball, then relax: push overlapping pairs apart, draw everything in.
    const u = rand(), v = rand(), w = rand();
    const r = radius * Math.cbrt(u), th = Math.acos(2 * v - 1), ph = 2 * Math.PI * w;
    pts.push(new THREE.Vector3(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)));
  }
  if (a === 1) return [new THREE.Vector3()];
  const d = 2 * NUCLEON_R * 0.96;
  const tmp = new THREE.Vector3();
  for (let it = 0; it < 90; it++) {
    for (let i = 0; i < a; i++) {
      for (let j = i + 1; j < a; j++) {
        tmp.subVectors(pts[j], pts[i]);
        const dist = tmp.length();
        if (dist >= d) continue;
        const push = dist > 1e-6 ? (d - dist) / 2 / dist : 0.01;
        if (dist <= 1e-6) tmp.set(rand() - 0.5, rand() - 0.5, rand() - 0.5);
        tmp.multiplyScalar(push);
        pts[i].sub(tmp);
        pts[j].add(tmp);
      }
    }
    for (const p of pts) p.multiplyScalar(0.985);
  }
  // Centre the cluster.
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.multiplyScalar(1 / a);
  for (const p of pts) p.sub(c);
  return pts;
}

/** Which of `a` nucleons are protons: `z` of them, spread evenly through the ball. */
export function protonMask(a: number, z: number, seed: number): boolean[] {
  const rand = rng(seed + 7);
  const order = Array.from({ length: a }, (_, i) => i);
  for (let i = a - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const mask = new Array<boolean>(a).fill(false);
  for (let i = 0; i < z; i++) mask[order[i]] = true;
  return mask;
}

/** The nucleus as two instanced meshes (protons warm, neutrons pale) in a group; `scale` maps fm to scene units. */
export class NucleusView {
  readonly group = new THREE.Group();
  private sphere = new THREE.SphereGeometry(1, 20, 14);
  private protonMat = new THREE.MeshStandardMaterial({ color: token('--c-warn', '#e8b45c'), roughness: 0.45, metalness: 0.05, emissive: token('--c-warn', '#e8b45c'), emissiveIntensity: 0.18 });
  private neutronMat = new THREE.MeshStandardMaterial({ color: token('--c-silver', '#eef1f2'), roughness: 0.5, metalness: 0.05, emissive: token('--c-silver', '#eef1f2'), emissiveIntensity: 0.06 });
  private meshes: THREE.InstancedMesh[] = [];
  private shown = 0;

  constructor(private scale: number) {}

  /** Protons in their warm color once the nucleus is built; pale gray, like the neutrons, before. */
  setVivid(on: boolean): void {
    const c = on ? token('--c-warn', '#e8b45c') : token('--c-text-2', '#8a9296');
    this.protonMat.color.set(c);
    this.protonMat.emissive.set(c);
  }

  show(e: Element): void {
    if (this.shown === e.z * 1000 + e.commonA) return;
    this.shown = e.z * 1000 + e.commonA;
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = [];
    const a = Math.max(e.z, e.commonA);
    const pts = packNucleons(a, e.z);
    const mask = protonMask(a, e.z, e.z);
    const m4 = new THREE.Matrix4();
    const r = NUCLEON_R * this.scale;
    for (const [isProton, mat] of [[true, this.protonMat], [false, this.neutronMat]] as const) {
      const idx = pts.map((_, i) => i).filter((i) => mask[i] === isProton);
      if (!idx.length) continue;
      const mesh = new THREE.InstancedMesh(this.sphere, mat, idx.length);
      idx.forEach((i, k) => {
        const p = pts[i];
        m4.makeScale(r, r, r).setPosition(p.x * this.scale, p.y * this.scale, p.z * this.scale);
        mesh.setMatrixAt(k, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }
}
