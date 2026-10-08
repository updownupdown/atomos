import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  ORBITALS, P_ORBITALS, axisOrbital, effectiveCharge, effectiveChargeForNew,
  type Atom, type Axis, type OrbitalId,
} from '../core/physics';
import { sample1s, sample2p, sample2s, type OrbitalSamples } from './orbitals';

const VERT = /* glsl */ `
attribute vec3 aAlt;
attribute float aSign;
attribute float aRank;
uniform float uTime, uScale, uSize, uRefDist, uFill, uGhost, uMorph, uShimmer;
varying float vAlpha;
varying float vSign;
void main() {
  vec3 p = mix(aAlt, position, uMorph);
  float t = uTime * 0.7 + aRank * 60.0;
  p += uShimmer * 0.05 * length(p) * vec3(sin(t * 1.3), sin(t * 1.7 + 1.0), sin(t * 1.1 + 2.0));
  p *= uScale;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float on = step(aRank, uFill);
  float ghost = (1.0 - on) * step(aRank, uFill + 0.5) * uGhost;
  vAlpha = on + ghost * 0.3;
  vSign = aSign;
  gl_PointSize = vAlpha < 0.001 ? 0.0 : uSize * (0.7 + 0.8 * fract(aRank * 91.7)) * uRefDist / -mv.z;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColorPos, uColorNeg;
uniform float uIntensity;
varying float vAlpha;
varying float vSign;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float fall = exp(-d * 16.0);
  vec3 col = mix(uColorNeg, uColorPos, vSign);
  gl_FragColor = vec4(col * fall * vAlpha * uIntensity, 1.0);
}`;

interface Cloud {
  id: OrbitalId;
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  samples: OrbitalSamples;
  fill: number;
  fillTarget: number;
  ghost: number;
  ghostTarget: number;
  morph: number;
  morphTarget: number;
  scale: number;
  scaleTarget: number;
  focus: number;
  focusTarget: number;
}

interface Tween {
  start: number;
  dur: number;
  update: (p: number) => void;
  done?: () => void;
}

export interface ScreenPoint { x: number; y: number }

const POINTS: Record<OrbitalId, number> = { '1s': 16000, '2s': 22000, '2px': 18000, '2py': 18000, '2pz': 18000 };

export class AtomScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private clouds = new Map<OrbitalId, Cloud>();
  private nucleus: THREE.InstancedMesh;
  private nucleusGroup = new THREE.Group();
  private nucleonBase: THREE.Vector3[] = [];
  private nucleusZ = 0;
  private tweens: Tween[] = [];
  private timer = new THREE.Timer();
  private extent = 1;
  private extentTarget = 1;
  private dist = 6;
  private reducedMotion = false;
  private unstable = false;
  private lastInteraction = 0;
  private colourPos = new THREE.Color('#6fd3ff');
  private colourNeg = new THREE.Color('#ff7ad9');

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.scene.background = new THREE.Color('#03050b');

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.001, 1000);
    this.camera.position.set(0.9, 0.6, 3).normalize().multiplyScalar(this.dist);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.rotateSpeed = 0.6;
    // One finger and the left mouse button belong to the slingshot.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE } as unknown as typeof this.controls.mouseButtons;
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE } as unknown as typeof this.controls.touches;
    this.controls.addEventListener('start', () => (this.lastInteraction = performance.now()));

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.PointLight(0xffffff, 3, 0, 0);
    this.camera.add(key);
    this.scene.add(this.camera);

    this.addStars();
    this.buildClouds();

    this.nucleus = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05, emissive: new THREE.Color('#1a1410') }),
      40,
    );
    this.nucleus.count = 0;
    this.nucleusGroup.add(this.nucleus);
    this.scene.add(this.nucleusGroup);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.65, 0.5, 0.15);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  private addStars(): void {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = 2 * Math.random() - 1, phi = 2 * Math.PI * Math.random(), s = Math.sqrt(1 - u * u);
      const r = 300;
      pos.set([s * Math.cos(phi) * r, s * Math.sin(phi) * r, u * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x6f7ea8, size: 1, sizeAttenuation: false, transparent: true, opacity: 0.3 }));
    this.scene.add(stars);
  }

  private buildClouds(): void {
    const base = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uScale: { value: 1 }, uSize: { value: 2 }, uRefDist: { value: 6 },
        uFill: { value: 0 }, uGhost: { value: 0 }, uMorph: { value: 1 }, uShimmer: { value: 1 },
        uColorPos: { value: new THREE.Color() }, uColorNeg: { value: new THREE.Color() }, uIntensity: { value: 0.2 },
      },
    });
    for (const id of ORBITALS) {
      const n = POINTS[id];
      const samples = id === '1s' ? sample1s(n) : id === '2s' ? sample2s(n) : sample2p(n, id.slice(2) as Axis);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(samples.positions, 3));
      g.setAttribute('aAlt', new THREE.BufferAttribute(samples.alt, 1 * 3));
      g.setAttribute('aSign', new THREE.BufferAttribute(samples.sign, 1));
      g.setAttribute('aRank', new THREE.BufferAttribute(samples.rank, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mat = base.clone();
      const points = new THREE.Points(g, mat);
      points.frustumCulled = false;
      this.scene.add(points);
      this.clouds.set(id, {
        id, points, mat, samples, fill: 0, fillTarget: 0, ghost: 0, ghostTarget: 0,
        morph: 1, morphTarget: 1, scale: 1, scaleTarget: 1, focus: 1, focusTarget: 1,
      });
    }
  }

  setColour(hex: string): void {
    this.colourPos.set(hex);
    this.colourNeg.set(hex).offsetHSL(0.42, 0, -0.05);
  }

  /** Bring every cloud, the nucleus and the framing in line with an atom. */
  setAtom(atom: Atom, neutrons: number, options: { pDiscovered: boolean; target?: OrbitalId | null }): void {
    for (const c of this.clouds.values()) {
      const count = atom.orbitals[c.id].length;
      c.fillTarget = count / 2;
      const zeff = count > 0 ? effectiveCharge(atom, c.id) : effectiveChargeForNew(atom, c.id);
      c.scaleTarget = 1 / Math.max(0.6, zeff);
      if (P_ORBITALS.includes(c.id)) c.morphTarget = options.pDiscovered ? 1 : 0;
    }
    // Once p electrons are in play, dim the inner spherical clouds so the lobes read clearly.
    const pInPlay = P_ORBITALS.some((id) => atom.orbitals[id].length > 0) || (options.target?.startsWith('2p') ?? false);
    for (const c of this.clouds.values()) {
      c.focusTarget = !pInPlay ? 1 : c.id === '1s' ? 0.3 : c.id === '2s' ? 0.35 : 1;
    }
    // Frame the outermost occupied orbital, or the one about to be filled.
    let extent = 0;
    for (const c of this.clouds.values()) {
      const relevant = atom.orbitals[c.id].length > 0 || c.id === options.target;
      if (relevant) extent = Math.max(extent, c.samples.radius90 * c.scaleTarget);
    }
    if (extent === 0) extent = 2.66 / atom.z;
    this.extentTarget = extent;
    this.setNucleus(atom.z, neutrons);
  }

  setGhost(target: OrbitalId | null): void {
    for (const c of this.clouds.values()) c.ghostTarget = c.id === target ? 1 : 0;
  }

  /** Show the uncut spherical cloud that the player slices into a p orbital. */
  showUncut(on: boolean): void {
    const c = this.clouds.get('2px')!;
    c.morph = 0;
    c.morphTarget = 0;
    c.ghostTarget = on ? 1 : 0;
    this.extentTarget = Math.max(this.extentTarget, c.samples.radius90 * c.scaleTarget);
  }

  /** The cut: the sphere splits into a dumbbell along the chosen axis. */
  cut(axis: Axis): Promise<void> {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const normal = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    plane.lookAt(normal);
    plane.scale.setScalar(this.extent * 3);
    this.scene.add(plane);
    for (const c of this.clouds.values()) if (c.id !== axisOrbital(axis)) c.ghostTarget = 0;
    const target = this.clouds.get(axisOrbital(axis))!;
    target.morph = 0;
    target.ghost = 1;
    target.ghostTarget = 1;
    return new Promise((resolve) => {
      this.tween(this.reducedMotion ? 400 : 1600, (p) => {
        (plane.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.sin(Math.PI * Math.min(1, p * 2));
        target.morph = target.morphTarget = easeInOut(p);
      }, () => {
        this.scene.remove(plane);
        for (const id of P_ORBITALS) this.clouds.get(id)!.morph = this.clouds.get(id)!.morphTarget = 1;
        resolve();
      });
    });
  }

  private setNucleus(z: number, n: number): void {
    const count = z + n;
    if (this.nucleus.count !== count || this.nucleonBase.length !== count || this.nucleusZ !== z) {
      this.nucleusZ = z;
      this.nucleonBase = packNucleons(count);
      this.nucleus.count = count;
      const proton = new THREE.Color('#ffb070');
      const neutron = new THREE.Color('#8fb0ff');
      // Interleave protons and neutrons so neither clumps on one side.
      let p = 0;
      for (let i = 0; i < count; i++) {
        const wantProton = p < z && (i % 2 === 0 || count - i <= z - p);
        this.nucleus.setColorAt(i, wantProton ? proton : neutron);
        if (wantProton) p++;
      }
      if (this.nucleus.instanceColor) this.nucleus.instanceColor.needsUpdate = true;
    }
  }

  setUnstable(on: boolean): void {
    this.unstable = on;
  }

  // ---- screen helpers -------------------------------------------------------

  toScreen(v: THREE.Vector3): ScreenPoint {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * r.width + r.left, y: ((1 - p.y) / 2) * r.height + r.top };
  }

  nucleusScreen(): ScreenPoint {
    return this.toScreen(new THREE.Vector3());
  }

  /** Screen radius of the current framing extent, in CSS pixels. */
  extentScreenRadius(): number {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(this.extent);
    const a = this.toScreen(new THREE.Vector3());
    const b = this.toScreen(right);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /** Screen directions (unit, y down) of the three lobe axes as seen from the camera now. */
  axisDirections(): Record<Axis, { x: number; y: number; len: number }> {
    const o = this.toScreen(new THREE.Vector3());
    const out = {} as Record<Axis, { x: number; y: number; len: number }>;
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const v = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0).multiplyScalar(this.extent);
      const p = this.toScreen(v);
      const dx = p.x - o.x, dy = p.y - o.y;
      const len = Math.hypot(dx, dy) || 1;
      out[axis] = { x: dx / len, y: dy / len, len };
    }
    return out;
  }

  /**
   * Pick the lobe whose on-screen direction best matches a screen direction (y down).
   * Every axis projects to its own direction on screen, so all three are reachable
   * without turning the atom; an axis pointing almost straight at the viewer is skipped.
   */
  screenDirToAxis(dx: number, dy: number): Axis {
    const dirs = this.axisDirections();
    const maxLen = Math.max(dirs.x.len, dirs.y.len, dirs.z.len);
    const l = Math.hypot(dx, dy) || 1;
    let best: Axis = 'x';
    let bestScore = -1;
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const d = dirs[axis];
      if (d.len < maxLen * 0.2) continue;
      const score = Math.abs((d.x * dx + d.y * dy) / l);
      if (score > bestScore) {
        bestScore = score;
        best = axis;
      }
    }
    return best;
  }

  /** Axis most aligned with the camera's line of sight. */
  viewAxis(): Axis {
    const f = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
    const ax = Math.abs(f.x), ay = Math.abs(f.y), az = Math.abs(f.z);
    return ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
  }

  /** Axis that lies in the screen plane, perpendicular to a screen direction. */
  screenPerpAxis(dx: number, dy: number): Axis {
    return this.screenDirToAxis(-dy, dx);
  }

  private screenToWorldOnPlane(s: ScreenPoint): THREE.Vector3 {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((s.x - r.left) / r.width) * 2 - 1, -((s.y - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const normal = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
    const plane = new THREE.Plane(normal, 0);
    const out = new THREE.Vector3();
    ray.ray.intersectPlane(plane, out);
    return out;
  }

  // ---- effects ----------------------------------------------------------------

  private makeElectron(): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 3.2) }));
    m.scale.setScalar(this.extent * 0.035);
    this.scene.add(m);
    return m;
  }

  private startPoint(from: ScreenPoint): THREE.Vector3 {
    const p = this.screenToWorldOnPlane(from);
    const min = this.extent * 2.2;
    if (p.length() < min) p.setLength(min);
    return p;
  }

  /** Electron flies in from where the slingshot was released and spirals into the cloud. */
  launch(from: ScreenPoint, power: number): Promise<void> {
    this.lastInteraction = performance.now();
    const e = this.makeElectron();
    const start = this.startPoint(from);
    const dur = this.reducedMotion ? 250 : 650 - 250 * power;
    const turn = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
    return new Promise((resolve) => {
      this.tween(dur, (p) => {
        const k = easeIn(p);
        const r = start.length() * (1 - k) + this.extent * 0.25 * k;
        const dir = start.clone().normalize().applyAxisAngle(turn, k * 2.4);
        e.position.copy(dir.multiplyScalar(r));
        e.scale.setScalar(this.extent * (0.035 - 0.02 * k));
      }, () => {
        this.scene.remove(e);
        resolve();
      });
    });
  }

  /** Electron approaches, is refused by the atom, and flies back out. */
  bounce(from: ScreenPoint): Promise<void> {
    const e = this.makeElectron();
    const start = this.startPoint(from);
    const near = start.clone().setLength(this.extent * 1.1);
    (e.material as THREE.MeshBasicMaterial).color.setRGB(3, 1.2, 1.2);
    return new Promise((resolve) => {
      this.tween(this.reducedMotion ? 300 : 900, (p) => {
        const k = p < 0.5 ? easeIn(p * 2) : 1 - easeOut((p - 0.5) * 2);
        e.position.lerpVectors(start, near, k);
      }, () => {
        this.scene.remove(e);
        resolve();
      });
    });
  }

  /** The outermost electron is knocked free. */
  ionise(): Promise<void> {
    const e = this.makeElectron();
    const dir = new THREE.Vector3().randomDirection();
    this.flash('#ff6a5a', 1.4);
    return new Promise((resolve) => {
      this.tween(this.reducedMotion ? 300 : 800, (p) => {
        e.position.copy(dir).multiplyScalar(this.extent * (0.3 + 4 * easeIn(p)));
      }, () => {
        this.scene.remove(e);
        resolve();
      });
    });
  }

  /** A photon leaves the atom: a ring of light and a streak heading outward. */
  photon(hex: string, visible: boolean): Promise<void> {
    this.flash(hex, visible ? 1 : 0.5);
    const col = new THREE.Color(hex).multiplyScalar(visible ? 2.5 : 1.2);
    const dir = new THREE.Vector3().randomDirection();
    const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(line);
    return new Promise((resolve) => {
      this.tween(this.reducedMotion ? 250 : 520, (p) => {
        const head = dir.clone().multiplyScalar(this.extent * (0.2 + 5 * p));
        const tail = dir.clone().multiplyScalar(this.extent * (0.2 + 5 * Math.max(0, p - 0.18)));
        geom.setFromPoints([tail, head]);
        (line.material as THREE.LineBasicMaterial).opacity = 1 - p;
      }, () => {
        this.scene.remove(line);
        geom.dispose();
        resolve();
      });
    });
  }

  private flash(hex: string, strength: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.6 * strength), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.quaternion.copy(this.camera.quaternion);
    this.scene.add(ring);
    this.tween(this.reducedMotion ? 200 : 600, (p) => {
      ring.scale.setScalar(this.extent * (0.3 + 1.6 * easeOut(p)));
      (ring.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    }, () => this.scene.remove(ring));
  }

  celebrate(): void {
    this.flash('#ffffff', 1.2);
    this.tween(900, (p) => {
      this.bloom.strength = 0.65 + 0.9 * Math.sin(Math.PI * p);
    });
  }

  private tween(dur: number, update: (p: number) => void, done?: () => void): void {
    this.tweens.push({ start: performance.now(), dur, update, done });
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w / 2, h / 2);
    this.camera.aspect = w / h;
    // Keep the atom fully visible in portrait.
    this.camera.fov = w < h ? 58 : 42;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();
    const now = performance.now();

    this.tweens = this.tweens.filter((tw) => {
      const p = Math.min(1, (now - tw.start) / tw.dur);
      tw.update(p);
      if (p >= 1) {
        tw.done?.();
        return false;
      }
      return true;
    });

    const k = 1 - Math.exp(-dt * 4);
    this.extent += (this.extentTarget - this.extent) * k;
    // Fit the cloud to the narrower screen dimension, with a margin.
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const wantDist = (this.extent * 1.2) / Math.min(tanV, tanV * this.camera.aspect);
    this.dist += (wantDist - this.dist) * k;
    this.camera.position.setLength(this.dist);

    const dpr = this.renderer.getPixelRatio();
    for (const c of this.clouds.values()) {
      c.fill += (c.fillTarget - c.fill) * k;
      c.ghost += (c.ghostTarget - c.ghost) * k;
      c.scale += (c.scaleTarget - c.scale) * k;
      c.focus += (c.focusTarget - c.focus) * k;
      if (Math.abs(c.morphTarget - c.morph) > 1e-3 && c.morphTarget === 0) c.morph = 0;
      const u = c.mat.uniforms;
      u.uTime.value = t;
      u.uScale.value = c.scale;
      // Small inner clouds pack their points densely on screen; dim them so they glow rather than clip.
      const rel = (c.samples.radius90 * c.scale) / this.extent;
      u.uIntensity.value = c.focus * (c.id === '1s' ? 0.3 : 0.24) * Math.min(1, Math.max(0.12, Math.pow(rel, 1.3)));
      u.uFill.value = c.fill;
      u.uGhost.value = c.ghost;
      u.uMorph.value = c.morph;
      u.uShimmer.value = this.reducedMotion ? 0.2 : 1;
      u.uSize.value = 2.8 * dpr;
      u.uRefDist.value = this.dist;
      (u.uColorPos.value as THREE.Color).copy(this.colourPos);
      (u.uColorNeg.value as THREE.Color).copy(this.colourNeg);
    }

    // The nucleus is drawn about 10,000 times larger than life so it can be seen.
    const ns = this.extent * 0.03;
    this.nucleusGroup.scale.setScalar(ns);
    const jiggle = this.reducedMotion ? 0.02 : this.unstable ? 0.18 : 0.06;
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.nucleus.count; i++) {
      const b = this.nucleonBase[i];
      const o = jiggle * Math.sin(t * (3 + i * 0.7) + i);
      m.makeTranslation(b.x + o, b.y + o * 0.7, b.z - o * 0.5);
      m.scale(new THREE.Vector3(0.62, 0.62, 0.62));
      this.nucleus.setMatrixAt(i, m);
    }
    this.nucleus.instanceMatrix.needsUpdate = true;

    const idle = now - this.lastInteraction > 4000;
    this.controls.autoRotate = idle && !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.update();
    this.composer.render();
  }
}

function packNucleons(count: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    pts.push(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(count > 1 ? 1.2 : 0));
  }
  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const d = pts[i].clone().sub(pts[j]);
        const len = d.length() || 1e-3;
        if (len < 1.05) {
          d.multiplyScalar((1.05 - len) / len / 2);
          pts[i].add(d);
          pts[j].sub(d);
        }
      }
      pts[i].multiplyScalar(0.97);
    }
  }
  return pts;
}

const easeIn = (p: number) => p * p;
const easeOut = (p: number) => 1 - (1 - p) * (1 - p);
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
