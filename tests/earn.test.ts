import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe('unlockToasts', () => {
  it('gives one toast per kind, naming the first and counting the rest', async () => {
    const { earnables, unlockToasts } = await import('../src/gallery/earn');
    const all = earnables();
    const shapes = all.filter((e) => e.kind === 'shape').slice(0, 3).map((e) => e.id as string);
    const colors = all.filter((e) => e.kind === 'color').slice(0, 2).map((e) => e.id as string);
    const toy = all.find((e) => e.kind === 'toy')!.id as string;
    const first = all.find((e) => e.id === shapes[0])!.label;
    const color = all.find((e) => e.id === colors[0])!.label;
    expect(unlockToasts([...shapes, ...colors, toy, 'nucleus-view'])).toEqual([
      `${first} and 2 more shapes unlocked in the Atlas`,
      `${color} colors and 1 more color unlocked in the Atlas`,
      'Time-lapse and 1 more view unlocked in the Atlas',
    ]);
  });

  it('keeps the single wording when only one of a kind opened', async () => {
    const { earnables, unlockToasts } = await import('../src/gallery/earn');
    const shape = earnables().find((e) => e.kind === 'shape')!;
    expect(unlockToasts([shape.id, 'nucleus-view'])).toEqual([`${shape.label} is open in the Atlas`, 'The nucleus view is open']);
  });
});
