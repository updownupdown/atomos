import { describe, expect, it } from 'vitest';
import { chord, cross, deduce, neighbors, newRutherford, probe, remaining, scope, solved, specFor, toggleMark, type RutherfordState } from '../src/puzzles/rutherford';

const SPREAD = [1, 6, 20, 21, 50, 51, 79, 85, 86, 92, 118];

/** A hand-made plate: nuclei and kinds given, clues computed. */
function plate(size: number, nuclei: number[], kinds: Record<number, 'scatter' | 'quiet'> = {}): RutherfordState {
  const n = size * size;
  const nuc = Array.from({ length: n }, (_, i) => nuclei.includes(i));
  const kind = Array.from({ length: n }, (_, i) => kinds[i] ?? 'plain');
  const base = { size, kind };
  return {
    size, nuclei: nuc, kind,
    clue: nuc.map((_, i) => scope(base, i).filter((j) => nuc[j]).length),
    probed: Array(n).fill(false), marked: Array(n).fill(false),
    hits: 0, moves: 0, total: nuclei.length,
  };
}

describe('geometry', () => {
  it('counts the eight neighbors, fewer at the rim', () => {
    expect(neighbors(5, 12)).toHaveLength(8);
    expect(neighbors(5, 0).sort((a, b) => a - b)).toEqual([1, 5, 6]);
  });

  it('a scatter cell covers its whole row and column', () => {
    const c = cross(5, 7).sort((a, b) => a - b);
    expect(c).toEqual([2, 5, 6, 8, 9, 12, 17, 22]);
  });
});

describe('probing', () => {
  it('reports counts, opens zeros and scores a direct hit without ending play', () => {
    // 4x4, one nucleus in the far corner.
    const s = plate(4, [15]);
    const t = probe(s, 0)!;
    expect(t.moves).toBe(1);
    // The zero cascade opens every safe cell.
    expect(solved(t)).toBe(true);
    expect(t.hits).toBe(0);
    const h = probe(s, 15)!;
    expect(h.hits).toBe(1);
    expect(h.probed[15]).toBe(true);
    expect(solved(h)).toBe(false);
    expect(probe(h, 15)).toBeNull();
  });

  it('scatter cells count along the row and column; quiet cells stop a cascade', () => {
    const s = plate(4, [3, 12], { 0: 'scatter', 5: 'quiet' });
    expect(s.clue[0]).toBe(2);
    const t = probe(s, 5)!;
    expect(t.probed.filter(Boolean)).toHaveLength(1);
  });

  it('marks block probing, count down the remaining nuclei and power a chord', () => {
    const s = plate(3, [0]);
    const m = toggleMark(s, 0)!;
    expect(remaining(m)).toBe(0);
    expect(probe(m, 0)).toBeNull();
    const p = probe(m, 4)!; // center: count 1
    expect(p.clue[4]).toBe(1);
    const c = chord(p, 4)!;
    expect(solved(c)).toBe(true);
    expect(c.hits).toBe(0);
    // A chord whose marks do not meet the count does nothing.
    expect(chord(probe(s, 4)!, 4)).toBeNull();
  });
});

describe('levels', () => {
  it('is the same plate for the same seed', () => {
    expect(newRutherford(30, 4)).toEqual(newRutherford(30, 4));
  });

  it('sizes the plate and the nuclei by element', () => {
    expect(specFor(1).size).toBe(7);
    expect(specFor(50).size).toBe(8);
    expect(specFor(85).size).toBe(9);
    expect(specFor(118).size).toBe(10);
    for (const z of SPREAD) {
      const sp = specFor(z);
      const d = sp.nuclei / (sp.size * sp.size);
      expect(d).toBeGreaterThanOrEqual(0.14);
      expect(d).toBeLessThanOrEqual(0.21);
    }
  });

  it('opens with a safe region and can be finished without guessing', () => {
    for (const z of SPREAD) {
      for (let seed = 1; seed <= 8; seed++) {
        const s = newRutherford(z, seed);
        expect(s.nuclei.filter(Boolean)).toHaveLength(s.total);
        expect(s.hits).toBe(0);
        expect(s.probed.some(Boolean)).toBe(true);
        expect(s.probed.every((p, i) => !p || !s.nuclei[i])).toBe(true);
        expect(solved(s)).toBe(false);
        const end = deduce(s).state;
        expect(solved(end)).toBe(true);
        expect(end.hits).toBe(0);
      }
    }
  });

  it('has both twists on the plate', () => {
    let scatter = 0, quiet = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = newRutherford(100, seed);
      scatter += s.kind.filter((k) => k === 'scatter').length;
      quiet += s.kind.filter((k) => k === 'quiet').length;
    }
    expect(scatter).toBeGreaterThan(0);
    expect(quiet).toBeGreaterThan(0);
  });

  it('generates fast for every element', () => {
    for (let z = 1; z <= 118; z++) {
      const t = performance.now();
      newRutherford(z, z * 7 + 3);
      expect(performance.now() - t).toBeLessThan(150);
    }
  });
});
