// The vitrine: every element as a small live atom, arranged by the chosen
// layout, with pan, pinch zoom and (for the helix) rotation. Tapping an atom
// hands its element to the owner, which opens the loupe.

import * as THREE from 'three';
import { AtomView } from './atom';
import { BLOCK_COLOUR, ELEMENTS, elementAt, type Element } from './data';
import { layout, type LayoutId, type Placed, type Tone } from './layouts';
import { token } from './tokens';

const TONE: Record<Tone, { color: string; opacity: number }> = {
  rule: { color: token('--c-text-2', '#8a9296'), opacity: 0.7 },
  faint: { color: token('--c-text-2', '#8a9296'), opacity: 0.32 },
  s: { color: BLOCK_COLOUR.s, opacity: 0.85 },
  p: { color: BLOCK_COLOUR.p, opacity: 0.85 },
  d: { color: BLOCK_COLOUR.d, opacity: 0.85 },
  f: { color: BLOCK_COLOUR.f, opacity: 0.85 },
};

interface Node {
  e: Element;
  view: AtomView;
  from: THREE.Vector3;
  to: THREE.Vector3;
  label: HTMLSpanElement;
  phase: number;
}

/** Atoms keep their true relative sizes but are shrunk so even francium leaves a clear gap to its neighbours. */
const ATOM_SCALE = 0.23;

interface Pointer { id: number; x: number; y: number }

export class Gallery {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  private root = new THREE.Group();
  private nodes: Node[] = [];
  private markers: HTMLSpanElement[] = [];
  private guides = new THREE.Group();
  private guideMaterials: THREE.LineBasicMaterial[] = [];
  private layoutId: LayoutId = 'spiral';
  private transition = 1;
  private spin = 0;
  private spinTarget = 0;
  private pan = new THREE.Vector2();
  private zoom = 1;
  private fitDistance = 20;
  private pointers = new Map<number, Pointer>();
  private pinchStart: { dist: number; zoom: number } | null = null;
  private dragStart: { x: number; y: number; pan: THREE.Vector2; spin: number; moved: boolean } | null = null;
  private width = 1;
  private height = 1;
  private selected: number | null = null;
  private ring: THREE.Line;
  private last = performance.now();
  private raf = 0;
  private collected = new Set<number>();
  private reducedMotion = false;
  private running = false;
  onPick: ((e: Element) => void) | null = null;
  onHover: ((e: Element | null) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private labels: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.add(this.root);
    this.root.add(this.guides);
    for (const e of ELEMENTS) {
      const view = new AtomView({ perSlot: 6, shapes: false, pointSize: 1 });
      view.setElement(e, false);
      this.root.add(view.group);
      const label = document.createElement('span');
      label.textContent = e.symbol;
      labels.appendChild(label);
      this.nodes.push({ e, view, from: new THREE.Vector3(), to: new THREE.Vector3(), label, phase: e.z * 0.37 });
    }
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) pts.push(new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2), Math.sin((i / 96) * Math.PI * 2), 0));
    this.ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: token('--c-target', '#e0503a'), transparent: true, opacity: 0.9 }));
    this.ring.visible = false;
    this.root.add(this.ring);
    this.setLayout('spiral', false);
    this.bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setReducedMotion(on: boolean): void { this.reducedMotion = on; }

  setCollected(zs: Iterable<number>): void {
    this.collected = new Set(zs);
    for (const n of this.nodes) {
      const got = this.collected.has(n.e.z);
      n.view.setDim(got ? 1 : 0.5);
      n.label.classList.toggle('locked', !got);
    }
  }

  setLayout(id: LayoutId, animate = true): void {
    this.layoutId = id;
    const l = layout(id);
    const byZ = new Map<number, Placed>(l.atoms.map((a) => [a.z, a]));
    for (const n of this.nodes) {
      n.from.copy(n.view.group.position);
      const p = byZ.get(n.e.z)!;
      n.to.set(p.x, p.y, p.zz);
    }
    this.transition = animate && !this.reducedMotion ? 0 : 1;
    if (this.transition >= 1) for (const n of this.nodes) n.view.group.position.copy(n.to);
    this.spinTarget = 0;
    this.pan.set(0, 0);
    this.zoom = 1;
    for (const m of this.markers) m.remove();
    this.markers = l.markers.map((m) => {
      const s = document.createElement('span');
      s.className = `marker ${m.kind}`;
      if (m.tone && m.kind === 'block') s.style.color = TONE[m.tone].color;
      s.textContent = m.text;
      s.dataset.x = String(m.x); s.dataset.y = String(m.y); s.dataset.z = String(m.zz);
      this.labels.appendChild(s);
      return s;
    });
    this.buildGuides(id);
    this.fit();
  }

  /** Thin lines that explain the arrangement: rails in the orbital colours, edges, seams. */
  private buildGuides(id: LayoutId): void {
    for (const c of [...this.guides.children]) {
      this.guides.remove(c);
      (c as THREE.Line).geometry.dispose();
    }
    for (const m of this.guideMaterials) m.dispose();
    this.guideMaterials = [];
    const mats = new Map<string, THREE.LineBasicMaterial>();
    for (const g of layout(id).guides) {
      const key = `${g.tone}${g.dashed ? '-' : ''}`;
      let mat = mats.get(key);
      if (!mat) {
        const t = TONE[g.tone];
        mat = g.dashed
          ? new THREE.LineDashedMaterial({ color: t.color, transparent: true, opacity: t.opacity, dashSize: 0.18, gapSize: 0.14, depthWrite: false })
          : new THREE.LineBasicMaterial({ color: t.color, transparent: true, opacity: t.opacity, depthWrite: false });
        mat.userData.base = t.opacity;
        mats.set(key, mat);
        this.guideMaterials.push(mat);
      }
      const geo = new THREE.BufferGeometry().setFromPoints(g.pts.map(([x, y]) => new THREE.Vector3(x, y, -0.05)));
      const line = new THREE.Line(geo, mat);
      if (g.dashed) line.computeLineDistances();
      line.renderOrder = -1;
      this.guides.add(line);
    }
  }

  select(z: number | null): void {
    this.selected = z;
  }

  /** Pan and zoom so the given atom is centred (used when returning from the loupe). */
  focus(z: number): void {
    const n = this.nodes[z - 1];
    this.pan.set(n.to.x, n.to.y);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.fit();
  }

  /** Camera distance that shows the whole layout. */
  private fit(): void {
    const box = new THREE.Box3();
    for (const n of this.nodes) box.expandByPoint(n.to);
    for (const m of this.markers) box.expandByPoint(new THREE.Vector3(Number(m.dataset.x), Number(m.dataset.y), Number(m.dataset.z)));
    const w = box.max.x - box.min.x + 2.6;
    const h = box.max.y - box.min.y + 1.8;
    const vfov = (this.camera.fov * Math.PI) / 180;
    // Keep the layout clear of the title above and the layout switch below.
    const top = Math.min(130, this.height * 0.16), bottom = Math.min(96, this.height * 0.12);
    const share = Math.max(0.5, (this.height - top - bottom) / this.height);
    this.fitDistance = Math.max(h / 2 / Math.tan(vfov / 2) / share, w / 2 / Math.tan(vfov / 2) / this.camera.aspect, 4);
    // Shift the camera so the layout's centre lands in the middle of the clear band.
    const unitsPerPx = (2 * this.fitDistance * Math.tan(vfov / 2)) / this.height;
    this.centre = new THREE.Vector2((box.max.x + box.min.x) / 2, (box.max.y + box.min.y) / 2 + ((top - bottom) / 2) * unitsPerPx);
  }
  private centre = new THREE.Vector2();

  private bind(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      this.pointers.set(ev.pointerId, { id: ev.pointerId, x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 1) {
        this.dragStart = { x: ev.clientX, y: ev.clientY, pan: this.pan.clone(), spin: this.spinTarget, moved: false };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
        this.dragStart = null;
      }
    });
    c.addEventListener('pointermove', (ev) => {
      const p = this.pointers.get(ev.pointerId);
      if (p) { p.x = ev.clientX; p.y = ev.clientY; }
      if (this.pointers.size === 2 && this.pinchStart) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = clamp(this.pinchStart.zoom * (d / this.pinchStart.dist), 0.6, 6);
      } else if (this.dragStart && p) {
        const dx = ev.clientX - this.dragStart.x, dy = ev.clientY - this.dragStart.y;
        if (Math.hypot(dx, dy) > 6) this.dragStart.moved = true;
        if (!this.dragStart.moved) return;
        const unitsPerPx = this.unitsPerPixel();
        if (layout(this.layoutId).rotates) {
          this.spinTarget = this.dragStart.spin + dx * 0.008;
          this.pan.set(0, this.dragStart.pan.y - dy * unitsPerPx);
        } else {
          this.pan.set(this.dragStart.pan.x - dx * unitsPerPx, this.dragStart.pan.y + dy * unitsPerPx);
        }
      } else if (this.pointers.size === 0) {
        const hit = this.pick(ev.clientX, ev.clientY);
        c.style.cursor = hit ? 'pointer' : '';
        this.onHover?.(hit ? hit.e : null);
      }
    });
    const up = (ev: PointerEvent) => {
      const wasTap = this.dragStart && !this.dragStart.moved && this.pointers.size === 1;
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinchStart = null;
      if (wasTap) {
        const hit = this.pick(ev.clientX, ev.clientY);
        if (hit) this.onPick?.(hit.e);
      }
      if (this.pointers.size === 0) this.dragStart = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => this.onHover?.(null));
    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoom = clamp(this.zoom * Math.exp(-ev.deltaY * 0.0015), 0.6, 6);
    }, { passive: false });
  }

  private unitsPerPixel(): number {
    const dist = this.fitDistance / this.zoom;
    const vh = 2 * dist * Math.tan((this.camera.fov * Math.PI) / 360);
    return vh / this.height;
  }

  private v3 = new THREE.Vector3();
  private project(p: THREE.Vector3): [number, number, number] {
    this.v3.copy(p).applyMatrix4(this.root.matrixWorld).project(this.camera);
    return [((this.v3.x + 1) / 2) * this.width, ((1 - this.v3.y) / 2) * this.height, this.v3.z];
  }

  private pick(clientX: number, clientY: number): Node | null {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    let best: Node | null = null;
    let bd = Infinity;
    for (const n of this.nodes) {
      const [px, py] = this.project(n.view.group.position);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    const limit = Math.max(18, 0.5 / this.unitsPerPixel());
    return bd < limit * limit ? best : null;
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + dt * 1.2);
      const k = this.transition < 0.5 ? 4 * this.transition ** 3 : 1 - (-2 * this.transition + 2) ** 3 / 2;
      for (const n of this.nodes) n.view.group.position.lerpVectors(n.from, n.to, k);
      for (const m of this.guideMaterials) m.opacity = m.userData.base * k;
      for (const m of this.markers) m.style.visibility = k > 0.6 ? 'visible' : 'hidden';
    }
    this.spin += (this.spinTarget - this.spin) * Math.min(1, dt * 8);
    this.root.rotation.y = this.spin;
    this.root.updateMatrixWorld();
    const dist = this.fitDistance / this.zoom;
    this.camera.position.set(this.centre.x + this.pan.x, this.centre.y + this.pan.y, dist);
    this.camera.lookAt(this.centre.x + this.pan.x, this.centre.y + this.pan.y, 0);
    const px = this.height * this.renderer.getPixelRatio();
    // Fine, crisp dots so each atom keeps a readable edge instead of melting into its neighbours.
    const size = px * 0.075;
    for (const n of this.nodes) {
      if (!this.reducedMotion) {
        n.view.group.rotation.y += dt * 0.3;
        n.view.group.rotation.x = 0.35 * Math.sin(now / 4000 + n.phase);
      }
      n.view.update(dt);
      n.view.setPointSize(size);
      n.view.group.scale.setScalar(ATOM_SCALE);
    }
    if (this.selected) {
      const n = this.nodes[this.selected - 1];
      this.ring.visible = true;
      this.ring.position.copy(n.view.group.position);
      this.ring.scale.setScalar((n.e.vdw / 100) * ATOM_SCALE * 1.3);
      this.ring.lookAt(this.camera.position);
    } else this.ring.visible = false;
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private tmp = new THREE.Vector3();
  private placeLabels(): void {
    const offset = 0.52;
    // Labels that would collide with one already placed are hidden until the player zooms in.
    // The selected element goes first so its label always shows.
    const placed: [number, number][] = [];
    const clear = (x: number, y: number) => placed.every(([px, py]) => Math.abs(px - x) > 17 || Math.abs(py - y) > 11);
    const order = this.selected ? [this.nodes[this.selected - 1], ...this.nodes.filter((n) => n.e.z !== this.selected)] : this.nodes;
    for (const m of this.markers) {
      this.tmp.set(Number(m.dataset.x), Number(m.dataset.y), Number(m.dataset.z));
      const [x, y] = this.project(this.tmp);
      placed.push([x, y - 6]);
    }
    for (const n of order) {
      this.tmp.copy(n.view.group.position);
      this.tmp.y -= offset;
      const [x, y, depth] = this.project(this.tmp);
      const onScreen = depth < 1 && x > -40 && x < this.width + 40 && y > -20 && y < this.height + 20;
      const visible = onScreen && (n.e.z === this.selected || clear(x, y));
      if (visible) placed.push([x, y]);
      n.label.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translateX(-50%)`;
      n.label.style.opacity = visible ? '1' : '0';
      n.label.classList.toggle('sel', n.e.z === this.selected);
    }
    for (const m of this.markers) {
      this.tmp.set(Number(m.dataset.x), Number(m.dataset.y), Number(m.dataset.z));
      const [x, y] = this.project(this.tmp);
      m.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
    }
  }

  elementAt(z: number): Element { return elementAt(z); }
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
