import { describe, expect, it } from 'vitest';
import { ELEMENTS, elementAt } from '../src/gallery/data';
import { TABS, elementFacts, elementImage, tabHTML } from '../src/gallery/info';
import { buildOrder, lifeMeter, orbitalAssembly, orbitalFill, rankOf } from '../src/gallery/visuals';

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

  it('assembles iron from the nucleus up: nucleus, argon core, 4s, then 3d', () => {
    const html = orbitalAssembly(elementAt(26));
    const steps = [...html.matchAll(/<span class="oa-step">(\d*)<\/span>/g)].map((m) => m[1]).filter(Boolean);
    expect(steps).toEqual(['4', '3', '2', '1']);
    expect(html.indexOf('3d')).toBeLessThan(html.indexOf('4s'));
    expect(html).toContain('Argon core');
    // One drawn orbital per orbital: 4s (1) and 3d (5) outside the core, and the core's 9 under Details.
    expect(html.match(/class="os-glyph/g)?.length).toBe(15);
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

describe('element photos', () => {
  const OPEN = /^(CC BY(-SA)? [23]\.0( DE)?|FAL|Public domain|Free use with attribution \(LANL\))$/;
  it('credit an author and an openly licensed, commercial-use licence', () => {
    let n = 0;
    for (const e of ELEMENTS) {
      const img = elementImage(e.z);
      if (!img) continue;
      n++;
      expect(img.author, e.symbol).toBeTruthy();
      expect(img.licence, e.symbol).toMatch(OPEN);
      expect(img.file, e.symbol).toMatch(/\.(jpe?g|png|gif|tiff?|svg)$/i);
    }
    expect(n).toBeGreaterThan(80);
  });
});
