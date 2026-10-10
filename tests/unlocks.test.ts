import { describe, expect, it } from 'vitest';
import { isUnlocked, unlockPuzzle, unlockZ } from '../src/core/unlocks';
import { defaultSave } from '../src/core/save';

describe('gallery unlocks', () => {
  it('are opened by the right gate puzzle', () => {
    expect(unlockPuzzle('lens:ribbon')).toBe('light');
    expect(unlockPuzzle('nucleus-view')).toBe('rutherford');
    expect(unlockPuzzle('look:glass')).toBe('codebreaker');
  });

  it('open once solved, or all at once from Settings', () => {
    const save = defaultSave();
    expect(isUnlocked('lens:ribbon', save)).toBe(false);
    save.unlocks['lens:ribbon'] = { at: 1, z: 8 };
    expect(isUnlocked('lens:ribbon', save)).toBe(true);
    expect(isUnlocked('lens:circle', save)).toBe(false);
    save.settings.unlockAll = true;
    expect(isUnlocked('nucleus-view', save)).toBe(true);
  });

  it('deal each new unlock a little harder, and a replay the same board', () => {
    const save = defaultSave();
    expect(unlockZ('lens:table', save)).toBe(8);
    save.unlocks['lens:table'] = { at: 1, z: 8 };
    expect(unlockZ('lens:table', save)).toBe(8);
    expect(unlockZ('lens:ribbon', save)).toBe(30);
    expect(unlockZ('look:a', save)).toBe(104);
    expect(unlockZ('nucleus-view', save)).toBe(40);
  });
});
