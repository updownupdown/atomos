import { describe, expect, it } from 'vitest';
import { ELEMENTS, elementAt } from '../src/gallery/data';
import { heatStrip, isotopeKinds, layerReach, orbitalTogether, orbitalTurn } from '../src/gallery/visuals';
import { tabHTML } from '../src/gallery/info';
import { defaultSave } from '../src/core/save';

describe('Structure › Together', () => {
  it('draws every layer, the outer edge on the van der Waals radius', () => {
    for (const e of ELEMENTS) {
      const html = orbitalTogether(e);
      expect(html.match(/class="tg-sub"/g)).toHaveLength(e.subshells.length);
      const reach = layerReach(e);
      expect(Math.max(...reach.map((r) => r.edge))).toBeCloseTo(e.vdw, 6);
    }
  });

  it('keeps inner layers inside outer ones, always to true scale', () => {
    const fe = elementAt(26);
    const reach = layerReach(fe);
    const at = (key: string) => reach[fe.subshells.findIndex((s) => s.key === key)].edge;
    expect(at('1s')).toBeLessThan(at('2p'));
    expect(at('3d')).toBeLessThan(at('4s'));
    // No switch to bend the scale: each layer is drawn at its share of the edge.
    const html = orbitalTogether(fe);
    expect(html).not.toContain('tg-scale');
    const r1s = Number(html.match(/data-i="0"[^>]*data-r="([\d.]+)"/)![1]);
    expect(r1s).toBeCloseTo(at('1s') / fe.vdw, 4);
  });

  it('lays the orbitals out as a box diagram, one line per shell, a box per orbital', () => {
    const fe = elementAt(26);
    const html = orbitalTogether(fe);
    expect(html.match(/class="tg-shell"/g)).toHaveLength(4);
    expect(html.match(/class="tg-box"/g)).toHaveLength(fe.subshells.reduce((n, s) => n + s.capacity / 2, 0));
    // Shell 3 reads s, p, d; 4s sits on its own line.
    const shell3 = html.split('class="tg-shell"')[3];
    expect([...shell3.matchAll(/tg-key">(\w+)</g)].map((m) => m[1])).toEqual(['3s', '3p', '3d']);
    expect(html).not.toContain('data-view="orbitals"');
  });

  it('spreads the p orbitals 120° apart, as seen from a corner of their axes', () => {
    expect([0, 1, 2].map((i) => orbitalTurn(1, i))).toEqual([90, 210, 330]);
  });
});

describe('Isotopes', () => {
  it('sorts each isotope into lasting or fleeting, the Collect words', () => {
    expect(isotopeKinds({ stable: true, halfLife: null } as never)).toContain('lasting');
    expect(isotopeKinds({ stable: false, halfLife: 3.15e7 * 2 } as never)).toContain('lasting');
    expect(isotopeKinds({ stable: false, halfLife: 60 } as never)).toContain('fleeting');
  });

  it('opens on lasting and no longer says unstable or radioactive', () => {
    const html = tabHTML(elementAt(26), 'isotopes', false, defaultSave());
    expect(html).toContain('lasting');
    expect(html).not.toMatch(/Radioactive|unstable/);
  });
});

describe('Properties', () => {
  it('names the state at room temperature on the thermometer', () => {
    expect(heatStrip(elementAt(26))).toContain('Solid at room temperature');
    expect(heatStrip(elementAt(80))).toContain('Liquid at room temperature');
    expect(heatStrip(elementAt(8))).toContain('Gas at room temperature');
  });

  it('links the mapped properties to the Atlas', () => {
    const html = tabHTML(elementAt(26), 'properties', false, defaultSave());
    for (const look of ['melt', 'density', 'electronegativity', 'size', 'crust']) expect(html).toContain(`data-look="${look}"`);
  });
});
