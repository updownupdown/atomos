import { describe, expect, it } from 'vitest';
import { captureBands, CENTRE, DEAD_ZONE, FREE, readPull } from '../src/core/tuning';
import { captureLadder, newAtom, reachableLines } from '../src/core/physics';

describe('capture bands', () => {
  const bands = captureBands([2, 3, 4, 5]);

  it('narrows for higher levels and never overlaps', () => {
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].hi - bands[i].lo).toBeLessThan(bands[i - 1].hi - bands[i - 1].lo);
      expect(bands[i].lo).toBeGreaterThan(bands[i - 1].hi);
    }
    expect(bands[0].lo).toBeGreaterThan(DEAD_ZONE);
    expect(bands[bands.length - 1].hi).toBeLessThan(FREE);
  });

  it('reads a release at each band centre as a clean capture', () => {
    for (const b of bands) expect(readPull(b.centre, bands)).toEqual({ kind: 'level', n: b.n, precision: 1 });
  });

  it('misses between bands and knocks out past the top', () => {
    const gap = (bands[0].hi + bands[1].lo) / 2;
    expect(readPull(gap, bands)).toEqual({ kind: 'between', below: 2, above: 3 });
    expect(readPull(DEAD_ZONE + 0.001, bands)).toEqual({ kind: 'between', below: null, above: 2 });
    expect(readPull(0.95, bands)).toEqual({ kind: 'free' });
    expect(readPull(0.05, bands)).toEqual({ kind: 'none' });
  });

  it('leaves most of the pull range uncaught, so careless releases mostly miss', () => {
    const caught = bands.reduce((s, b) => s + (b.hi - b.lo), 0);
    expect(caught / (1 - DEAD_ZONE)).toBeLessThan(0.4);
  });

  it('scores precision from centre to edge', () => {
    const b = bands[1];
    const r = readPull(b.centre + (b.hi - b.centre) * 0.5, bands);
    expect(r.kind === 'level' && r.precision).toBeCloseTo(0.5);
    expect(CENTRE).toBeGreaterThan(0);
  });
});

describe('collectable light', () => {
  it('offers four capture levels above the orbital being filled', () => {
    expect(captureLadder(newAtom(1))!.levels.map((l) => l.n)).toEqual([2, 3, 4, 5]);
  });

  it('includes the red Balmer-alpha and Lyman-alpha lines', () => {
    const lines = reachableLines(1);
    expect(lines).toContain(656.1);
    expect(lines).toContain(121.6);
    expect(lines.length).toBe(4);
  });
});
