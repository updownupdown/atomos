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
function pointGeometry(n: number, block: Block, perSlot: number, body = false): THREE.BufferGeometry {
  const key = `${n}${block}/${perSlot}${body ? 'b' : ''}`;
  let g = pointGeometries.get(key);
  if (!g) {
    // The body under the sparks keeps to the lobes: sharper angles, and nothing past the drawn edge.
    const c = body ? sampleSubshell(n, block, perSlot * 2, BODY_SHARPEN, BODY_WITHIN) : sampleSubshell(n, block, perSlot * 2);
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
uniform float uScale, uFrom, uTo, uT, uSize, uOrbitals, uDim, uSizeMul, uTime, uLive, uSwap, uTone;
uniform vec3 uColor;
varying vec3 vColor; varying float vAlpha;
float hash(float x) { return fract(sin(x) * 43758.5453); }
void main() {
  // Live cloud, like fireflies: each point glows up and fades away over several seconds,
  // then reappears at its other sample while dark, drifting gently while it is lit.
  // Rates vary per point so nothing pulses in step.
  float rate = 0.08 + seed * 0.14;
  float cyc = uTime * rate + seed * 17.0;
  float k = fract(cyc);
  float other = mod(floor(cyc), 2.0);
  vec3 home = mix(position, position2, other * uSwap);
  float glow = sin(k * 3.14159);
  float life = glow * glow;
  float lit = mix(1.0, life, uLive);
  float ph = seed * 61.0;
  vec3 drift = vec3(sin(uTime * 0.41 + ph), sin(uTime * 0.33 + ph * 1.7), sin(uTime * 0.27 + ph * 2.3));
  home += drift * (0.025 * length(home) + 0.02) * uLive;
  float shown = mix(uFrom, uTo, uT);
  float a = clamp(shown - slot, 0.0, 1.0);
  float lo = min(uFrom, uTo), hi = max(uFrom, uTo);
  float changing = step(lo, slot) * (1.0 - step(hi, slot));
  float flash = changing * sin(uT * 3.14159);
  float tint = uOrbitals > 1.0 ? (orbital / (uOrbitals - 1.0) - 0.5) * 0.55 : 0.0;
  vec3 c = tint > 0.0 ? uColor + (1.0 - uColor) * tint : uColor * (1.0 + tint);
  // Two-tone by the sign of the wavefunction, as the shapes are shaded, so neighboring lobes part.
  c *= mix(1.0 - uTone, 1.0 + uTone * 0.4, sign);
  vec3 flashColor = uTo > uFrom ? vec3(1.0) : vec3(1.0, 0.32, 0.22);
  vColor = mix(c, flashColor, flash * 0.9);
  vAlpha = a * uDim * (1.0 + flash * 0.8) * lit;
  vec4 mv = modelViewMatrix * vec4(home * uScale, 1.0);
  gl_Position = a > 0.0 && lit > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = max(1.0, uSize * uSizeMul * (1.0 + flash * 0.5) * mix(1.0, 0.55 + 0.45 * life, uLive) / -mv.z);
}`;
const POINT_FRAG = `
varying vec3 vColor; varying float vAlpha;
uniform float uAlpha, uSharp, uLive;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  // Soft glow or a crisp dot for the small gallery atoms; under the loupe a bright core with a faint halo.
  float soft = exp(-d * 14.0);
  float edge = 1.0 - smoothstep(0.16, 0.25, d);
  float jewel = min(1.0, (1.0 - smoothstep(0.05, 0.12, d)) + exp(-d * 22.0) * 0.45);
  float crisp = mix(edge, jewel, uLive);
  gl_FragColor = vec4(vColor, mix(soft, crisp, uSharp) * vAlpha * uAlpha);
}`;

interface Layer {
  sub: Subshell;
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  /** The soft glow behind the sparks (loupe only): fewer, far larger, faint points. */
  haze: THREE.Points | null;
  hazeMaterial: THREE.ShaderMaterial | null;
  shapes: THREE.Mesh[];
  shapeMaterials: THREE.MeshStandardMaterial[];
  from: number;
  to: number;
  scaleFrom: number;
  scaleTo: number;
  t: number;
  /** Radius of this layer's edge in units of a0 / zeff (from the radial table). */
  edge: number;
  /** How far this layer has turned from pale gray to its orbital color (0 to 1), and where it is heading. */
  vivid: number;
  vividTo: number;
  /** A brief white glint as the layer lights up, fading from 1. */
  glint: number;
}

/** How much of an atom is lit (in color): its nucleus, and how many of its electrons, counted in
 *  the order they fill the subshells (0 to z). Unlit parts are drawn pale gray. */
export interface AtomLit {
  nucleus: boolean;
  electrons: number;
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
  /** A soft nebula of light behind the sparks, so even hydrogen's one electron reads as a
   *  luminous body. For the loupe; too costly for 118 atoms at once. */
  haze?: boolean;
}

/** Points per electron in the haze, and how much larger and fainter they draw than the sparks.
 *  The haze is the cloud's body: dense enough to fill each lobe, so the orbitals read as solid
 *  forms the way the shapes do, with the sparks living on top. */
const HAZE_PER_SLOT = 600;
/** A round s layer needs far fewer to read as a smooth shell. */
const HAZE_PER_SLOT_S = 260;
const HAZE_SIZE = 7;
const HAZE_ALPHA = 0.06;
/** The haze of a layer with lobes, and of an s layer drawn as glass over them, against a lone s layer. */
const HAZE_LOBES = 2.2;
const HAZE_GLASS = 0.75;
/** How far the haze's two lobe signs part in brightness. */
const HAZE_TONE = 0.3;
/** The haze's sampling: angles sharpened more than the sparks, radii kept inside the drawn edge. */
const BODY_SHARPEN = 3;
const BODY_WITHIN = 0.85;
/** How strongly an undiscovered orbital shape still shows, as a ghost over its cloud. */
const GHOST = 0.12;
/** A part not built yet: pale gray, and a little fainter than when it is in color. */
const PALE: [number, number, number] = [0.7, 0.72, 0.74];
const PALE_ALPHA = 0.8;
/** Seconds a part takes to turn between gray and color. */
const VIVID_S = 0.4;
const GLINT_S = 0.9;
const NUCLEUS_GLOW: [number, number, number] = [1, 0.78, 0.6];
const HALO_GLOW: [number, number, number] = [1, 0.7, 0.45];

export class AtomView {
  readonly group = new THREE.Group();
  private layers = new Map<string, Layer>();
  private tint: [number, number, number] | null = null;
  private nucleus: THREE.Points;
  private nucleusMaterial: THREE.ShaderMaterial;
  private halo: THREE.Points | null = null;
  private haloMaterial: THREE.ShaderMaterial | null = null;
  private style: Style = 'cloud';
  /** Orbital kinds whose shapes the player has not discovered yet (Glyph). */
  private hidden = new Set<Block>();
  private dim = 1;
  /** What is lit; layers made later take their color from here. Infinity lights every electron. */
  private lit: AtomLit = { nucleus: true, electrons: Infinity };
  private nucleusVivid = 1;
  private nucleusVividTo = 1;
  private nucleusGlint = 0;
  private reduced = false;
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
    this.nucleusMaterial = this.makeMaterial(NUCLEUS_GLOW);
    this.nucleusMaterial.uniforms.uTo.value = 1;
    this.nucleusMaterial.uniforms.uT.value = 1;
    this.nucleusMaterial.uniforms.uSize.value = opts.pointSize * 1.6;
    this.nucleus = new THREE.Points(g, this.nucleusMaterial);
    this.nucleus.frustumCulled = false;
    this.group.add(this.nucleus);
    if (opts.haze) {
      // A warm glow round the nucleus: the eye's anchor at the center of the cloud.
      this.haloMaterial = this.makeMaterial(HALO_GLOW, true);
      this.haloMaterial.uniforms.uTo.value = 1;
      this.haloMaterial.uniforms.uT.value = 1;
      this.haloMaterial.uniforms.uSize.value = opts.pointSize * 10;
      this.haloMaterial.uniforms.uAlpha.value = 0.55;
      this.halo = new THREE.Points(g, this.haloMaterial);
      this.halo.frustumCulled = false;
      this.group.add(this.halo);
    }
  }

  /** A layer's point material; `soft` makes the steady, blurred kind the haze and halo use. */
  private makeMaterial(glow: [number, number, number], soft = false): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 1 }, uFrom: { value: 0 }, uTo: { value: 0 }, uT: { value: 1 },
        uSize: { value: this.opts.pointSize }, uOrbitals: { value: 1 }, uDim: { value: 1 }, uAlpha: { value: 1 }, uSizeMul: { value: 1 },
        uColor: { value: new THREE.Vector3(...glow) },
        uTone: { value: 0 },
        uTime: { value: 0 }, uLive: { value: this.live && !soft ? this.liveAmount : 0 }, uSwap: { value: this.live && !soft ? this.swap : 0 }, uSharp: { value: this.opts.sharp === false || soft ? 0 : 1 },
      },
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  private makeLayer(sub: Subshell): Layer {
    const material = this.makeMaterial(this.glow(sub.l));
    material.uniforms.uOrbitals.value = sub.capacity / 2;
    material.uniforms.uTime.value = this.time;
    let haze: THREE.Points | null = null, hazeMaterial: THREE.ShaderMaterial | null = null;
    if (this.opts.haze) {
      hazeMaterial = this.makeMaterial(this.glow(sub.l), true);
      hazeMaterial.uniforms.uOrbitals.value = sub.capacity / 2;
      hazeMaterial.uniforms.uSize.value = this.opts.pointSize * HAZE_SIZE;
      hazeMaterial.uniforms.uTone.value = HAZE_TONE;
      haze = new THREE.Points(pointGeometry(sub.n, sub.l, sub.l === 's' ? HAZE_PER_SLOT_S : HAZE_PER_SLOT, true), hazeMaterial);
      haze.frustumCulled = false;
      this.group.add(haze);
    }
    const points = new THREE.Points(pointGeometry(sub.n, sub.l, this.opts.perSlot), material);
    points.frustumCulled = false;
    this.group.add(points);
    const shapes: THREE.Mesh[] = [];
    const shapeMaterials: THREE.MeshStandardMaterial[] = [];
    if (this.opts.shapes) {
      const colour = new THREE.Color(...this.glow(sub.l));
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
    const vivid = this.litShare(sub.key);
    return { sub, points, material, haze, hazeMaterial, shapes, shapeMaterials, from: 0, to: 0, scaleFrom: 1, scaleTo: 1, t: 1, edge, vivid, vividTo: vivid, glint: 0 };
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

  /** Orbital kinds whose shapes are still undiscovered. Shapes and Hybrid draw those layers as
   *  their cloud with only a faint ghost of the shape; Cloud is unchanged. */
  setHiddenShapes(kinds: Iterable<Block>): void {
    this.hidden = new Set(kinds);
    this.apply();
  }

  /** Point size in device pixels at unit distance (perspective divides it by depth). */
  setPointSize(px: number): void {
    this.opts.pointSize = px;
    for (const layer of this.layers.values()) {
      layer.material.uniforms.uSize.value = px;
      if (layer.hazeMaterial) layer.hazeMaterial.uniforms.uSize.value = px * HAZE_SIZE;
    }
    this.nucleusMaterial.uniforms.uSize.value = px * 1.6;
    if (this.haloMaterial) this.haloMaterial.uniforms.uSize.value = px * 10;
  }

  /** The glow of a layer: its block color, or the tint when one is set. */
  private glow(l: Block): [number, number, number] {
    return this.tint ?? BLOCK_GLOW[l];
  }

  /** Paint every layer one color (any CSS color the browser parses into rgb), or null for the
   *  block colors. Build uses it for the player's chosen paint. */
  setTint(color: string | null): void {
    if (color) {
      const c = new THREE.Color();
      c.setStyle(color);
      this.tint = [c.r, c.g, c.b];
    } else this.tint = null;
    this.apply();
  }

  /** The share of a subshell's electrons that are lit (0 to 1), filling in Aufbau order. */
  private litShare(key: string): number {
    if (!this.element) return 1;
    let before = 0;
    for (const k of fillOrder(this.element)) {
      const sub = this.element.subshells.find((x) => x.key === k)!;
      if (k === key) return Math.max(0, Math.min(1, (this.lit.electrons - before) / sub.count));
      before += sub.count;
    }
    return 0;
  }

  /**
   * How much of the atom is lit. Every part is always drawn: unlit parts are pale gray and a
   * little fainter, lit ones take their color (the nucleus warm, each subshell its orbital color).
   * Electrons light subshell by subshell in Aufbau order, a partly lit subshell blending between
   * the two. With `animate`, each change eases over 0.4 s and a part that comes fully alight
   * glints white for a moment, so stepping `electrons` from 0 to z makes the atom come alive.
   */
  setLit(lit: AtomLit, animate = false): void {
    this.lit = { ...lit };
    for (const layer of this.layers.values()) {
      const to = this.litShare(layer.sub.key);
      if (animate && !this.reduced && to === 1 && layer.vividTo < 1) layer.glint = 1;
      layer.vividTo = to;
      if (!animate) { layer.vivid = to; layer.glint = 0; }
    }
    const n = lit.nucleus ? 1 : 0;
    if (animate && !this.reduced && n === 1 && this.nucleusVividTo < 1) this.nucleusGlint = 1;
    this.nucleusVividTo = n;
    if (!animate) { this.nucleusVivid = n; this.nucleusGlint = 0; }
    this.animating = this.animating || animate;
    this.apply();
  }

  /** Overall brightness on top of the parts (1 = full). */
  setDim(dim: number): void {
    this.dim = dim;
    this.apply();
  }

  /** Turn the live cloud on or off (off for reduced motion). */
  setLive(on: boolean): void {
    this.live = on;
    this.reduced = !on;
    this.liveAmount = on ? 1 : 0;
    this.swap = this.liveAmount;
    for (const layer of this.layers.values()) {
      layer.material.uniforms.uLive.value = this.liveAmount;
      layer.material.uniforms.uSwap.value = this.swap;
    }
  }

  /** How strongly the live cloud twinkles, 0 (still, though transitions still ease) to 1. With
   *  `hold`, a twinkle easing down to 0 freezes where it is rather than jumping its points back
   *  to their first places. */
  setTwinkle(amount: number, hold = false): void {
    this.live = amount > 0;
    this.liveAmount = amount;
    if (amount > 0 || !hold) this.swap = amount > 0 ? 1 : 0;
    for (const layer of this.layers.values()) {
      layer.material.uniforms.uLive.value = amount;
      layer.material.uniforms.uSwap.value = this.swap;
    }
  }
  private liveAmount = 1;
  /** Whether points show their second sample when their cycle says so (1) or only their first. */
  private swap = 1;

  /** Advance transitions and the live cloud; call once per frame. */
  update(dt: number): void {
    if (this.stepColor(dt)) this.animating = true;
    if (this.live) {
      this.time += dt;
      for (const layer of this.layers.values()) layer.material.uniforms.uTime.value = this.time;
    }
    if (!this.animating) return;
    let busy = this.coloring();
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

  /** Move each part's color toward where it is heading; true while anything is still changing. */
  private stepColor(dt: number): boolean {
    const k = dt / (this.reduced ? 0.2 : VIVID_S);
    const toward = (v: number, to: number) => (v < to ? Math.min(to, v + k) : Math.max(to, v - k));
    const fade = (g: number) => (g > 0.01 ? g * Math.exp(-dt * (4.6 / GLINT_S)) : 0);
    for (const layer of this.layers.values()) {
      layer.vivid = toward(layer.vivid, layer.vividTo);
      layer.glint = fade(layer.glint);
    }
    this.nucleusVivid = toward(this.nucleusVivid, this.nucleusVividTo);
    this.nucleusGlint = fade(this.nucleusGlint);
    return this.coloring();
  }

  private coloring(): boolean {
    if (this.nucleusVivid !== this.nucleusVividTo || this.nucleusGlint > 0) return true;
    for (const layer of this.layers.values()) if (layer.vivid !== layer.vividTo || layer.glint > 0) return true;
    return false;
  }

  private apply(): void {
    const cloudAlpha = this.style === 'shapes' ? 0 : 1;
    const shapeAlpha = this.style === 'shapes' ? 1 : this.style === 'hybrid' ? 0.35 : 0;
    let outer = 0, lobes = false;
    for (const layer of this.layers.values()) {
      outer = Math.max(outer, this.currentScale(layer) * layer.edge);
      if (layer.sub.l !== 's' && layer.to > 0) lobes = true;
    }
    for (const layer of this.layers.values()) {
      const hidden = this.hidden.has(layer.sub.l);
      const u = layer.material.uniforms;
      // Pale gray until built, the orbital color after, with a white glint as it lights up.
      const v = ease(layer.vivid);
      const glow = mixRGB(mixRGB(PALE, this.glow(layer.sub.l), v), [1, 1, 1], layer.glint * 0.7);
      const pale = PALE_ALPHA + (1 - PALE_ALPHA) * v + layer.glint * 0.6;
      (u.uColor.value as THREE.Vector3).set(...glow);
      if (layer.hazeMaterial) (layer.hazeMaterial.uniforms.uColor.value as THREE.Vector3).set(...glow);
      u.uFrom.value = layer.from;
      u.uTo.value = layer.to;
      u.uT.value = ease(layer.t);
      u.uScale.value = this.currentScale(layer);
      // Inner layers pack the same points into a far smaller volume, so they draw fainter and finer.
      const rel = Math.min(1, (u.uScale.value * layer.edge) / Math.max(1e-6, outer));
      // A round s layer would wash over the lobes inside it, so where there are lobes to see it
      // draws as thin glass, as the shapes draw it; alone (hydrogen to beryllium) it is the atom.
      const glass = layer.sub.l === 's' && lobes;
      u.uDim.value = (layer.sub.core ? 0.5 : 1) * (layer.sub.l === 's' && !layer.sub.core ? (glass ? 1 : 1.5) : 1) * Math.max(0.05, Math.pow(rel, 1.4));
      u.uSizeMul.value = 0.4 + 0.6 * rel;
      u.uAlpha.value = (hidden ? 1 : cloudAlpha) * this.dim * pale;
      const count = this.currentCount(layer);
      if (layer.hazeMaterial) {
        const h = layer.hazeMaterial.uniforms;
        h.uFrom.value = u.uFrom.value; h.uTo.value = u.uTo.value; h.uT.value = u.uT.value; h.uScale.value = u.uScale.value;
        h.uDim.value = u.uDim.value;
        // Inner layers are small and dense: their haze shrinks with them. Many electrons in one
        // layer overlap into a bright mass, so each one's share of glow falls as the layer fills.
        h.uSizeMul.value = 0.25 + 0.75 * rel;
        h.uAlpha.value = (this.style === 'shapes' && !hidden ? 0.35 : 1) * (glass ? HAZE_GLASS : layer.sub.l === 's' ? 1 : HAZE_LOBES) * this.dim * pale * HAZE_ALPHA / Math.sqrt(Math.max(1, count));
      }
      const lo = Math.min(layer.from, layer.to), hi = Math.max(layer.from, layer.to);
      layer.shapes.forEach((mesh, oi) => {
        // An orbital's surface appears with its first electron and brightens with its second.
        const have = Math.max(0, Math.min(1, count - oi)) + Math.max(0, Math.min(1, count - oi - layer.sub.capacity / 2)) * 0.5;
        const changing = (oi >= lo && oi < hi) || (oi + layer.sub.capacity / 2 >= lo && oi + layer.sub.capacity / 2 < hi);
        const flash = changing && !hidden ? Math.sin(ease(layer.t) * Math.PI) : 0;
        const radius = u.uScale.value * layer.edge;
        mesh.visible = have > 0 && shapeAlpha > 0;
        mesh.scale.setScalar(radius * (0.6 + 0.4 * Math.min(1, have)));
        const m = layer.shapeMaterials[oi];
        // s shells are drawn as thin glass so the lobes inside stay visible; core layers fainter still.
        const base = layer.sub.l === 's' ? 0.12 : 0.6;
        m.opacity = shapeAlpha * base * Math.min(1, have) * (layer.sub.core ? 0.45 : 1) * (hidden ? GHOST : 1) * this.dim * pale;
        m.emissiveIntensity = 0.25 + flash * 1.2 + layer.glint * 0.8;
        m.color.setRGB(...glow);
        m.emissive.setRGB(...glow);
        if (flash > 0) m.emissive.lerp(layer.to > layer.from ? new THREE.Color(1, 1, 1) : new THREE.Color(1, 0.3, 0.2), flash * 0.8);
      });
    }
    const nv = ease(this.nucleusVivid), ng = this.nucleusGlint;
    const npale = PALE_ALPHA + (1 - PALE_ALPHA) * nv + ng * 0.6;
    (this.nucleusMaterial.uniforms.uColor.value as THREE.Vector3).set(...mixRGB(mixRGB(PALE, NUCLEUS_GLOW, nv), [1, 1, 1], ng * 0.7));
    this.nucleusMaterial.uniforms.uAlpha.value = this.dim * npale;
    if (this.haloMaterial) {
      (this.haloMaterial.uniforms.uColor.value as THREE.Vector3).set(...mixRGB(PALE, HALO_GLOW, nv));
      this.haloMaterial.uniforms.uAlpha.value = 0.55 * this.dim * npale * (1 + ng * 0.8);
    }
  }

  private disposeLayer(layer: Layer): void {
    this.group.remove(layer.points);
    layer.material.dispose();
    if (layer.haze) this.group.remove(layer.haze);
    layer.hazeMaterial?.dispose();
    for (const mesh of layer.shapes) this.group.remove(mesh);
    for (const m of layer.shapeMaterials) m.dispose();
  }

  dispose(): void {
    for (const layer of this.layers.values()) this.disposeLayer(layer);
    this.layers.clear();
    this.group.remove(this.nucleus);
    this.nucleusMaterial.dispose();
    if (this.halo) this.group.remove(this.halo);
    this.haloMaterial?.dispose();
    this.nucleus.geometry.dispose();
  }
}

function mixRGB(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** An atom's subshells in the order electrons fill them (n + l, then n). */
export function fillOrder(e: Element | null): string[] {
  if (!e) return [];
  return [...e.subshells].sort((a, b) => a.n + L_OF[a.l] - (b.n + L_OF[b.l]) || a.n - b.n).map((s) => s.key);
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
