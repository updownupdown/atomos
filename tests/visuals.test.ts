import { describe, expect, it } from 'vitest';
import { ELEMENTS, elementAt } from '../src/gallery/data';
import { TABS, elementFacts, tabHTML } from '../src/gallery/info';
import { buildOrder, lifeMeter, orbitalFill, rankOf } from '../src/gallery/visuals';

describe('science sheet visuals', () => {
  it('fills orbitals singly before pairing (Hund)', () => {
    expect(orbitalFill(6, 10)).toEqual([2, 1, 1, 1, 1]);
    expect(orbitalFill(3, 6)).toEqual([1, 1, 1]);
    expect(orbitalFill(0, 2)).toEqual([0]);
    expect(orbitalFill(14, 14)).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it('builds 4s before 3d', () => {
    expect(buildOrder(elementAt(26)).map((s) => s.key)).toEqual(['1s', '2s', '2p', '3s', '3p', '4s', '3d']);
  });

  it('ranks and scales sensibly', () => {
    expect(rankOf(5, [1, 5, 9])).toBe(2);
    expect(lifeMeter(null)).toBe(0);
    expect(lifeMeter(1e30)).toBe(1);
  });

  it('renders every tab for every element without NaN or undefined', () => {
    for (const e of ELEMENTS) for (const t of TABS) {
      const html = tabHTML(e, t.id, false);
      expect(html, `${e.symbol} ${t.id}`).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it('has a headline and facts for every element', () => {
    for (const e of ELEMENTS) {
      const f = elementFacts(e.z);
      expect(f?.h, e.symbol).toBeTruthy();
      expect(f!.f.length, e.symbol).toBeGreaterThan(1);
    }
  });
});
