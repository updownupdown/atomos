// Pictures of atoms for Collect: one hidden WebGL canvas renders each atom once, as the 3D view
// draws it (cloud over a soft nebula), at the same fixed scale for every element, so hydrogen is
// small and cesium large. Requests run one at a time and each result is kept, keyed by its tone.
//
// The tone says how far the atom is collected: gray until it is built, white once its nucleus
// and electrons are, green once its stable isotopes are too, and in full color once its fleeting
// ones are. LiveAtom draws the same picture alive, on its own small canvas, for the one row in
// focus.

import * as THREE from 'three';
import { AtomView } from './atom';
import { elementAt } from './data';
import { token } from './tokens';
import { atomBuilt, fleetingCount, segmentsOf } from '../core/progress';
import type { SaveData } from '../core/save';

export type Tone = 'gray' | 'white' | 'green' | 'color';

/** How far atom `z` is collected, as a tone. */
export function toneOf(z: number, save: SaveData): Tone {
  if (!atomBuilt(z, save)) return 'gray';
  if (!segmentsOf(z, save).every((s) => s.done)) return 'white';
  const f = fleetingCount(z, save);
  return f.built < f.total ? 'green' : 'color';
}

/** How much the live atom twinkles in each tone: only an atom collected in full. */
export const TONE_TWINKLE: Record<Tone, number> = { gray: 0, white: 0, green: 0, color: 0.4 };

/** Brightness by tone: gray stays faint; full color is lifted, its blues and purples being darker
 *  than white. */
const TONE_DIM: Record<Tone, number> = { gray: 0.4, white: 1.1, green: 1.2, color: 1.6 };

function applyTone(view: AtomView, tone: Tone): void {
  view.setLit(tone === 'gray' ? { nucleus: false, electrons: 0 } : { nucleus: true, electrons: Infinity });
  view.setTint(tone === 'white' ? '#ffffff' : tone === 'green' ? token('--c-done', '#4ff29a') : null);
  view.setDim(TONE_DIM[tone]);
}

const SIZE = 168;
/** Scene units (100 pm) from the center to the edge of a picture, the same for every atom:
 *  300 pm, so the largest (cesium, francium) just touch the edge. */
const HALF = 3.0;
const TILT = 0.3;

function makeCamera(): { camera: THREE.PerspectiveCamera; dist: number } {
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const dist = HALF / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);
  return { camera, dist };
}

const makeView = (dist: number) => new AtomView({ perSlot: 160, shapes: false, pointSize: SIZE * 0.1 * (dist / 14), haze: true });

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let view: AtomView;
const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

function setup(): boolean {
  if (renderer) return true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return false;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  const cam = makeCamera();
  camera = cam.camera;
  view = makeView(cam.dist);
  view.setLive(false);
  view.group.rotation.x = TILT;
  scene.add(view.group);
  return true;
}

/** A picture of atom `z` in a tone, as a data URL, or null when WebGL is not available. */
export function atomPicture(z: number, tone: Tone): Promise<string | null> {
  const key = `${z}/${tone}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(() => new Promise<string | null>((done) => {
    // One picture per frame, so scrolling stays smooth while they come in.
    requestAnimationFrame(() => {
      if (!setup()) { done(null); return; }
      view.setElement(elementAt(z), false);
      applyTone(view, tone);
      renderer!.render(scene, camera);
      const url = renderer!.domElement.toDataURL('image/png');
      cache.set(key, url);
      done(url);
    });
  }));
  queue = job.catch(() => null);
  return job;
}

/** One atom drawn alive on its own small canvas: turning slowly, twinkling as its tone says.
 *  Move `canvas` where it should show; it draws only between start() and stop(). */
export class LiveAtom {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private view: AtomView;
  private raf = 0;
  private last = 0;
  private still = false;
  private z = 0;
  private tone: Tone = 'gray';

  constructor() {
    this.canvas.className = 'live-atom';
    this.canvas.setAttribute('aria-hidden', 'true');
    const cam = makeCamera();
    this.camera = cam.camera;
    this.view = makeView(cam.dist);
    this.view.group.rotation.x = TILT;
    this.scene.add(this.view.group);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setClearColor(0x000000, 0);
    } catch { /* no WebGL: the flat picture stays */ }
  }

  get ok(): boolean { return this.renderer !== null; }

  /** Show atom `z` in a tone; `still` (reduced motion) draws one frame and holds it. */
  show(z: number, tone: Tone, still: boolean): void {
    if (z !== this.z) { this.view.setElement(elementAt(z), false); this.view.group.rotation.y = 0; }
    this.z = z;
    this.tone = tone;
    this.still = still;
    applyTone(this.view, tone);
    this.view.setTwinkle(still ? 0 : TONE_TWINKLE[tone]);
  }

  start(): void {
    if (!this.renderer || this.raf) return;
    this.last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.draw(dt);
      this.raf = this.still ? 0 : requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(dt: number): void {
    const r = this.renderer!;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);
    this.view.group.rotation.y += dt * 0.35;
    this.view.update(dt);
    r.render(this.scene, this.camera);
  }

  /** For checks: what it shows. */
  get state(): { z: number; tone: Tone } { return { z: this.z, tone: this.tone }; }
}
