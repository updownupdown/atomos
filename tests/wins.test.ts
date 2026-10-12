import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lastDial, recordWin, rememberDial, winsOf } from '../src/core/wins';

describe('Puzzles tallies and remembered dials', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
  });
  afterEach(() => { store.clear(); delete (globalThis as { localStorage?: unknown }).localStorage; });

  it('remembers the dial each game was last played or picked at', () => {
    expect(lastDial('merge')).toBeNull();
    rememberDial('merge', 63.4);
    rememberDial('packing', 12);
    expect(lastDial('merge')).toBe(63);
    expect(lastDial('packing')).toBe(12);
    rememberDial('merge', 80);
    expect(lastDial('merge')).toBe(80);
  });

  it('reads a damaged store as nothing remembered', () => {
    store.set('atomos.dials.v1', '{not json');
    expect(lastDial('merge')).toBeNull();
    store.set('atomos.dials.v1', JSON.stringify({ merge: 'hard', packing: 400 }));
    expect(lastDial('merge')).toBeNull();
    expect(lastDial('packing')).toBe(100);
  });

  it('counts wins in the level of their dial', () => {
    recordWin('merge', 63, true);
    recordWin('merge', 70, false);
    const w = winsOf('merge');
    expect(w[3]).toEqual({ solved: 2, flawless: 1 });
    expect(w[0]).toEqual({ solved: 0, flawless: 0 });
  });
});
