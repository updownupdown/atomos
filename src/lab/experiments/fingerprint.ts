// Atom fingerprint: an artistic rendering of the whole atom that never turns into a blur.
// Every orbital is its own dense, twinkling cloud (render/orbitalCloud.ts), but only one (or
// one subshell, a "chord") is lit at a time: the rest stay as a gray ghost, a faint tint or
// dark (render/spotlight.ts). A seeded fingerprint (render/fingerprint.ts) gives each atom its
// own palette, tempo, accent rhythm, spotlight order and tap response, so the
// collection reads like a set of jewels: alike in kind, each one its own.
//
// Spotlight modes: Rhythm walks the orbitals to the atom's beat; Scan glides through them by
// size and back, resting on each; By angle lights whichever
// orbital shows its shape best from where you look (turn it in your hands, like a gem); All lit
// shows everything at once in the palette, for comparison. The app's Build page draws the same
// thing with fixed settings.

import { atomFingerprint, css } from '../../render/fingerprint';
import type { AtomModel } from '../../render/model';
import { OrbitalCloud, ORBITAL_POINTS, orbitalSet, type OrbitalSet } from '../../render/orbitalCloud';
import { Spotlight, type SpotlightOptions } from '../../render/spotlight';
import type { Experiment, ExperimentOption, LabContext, Quality, Settings } from '../types';

export { ORBITAL_POINTS };

/** Extra points for the lit orbital (split across a lit chord), per quality: it reads as a solid
 *  body, like the Dense cloud, while the rest keep the base set. */
export const DENSE_POINTS: Record<Quality, number> = { low: 150_000, medium: 250_000, high: 400_000, ultra: 600_000 };

export const TWINKLE_OPTION: ExperimentOption = {
  id: 'twinkle', label: 'Twinkle', choices: [], default: '0.35',
  range: { min: 0, max: 1.5, step: 0.01, format: (v) => (v === 0 ? 'Steady' : `${Math.round(v * 100)}%`) },
};

export class FingerprintView implements Experiment {
  id = 'fingerprint';
  name = 'Atom fingerprint (artistic)';
  description = 'Each orbital its own twinkling cloud, lit one (or one subshell) at a time while the rest wait as a ghost. A seeded fingerprint gives every atom its own palette, tempo, rhythm, spotlight order and tap response. Tap the atom.';
  uses = { brightness: true, orbital: false };
  options: ExperimentOption[] = [
    TWINKLE_OPTION,
    { id: 'spot', label: 'Spotlight', choices: [{ id: 'rhythm', label: 'Rhythm' }, { id: 'scan', label: 'Scan' }, { id: 'angle', label: 'By angle' }, { id: 'all', label: 'All lit' }] },
    { id: 'rest', label: 'The rest', choices: [{ id: 'ghost', label: 'Ghost' }, { id: 'tint', label: 'Tinted' }, { id: 'dark', label: 'Dark' }] },
    { id: 'palette', label: 'Colors', choices: [{ id: 'print', label: 'Fingerprint' }, { id: 'phase', label: 'Phase' }, { id: 'block', label: 'Subshell' }] },
    { id: 'tempo', label: 'Tempo', choices: [], default: '1', range: { min: 0.25, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}×` } },
    { id: 'camera', label: 'Camera', choices: [{ id: 'follow', label: 'Follows the light' }, { id: 'still', label: 'Still' }] },
  ];
  private ctx!: LabContext;
  private cloud!: OrbitalCloud;
  private set: OrbitalSet | null = null;
  private model: AtomModel | null = null;
  private spot = new Spotlight();
  private settings: Settings | null = null;
  private hud: HTMLElement | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8 && performance.now() - d.t < 350) this.spot.tap();
  };

  wantsSign(): boolean { return true; }

  frame(model: AtomModel): number {
    const set = this.set ?? this.build(model);
    return set.r90 * model.worldPerA0 * 1.12;
  }

  init(ctx: LabContext): void {
    this.ctx = ctx;
    this.cloud = new OrbitalCloud(ctx);
    ctx.canvas?.addEventListener('pointerdown', this.onDown);
    ctx.canvas?.addEventListener('pointerup', this.onUp);
    if (ctx.ui) {
      this.hud = document.createElement('div');
      this.hud.className = 'lab-fp';
      ctx.ui.append(this.hud);
    }
  }

  private build(model: AtomModel): OrbitalSet {
    const q = ORBITAL_POINTS[this.settings?.quality ?? 'medium'];
    return orbitalSet(model.element, q.per, q.budget);
  }

  private rebuild(): void {
    if (!this.model || !this.settings) return;
    const set = this.build(this.model);
    if (set !== this.set) {
      this.set = set;
      this.spot.setSet(set, atomFingerprint(set.element, set));
      this.cloud.setSet(set, this.model.worldPerA0);
      this.paintHud(true);
    }
  }

  setAtom(model: AtomModel): void { this.model = model; this.rebuild(); }
  setSettings(s: Settings): void { this.settings = s; this.rebuild(); }
  resize(ctx: LabContext): void { this.ctx = ctx; this.cloud.resize(ctx); }

  private opt(id: string, fallback: string): string { return this.settings?.options[id] ?? fallback; }
  private num(id: string, fallback: number): number { const v = Number(this.opt(id, String(fallback))); return Number.isFinite(v) ? v : fallback; }

  private chosen(): SpotlightOptions {
    return {
      spot: this.opt('spot', 'rhythm') as SpotlightOptions['spot'],
      rest: this.opt('rest', 'ghost') as SpotlightOptions['rest'],
      palette: this.opt('palette', 'print') as SpotlightOptions['palette'],
      tempo: this.num('tempo', 1),
      camera: this.opt('camera', 'follow') as SpotlightOptions['camera'],
      twinkle: this.num('twinkle', 0.35),
      brightness: this.settings?.brightness ?? 1,
    };
  }

  render(dt: number, time: number): void {
    if (!this.set) return;
    const view = this.spot.step(this.cloud, dt, time, this.chosen(), this.ctx.camera.position);
    this.cloud.wantDense(this.spot.denseWants, DENSE_POINTS[this.settings?.quality ?? 'medium'] / Math.sqrt(this.spot.denseSplit));
    this.cloud.sampleDense(6);
    this.ctx.orbit?.fit(view * 1.12 * (this.model?.worldPerA0 ?? 1));
    this.cloud.render(this.ctx, time);
    this.paintHud(false);
  }

  /** The fingerprint card: palette, scheme, tempo, rhythm (the current beat lit), order, what
   *  a tap does, and which orbital has the light. */
  private paintHud(full: boolean): void {
    const fp = this.spot.fp, set = this.set, hud = this.hud;
    if (!fp || !set || !hud) return;
    if (full || !hud.firstChild) {
      const e = set.element;
      hud.innerHTML = `<div class="lab-fp-head"><b>${e.symbol}</b> ${e.name}<span>fingerprint</span></div>
        <div class="lab-fp-sw">${fp.swatches.map((c) => `<i style="background:${css(c)}"></i>`).join('')}</div>
        <div class="lab-fp-row">${fp.scheme} · ${fp.bpm} bpm · ${fp.order}</div>
        <div class="lab-fp-beat">${fp.pattern.map((p) => `<i class="p${p}"></i>`).join('')}</div>
        <div class="lab-fp-row">Tap: ${fp.tap} · ${set.orbitals.length} orbitals</div>
        <div class="lab-fp-now"></div>`;
    }
    const step = Math.floor(this.spot.beat) % 8;
    hud.querySelectorAll('.lab-fp-beat i').forEach((el, i) => el.classList.toggle('on', i === step));
    const best = this.spot.brightest;
    const mode = this.opt('spot', 'rhythm');
    const lit = this.spot.emph.filter((x) => x > 0.5).length;
    const heart = fp.steps[0].length > 1 && fp.steps[0].includes(best) && set.orbitals[best].r90 < set.r90 * 0.3;
    const now = mode === 'all' ? 'All lit' : heart && lit > 1 ? `Core · ${fp.steps[0].length} orbitals`
      : lit > 1 && mode === 'rhythm' && fp.order === 'Chords' ? set.orbitals[best].key : set.orbitals[best].label;
    const nowEl = hud.querySelector('.lab-fp-now')!;
    if (nowEl.textContent !== now) nowEl.textContent = now;
  }

  stats(): string {
    return `${Math.round(this.cloud.drawn / 1000)}k of ${Math.round((this.set?.total ?? 0) / 1000)}k pts · ${this.set?.orbitals.length ?? 0} orbitals · ${this.cloud.size}`;
  }

  dispose(): void {
    this.ctx.canvas?.removeEventListener('pointerdown', this.onDown);
    this.ctx.canvas?.removeEventListener('pointerup', this.onUp);
    this.hud?.remove();
    this.cloud.dispose();
  }
}
