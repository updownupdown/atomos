// Standing-wave launches: the Trace and Rhythm styles.
//
// Both use de Broglie's 1924 picture of a bound electron: a wave that must join up with
// itself after one trip round the nucleus, so only a whole number of waves fits. Level n
// holds n waves. That is why the levels are discrete. It is a semi-classical picture
// (the Bohr model), exact in its energies for hydrogen; real orbitals are 3D clouds, and
// the game says so in its accuracy notes.

import type { Spin } from './physics';

export interface Point { x: number; y: number }

/** How far crest spacing may stray from even, as a fraction of one wavelength. */
export const DEV_MAX = 0.45;
/** How badly the wave may fail to meet itself where it started, as a fraction of crest-to-trough height. */
export const SEAM_MAX = 0.5;
/** Fraction of a full turn a trace must sweep round the nucleus to count as a loop. */
export const LOOP_TURN = 0.95;
/** A loop whose wiggles are smaller than this fraction of its radius is a plain circle. */
export const FLAT = 0.035;

export type WaveVerdict =
  | { kind: 'level'; n: number; precision: number }
  | { kind: 'open' }
  | { kind: 'flat' }
  | { kind: 'unclosed'; waves: number }
  | { kind: 'uneven'; waves: number }
  | { kind: 'low'; waves: number; lowest: number }
  | { kind: 'free'; waves: number; highest: number };

/** Decide what a wave of `waves` crests does, given how evenly it was spaced and how well it closed. */
export function judgeWave(waves: number, dev: number, seam: number, levels: number[]): WaveVerdict {
  const lowest = levels[0], highest = levels[levels.length - 1];
  if (waves === 0) return { kind: 'flat' };
  if (seam > SEAM_MAX) return { kind: 'unclosed', waves };
  if (waves > highest) return { kind: 'free', waves, highest };
  if (dev > DEV_MAX) return { kind: 'uneven', waves };
  if (waves < lowest) return { kind: 'low', waves, lowest };
  const precision = Math.max(0, 1 - Math.max(dev / DEV_MAX, seam / SEAM_MAX));
  return { kind: 'level', n: waves, precision };
}

// ---- Trace ----------------------------------------------------------------------------

export interface TraceShape {
  /** Signed angle swept round the centre, in turns. Positive is clockwise on screen. */
  turns: number;
  /** Crests counted so far (live) or in the whole loop. */
  waves: number;
  /** Worst crest-spacing error as a fraction of the ideal spacing. */
  dev: number;
  /** Mismatch where the wave meets its own start, as a fraction of crest-to-trough height. */
  seam: number;
  /** Mean distance from the centre. */
  radius: number;
  spin: Spin;
  /** Whether the path has gone far enough round to be judged as a loop. */
  loop: boolean;
}

const SAMPLES = 240;

/** Read a freehand path as a wave drawn round `c`. Returns null for a path too short to read. */
export function analyseTrace(points: Point[], c: Point): TraceShape | null {
  if (points.length < 6) return null;
  const th: number[] = [];
  const r: number[] = [];
  let prev = Math.atan2(points[0].y - c.y, points[0].x - c.x);
  let acc = 0;
  for (const p of points) {
    const a = Math.atan2(p.y - c.y, p.x - c.x);
    let d = a - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    acc += d;
    prev = a;
    th.push(acc);
    r.push(Math.hypot(p.x - c.x, p.y - c.y));
  }
  const sweep = th[th.length - 1];
  const dir = sweep >= 0 ? 1 : -1;
  const spin: Spin = dir > 0 ? 1 : -1;
  const turns = sweep / (2 * Math.PI);
  const span = Math.min(Math.abs(sweep), 2 * Math.PI);
  const loop = Math.abs(turns) >= LOOP_TURN;
  const meanR = r.reduce((s, v) => s + v, 0) / r.length;
  if (span < 0.6) return { turns, waves: 0, dev: 0, seam: 0, radius: meanR, spin, loop: false };

  // Resample at even angles. Ignore any backtracking: only forward progress counts.
  const phi = th.map((t) => t * dir);
  const res: number[] = [];
  let i = 0;
  let reach = phi[0];
  for (let j = 0; j < SAMPLES; j++) {
    const target = (j / SAMPLES) * span;
    while (i < phi.length - 1 && Math.max(reach, phi[i + 1]) < target) {
      reach = Math.max(reach, phi[i + 1]);
      i++;
    }
    if (i >= phi.length - 1) {
      res.push(r[r.length - 1]);
      continue;
    }
    const a = Math.max(reach, phi[i]), b = Math.max(a, phi[i + 1]);
    const f = b > a ? Math.min(1, Math.max(0, (target - a) / (b - a))) : 0;
    res.push(r[i] + (r[i + 1] - r[i]) * f);
  }

  // A loop drawn off-centre wobbles once per turn on its own, so remove that before reading waves.
  // While still drawing, angles are stretched to a full turn only once the loop is nearly done.
  const scale = loop ? (2 * Math.PI) / span : 1;
  const ang = res.map((_, j) => (j / SAMPLES) * span * scale);
  const fit = fitOffset(ang, res);
  const s = res.map((v, j) => v - (fit.a + fit.c * Math.cos(ang[j]) + fit.d * Math.sin(ang[j])));
  const rms = Math.sqrt(s.reduce((t, v) => t + v * v, 0) / s.length);
  if (rms < FLAT * fit.a) return { turns, waves: 0, dev: 0, seam: 0, radius: fit.a, spin, loop };

  const crests = loop ? circularCrests(s, rms) : openCrests(s, rms);
  const waves = crests.length;
  let dev = 0;
  if (loop && waves > 0) {
    const ideal = SAMPLES / waves;
    for (let k = 0; k < waves; k++) {
      const gap = (crests[(k + 1) % waves] - crests[k] + SAMPLES) % SAMPLES || SAMPLES;
      dev = Math.max(dev, Math.abs(gap - ideal) / ideal);
    }
  }
  const edge = Math.max(2, Math.round(SAMPLES * 0.02));
  const head = avg(s.slice(0, edge)), tail = avg(s.slice(-edge));
  const p2p = Math.max(...s) - Math.min(...s);
  const seam = loop && p2p > 0 ? Math.abs(tail - head) / p2p : 0;
  return { turns, waves, dev, seam, radius: fit.a, spin, loop };
}

function avg(v: number[]): number {
  return v.reduce((s, x) => s + x, 0) / v.length;
}

/** Least-squares fit of r = a + c cos t + d sin t (an off-centre circle). */
function fitOffset(t: number[], r: number[]): { a: number; c: number; d: number } {
  // Over evenly spaced angles the three terms are nearly orthogonal; solve the 3x3 system anyway.
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [0, 0, 0];
  for (let j = 0; j < t.length; j++) {
    const f = [1, Math.cos(t[j]), Math.sin(t[j])];
    for (let p = 0; p < 3; p++) {
      v[p] += f[p] * r[j];
      for (let q = 0; q < 3; q++) m[p][q] += f[p] * f[q];
    }
  }
  const [a, c, d] = solve3(m, v);
  return { a, c, d };
}

function solve3(m: number[][], v: number[]): number[] {
  const det = (x: number[][]) =>
    x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) - x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) + x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
  const D = det(m);
  if (Math.abs(D) < 1e-9) return [v[0] / (m[0][0] || 1), 0, 0];
  return [0, 1, 2].map((k) => det(m.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)))) / D);
}

/** Crest positions in a closed loop: walk once round from the deepest trough, one crest per rise. */
function circularCrests(s: number[], rms: number): number[] {
  const h = 0.5 * rms;
  const n = s.length;
  let start = 0;
  for (let j = 1; j < n; j++) if (s[j] < s[start]) start = j;
  const crests: number[] = [];
  let up = false;
  let best = start;
  for (let k = 1; k <= n; k++) {
    const j = (start + k) % n;
    if (!up && s[j] > h) {
      up = true;
      best = j;
    } else if (up) {
      if (s[j] > s[best]) best = j;
      if (s[j] < -h) {
        crests.push(best);
        up = false;
      }
    }
  }
  if (up) crests.push(best);
  return crests.sort((x, y) => x - y);
}

/** Crests in a path still being drawn: positive excursions from the start onward. */
function openCrests(s: number[], rms: number): number[] {
  const h = 0.5 * rms;
  const crests: number[] = [];
  let state = 0;
  let best = 0;
  for (let j = 0; j < s.length; j++) {
    if (state <= 0 && s[j] > h) {
      state = 1;
      best = j;
    } else if (state === 1) {
      if (s[j] > s[best]) best = j;
      if (s[j] < -h) {
        crests.push(best);
        state = -1;
      }
    } else if (state === 0 && s[j] < -h) state = -1;
  }
  if (state === 1) crests.push(best);
  return crests;
}

// ---- Rhythm ---------------------------------------------------------------------------

export interface BeatShape {
  waves: number;
  dev: number;
}

/** Taps laid down during one turn of the marker. The last gap runs back round to the first tap. */
export function analyseBeats(taps: number[], period: number): BeatShape {
  const n = taps.length;
  if (n === 0) return { waves: 0, dev: 0 };
  const ideal = period / n;
  let dev = 0;
  for (let k = 0; k < n; k++) {
    const next = k + 1 < n ? taps[k + 1] : taps[0] + period;
    dev = Math.max(dev, Math.abs(next - taps[k] - ideal) / ideal);
  }
  return { waves: n, dev };
}
