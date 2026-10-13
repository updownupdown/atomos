import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupFileName, makeBackup, readBackup, restoreBackup } from '../src/core/backup';

describe('progress backups', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
  });
  afterEach(() => { store.clear(); delete (globalThis as { localStorage?: unknown }).localStorage; });

  it('carries every atomos key except the screen memory, and restores them exactly', () => {
    store.set('atomos.save.v1', '{"version":1,"built":{"1":{"flawless":true}}}');
    store.set('atomos.wins.v1', '{"merge":[1,2]}');
    store.set('atomos.place', '{"screen":"collect"}');
    store.set('other.app', 'x');
    const b = makeBackup(Date.UTC(2026, 9, 12, 12));
    expect(Object.keys(b.data)).toEqual(['atomos.save.v1', 'atomos.wins.v1']);

    const read = readBackup(JSON.stringify(b));
    expect(read).not.toBeNull();
    store.set('atomos.save.v1', '{"version":1,"built":{}}');
    store.set('atomos.dials.v1', '{"merge":40}');
    restoreBackup(read!);
    expect(store.get('atomos.save.v1')).toContain('"flawless":true');
    expect(store.get('atomos.wins.v1')).toBe('{"merge":[1,2]}');
    expect(store.has('atomos.dials.v1')).toBe(false);
    expect(store.get('atomos.place')).toBe('{"screen":"collect"}');
    expect(store.get('other.app')).toBe('x');
  });

  it('turns away files that are not Atomos backups', () => {
    expect(readBackup('not json')).toBeNull();
    expect(readBackup('{"app":"other","kind":"backup","version":1,"data":{}}')).toBeNull();
    expect(readBackup('{"app":"atomos","kind":"backup","version":1,"data":{"atomos.wins.v1":"{}"}}')).toBeNull();
    const b = readBackup('{"app":"atomos","kind":"backup","version":1,"at":5,"data":{"atomos.save.v1":"{}","evil":"x","atomos.place":"y","atomos.n":3}}');
    expect(b?.data).toEqual({ 'atomos.save.v1': '{}' });
  });

  it('names files by date', () => {
    expect(backupFileName(new Date(2026, 9, 2).getTime())).toBe('atomos-progress-2026-10-02.json');
  });
});
