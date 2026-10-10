// The loupe: one atom, large, at a fixed scale with its reference circles, so
// stepping from element to element compares them fairly. Drag to turn it in
// 3D; the arrows step to the neighbouring element and the same atom stays in
// place while its layers morph. Three looks: the probability cloud, the
// idealised orbital surfaces, or both. The cloud is live: electrons blink in
// and out at new places, as a probability cloud is meant to be read.

import * as THREE from 'three';
import { AtomView, type Style } from './atom';
import { CLOUD_RINGS, type Element } from './data';

export class Detail {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private spin = new THREE.Group();
  private rings = new THREE.Group();
  view: AtomView;
  private width = 1;
  private height = 1;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private raf = 0;
  private last = performance.now();
  private running = false;
  private reducedMotion = false;
  private autoSpin = true;
  private style: Style = 'cloud';
  onTap: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff3e4, 1.1);
    key.position.set(3, 4, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    rim.position.set(-4, -2, -5);
    this.scene.add(rim);
    this.view = new AtomView({ perSlot: 300, shapes: true, pointSize: 1, live: true });
    this.spin.add(this.view.group);
    this.spin.rotation.x = 0.3;
    this.scene.add(this.spin);
    for (const r of CLOUD_RINGS) this.rings.add(ring(r.pm / 100, r.style));
    this.scene.add(this.rings);
    this.bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.view.setLive(!on);
  }

  /** Show or hide the reference circles drawn round the atom. */
  setRings(on: boolean): void { this.rings.visible = on; }

  setStyle(style: Style): void {
    this.style = style;
    this.view.setStyle(style);
  }

  show(e: Element, animate: boolean): void {
    this.view.setElement(e, animate && !this.reducedMotion);
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
    // Small, crisp electrons: a pixel or two on a phone, whatever the element.
    this.view.setPointSize(this.height * this.renderer.getPixelRatio() * 0.075 * (dist / 14));
  }

  private bind(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      this.drag = { x: ev.clientX, y: ev.clientY, moved: false };
    });
    c.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      const dx = ev.clientX - this.drag.x, dy = ev.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 5) this.drag.moved = true;
      if (!this.drag.moved) return;
      this.spin.rotation.y += (ev.movementX || 0) * 0.008;
      this.spin.rotation.x = clamp(this.spin.rotation.x + (ev.movementY || 0) * 0.008, -1.2, 1.2);
    });
    const up = () => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (!d.moved) this.onTap?.();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.autoSpin && !this.drag && !this.reducedMotion) this.spin.rotation.y += dt * 0.2;
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
