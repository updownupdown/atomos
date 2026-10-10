// Pictures of atoms for the Collection: one hidden WebGL canvas renders each atom once, as the
// 3D view draws it (cloud over a soft nebula, pale where not built yet), at the same fixed scale
// for every element, so hydrogen is small and cesium large. Requests run one at a time and
// each result is kept, keyed by how much of the atom is lit, so a part built later redraws.

import * as THREE from 'three';
import { AtomView, type AtomLit } from './atom';
import { elementAt } from './data';

const SIZE = 168;
/** Scene units (100 pm) from the center to the edge of a picture, the same for every atom:
 *  300 pm, so the largest (cesium, francium) just touch the edge. */
const HALF = 3.0;

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
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const dist = HALF / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);
  view = new AtomView({ perSlot: 160, shapes: false, pointSize: SIZE * 0.1 * (dist / 14), haze: true });
  view.group.rotation.x = 0.3;
  scene.add(view.group);
  return true;
}

/** A picture of atom `z` as a data URL, or null when WebGL is not available. */
export function atomThumb(z: number, lit: AtomLit): Promise<string | null> {
  const key = `${z}/${lit.nucleus ? 1 : 0}/${lit.electrons}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(() => new Promise<string | null>((done) => {
    // One picture per frame, so scrolling stays smooth while they come in.
    requestAnimationFrame(() => {
      if (!setup()) { done(null); return; }
      view.setElement(elementAt(z), false);
      view.setLit(lit);
      renderer!.render(scene, camera);
      const url = renderer!.domElement.toDataURL('image/png');
      cache.set(key, url);
      done(url);
    });
  }));
  queue = job.catch(() => null);
  return job;
}
