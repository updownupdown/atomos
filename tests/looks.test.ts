import { describe, expect, it } from 'vitest';
import { elementAt, ELEMENTS } from '../src/gallery/data';
import { lensUnlock, lookOf, lookUnlock, LOOKS } from '../src/gallery/looks';

const state = (z: number) => lookOf('state').value!(elementAt(z));

describe('gallery looks', () => {
  it('are Block plus the six that Glyph opens', () => {
    expect(LOOKS.filter((l) => lookUnlock(l.id))).toHaveLength(6);
    expect(lookUnlock('block')).toBeNull();
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

  it('open Spiral and Table from the start; Lumen opens the rest', () => {
    expect(lensUnlock('spiral')).toBeNull();
    expect(lensUnlock('table')).toBeNull();
    expect(lensUnlock('ribbon')).toBe('lens:ribbon');
    expect(lensUnlock('circle')).toBe('lens:circle');
  });
});
