import { describe, expect, it } from 'vitest';
import { orbitalShapeUnlocked, shapeAt } from '../src/core/progress';
import { defaultSave } from '../src/core/save';

describe('orbital shape discoveries', () => {
  it('sit on the first atom with an electron in each kind of orbital', () => {
    expect(shapeAt(5)).toBe('p');
    expect(shapeAt(21)).toBe('d');
    expect(shapeAt(58)).toBe('f');
    expect(shapeAt(6)).toBeUndefined();
  });

  it('unlock only once discovered, s always', () => {
    const save = defaultSave();
    expect(orbitalShapeUnlocked('s', save)).toBe(true);
    expect(orbitalShapeUnlocked('p', save)).toBe(false);
    save.shapes.p = { at: 1 };
    expect(orbitalShapeUnlocked('p', save)).toBe(true);
    expect(orbitalShapeUnlocked('d', save)).toBe(false);
    save.settings.unlockAll = true;
    expect(orbitalShapeUnlocked('f', save)).toBe(true);
  });
});
