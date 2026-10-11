// Orbit camera for the lab: drag to turn, pinch or wheel to zoom, optional slow auto-rotation.
// The camera circles the nucleus; the atom itself never moves, so every experiment (rays and
// points alike) sees the same view.

import * as THREE from 'three';

export class Orbit {
  /** Azimuth round the vertical axis and polar angle from it (radians). */
  theta = 0.7;
  phi = 1.25;
  /** >1 is closer. */
  zoom = 1;
  autoRotate = true;
  /** Off: the experiment reads the pointers itself (and turns or zooms through rotateBy and
   *  setZoom); the wheel is left alone too. */
  input = true;
  /** Share of the view's height and width the atom may use (the panel can cover the rest). */
  viewFrac = 1;
  viewFracX = 1;
  /** Radius (scene units) the view should fit. */
  private radius = 1;
  private dist = 5;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number } | null = null;
  private idleAt = 0;

  constructor(private el: HTMLElement, private camera: THREE.PerspectiveCamera) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      if (!this.input) return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinch = { d: this.spread(), zoom: this.zoom };
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 1) {
        const s = 5 / Math.max(300, Math.min(el.clientWidth, el.clientHeight));
        this.theta -= (e.clientX - p.x) * s;
        this.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.phi - (e.clientY - p.y) * s));
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinch) this.setZoom((this.pinch.zoom * this.spread()) / this.pinch.d);
      this.idleAt = performance.now();
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      if (!this.input) return;
      e.preventDefault();
      this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  setZoom(z: number): void {
    this.zoom = Math.max(0.3, Math.min(12, z));
  }

  /** Turn the view by a drag of (dx, dy) pixels, as one finger does. */
  rotateBy(dx: number, dy: number): void {
    const s = 5 / Math.max(300, Math.min(this.el.clientWidth, this.el.clientHeight));
    this.theta -= dx * s;
    this.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.phi - dy * s));
    this.idleAt = performance.now();
  }

  /** Fit a sphere of this radius (scene units) in the shorter side of the view. */
  fit(radius: number): void {
    this.radius = radius;
  }

  get dragging(): boolean {
    return this.pointers.size > 0;
  }

  update(dt: number): void {
    // Auto-rotation pauses while dragging and for a moment after.
    if (this.autoRotate && !this.dragging && performance.now() - this.idleAt > 1200) this.theta += dt * 0.25;
    const c = this.camera;
    const fit = this.fitDistance();
    // Ease the distance so changing orbitals glides instead of jumping.
    const target = fit / this.zoom;
    this.dist += (target - this.dist) * Math.min(1, dt * 8);
    const sp = Math.sin(this.phi);
    c.position.set(this.dist * sp * Math.sin(this.theta), this.dist * Math.cos(this.phi), this.dist * sp * Math.cos(this.theta));
    c.near = Math.max(0.001, this.dist * 0.01);
    c.far = this.dist * 10 + this.radius * 4;
    c.lookAt(0, 0, 0);
    c.updateProjectionMatrix();
  }

  /** Jump straight to the fitted distance (no glide). */
  snap(): void {
    this.dist = this.fitDistance() / this.zoom;
  }

  private fitDistance(): number {
    const c = this.camera;
    const vfov = (c.fov * Math.PI) / 360;
    const half = Math.min(Math.atan(Math.tan(vfov) * this.viewFrac), Math.atan(Math.tan(vfov) * c.aspect * this.viewFracX));
    return this.radius / Math.sin(half);
  }
}
