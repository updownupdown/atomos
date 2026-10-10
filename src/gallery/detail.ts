// The loupe: one atom, large, at a fixed scale with its reference circles, so
// stepping from element to element compares them fairly. Drag to turn it in
// 3D, pinch to zoom (it drifts back to the shared scale after a pause); the arrows step to the neighbouring element and the same atom stays in
// place while its layers morph. Three looks: the probability cloud (bright sparks over a soft
// nebula of the same orbitals, round a warm glowing nucleus), the
// idealised orbital surfaces, or both. The cloud is live: electrons blink in
// and out at new places, as a probability cloud is meant to be read.

import * as THREE from 'three';
import { AtomView, type AtomLit, type Style } from './atom';
import { CLOUD_RINGS, type Block, type Element } from './data';
import { token } from './tokens';
import { NUCLEUS_RINGS, NucleusView } from './nucleus';

export class Detail {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private spin = new THREE.Group();
  private rings = new THREE.Group();
  view: AtomView;
  /** The nucleus up close, drawn at the same screen size as the atom: 8 fm maps to the 300 pm ring. */
  private nucleus = new NucleusView(3 / 8);
  private nucleusRings = new THREE.Group();
  /** Scale circles a power of ten apart, shown only during a dive (no legend): each grows out of
   *  the middle and off the edge in turn, so the hundred-thousandfold zoom reads as steady steps. */
  private diveRings: { line: THREE.Line; r: number; base: number }[] = [];
  private diveRingGroup = new THREE.Group();
  private nucleusOn = false;
  /** Where the dive between atom and nucleus stands: 0 the whole atom, 1 the nucleus close-up. */
  private dive = 0;
  private diveFrom = 0;
  private diveT = 1;
  private element: Element | null = null;
  private ringsOn = true;
  private width = 1;
  private height = 1;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  /** Fingers down on the canvas, for pinching. */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  /** Pinch or wheel zoom (1 = the fixed scale every element shares); drifts home after a pause. */
  private zoom = 1;
  private zoomedAt = 0;
  /** The glide home after a zoom: from this zoom, `t` from 0 to 1. Null when not gliding. */
  private zoomBack: { from: number; t: number } | null = null;
  private baseDist = 14;
  private raf = 0;
  private last = performance.now();
  private running = false;
  private reducedMotion = false;
  private autoSpin = true;
  private style: Style = 'cloud';
  onTap: (() => void) | null = null;
  onDoubleTap: (() => void) | null = null;
  /** During a dive, the true width of the view ("74 pm across"); null when it ends. */
  onDive: ((across: string | null) => void) | null = null;
  private lastTap = { at: 0, x: 0, y: 0 };

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
    for (const r of NUCLEUS_RINGS) this.nucleusRings.add(ring((r.fm * 3) / 8, r.style));
    this.scene.add(this.nucleusRings);
    for (const d of DIVE_RING_PM) {
      const line = ring(1, d.style);
      this.diveRingGroup.add(line);
      this.diveRings.push({ line, r: d.pm / 100, base: (line.material as THREE.LineBasicMaterial).opacity });
    }
    this.diveRingGroup.visible = false;
    this.scene.add(this.diveRingGroup);
    this.spin.add(this.nucleus.group);
    this.paintMode();
    this.bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.view.setLive(!on);
  }

  /** Show or hide the reference circles drawn round the atom. */
  setRings(on: boolean): void {
    this.ringsOn = on;
    this.paintMode();
  }

  /** Swap the whole atom for its nucleus up close, or back. With `animate`, dive there at the
   *  true ratio of sizes (see paintDive); otherwise cut straight to it. */
  setNucleus(on: boolean, animate = false): void {
    this.nucleusOn = on;
    if (on && this.element) this.nucleus.show(this.element);
    if (animate && !this.reducedMotion) {
      this.diveFrom = this.dive;
      this.diveT = 0;
    } else {
      this.dive = on ? 1 : 0;
      this.diveT = 1;
      this.onDive?.(null);
    }
    this.paintDive();
  }

  /**
   * Place the atom and its nucleus for the dive. The close-up draws the nucleus 37,500 times
   * larger than it really is beside its atom (8 fm on the 300 pm circle), so the dive scales
   * everything by that same factor, evenly in powers of ten: the cloud swells past the camera
   * and fades, the view is empty for a long stretch (an atom is almost all empty space), then
   * the nucleus grows out of a point. Nothing is resized on its own, so the true proportions hold.
   */
  private paintDive(): void {
    const s = smooth(this.dive);
    const k = Math.pow(DIVE_RATIO, s);
    this.view.group.scale.setScalar(k);
    this.rings.scale.setScalar(k);
    this.nucleus.group.scale.setScalar(k / DIVE_RATIO);
    this.nucleusRings.scale.setScalar(k / DIVE_RATIO);
    // The cloud fades as the camera passes into it (by ten times closer it is gone).
    const fade = Math.max(0, 1 - Math.log10(k) / 1.1);
    this.view.setDim(fade);
    this.view.group.visible = fade > 0;
    this.nucleus.group.visible = this.dive > 0;
    // Mid-dive the fixed circles give way to the dive's own, whether or not the scale is shown.
    const diving = this.diveT < 1;
    this.rings.visible = this.ringsOn && fade > 0 && !diving;
    this.nucleusRings.visible = this.ringsOn && this.dive > 0.5 && !diving;
    this.paintDiveRings(k);
  }

  /** Place the dive's circles at magnification `k`: each fades in as it grows out of the middle
   *  and out as it nears the edge of the view, and all of them fade at the two ends of the dive. */
  private paintDiveRings(k: number): void {
    const on = this.diveT < 1 ? Math.min(1, this.diveT / 0.12, (1 - this.diveT) / 0.12) : 0;
    this.diveRingGroup.visible = on > 0;
    if (!on) return;
    const half = VIEW_PM / 200;
    for (const d of this.diveRings) {
      const r = d.r * k;
      const u = r / half;
      d.line.scale.setScalar(r);
      const a = on * step(0.04, 0.16, u) * (1 - step(0.75, 1.25, u));
      d.line.visible = a > 0.01;
      (d.line.material as THREE.LineBasicMaterial).opacity = d.base * a;
    }
  }

  private paintMode(): void {
    this.paintDive();
  }

  setStyle(style: Style): void {
    this.style = style;
    this.view.setStyle(style);
  }

  /** Orbital kinds whose shapes are still undiscovered (see AtomView.setHiddenShapes). */
  setHiddenShapes(kinds: Iterable<Block>): void {
    this.view.setHiddenShapes(kinds);
  }

  show(e: Element, animate: boolean): void {
    this.element = e;
    this.view.setElement(e, animate && !this.reducedMotion);
    if (this.nucleusOn) this.nucleus.show(e);
  }

  /** Paint the electrons one color (a CSS color), or null for the orbital block colors. */
  setTint(color: string | null): void {
    this.view.setTint(color);
  }

  /** Kept for Build until it moves to setLit: the whole atom lit, or all of it pale. */
  setCollected(collected: boolean): void {
    this.setLit({ nucleus: collected, electrons: collected ? Infinity : 0 });
  }

  /** How much of the atom is lit, the rest pale gray (see AtomView.setLit); the nucleus close-up follows. */
  setLit(lit: AtomLit, animate = false): void {
    this.view.setLit(lit, animate && !this.reducedMotion);
    this.nucleus.setVivid(lit.nucleus);
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
      this.touched();
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
      this.touched();
      this.spin.rotation.y += (ev.movementX || 0) * 0.008;
      this.spin.rotation.x = clamp(this.spin.rotation.x + (ev.movementY || 0) * 0.008, -1.2, 1.2);
    });
    const up = (ev: PointerEvent) => {
      this.touches.delete(ev.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      if (!this.drag || this.touches.size > 0) return;
      const d = this.drag;
      this.drag = null;
      if (d.moved) return;
      const now = performance.now();
      const t = this.lastTap;
      if (now - t.at < DOUBLE_TAP_MS && Math.hypot(ev.clientX - t.x, ev.clientY - t.y) < 32) {
        this.lastTap = { at: 0, x: 0, y: 0 };
        this.onDoubleTap?.();
        return;
      }
      this.lastTap = { at: now, x: ev.clientX, y: ev.clientY };
      this.onTap?.();
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
    this.touched();
    this.camera.position.z = this.baseDist / this.zoom;
  }

  /** The player is handling the atom: hold a zoom where it is, and start the wait to glide home again. */
  private touched(): void {
    this.zoomedAt = performance.now();
    this.zoomBack = null;
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.autoSpin && !this.drag && !this.reducedMotion) this.spin.rotation.y += dt * 0.2;
    // A few seconds after the last touch, glide back to the shared scale: easing in and out, and
    // even in powers of the zoom, so going home from 4x feels like coming home from 0.7x.
    if (this.zoom !== 1 && this.touches.size === 0 && now - this.zoomedAt > ZOOM_REST_MS) {
      this.zoomBack ??= { from: this.zoom, t: 0 };
      this.zoomBack.t = Math.min(1, this.zoomBack.t + dt / ZOOM_BACK_S);
      this.zoom = this.zoomBack.t >= 1 ? 1 : Math.pow(this.zoomBack.from, 1 - easeInOut(this.zoomBack.t));
      if (this.zoom === 1) this.zoomBack = null;
      this.camera.position.z = this.baseDist / this.zoom;
    }
    if (this.diveT < 1) {
      this.diveT = Math.min(1, this.diveT + dt / DIVE_S);
      const to = this.nucleusOn ? 1 : 0;
      this.dive = this.diveFrom + (to - this.diveFrom) * this.diveT;
      this.paintDive();
      this.onDive?.(this.diveT < 1 ? across(Math.pow(DIVE_RATIO, smooth(this.dive)) * this.zoom) : null);
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
/** How much larger the close-up draws the nucleus than it is beside its atom: 3/8 scene units
 *  per fm, against 1 unit per 100 pm (100,000 fm). */
const DIVE_RATIO = (3 / 8) * 1e5;
const DIVE_S = 2.6;
const DOUBLE_TAP_MS = 320;
/** The view spans about 740 pm across its shorter side at the shared scale. */
const VIEW_PM = 740;

/** The true width of the view at a magnification, in pm or fm. */
function across(k: number): string {
  const pm = VIEW_PM / k;
  const fmt = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(0) : v.toFixed(1));
  return pm >= 1 ? `${fmt(pm)} pm across` : `${fmt(pm * 1000)} fm across`;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const step = (a: number, b: number, x: number) => smooth(clamp((x - a) / (b - a), 0, 1));
/** The dive's circles, by radius: every power of ten from 1 nm down to 1 fm, solid, with a dashed
 *  one at three times each between, so about one new circle appears per half step of ten. */
const DIVE_RING_PM: { pm: number; style: 'solid' | 'dashed' }[] = [];
for (let e = 3; e >= -3; e--) {
  DIVE_RING_PM.push({ pm: 10 ** e, style: 'solid' });
  if (e > -3) DIVE_RING_PM.push({ pm: 3 * 10 ** (e - 1), style: 'dashed' });
}
const ZOOM_MAX = 4;
const ZOOM_REST_MS = 3000;
const ZOOM_BACK_S = 1.6;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
