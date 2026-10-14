import { describe, expect, it } from 'vitest';
import { defaultSave, type SaveData } from '../src/core/save';
import { newsLine, pctLabel, periodProgress, periodNeighbour, periodPick, periodTracks, stepAtom } from '../src/gallery/collect';
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
    expect(toneOf(4, save)).toBe('unbuilt');
    expect(toneOf(1, save)).toBe('built');
    expect(toneOf(2, save)).toBe('stable');
    expect(toneOf(3, save)).toBe('complete');
  });
  it("sums a period's progress", () => {
    const save = built(defaultSave(), 3, 4);
    const p = periodProgress(2, save);
    expect(p).toMatchObject({ atoms: 8, built: 2 });
    expect(p.stable).toBeGreaterThan(0);
    expect(p.stable).toBeLessThan(1);
    expect(p.stableBuilt).toBeGreaterThanOrEqual(4);
    expect(p.stable).toBeCloseTo(p.stableBuilt / p.stableTotal);
    expect(periodProgress(1, defaultSave())).toMatchObject({ atoms: 2, built: 0, stable: 0, stableBuilt: 0, fleeting: 0, fleetingBuilt: 0 });
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

describe('pctLabel', () => {
  it('never rounds a start down to nothing or a near miss up to all', () => {
    expect(pctLabel(0)).toBe('0%');
    expect(pctLabel(0.001)).toBe('1%');
    expect(pctLabel(0.2)).toBe('20%');
    expect(pctLabel(0.998)).toBe('99%');
    expect(pctLabel(1)).toBe('100%');
  });
});

describe('atom list', () => {
  it('sums the whole collection and gives each atom its two shares', async () => {
    const { collectionProgress, atomShares } = await import('../src/gallery/atomlist');
    const save = collect(built(defaultSave(), 1, 2), 1, 'all');
    const all = collectionProgress(save);
    expect(all).toMatchObject({ built: 2, atoms: 118 });
    expect(all.stable).toBeGreaterThan(0);
    expect(all.stable).toBeLessThan(1);
    expect(atomShares(1, save)).toEqual({ stable: 1, fleeting: 1 });
    expect(atomShares(3, save).stable).toBe(0);
    // Before any atom is built, fleeting isotopes are not open: no fleeting share.
    expect(atomShares(1, defaultSave()).fleeting).toBeNull();
  });
});

describe('moving between atoms and periods', () => {
  it('steps to the atom after or before, on into the next period and round from 118 to 1', () => {
    expect(stepAtom(26, 1)).toBe(27); // Fe → Co
    expect(stepAtom(36, 1)).toBe(37); // Kr, the end of Period 4 → Rb, the start of Period 5
    expect(stepAtom(37, -1)).toBe(36); // Rb → Kr
    expect(stepAtom(118, 1)).toBe(1); // Og → H
    expect(stepAtom(1, -1)).toBe(118); // H → Og
    expect(stepAtom(71, 1)).toBe(72); // Lu → Hf, through the f-block in order
  });
  it('goes to the same column in the period above or below', () => {
    expect(periodNeighbour(11, -1)).toBe(3); // Na → Li
    expect(periodNeighbour(26, 1)).toBe(44); // Fe → Ru
    expect(periodNeighbour(10, 1)).toBe(18); // Ne → Ar
  });
  it('takes the nearest column, the left one on a tie, where the period has none', () => {
    expect(periodNeighbour(5, -1)).toBe(2); // B (column 13) → He, nearer than H
    expect(periodNeighbour(4, -1)).toBe(1); // Be (column 2) → H
    expect(periodNeighbour(21, -1)).toBe(12); // Sc → Mg
    expect(periodNeighbour(26, -1)).toBe(13); // Fe (column 8) → Al (13), nearer than Mg (2)
  });
  it('keeps to the f-block rows between Periods 6 and 7', () => {
    expect(periodNeighbour(58, 1)).toBe(90); // Ce → Th
    expect(periodNeighbour(90, -1)).toBe(58); // Th → Ce
    expect(periodNeighbour(58, -1)).toBe(40); // Ce (under column 4) → Zr
  });
  it('loops from Period 7 round to Period 1, and back', () => {
    expect(periodNeighbour(87, 1)).toBe(1); // Fr → H
    expect(periodNeighbour(118, 1)).toBe(2); // Og → He
    expect(periodNeighbour(1, -1)).toBe(87); // H → Fr
  });
  it('picks a period by chip from the same column', () => {
    expect(periodPick(26, 4)).toBe(26);
    expect(periodPick(26, 6)).toBe(76); // Fe → Os
  });
});

describe('what a win just added', () => {
  it('names the new parts and a change of status', () => {
    const before = { parts: ['Nucleus'], fleeting: 0, status: 'started' as const };
    const after = { parts: ['Nucleus', 'Electrons'], fleeting: 0, status: 'stable' as const };
    expect(newsLine('Nickel', before, after, 2)).toEqual({ added: '+ Electrons', note: 'Nickel is now stable collected' });
  });
  it('counts fleeting isotopes and says how far the atom has come', () => {
    const before = { parts: ['Nucleus'], fleeting: 2, status: 'built' as const };
    const after = { parts: ['Nucleus'], fleeting: 3, status: 'built' as const };
    expect(newsLine('Iron', before, after, 7)).toEqual({ added: '+ 1 fleeting isotope', note: 'Iron: 3 fleeting built' });
  });
  it('says nothing when nothing was added', () => {
    const h = { parts: ['Nucleus'], fleeting: 1, status: 'built' as const };
    expect(newsLine('Iron', h, h, 7)).toBeNull();
  });
});
