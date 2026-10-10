// One atom as a Three.js object: a layer per subshell, each a point cloud of
// |psi|^2 samples and, when the style asks for them, the idealised orbital
// surfaces. The same object morphs from one element to the next: layers both
// atoms share keep their points and only rescale, while the electrons that
// are added or removed fade in white or out red, so the difference between
// neighbouring elements is what the eye is drawn to.
//
// Scene units: 1 = 100 pm. Each atom is scaled so the edge of its outermost
// layer sits at its van der Waals radius; the spacing between layers inside
// follows the hydrogen-like radial functions with Slater's effective charges.

import * as THREE from 'three';
import { BLOCK_GLOW, L_OF, type Block, type Element, type Subshell } from './data';
import { orbitalSurface, radialTable, sampleSubshell } from './orbital';

export type Style = 'cloud' | 'shapes' | 'hybrid';
export const STYLES: { id: Style; label: string }[] = [
  { id: 'cloud', label: 'Cloud' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'hybrid', label: 'Hybrid' },
];

/** Bohr radius in scene units (52.9 pm). */
const A0 = 0.529;
const TRANSITION_S = 0.9;

const pointGeometries = new Map<string, THREE.BufferGeometry>();
/**
 * The sampled points of one subshell. Each point carries a second sample of the
 * same orbital and a random seed: in a live cloud a point blinks out and comes
 * back at its other position, so the set of electrons on screen never settles,
 * the way a probability cloud is meant to be read.
 */
function pointGeometry(n: number, block: Block, perSlot: number): THREE.BufferGeometry {
  const key = `${n}${block}/${perSlot}`;
  let g = pointGeometries.get(key);
  if (!g) {
    const c = sampleSubshell(n, block, perSlot * 2);
    const total = c.slot.length / 2;
    const a = new Float32Array(total * 3), b = new Float32Array(total * 3);
    const slot = new Float32Array(total), orbital = new Float32Array(total), sign = new Float32Array(total), seed = new Float32Array(total);
    // Slots are stored one after another, 2 x perSlot points each: the first half is
    // a point's home, the second half its other place.
    for (let i = 0; i < total; i++) {
      const s = Math.floor(i / perSlot), k = i % perSlot;
      const ia = s * perSlot * 2 + k, ib = ia + perSlot;
      a.set(c.positions.subarray(ia * 3, ia * 3 + 3), i * 3);
      b.set(c.positions.subarray(ib * 3, ib * 3 + 3), i * 3);
      slot[i] = c.slot[ia];
      orbital[i] = c.orbital[ia];
      sign[i] = c.sign[ia];
      seed[i] = fract(Math.sin(i * 12.9898 + n * 78.233 + block.charCodeAt(0)) * 43758.5453);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    g.setAttribute('position2', new THREE.BufferAttribute(b, 3));
    g.setAttribute('slot', new THREE.BufferAttribute(slot, 1));
    g.setAttribute('orbital', new THREE.BufferAttribute(orbital, 1));
    g.setAttribute('sign', new THREE.BufferAttribute(sign, 1));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    pointGeometries.set(key, g);
  }
  return g;
}
const fract = (x: number) => x - Math.floor(x);

const surfaceGeometries = new Map<string, THREE.BufferGeometry>();
function surfaceGeometry(block: Block, oi: number): THREE.BufferGeometry {
  const key = `${block}${oi}`;
  let g = surfaceGeometries.get(key);
  if (!g) {
    const s = orbitalSurface(block, oi);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
    g.setAttribute('sign', new THREE.BufferAttribute(s.sign, 1));
    g.setIndex(new THREE.BufferAttribute(s.index, 1));
    g.computeVertexNormals();
    surfaceGeometries.set(key, g);
  }
  return g;
}

const POINT_VERT = `
attribute float slot; attribute float orbital; attribute float sign; attribute float seed; attribute vec3 position2;
uniform float uScale, uFrom, uTo, uT, uSize, uOrbitals, uDim, uSizeMul, uTime, uLive;
uniform vec3 uColor;
varying vec3 vColor; varying float vAlpha;
float hash(float x) { return fract(sin(x) * 43758.5453); }
void main() {
  // Live cloud: each point lives for a moment, blinks out, and reappears at its other sample,
  // jittering slightly while it is lit. Rates vary per point so nothing pulses in step.
  float rate = 0.55 + seed * 0.7;
  float cyc = uTime * rate + seed * 17.0;
  float k = fract(cyc);
  float other = mod(floor(cyc), 2.0);
  vec3 home = mix(position, position2, other * uLive);
  float life = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.5, 0.72, k));
  float lit = mix(1.0, life, uLive);
  float tick = floor(uTime * 18.0);
  vec3 j = vec3(hash(seed * 91.7 + tick), hash(seed * 37.3 + tick * 1.3), hash(seed * 53.1 + tick * 0.7)) - 0.5;
  home += j * (0.035 * length(home) + 0.03) * uLive;
  float shown = mix(uFrom, uTo, uT);
  float a = clamp(shown - slot, 0.0, 1.0);
  float lo = min(uFrom, uTo), hi = max(uFrom, uTo);
  float changing = step(lo, slot) * (1.0 - step(hi, slot));
  float flash = changing * sin(uT * 3.14159);
  float tint = uOrbitals > 1.0 ? (orbital / (uOrbitals - 1.0) - 0.5) * 0.55 : 0.0;
  vec3 c = tint > 0.0 ? uColor + (1.0 - uColor) * tint : uColor * (1.0 + tint);
  vec3 flashColor = uTo > uFrom ? vec3(1.0) : vec3(1.0, 0.32, 0.22);
  vColor = mix(c, flashColor, flash * 0.9);
  vAlpha = a * uDim * (1.0 + flash * 0.8) * lit;
  vec4 mv = modelViewMatrix * vec4(home * uScale, 1.0);
  gl_Position = a > 0.0 && lit > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = max(1.0, uSize * uSizeMul * (1.0 + flash * 0.5) / -mv.z);
}`;
const POINT_FRAG = `
varying vec3 vColor; varying float vAlpha;
uniform float uAlpha, uSharp;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  // Soft glow for the small gallery atoms; a crisp dot with a one-pixel edge under the loupe.
  float soft = exp(-d * 14.0);
  float crisp = 1.0 - smoothstep(0.16, 0.25, d);
  gl_FragColor = vec4(vColor, mix(soft, crisp, uSharp) * vAlpha * uAlpha);
}`;

interface Layer {
  sub: Subshell;
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  shapes: THREE.Mesh[];
  shapeMaterials: THREE.MeshStandardMaterial[];
  from: number;
  to: number;
  scaleFrom: number;
  scaleTo: number;
  t: number;
  /** Radius of this layer's edge in units of a0 / zeff (from the radial table). */
  edge: number;
}

export interface AtomViewOptions {
  /** Points per electron: 6 in the gallery, 220 under the loupe. */
  perSlot: number;
  /** Whether the idealised surfaces are ever built (they are costly for 118 atoms at once). */
  shapes: boolean;
  /** Point size in screen pixels at distance 1, before perspective. */
  pointSize: number;
  /** Electrons blink in and out and jitter (the loupe); off for the gallery's small atoms. */
  live?: boolean;
  /** Crisp dots instead of soft glows. Defaults to on. */
  sharp?: boolean;
}

export class AtomView {
  readonly group = new THREE.Group();
  private layers = new Map<string, Layer>();
  private nucleus: THREE.Points;
  private nucleusMaterial: THREE.ShaderMaterial;
  private style: Style = 'cloud';
  private dim = 1;
  element: Element | null = null;
  /** True when a transition is still running. */
  animating = false;
  private time = 0;
  private live: boolean;

  constructor(private opts: AtomViewOptions) {
    this.live = Boolean(opts.live);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    g.setAttribute('slot', new THREE.BufferAttribute(new Float32Array([0]), 1));
    g.setAttribute('orbital', new THREE.BufferAttribute(new Float32Array([0]), 1));
    g.setAttribute('sign', new THREE.BufferAttribute(new Float32Array([1]), 1));
    this.nucleusMaterial = this.makeMaterial([1, 0.78, 0.6]);
    this.nucleusMaterial.uniforms.uTo.value = 1;
    this.nucleusMaterial.uniforms.uT.value = 1;
    this.nucleusMaterial.uniforms.uSize.value = opts.pointSize * 1.6;
    this.nucleus = new THREE.Points(g, this.nucleusMaterial);
    this.nucleus.frustumCulled = false;
    this.group.add(this.nucleus);
  }

  private makeMaterial(glow: [number, number, number]): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 1 }, uFrom: { value: 0 }, uTo: { value: 0 }, uT: { value: 1 },
        uSize: { value: this.opts.pointSize }, uOrbitals: { value: 1 }, uDim: { value: 1 }, uAlpha: { value: 1 }, uSizeMul: { value: 1 },
        uColor: { value: new THREE.Vector3(...glow) },
        uTime: { value: 0 }, uLive: { value: this.live ? 1 : 0 }, uSharp: { value: this.opts.sharp === false ? 0 : 1 },
      },
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  private makeLayer(sub: Subshell): Layer {
    const material = this.makeMaterial(BLOCK_GLOW[sub.l]);
    material.uniforms.uOrbitals.value = sub.capacity / 2;
    material.uniforms.uTime.value = this.time;
    const points = new THREE.Points(pointGeometry(sub.n, sub.l, this.opts.perSlot), material);
    points.frustumCulled = false;
    this.group.add(points);
    const shapes: THREE.Mesh[] = [];
    const shapeMaterials: THREE.MeshStandardMaterial[] = [];
    if (this.opts.shapes) {
      const colour = new THREE.Color(...BLOCK_GLOW[sub.l]);
      for (let oi = 0; oi < sub.capacity / 2; oi++) {
        const geo = surfaceGeometry(sub.l, oi);
        // Two-tone shading of the lobes by the sign of the wavefunction.
        const mat = new THREE.MeshStandardMaterial({
          color: colour, emissive: colour, emissiveIntensity: 0.25, roughness: 0.55, metalness: 0.1,
          transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        });
        mat.onBeforeCompile = (shader) => {
          shader.vertexShader = 'attribute float sign; varying float vSign;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSign = sign;');
          shader.fragmentShader = 'varying float vSign;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= mix(0.72, 1.12, vSign);');
        };
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        this.group.add(mesh);
        shapes.push(mesh);
        shapeMaterials.push(mat);
      }
    }
    const edge = radialTable(sub.n, L_OF[sub.l]).edge;
    return { sub, points, material, shapes, shapeMaterials, from: 0, to: 0, scaleFrom: 1, scaleTo: 1, t: 1, edge };
  }

  /** Scene units per sampled unit (a0 / zeff) for each layer, so the outermost edge lands on the vdW radius. */
  private layerScales(e: Element): Map<string, number> {
    const raw = e.subshells.map((s) => (radialTable(s.n, L_OF[s.l]).edge * A0) / s.zeff);
    const outer = Math.max(...raw);
    const k = e.vdw / 100 / outer;
    const out = new Map<string, number>();
    e.subshells.forEach((s, i) => out.set(s.key, (k * A0) / s.zeff));
    return out;
  }

  /** Show an element, morphing from whatever is shown now when `animate` is set. */
  setElement(e: Element, animate = true): void {
    this.element = e;
    const scales = this.layerScales(e);
    const seen = new Set<string>();
    for (const sub of e.subshells) {
      seen.add(sub.key);
      let layer = this.layers.get(sub.key);
      if (!layer) {
        layer = this.makeLayer(sub);
        this.layers.set(sub.key, layer);
        layer.scaleFrom = scales.get(sub.key)!;
      } else {
        layer.scaleFrom = this.currentScale(layer);
        layer.from = this.currentCount(layer);
      }
      layer.sub = sub;
      layer.to = sub.count;
      layer.scaleTo = scales.get(sub.key)!;
      layer.t = animate ? 0 : 1;
    }
    for (const [key, layer] of this.layers) {
      if (seen.has(key)) continue;
      layer.from = this.currentCount(layer);
      layer.to = 0;
      layer.scaleFrom = this.currentScale(layer);
      layer.t = animate ? 0 : 1;
    }
    this.animating = animate;
    this.apply();
  }

  private currentCount(l: Layer): number { return l.from + (l.to - l.from) * ease(l.t); }
  private currentScale(l: Layer): number { return l.scaleFrom + (l.scaleTo - l.scaleFrom) * ease(l.t); }

  setStyle(style: Style): void {
    this.style = style;
    this.apply();
  }

  /** Point size in device pixels at unit distance (perspective divides it by depth). */
  setPointSize(px: number): void {
    this.opts.pointSize = px;
    for (const layer of this.layers.values()) layer.material.uniforms.uSize.value = px;
    this.nucleusMaterial.uniforms.uSize.value = px * 1.6;
  }

  /** Overall brightness, used to dim atoms the player has not collected yet. */
  setDim(dim: number): void {
    this.dim = dim;
    this.apply();
  }

  /** Turn the live cloud on or off (off for reduced motion). */
  setLive(on: boolean): void {
    this.live = on;
    for (const layer of this.layers.values()) layer.material.uniforms.uLive.value = on ? 1 : 0;
  }

  /** Advance transitions and the live cloud; call once per frame. */
  update(dt: number): void {
    if (this.live) {
      this.time += dt;
      for (const layer of this.layers.values()) layer.material.uniforms.uTime.value = this.time;
    }
    if (!this.animating) return;
    let busy = false;
    for (const [key, layer] of this.layers) {
      if (layer.t < 1) {
        layer.t = Math.min(1, layer.t + dt / TRANSITION_S);
        busy = busy || layer.t < 1;
      }
      if (layer.t >= 1 && layer.to === 0) {
        this.disposeLayer(layer);
        this.layers.delete(key);
      }
    }
    this.animating = busy;
    this.apply();
  }

  private apply(): void {
    const cloudAlpha = this.style === 'shapes' ? 0 : 1;
    const shapeAlpha = this.style === 'shapes' ? 1 : this.style === 'hybrid' ? 0.35 : 0;
    let outer = 0;
    for (const layer of this.layers.values()) outer = Math.max(outer, this.currentScale(layer) * layer.edge);
    for (const layer of this.layers.values()) {
      const u = layer.material.uniforms;
      u.uFrom.value = layer.from;
      u.uTo.value = layer.to;
      u.uT.value = ease(layer.t);
      u.uScale.value = this.currentScale(layer);
      // Inner layers pack the same points into a far smaller volume, so they draw fainter and finer.
      const rel = Math.min(1, (u.uScale.value * layer.edge) / Math.max(1e-6, outer));
      u.uDim.value = (layer.sub.core ? 0.5 : 1) * (layer.sub.l === 's' && !layer.sub.core ? 1.5 : 1) * Math.max(0.05, Math.pow(rel, 1.4));
      u.uSizeMul.value = 0.4 + 0.6 * rel;
      u.uAlpha.value = cloudAlpha * this.dim;
      const count = this.currentCount(layer);
      const lo = Math.min(layer.from, layer.to), hi = Math.max(layer.from, layer.to);
      layer.shapes.forEach((mesh, oi) => {
        // An orbital's surface appears with its first electron and brightens with its second.
        const have = Math.max(0, Math.min(1, count - oi)) + Math.max(0, Math.min(1, count - oi - layer.sub.capacity / 2)) * 0.5;
        const changing = (oi >= lo && oi < hi) || (oi + layer.sub.capacity / 2 >= lo && oi + layer.sub.capacity / 2 < hi);
        const flash = changing ? Math.sin(ease(layer.t) * Math.PI) : 0;
        const radius = u.uScale.value * layer.edge;
        mesh.visible = have > 0 && shapeAlpha > 0;
        mesh.scale.setScalar(radius * (0.6 + 0.4 * Math.min(1, have)));
        const m = layer.shapeMaterials[oi];
        // s shells are drawn as thin glass so the lobes inside stay visible; core layers fainter still.
        const base = layer.sub.l === 's' ? 0.12 : 0.6;
        m.opacity = shapeAlpha * base * Math.min(1, have) * (layer.sub.core ? 0.45 : 1) * this.dim;
        m.emissiveIntensity = 0.25 + flash * 1.2;
        m.emissive.setRGB(...BLOCK_GLOW[layer.sub.l]);
        if (flash > 0) m.emissive.lerp(layer.to > layer.from ? new THREE.Color(1, 1, 1) : new THREE.Color(1, 0.3, 0.2), flash * 0.8);
      });
    }
    this.nucleusMaterial.uniforms.uAlpha.value = this.dim;
  }

  private disposeLayer(layer: Layer): void {
    this.group.remove(layer.points);
    layer.material.dispose();
    for (const mesh of layer.shapes) this.group.remove(mesh);
    for (const m of layer.shapeMaterials) m.dispose();
  }

  dispose(): void {
    for (const layer of this.layers.values()) this.disposeLayer(layer);
    this.layers.clear();
    this.group.remove(this.nucleus);
    this.nucleusMaterial.dispose();
    this.nucleus.geometry.dispose();
  }
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
