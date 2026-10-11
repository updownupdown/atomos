// The Atom fingerprint's motion: only one orbital (or one subshell, a "chord") is lit at a
// time while the rest wait as a ghost, a faint tint or dark, stepping to the atom's own beat
// (fingerprint.ts). The lab's "Atom fingerprint (artistic)" experiment and the app's Build
// page both drive an OrbitalCloud with it.
//
// Spotlight modes: Rhythm walks the orbitals to the atom's beat; By angle lights whichever
// orbital shows its shape best from where you look; All lit shows everything at once.

import * as THREE from 'three';
import type { Fingerprint } from './fingerprint';
import { balancedGain, BLOCK_RGB, PHASE, veilScale, type DenseWant, type OrbitalCloud, type OrbitalSet } from './orbitalCloud';

export interface SpotlightOptions {
  spot: 'rhythm' | 'angle' | 'all';
  rest: 'ghost' | 'tint' | 'dark';
  palette: 'print' | 'phase' | 'block';
  /** Beat multiplier (1 = the atom's own tempo). */
  tempo: number;
  /** The view eases in on what is lit, or stays on the whole atom. */
  camera: 'follow' | 'still';
  /** Glint strength (0 none). */
  glint: number;
  /** 0 steady to 1.5. */
  twinkle: number;
  /** 1 = as designed. */
  brightness: number;
}

export const SPOTLIGHT_DEFAULTS: SpotlightOptions = {
  spot: 'rhythm', rest: 'ghost', palette: 'print', tempo: 1, camera: 'follow', glint: 1, twinkle: 0.35, brightness: 1,
};

const smooth = (x: number) => x * x * (3 - 2 * x);

export class Spotlight {
  set: OrbitalSet | null = null;
  fp: Fingerprint | null = null;
  /** How lit each orbital is now (0 to 1), easing toward the spotlight. */
  emph: number[] = [];
  /** Beats since the atom came up. */
  beat = 0;
  private tapAt = -99;
  private tapStyle: Fingerprint['tap'] = 'Ripple';
  private skip = 0;
  private time = 0;
  /** The radius (a0) the camera frames, easing after the lit orbitals. */
  view = 0;
  /** The lit orbitals big enough to show their shape, by how lit: the ones to give dense
   *  points (step()). `denseSplit` is how many share the dense budget. */
  denseWants: DenseWant[] = [];
  denseSplit = 1;

  setSet(set: OrbitalSet, fp: Fingerprint): void {
    this.set = set;
    this.fp = fp;
    this.emph = set.orbitals.map(() => 0);
    this.beat = 0;
    this.view = 0;
  }

  /** A tap: each atom answers in its own way. */
  tap(): void {
    if (!this.fp) return;
    this.tapAt = this.time;
    this.tapStyle = this.fp.tap;
    if (this.tapStyle === 'Skip') this.skip += 1;
  }

  /** Where the spotlight wants each orbital (0 to 1) right now; `eye` is the direction to the
   *  camera, for By angle. */
  private targets(o: SpotlightOptions, eye: THREE.Vector3): number[] {
    const set = this.set!, fp = this.fp!;
    if (o.spot === 'all') return set.orbitals.map(() => 1);
    if (o.spot === 'angle') {
      // Light whichever orbital shows its shape best from here: a cigar side-on, a disc or a
      // cross face-on. Round ones never win on their own.
      const v = eye.clone().normalize();
      const score = set.orbitals.map((x) => {
        // Only orbitals big enough to read at the atom's scale take part, the bigger the better.
        if (x.r90 < set.r90 * 0.3) return 0;
        const c = Math.abs(x.axis.dot(v));
        const k = Math.min(1, x.anisotropy / 0.35) * Math.sqrt(x.r90 / set.r90);
        return x.shape === 'round' ? 0.02 : k * (x.shape === 'prolate' ? (1 - c * c) ** 2 : c ** 4);
      });
      const best = Math.max(...score, 1e-6);
      return score.map((s) => Math.pow(s / best, 8));
    }
    const step = Math.floor(this.beat / fp.dwell) + this.skip;
    const group = new Set(fp.steps[((step % fp.steps.length) + fp.steps.length) % fp.steps.length]);
    return set.orbitals.map((x) => (group.has(x.index) ? 1 : 0));
  }

  /**
   * Advance by `dt` seconds and set every orbital's look on `cloud`. `lit` (optional, per
   * orbital, 0 to 1) scales each orbital's light, for parts not built yet. Returns the radius
   * (a0) the view should frame.
   */
  step(cloud: OrbitalCloud, dt: number, time: number, o: SpotlightOptions, eye: THREE.Vector3, lit?: ArrayLike<number>): number {
    this.time = time;
    const set = this.set, fp = this.fp;
    if (!set || !fp) return 1;
    this.beat += dt * (fp.bpm / 60) * o.tempo;
    const targets = this.targets(o, eye);
    // Ease each orbital toward its target: in over about half a beat, out a little slower.
    const rate = Math.max(1.5, (fp.bpm / 60) * o.tempo * 2.2);
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
    // A chord (or the heart) shares its light among its orbitals, so lighting five at once
    // reads as one shape rather than a white blot.
    const litCount = targets.reduce((a, t) => a + t, 0);
    const share = 1 / Math.sqrt(Math.max(1, litCount));
    // The camera eases in on what is lit (the heart, a small orbital) and back out for the big
    // ones, so every step fills the view.
    let want = set.r90;
    if (o.camera === 'follow' && o.spot !== 'all') {
      let big = 0, sum = 0;
      for (const x of set.orbitals) { const t = targets[x.index]; if (t > 0.3) { big = Math.max(big, x.r90); sum += t; } }
      if (sum > 0) want = Math.max(set.r90 * 0.35, Math.min(set.r90, big * 1.15));
    }
    this.view = this.view ? this.view + (want - this.view) * Math.min(1, dt * 1.2) : want;
    this.denseWants = [];
    let split = 0;
    for (const x of set.orbitals) {
      const e = smooth(Math.max(0, Math.min(1, Math.max(this.emph[x.index], bloom))));
      const [pos, neg] = o.palette === 'phase' ? PHASE : o.palette === 'block' ? BLOCK_RGB[x.block] : fp.colors[x.index];
      // The rest: a thin gray veil (a share of their points), a faint tint, or dark.
      const floor = o.rest === 'dark' ? 0 : o.rest === 'tint' ? 0.16 : 0.12;
      const satFloor = o.rest === 'tint' ? 0.45 : 0;
      const on = lit ? lit[x.index] : 1;
      // Lit orbitals much smaller than the view (the heart's innermost) thin out too.
      const fill = Math.min(1, Math.pow((x.r90 / this.view) / 0.5, 1.2));
      if (o.spot !== 'all' && e > 0.05 && fill > 0.6 && on > 0.5) {
        this.denseWants.push({ index: x.index, weight: e });
        if (targets[x.index] > 0.5) split++;
      }
      cloud.setLook(x.index, {
        pos, neg,
        share: floor * veilScale(x, this.view) + (1 - floor * veilScale(x, this.view)) * e * fill,
        gain: on * balancedGain(x, set, this.view) * (o.rest === 'dark' && e < 0.01 ? 0 : 0.55 + 0.45 * e) * (x.electrons === 1 ? 0.85 : 1)
          // All lit: everything in, at a third, so the sum doesn't flare.
          * (o.spot === 'all' ? 0.35 : 1 - e + e * share),
        sat: satFloor + (1 - satFloor) * e,
        twinkle: (0.35 + 0.75 * e) * (1 + scatter * 2.5) * (x.electrons === 1 ? 1.25 : 1),
        breath: fp.breath * e * (0.5 - 0.5 * Math.cos((this.beat / fp.dwell) * Math.PI * 2)),
        glint: fp.glint * o.glint * (0.15 + 0.85 * e),
        flash: (accent + flashSkip * 0.6) * e,
      });
    }
    this.denseSplit = Math.max(1, split);
    const u = cloud.material.uniforms;
    u.uTwinkle.value = o.twinkle;
    u.uAlpha.value = 0.55 * o.brightness;
    u.uFire.value = fp.fire;
    u.uHue.value = 0;
    // The ripple: a shell of the accent color running out past the atom's edge.
    const rip = this.tapStyle === 'Ripple' && sinceTap < 2 ? sinceTap : -1;
    (u.uPulse.value as THREE.Vector4).set(rip < 0 ? -1 : rip * set.r90 * 0.9, set.r90 * 0.12, rip < 0 ? 0 : 1.6 * (1 - rip / 2), 0);
    (u.uPulseCol.value as THREE.Vector3).set(...fp.accent);
    return this.view;
  }

  /** The orbital with the most light now. */
  get brightest(): number {
    let best = 0;
    for (let i = 1; i < this.emph.length; i++) if (this.emph[i] > this.emph[best]) best = i;
    return best;
  }
}
