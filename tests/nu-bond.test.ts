import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const DAY = 24 * 3600_000;

describe("Nu's bond", () => {
  it('warms up with play and cools over days', async () => {
    const b = await import('../src/nu/bond');
    const t = 1_000_000_000_000;
    expect(b.warmUp(0.6, t)).toBeCloseTo(0.6);
    expect(b.warmUp(0.6, t)).toBe(1);
    expect(b.warmth(t + 1.5 * DAY)).toBeCloseTo(0.5, 2);
  });

  it('naps after a few days away, until woken', async () => {
    const b = await import('../src/nu/bond');
    const t = 1_000_000_000_000;
    expect(b.arrive(t)).toBe(false);
    expect(b.arrive(t + DAY)).toBe(false);
    expect(b.arrive(t + 5 * DAY)).toBe(true);
    expect(b.napping()).toBe(true);
    expect(b.wake()).toBe(true);
    expect(b.napping()).toBe(false);
  });

  it('keeps treats from wins, up to a cap', async () => {
    const b = await import('../src/nu/bond');
    for (let i = 0; i < 20; i++) b.addTreat();
    expect(b.treats()).toBe(b.MAX_TREATS);
    b.eatTreat();
    expect(b.treats()).toBe(b.MAX_TREATS - 1);
  });

  it('hides a few times a day until found', async () => {
    const b = await import('../src/nu/bond');
    const day = new Date(2026, 9, 15, 12);
    for (let i = 0; i < b.HIDES_A_DAY; i++) { expect(b.hideDue(day)).toBe(true); b.hideTried(day); }
    expect(b.hideDue(day)).toBe(false);
    const next = new Date(2026, 9, 16, 9);
    expect(b.hideDue(next)).toBe(true);
    b.hideTried(next);
    expect(b.found(next)).toBe(1);
    expect(b.hideDue(next)).toBe(false);
    expect(b.foundToday(next)).toBe(true);
  });

  it('gives each finished period its toy once', async () => {
    const b = await import('../src/nu/bond');
    b.giveToy(1);
    b.giveToy(1);
    expect(b.toysSeen()).toEqual([1]);
  });
});
