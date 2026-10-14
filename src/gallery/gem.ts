// The atom in focus on Collect, drawn as the collected gem: the same fine cloud in the atom's own
// palette that its Build page draws (render/orbitalCloud.ts, a few hundred thousand points), on
// a small canvas of its own, turning slowly. How far the atom is collected (thumbs.ts Tone) sets its look:
//
//   unbuilt   not built yet           the whole cloud in gray, still
//   built     built                   its orbitals' colors, muted
//   stable    stable isotopes too     its orbitals' colors in full, a gentle twinkle
//   complete  everything collected    in full, the light walking its orbitals in turn
//
// As it first appears it gathers out of the dark: its light rises and it settles in from a
// little farther off, with no sparkle.

import * as THREE from 'three';
import { elementAt } from './data';
import type { Tone } from './thumbs';
import { atomFingerprint } from '../render/fingerprint';
import { worldPerA0 } from '../render/model';
import { OrbitalCloud, orbitalSetBuilder, type OrbitalSet, type OrbitalSetBuilder } from '../render/orbitalCloud';
import { Spotlight, type SpotlightOptions } from '../render/spotlight';

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
const SPIN = 0.22;
/** The canvas reaches this many times the radius holding 90% of the points. */
const GEM_FRAME = 1.55;

const ALL: SpotlightOptions = { spot: 'all', rest: 'ghost', palette: 'print', tempo: 0.5, camera: 'still', twinkle: 0.2, brightness: 1, pulse: 0 };
export const GEM_LOOKS: Record<Tone, SpotlightOptions> = {
  unbuilt: { ...ALL, twinkle: 0, brightness: 0.8, saturation: 0 },
  built: { ...ALL, twinkle: 0.12, saturation: 0.4 },
  stable: { ...ALL, twinkle: 0.3, brightness: 1.15 },
  complete: { spot: 'scan', rest: 'tint', palette: 'print', tempo: 0.5, camera: 'still', twinkle: 0.35, brightness: 1.3, pulse: 0.6, restShare: 0.75, scanDir: 'in' },
};

export class GemAtom {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(32, 1, 0.001, 100);
  private cloud: OrbitalCloud | null = null;
  private spotlight = new Spotlight();
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
  private angle = 0;
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
      this.cloud = new OrbitalCloud({ halfFloat });
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
      this.spotlight.setSet(b.set, atomFingerprint(b.set.element, b.set));
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
    const o: SpotlightOptions = still ? { ...look, twinkle: 0, tempo: 0.25 } : { ...look, brightness: look.brightness * k };
    this.clock += dt;
    if (!still) this.angle += dt * SPIN;
    this.spotlight.step(cloud, dt, this.time, o, this.camera.position);
    cloud.wantDense(this.spotlight.denseWants, GEM_DENSE / Math.sqrt(this.spotlight.denseSplit));
    if (!sampling) cloud.sampleDense(5);
    // Frame the whole atom with room round it, so its outermost points thin out before the edge.
    const R = this.set.r90 * GEM_FRAME * this.wpa0;
    const dist = (R / Math.tan((this.camera.fov * Math.PI) / 360)) * (1 + ENTER_BACK * (1 - k));
    this.camera.position.set(Math.sin(this.angle) * Math.cos(TILT) * dist, Math.sin(TILT) * dist, Math.cos(this.angle) * Math.cos(TILT) * dist);
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
