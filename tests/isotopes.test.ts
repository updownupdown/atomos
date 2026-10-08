import { describe, expect, it } from 'vitest';
import { decayProducts, findIsotope, formatDuration, ISOTOPES, isFleeting, sampleLifetime } from '../src/core/isotopes';

describe('isotopes', () => {
  it('has unique entries', () => {
    const keys = ISOTOPES.map((i) => `${i.z}-${i.a}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every unstable isotope a decay mode', () => {
    for (const i of ISOTOPES) expect(i.halfLife === undefined || i.mode !== undefined).toBe(true);
  });

  it('computes decay products', () => {
    expect(decayProducts(findIsotope(6, 14)!)?.daughter).toEqual({ z: 7, a: 14 });
    expect(decayProducts(findIsotope(4, 8)!)?.daughter).toEqual({ z: 2, a: 4 });
    expect(decayProducts(findIsotope(3, 4)!)?.daughter).toEqual({ z: 2, a: 3 });
    expect(decayProducts(findIsotope(9, 18)!)?.daughter).toEqual({ z: 8, a: 18 });
  });

  it('classifies fleeting isotopes', () => {
    expect(isFleeting(findIsotope(2, 6)!)).toBe(true);
    expect(isFleeting(findIsotope(6, 10)!)).toBe(false);
    expect(isFleeting(findIsotope(6, 12)!)).toBe(false);
  });

  it('samples lifetimes whose median is the half-life', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const samples = Array.from({ length: 20001 }, () => sampleLifetime(10, rand)).sort((a, b) => a - b);
    expect(samples[10000]).toBeGreaterThan(9.5);
    expect(samples[10000]).toBeLessThan(10.5);
  });

  it('formats durations across scales', () => {
    expect(formatDuration(7e-22)).toBe('7.0×10⁻²² s');
    expect(formatDuration(0.807)).toBe('807 ms');
    expect(formatDuration(122.2)).toBe('2.04 minutes');
    expect(formatDuration(5700 * 365.25 * 86400)).toBe('5,700 years');
  });
});
