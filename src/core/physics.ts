// Electron placement rules and capture energetics.
//
// Accuracy notes (surfaced in-game):
// - The final step of every cascade releases exactly the real ionisation energy of
//   the ion being formed (NIST values), so binding energies are real.
// - Levels above the valence shell use the Rydberg formula for the ion's net charge.
//   That is exact for one-electron systems (hydrogen gives the true Lyman and Balmer
//   lines) and a good approximation for the outer electron of larger ions.
// - Sub-shell splitting (for example 2s versus 2p) is not modelled in the cascade.

import { element } from './elements';

export const RYDBERG_EV = 13.605693;
export const HC_EV_NM = 1239.84198;
export const MAX_LEVEL = 7;
/** How many capture levels are offered above the orbital being filled. */
export const LEVELS_OFFERED = 4;

export type Axis = 'x' | 'y' | 'z';
export type Spin = 1 | -1;
export type OrbitalId = '1s' | '2s' | '2px' | '2py' | '2pz';
export type SubshellId = '1s' | '2s' | '2p';

export const ORBITALS: OrbitalId[] = ['1s', '2s', '2px', '2py', '2pz'];
export const P_ORBITALS: OrbitalId[] = ['2px', '2py', '2pz'];

export const SUBSHELLS: { id: SubshellId; n: number; capacity: number; orbitals: OrbitalId[] }[] = [
  { id: '1s', n: 1, capacity: 2, orbitals: ['1s'] },
  { id: '2s', n: 2, capacity: 2, orbitals: ['2s'] },
  { id: '2p', n: 2, capacity: 6, orbitals: P_ORBITALS },
];

export function axisOrbital(axis: Axis): OrbitalId {
  return `2p${axis}` as OrbitalId;
}

export interface Atom {
  z: number;
  orbitals: Record<OrbitalId, Spin[]>;
  /** Order electrons were placed, for undo and for ionisation of the outermost one. */
  history: OrbitalId[];
}

export function newAtom(z: number): Atom {
  return {
    z,
    orbitals: { '1s': [], '2s': [], '2px': [], '2py': [], '2pz': [] },
    history: [],
  };
}

export function cloneAtom(a: Atom): Atom {
  const orbitals = {} as Record<OrbitalId, Spin[]>;
  for (const id of ORBITALS) orbitals[id] = [...a.orbitals[id]];
  return { z: a.z, orbitals, history: [...a.history] };
}

export function electronCount(a: Atom): number {
  return ORBITALS.reduce((n, id) => n + a.orbitals[id].length, 0);
}

export function subshellCount(a: Atom, s: SubshellId): number {
  const sub = SUBSHELLS.find((x) => x.id === s)!;
  return sub.orbitals.reduce((n, id) => n + a.orbitals[id].length, 0);
}

/** The sub-shell the next electron will settle into (lowest energy with room). */
export function nextSubshell(a: Atom): (typeof SUBSHELLS)[number] | null {
  if (electronCount(a) >= a.z) return null;
  for (const s of SUBSHELLS) if (subshellCount(a, s.id) < s.capacity) return s;
  return null;
}

export type PlaceOutcome =
  | { kind: 'placed'; orbital: OrbitalId; spin: Spin; sour: null | 'hund-pair' | 'hund-spin' }
  | { kind: 'bounced'; reason: 'pauli' | 'full' };

export interface PlaceChoice {
  axis?: Axis | null;
  /** null means "let the atom choose", which always picks the ground-state spin. */
  spin?: Spin | null;
}

/** Decide where an electron settles. Does not mutate the atom. */
export function resolvePlacement(a: Atom, choice: PlaceChoice = {}): PlaceOutcome | null {
  const sub = nextSubshell(a);
  if (!sub) return null;

  if (sub.id !== '2p') {
    const id = sub.orbitals[0];
    const existing = a.orbitals[id];
    if (existing.length === 1) {
      const needed = (-existing[0]) as Spin;
      if (choice.spin && choice.spin !== needed) return { kind: 'bounced', reason: 'pauli' };
      return { kind: 'placed', orbital: id, spin: needed, sour: null };
    }
    return { kind: 'placed', orbital: id, spin: choice.spin ?? 1, sour: null };
  }

  const empty = P_ORBITALS.filter((id) => a.orbitals[id].length === 0);
  const id = choice.axis ? axisOrbital(choice.axis) : (empty[0] ?? P_ORBITALS.find((o) => a.orbitals[o].length < 2)!);
  const existing = a.orbitals[id];
  if (existing.length >= 2) return { kind: 'bounced', reason: 'full' };

  if (existing.length === 1) {
    const needed = (-existing[0]) as Spin;
    if (choice.spin && choice.spin !== needed) return { kind: 'bounced', reason: 'pauli' };
    return { kind: 'placed', orbital: id, spin: needed, sour: empty.length > 0 ? 'hund-pair' : null };
  }

  const singles = P_ORBITALS.filter((o) => a.orbitals[o].length === 1).map((o) => a.orbitals[o][0]);
  const majority: Spin = singles.length && singles.filter((s) => s === -1).length > singles.length / 2 ? -1 : 1;
  const spin = choice.spin ?? majority;
  const sour = singles.some((s) => s !== spin) ? 'hund-spin' : null;
  return { kind: 'placed', orbital: id, spin, sour };
}

export function applyPlacement(a: Atom, orbital: OrbitalId, spin: Spin): Atom {
  const next = cloneAtom(a);
  next.orbitals[orbital].push(spin);
  next.history.push(orbital);
  return next;
}

export function removeLastElectron(a: Atom): Atom {
  const next = cloneAtom(a);
  const id = next.history.pop();
  if (id) next.orbitals[id].pop();
  return next;
}

/** True when the configuration matches the ground state (Aufbau, Pauli and Hund). */
export function isGroundState(a: Atom): boolean {
  const occ = P_ORBITALS.map((id) => a.orbitals[id].length);
  if (Math.max(...occ) - Math.min(...occ) > 1) return false;
  const unpaired = P_ORBITALS.filter((id) => a.orbitals[id].length === 1).map((id) => a.orbitals[id][0]);
  return unpaired.every((s) => s === unpaired[0]);
}

/** Slater's rules effective nuclear charge for an orbital in the current configuration. */
export function effectiveCharge(a: Atom, orbital: OrbitalId): number {
  const n1 = a.orbitals['1s'].length;
  const n2 = subshellCount(a, '2s') + subshellCount(a, '2p');
  if (orbital === '1s') return a.z - 0.3 * Math.max(0, n1 - 1);
  return a.z - 0.85 * n1 - 0.35 * Math.max(0, n2 - 1);
}

/** Effective charge an electron would feel if it were added to this orbital now. */
export function effectiveChargeForNew(a: Atom, orbital: OrbitalId): number {
  const n1 = a.orbitals['1s'].length;
  const n2 = subshellCount(a, '2s') + subshellCount(a, '2p');
  if (orbital === '1s') return a.z - 0.3 * n1;
  return a.z - 0.85 * n1 - 0.35 * n2;
}

export interface Level {
  n: number;
  energy: number; // eV, negative when bound
}

export interface CaptureLadder {
  groundLabel: string;
  groundEnergy: number;
  levels: Level[]; // capture levels above the ground state, lowest first
}

/** Energy ladder for the next electron to be captured. */
export function captureLadder(a: Atom): CaptureLadder | null {
  const sub = nextSubshell(a);
  if (!sub) return null;
  const k = electronCount(a);
  const q = a.z - k;
  const ie = element(a.z).ionisation[a.z - k - 1];
  const levels: Level[] = [];
  for (let n = sub.n + 1; n <= Math.min(MAX_LEVEL, sub.n + LEVELS_OFFERED); n++) {
    levels.push({ n, energy: -(RYDBERG_EV * q * q) / (n * n) });
  }
  return { groundLabel: sub.id, groundEnergy: -ie, levels };
}

export interface Photon {
  from: string;
  to: string;
  ev: number;
  nm: number;
}

/** Photons released as an electron captured at level nCap cascades to the ground state. */
export function cascade(a: Atom, nCap: number): Photon[] {
  const ladder = captureLadder(a);
  if (!ladder) return [];
  const photons: Photon[] = [];
  const byN = new Map(ladder.levels.map((l) => [l.n, l.energy]));
  const lowest = ladder.levels[0].n;
  const highest = ladder.levels[ladder.levels.length - 1].n;
  const start = Math.max(lowest, Math.min(highest, nCap));
  for (let n = start; n > lowest; n--) {
    const ev = byN.get(n - 1)! * -1 - byN.get(n)! * -1;
    photons.push({ from: `n=${n}`, to: `n=${n - 1}`, ev, nm: HC_EV_NM / ev });
  }
  const finalEv = -ladder.groundEnergy + byN.get(lowest)!;
  photons.push({ from: `n=${lowest}`, to: ladder.groundLabel, ev: finalEv, nm: HC_EV_NM / finalEv });
  return photons;
}

export type Band = 'x-ray' | 'uv' | 'visible' | 'ir';

export function band(nm: number): Band {
  if (nm < 10) return 'x-ray';
  if (nm < 380) return 'uv';
  if (nm <= 750) return 'visible';
  return 'ir';
}

const SUPERSCRIPT: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶' };

/** Electron configuration in chemists' notation, for example 1s² 2s² 2p³. */
export function configuration(a: Atom): string {
  const parts: string[] = [];
  for (const s of SUBSHELLS) {
    const c = subshellCount(a, s.id);
    if (c > 0) parts.push(`${s.id}${String(c).split('').map((d) => SUPERSCRIPT[d]).join('')}`);
  }
  return parts.join(' ') || 'bare nucleus';
}

/**
 * Every line an element can release while it is built in its ground-state order,
 * rounded to 0.1 nm: the full set a player can collect for that element.
 */
export function reachableLines(z: number): number[] {
  let a = newAtom(z);
  const lines = new Set<number>();
  for (let k = 0; k < z; k++) {
    const ladder = captureLadder(a);
    if (!ladder) break;
    for (const l of ladder.levels) for (const p of cascade(a, l.n)) lines.add(Math.round(p.nm * 10) / 10);
    const r = resolvePlacement(a);
    if (r?.kind !== 'placed') break;
    a = applyPlacement(a, r.orbital, r.spin);
  }
  return [...lines].sort((x, y) => x - y);
}
