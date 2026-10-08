// Witnessing a fleeting isotope. A nucleus that lives less than a second can never
// join the collection, but its decay can be recorded the way physicists first saw
// such events: as tracks of bubbles in a bubble chamber with a magnetic field.
// The trace is drawn from a seed, so a saved record can be replayed exactly.

import { decayProducts, findIsotope, type Isotope } from '../core/isotopes';

type Rand = () => number;

function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Track {
  kind: 'electron' | 'positron' | 'alpha' | 'proton' | 'recoil' | 'neutron' | 'neutrino';
  /** points along the path, in units of the canvas's shorter side */
  path: [number, number][];
  width: number;
  label: string;
}

function curvedPath(x: number, y: number, angle: number, length: number, curvature: number, tighten: number, steps = 90): [number, number][] {
  const pts: [number, number][] = [[x, y]];
  let a = angle;
  const ds = length / steps;
  let k = curvature;
  for (let i = 0; i < steps; i++) {
    x += Math.cos(a) * ds;
    y += Math.sin(a) * ds;
    a += k * ds;
    k *= tighten; // charged particles lose energy, so their curl tightens
    pts.push([x, y]);
  }
  return pts;
}

/** Build the tracks for one decay event (and the instant decay of a fleeting daughter). */
export function buildTracks(iso: Isotope, seed: number): Track[] {
  const rand = rng(seed);
  const res = decayProducts(iso);
  if (!res) return [];
  const tracks: Track[] = [];
  const base = rand() * Math.PI * 2;
  const field = 1; // B into the screen: positive charges curl one way, negative the other
  const charged = res.emitted.filter((e) => e !== 'neutrino' && e !== 'neutron');
  const main = charged[0] ?? res.emitted[0];
  const add = (kind: Track['kind'], angle: number, x = 0, y = 0) => {
    switch (kind) {
      case 'electron':
        tracks.push({ kind, path: curvedPath(x, y, angle, 0.9, -field * 4.5, 1.012), width: 1, label: 'electron' });
        break;
      case 'positron':
        tracks.push({ kind, path: curvedPath(x, y, angle, 0.9, field * 4.5, 1.012), width: 1, label: 'positron' });
        break;
      case 'alpha':
        tracks.push({ kind, path: curvedPath(x, y, angle, 0.16 + rand() * 0.04, field * 0.6, 1, 30), width: 3.2, label: 'alpha' });
        break;
      case 'proton':
        tracks.push({ kind, path: curvedPath(x, y, angle, 0.42, field * 1.2, 1.003, 60), width: 1.8, label: 'proton' });
        break;
      case 'neutron':
        tracks.push({ kind, path: curvedPath(x, y, angle, 0.38, 0, 1, 2), width: 0, label: 'neutron: no charge, no track' });
        break;
      case 'neutrino':
        tracks.push({ kind, path: curvedPath(x, y, angle, 0.34, 0, 1, 2), width: 0, label: 'neutrino: invisible' });
        break;
      case 'recoil':
        tracks.push({ kind, path: curvedPath(x, y, angle, 0.05, field * 0.4, 1, 12), width: 4, label: 'recoiling nucleus' });
        break;
    }
  };
  for (const [i, e] of res.emitted.entries()) {
    const angle = e === main ? base : base + Math.PI * (0.55 + 0.5 * rand()) * (i % 2 ? 1 : -1);
    add(e, angle);
  }

  // The daughter recoils opposite the main particle.
  const daughter = findIsotope(res.daughter.z, res.daughter.a);
  const recoilAngle = base + Math.PI;
  const before = tracks.length;
  add(iso.mode === 'alpha' ? 'alpha' : 'recoil', recoilAngle);
  const recoil = tracks[before];
  if (iso.mode === 'alpha') recoil.label = 'alpha';

  // A daughter that itself lives far less than a second splits at the end of its stub.
  if (daughter && daughter.halfLife !== undefined && daughter.halfLife < 1e-9) {
    const [ex, ey] = recoil.path[recoil.path.length - 1];
    const sub = decayProducts(daughter);
    if (sub && daughter.mode === 'alpha') {
      const a = rand() * Math.PI * 2;
      add('alpha', a, ex, ey);
      add('alpha', a + Math.PI, ex, ey);
    }
  }
  return tracks;
}

export interface WitnessPlayback {
  stop: () => void;
}

/**
 * Animate the event on a canvas. `progress` runs the bubble tracks from 0 to 1.
 * Call with progress 1 to draw a finished record instantly.
 */
export function drawWitness(canvas: HTMLCanvasElement, tracks: Track[], progress: number, seed: number, nucleusAlive: boolean, t: number): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = canvas.width / canvas.clientWidth;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const s = Math.min(w, h);
  const cx = w / 2, cy = h / 2;

  // Background: stray bubbles and a faint grid like old chamber photographs.
  const bg = rng(seed ^ 0x5bd1e995);
  ctx.fillStyle = 'rgba(226, 220, 207, 0.10)';
  for (let i = 0; i < 160; i++) {
    ctx.beginPath();
    ctx.arc(bg() * w, bg() * h, bg() * 1.4 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(226, 220, 207, 0.05)';
  for (let x = 0; x < w; x += s / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += s / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  if (nucleusAlive) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 20);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
    g.addColorStop(0, `rgba(255, 210, 160, ${pulse})`);
    g.addColorStop(1, 'rgba(255, 180, 120, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const br = rng(seed ^ 0x2545f491);
  for (const tr of tracks) {
    const n = Math.floor(tr.path.length * Math.min(1, progress));
    if (tr.width === 0) {
      if (progress >= 1) {
        const [x0, y0] = tr.path[0];
        const [x1, y1] = tr.path[tr.path.length - 1];
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = 'rgba(226, 220, 207, 0.35)';
        ctx.beginPath();
        ctx.moveTo(cx + x0 * s, cy + y0 * s);
        ctx.lineTo(cx + x1 * s, cy + y1 * s);
        ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, tr.label, cx + x1 * s, cy + y1 * s, 'rgba(226, 220, 207, 0.7)');
      }
      continue;
    }
    for (let i = 0; i < n; i++) {
      const [x, y] = tr.path[i];
      const density = tr.width > 2 ? 3 : 1;
      for (let d = 0; d < density; d++) {
        const jx = (br() - 0.5) * tr.width * 0.9, jy = (br() - 0.5) * tr.width * 0.9;
        const r = (0.6 + br() * 0.9) * (tr.width > 2 ? 1.3 : 1);
        ctx.fillStyle = tr.kind === 'electron' || tr.kind === 'positron' ? 'rgba(243, 238, 226, 0.85)' : 'rgba(255, 220, 180, 0.9)';
        ctx.beginPath();
        ctx.arc(cx + x * s + jx, cy + y * s + jy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (progress >= 1 && tr.kind !== 'recoil') {
      const [x, y] = tr.path[tr.path.length - 1];
      label(ctx, tr.label, cx + x * s, cy + y * s, 'rgba(226, 220, 207, 0.85)');
    }
  }
  // The vertex.
  ctx.fillStyle = 'rgba(255, 240, 220, 0.95)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
  ctx.font = "12px 'Courier Prime', 'Courier New', monospace";
  ctx.fillStyle = colour;
  const w = ctx.measureText(text).width;
  const cw = ctx.canvas.clientWidth;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.min(Math.max(6, x + 6), cw - w - 6), y);
}

/** How much to slow time so a lifetime is visible: 1 for anything 50 ms or longer. */
export function slowFactor(lifetime: number): number {
  if (lifetime >= 0.05) return 1;
  return 10 ** Math.ceil(Math.log10(1.2 / lifetime));
}
