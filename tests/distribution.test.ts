import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ELEMENTS, elementAt, type Isotope } from '../src/gallery/data';
import {
  atomProgress, fleetingCount, fleetingIsotopes, fleetingTotal, isDecayed, isotopeCollected, isotopeGame,
  lastingIsotopes, rowNeed, rowOpen, segmentsOf, stepState,
} from '../src/core/progress';
import { defaultSave, loadSave } from '../src/core/save';
import { isotopeKey } from '../src/core/isotopes';
import { isUnlocked, unlockPuzzle } from '../src/core/unlocks';
import { clusterUnit, mergePar, newMerge } from '../src/puzzles/merge';
import { PUZZLES } from '../src/puzzles/catalog';

describe('lasting and fleeting isotopes', () => {
  it('split every isotope but the common one', () => {
    let lasting = 0, stable = 0, fleeting = 0, none = 0;
    for (const e of ELEMENTS) {
      const l = lastingIsotopes(e.z);
      const f = fleetingIsotopes(e.z);
      expect(l.length + f.length).toBe(e.isotopes.length - 1);
      lasting += l.length;
      stable += l.filter((i) => i.stable).length;
      fleeting += f.length;
      if (!l.length) none++;
    }
    expect(lasting).toBe(294);
    expect(stable).toBe(170);
    expect(fleeting).toBe(3145);
    expect(none).toBe(33);
    expect(lastingIsotopes(50)).toHaveLength(10);
    expect(fleetingIsotopes(79)).toHaveLength(42);
  });

  it('give every lasting isotope its fixed puzzle from the committed table, and nothing else', () => {
    const count: Record<string, number> = {};
    for (const e of ELEMENTS) {
      for (const i of lastingIsotopes(e.z)) {
        const g = isotopeGame(e.z, i.a);
        expect(g, `${e.symbol}-${i.a}`).toBeTruthy();
        count[g!] = (count[g!] ?? 0) + 1;
      }
      for (const i of fleetingIsotopes(e.z)) expect(isotopeGame(e.z, i.a)).toBeNull();
    }
    expect(count).toEqual({ packing: 72, colorCharge: 72, sliding: 41, lines: 41, slideStop: 38, rutherford: 30 });
  });

  it('count lasting ones toward 100% and fleeting ones apart', () => {
    const save = defaultSave();
    save.built[26] = { flawless: false };
    for (const i of lastingIsotopes(26)) save.isotopes[isotopeKey(26, i.a)] = { collected: true };
    expect(atomProgress(26, save)).toBe(1);
    expect(segmentsOf(26, save)).toHaveLength(2 + lastingIsotopes(26).length);
    const f = fleetingIsotopes(26)[0];
    expect(isDecayed(26, f, save)).toBe(false);
    save.isotopes[isotopeKey(26, f.a)] = { collected: true, game: 'colorCharge' };
    expect(isDecayed(26, f, save)).toBe(true);
    expect(fleetingCount(26, save)).toEqual({ built: 1, total: fleetingIsotopes(26).length });
    expect(fleetingTotal(save)).toEqual({ built: 1, total: 3145 });
    expect(atomProgress(26, save)).toBe(1);
  });
});

describe('rows open by progress', () => {
  it('need two thirds of the row above, rounded down', () => {
    const save = defaultSave();
    expect([2, 3, 4, 5, 6, 7].map((r) => rowNeed(r, save).need)).toEqual([1, 5, 5, 12, 12, 21]);
  });

  it('open once that many atoms of the row above are built', () => {
    const save = defaultSave();
    expect(rowOpen(2, save)).toBe(false);
    save.steps[1] = { shells: { flawless: true } };
    expect(rowOpen(2, save)).toBe(true);
    for (const z of [3, 4, 5, 6]) save.built[z] = { flawless: false };
    expect(rowNeed(3, save)).toEqual({ built: 4, need: 5 });
    expect(rowOpen(3, save)).toBe(false);
    save.steps[7] = { nucleus: { flawless: true } };
    expect(rowOpen(3, save)).toBe(false);
    save.steps[7].shells = { flawless: true };
    expect(rowOpen(3, save)).toBe(true);
  });
});

describe('every game has one job', () => {
  it('every one of the ten games opens something in the Atlas or the atom view', () => {
    const games = new Set(['look:block', 'look:melt', 'look:density', 'look:state', 'look:electronegativity', 'look:size', 'look:crust', 'look:discovery', 'look:model', 'nucleus-view', 'toy:timelapse'].map((id) => unlockPuzzle(id as never)));
    expect([...games].sort()).toEqual(['codebreaker', 'colorCharge', 'light', 'lines', 'merge', 'orbitalGrid', 'packing', 'rutherford', 'slideStop', 'sliding']);
    expect(unlockPuzzle('nucleus-view')).toBe('rutherford');
  });

  it('the catalog says so', () => {
    const tier = Object.fromEntries(PUZZLES.map((p) => [p.name, p.tier]));
    expect(tier).toMatchObject({ Tokamak: 'every', Quanta: 'every', Tessera: 'facet', Chroma: 'facet', Flux: 'facet', Nova: 'facet', Inertia: 'facet', Aurum: 'facet', Glyph: 'gate', Lumen: 'facet' });
    expect(PUZZLES.find((p) => p.name === 'Tokamak')!.zRange).toEqual([2, 118]);
  });

  it('Tokamak keeps true cluster sizes, with par a budget on a vetted line past period 3', () => {
    expect(clusterUnit(56, 64)).toBe(1);
    expect(clusterUnit(238, 128)).toBe(1);
    expect(mergePar(40)).toBe(29);
    for (const e of ELEMENTS.filter((x) => x.z > 1 && x.z % 3 === 0)) {
      const s = newMerge({ z: e.z, a: e.commonA }, e.z);
      expect(s.sockets.reduce((a, b) => a + b, 0)).toBe(e.commonA);
      for (const t of s.cells) if (t) expect(Number.isInteger(Math.log2(t.v))).toBe(true);
      expect(s.plan, e.symbol).not.toBeNull();
      if (e.z > 18) expect(s.par, e.symbol).toBeGreaterThan(s.plan!.dirs.length);
      else expect(s.par, e.symbol).toBe(mergePar(e.commonA));
    }
  });
});

// ---- a save made before the change -----------------------------------------------------------

/** The old vault: stable or over a day, besides the common one, at most six; the heaviest atoms,
 *  with none of those, got their two longest-lived. */
function oldVault(z: number): Isotope[] {
  const el = elementAt(z);
  const others = el.isotopes.filter((i) => i.a !== el.commonA);
  let pick = others.filter((i) => i.stable || (i.halfLife !== null && i.halfLife > 86400));
  pick.sort((x, y) => (x.stable !== y.stable ? (x.stable ? -1 : 1) : x.stable ? (y.abundance ?? 0) - (x.abundance ?? 0) : (y.halfLife ?? 0) - (x.halfLife ?? 0)));
  if (!pick.length) pick = others.filter((i) => i.halfLife !== null).sort((x, y) => (y.halfLife ?? 0) - (x.halfLife ?? 0)).slice(0, 2);
  return pick.slice(0, 6);
}

describe('a save from before the change', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => { store.clear(); delete (globalThis as { localStorage?: unknown }).localStorage; });

  it('keeps every built nucleus, row, unlock, shape and isotope', () => {
    const isotopes: Record<string, { collected?: boolean; witnessed?: { at: number; seed: number; lifetime: number }[] }> = {};
    for (const z of [26, 27, 59, 118]) for (const i of oldVault(z)) isotopes[isotopeKey(z, i.a)] = { collected: true };
    isotopes[isotopeKey(6, 15)] = { witnessed: [{ at: 1, seed: 2, lifetime: 2.4 }] };
    const old = {
      version: 1,
      built: { 26: { flawless: true }, 27: { flawless: false } },
      // Cobalt's nucleus was built with Nova, uranium's with Nova too; stored by step, not game.
      steps: { 26: { nucleus: { flawless: true, best: 30 }, shells: { flawless: true } }, 27: { nucleus: { flawless: false, best: 12 }, shells: { flawless: false } }, 92: { nucleus: { flawless: true, best: 19 } } },
      isotopes,
      shapes: { p: { at: 1, best: 20 } },
      rows: { 2: { at: 1 }, 3: { at: 1 }, 4: { at: 1 }, 7: { at: 1, best: 13 } },
      unlocks: { 'lens:ribbon': { at: 1, z: 8 }, 'nucleus-view': { at: 1, z: 40 }, 'look:state': { at: 1, z: 104 } },
      specimens: [],
      log: [],
      settings: { unlockAll: false, reducedMotion: false, sound: true, haptics: true },
    };
    store.set('atomos.save.v1', JSON.stringify(old));
    const save = loadSave();

    expect(stepState(save, 27, 'nucleus')).toMatchObject({ done: true, best: 12 });
    expect(stepState(save, 92, 'nucleus').done).toBe(true);
    for (const r of [2, 3, 4, 7]) expect(rowOpen(r, save)).toBe(true);
    for (const id of ['lens:ribbon', 'nucleus-view', 'look:state'] as const) expect(isUnlocked(id, save)).toBe(true);
    expect(save.shapes.p?.best).toBe(20);
    expect(save.isotopes[isotopeKey(6, 15)].witnessed).toHaveLength(1);

    // Every isotope collected in the old vault is still collected, lasting or fleeting.
    let movedToFleeting = 0;
    for (const z of [26, 27, 59, 118]) {
      for (const i of oldVault(z)) {
        expect(isotopeCollected(save, z, i.a)).toBe(true);
        if (fleetingIsotopes(z).some((f) => f.a === i.a)) movedToFleeting++;
      }
    }
    expect(movedToFleeting).toBeGreaterThan(0);
    expect(fleetingCount(118, save).built).toBe(oldVault(118).length);
    expect(fleetingCount(27, save).built).toBeGreaterThan(0);
  });
});
