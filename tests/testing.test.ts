import { describe, expect, it } from 'vitest';
import { atomProgress, orbitalShapeUnlocked, rowOpen } from '../src/core/progress';
import { defaultSave } from '../src/core/save';
import { allUnlocks, applyProgressPreset, currentPreset } from '../src/core/testing';
import { isUnlocked } from '../src/core/unlocks';
import { difficulty, difficultyWord } from '../src/puzzles/difficulty';

describe('progress presets for testing', () => {
  it('clear everything at 0% and keep settings', () => {
    const start = defaultSave();
    start.settings.sound = false;
    start.built[5] = { flawless: true };
    const s = applyProgressPreset(start, 0);
    expect(Object.keys(s.built)).toHaveLength(0);
    expect(Object.keys(s.unlocks)).toHaveLength(0);
    expect(s.settings.sound).toBe(false);
    expect(rowOpen(2, s)).toBe(false);
    expect(currentPreset(s)).toBe(0);
  });

  it('build every atom, isotope, row, shape and unlock at 100%', () => {
    const s = applyProgressPreset({ ...defaultSave(), settings: { ...defaultSave().settings, unlockAll: true } }, 100);
    expect(s.settings.unlockAll).toBe(false);
    for (const z of [1, 26, 118]) expect(atomProgress(z, s)).toBe(1);
    for (let r = 1; r <= 7; r++) expect(rowOpen(r, s)).toBe(true);
    expect(orbitalShapeUnlocked('f', s)).toBe(true);
    for (const id of allUnlocks()) expect(isUnlocked(id, s)).toBe(true);
    expect(currentPreset(s)).toBe(100);
  });

  it('build a share in table order, with the next atom half done', () => {
    const s = applyProgressPreset(defaultSave(), 25);
    expect(Object.keys(s.built)).toHaveLength(30);
    expect(s.built[30]).toBeTruthy();
    expect(s.built[31]).toBeUndefined();
    expect(s.steps[31]?.nucleus).toBeTruthy();
    expect(rowOpen(4, s)).toBe(true);
    expect(rowOpen(5, s)).toBe(false);
    expect(currentPreset(s)).toBe(25);
  });
});

describe('difficulty', () => {
  it('rise with the element within each game', () => {
    expect(difficulty('sliding', 27)).toBe(3);
    expect(difficulty('sliding', 118)).toBe(9);
    expect(difficulty('merge', 2)).toBe(1);
    expect(difficultyWord(difficulty('sliding', 118))).toBe('Expert');
    expect(difficultyWord(1)).toBe('Very easy');
  });
});
