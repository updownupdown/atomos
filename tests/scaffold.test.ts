import { describe, expect, it } from 'vitest';
import { defaultSave, type SaveData } from '../src/core/save';
import { fleetingIsotopes, lastingIsotopes } from '../src/core/progress';
import { STABLE_MIN_SHARE, atomSlice } from '../src/gallery/scaffold';

const build = (save: SaveData, z: number, steps: Array<'nucleus' | 'shells'>) => {
  save.steps[z] = Object.fromEntries(steps.map((s) => [s, { flawless: false }])) as SaveData['steps'][number];
  if (steps.includes('shells')) save.built[z] = { flawless: false } as SaveData['built'][number];
  return save;
};
const collect = (save: SaveData, z: number, list: Array<{ a: number }>) => {
  for (const i of list) save.isotopes[`${z}-${i.a}`] = { collected: true, at: 1 };
  return save;
};

describe('atomSlice', () => {
  it('starts empty, still, with the counts of what there is to build', () => {
    const s = atomSlice(26, defaultSave());
    expect(s.pct).toBe(0);
    expect(s.spin).toBe(false);
    expect(s.stableBuilt).toBe(0);
    expect(s.stableTotal).toBe(2 + lastingIsotopes(26).length);
    expect(s.fleetingTotal).toBe(fleetingIsotopes(26).length);
    expect(s.fleetingOn).toBe(false);
  });

  it('keeps at least a tenth of the circle for the stable parts', () => {
    // Iron: a few stable parts against many fleeting isotopes.
    const save = build(defaultSave(), 26, ['nucleus']);
    const s = atomSlice(26, save);
    const share = Math.max(STABLE_MIN_SHARE, s.stableTotal / (s.stableTotal + s.fleetingTotal));
    expect(s.pct).toBeCloseTo(share / s.stableTotal, 6);
    expect(s.pct).toBeGreaterThanOrEqual(STABLE_MIN_SHARE / s.stableTotal);
  });

  it('counts fleeting isotopes only once they have opened', () => {
    const closed = collect(defaultSave(), 26, fleetingIsotopes(26).slice(0, 3));
    expect(atomSlice(26, closed).fleetingOn).toBe(false);
    expect(atomSlice(26, closed).pct).toBe(0);
    const open = build(closed, 1, ['shells']);
    const s = atomSlice(26, open);
    expect(s.fleetingOn).toBe(true);
    expect(s.fleetingBuilt).toBe(3);
    expect(s.pct).toBeGreaterThan(0);
  });

  it('turns once the stable parts are all built, and fills once everything is', () => {
    const save = collect(build(defaultSave(), 26, ['nucleus', 'shells']), 26, lastingIsotopes(26));
    const stable = atomSlice(26, save);
    expect(stable.spin).toBe(true);
    expect(stable.pct).toBeLessThan(1);
    collect(save, 26, fleetingIsotopes(26));
    const all = atomSlice(26, save);
    expect(all.pct).toBe(1);
    expect(all.spin).toBe(true);
  });

  it('fills the whole circle for an atom with no fleeting isotopes once its stable parts are built', () => {
    const z = [...Array(118)].map((_, i) => i + 1).find((z) => fleetingIsotopes(z).length === 0);
    if (!z) return;
    const save = collect(build(defaultSave(), z, z === 1 ? ['shells'] : ['nucleus', 'shells']), z, lastingIsotopes(z));
    expect(atomSlice(z, save).pct).toBe(1);
  });
});
