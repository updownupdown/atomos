import { describe, expect, it } from 'vitest';
import { ICONS } from '../src/ui/icons.gen';
import { icon, ICON_NAMES } from '../src/ui/icons';

describe('icon library', () => {
  it('has one icon per SVG in src/icons (run `npm run icons` if this fails)', () => {
    const files = Object.keys(import.meta.glob('../src/icons/*.svg')).map((p) => p.split('/').pop()!.slice(0, -4)).sort();
    expect(ICON_NAMES.slice().sort()).toEqual(files);
  });

  it('draws every icon in currentColor on a 24×24 box', () => {
    for (const [name, svg] of Object.entries(ICONS)) {
      expect(svg, name).toMatch(/^<svg viewBox="0 0 24 24"/);
      expect(svg, name).not.toMatch(/(fill|stroke)="(black|#000(000)?)"/i);
    }
  });

  it('renders size, class and accessibility attributes', () => {
    expect(icon('close')).toMatch(/^<svg class="icon icon-close" width="24" height="24" aria-hidden="true"/);
    expect(icon('info', { size: 20, label: 'Instructions', className: 'x' })).toMatch(/class="icon icon-info x" width="20" height="20" role="img" aria-label="Instructions"/);
  });
});
