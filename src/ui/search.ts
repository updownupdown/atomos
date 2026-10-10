// Finding elements by name, symbol or number, shared by the picker and the element list.

import { ELEMENTS, type Element } from '../gallery/data';

/** Elements whose name, symbol or number matches the query, best matches first. */
export function searchElements(query: string): Element[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const z = Number(q);
    return ELEMENTS.filter((e) => e.z === z || String(e.z).startsWith(q)).sort((a, b) => (a.z === z ? -1 : b.z === z ? 1 : a.z - b.z));
  }
  const score = (e: Element) => {
    const name = e.name.toLowerCase();
    const sym = e.symbol.toLowerCase();
    if (sym === q) return 0;
    if (name === q) return 1;
    if (name.startsWith(q)) return 2;
    if (sym.startsWith(q)) return 3;
    if (name.includes(q)) return 4;
    return 9;
  };
  return ELEMENTS.map((e) => [score(e), e] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].z - b[1].z).map(([, e]) => e);
}
