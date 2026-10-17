import { describe, expect, it, vi } from 'vitest';
import { cadence, melody, newTheme, phraseNow, sigh } from '../src/nu/music';

describe("Nu's music", () => {
  it('writes periods of sixteen notes in range, ending on a cadence', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 60));
    for (let k = 0; k < 40; k++) {
      newTheme();
      const seen = new Set<string>();
      for (let p = 0; p < 6; p++) {
        const { notes, chords } = phraseNow();
        expect(notes).toHaveLength(16);
        expect(chords).toHaveLength(16);
        // It ends on a cadence: home, or vi after a deceptive V.
        expect([0, 5]).toContain(chords[15]);
        for (const d of notes) expect(d).toBeGreaterThanOrEqual(-3), expect(d).toBeLessThanOrEqual(11);
        // The last note is the cadence chord's root or third.
        expect([0, 2]).toContain((((notes[15] - chords[15]) % 7) + 7) % 7);
        seen.add(notes.join());
        // Play the phrase through (no sound in tests), past the burst guard.
        for (let i = 0; i < 16; i++) melody();
      }
      // A run doesn't play the same period over and over.
      expect(seen.size).toBeGreaterThan(4);
    }
    vi.restoreAllMocks();
  });

  it('takes a level done and a miss in its stride', () => {
    newTheme();
    expect(() => { cadence(); sigh(); melody(); }).not.toThrow();
    expect(phraseNow().notes).toHaveLength(16);
  });
});
