import { describe, expect, it } from 'vitest';
import { DIAL_MAX, dialAngle, dialLines, readDial, resonance, SWEEP, turnDial } from '../src/core/dial';
import { captureLadder, newAtom } from '../src/core/physics';

const H = captureLadder(newAtom(1))!;
const lines = dialLines(H.groundEnergy, H.levels);

describe('dial marks', () => {
  it('puts hydrogen levels at 1 - 1/n² of the ionisation energy', () => {
    expect(lines.map((l) => l.n)).toEqual([2, 3, 4, 5]);
    for (const l of lines) expect(l.v).toBeCloseTo(1 - 1 / (l.n * l.n), 3);
  });

  it('crowds toward the top and never lets bands overlap', () => {
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].v - lines[i - 1].v).toBeLessThan(lines[i - 1].v - (lines[i - 2]?.v ?? 0));
      expect(lines[i].v - lines[i].half).toBeGreaterThan(lines[i - 1].v + lines[i - 1].half);
    }
    expect(lines[lines.length - 1].v + lines[lines.length - 1].half).toBeLessThan(1);
  });
});

describe('reading the dial', () => {
  it('hits a line at its mark and scores to the band edge', () => {
    expect(readDial(lines[1].v, lines)).toEqual({ kind: 'level', n: 3, precision: 1 });
    const r = readDial(lines[1].v + lines[1].half * 0.5, lines);
    expect(r.kind === 'level' && r.precision).toBeCloseTo(0.5);
  });

  it('passes through between lines and frees the electron past 1', () => {
    expect(readDial((lines[0].v + lines[1].v) / 2, lines)).toEqual({ kind: 'between', below: 2, above: 3 });
    expect(readDial(0.3, lines)).toEqual({ kind: 'between', below: null, above: 2 });
    expect(readDial(1.0, lines)).toEqual({ kind: 'free' });
    expect(readDial(0, lines)).toEqual({ kind: 'none' });
  });

  it('feels resonance before the band and fully on the line', () => {
    expect(resonance(lines[0].v, lines)).toBe(1);
    expect(resonance(lines[0].v + lines[0].half * 2, lines)).toBeGreaterThan(0);
    expect(resonance(0.3, lines)).toBe(0);
  });
});

describe('turning the dial', () => {
  it('covers the full range in one sweep at the dial radius, half of it at twice the radius', () => {
    expect(turnDial(0, SWEEP, 100, 100)).toBeCloseTo(DIAL_MAX);
    expect(turnDial(0, SWEEP, 200, 100)).toBeCloseTo(DIAL_MAX / 2);
    expect(turnDial(0.5, -SWEEP, 100, 100)).toBe(0);
  });

  it('maps the needle across the sweep', () => {
    expect(dialAngle(DIAL_MAX) - dialAngle(0)).toBeCloseTo(SWEEP);
  });
});
