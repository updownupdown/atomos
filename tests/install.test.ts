import { describe, expect, it } from 'vitest';
import { installOfferDue, isIos } from '../src/ui/install';

describe('add to home screen offer', () => {
  const base = { way: 'prompt' as const, standalone: false, seen: false, builtAny: true };

  it('waits for the first atom', () => {
    expect(installOfferDue({ ...base, builtAny: false })).toBe(false);
    expect(installOfferDue(base)).toBe(true);
  });

  it('shows once, never when installed, and only where it can be taken up', () => {
    expect(installOfferDue({ ...base, seen: true })).toBe(false);
    expect(installOfferDue({ ...base, standalone: true })).toBe(false);
    expect(installOfferDue({ ...base, way: null })).toBe(false);
    expect(installOfferDue({ ...base, way: 'ios' })).toBe(true);
  });

  it('knows iPhones and iPads, which call themselves Macs', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l', 5)).toBe(false);
  });
});
