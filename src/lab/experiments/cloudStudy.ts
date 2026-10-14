// Cloud study: the Collect gem's whole-atom cloud (every orbital lit at once, OrbitalCloud with
// no spotlight) with every knob that could make it beautiful out on the panel, to find the
// look for the app: how the view is framed, how big and soft the points are, how the light is
// shared between the inner shells and the outer ones, which colors go where (and whether they
// drift), a halo, how much light, twinkle, and how the atom turns. Each knob can also be set
// from the URL (?o.frame=body&o.palette=radial) for scripted screenshots.

import { BLOCK_RGB, balancedGain, hsl, OrbitalCloud, ORBITAL_POINTS, orbitalSet, type OrbitalInfo, type OrbitalSet } from '../../render/orbitalCloud';
import { atomFingerprint, type Fingerprint } from '../../render/fingerprint';
import type { AtomModel } from '../../render/model';
import type { Experiment, ExperimentOption, LabContext, Settings } from '../types';

type RGB = [number, number, number];

/** Radii (a0) holding a share of all the atom's points, cached per set. */
const radii = new WeakMap<OrbitalSet, Record<number, number>>();
function pointRadii(set: OrbitalSet): Record<number, number> {
  const hit = radii.get(set);
  if (hit) return hit;
  const pos = set.geometry.getAttribute('position').array as Float32Array;
  const rs: number[] = [];
  for (let i = 0; i < set.total; i += 17) rs.push(Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  rs.sort((a, b) => a - b);
  const at = (q: number) => rs[Math.min(rs.length - 1, Math.floor(q * rs.length))] ?? set.r90;
  const out = { 50: at(0.5), 70: at(0.7), 85: at(0.85), 95: at(0.95) };
  radii.set(set, out);
  return out;
}

const slider = (id: string, label: string, def: number, min: number, max: number, step = 0.05): ExperimentOption => ({
  id, label, choices: [], default: String(def), range: { min, max, step, format: (v) => v.toFixed(2) },
});

export class CloudStudy implements Experiment {
  id = 'cloud-study';
  name = 'Cloud study (Collect gem)';
  description = 'The whole atom as the Collect gem draws it, every orbital lit, with the framing, point size, light balance, colors, halo and spin on the panel. Settable from the URL as ?o.frame=body.';
  uses = { brightness: true, orbital: false };
  options: ExperimentOption[] = [
    { id: 'frame', label: 'Frame', choices: [{ id: 'full', label: 'Outer orbital' }, { id: 'body', label: 'Body (85%)' }, { id: 'tight', label: 'Core (70%)' }] },
    slider('size', 'Point size', 1, 0.5, 4, 0.1),
    slider('mist', 'Mist (outer points grow)', 0, 0, 3, 0.1),
    { id: 'inner', label: 'Light balance', choices: [{ id: 'outer', label: 'Outer (as now)' }, { id: 'soft', label: 'Soft core' }, { id: 'even', label: 'Even' }, { id: 'shells', label: 'Per shell' }] },
    slider('core', 'Core falloff (soft)', 1.2, 0.4, 2.4, 0.1),
    slider('valence', 'Valence boost', 0, 0, 3, 0.1),
    { id: 'palette', label: 'Colors', choices: [{ id: 'print', label: 'Fingerprint' }, { id: 'radial', label: 'Radial' }, { id: 'shell', label: 'Per shell' }, { id: 'mono', label: 'One hue' }, { id: 'duo', label: 'Two hues' }, { id: 'block', label: 'Subshell' }, { id: 'ember', label: 'Ember core' }] },
    slider('spread', 'Shell hue spread (per shell)', 0.5, 0, 1, 0.05),
    slider('drift', 'Hue drift (s per turn, 0 off)', 0, 0, 120, 1),
    { id: 'spot', label: 'Light', choices: [{ id: 'all', label: 'All lit' }, { id: 'chord', label: 'One subshell at a time' }, { id: 'orbital', label: 'One orbital at a time' }] },
    { id: 'litpal', label: 'The lit one', choices: [{ id: 'same', label: 'Same colors' }, { id: 'duo', label: 'Two hues by phase' }, { id: 'block', label: 'Subshell color' }, { id: 'print', label: 'Fingerprint' }, { id: 'accent', label: 'Opposite hue' }, { id: 'pale', label: 'Pale' }] },
    slider('rest', 'The rest keeps', 0.3, 0, 1, 0.05),
    slider('dwell', 'Seconds per subshell', 4, 1, 12, 0.5),
    slider('halo', 'Halo', 0, 0, 1.5, 0.05),
    slider('bright', 'Light', 1, 0.3, 4, 0.1),
    slider('twinkle', 'Twinkle', 0, 0, 1, 0.05),
    slider('sat', 'Saturation', 1, 0, 1, 0.05),
    { id: 'dense', label: 'Dense valence', choices: [{ id: '0', label: 'Off' }, { id: '1', label: 'On' }] },
    { id: 'spin', label: 'Spin', choices: [{ id: 'lab', label: 'Lab orbit' }, { id: 'atom', label: "The atom's own" }] },
  ];
  private ctx!: LabContext;
  private cloud!: OrbitalCloud;
  private set: OrbitalSet | null = null;
  private fp: Fingerprint | null = null;
  private model: AtomModel | null = null;
  private settings: Settings | null = null;
  private query = new URLSearchParams(location.search);
  private posed = false;

  wantsSign(): boolean { return true; }

  private opt(id: string, fallback: string): string {
    return this.query.get(`o.${id}`) ?? this.settings?.options[id] ?? this.options.find((o) => o.id === id)?.default ?? fallback;
  }
  private num(id: string, fallback: number): number { const v = Number(this.opt(id, String(fallback))); return Number.isFinite(v) ? v : fallback; }

  /** The radius (a0) the view frames: the outermost orbital's reach, or where most points are. */
  private frameA0(set: OrbitalSet): number {
    const r = pointRadii(set);
    const f = this.opt('frame', 'full');
    return f === 'tight' ? r[70] * 1.35 : f === 'body' ? r[85] * 1.25 : set.r90 * 1.55;
  }

  frame(model: AtomModel): number {
    const set = this.set ?? this.build(model);
    return this.frameA0(set) * model.worldPerA0;
  }

  init(ctx: LabContext): void {
    this.ctx = ctx;
    this.cloud = new OrbitalCloud({ halfFloat: ctx.halfFloat, halo: true });
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
      this.cloud.setSet(set, this.model.worldPerA0);
      this.posed = false;
    }
  }

  setAtom(model: AtomModel): void { this.model = model; this.rebuild(); }
  setSettings(s: Settings): void { this.settings = s; this.rebuild(); }
  resize(ctx: LabContext): void { this.ctx = ctx; this.cloud.resize(ctx); }

  /** Is this subshell part of the atom's outer, shape-giving layer (its period's shell, a
   *  partly filled one, or the d or f subshell being filled across its block)? */
  private valence(o: OrbitalInfo): boolean {
    const e = this.set!.element;
    if (o.n === e.period) return true;
    const sub = e.subshells.find((s) => s.key === o.key);
    if (sub && sub.count < 2 * (2 * o.l + 1)) return true;
    if (o.l === 2 && o.n === e.period - 1 && e.group !== null && e.group >= 3 && e.group <= 12) return true;
    if (o.l === 3 && o.n === e.period - 2 && e.group === null) return true;
    return false;
  }

  /** The two colors (positive and negative lobes) of an orbital under the chosen palette. */
  private colors(o: OrbitalInfo): [RGB, RGB] {
    const set = this.set!, fp = this.fp!;
    const p = this.opt('palette', 'print');
    const h0 = fp.hues[0], h1 = fp.hues[1 % fp.hues.length];
    const t = Math.min(1, o.r90 / set.r90);
    const period = set.element.period;
    switch (p) {
      case 'radial': {
        // A pale, nearly white heart out to a saturated rim, the hue leaning a little on the way.
        const h = h0 + 0.1 * t;
        return [hsl(h, 0.25 + 0.65 * t, 0.8 - 0.26 * t), hsl(h - 0.05, 0.3 + 0.6 * t, (0.8 - 0.26 * t) * 0.8)];
      }
      case 'ember': {
        // A warm white core cooling to the atom's own hue outside, like a star's corona.
        const k = Math.pow(t, 0.7);
        const warm = hsl(0.09, 0.45, 0.88);
        const cool = hsl(h0, 0.8, 0.52);
        const mix = (a: RGB, b: RGB, f: number): RGB => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        const c = mix(warm, cool, k);
        return [c, mix(c, [0, 0, 0], 0.22)];
      }
      case 'shell': {
        // Each shell its own hue, stepping round the wheel from the atom's base hue.
        const h = h0 + this.num('spread', 0.5) * (o.n - 1);
        return [hsl(h, 0.75, 0.6), hsl(h + 0.03, 0.7, 0.47)];
      }
      case 'mono': return [hsl(h0, 0.72, 0.6), hsl(h0, 0.68, 0.46)];
      case 'duo': return [hsl(h0, 0.72, 0.6), hsl(h0 + 0.5, 0.72, 0.52)];
      case 'block': return BLOCK_RGB[o.block];
      default: return fp.colors[o.index];
    }
  }

  render(dt: number, time: number): void {
    const set = this.set, fp = this.fp, model = this.model;
    if (!set || !fp || !model) return;
    const F = this.frameA0(set);
    const inner = this.opt('inner', 'outer');
    const valence = this.num('valence', 0);
    const perShell = new Map<number, number>();
    for (const o of set.orbitals) perShell.set(o.n, (perShell.get(o.n) ?? 0) + 1);
    const dense: { index: number; weight: number }[] = [];
    // One subshell at a time: the subshells in order of size, each lit for a while and
    // crossfading to the next, the rest keeping a share of their light. ?o.lit=3d holds one.
    const spot = this.opt('spot', 'all');
    const chord = spot !== 'all';
    const big = set.orbitals.filter((o) => o.r90 >= set.r90 * 0.25);
    const keys = spot === 'orbital' ? big.map((o) => o.label) : [...new Set(big.map((o) => o.key))];
    const hold = this.query.get('o.lit');
    const dwell = this.num('dwell', 4);
    const pos = (time / dwell) % Math.max(1, keys.length);
    const litOf = (key: string): number => {
      if (!chord) return 1;
      if (hold) return key === hold ? 1 : 0;
      const i = keys.indexOf(key);
      if (i < 0) return 0;
      const d = Math.min(Math.abs(i - pos), keys.length - Math.abs(i - pos));
      return Math.max(0, 1 - Math.max(0, d - 0.25) / 0.5);
    };
    const restKeep = this.num('rest', 0.3);
    const litPal = this.opt('litpal', 'same');
    for (const o of set.orbitals) {
      let [pos, neg] = this.colors(o);
      const lit = litOf(spot === 'orbital' ? o.label : o.key);
      if (chord && lit > 0.5 && litPal !== 'same') {
        const h0 = fp.hues[0];
        [pos, neg] = litPal === 'duo' ? [hsl(h0, 0.75, 0.62), hsl(h0 + 0.5, 0.75, 0.55)]
          : litPal === 'accent' ? [hsl(h0 + 0.5, 0.75, 0.6), hsl(h0 + 0.42, 0.75, 0.5)]
          : litPal === 'pale' ? [hsl(h0, 0.3, 0.85), hsl(h0 + 0.5, 0.6, 0.62)]
          : litPal === 'block' ? BLOCK_RGB[o.block] : fp.colors[o.index];
      }
      const even = Math.pow(150_000 / o.count, 0.7) * Math.max(0.3, Math.min(1, Math.pow(o.r90 / F, 0.5)));
      // Soft core: no floor under the small inner shells, so a dense heart glows instead of clipping to white.
      const soft = Math.pow(150_000 / o.count, 0.7) * Math.pow(Math.min(1.2, o.r90 / F), this.num('core', 1.2));
      let gain = inner === 'outer' ? balancedGain(o, set, F) : inner === 'soft' ? soft : inner === 'even' ? even : (even * 1.6) / Math.sqrt(perShell.get(o.n) ?? 1);
      const v = this.valence(o);
      if (v) gain *= 1 + valence * 0.8;
      if (chord) gain *= restKeep + (1 - restKeep) * lit;
      if (((chord && lit > 0.05) || (!chord && v)) && this.opt('dense', '0') === '1' && o.r90 >= set.r90 * 0.3) dense.push({ index: o.index, weight: chord ? lit : 1 });
      this.cloud.setLook(o.index, {
        pos, neg,
        gain: gain * 0.35 * (o.electrons === 1 ? 0.85 : 1),
        sat: this.num('sat', 1),
        twinkle: 1,
        breath: 0,
        flash: 0,
      });
    }
    const u = this.cloud.material.uniforms;
    u.uTwinkle.value = this.num('twinkle', 0);
    u.uAlpha.value = 0.55 * this.num('bright', 1) * (this.settings?.brightness ?? 1);
    const drift = this.num('drift', 0);
    u.uHue.value = drift > 0 ? ((time / drift) % 1) * Math.PI * 2 : 0;
    u.uMist.value = this.num('mist', 0);
    this.cloud.pointScale = this.num('size', 1);
    this.cloud.haloAmount = this.num('halo', 0);
    this.cloud.wantDense(dense, dense.length ? 90_000 / Math.sqrt(dense.length) : 0);
    this.cloud.sampleDense(6);
    // The atom's own spin: a tilt and a direction from its seed, slower for heavier atoms, the
    // tilt nodding a little over a minute so the view is never quite the same twice.
    const orbit = this.ctx.orbit;
    if (orbit) {
      if (this.opt('spin', 'lab') === 'atom') {
        orbit.autoRotate = false;
        const dir = fp.seed & 1 ? 1 : -1;
        const speed = 0.12 + 0.2 / Math.sqrt(set.element.period);
        if (!this.posed) { orbit.theta = (fp.seed % 1000) / 1000 * Math.PI * 2; this.posed = true; }
        orbit.theta += dt * speed * dir;
        orbit.phi = 1.2 + 0.18 * Math.sin(time * 0.08 + fp.seed % 7);
      }
      orbit.fit(F * model.worldPerA0);
    }
    this.cloud.render(this.ctx, time);
  }

  stats(): string {
    return `${Math.round(this.cloud.drawn / 1000)}k of ${Math.round((this.set?.total ?? 0) / 1000)}k pts · ${this.set?.orbitals.length ?? 0} orbitals · ${this.cloud.size}`;
  }

  dispose(): void { this.cloud.dispose(); }
}
