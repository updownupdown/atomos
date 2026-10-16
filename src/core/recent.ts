// The atoms and games opened most recently on this device, newest first, for Search's list before
// anything is typed. Kept apart from the save: losing it only empties that list.

const KEY = 'atomos.recent.v1';
const KEEP = 6;

export type Recent = { kind: 'atom'; z: number } | { kind: 'game'; id: string };

const same = (a: Recent, b: Recent) => (a.kind === 'atom' ? b.kind === 'atom' && a.z === b.z : b.kind === 'game' && a.id === b.id);

/** The list, newest first; empty when nothing was opened or storage is off. */
export function recentItems(): Recent[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(v)) return [];
    return v.filter((r): r is Recent => Boolean(r) && ((r.kind === 'atom' && Number.isInteger(r.z)) || (r.kind === 'game' && typeof r.id === 'string')));
  } catch {
    return [];
  }
}

/** Puts an atom or game at the front of the list. */
export function noteRecent(item: Recent): void {
  const list = [item, ...recentItems().filter((r) => !same(r, item))].slice(0, KEEP);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage off: no recents */ }
}
