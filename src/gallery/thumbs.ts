// Pictures of atoms for Collect: one hidden WebGL canvas renders each atom once, as the 3D view
// draws it (cloud over a soft nebula), at the same fixed scale for every element, so hydrogen is
// small and cesium large. Requests run one at a time and each result is kept, keyed by its tone.
// The row in focus draws its atom alive instead (gem.ts).
//
// The tone says how far the atom is collected, in the atom's own palette (the one its Build page
// draws it in) rather than one flat tint: gray until it is built, muted colors once its nucleus
// and electrons are, full colors once its stable isotopes are too, and full colors lifted
// brighter once its fleeting ones are.

import * as THREE from 'three';
import { AtomView } from './atom';
import { elementAt } from './data';
import { subshellColors } from '../render/fingerprint';
import { atomBuilt, fleetingCount, segmentsOf } from '../core/progress';
import type { SaveData } from '../core/save';

export type Tone = 'unbuilt' | 'built' | 'stable' | 'complete';

/** How far atom `z` is collected, as a tone. */
export function toneOf(z: number, save: SaveData): Tone {
  if (!atomBuilt(z, save)) return 'unbuilt';
  if (!segmentsOf(z, save).every((s) => s.done)) return 'built';
  const f = fleetingCount(z, save);
  return f.built < f.total ? 'stable' : 'complete';
}

/** Brightness and color by tone: unbuilt stays a fainter gray, built takes its colors muted,
 *  stable in full, complete in full and brighter. */
const TONE_DIM: Record<Tone, number> = { unbuilt: 1.1, built: 2.2, stable: 2.6, complete: 3.4 };
const TONE_COLOR: Record<Tone, number> = { unbuilt: 1, built: 0.4, stable: 1, complete: 1 };

function applyTone(view: AtomView, tone: Tone): void {
  view.setLit(tone === 'unbuilt' ? { nucleus: false, electrons: 0 } : { nucleus: true, electrons: Infinity });
  view.setColorCap(TONE_COLOR[tone]);
  view.setDim(TONE_DIM[tone]);
}

const SIZE = 160;
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

const makeView = (dist: number) => new AtomView({ perSlot: 220, shapes: false, pointSize: SIZE * 0.126 * (dist / 14), haze: true });

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
  // Drawn on opaque black, the page's own background: the cloud adds light far faster than it
  // adds alpha, so a transparent picture would lose most of its glow when saved.
  renderer.setClearColor(0x000000, 1);
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
      const e = elementAt(z);
      view.setElement(e, false);
      view.setPalette(subshellColors(e));
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
