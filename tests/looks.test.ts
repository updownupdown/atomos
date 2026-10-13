import { describe, expect, it } from 'vitest';
import { elementAt, ELEMENTS } from '../src/gallery/data';
import { inkOn, lookColor, lookOf, LOOKS } from '../src/gallery/looks';
import { placeColour } from '../src/gallery/data';

const state = (z: number) => lookOf('state').value!(elementAt(z));

describe('gallery looks', () => {
  it('start with Place and give every element a fill under every look', () => {
    expect(LOOKS[0].id).toBe('place');
    expect(lookColor('place', elementAt(26))).toBe(placeColour(elementAt(26)));
    for (const l of LOOKS) for (const e of ELEMENTS) expect(lookColor(l.id, e), `${l.id} ${e.z}`).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('write dark text on pale fills and white on deep ones', () => {
    expect(inkOn('#e4e8ea')).toBe('#0b0c0d');
    expect(inkOn('#24407a')).toBe('#ffffff');
  });

  it('name the state at room temperature correctly', () => {
    expect(state(80)).toEqual({ cat: 'liquid' }); // mercury
    expect(state(35)).toEqual({ cat: 'liquid' }); // bromine
    expect(state(2)).toEqual({ cat: 'gas' }); // helium has no melting point
    expect(state(6)).toEqual({ cat: 'solid' }); // carbon has no melting point either
    expect(state(15)).toEqual({ cat: 'solid' });
    expect(state(26)).toEqual({ cat: 'solid' });
    expect(state(36)).toEqual({ cat: 'gas' });
  });

  it('keep every shade between 0 and 1, and predictions out of density', () => {
    for (const l of LOOKS) {
      if (!l.value) continue;
      for (const e of ELEMENTS) {
        const r = l.value(e);
        if (r && 'v' in r) { expect(r.v).toBeGreaterThanOrEqual(0); expect(r.v).toBeLessThanOrEqual(1); }
      }
    }
    expect(lookOf('density').value!(elementAt(108))).toBeNull();
  });
});
