// Together in 3D: every orbital of an atom at once, as solid lobes round the nucleus, each layer
// as far out as its electrons reach and always to true scale against the others. It turns
// slowly, a sideways drag turns it, and picking a layer zooms in until that layer fills the
// view, so even the tiny inner layers of a heavy atom can be seen without bending the sizes.
// infopage.ts drives it from the slider, the Play button and the layer chips; the SVG drawn by
// visuals.ts orbitalTogether stays underneath as the picture when WebGL is not available.
//
//   const view = Together3D.create(stage, e, reach, hidden);
//   view?.set(counts, picked);

import * as THREE from 'three';
import { BLOCK_COLOUR, type Block, type Element } from './data';
import { orbitalSurface } from './orbital';
import { orbitalFill } from './visuals';

/** How bright an orbital draws with one electron, with two, and a lone s shell over others. */
const ONE = 0.16;
const TWO = 0.3;
const GLASS = 0.07;
/** How much a layer fades when another is picked. */
const DIM = 0.12;
const TILT = 0.38;
const SPIN = 0.22;
/** The view's half width, a little past the atom's edge (radius 1). */
const HALF = 1.08;

const geometries = new Map<string, THREE.BufferGeometry>();
/** One orbital's surface, its two signs in two tones of the block color. */
function geometry(block: Block, oi: number): THREE.BufferGeometry {
  const key = `${block}${oi}`;
  let g = geometries.get(key);
  if (!g) {
    const s = orbitalSurface(block, oi, 40, 28);
    const base = new THREE.Color(BLOCK_COLOUR[block]);
    const colors = new Float32Array(s.sign.length * 3);
    for (let i = 0; i < s.sign.length; i++) {
      const c = s.sign[i] ? base : base.clone().multiplyScalar(0.5);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(s.index, 1));
    g.computeVertexNormals();
    geometries.set(key, g);
  }
  return g;
}

interface Layer {
  block: Block;
  capacity: number;
  /** Edge radius as a share of the atom's (1 = the van der Waals edge). */
  r: number;
  hidden: boolean;
  group: THREE.Group;
  materials: THREE.MeshLambertMaterial[];
}

export class Together3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, -10, 10);
  private atom = new THREE.Group();
  private layers: Layer[] = [];
  private nucleus: THREE.Mesh;
  private ring: HTMLElement;
  private lab: HTMLElement;
  private zoom = 1;
  private zoomTo = 1;
  private frame = 0;
  private last = 0;
  private drag: { x: number; y: number; ry: number; rx: number } | null = null;
  private idleSince = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private dirty = true;

  /** The view in a stage, or null when WebGL is not available (the SVG stays). */
  static create(stage: HTMLElement, e: Element, reach: number[], hidden: Set<string>): Together3D | null {
    try {
      return new Together3D(stage, e, reach, hidden);
    } catch {
      return null;
    }
  }

  private constructor(private stage: HTMLElement, private e: Element, reach: number[], hidden: Set<string>) {
    const canvas = document.createElement('canvas');
    canvas.className = 'tg-3d';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    stage.classList.add('is-3d');
    this.ring = document.createElement('i');
    this.ring.className = 'tg-ring';
    stage.prepend(canvas, this.ring);
    this.lab = stage.querySelector('.tg-edge-lab')!;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.2, 1.6, 2);
    this.scene.add(key);
    this.atom.rotation.x = TILT;
    this.scene.add(this.atom);

    e.subshells.forEach((s, i) => {
      const group = new THREE.Group();
      const isHidden = hidden.has(s.l);
      const materials: THREE.MeshLambertMaterial[] = [];
      // An orbital shape not discovered yet shows as a plain shell at its reach.
      const count = isHidden ? 1 : s.capacity / 2;
      for (let oi = 0; oi < count; oi++) {
        const m = new THREE.MeshLambertMaterial({
          vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, emissive: new THREE.Color(BLOCK_COLOUR[s.l]), emissiveIntensity: 0.25,
        });
        const mesh = new THREE.Mesh(geometry(isHidden ? 's' : s.l, oi), m);
        group.add(mesh);
        materials.push(m);
      }
      group.scale.setScalar(reach[i]);
      this.atom.add(group);
      this.layers.push({ block: s.l, capacity: s.capacity, r: reach[i], hidden: isHidden, group, materials });
    });
    // The nucleus: a point of light, the same size on screen however far it zooms.
    this.nucleus = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.scene.add(this.nucleus);

    this.bind(canvas);
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.loop(performance.now());
  }

  /** How many electrons each layer has (by subshell index), and the layer picked out, if any. */
  set(counts: number[], picked: number | null): void {
    const lobes = this.layers.some((l, i) => l.block !== 's' && counts[i] > 0);
    const pickedR = picked == null ? 0 : this.layers[picked].r;
    this.layers.forEach((l, i) => {
      const fill = l.hidden ? [counts[i] > 0 ? 1 : 0] : orbitalFill(counts[i], l.capacity);
      const alone = picked === i || !lobes;
      // Zoomed in on a layer, the layers far outside it would only wash over the view.
      const dim = picked == null || picked === i ? 1 : l.r > pickedR * 1.6 ? 0 : DIM;
      l.materials.forEach((m, oi) => {
        const f = fill[oi] ?? 0;
        // A round s shell is glass over the lobes inside it; alone or picked it is solid.
        const full = l.block === 's' || l.hidden ? (!f ? 0 : alone ? (f === 2 ? 0.3 : 0.18) : GLASS) : f === 2 ? TWO : f ? ONE : 0;
        m.opacity = full * dim * (picked === i ? 1.5 : 1);
      });
    });
    // Picking a layer zooms until it fills the view; nothing changes size against anything else.
    const r = picked == null ? 1 : this.layers[picked].r;
    this.zoomTo = Math.min(600, Math.max(1, 0.92 / r));
    this.dirty = true;
  }

  private bind(canvas: HTMLCanvasElement): void {
    // A sideways drag turns the atom; an upright one still scrolls the page.
    canvas.addEventListener('pointerdown', (ev) => {
      this.drag = { x: ev.clientX, y: ev.clientY, ry: this.atom.rotation.y, rx: this.atom.rotation.x };
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      const w = canvas.clientWidth || 1;
      this.atom.rotation.y = this.drag.ry + ((ev.clientX - this.drag.x) / w) * Math.PI * 1.5;
      this.atom.rotation.x = Math.max(-1.2, Math.min(1.2, this.drag.rx + ((ev.clientY - this.drag.y) / w) * Math.PI));
      this.dirty = true;
    });
    const end = () => { this.drag = null; this.idleSince = performance.now(); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private resize(): void {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.dirty = true;
  }

  private loop = (now: number): void => {
    if (!this.stage.isConnected) { this.dispose(); return; }
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    if (!this.reduced && !this.drag && now - this.idleSince > 1500) { this.atom.rotation.y += dt * SPIN; this.dirty = true; }
    if (Math.abs(this.zoom - this.zoomTo) > 1e-3 * this.zoomTo) {
      // Zoom on a log scale so a hundredfold zoom takes as long as a tenfold one.
      const k = this.reduced ? 1 : 1 - Math.exp(-dt * 5);
      this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(this.zoomTo) - Math.log(this.zoom)) * k);
      this.dirty = true;
    }
    if (this.dirty) this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    this.dirty = false;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    const px = this.stage.clientWidth || 1;
    // About 3 px across, whatever the zoom.
    this.nucleus.scale.setScalar(((3 / px) * 2 * HALF) / this.zoom);
    // The atom's edge as a ring, while it is on screen; zoomed in, how far.
    const edge = (this.zoom / HALF) * 100;
    this.ring.style.width = this.ring.style.height = `${edge}%`;
    this.ring.style.opacity = edge > 140 ? '0' : '';
    this.lab.textContent = this.zoom > 1.05 ? `${Math.round(this.zoom)}× closer · true scale` : `edge ${this.e.vdw} pm · true scale`;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const l of this.layers) l.materials.forEach((m) => m.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
