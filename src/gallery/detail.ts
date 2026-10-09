// The loupe: one atom, large, with its fixed scale rings. Drag to turn it,
// swipe sideways (or use the arrows) to step to the neighbouring element and
// watch the difference animate in. Three looks: the probability cloud, the
// idealised orbital surfaces, or both.

import * as THREE from 'three';
import { AtomView, type Style } from './atom';
import { CLOUD_RINGS, type Element } from './data';

export class Detail {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private spin = new THREE.Group();
  private rings = new THREE.Group();
  private ringLines: { line: THREE.Line; pm: number }[] = [];
  view: AtomView;
  private width = 1;
  private height = 1;
  private drag: { x: number; y: number; t: number; dx: number; moved: boolean } | null = null;
  private velocity = 0;
  private raf = 0;
  private last = performance.now();
  private running = false;
  private reducedMotion = false;
  private autoSpin = true;
  private style: Style = 'cloud';
  /** Extra sideways drift while a swipe is in flight, in scene units. */
  private slide = 0;
  private slideTarget = 0;
  onSwipe: ((dir: 1 | -1) => void) | null = null;
  onTap: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private ringLabels: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff3e4, 1.1);
    key.position.set(3, 4, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    rim.position.set(-4, -2, -5);
    this.scene.add(rim);
    this.view = new AtomView({ perSlot: 300, shapes: true, pointSize: 1 });
    this.spin.add(this.view.group);
    this.spin.rotation.x = 0.3;
    this.scene.add(this.spin);
    for (const r of CLOUD_RINGS) {
      const line = ring(r.pm / 100, r.style);
      this.rings.add(line);
      this.ringLines.push({ line, pm: r.pm });
    }
    this.scene.add(this.rings);
    this.bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setReducedMotion(on: boolean): void { this.reducedMotion = on; }

  setStyle(style: Style): void {
    this.style = style;
    this.view.setStyle(style);
  }

  show(e: Element, animate: boolean, dir: 1 | -1 | 0 = 0): void {
    this.view.setElement(e, animate && !this.reducedMotion);
    for (const r of this.ringLines) r.line.visible = e.vdw >= r.pm;
    this.placeRingLabels(e);
    if (dir !== 0 && !this.reducedMotion) {
      // The old atom is nudged away and the new one settles back to centre.
      this.slide = -dir * 0.9;
    }
  }

  setCollected(collected: boolean): void {
    this.view.setDim(collected ? 1 : 0.45);
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
    // Fit 3.8 units (a 380 pm sphere) in the shorter dimension.
    const half = 3.9;
    const vfov = (this.camera.fov * Math.PI) / 360;
    const dist = half / Math.tan(vfov) / Math.min(1, this.camera.aspect);
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.view.setPointSize(this.height * this.renderer.getPixelRatio() * 0.11 * (dist / 14));
    if (this.view.element) this.placeRingLabels(this.view.element);
  }

  private placeRingLabels(e: Element): void {
    this.ringLabels.innerHTML = '';
    const v = new THREE.Vector3();
    for (const r of this.ringLines) {
      if (e.vdw < r.pm) continue;
      const a = -0.6;
      v.set(Math.cos(a) * (r.pm / 100), Math.sin(a) * (r.pm / 100), 0).project(this.camera);
      const s = document.createElement('span');
      s.textContent = `${r.pm} pm`;
      s.style.left = `${((v.x + 1) / 2) * this.width + 5}px`;
      s.style.top = `${((1 - v.y) / 2) * this.height}px`;
      this.ringLabels.appendChild(s);
    }
  }

  private bind(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      this.drag = { x: ev.clientX, y: ev.clientY, t: performance.now(), dx: 0, moved: false };
      this.velocity = 0;
    });
    c.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      const dx = ev.clientX - this.drag.x, dy = ev.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 5) this.drag.moved = true;
      if (!this.drag.moved) return;
      const now = performance.now();
      this.velocity = dx - this.drag.dx;
      this.drag.dx = dx;
      this.drag.t = now;
      this.spin.rotation.y += (ev.movementX || 0) * 0.008;
      this.spin.rotation.x = clamp(this.spin.rotation.x + (ev.movementY || 0) * 0.008, -1.2, 1.2);
    });
    const up = (ev: PointerEvent) => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      if (!d.moved) { this.onTap?.(); return; }
      // A swipe: mostly sideways, far enough or fast enough.
      const quick = performance.now() - d.t < 80 && Math.abs(this.velocity) > 9;
      if (Math.abs(dx) > Math.abs(dy) * 1.4 && (Math.abs(dx) > this.width * 0.28 || quick)) {
        this.onSwipe?.(dx < 0 ? 1 : -1);
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.autoSpin && !this.drag && !this.reducedMotion) this.spin.rotation.y += dt * 0.2;
    this.slide += (this.slideTarget - this.slide) * Math.min(1, dt * 5);
    this.spin.position.x = this.slide;
    this.view.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  get currentStyle(): Style { return this.style; }
}

function ring(r: number, style: 'solid' | 'dashed'): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = style === 'solid'
    ? new THREE.LineBasicMaterial({ color: 0xdcd5c4, transparent: true, opacity: 0.45 })
    : new THREE.LineDashedMaterial({ color: 0xdcd5c4, transparent: true, opacity: 0.45, dashSize: r * 0.09, gapSize: r * 0.06 });
  const line = new THREE.Line(g, m);
  if (style === 'dashed') line.computeLineDistances();
  return line;
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
