// Orbital explorer: walk through an atom's orbitals with nothing but touch. The gestures, the
// looks and the HUD live in render/explorer.ts (the app's atom View uses them too); this is the
// lab's wrapper with its options panel. See render/explorer.ts for the gestures.

import { atomFingerprint } from '../../render/fingerprint';
import { ExplorerHud, OrbitalExplorer, type ExplorerOptions } from '../../render/explorer';
import type { AtomModel } from '../../render/model';
import { OrbitalCloud, orbitalSet, type OrbitalSet } from '../../render/orbitalCloud';
import type { Experiment, ExperimentOption, LabContext, Settings } from '../types';
import { DENSE_POINTS, ORBITAL_POINTS, TWINKLE_OPTION } from './fingerprint';

export class ExplorerView implements Experiment {
  id = 'explorer';
  name = 'Orbital explorer (touch)';
  description = 'Swipe up and down to walk the orbitals, right and left for more or less focus (solo, ghost, all). Pinch to zoom, twist to turn the colors, two fingers to turn the atom, double-tap for solo or all.';
  uses = { brightness: true, orbital: false };
  options: ExperimentOption[] = [
    TWINKLE_OPTION,
    { id: 'stops', label: 'Ladder', choices: [{ id: 'hard', label: 'Hard stops' }, { id: 'soft', label: 'Gradual' }] },
    { id: 'finger', label: 'One finger', choices: [{ id: 'nav', label: 'Navigate' }, { id: 'turn', label: 'Turn' }] },
    { id: 'palette', label: 'Colors', choices: [{ id: 'phase', label: 'Phase' }, { id: 'print', label: 'Fingerprint' }, { id: 'block', label: 'Subshell' }] },
  ];
  private ctx!: LabContext;
  private cloud!: OrbitalCloud;
  private set: OrbitalSet | null = null;
  private model: AtomModel | null = null;
  private settings: Settings | null = null;
  private ex!: OrbitalExplorer;
  private hud: HTMLElement | null = null;
  private exHud: ExplorerHud | null = null;
  private detach: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => { this.ex.key(e); };

  wantsSign(): boolean { return true; }

  frame(model: AtomModel): number {
    const set = this.set ?? this.build(model);
    return set.r90 * model.worldPerA0 * 1.12;
  }

  init(ctx: LabContext): void {
    this.ctx = ctx;
    this.cloud = new OrbitalCloud(ctx);
    const orbit = ctx.orbit;
    if (orbit) orbit.input = false;
    this.ex = new OrbitalExplorer(orbit ?? { zoom: 1, setZoom: () => {}, rotateBy: () => {} });
    if (ctx.canvas) this.detach = this.ex.attach(ctx.canvas);
    window.addEventListener('keydown', this.onKey);
    if (ctx.ui) {
      this.hud = document.createElement('div');
      this.hud.className = 'lab-ex';
      ctx.ui.append(this.hud);
      this.exHud = new ExplorerHud(this.hud, this.ex, { prefix: 'lab-ex' });
      const hint = document.createElement('p');
      hint.className = 'lab-ex-hint';
      hint.textContent = '↕ orbitals · ↔ focus · pinch zoom · twist colors · two fingers turn · double-tap solo/all';
      this.hud.append(hint);
    }
  }

  private build(model: AtomModel): OrbitalSet {
    const q = ORBITAL_POINTS[this.settings?.quality ?? 'medium'];
    return orbitalSet(model.element, q.per, q.budget);
  }

  private rebuild(): void {
    if (!this.model || !this.settings) return;
    this.ex.opts = this.chosen();
    const set = this.build(this.model);
    if (set === this.set) return;
    this.set = set;
    this.ex.setSet(set, atomFingerprint(set.element, set));
    this.cloud.setSet(set, this.model.worldPerA0);
    this.exHud?.paint();
  }

  private chosen(): ExplorerOptions {
    const opt = (id: string, fallback: string) => this.settings?.options[id] ?? fallback;
    return {
      hard: opt('stops', 'hard') === 'hard',
      finger: opt('finger', 'nav') as ExplorerOptions['finger'],
      palette: opt('palette', 'phase') as ExplorerOptions['palette'],
      twinkle: Number(opt('twinkle', '0.35')),
      brightness: this.settings?.brightness ?? 1,
    };
  }

  setAtom(model: AtomModel): void { this.model = model; this.rebuild(); }
  setSettings(s: Settings): void { this.settings = s; this.rebuild(); }
  resize(ctx: LabContext): void { this.ctx = ctx; this.cloud.resize(ctx); }

  render(dt: number, time: number): void {
    if (!this.set) return;
    const frame = this.ex.update(dt);
    this.ctx.orbit?.fit(frame * (this.model?.worldPerA0 ?? 1));
    this.ex.applyLooks(this.cloud, frame);
    this.cloud.wantDense(this.ex.denseWants, DENSE_POINTS[this.settings?.quality ?? 'medium']);
    if (this.ex.settled) this.cloud.sampleDense(6);
    this.cloud.render(this.ctx, time);
    this.exHud?.paint();
  }

  stats(): string {
    return `${Math.round(this.cloud.drawn / 1000)}k of ${Math.round((this.set?.total ?? 0) / 1000)}k pts · ${this.set?.orbitals.length ?? 0} orbitals · ${this.cloud.size}`;
  }

  dispose(): void {
    this.detach?.();
    window.removeEventListener('keydown', this.onKey);
    if (this.ctx.orbit) this.ctx.orbit.input = true;
    this.exHud?.dispose();
    this.hud?.remove();
    this.cloud.dispose();
  }
}
