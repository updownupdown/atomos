import { describe, expect, it } from 'vitest';
import { trackStates } from '../src/ui/tracks';

const dot = (done: boolean, locked = false) => ({ done, locked });

describe('trackStates', () => {
  it('stays gray until something is done, then green down to the first gap', () => {
    const s = trackStates([{ stable: dot(true) }, {}, { stable: dot(true) }, { stable: dot(false) }, { stable: dot(true) }]);
    expect(s.map((r) => [r.stable.above, r.stable.below])).toEqual([
      [false, true], [true, true], [true, true], [true, false], [false, false],
    ]);
    expect(s[3].stable.next).toBe(true);
    expect(s[3].stable.nu).toBe(true);
  });

  it('puts Nu on the fleeting lane once stable is whole, and never on a locked stop', () => {
    const whole = trackStates([{ stable: dot(true) }, { fleeting: dot(false) }]);
    expect(whole[1].fleeting.nu).toBe(true);
    const locked = trackStates([{ stable: dot(false, true) }, { fleeting: dot(false, true) }]);
    expect(locked.some((r) => r.stable.next || r.stable.nu || r.fleeting.next || r.fleeting.nu)).toBe(false);
    expect(locked[1].stable.above).toBe(false);
  });

  it('leaves Nu out when asked', () => {
    expect(trackStates([{ stable: dot(false) }], { nu: false })[0].stable.nu).toBe(false);
  });
});
