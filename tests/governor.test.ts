import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS, QualityGovernor } from '../src/render/governor';

/** Run `seconds` of frames, each taking what `cost(level, t)` says (ms); returns the levels seen
 *  at each change. */
function run(g: QualityGovernor, seconds: number, cost: (level: number, t: number) => number, start = 0): { changes: { t: number; level: number }[]; end: number } {
  let t = start;
  const changes: { t: number; level: number }[] = [];
  while (t < start + seconds * 1000) {
    const dt = cost(g.level, t);
    t += dt;
    if (g.frame(dt, t)) changes.push({ t, level: g.level });
  }
  return { changes, end: t };
}

const vsync = (ms: number) => Math.max(1000 / 60, Math.ceil(ms / (1000 / 60) - 1e-6) * (1000 / 60));

describe('quality governor', () => {
  it('stays at the best level while frames keep their slot', () => {
    const g = new QualityGovernor();
    const { changes } = run(g, 30, () => 1000 / 60);
    expect(changes).toEqual([]);
    expect(g.level).toBe(0);
  });

  it('steps down when frames are missed, no faster than the cooldown', () => {
    const g = new QualityGovernor();
    const { changes } = run(g, 20, () => 33.3);
    expect(changes.length).toBeGreaterThan(1);
    for (let i = 1; i < changes.length; i++) expect(changes[i].t - changes[i - 1].t).toBeGreaterThanOrEqual(2000);
    expect(g.level).toBe(QUALITY_LEVELS.length - 1);
  });

  it('takes two steps when far too slow', () => {
    const g = new QualityGovernor();
    run(g, 1.2, () => 50);
    expect(g.level).toBe(2);
  });

  it('settles on the best level that holds 60 fps', () => {
    // Each level costs less: levels 0 to 2 miss their slot, 3 and up fit.
    const g = new QualityGovernor();
    const cost = (level: number) => vsync([30, 26, 22, 14, 11, 9, 8, 7, 6, 5][level]);
    // Time spent at each level over two minutes: nearly all of it at level 3, with brief,
    // ever rarer tries of level 2.
    const time = new Array(QUALITY_LEVELS.length).fill(0);
    let t = 0;
    while (t < 120_000) {
      const dt = cost(g.level);
      t += dt;
      time[g.level] += dt;
      g.frame(dt, t);
    }
    expect(time[3] / t).toBeGreaterThan(0.8);
    expect(time[2] / t).toBeLessThan(0.1);
  });

  it('steps back up after a clean stretch, one level at a time', () => {
    const g = new QualityGovernor({}, 4);
    const { changes } = run(g, 3.5, () => 1000 / 60);
    expect(changes).toEqual([]);
    const more = run(g, 30, () => 1000 / 60, 3500).changes;
    expect(more.map((c) => c.level)).toEqual([3, 2, 1, 0]);
    for (let i = 1; i < more.length; i++) expect(more[i].t - more[i - 1].t).toBeGreaterThanOrEqual(4000);
  });

  it('backs off instead of oscillating between a level that fails and one that holds', () => {
    const g = new QualityGovernor();
    // Level 0 misses half its frames; level 1 holds.
    const cost = (level: number, t: number) => (level === 0 && Math.floor(t / 16.7) % 2 === 0 ? 33.3 : 1000 / 60);
    const { changes } = run(g, 120, cost);
    const ups = changes.filter((c, i) => i > 0 && c.level < changes[i - 1].level);
    // Without backoff it would retry every ~6 s (about 20 tries in two minutes).
    expect(ups.length).toBeLessThanOrEqual(5);
    // The waits between tries grow.
    const gaps = ups.slice(1).map((u, i) => u.t - ups[i].t);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1] * 0.9);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0] * 2);
    expect(g.level).toBeLessThanOrEqual(1);
  });

  it('gives up the dense orbital before the base look thins out', () => {
    const first = QUALITY_LEVELS.findIndex((l) => l.pixel < 1 || l.density < 1);
    expect(first).toBeGreaterThan(0);
    for (let i = 1; i < QUALITY_LEVELS.length; i++) expect(QUALITY_LEVELS[i].dense).toBeLessThanOrEqual(QUALITY_LEVELS[i - 1].dense);
    for (let i = first; i < QUALITY_LEVELS.length; i++) expect(QUALITY_LEVELS[i].dense).toBe(0);
  });

  it('ignores long one-off stalls (a hidden tab, a pause)', () => {
    const g = new QualityGovernor();
    let t = 0;
    for (let i = 0; i < 10; i++) { t += 600; g.frame(600, t); }
    expect(g.level).toBe(0);
  });
});
