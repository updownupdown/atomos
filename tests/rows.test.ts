import { describe, expect, it } from 'vitest';
import { rowOf, rowOpen, rowSpan } from '../src/core/progress';
import { defaultSave } from '../src/core/save';

describe('row gates', () => {
  it('place every atom in its row of the table', () => {
    expect(rowOf(1)).toBe(1);
    expect(rowOf(2)).toBe(1);
    expect(rowOf(3)).toBe(2);
    expect(rowOf(10)).toBe(2);
    expect(rowOf(11)).toBe(3);
    expect(rowOf(86)).toBe(6);
    expect(rowOf(118)).toBe(7);
    expect(rowSpan(2)).toEqual([3, 10]);
    expect(rowSpan(7)).toEqual([87, 118]);
  });

  it('open row 1 from the start and later rows once solved', () => {
    const save = defaultSave();
    expect(rowOpen(1, save)).toBe(true);
    expect(rowOpen(2, save)).toBe(false);
    save.rows[2] = { at: 1 };
    expect(rowOpen(2, save)).toBe(true);
    expect(rowOpen(3, save)).toBe(false);
    save.settings.unlockAll = true;
    expect(rowOpen(7, save)).toBe(true);
  });

  it('keep a row open where something was built before rows were gated', () => {
    const save = defaultSave();
    save.steps[12] = { nucleus: { flawless: false } };
    expect(rowOpen(3, save)).toBe(true);
    save.built[20] = { flawless: true };
    expect(rowOpen(4, save)).toBe(true);
    expect(rowOpen(5, save)).toBe(false);
  });
});
