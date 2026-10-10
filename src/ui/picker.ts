// The element picker: a periodic table in a drawer, with the lanthanides and actinides on
// their own rows so the table stacks neatly on a phone, and a search box for names, symbols
// and numbers. The cells are small, so pressing and sliding across the table shows the
// element under the finger in a large readout; letting go picks it.

import { ELEMENTS, BLOCK_COLOUR, type Element } from '../gallery/data';
import { openDrawer, type Drawer } from './components';
import './picker.css';

export interface PickerOptions {
  /** The element on screen now; it is marked in the table. */
  current?: number;
  /** Elements to draw dimmed (not yet collected). They can still be picked. */
  locked?: (z: number) => boolean;
}

/** Row and column (both 1-based) of an element in the 18-column table with the f block
 *  split out: rows 1-7 are the periods, row 9 the lanthanides, row 10 the actinides. */
export function tableCell(e: Element): { row: number; col: number } {
  if (e.z >= 57 && e.z <= 71) return { row: 9, col: 3 + (e.z - 57) };
  if (e.z >= 89 && e.z <= 103) return { row: 10, col: 3 + (e.z - 89) };
  return { row: e.period, col: e.group ?? 3 };
}

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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Opens the picker. `onPick` gets the chosen atomic number, after the drawer starts closing. */
export function openElementPicker(onPick: (z: number) => void, opts: PickerOptions = {}): Drawer {
  const root = document.createElement('div');
  root.className = 'pk';
  const cells = ELEMENTS.map((e) => {
    const { row, col } = tableCell(e);
    const cls = ['pk-cell', opts.locked?.(e.z) ? 'is-locked' : '', e.z === opts.current ? 'is-current' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-z="${e.z}" style="grid-row:${row};grid-column:${col};--c:${BLOCK_COLOUR[e.block]}" aria-label="${e.z} ${esc(e.name)}"><span>${e.symbol}</span></button>`;
  }).join('');
  // Markers where the split-out rows belong, and the gap row between the table and them.
  const marks = `<span class="pk-mark" style="grid-row:6;grid-column:3" aria-hidden="true">57–71</span><span class="pk-mark" style="grid-row:7;grid-column:3" aria-hidden="true">89–103</span>`;
  root.innerHTML = `
    <label class="pk-search"><span class="pk-search-label">Find an element</span>
      <input type="search" id="pk-q" placeholder="Name, symbol or number" autocomplete="off" spellcheck="false" enterkeyhint="go"></label>
    <div class="pk-results" id="pk-results" role="listbox" aria-label="Matches" hidden></div>
    <div class="pk-readout" id="pk-readout" aria-live="polite"></div>
    <div class="pk-table" id="pk-table">${cells}${marks}</div>
    <p class="pk-hint">Press and slide across the table to look; let go to choose.</p>`;
  const drawer = openDrawer({ label: 'Choose an element', content: root });
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const input = $<HTMLInputElement>('#pk-q');
  const results = $<HTMLElement>('#pk-results');
  const readout = $<HTMLElement>('#pk-readout');
  const table = $<HTMLElement>('#pk-table');

  const show = (z: number | undefined) => {
    const e = z ? ELEMENTS[z - 1] : undefined;
    readout.innerHTML = e
      ? `<b style="--c:${BLOCK_COLOUR[e.block]}">${e.symbol}</b><span><small>${e.z}</small>${esc(e.name)}</span>`
      : '<span class="pk-readout-empty">Tap an element</span>';
  };
  show(opts.current);

  const pick = (z: number) => {
    drawer.close();
    onPick(z);
  };

  // Press-and-slide over the table: the readout follows the finger, release picks.
  let active: HTMLElement | null = null;
  const cellAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.pk-cell') ?? null;
  const hover = (c: HTMLElement | null) => {
    if (c === active) return;
    active?.classList.remove('is-hover');
    active = c;
    if (c) { c.classList.add('is-hover'); show(Number(c.dataset.z)); }
  };
  table.addEventListener('pointerdown', (e) => {
    table.setPointerCapture(e.pointerId);
    hover(cellAt(e.clientX, e.clientY));
    e.preventDefault();
  });
  table.addEventListener('pointermove', (e) => { if (table.hasPointerCapture(e.pointerId)) hover(cellAt(e.clientX, e.clientY)); });
  table.addEventListener('pointerup', (e) => {
    const c = cellAt(e.clientX, e.clientY);
    active?.classList.remove('is-hover');
    active = null;
    if (c) pick(Number(c.dataset.z));
  });
  table.addEventListener('pointercancel', () => { hover(null); show(opts.current); });
  // Keyboard: cells are buttons, so Tab and Enter work; focus shows the readout too.
  table.addEventListener('focusin', (e) => { const c = (e.target as HTMLElement).closest<HTMLElement>('.pk-cell'); if (c) show(Number(c.dataset.z)); });
  table.addEventListener('keydown', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.pk-cell');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(Number(c.dataset.z)); }
  });

  // Search: matches list above the table, others dim in the table.
  let matches: Element[] = [];
  input.addEventListener('input', () => {
    matches = searchElements(input.value);
    const q = input.value.trim();
    root.classList.toggle('is-searching', !!q);
    const hit = new Set(matches.map((m) => m.z));
    table.querySelectorAll<HTMLElement>('.pk-cell').forEach((c) => c.classList.toggle('is-miss', !!q && !hit.has(Number(c.dataset.z))));
    results.hidden = !q;
    results.innerHTML = q
      ? (matches.length
        ? matches.slice(0, 6).map((m) => `<button type="button" role="option" class="pk-result" data-z="${m.z}" style="--c:${BLOCK_COLOUR[m.block]}"><b>${m.symbol}</b><span>${esc(m.name)}</span><small>${m.z}</small></button>`).join('')
        : '<p class="pk-none">No element matches that.</p>')
      : '';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && matches[0]) { e.preventDefault(); pick(matches[0].z); } });
  results.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.pk-result');
    if (b) pick(Number(b.dataset.z));
  });
  return drawer;
}
