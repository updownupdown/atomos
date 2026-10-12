import { describe, expect, it } from 'vitest';
import { defaultSave, type SaveData } from '../src/core/save';
import { periodProgress, periodTracks } from '../src/gallery/collect';
import { toneOf } from '../src/gallery/thumbs';
import { lastingIsotopes, fleetingIsotopes } from '../src/core/progress';

const built = (save: SaveData, ...zs: number[]) => {
  for (const z of zs) {
    save.steps[z] = { nucleus: { flawless: false }, shells: { flawless: false } } as SaveData['steps'][number];
    save.built[z] = { flawless: false } as SaveData['built'][number];
  }
  return save;
};
const collect = (save: SaveData, z: number, which: 'lasting' | 'all') => {
  const list = which === 'lasting' ? lastingIsotopes(z) : [...lastingIsotopes(z), ...fleetingIsotopes(z)];
  for (const i of list) save.isotopes[`${z}-${i.a}`] = { collected: true, at: 1 };
  return save;
};

describe('Collect', () => {
  it('tones each atom by how far it is collected', () => {
    const save = built(defaultSave(), 1, 2, 3);
    collect(save, 2, 'lasting');
    collect(save, 3, 'all');
    expect(toneOf(4, save)).toBe('gray');
    expect(toneOf(1, save)).toBe('white');
    expect(toneOf(2, save)).toBe('green');
    expect(toneOf(3, save)).toBe('color');
  });
  it("sums a period's progress", () => {
    const save = built(defaultSave(), 3, 4);
    const p = periodProgress(2, save);
    expect(p).toMatchObject({ atoms: 8, built: 2 });
    expect(p.stable).toBeGreaterThan(0);
    expect(p.stable).toBeLessThan(1);
    expect(periodProgress(1, defaultSave())).toMatchObject({ atoms: 2, built: 0, stable: 0, fleeting: 0 });
  });
  it('gives each atom a stable bar and, when it has fleeting isotopes, a fleeting one', () => {
    const save = collect(built(defaultSave(), 1, 2), 1, 'lasting');
    const rows = periodTracks(1, save);
    expect(rows).toHaveLength(2);
    expect(rows[0].stable).toMatchObject({ kind: 'bar', done: true, share: 1, locked: false });
    expect(rows[1].stable?.done).toBe(false);
    expect(rows[0].fleeting).toMatchObject({ kind: 'bar', done: false });
    // A period not open yet: its stops are locked.
    expect(periodTracks(4, defaultSave()).every((r) => r.stable?.locked)).toBe(true);
  });
});
