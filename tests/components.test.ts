import { describe, expect, it } from 'vitest';
import { snapValue } from '../src/ui/components';

describe('slider snapping', () => {
  it('rounds to the step and clamps to the range', () => {
    expect(snapValue(5.4, 1, 118)).toBe(5);
    expect(snapValue(5.6, 1, 118)).toBe(6);
    expect(snapValue(-3, 1, 118)).toBe(1);
    expect(snapValue(400, 1, 118)).toBe(118);
  });
  it('measures steps from the minimum', () => {
    expect(snapValue(0.33, 0, 1, 0.1)).toBe(0.3);
    expect(snapValue(7, 1, 21, 5)).toBe(6);
  });
});
