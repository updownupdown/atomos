// The atom in focus on Collect, drawn as the collected gem: the nebula look (render/nebula.ts)
// of the same fine cloud its Build page draws (render/orbitalCloud.ts, a few hundred thousand
// points), on a small canvas of its own, turning slowly as itself. How far the atom is
// collected (thumbs.ts Tone) sets its look:
//
//   unbuilt   not built yet           the whole cloud in gray, still, no light walking
//   built     built                   its hue, the light walking its orbitals
//   stable    stable isotopes too     brighter, a fuller halo
//   complete  everything collected    brightest, the halo in full
//
// As it first appears it gathers out of the dark: its light rises and it settles in from a
// little farther off, with no sparkle.

import * as THREE from 'three';
import { elementAt } from './data';
import type { Tone } from './thumbs';
import { Nebula, type NebulaOptions } from '../render/nebula';
import { worldPerA0 } from '../render/model';
import { OrbitalCloud, orbitalSetBuilder, type OrbitalSet, type OrbitalSetBuilder } from '../render/orbitalCloud';

/** Points: the Build page's own set (so the two share it, and opening the atom from here is
 *  instant), drawn at 60% for the small canvas, with 60k more for the orbital the light rests
 *  on. The whole budget goes to this one atom. */
const GEM_POINTS = { per: 45_000, budget: 900_000 };
const GEM_DENSITY = 0.6;
const GEM_DENSE = 60_000;
/** The entrance: how long the light takes to rise, and how much farther off it starts. */
const ENTER_S = 1.4;
const ENTER_BACK = 0.14;
const TILT = 0.35;
/** Room round the framed body, so its outer lobes thin out before the canvas's edge. */
const GEM_ROOM = 1.25;

export const GEM_LOOKS: Record<Tone, NebulaOptions> = {
  unbuilt: { sat: 0, bright: 0.7, halo: 0, walk: false },
  built: { sat: 1, bright: 1, halo: 0.3, walk: true },
  stable: { sat: 1, bright: 1.15, halo: 0.4, walk: true },
  complete: { sat: 1, bright: 1.3, halo: 0.7, walk: true },
};

export class GemAtom {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(32, 1, 0.001, 100);
  private cloud: OrbitalCloud | null = null;
  private nebula = new Nebula();
  private builder: OrbitalSetBuilder | null = null;
  private set: OrbitalSet | null = null;
  private wpa0 = 1;
  private z = 0;
  private tone: Tone = 'unbuilt';
  private still = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private age = 0;
  private clock = 0;
  private w = 0;
  private h = 0;

  constructor() {
    this.canvas.className = 'gem-atom';
    this.canvas.setAttribute('aria-hidden', 'true');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
      this.renderer.autoClear = false;
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      const halfFloat = this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float');
      this.cloud = new OrbitalCloud({ halfFloat, halo: true });
      this.cloud.background = null;
      this.cloud.density = GEM_DENSITY;
    } catch { this.renderer = null; /* no WebGL: the flat picture stays */ }
  }

  get ok(): boolean { return this.renderer !== null; }

  /** Show atom `z` in a tone; `still` (reduced motion) neither turns nor twinkles. */
  show(z: number, tone: Tone, still: boolean): void {
    if (z !== this.z) {
      const e = elementAt(z);
      this.wpa0 = worldPerA0(e);
      this.builder = orbitalSetBuilder(e, GEM_POINTS.per, GEM_POINTS.budget);
      this.set = null;
      this.age = 0;
      this.canvas.classList.remove('is-shown');
    }
    this.z = z;
    this.tone = tone;
    this.still = still;
  }

  start(): void {
    if (!this.renderer || this.raf) return;
    this.last = performance.now();
    const frame = (t: number) => {
      this.raf = requestAnimationFrame(frame);
      const ms = t - this.last;
      this.last = t;
      this.draw(Math.min(0.1, ms / 1000), ms);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(dt: number, ms: number): void {
    const r = this.renderer!, cloud = this.cloud!;
    const b = this.builder;
    if (!b) return;
    // A new atom's points come in a slice per frame, so focusing never stalls the page.
    const sampling = !b.done;
    if (sampling) b.step(Math.max(5, Math.min(30, ms * 0.25)));
    if (b.set && b.set !== this.set) {
      this.set = b.set;
      cloud.setSet(b.set, this.wpa0);
      this.nebula.setSet(b.set);
    }
    if (!this.set) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      r.setSize(w, h, false);
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      cloud.resize({ width: size.x, height: size.y });
    }
    this.time += dt;
    this.age += dt;
    const still = this.still;
    // It gathers out of the dark: the light rises (eased out) as it settles in from farther off.
    const k = still ? 1 : 1 - (1 - Math.min(1, this.age / ENTER_S)) ** 3;
    const look = GEM_LOOKS[this.tone];
    // Reduced motion: the light stays where it is (a still picture in the atom's own colors).
    const o: NebulaOptions = still ? { ...look, walk: false } : { ...look, bright: look.bright * k };
    this.clock += dt;
    this.nebula.step(cloud, dt, this.time, o, GEM_DENSE);
    if (!sampling) cloud.sampleDense(5);
    // The atom's own spin: its first pose, direction and pace from its seed, the tilt nodding
    // a little over a minute. Framed on where most of its points are, with room round them.
    const nb = this.nebula;
    const angle = nb.theta0 + (still ? 0 : this.time * nb.spinSpeed * nb.spinDir);
    const tilt = TILT + (still ? 0 : nb.nod(this.time));
    // Framed on the canvas's shorter side: a tall or wide canvas keeps the extra room.
    const R = nb.frameA0 * GEM_ROOM * this.wpa0;
    const dist = (R / Math.tan((this.camera.fov * Math.PI) / 360)) * (1 + ENTER_BACK * (1 - k)) / Math.min(1, w / h);
    this.camera.position.set(Math.sin(angle) * Math.cos(tilt) * dist, Math.sin(tilt) * dist, Math.cos(angle) * Math.cos(tilt) * dist);
    this.camera.near = dist * 0.01;
    this.camera.far = dist * 10;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 0);
    r.setRenderTarget(null);
    // Clear to nothing: the cloud's light adds over the page (black there anyway), so the
    // canvas can reach over the rows around it without hiding them.
    r.setClearColor(0x000000, 0);
    r.clear();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    cloud.renderLayer({ renderer: r, camera: this.camera, width: size.x, height: size.y }, this.clock);
    cloud.draw(r);
    this.canvas.classList.add('is-shown');
    if (still) this.stop();
  }

  /** For checks: what it shows, and whether its points are in. */
  get state(): { z: number; tone: Tone; ready: boolean } { return { z: this.z, tone: this.tone, ready: this.set !== null }; }
}
