import { describe, expect, it } from 'vitest';
import { analyseBeats, analyseTrace, judgeWave, type Point } from '../src/core/wave';

const C = { x: 200, y: 200 };

/** A hand-drawn-ish wave loop: `waves` crests over `turns` turns, with optional drift, offset and jitter. */
function loop(opts: { waves: number; turns?: number; amp?: number; drift?: number; offset?: Point; phase?: number; dir?: 1 | -1; jitter?: number; warp?: number }): Point[] {
  const { waves, turns = 1, amp = 0.14, drift = 0, offset = { x: 0, y: 0 }, phase = 0, dir = 1, jitter = 0, warp = 0 } = opts;
  const pts: Point[] = [];
  const N = 180;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i <= N * turns; i++) {
    const t = (i / N) * 2 * Math.PI;
    // warp bends the wave's phase so crests bunch up on one side.
    const ph = waves * (t + warp * Math.sin(t)) + phase;
    const r = 100 * (1 + amp * Math.cos(ph) + drift * (t / (2 * Math.PI))) + jitter * rnd();
    pts.push({ x: C.x + offset.x + r * Math.cos(dir * t), y: C.y + offset.y + r * Math.sin(dir * t) });
  }
  return pts;
}

describe('trace reading', () => {
  it('counts whole waves round a loop', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = analyseTrace(loop({ waves: n }), C)!;
      expect(s.loop).toBe(true);
      expect(s.waves).toBe(n);
      expect(s.dev).toBeLessThan(0.15);
      expect(s.seam).toBeLessThan(0.15);
    }
  });

  it('tolerates an off-centre loop, a little drift, jitter and any starting phase', () => {
    const s = analyseTrace(loop({ waves: 3, offset: { x: 22, y: -15 }, drift: 0.04, jitter: 4, phase: 1.3 }), C)!;
    expect(s.waves).toBe(3);
    expect(judgeWave(s.waves, s.dev, s.seam, [2, 3, 4, 5]).kind).toBe('level');
  });

  it('reads loop direction as spin', () => {
    expect(analyseTrace(loop({ waves: 3 }), C)!.spin).toBe(1);
    expect(analyseTrace(loop({ waves: 3, dir: -1 }), C)!.spin).toBe(-1);
  });

  it('sees a plain circle as flat', () => {
    const s = analyseTrace(loop({ waves: 3, amp: 0 }), C)!;
    expect(s.waves).toBe(0);
    expect(judgeWave(s.waves, s.dev, s.seam, [2, 3, 4, 5]).kind).toBe('flat');
  });

  it('refuses a wave that does not join up with itself', () => {
    // Two and a half waves: it starts on a crest and ends in a trough.
    const pts = loop({ waves: 2.5 });
    const s = analyseTrace(pts, C)!;
    expect(judgeWave(s.waves, s.dev, s.seam, [2, 3, 4, 5]).kind).toBe('unclosed');
  });

  it('refuses badly bunched crests', () => {
    const s = analyseTrace(loop({ waves: 3, warp: 0.6 }), C)!;
    expect(s.dev).toBeGreaterThan(0.45);
    expect(judgeWave(s.waves, s.dev, s.seam, [2, 3, 4, 5]).kind).toBe('uneven');
  });

  it('is not a loop until it goes round the nucleus', () => {
    const s = analyseTrace(loop({ waves: 3, turns: 0.6 }), C)!;
    expect(s.loop).toBe(false);
    const away = loop({ waves: 3 }).map((p) => ({ x: p.x + 400, y: p.y }));
    expect(analyseTrace(away, C)!.loop).toBe(false);
  });

  it('counts crests live while the loop is still being drawn', () => {
    const s = analyseTrace(loop({ waves: 4, turns: 0.55 }), C)!;
    expect(s.waves).toBeGreaterThanOrEqual(2);
    expect(s.waves).toBeLessThanOrEqual(3);
  });
});

describe('wave verdicts', () => {
  const levels = [3, 4, 5, 6];
  it('catches at level n for n even waves, with precision', () => {
    expect(judgeWave(4, 0, 0, levels)).toEqual({ kind: 'level', n: 4, precision: 1 });
    const v = judgeWave(4, 0.225, 0, levels);
    expect(v.kind === 'level' && v.precision).toBeCloseTo(0.5);
  });
  it('sends too many waves free and too few below the ladder', () => {
    expect(judgeWave(7, 0, 0, levels).kind).toBe('free');
    expect(judgeWave(2, 0, 0, levels)).toEqual({ kind: 'low', waves: 2, lowest: 3 });
  });
});

describe('rhythm reading', () => {
  it('scores evenly spaced taps as clean', () => {
    expect(analyseBeats([0, 1, 2, 3], 4)).toEqual({ waves: 4, dev: 0 });
  });
  it('includes the gap back round to the first tap', () => {
    // Three quick taps then a long wait: the closing gap is twice the ideal.
    const b = analyseBeats([0, 0.8, 1.6], 4);
    expect(b.waves).toBe(3);
    expect(b.dev).toBeGreaterThan(0.45);
  });
  it('allows a human amount of wobble', () => {
    const b = analyseBeats([0, 1.25, 1.9, 3.1], 4);
    expect(judgeWave(b.waves, b.dev, 0, [2, 3, 4, 5]).kind).toBe('level');
  });
});
