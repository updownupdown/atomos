// The app's own atom, for reference: src/gallery/atom.ts's AtomView exactly as the loupe sets
// it up (live sparks over a soft haze, warm nucleus), in its three looks.

import * as THREE from 'three';
import { AtomView, type Style } from '../../gallery/atom';
import type { AtomModel } from '../../render/model';
import type { Experiment, LabContext, Settings } from '../types';
import { LAB_BG } from '../../render/volume';

export class CurrentLook implements Experiment {
  id: string;
  name: string;
  description: string;
  uses = { brightness: true };
  private ctx!: LabContext;
  private scene = new THREE.Scene();
  private view: AtomView | null = null;

  constructor(private style: Style, label: string) {
    this.id = `current-${style}`;
    this.name = `Current app: ${label}`;
    this.description = {
      cloud: 'The loupe today: sampled electron sparks that blink and drift over a faint haze (src/gallery/atom.ts).',
      shapes: 'The loupe today: idealised orbital boundary surfaces, one mesh per orbital.',
      hybrid: 'The loupe today: the spark cloud with faint orbital surfaces over it.',
    }[style];
  }

  wantsSign(): boolean { return false; }

  frame(model: AtomModel): number {
    return (model.element.vdw / 100) * 1.1;
  }

  init(ctx: LabContext): void {
    this.ctx = ctx;
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xf4f7f8, 1.1);
    key.position.set(3, 4, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    rim.position.set(-4, -2, -5);
    this.scene.add(rim);
    // As the loupe (src/gallery/detail.ts).
    this.view = new AtomView({ perSlot: 480, shapes: true, pointSize: 1, live: true, haze: true });
    this.view.setStyle(this.style);
    this.scene.add(this.view.group);
  }

  setAtom(model: AtomModel): void {
    if (this.view?.element?.z !== model.element.z) this.view?.setElement(model.element, this.view.element != null);
  }

  setSettings(s: Settings): void {
    this.view?.setDim(Math.min(2, s.brightness));
  }

  resize(ctx: LabContext): void { this.ctx = ctx; }

  render(dt: number): void {
    const { renderer, camera } = this.ctx;
    const v = this.view!;
    v.update(dt);
    // The loupe's point size: a pixel or two on a phone, scaled with distance as there.
    v.setPointSize(this.ctx.height * 0.06 * (camera.position.length() / 14));
    renderer.setRenderTarget(null);
    renderer.setClearColor(LAB_BG, 1);
    renderer.clear();
    renderer.render(this.scene, camera);
  }

  stats(): string {
    const e = this.view?.element;
    if (!e) return '';
    const pts = e.subshells.reduce((a, s) => a + s.capacity * (480 + 260), 0);
    return `${Math.round(pts / 1000)}k pts · ${this.ctx.width}×${this.ctx.height}`;
  }

  dispose(): void {
    this.view?.dispose();
    this.view = null;
  }
}
