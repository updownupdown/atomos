import { describe, expect, it } from 'vitest';
import { beatOffset, judgePhrase, nearestBeat, phraseCloses, WINDOW } from '../src/core/pulse';

const P = 640;
const PHASE = 1000;
const LEVELS = [2, 3, 4, 5];
const beats = (ks: number[], wobble = 0) => ks.map((k, i) => PHASE + k * P + (i % 2 ? wobble : -wobble));

describe('beat grid', () => {
  it('finds the nearest beat and the signed offset to it', () => {
    expect(nearestBeat(PHASE + 3 * P + 100, P, PHASE)).toBe(3);
    expect(beatOffset(PHASE + 3 * P + 160, P, PHASE)).toBeCloseTo(0.25);
    expect(beatOffset(PHASE + 3 * P - 160, P, PHASE)).toBeCloseTo(-0.25);
  });

  it('closes a phrase one beat and a window after the last tap', () => {
    expect(phraseCloses(PHASE + 2 * P, P, PHASE)).toBeCloseTo(PHASE + (3 + WINDOW) * P);
  });
});

describe('phrase judging', () => {
  it('sends n clean beats to level n', () => {
    for (const n of LEVELS) {
      const v = judgePhrase(beats(Array.from({ length: n }, (_, k) => k)), P, PHASE, LEVELS);
      expect(v).toEqual({ kind: 'level', n, precision: 1 });
    }
  });

  it('scores slightly late or early taps below 1 but still on the level', () => {
    const v = judgePhrase(beats([0, 1, 2], WINDOW * P * 0.5), P, PHASE, LEVELS);
    expect(v.kind).toBe('level');
    expect(v.kind === 'level' && v.precision).toBeCloseTo(0.5);
  });

  it('loses the electron when a tap misses its beat', () => {
    expect(judgePhrase(beats([0, 1, 2], WINDOW * P * 1.3), P, PHASE, LEVELS).kind).toBe('off');
  });

  it('refuses two taps on one beat', () => {
    expect(judgePhrase([PHASE, PHASE + 40, PHASE + P], P, PHASE, LEVELS).kind).toBe('off');
  });

  it('calls one beat too low and six beats free', () => {
    expect(judgePhrase(beats([0]), P, PHASE, LEVELS)).toEqual({ kind: 'low', n: 1, lowest: 2 });
    expect(judgePhrase(beats([0, 1, 2, 3, 4, 5]), P, PHASE, LEVELS)).toEqual({ kind: 'free', n: 6, highest: 5 });
  });
});
