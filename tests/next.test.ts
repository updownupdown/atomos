import { afterEach, describe, expect, it } from 'vitest';
import { GAME_NAMES, nextLabel, nextStep, notePaused } from '../src/core/next';
import { lastingIsotopes, rowSpan } from '../src/core/progress';
import { defaultSave, type SaveData } from '../src/core/save';
import { isotopeKey } from '../src/core/isotopes';
import { PUZZLES } from '../src/puzzles/catalog';
import { elementAt } from '../src/gallery/data';

const build = (save: SaveData, ...zs: number[]) => { for (const z of zs) save.built[z] = { flawless: false }; return save; };

afterEach(() => notePaused(null));

describe('nextStep', () => {
  it('starts a new player on hydrogen\'s electrons', () => {
    const s = nextStep(defaultSave());
    expect(s).toMatchObject({ z: 1, kind: 'electrons', game: 'orbitalGrid', gameName: 'Quanta', label: "Hydrogen's electrons", stage: 'shells' });
    expect(nextLabel(s!)).toBe("Next: hydrogen's electrons");
  });

  it('goes to the lowest open atom that is not built, its nucleus first', () => {
    const save = build(defaultSave(), 1);
    expect(nextStep(save)).toMatchObject({ z: 2, kind: 'nucleus', game: 'merge', label: "Helium's nucleus" });
    save.steps[2] = { nucleus: { flawless: true } };
    expect(nextStep(save)).toMatchObject({ z: 2, kind: 'electrons' });
  });

  it('keeps to the current atom while it still needs a step', () => {
    const save = build(defaultSave(), 1);
    expect(nextStep(save, 2)).toMatchObject({ z: 2, kind: 'nucleus' });
    expect(nextStep(save, 1)).toMatchObject({ z: 2 }); // hydrogen is built: on to helium
  });

  it('skips atoms in a period that is still closed', () => {
    const save = build(defaultSave(), 1);
    // Period 2 opens with 1 of 2 period-1 atoms built; period 3 needs 5 of period 2's 8.
    const [first] = rowSpan(3);
    expect(nextStep(save, first)).toMatchObject({ z: 2 });
  });

  it('turns to lasting isotopes once every open atom is built, lowest atom first', () => {
    const save = defaultSave();
    for (let z = 1; z <= 118; z++) build(save, z);
    const z = [...Array(118).keys()].map((i) => i + 1).find((n) => lastingIsotopes(n).length)!;
    const a = lastingIsotopes(z)[0].a;
    const s = nextStep(save)!;
    expect(s).toMatchObject({ z, kind: 'lasting', a, stage: `iso-${a}`, label: `${elementAt(z).name}-${a}` });
    expect(GAME_NAMES[s.game]).toBe(s.gameName);
  });

  it('never offers a fleeting isotope, and is null when everything is done', () => {
    const save = defaultSave();
    for (let z = 1; z <= 118; z++) {
      build(save, z);
      for (const i of lastingIsotopes(z)) save.isotopes[isotopeKey(z, i.a)] = { collected: true };
    }
    for (const l of ['p', 'd', 'f'] as const) save.shapes[l] = { at: 1 };
    expect(nextStep(save)).toBeNull();
  });

  it('offers an orbital shape on its atom once that atom is built', () => {
    const save = build(defaultSave(), 1, 2, 3, 4, 5);
    expect(nextStep(save, 5)).toMatchObject({ z: 5, kind: 'discovery', game: 'codebreaker', label: 'The p orbital shape', stage: 'shape' });
    expect(nextStep(save)).toMatchObject({ z: 6, kind: 'nucleus' });
    save.shapes.p = { at: 1 };
    expect(nextStep(save, 5)).toMatchObject({ z: 6 });
  });

  it('puts a half-done puzzle first, on its own atom or from anywhere', () => {
    const save = build(defaultSave(), 1);
    notePaused({ z: 1, stage: 'fl-5-packing', game: 'packing' });
    const s = nextStep(save)!;
    expect(s).toMatchObject({ z: 1, kind: 'resume', a: 5, stage: 'fl-5-packing', label: 'Resume Tessera · H-5' });
    expect(nextLabel(s)).toBe('Resume Tessera · H-5');
    expect(nextStep(save, 1)?.kind).toBe('resume');
    expect(nextStep(save, 2)?.kind).toBe('nucleus');
  });

  it('names every puzzle as the catalog does', () => {
    for (const p of PUZZLES) expect(GAME_NAMES[p.id]).toBe(p.name);
  });
});
