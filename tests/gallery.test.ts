import { describe, expect, it } from 'vitest';
import { ELEMENTS, MAX_Z, elementAt, formatHalfLife, shortConfiguration } from '../src/gallery/data';
import { LAYOUTS, layout } from '../src/gallery/layouts';
import { fadeSeconds } from '../src/gallery/info';
import { harmonic, orbitalSurface, radial, radialTable, sampleSubshell } from '../src/gallery/orbital';

describe('element dataset', () => {
  it('has all 118 elements in order with electrons summing to Z', () => {
    expect(MAX_Z).toBe(118);
    for (const e of ELEMENTS) {
      expect(e.subshells.reduce((a, s) => a + s.count, 0)).toBe(e.z);
      for (const s of e.subshells) expect(s.count).toBeLessThanOrEqual(s.capacity);
      expect(e.vdw).toBeGreaterThan(0);
    }
  });
  it('marks the noble-gas core and writes the short configuration', () => {
    expect(shortConfiguration(elementAt(26))).toBe('[Ar] 3d⁶ 4s²');
    expect(shortConfiguration(elementAt(1))).toBe('1s¹');
    expect(elementAt(79).core).toBe('Xe');
    expect(elementAt(10).core).toBe('He');
    expect(elementAt(2).core).toBeNull();
  });
  it('uses van der Waals radii, so caesium is larger than radon', () => {
    expect(elementAt(55).vdw).toBeGreaterThan(elementAt(86).vdw);
    expect(elementAt(1).vdw).toBe(110);
    expect(elementAt(87).vdw).toBe(348);
  });
  it('counts 250 observationally stable isotopes and finds the key isotope', () => {
    expect(ELEMENTS.reduce((a, e) => a + e.stableIsotopes, 0)).toBe(250);
    expect(elementAt(26).commonA).toBe(56);
    expect(elementAt(92).commonA).toBe(238);
    expect(elementAt(43).stableIsotopes).toBe(0);
  });
  it('formats half-lives', () => {
    expect(formatHalfLife(null)).toBe('stable');
    expect(formatHalfLife(0.00069)).toBe('690 µs');
    expect(formatHalfLife(1.4e17)).toBe('4.44 billion y');
  });
});

describe('Atlas maps', () => {
  const all = LAYOUTS.flatMap(({ id }) => (['portrait', 'landscape'] as const).map((o) => ({ id, o, l: layout(id, o) })));
  it('draw every element once', () => {
    for (const { id, o, l } of all) {
      expect(l.cells, `${id} ${o}`).toHaveLength(118);
      expect(new Set(l.cells.map((c) => c.z)).size, `${id} ${o}`).toBe(118);
      for (const c of l.cells) expect(c.d.startsWith('M') && c.d.endsWith('Z'), `${id} ${c.z}`).toBe(true);
    }
  });
  it('keep cells apart', () => {
    for (const { id, o, l } of all) {
      const a = l.cells;
      let min = Infinity;
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) min = Math.min(min, Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y));
      expect(min, `${id} ${o}`).toBeGreaterThan(0.8);
    }
  });
  it('stand the table up on a portrait screen and lay it flat in landscape', () => {
    const at = (l: ReturnType<typeof layout>, z: number) => l.cells.find((c) => c.z === z)!;
    const up = layout('table', 'portrait'), flat = layout('table', 'landscape');
    // Helium over neon: one row standing (periods across), one column flat.
    expect(at(up, 2).y).toBeCloseTo(at(up, 10).y);
    expect(at(up, 2).x).toBeLessThan(at(up, 10).x);
    expect(at(flat, 2).x).toBeCloseTo(at(flat, 10).x);
    expect(at(flat, 2).y).toBeLessThan(at(flat, 10).y);
  });
  it('line groups up along spokes in the circle and across the ribbon', () => {
    for (const id of ['circle', 'ribbon'] as const) {
      const l = layout(id, 'landscape');
      const ang = (z: number) => { const c = l.cells.find((x) => x.z === z)!; return Math.atan2(c.y, c.x); };
      // Lithium, sodium and potassium share a direction from the center.
      expect(Math.abs(ang(3) - ang(11)), id).toBeLessThan(0.05);
      expect(Math.abs(ang(3) - ang(19)), id).toBeLessThan(0.05);
    }
  });
});

describe('orbitals', () => {
  it('radial functions have n - l - 1 nodes', () => {
    const nodes = (n: number, l: number) => {
      let count = 0;
      let prev = radial(n, l, 0.01);
      for (let x = 0.02; x < 80; x += 0.01) {
        const v = radial(n, l, x);
        if (Math.sign(v) !== Math.sign(prev) && v !== 0) count++;
        prev = v;
      }
      return count;
    };
    expect(nodes(1, 0)).toBe(0);
    expect(nodes(2, 0)).toBe(1);
    expect(nodes(3, 1)).toBe(1);
    expect(nodes(4, 3)).toBe(0);
    expect(nodes(5, 0)).toBe(4);
  });
  it('mean radius grows with n, as (3/2) n^2 for s orbitals', () => {
    expect(radialTable(1, 0).mean).toBeCloseTo(1.5, 1);
    expect(radialTable(2, 0).mean).toBeCloseTo(6, 0);
    expect(radialTable(3, 0).mean).toBeLessThan(radialTable(4, 0).mean);
  });
  it('samples a p orbital along its axis', () => {
    const c = sampleSubshell(2, 'p', 200);
    expect(c.positions.length).toBe(6 * 200 * 3);
    // Slot 0 fills pz, which the renderer draws along screen y.
    let along = 0, across = 0;
    for (let i = 0; i < 200; i++) {
      const x = c.positions[i * 3], y = c.positions[i * 3 + 1], z = c.positions[i * 3 + 2];
      along += y * y;
      across += x * x + z * z;
    }
    expect(along).toBeGreaterThan(across);
    expect(harmonic(1, 0, 0, 0, 1)).toBe(1);
  });
  it('keeps a body sample inside the drawn edge', () => {
    const edge = radialTable(3, 2).edge;
    const c = sampleSubshell(3, 'd', 100, 3, 0.85);
    for (let i = 0; i < c.positions.length; i += 3) {
      expect(Math.hypot(c.positions[i], c.positions[i + 1], c.positions[i + 2])).toBeLessThanOrEqual(edge * 1.001);
    }
  });
  it('fades a tapped isotope by its half-life, a step per power of ten', () => {
    expect(fadeSeconds(1e-6)).toBe(0.25);
    expect(fadeSeconds(1)).toBe(3);
    expect(fadeSeconds(3600)).toBeGreaterThan(fadeSeconds(60));
    expect(fadeSeconds(1e20)).toBe(30);
  });
  it('builds closed surfaces for every orbital kind', () => {
    for (const [block, count] of [['s', 1], ['p', 3], ['d', 5], ['f', 7]] as const) {
      for (let oi = 0; oi < count; oi++) {
        const s = orbitalSurface(block, oi, 16, 12);
        expect(s.index.length).toBe(16 * 12 * 6);
        expect(Math.max(...s.index)).toBeLessThan(s.positions.length / 3);
      }
    }
  });
});
