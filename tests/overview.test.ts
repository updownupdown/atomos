import { describe, expect, it } from 'vitest';
import { overlap, tabHTML, unrepeated } from '../src/gallery/info';
import { ELEMENTS } from '../src/gallery/data';
import { defaultSave } from '../src/core/save';

describe('Overview (with the old Story tab folded in)', () => {
  it('drops lines that repeat a fact shown above them', () => {
    const facts = ['Steel, iron alloyed with a little carbon, is the most widely used metal in the world.'];
    const [uses] = unrepeated(facts, [[
      'Steel, iron alloyed with a little carbon, is the most used metal, forming buildings, bridges, cars, ships and machinery.',
      'Cast iron is used for engine blocks, pipes and cookware.',
    ]]);
    expect(uses).toEqual(['Cast iron is used for engine blocks, pipes and cookware.']);
  });

  it('never shows the same fact twice on any element', () => {
    for (const e of ELEMENTS) {
      const html = tabHTML(e, 'overview', false, defaultSave());
      const lines = [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
      for (let i = 0; i < lines.length; i++) {
        for (let j = 0; j < i; j++) expect(overlap(lines[i], lines[j]), `${e.symbol}: "${lines[j]}" / "${lines[i]}"`).toBeLessThan(0.5);
      }
    }
  });

  it('keeps discovery, origins and uses on the page', () => {
    const fe = ELEMENTS.find((e) => e.z === 26)!;
    const html = tabHTML(fe, 'overview', false, defaultSave());
    expect(html).toContain('Discovered');
    expect(html).toContain('Origins');
    expect(html).toContain('Cast iron');
    expect(html.match(/Steel, iron alloyed/g)).toHaveLength(1);
  });
});
