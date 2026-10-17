import { describe, expect, it, vi } from 'vitest';
import { cadence, melody, newTheme, phraseNow, sigh } from '../src/nu/music';

describe("Nu's music", () => {
  it('writes phrases of eight notes in range, ending on a cadence', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 60));
    for (let k = 0; k < 40; k++) {
      newTheme();
      const seen = new Set<string>();
      for (let p = 0; p < 6; p++) {
        const { notes, chords } = phraseNow();
        expect(notes).toHaveLength(8);
        expect(chords).toHaveLength(4);
        expect(chords[3]).toBe(4);
        for (const d of notes) expect(d).toBeGreaterThanOrEqual(-3), expect(d).toBeLessThanOrEqual(11);
        expect([0, 1, 4, 7]).toContain(notes[7]);
        seen.add(notes.join());
        // Play the phrase through (no sound in tests), past the burst guard.
        for (let i = 0; i < 8; i++) melody();
      }
      // A run doesn't play the same phrase over and over.
      expect(seen.size).toBeGreaterThan(2);
    }
    vi.restoreAllMocks();
  });

  it('takes a level done and a miss in its stride', () => {
    newTheme();
    expect(() => { cadence(); sigh(); melody(); }).not.toThrow();
    expect(phraseNow().notes).toHaveLength(8);
  });
});
