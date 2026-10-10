import { describe, expect, it } from 'vitest';
import { AtomView, fillOrder } from '../src/gallery/atom';
import { elementAt } from '../src/gallery/data';

type Layer = { vivid: number; vividTo: number };
const layers = (v: AtomView) => (v as unknown as { layers: Map<string, Layer> }).layers;

describe('pale until built', () => {
  it('orders subshells as electrons fill them', () => {
    expect(fillOrder(elementAt(26))).toEqual(['1s', '2s', '2p', '3s', '3p', '4s', '3d']);
  });

  it('lights electrons subshell by subshell, a partial one blended', () => {
    const v = new AtomView({ perSlot: 2, shapes: false, pointSize: 1 });
    v.setElement(elementAt(26), false);
    v.setLit({ nucleus: false, electrons: 13 });
    const l = layers(v);
    expect(l.get('2p')!.vivid).toBe(1);
    expect(l.get('3s')!.vivid).toBe(1);
    expect(l.get('3p')!.vivid).toBeCloseTo(1 / 6);
    expect(l.get('3d')!.vivid).toBe(0);
  });

  it('eases toward the new state when animated', () => {
    const v = new AtomView({ perSlot: 2, shapes: false, pointSize: 1 });
    v.setElement(elementAt(3), false);
    v.setLit({ nucleus: false, electrons: 0 });
    v.setLit({ nucleus: true, electrons: 3 }, true);
    expect(layers(v).get('2s')!.vivid).toBe(0);
    v.update(0.2);
    expect(layers(v).get('2s')!.vivid).toBeCloseTo(0.5);
    v.update(0.3);
    expect(layers(v).get('2s')!.vivid).toBe(1);
  });
});
