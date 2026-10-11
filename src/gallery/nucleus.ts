// The nucleus up close: every proton and neutron of the atom's most common isotope, packed
// into a ball of radius 1.2 fm x A^(1/3). Drawn in the neon-shells style ("Probability shells
// (neon)" in the lab): each nucleon a thin glowing bubble, two skins in its color, brightest
// edge-on, with a soft halo, protons and neutrons in the app's two nucleon colors. The View
// draws it at one fixed scale for all elements, with reference circles of 2, 4, 6 and 8 fm, so
// hydrogen's lone proton and oganesson's 294 nucleons compare fairly; Build frames it close.
// The packing is a picture of size and count, not of where nucleons really sit: they have no
// fixed places.

import * as THREE from 'three';
import type { Element } from './data';
import { token } from './tokens';
import { ADD_BLEND, NEON_CHORD_GLSL } from '../render/gl';
import { VolumePass } from '../render/volume';

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

/** The radius (fm) the packed nucleus reaches, nucleons included. */
export function nucleusExtent(e: Element): number {
  return 1.2 * Math.cbrt(Math.max(e.z, e.commonA)) + NUCLEON_R;
}

const VERT = /* glsl */ `
in vec3 iCenter;
in float iKind;
in float iSeed;
uniform float uRadius;   // nucleon radius, object units (fm)
uniform float uTime;
uniform float uJiggle;   // share of a radius each nucleon wanders
uniform float uExtent;   // the nucleus's radius, object units (fm)
out vec3 vCenter;
out float vDepth;
out vec3 vPos;
out float vR;
out float vKind;
void main() {
  float ph = iSeed * 61.0;
  vec3 c = iCenter + uJiggle * uRadius * vec3(sin(uTime * 1.3 + ph), sin(uTime * 1.07 + ph * 1.7), sin(uTime * 0.91 + ph * 2.3));
  vec4 mvc = modelViewMatrix * vec4(c, 1.0);
  float scale = length(modelViewMatrix[0].xyz);
  float r = uRadius * scale;
  // Nucleons at the back glow less, so the front layer reads as bubbles, not a blot.
  float z = (mvc.z - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z) / max(uExtent * scale, 1e-9);
  vDepth = 0.3 + 0.7 * smoothstep(-1.0, 1.0, z);
  // A camera-facing square a little wider than the sphere, so its glow has room.
  vec4 p = mvc + vec4(position.xy * r * 1.25, 0.0, 0.0);
  vCenter = mvc.xyz;
  vPos = p.xyz;
  vR = r;
  vKind = iKind;
  gl_Position = projectionMatrix * p;
}`;

const FRAG = /* glsl */ `
precision highp float;
${NEON_CHORD_GLSL}
in vec3 vCenter;
in vec3 vPos;
in float vR;
in float vKind;
in float vDepth;
uniform vec3 uProton;
uniform vec3 uNeutron;
uniform float uEmit;
uniform vec4 uSkins;     // skin radii, units of the nucleon's radius
uniform vec4 uWeights;
uniform float uWidth;    // skin thickness, in r² (units of the radius squared)
out vec4 fragColor;
void main() {
  // The ray from the eye through this pixel, and how close it passes the nucleon's center.
  vec3 d = normalize(vPos);
  vec3 off = d * dot(vCenter, d) - vCenter;
  float b2 = dot(off, off) / (vR * vR);
  if (b2 > 1.6) discard;
  float e = neonChord(b2, uSkins, uWeights, uWidth);
  vec3 col = vKind < 0.5 ? uProton : uNeutron;
  fragColor = vec4(col * e * uEmit * vDepth, 0.0);
}`;

/** A CSS color token as raw display RGB, as the neon shaders take it. */
function rgb(name: string, fallback: string): THREE.Vector3 {
  const c = new THREE.Color();
  c.setStyle(token(name, fallback), THREE.LinearSRGBColorSpace);
  return new THREE.Vector3(c.r, c.g, c.b);
}

/**
 * The nucleus as neon bubbles: one instanced quad per nucleon, each shading two glowing skins
 * analytically (NEON_CHORD_GLSL), into a tone-mapped layer with a halo. `group` holds the
 * nucleus in fm; scale it to place it. Render with renderLayer() then draw().
 */
export class NucleusView {
  readonly group = new THREE.Group();
  private scene = new THREE.Scene();
  private quad: THREE.BufferGeometry;
  private geometry = new THREE.InstancedBufferGeometry();
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private layer: VolumePass;
  private shown = 0;
  private vivid = 1;
  private warm = rgb('--c-warn', '#e8b45c');
  private pale = rgb('--c-text-2', '#a3abaf');
  private vividTo = 1;
  private w = 1;
  private h = 1;
  /** Nucleons drift a little around their places (off for reduced motion). */
  jiggle = 0.05;
  /** Overall light (1 = as designed); the dive fades it in. */
  intensity = 1;
  element: Element | null = null;

  constructor(opts: { halfFloat: boolean }) {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.quad = quad;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uRadius: { value: NUCLEON_R }, uTime: { value: 0 }, uJiggle: { value: this.jiggle }, uExtent: { value: 1 },
        uProton: { value: rgb('--c-warn', '#e8b45c') }, uNeutron: { value: rgb('--c-silver', '#eef1f2') },
        uEmit: { value: 1 },
        // A bright outer skin (the nucleon's edge) and a fainter one inside, as the lab's shells
        // light the 90% boundary strongest and the 50% one softly.
        uSkins: { value: new THREE.Vector4(0.93, 0.55, 0, 0) },
        uWeights: { value: new THREE.Vector4(1, 0.22, 0, 0) },
        uWidth: { value: 0.045 },
      },
      ...ADD_BLEND,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.scene.add(this.group);
    this.layer = new VolumePass(null, {}, { halfFloat: opts.halfFloat, smooth: false, halo: true, tone: true });
    this.layer.scale = 1;
    this.layer.haloAmount = 0.45;
  }

  /** Protons in their warm color once the nucleus is built; pale gray, like the neutrons, before.
   *  With `animate` the change eases. */
  setVivid(on: boolean, animate = false): void {
    this.vividTo = on ? 1 : 0;
    if (!animate) this.vivid = this.vividTo;
  }

  show(e: Element): void {
    this.element = e;
    if (this.shown === e.z * 1000 + e.commonA) return;
    this.shown = e.z * 1000 + e.commonA;
    const a = Math.max(e.z, e.commonA);
    const pts = packNucleons(a, e.z);
    const mask = protonMask(a, e.z, e.z);
    const center = new Float32Array(a * 3), kind = new Float32Array(a), seed = new Float32Array(a);
    pts.forEach((p, i) => {
      center.set([p.x, p.y, p.z], i * 3);
      kind[i] = mask[i] ? 0 : 1;
      seed[i] = rng(i + 3)();
    });
    // A fresh geometry per nucleus: three keeps an instanced geometry's first instance count.
    this.geometry.dispose();
    const g = new THREE.InstancedBufferGeometry();
    g.index = this.quad.index;
    g.setAttribute('position', this.quad.getAttribute('position'));
    g.setAttribute('iCenter', new THREE.InstancedBufferAttribute(center, 3));
    g.setAttribute('iKind', new THREE.InstancedBufferAttribute(kind, 1));
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = a;
    this.geometry = g;
    this.mesh.geometry = g;
  }

  /** The halo layer's resolution as a share of the screen's (the quality governor sets it). */
  set pixelScale(v: number) {
    const s = Math.min(1, v);
    if (s === this.layer.scale) return;
    this.layer.scale = s;
    // Full resolution keeps the skins crisp; a coarser layer upscales smoothly instead.
    this.layer.smooth = s < 0.9;
    this.layer.resize(this.w, this.h);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.layer.resize(w, h);
  }

  /** Advance the color change and render into the layer. */
  renderLayer(renderer: THREE.WebGLRenderer, camera: THREE.Camera, time: number, dt: number): void {
    const k = dt / 0.4;
    this.vivid = this.vivid < this.vividTo ? Math.min(this.vividTo, this.vivid + k) : Math.max(this.vividTo, this.vivid - k);
    const u = this.material.uniforms;
    (u.uProton.value as THREE.Vector3).lerpVectors(this.pale, this.warm, this.vivid);
    u.uTime.value = time;
    u.uJiggle.value = this.jiggle;
    // Many nucleons overlap along each ray of a big nucleus: each gives a little less.
    const a = this.geometry.instanceCount;
    u.uEmit.value = (2.6 * this.intensity) / (1 + 0.45 * Math.cbrt(Math.max(1, a)));
    u.uExtent.value = 1.2 * Math.cbrt(Math.max(1, a)) + NUCLEON_R;
    this.layer.renderScene(renderer, this.scene, camera);
  }

  draw(renderer: THREE.WebGLRenderer): void {
    this.layer.draw(renderer);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.layer.dispose();
  }
}
