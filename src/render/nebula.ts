// The nebula: how the app's whole-atom clouds look (the Collect gem, the Build page, and View's
// particles): the atom as a cosmic, impossible-to-hold jewel, its beauty in the spinning cloud
// rather than any surface. One hue for the whole atom, taken from its place in the table (the
// color its plate wears), the points a little large and growing toward the edge so the cloud
// reads as mist, no floor under the core (so a dense heart glows instead of clipping to white),
// a soft halo, and no twinkle. The light walks the atom's orbitals one at a time: the one it is
// on brightens in the atom's hue with its other lobes in the opposite hue, and gets dense points
// so its shape shows, while the rest keep a quarter of their light. The walk's pace, the spin's
// direction and speed, and its first pose come from the atom's seed, so each atom turns as
// itself. Found in the lab's "Cloud study" (lab/experiments/cloudStudy.ts).

import { hexToHue } from '../core/paint';
import { placeColour, type Element } from '../gallery/data';
import { mulberry32 } from '../gallery/orbital';
import { hsl, type DenseWant, type OrbitalCloud, type OrbitalInfo, type OrbitalSet } from './orbitalCloud';

type RGB = [number, number, number];

export interface NebulaOptions {
  /** 0 gray to 1 full color. */
  sat: number;
  /** Light (1 = as designed). */
  bright: number;
  /** The halo's strength (0 none). */
  halo: number;
  /** The light walks the orbitals; off, every orbital keeps its full light. */
  walk: boolean;
  /** Seconds the light spends on each orbital. */
  dwell?: number;
  /** The share of light the rest keep while one orbital is lit. */
  rest?: number;
  /** The share of the circle (from noon, clockwise) in color; the rest is gray and dimmer.
   *  1 (default) colors the whole atom. */
  slice?: number;
}

/** The light the gray part of a sliced atom keeps. */
const SLICE_DIM = 0.7;

/** Points grow by this much; the outer points grow this much more; the frame reaches this many
 *  times the radius holding 85% of the points; the core's falloff. */
const POINT_SCALE = 1.6;
const MIST = 0.6;
const FRAME = 1.25;
const CORE = 2;
const DWELL = 4;
const REST = 0.25;
/** Orbitals too small to show a shape are not walked (a share of the atom's r90). */
const WALK_MIN = 0.25;

/** The radius (a0) holding 85% of the atom's points, cached once the set is complete; while
 *  it fills (OrbitalSetBuilder) only the points in so far count, so the frame settles as they
 *  come in rather than reading the empty buffer as a heap of points at the center. */
const radii = new WeakMap<OrbitalSet, number>();
function bodyRadius(set: OrbitalSet): number {
  const hit = radii.get(set);
  if (hit !== undefined) return hit;
  const pos = set.geometry.getAttribute('position').array as Float32Array;
  const rs: number[] = [];
  for (const o of set.orbitals) {
    const n = set.complete ? o.count : set.filled[o.index];
    for (let i = o.start; i < o.start + n; i += 17) rs.push(Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  if (rs.length < 64) return set.r90 * 0.8;
  rs.sort((a, b) => a - b);
  const out = rs[Math.floor(0.85 * rs.length)] ?? set.r90;
  if (set.complete) radii.set(set, out);
  return out;
}

/** The atom's hue (0 to 1): the hue of its place in the table. */
export function atomHue(e: Element): number {
  return hexToHue(placeColour(e)) / 360;
}

const mix = (a: RGB, b: RGB, f: number): RGB => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

export class Nebula {
  set: OrbitalSet | null = null;
  hue = 0;
  seed = 0;
  /** The orbitals the light walks (indices), and where it stands along them. */
  private path: number[] = [];
  private pos = 0;
  /** How lit each orbital is now (0 to 1). */
  private lit = new Float32Array(64);
  /** Dense points wanted this frame, for the lit orbitals. */
  denseWants: DenseWant[] = [];
  /** The atom's colors: the resting cloud's lobes, and the lit orbital's (its hue, and the
   *  opposite hue for the other lobes). */
  restColors: [RGB, RGB] = [[1, 1, 1], [1, 1, 1]];
  litColors: [RGB, RGB] = [[1, 1, 1], [1, 1, 1]];

  setSet(set: OrbitalSet): void {
    if (this.set?.element.z !== set.element.z) {
      const e = set.element;
      this.hue = atomHue(e);
      this.seed = Math.floor(mulberry32(e.z * 7919 + 17)() * 1e6);
      this.pos = 0;
      this.lit.fill(0);
      const h = this.hue;
      this.restColors = [hsl(h, 0.72, 0.6), hsl(h, 0.68, 0.46)];
      this.litColors = [hsl(h, 0.75, 0.62), hsl(h + 0.5, 0.75, 0.55)];
    }
    this.set = set;
  }

  /** The radius (a0) to frame: where most of the points are, with room round them. */
  get frameA0(): number {
    const set = this.set;
    return set ? bodyRadius(set) * FRAME : 1;
  }

  /** The spin: a direction and a first pose from the seed, slower for heavier atoms (radians
   *  per second), and a nod of the tilt over about a minute. */
  get spinDir(): 1 | -1 { return this.seed & 1 ? 1 : -1; }
  get spinSpeed(): number { return 0.12 + 0.2 / Math.sqrt(this.set?.element.period ?? 1); }
  get theta0(): number { return ((this.seed % 1000) / 1000) * Math.PI * 2; }
  nod(time: number): number { return 0.18 * Math.sin(time * 0.08 + (this.seed % 7)); }

  /** The orbital the light is on (its index in the set), or null. */
  get litOrbital(): number | null {
    if (!this.path.length) return null;
    return this.path[Math.round(this.pos) % this.path.length];
  }

  /** A tap: the light moves on to the next orbital. */
  advance(): void {
    this.pos = Math.floor(this.pos) + 1;
  }

  /**
   * Advance by `dt` seconds and set every orbital's look on `cloud`. `on` (optional, per
   * orbital, 0 to 1) scales each orbital's light, for parts not built yet; `dense` is how many
   * extra points the lit orbital gets (0 none).
   */
  step(cloud: OrbitalCloud, dt: number, time: number, o: NebulaOptions, dense: number, on?: ArrayLike<number>): void {
    const set = this.set;
    if (!set) return;
    const F = this.frameA0;
    // The walk: through the orbitals big enough to show a shape (and built), inner to outer,
    // crossfading from one to the next.
    const path: number[] = [];
    for (const x of set.orbitals) if (x.r90 >= set.r90 * WALK_MIN && (on ? on[x.index] : 1) > 0.5) path.push(x.index);
    this.path = path;
    const n = path.length;
    if (o.walk && n) this.pos = (this.pos + dt / (o.dwell ?? DWELL)) % n;
    const rest = o.walk && n ? (o.rest ?? REST) : 1;
    this.denseWants = [];
    for (const x of set.orbitals) {
      let lit = 0;
      if (o.walk && n) {
        const i = path.indexOf(x.index);
        if (i >= 0) {
          const d = Math.min(Math.abs(i - this.pos), n - Math.abs(i - this.pos));
          lit = Math.max(0, 1 - Math.max(0, d - 0.25) / 0.5);
        }
      }
      this.lit[x.index] = lit;
      const k = on ? on[x.index] : 1;
      if (lit > 0.05 && dense > 0 && x.r90 >= set.r90 * 0.3) this.denseWants.push({ index: x.index, weight: lit });
      cloud.setLook(x.index, {
        pos: mix(this.restColors[0], this.litColors[0], lit),
        neg: mix(this.restColors[1], this.litColors[1], lit),
        gain: this.gain(x, F) * (rest + (1 - rest) * lit) * k,
        sat: o.sat,
        twinkle: 0,
        breath: 0,
        flash: 0,
      });
    }
    cloud.wantDense(this.denseWants, this.denseWants.length ? dense / Math.sqrt(this.denseWants.length) : 0);
    const u = cloud.material.uniforms;
    u.uTwinkle.value = 0;
    u.uAlpha.value = 0.55 * o.bright;
    u.uHue.value = 0;
    (u.uPulse.value as { set(x: number, y: number, z: number, w: number): unknown }).set(-1, 1, 0, 0);
    (u.uSlice.value as { set(x: number, y: number): unknown }).set(o.slice ?? 1, SLICE_DIM);
    this.dress(cloud, o.halo);
  }

  /** The nebula's body on any cloud, whatever lights it: the points' size and mist, and the halo. */
  dress(cloud: OrbitalCloud, halo: number): void {
    cloud.material.uniforms.uMist.value = MIST;
    cloud.pointScale = POINT_SCALE;
    cloud.haloAmount = halo;
  }

  /** Light per point: each orbital about as bright as a single dense orbital would be, no floor
   *  under the small inner shells (so the heart glows softly instead of flaring white). */
  private gain(x: OrbitalInfo, F: number): number {
    return Math.pow(150_000 / x.count, 0.7) * Math.pow(Math.min(1.2, x.r90 / F), CORE) * 0.35 * (x.electrons === 1 ? 0.85 : 1);
  }
}
