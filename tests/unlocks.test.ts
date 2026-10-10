import { describe, expect, it } from 'vitest';
import { isUnlocked, unlockPuzzle, unlockZ } from '../src/core/unlocks';
import { defaultSave } from '../src/core/save';

describe('gallery unlocks', () => {
  it('are all opened with Glyph', () => {
    expect(unlockPuzzle('lens:ribbon')).toBe('codebreaker');
    expect(unlockPuzzle('nucleus-view')).toBe('codebreaker');
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
    expect(unlockZ('lens:ribbon', save)).toBe(105);
    save.unlocks['lens:ribbon'] = { at: 1, z: 105 };
    expect(unlockZ('lens:ribbon', save)).toBe(105);
    expect(unlockZ('look:state', save)).toBe(106);
    save.unlocks['look:state'] = { at: 1, z: 106 };
    expect(unlockZ('nucleus-view', save)).toBe(107);
  });

  it('move unlocks opened with Lumen or Aurum up to Glyph\'s range on a replay', () => {
    const save = defaultSave();
    save.unlocks['lens:ribbon'] = { at: 1, z: 8 };
    save.unlocks['nucleus-view'] = { at: 1, z: 40 };
    expect(isUnlocked('lens:ribbon', save)).toBe(true);
    expect(unlockZ('lens:ribbon', save)).toBe(104);
    expect(unlockZ('nucleus-view', save)).toBe(104);
  });
});
