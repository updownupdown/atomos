// Atom fingerprint: an artistic rendering of the whole atom that never turns into a blur.
// Every orbital is its own dense, twinkling cloud (orbitalCloud.ts), but only one (or one
// subshell, a "chord") is lit at a time: the rest stay as a gray ghost, a faint tint or dark.
// A seeded fingerprint (fingerprint.ts) gives each atom its own palette, tempo, accent rhythm,
// spotlight order, glints and tap response, so the collection reads like a set of jewels:
// alike in kind, each one its own.
//
// Spotlight modes: Rhythm walks the orbitals to the atom's beat; By angle lights whichever
// orbital shows its shape best from where you look (turn it in your hands, like a gem); All lit
// shows everything at once in the palette, for comparison.

import * as THREE from 'three';
import { atomFingerprint, css, type Fingerprint } from '../fingerprint';
import type { AtomModel } from '../model';
import { balancedGain, BLOCK_RGB, OrbitalCloud, orbitalSet, PHASE, veilScale, type OrbitalSet } from '../orbitalCloud';
import type { Experiment, ExperimentOption, LabContext, Quality, Settings } from '../types';

/** Points for the largest orbital, and the cap for the whole atom, per quality. */
export const ORBITAL_POINTS: Record<Quality, { per: number; budget: number }> = {
  low: { per: 30_000, budget: 450_000 },
  medium: { per: 60_000, budget: 900_000 },
  high: { per: 100_000, budget: 1_600_000 },
  ultra: { per: 160_000, budget: 2_600_000 },
};

export const TWINKLE_OPTION: ExperimentOption = {
  id: 'twinkle', label: 'Twinkle', choices: [], default: '0.35',
  range: { min: 0, max: 1.5, step: 0.01, format: (v) => (v === 0 ? 'Steady' : `${Math.round(v * 100)}%`) },
};

const smooth = (x: number) => x * x * (3 - 2 * x);

export class FingerprintView implements Experiment {
  id = 'fingerprint';
  name = 'Atom fingerprint (artistic)';
  description = 'Each orbital its own twinkling cloud, lit one (or one subshell) at a time while the rest wait as a ghost. A seeded fingerprint gives every atom its own palette, tempo, rhythm, spotlight order, glints and tap response. Tap the atom; turn it to catch the light.';
  uses = { brightness: true, orbital: false };
  options: ExperimentOption[] = [
    TWINKLE_OPTION,
    { id: 'spot', label: 'Spotlight', choices: [{ id: 'rhythm', label: 'Rhythm' }, { id: 'angle', label: 'By angle' }, { id: 'all', label: 'All lit' }] },
    { id: 'rest', label: 'The rest', choices: [{ id: 'ghost', label: 'Ghost' }, { id: 'tint', label: 'Tinted' }, { id: 'dark', label: 'Dark' }] },
    { id: 'palette', label: 'Colors', choices: [{ id: 'print', label: 'Fingerprint' }, { id: 'phase', label: 'Phase' }, { id: 'block', label: 'Subshell' }] },
    { id: 'tempo', label: 'Tempo', choices: [], default: '1', range: { min: 0.25, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}×` } },
    { id: 'camera', label: 'Camera', choices: [{ id: 'follow', label: 'Follows the light' }, { id: 'still', label: 'Still' }] },
    { id: 'glint', label: 'Glints', choices: [], default: '1', range: { min: 0, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%` } },
  ];
  private ctx!: LabContext;
  private cloud!: OrbitalCloud;
  private set: OrbitalSet | null = null;
  private model: AtomModel | null = null;
  private fp: Fingerprint | null = null;
  private settings: Settings | null = null;
  private emph: number[] = [];
  private beat = 0;
  private tapAt = -99;
  private tapStyle: Fingerprint['tap'] = 'Ripple';
  private skip = 0;
  private time = 0;
  /** The radius (a0) the camera frames, easing after the lit orbitals. */
  private view = 0;
  private hud: HTMLElement | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8 && performance.now() - d.t < 350) this.tap();
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
      this.fp = atomFingerprint(set.element, set);
      this.emph = set.orbitals.map(() => 0);
      this.cloud.setSet(set, this.model.worldPerA0);
      this.beat = 0;
      this.view = 0;
      this.paintHud(true);
    }
  }

  setAtom(model: AtomModel): void { this.model = model; this.rebuild(); }
  setSettings(s: Settings): void { this.settings = s; this.rebuild(); }
  resize(ctx: LabContext): void { this.ctx = ctx; this.cloud.resize(ctx); }

  private opt(id: string, fallback: string): string { return this.settings?.options[id] ?? fallback; }
  private num(id: string, fallback: number): number { const v = Number(this.opt(id, String(fallback))); return Number.isFinite(v) ? v : fallback; }

  /** A tap: each atom answers in its own way. */
  private tap(): void {
    if (!this.fp) return;
    this.tapAt = this.time;
    this.tapStyle = this.fp.tap;
    if (this.tapStyle === 'Skip') this.skip += 1;
  }

  /** Where the spotlight wants each orbital (0 to 1) right now. */
  private targets(): number[] {
    const set = this.set!, fp = this.fp!;
    const mode = this.opt('spot', 'rhythm');
    if (mode === 'all') return set.orbitals.map(() => 1);
    if (mode === 'angle') {
      // Light whichever orbital shows its shape best from here: a cigar side-on, a disc or a
      // cross face-on. Round ones never win on their own.
      const v = this.ctx.camera.position.clone().normalize();
      const score = set.orbitals.map((o) => {
        // Only orbitals big enough to read at the atom's scale take part, the bigger the better.
        if (o.r90 < set.r90 * 0.3) return 0;
        const c = Math.abs(o.axis.dot(v));
        const k = Math.min(1, o.anisotropy / 0.35) * Math.sqrt(o.r90 / set.r90);
        return o.shape === 'round' ? 0.02 : k * (o.shape === 'prolate' ? (1 - c * c) ** 2 : c ** 4);
      });
      const best = Math.max(...score, 1e-6);
      return score.map((s) => Math.pow(s / best, 8));
    }
    const step = Math.floor(this.beat / fp.dwell) + this.skip;
    const group = new Set(fp.steps[((step % fp.steps.length) + fp.steps.length) % fp.steps.length]);
    return set.orbitals.map((o) => (group.has(o.index) ? 1 : 0));
  }

  render(dt: number, time: number): void {
    this.time = time;
    const set = this.set, fp = this.fp;
    if (!set || !fp) return;
    const tempo = this.num('tempo', 1);
    this.beat += dt * (fp.bpm / 60) * tempo;
    const targets = this.targets();
    // Ease each orbital toward its target: in over about half a beat, out a little slower.
    const rate = Math.max(1.5, (fp.bpm / 60) * tempo * 2.2);
    for (let i = 0; i < targets.length; i++) {
      const e = this.emph[i], t = targets[i];
      this.emph[i] = e + (t - e) * Math.min(1, dt * (t > e ? rate : rate * 0.6));
    }
    const step8 = Math.floor(this.beat) % 8;
    const accent = fp.pattern[step8] * Math.exp(-(this.beat % 1) * 5) * 0.5;
    const sinceTap = time - this.tapAt;
    const bloom = this.tapStyle === 'Bloom' ? Math.max(0, 1 - sinceTap / 1.6) : 0;
    const scatter = this.tapStyle === 'Scatter' ? Math.max(0, 1 - sinceTap / 1.4) : 0;
    const flashSkip = this.tapStyle === 'Skip' ? Math.max(0, 1 - sinceTap / 0.5) : 0;
    const rest = this.opt('rest', 'ghost');
    const palette = this.opt('palette', 'print');
    const glints = this.num('glint', 1);
    const s = this.settings!;
    // A chord (or the heart) shares its light among its orbitals, so lighting five at once
    // reads as one shape rather than a white blot.
    const litCount = targets.reduce((a, t) => a + t, 0);
    const share = 1 / Math.sqrt(Math.max(1, litCount));
    // The camera eases in on what is lit (the heart, a small orbital) and back out for the big
    // ones, so every step fills the view.
    let want = set.r90;
    if (this.opt('camera', 'follow') === 'follow' && this.opt('spot', 'rhythm') !== 'all') {
      let lit = 0, sum = 0;
      for (const o of set.orbitals) { const t = targets[o.index]; if (t > 0.3) { lit = Math.max(lit, o.r90); sum += t; } }
      if (sum > 0) want = Math.max(set.r90 * 0.35, Math.min(set.r90, lit * 1.15));
    }
    this.view = this.view ? this.view + (want - this.view) * Math.min(1, dt * 1.2) : want;
    this.ctx.orbit?.fit(this.view * 1.12 * (this.model?.worldPerA0 ?? 1));
    for (const o of set.orbitals) {
      const e = smooth(Math.max(0, Math.min(1, Math.max(this.emph[o.index], bloom))));
      const [pos, neg] = palette === 'phase' ? PHASE : palette === 'block' ? BLOCK_RGB[o.block] : fp.colors[o.index];
      // The rest: a thin gray veil (a share of their points), a faint tint, or dark.
      const floor = rest === 'dark' ? 0 : rest === 'tint' ? 0.16 : 0.12;
      const satFloor = rest === 'tint' ? 0.45 : 0;
      this.cloud.setLook(o.index, {
        pos, neg,
        // Lit orbitals much smaller than the view (the heart's innermost) thin out too.
        share: floor * veilScale(o, this.view) + (1 - floor * veilScale(o, this.view)) * e * Math.min(1, Math.pow((o.r90 / this.view) / 0.5, 1.2)),
        gain: balancedGain(o, set, this.view) * (rest === 'dark' && e < 0.01 ? 0 : 0.55 + 0.45 * e) * (o.electrons === 1 ? 0.85 : 1)
          // All lit: everything in, at a third, so the sum doesn't flare.
          * (this.opt('spot', 'rhythm') === 'all' ? 0.35 : 1 - e + e * share),
        sat: satFloor + (1 - satFloor) * e,
        twinkle: (0.35 + 0.75 * e) * (1 + scatter * 2.5) * (o.electrons === 1 ? 1.25 : 1),
        breath: fp.breath * e * (0.5 - 0.5 * Math.cos((this.beat / fp.dwell) * Math.PI * 2)),
        glint: fp.glint * glints * (0.15 + 0.85 * e),
        flash: (accent + flashSkip * 0.6) * e,
      });
    }
    const u = this.cloud.material.uniforms;
    u.uTwinkle.value = this.num('twinkle', 0.35);
    u.uAlpha.value = 0.55 * s.brightness;
    u.uFire.value = fp.fire;
    u.uHue.value = 0;
    // The ripple: a shell of the accent color running out past the atom's edge.
    const rip = this.tapStyle === 'Ripple' && sinceTap < 2 ? sinceTap : -1;
    (u.uPulse.value as THREE.Vector4).set(rip < 0 ? -1 : rip * set.r90 * 0.9, set.r90 * 0.12, rip < 0 ? 0 : 1.6 * (1 - rip / 2), 0);
    (u.uPulseCol.value as THREE.Vector3).set(...fp.accent);
    this.cloud.render(this.ctx, time);
    this.paintHud(false);
  }

  /** The fingerprint card: palette, scheme, tempo, rhythm (the current beat lit), order, what
   *  a tap does, and which orbital has the light. */
  private paintHud(full: boolean): void {
    const fp = this.fp, set = this.set, hud = this.hud;
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
    const step = Math.floor(this.beat) % 8;
    hud.querySelectorAll('.lab-fp-beat i').forEach((el, i) => el.classList.toggle('on', i === step));
    let best = 0;
    for (let i = 1; i < this.emph.length; i++) if (this.emph[i] > this.emph[best]) best = i;
    const mode = this.opt('spot', 'rhythm');
    const lit = this.emph.filter((x) => x > 0.5).length;
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
