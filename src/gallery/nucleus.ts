// The nucleus up close: every proton and neutron of the atom's most common isotope, packed
// into a ball of radius 1.2 fm x A^(1/3). Drawn as opaque lit balls in the colors of the lab's
// "Density inferno": protons hot (red to yellow), neutrons cool (purple to orange). The View
// draws it at one fixed scale for all elements, with reference circles of 2, 4, 6 and 8 fm, so
// hydrogen's lone proton and oganesson's 294 nucleons compare fairly; Build frames it close.
// The packing is a picture of size and count, not of where nucleons really sit: they have no
// fixed places.

import * as THREE from 'three';
import type { Element } from './data';
import { token } from './tokens';
import { INFERNO_GLSL } from '../render/gl';

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
out vec3 vCenter;
out vec3 vPos;
out float vR;
out float vKind;
void main() {
  float ph = iSeed * 61.0;
  vec3 c = iCenter + uJiggle * uRadius * vec3(sin(uTime * 1.3 + ph), sin(uTime * 1.07 + ph * 1.7), sin(uTime * 0.91 + ph * 2.3));
  vec4 mvc = modelViewMatrix * vec4(c, 1.0);
  float r = uRadius * length(modelViewMatrix[0].xyz);
  // A camera-facing square a little wider than the sphere's outline seen in perspective.
  vec4 p = mvc + vec4(position.xy * r * 1.2, 0.0, 0.0);
  vCenter = mvc.xyz;
  vPos = p.xyz;
  vR = r;
  vKind = iKind;
  gl_Position = projectionMatrix * p;
}`;

const FRAG = /* glsl */ `
precision highp float;
${INFERNO_GLSL}
in vec3 vCenter;
in vec3 vPos;
in float vR;
in float vKind;
uniform mat4 projectionMatrix;
uniform float uVivid;     // 0: protons pale (nucleus not built), 1: in their colors
uniform float uIntensity; // 0 to 1, mixed over the background
uniform vec3 uBg;
out vec4 fragColor;
void main() {
  // Trace the eye ray onto the nucleon's sphere: an opaque ball with a true depth.
  vec3 d = normalize(vPos);
  float b = dot(d, vCenter);
  float disc = b * b - (dot(vCenter, vCenter) - vR * vR);
  if (disc < 0.0) discard;
  vec3 hit = d * (b - sqrt(disc));
  vec3 n = (hit - vCenter) / vR;
  vec4 clip = projectionMatrix * vec4(hit, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  // Lit from the upper left, darker toward the rim, then read through the inferno map like the
  // lab's density: protons hot (red to yellow), neutrons cool (purple to orange).
  float diff = max(dot(n, normalize(vec3(-0.45, 0.6, 0.65))), 0.0);
  float face = max(dot(n, -d), 0.0);
  float shade = (0.28 + 0.72 * diff) * (0.5 + 0.5 * face);
  vec3 col = vKind < 0.5 ? inferno(0.3 + 0.68 * shade) : inferno(0.1 + 0.52 * shade);
  if (vKind < 0.5) col = mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))) * 0.9, col, uVivid);
  fragColor = vec4(mix(uBg, col, uIntensity), 1.0);
}`;

/** A CSS color token as raw display RGB, as the neon shaders take it. */
function rgb(name: string, fallback: string): THREE.Vector3 {
  const c = new THREE.Color();
  c.setStyle(token(name, fallback), THREE.LinearSRGBColorSpace);
  return new THREE.Vector3(c.r, c.g, c.b);
}

/**
 * The nucleus as opaque balls: one instanced quad per nucleon, each ray-traced onto its sphere
 * (with a true depth, so the front ones hide the rest) and shaded through the inferno map.
 * `group` holds the nucleus in fm; scale it to place it. Draw it with render().
 */
export class NucleusView {
  readonly group = new THREE.Group();
  private scene = new THREE.Scene();
  private quad: THREE.BufferGeometry;
  private geometry = new THREE.InstancedBufferGeometry();
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private shown = 0;
  private vivid = 1;
  private vividTo = 1;
  /** Nucleons drift a little around their places (off for reduced motion). */
  jiggle = 0.05;
  /** Overall presence (1 = as designed); the dive fades it in over the background. */
  intensity = 1;
  element: Element | null = null;

  constructor() {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.quad = quad;
    const bg = new THREE.Color();
    bg.setStyle(token('--c-bg', '#000000'), THREE.LinearSRGBColorSpace);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uRadius: { value: NUCLEON_R }, uTime: { value: 0 }, uJiggle: { value: this.jiggle },
        uVivid: { value: 1 }, uIntensity: { value: 1 }, uBg: { value: new THREE.Vector3(bg.r, bg.g, bg.b) },
      },
      depthTest: true,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.scene.add(this.group);
  }

  /** Protons in their colors once the nucleus is built; pale gray before. With `animate` the
   *  change eases. */
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

  /** Advance the color change and draw over what is on the current target (its depth cleared). */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, time: number, dt: number): void {
    const k = dt / 0.4;
    this.vivid = this.vivid < this.vividTo ? Math.min(this.vividTo, this.vivid + k) : Math.max(this.vividTo, this.vivid - k);
    const u = this.material.uniforms;
    u.uVivid.value = this.vivid;
    u.uIntensity.value = Math.max(0, Math.min(1, this.intensity));
    u.uTime.value = time;
    u.uJiggle.value = this.jiggle;
    renderer.clearDepth();
    renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
