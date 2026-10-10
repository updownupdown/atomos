// The loupe: one atom, large, at a fixed scale with its reference circles, so
// stepping from element to element compares them fairly. Drag to turn it in
// 3D, pinch to zoom (it drifts back to the shared scale after a pause); the arrows step to the neighbouring element and the same atom stays in
// place while its layers morph. Three looks: the probability cloud (bright sparks over a soft
// nebula of the same orbitals, round a warm glowing nucleus), the
// idealised orbital surfaces, or both. The cloud is live: electrons blink in
// and out at new places, as a probability cloud is meant to be read.

import * as THREE from 'three';
import { AtomView, type Style } from './atom';
import { CLOUD_RINGS, type Block, type Element } from './data';
import { token } from './tokens';

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
  /** Fingers down on the canvas, for pinching. */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  /** Pinch or wheel zoom (1 = the fixed scale every element shares); drifts home after a pause. */
  private zoom = 1;
  private zoomedAt = 0;
  private baseDist = 14;
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
    const key = new THREE.DirectionalLight(0xf4f7f8, 1.1);
    key.position.set(3, 4, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    rim.position.set(-4, -2, -5);
    this.scene.add(rim);
    this.view = new AtomView({ perSlot: 480, shapes: true, pointSize: 1, live: true, haze: true });
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

  /** Orbital kinds whose shapes are still undiscovered (see AtomView.setHiddenShapes). */
  setHiddenShapes(kinds: Iterable<Block>): void {
    this.view.setHiddenShapes(kinds);
  }

  show(e: Element, animate: boolean): void {
    this.view.setElement(e, animate && !this.reducedMotion);
  }

  /** Paint the electrons one color (a CSS color), or null for the orbital block colors. */
  setTint(color: string | null): void {
    this.view.setTint(color);
  }

  setCollected(collected: boolean): void {
    this.view.setDim(collected ? 1 : 0.7);
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
    // Fit a 370 pm radius in the shorter dimension: the largest atoms (Cs, Fr) and their glow fit.
    const half = 3.7;
    const vfov = (this.camera.fov * Math.PI) / 360;
    const dist = half / Math.tan(vfov) / Math.min(1, this.camera.aspect);
    this.baseDist = dist;
    this.camera.position.set(0, 0, dist / this.zoom);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    // Small, crisp electrons: a pixel or two on a phone, whatever the element.
    this.view.setPointSize(this.height * this.renderer.getPixelRatio() * 0.06 * (dist / 14));
  }

  private bind(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const spread = () => {
      const [a, b] = [...this.touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    c.addEventListener('pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.touches.size === 2) {
        // A second finger: pinch to zoom; the turn stops and this is no longer a tap.
        this.pinch = { dist: Math.max(1, spread()), zoom: this.zoom };
        if (this.drag) this.drag.moved = true;
        return;
      }
      this.drag = { x: ev.clientX, y: ev.clientY, moved: false };
    });
    c.addEventListener('pointermove', (ev) => {
      if (this.touches.has(ev.pointerId)) this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pinch && this.touches.size >= 2) {
        this.setZoom(this.pinch.zoom * (spread() / this.pinch.dist));
        return;
      }
      if (!this.drag) return;
      const dx = ev.clientX - this.drag.x, dy = ev.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 5) this.drag.moved = true;
      if (!this.drag.moved) return;
      this.spin.rotation.y += (ev.movementX || 0) * 0.008;
      this.spin.rotation.x = clamp(this.spin.rotation.x + (ev.movementY || 0) * 0.008, -1.2, 1.2);
    });
    const up = (ev: PointerEvent) => {
      this.touches.delete(ev.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      if (!this.drag || this.touches.size > 0) return;
      const d = this.drag;
      this.drag = null;
      if (!d.moved) this.onTap?.();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    // A mouse wheel or trackpad pinch zooms the same way.
    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.setZoom(this.zoom * Math.exp(-ev.deltaY * 0.0015));
    }, { passive: false });
  }

  private setZoom(z: number): void {
    this.zoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
    this.zoomedAt = performance.now();
    this.camera.position.z = this.baseDist / this.zoom;
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.autoSpin && !this.drag && !this.reducedMotion) this.spin.rotation.y += dt * 0.2;
    // After a couple of seconds without a pinch, ease back to the shared scale.
    if (this.zoom !== 1 && !this.pinch && now - this.zoomedAt > ZOOM_REST_MS) {
      this.zoom += (1 - this.zoom) * (1 - Math.exp(-dt * 1.6));
      if (Math.abs(this.zoom - 1) < 0.002) this.zoom = 1;
      this.camera.position.z = this.baseDist / this.zoom;
    }
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
    ? new THREE.LineBasicMaterial({ color: token('--c-text', '#e4e8ea'), transparent: true, opacity: 0.4 })
    : new THREE.LineDashedMaterial({ color: token('--c-text', '#e4e8ea'), transparent: true, opacity: 0.45, dashSize: r * 0.09, gapSize: r * 0.06 });
  const line = new THREE.Line(g, m);
  if (style === 'dashed') line.computeLineDistances();
  return line;
}

const ZOOM_MIN = 0.7;
const ZOOM_MAX = 4;
const ZOOM_REST_MS = 2200;

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
