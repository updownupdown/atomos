import { describe, expect, it } from 'vitest';
import {
  applyPlacement, band, cascade, captureLadder, configuration, isGroundState, newAtom,
  resolvePlacement, type Atom, type PlaceChoice,
} from '../src/core/physics';
import { ELEMENTS } from '../src/core/elements';

function place(a: Atom, choice: PlaceChoice = {}): Atom {
  const r = resolvePlacement(a, choice);
  if (!r || r.kind !== 'placed') throw new Error(`expected placement, got ${JSON.stringify(r)}`);
  return applyPlacement(a, r.orbital, r.spin);
}

describe('cascade energetics', () => {
  it('reproduces the hydrogen Balmer-alpha and Lyman-alpha lines', () => {
    const photons = cascade(newAtom(1), 3);
    expect(photons.map((p) => p.nm.toFixed(1))).toEqual(['656.1', '121.6']);
  });

  it('gives the He II 468.6 nm line for the first electron captured by helium', () => {
    const photons = cascade(newAtom(2), 4);
    expect(photons[0].nm).toBeCloseTo(468.6, 0);
  });

  it('releases the real ionisation energy in total for every capture level', () => {
    for (const el of ELEMENTS) {
      let a = newAtom(el.z);
      for (let k = 0; k < el.z; k++) {
        const ladder = captureLadder(a)!;
        for (const level of ladder.levels) {
          const total = cascade(a, level.n).reduce((s, p) => s + p.ev, 0);
          expect(total).toBeCloseTo(-ladder.groundEnergy + level.energy, 6);
          expect(cascade(a, level.n).every((p) => p.ev > 0)).toBe(true);
        }
        a = place(a);
      }
    }
  });

  it('labels bands', () => {
    expect(band(0.9)).toBe('x-ray');
    expect(band(121)).toBe('uv');
    expect(band(656)).toBe('visible');
    expect(band(1000)).toBe('ir');
  });
});

describe('placement rules', () => {
  it('fills in Aufbau order and writes the configuration', () => {
    let a = newAtom(7);
    for (let i = 0; i < 7; i++) a = place(a);
    expect(configuration(a)).toBe('1s² 2s² 2p³');
    expect(isGroundState(a)).toBe(true);
  });

  it('bounces a second electron with the same spin (Pauli)', () => {
    let a = newAtom(2);
    a = place(a, { spin: 1 });
    expect(resolvePlacement(a, { spin: 1 })).toEqual({ kind: 'bounced', reason: 'pauli' });
    expect(resolvePlacement(a, { spin: -1 })?.kind).toBe('placed');
  });

  it('marks early pairing in 2p as breaking Hund\'s rule', () => {
    let a = newAtom(6);
    for (let i = 0; i < 5; i++) a = place(a, { axis: 'x' });
    const r = resolvePlacement(a, { axis: 'x' });
    expect(r).toMatchObject({ kind: 'placed', orbital: '2px', sour: 'hund-pair' });
    a = applyPlacement(a, '2px', (r as { spin: 1 | -1 }).spin);
    expect(isGroundState(a)).toBe(false);
  });

  it('marks antiparallel unpaired 2p spins as not ground state', () => {
    let a = newAtom(6);
    for (let i = 0; i < 5; i++) a = place(a, { axis: 'x', spin: null });
    const r = resolvePlacement(a, { axis: 'y', spin: -1 });
    expect(r).toMatchObject({ kind: 'placed', sour: 'hund-spin' });
  });

  it('refuses a full lobe', () => {
    let a = newAtom(10);
    for (let i = 0; i < 4; i++) a = place(a);
    a = place(a, { axis: 'z' });
    a = place(a, { axis: 'z' });
    expect(resolvePlacement(a, { axis: 'z' })).toEqual({ kind: 'bounced', reason: 'full' });
  });
});
