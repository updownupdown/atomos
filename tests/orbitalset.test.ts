import { describe, expect, it } from 'vitest';
import { elementAt } from '../src/gallery/data';
import { OrbitalSetBuilder } from '../src/render/orbitalCloud';

const positions = (b: OrbitalSetBuilder) => b.set!.geometry.getAttribute('position').array as Float32Array;

describe('orbital sets sampled a slice at a time', () => {
  it('gives the same points however the work is sliced', () => {
    const e = elementAt(8);
    const whole = new OrbitalSetBuilder(e, 2000, 20_000);
    expect(whole.step(Infinity)).toBe(true);
    const sliced = new OrbitalSetBuilder(e, 2000, 20_000);
    let steps = 0;
    while (!sliced.step(0)) steps++;
    expect(steps).toBeGreaterThan(10);
    expect(sliced.set!.total).toBe(whole.set!.total);
    expect(positions(sliced)).toEqual(positions(whole));
  });

  it('fills every orbital at the same pace, so a part-filled cloud is a fair thinning', () => {
    const b = new OrbitalSetBuilder(elementAt(26), 3000, 40_000);
    while (!b.set) b.step(0);
    b.step(0);
    const set = b.set!;
    expect(set.complete).toBe(false);
    const shares = set.orbitals.map((o) => set.filled[o.index] / o.count);
    for (const s of shares) {
      expect(s).toBeGreaterThan(0);
      expect(Math.abs(s - shares[0])).toBeLessThan(0.02);
    }
    while (!b.step(0)) { /* fill */ }
    expect(set.orbitals.every((o) => set.filled[o.index] === o.count)).toBe(true);
  });

  it('keeps every orbital of iron apart: five 3d clouds, not one shell', () => {
    const b = new OrbitalSetBuilder(elementAt(26), 1000, 20_000);
    b.step(Infinity);
    const keys = b.set!.orbitals.map((o) => o.key);
    expect(keys.filter((k) => k === '3d')).toHaveLength(5);
    expect(keys.filter((k) => k === '2p')).toHaveLength(3);
    expect(b.set!.orbitals.reduce((n, o) => n + o.electrons, 0)).toBe(26);
  });
});
