// The Atom fingerprint's motion: only one orbital (or one subshell, a "chord") is lit at a
// time while the rest wait as a ghost, a faint tint or dark, stepping to the atom's own beat
// (fingerprint.ts). The lab's "Atom fingerprint (artistic)" experiment and the app's Build
// page both drive an OrbitalCloud with it.
//
// Spotlight modes: Rhythm walks the orbitals to the atom's beat; Scan walks the ladder of
// orbitals (inner to outer) and back, or from the largest in to the smallest and over again, easing from one to the next and resting on each (a soft
// pulse as it lands, unless pulses are off), the camera easing after it when it follows; By angle lights whichever orbital shows its shape best from
// where you look; All lit shows everything at once.

import * as THREE from 'three';
import type { Fingerprint } from './fingerprint';
import { balancedGain, BLOCK_RGB, PHASE, veilScale, type DenseWant, type OrbitalCloud, type OrbitalSet } from './orbitalCloud';

export interface SpotlightOptions {
  spot: 'rhythm' | 'scan' | 'angle' | 'all';
  rest: 'ghost' | 'tint' | 'dark';
  palette: 'print' | 'phase' | 'block';
  /** Beat multiplier (1 = the atom's own tempo). */
  tempo: number;
  /** The view eases in on what is lit, or stays on the whole atom. */
  camera: 'follow' | 'still';
  /** 0 steady to 1.5. */
  twinkle: number;
  /** 1 = as designed. */
  brightness: number;
  /** Strength of the beat's light pulses (1 = as designed, 0 none). */
  pulse?: number;
  /** The share of points the rest keeps (instead of the `rest` style's own), so the whole
   *  structure stays readable round what is lit. */
  restShare?: number;
  /** Scan's direction: 'bounce' (default) walks the ladder out and back; 'in' starts on the
   *  largest orbital, walks in to the smallest, then jumps back out to the largest. */
  scanDir?: 'bounce' | 'in';
  /** 0 to 1: lifts every orbital's twinkle to full, not only the lit one's (a tap's twinkle). */
  twinkleAll?: number;
  /** 0 (gray) to 1 (default): scales every orbital's color saturation. */
  saturation?: number;
}

export const SPOTLIGHT_DEFAULTS: SpotlightOptions = {
  spot: 'rhythm', rest: 'ghost', palette: 'print', tempo: 1, camera: 'follow', twinkle: 0.35, brightness: 1,
};

const smooth = (x: number) => x * x * (3 - 2 * x);
/** Scan: the share of each step spent resting on an orbital before gliding to the next. */
const SCAN_REST = 0.4;

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
  /** Scan: steps taken (fractional), the step last landed on, and when. */
  private scanT = 0;
  private landStep = -1;
  private landAt = -99;
  /** Scan: where it is along the orbitals (sorted by size), for the camera. */
  private scanPos = 0;
  private scanOrder: number[] = [];

  setSet(set: OrbitalSet, fp: Fingerprint): void {
    this.set = set;
    this.fp = fp;
    this.emph = set.orbitals.map(() => 0);
    this.beat = 0;
    this.view = 0;
    this.scanT = 0;
    this.landStep = -1;
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
  private targets(o: SpotlightOptions, eye: THREE.Vector3, dt: number, lit?: ArrayLike<number>): number[] {
    const set = this.set!, fp = this.fp!;
    if (o.spot === 'all') return set.orbitals.map(() => 1);
    if (o.spot === 'scan') return this.scan(dt, lit, o.scanDir);
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
    return this.stepTargets(step);
  }

  private stepTargets(step: number): number[] {
    const set = this.set!, fp = this.fp!;
    const group = new Set(fp.steps[((step % fp.steps.length) + fp.steps.length) % fp.steps.length]);
    return set.orbitals.map((x) => (group.has(x.index) ? 1 : 0));
  }

  /** Scan: the built orbitals along the ladder (inner to outer) and back, a step every few
   *  seconds (the atom's own pace, slow). Each step rests on its orbital, then eases on to the
   *  next; the light spreads a little to the neighbours while it moves. */
  private scan(dt: number, lit?: ArrayLike<number>, dir: SpotlightOptions['scanDir'] = 'bounce'): number[] {
    const set = this.set!, fp = this.fp!;
    const order = set.orbitals.filter((x) => !lit || lit[x.index] > 0.5).map((x) => x.index);
    if (dir === 'in') order.reverse();
    this.scanOrder = order;
    const n = order.length;
    const out = set.orbitals.map(() => 0);
    if (!n) return out;
    const stepS = Math.max(3.5, Math.min(6, (2 * fp.dwell * 60) / fp.bpm));
    this.scanT += dt / stepS;
    // Inward, the last step rests on the smallest orbital for the whole step, then the scan
    // starts over on the largest.
    const loop = dir === 'in' ? n : Math.max(1, 2 * (n - 1));
    const s = n > 1 ? this.scanT % loop : 0;
    const j = Math.floor(s);
    const q = dir === 'in' && j === n - 1 ? j : j + smooth(Math.max(0, Math.min(1, (s - j - SCAN_REST) / (1 - SCAN_REST))));
    const pos = q <= n - 1 ? q : loop - q;
    this.scanPos = pos;
    // A new step lands on its orbital: the soft pulse starts.
    const step = Math.floor(this.scanT);
    if (step !== this.landStep) { this.landStep = step; this.landAt = this.time; }
    order.forEach((idx, m) => { const d = m - pos; out[idx] = Math.exp(-(d * d) / (2 * 0.3 * 0.3)); });
    return out;
  }

  /** Scan: the radius (a0) of what it rests on, easing between neighbours as it glides. */
  private scanView(): number {
    const set = this.set!, order = this.scanOrder;
    if (!order.length) return set.r90;
    const k = Math.floor(this.scanPos), f = this.scanPos - k;
    const a = set.orbitals[order[k]].r90, b = set.orbitals[order[Math.min(order.length - 1, k + 1)]].r90;
    return Math.max(set.r90 * 0.1, (a * (1 - f) + b * f) * 1.3);
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
    const targets = this.targets(o, eye, dt, lit);
    // Ease each orbital toward its target: in over about half a beat, out a little slower. A
    // scan is smooth already.
    const rate = Math.max(1.5, (fp.bpm / 60) * o.tempo * 2.2);
    for (let i = 0; i < targets.length; i++) {
      const e = this.emph[i], t = targets[i];
      this.emph[i] = o.spot === 'scan' ? t : e + (t - e) * Math.min(1, dt * (t > e ? rate : rate * 0.6));
    }
    const step8 = Math.floor(this.beat) % 8;
    const pulse = o.pulse ?? 1;
    const accent = fp.pattern[step8] * Math.exp(-(this.beat % 1) * 5) * 0.5 * pulse;
    // Scan: a soft swell of light as it lands on an orbital.
    const sinceLand = time - this.landAt;
    const landing = o.spot === 'scan' ? 0.6 * pulse * Math.sin(Math.min(1, sinceLand / 1.6) * Math.PI) : 0;
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
    if (o.spot === 'scan') want = o.camera === 'follow' ? this.scanView() : set.r90;
    else if (o.camera === 'follow' && o.spot !== 'all') {
      let big = 0, sum = 0;
      for (const x of set.orbitals) { const t = targets[x.index]; if (t > 0.3) { big = Math.max(big, x.r90); sum += t; } }
      if (sum > 0) want = Math.max(set.r90 * 0.35, Math.min(set.r90, big * 1.15));
    }
    // The camera eases after the light (slowly for a scan, so the zoom glides).
    this.view = this.view ? this.view + (want - this.view) * Math.min(1, dt * (o.spot === 'scan' ? 0.5 : 1.2)) : want;
    this.denseWants = [];
    let split = 0;
    for (const x of set.orbitals) {
      const e = smooth(Math.max(0, Math.min(1, Math.max(this.emph[x.index], bloom))));
      const [pos, neg] = o.palette === 'phase' ? PHASE : o.palette === 'block' ? BLOCK_RGB[x.block] : fp.colors[x.index];
      // The rest: a thin gray veil (a share of their points), a faint tint, or dark.
      const floor = o.restShare ?? (o.rest === 'dark' ? 0 : o.rest === 'tint' ? 0.16 : 0.12);
      const satFloor = o.rest === 'tint' ? 0.45 : 0;
      const on = lit ? lit[x.index] : 1;
      // Lit orbitals much smaller than the view (the heart's innermost) thin out too.
      // (A scan shows each orbital in turn, however small: small ones thin less, and still get
      // their dense points.)
      const thin = Math.min(1, Math.pow((x.r90 / this.view) / 0.5, 1.2));
      const fill = o.spot === 'scan' ? Math.max(0.35, thin) : thin;
      if (o.spot !== 'all' && e > 0.05 && (fill > 0.6 || o.spot === 'scan') && on > 0.5) {
        this.denseWants.push({ index: x.index, weight: e });
        if (targets[x.index] > 0.5) split++;
      }
      cloud.setLook(x.index, {
        pos, neg,
        share: floor * veilScale(x, this.view) + (1 - floor * veilScale(x, this.view)) * e * fill,
        gain: on * balancedGain(x, set, this.view) * (o.rest === 'dark' && e < 0.01 ? 0 : 0.55 + 0.45 * e) * (x.electrons === 1 ? 0.85 : 1)
          // All lit: everything in, at a third, so the sum doesn't flare.
          * (o.spot === 'all' ? 0.35 : 1 - e + e * share),
        sat: (satFloor + (1 - satFloor) * e) * (o.saturation ?? 1),
        twinkle: ((0.35 + 0.75 * e) * (1 - (o.twinkleAll ?? 0)) + 1.4 * (o.twinkleAll ?? 0)) * (1 + scatter * 2.5) * (x.electrons === 1 ? 1.25 : 1),
        breath: fp.breath * e * (0.5 - 0.5 * Math.cos((this.beat / fp.dwell) * Math.PI * 2)),
        flash: (accent + flashSkip * 0.6 + landing) * e,
      });
    }
    this.denseSplit = Math.max(1, split);
    const u = cloud.material.uniforms;
    u.uTwinkle.value = o.twinkle;
    u.uAlpha.value = 0.55 * o.brightness;
    u.uHue.value = 0;
    // The ripple: a shell of the accent color running out past the atom's edge.
    const rip = this.tapStyle === 'Ripple' && sinceTap < 2 ? sinceTap : -1;
    (u.uPulse.value as THREE.Vector4).set(rip < 0 ? -1 : rip * set.r90 * 0.9, set.r90 * 0.12, rip < 0 ? 0 : 1.6 * (1 - rip / 2), 0);
    (u.uPulseCol.value as THREE.Vector3).set(...fp.accent);
    return this.view;
  }

  /** Scan: the orbital it rests on or is nearest to now (its index in the set), or null. */
  get scanOrbital(): number | null {
    const order = this.scanOrder;
    if (!order.length) return null;
    return order[Math.max(0, Math.min(order.length - 1, Math.round(this.scanPos)))];
  }

  /** The orbital with the most light now. */
  get brightest(): number {
    let best = 0;
    for (let i = 1; i < this.emph.length; i++) if (this.emph[i] > this.emph[best]) best = i;
    return best;
  }
}
