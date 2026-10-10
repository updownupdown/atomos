// The element list: every element as a roomy row (or a traditional table), with search and
// sorting. The picker uses the rows; the gallery's Details view uses the table. Both share
// the same columns, sorting and search, so an element is found the same way everywhere.
//
//   const list = createElementList({ onPick: (z) => go(z), current: 26 });
//   drawer.body.append(list.el);
//
//   const table = createElementList({ variant: 'table', onPick: (z) => openAtom(z) });
//
// Rows are grouped under small headings that follow the sort (periods, groups, blocks,
// categories or first letters). Tapping a row, or Enter on it, calls onPick.

import { ELEMENTS, BLOCK_COLOUR, type Element } from '../gallery/data';
import { icon } from './icons';
import { searchElements } from './search';
import { segmentsOf } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import './elementlist.css';

export type SortKey = 'z' | 'name' | 'symbol' | 'weight' | 'group' | 'period' | 'block' | 'series' | 'density' | 'melt' | 'boil' | 'electronegativity' | 'radius' | 'discovered';

interface Column {
  key: SortKey;
  label: string;
  /** Short label for narrow table headers. */
  short?: string;
  value: (e: Element) => number | string | null;
  text: (e: Element) => string;
  numeric?: boolean;
  /** Heading for the group a row falls in when the list is sorted by this column. */
  section?: (e: Element) => string;
}

const BLOCK_ORDER = { s: 0, p: 1, d: 2, f: 3 } as const;
const SERIES_ORDER = ['Alkali metals', 'Alkaline earth metals', 'Transition metals', 'Poor metals', 'Metalloids', 'Nonmetals', 'Halogens', 'Noble gases', 'Lanthanides', 'Actinides'];
const dash = '–';
const num = (v: number | null, digits = 2) => (v === null ? dash : String(+v.toFixed(digits)));
const celsius = (k: number | null) => (k === null ? dash : `${Math.round(k - 273.15)}`);

export const COLUMNS: Column[] = [
  { key: 'z', label: 'Number', short: '#', value: (e) => e.z, text: (e) => String(e.z), numeric: true, section: (e) => `Period ${e.period}` },
  { key: 'symbol', label: 'Symbol', value: (e) => e.symbol, text: (e) => e.symbol },
  { key: 'name', label: 'Name', value: (e) => e.name, text: (e) => e.name, section: (e) => e.name[0] },
  { key: 'weight', label: 'Weight', value: (e) => e.weight, text: (e) => num(e.weight, 3), numeric: true },
  { key: 'group', label: 'Group', value: (e) => e.group ?? 3.5, text: (e) => (e.group === null ? dash : String(e.group)), numeric: true, section: (e) => (e.group === null ? 'Lanthanides and actinides' : `Group ${e.group}`) },
  { key: 'period', label: 'Period', value: (e) => e.period, text: (e) => String(e.period), numeric: true, section: (e) => `Period ${e.period}` },
  { key: 'block', label: 'Block', value: (e) => BLOCK_ORDER[e.block], text: (e) => e.block, section: (e) => `${e.block} block` },
  { key: 'series', label: 'Category', value: (e) => SERIES_ORDER.indexOf(e.series), text: (e) => e.series, section: (e) => e.series },
  { key: 'density', label: 'Density', short: 'g/cm³', value: (e) => e.density, text: (e) => num(e.density, 3), numeric: true },
  { key: 'melt', label: 'Melts', short: 'Melts °C', value: (e) => e.melt, text: (e) => celsius(e.melt), numeric: true },
  { key: 'boil', label: 'Boils', short: 'Boils °C', value: (e) => e.boil, text: (e) => celsius(e.boil), numeric: true },
  { key: 'electronegativity', label: 'Electronegativity', short: 'EN', value: (e) => e.electronegativity, text: (e) => num(e.electronegativity), numeric: true },
  { key: 'radius', label: 'Radius', short: 'Radius pm', value: (e) => e.vdw, text: (e) => String(e.vdw), numeric: true },
  { key: 'discovered', label: 'Discovered', value: (e) => e.discoveryYear ?? -1, text: (e) => (e.discoveryYear === null ? 'Ancient' : String(e.discoveryYear)), numeric: true },
];
const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<SortKey, Column>;

/** The sorts offered as pills above the rows. The table sorts by any column header. */
const LIST_SORTS: SortKey[] = ['z', 'name', 'group', 'period', 'block', 'series'];
const TABLE_COLUMNS: SortKey[] = ['symbol', 'name', 'z', 'weight', 'group', 'period', 'block', 'series', 'density', 'melt', 'boil', 'electronegativity', 'radius', 'discovered'];

/** Elements in order for a sort. Missing values go last whichever way the sort runs; ties
 *  fall back to atomic number. */
export function sortElements(list: Element[], key: SortKey, desc = false): Element[] {
  const c = COL[key];
  return [...list].sort((a, b) => {
    const va = c.value(a), vb = c.value(b);
    if (va === null && vb === null) return a.z - b.z;
    if (va === null) return 1;
    if (vb === null) return -1;
    const d = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return (desc ? -d : d) || a.z - b.z;
  });
}

export interface ElementListOptions {
  /** 'rows' (default) for picking; 'table' for a traditional sortable table. */
  variant?: 'rows' | 'table';
  onPick?: (z: number) => void;
  /** The element on screen now; marked and scrolled to. */
  current?: number;
  /** Elements to mark as not collected yet. They can still be picked. */
  locked?: (z: number) => boolean;
  /** Starting sort. Defaults to the last one used, then atomic number. */
  sort?: SortKey;
  /** Remembers the sort under this name between visits. */
  storageKey?: string;
}

export interface ElementList {
  el: HTMLElement;
  /** Put focus in the search box. */
  focusSearch(): void;
  /** Redraw, e.g. after progress changes what is locked. */
  refresh(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const recall = (k?: string): { key: SortKey; desc: boolean } | null => {
  if (!k) return null;
  try { const v = JSON.parse(localStorage.getItem(k) ?? 'null'); return v && COL[v.key as SortKey] ? v : null; } catch { return null; }
};
const remember = (k: string | undefined, v: { key: SortKey; desc: boolean }) => {
  if (!k) return;
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off: the sort just resets */ }
};

export function createElementList(opts: ElementListOptions = {}): ElementList {
  const variant = opts.variant ?? 'rows';
  const saved = recall(opts.storageKey);
  let sort: SortKey = opts.sort ?? saved?.key ?? 'z';
  let desc = opts.sort ? false : saved?.desc ?? false;
  let query = '';

  const root = document.createElement('div');
  root.className = `el-list el-list--${variant}`;
  root.innerHTML = `
    <div class="el-tools">
      <label class="el-search">
        <span class="el-search-icon">${icon('search', { size: 22 })}</span>
        <input type="search" placeholder="Search by name, symbol or number" aria-label="Search elements" autocomplete="off" spellcheck="false" enterkeyhint="go">
        <button type="button" class="el-clear" aria-label="Clear search" hidden>${icon('clear', { size: 26 })}</button>
      </label>
      ${variant === 'rows' ? `<div class="el-sorts" role="radiogroup" aria-label="Sort by">${LIST_SORTS.map((k) => `<button type="button" role="radio" class="el-sort" data-key="${k}">${COL[k].label}</button>`).join('')}</div>` : ''}
    </div>
    <div class="el-body" role="${variant === 'rows' ? 'listbox' : 'grid'}" aria-label="Elements"></div>
    <p class="el-none" hidden>No element matches that.</p>`;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const clear = root.querySelector<HTMLButtonElement>('.el-clear')!;
  const body = root.querySelector<HTMLElement>('.el-body')!;
  const none = root.querySelector<HTMLElement>('.el-none')!;

  const visible = (): Element[] => {
    if (!query) return sortElements(ELEMENTS, sort, desc);
    // While searching, best matches first, whatever the sort.
    return searchElements(query);
  };

  const tile = (e: Element) => `<span class="el-tile" style="--c:${BLOCK_COLOUR[e.block]}"><small>${e.z}</small><b>${e.symbol}</b></span>`;

  // How far each atom's Build has got: one segment per thing to build, and the share done,
  // colored by how far along it is (green once everything is built).
  const progress = (e: Element, save: SaveData) => {
    const segs = segmentsOf(e.z, save);
    const done = segs.filter((s) => s.done).length;
    const pct = segs.length ? Math.round((done / segs.length) * 100) : 0;
    const tier = pct >= 100 ? 'full' : pct >= 50 ? 'most' : pct > 0 ? 'some' : 'none';
    return `<span class="el-prog el-prog--${tier}" aria-label="${pct}% built">
      <span class="el-segs" aria-hidden="true">${segs.map((s) => `<i${s.done ? ' class="on"' : ''}></i>`).join('')}</span>
      <b>${pct}%</b>
    </span>`;
  };

  const row = (e: Element, save: SaveData) => {
    const locked = opts.locked?.(e.z) ?? false;
    const cls = ['el-row', locked ? 'is-locked' : '', e.z === opts.current ? 'is-current' : ''].filter(Boolean).join(' ');
    return `<button type="button" role="option" class="${cls}" data-z="${e.z}" aria-selected="${e.z === opts.current}">
      ${tile(e)}
      <span class="el-main"><b>${esc(e.name)}</b><span>${locked ? '<em>Not collected</em> · ' : ''}${esc(e.series)}</span></span>
      ${progress(e, save)}
    </button>`;
  };

  const drawRows = (list: Element[]) => {
    const section = query ? undefined : COL[sort].section;
    let last = '';
    const html: string[] = [];
    const save = loadSave();
    for (const e of list) {
      if (section) {
        const s = section(e);
        if (s !== last) { html.push(`<h3 class="el-section">${esc(s)}</h3>`); last = s; }
      }
      html.push(row(e, save));
    }
    body.innerHTML = html.join('');
  };

  const drawTable = (list: Element[]) => {
    const head = TABLE_COLUMNS.map((k) => {
      const c = COL[k];
      const on = !query && sort === k;
      const aria = on ? (desc ? 'descending' : 'ascending') : 'none';
      return `<th scope="col" class="${c.numeric ? 'n' : ''}" aria-sort="${aria}"><button type="button" data-key="${k}">${esc(c.short ?? c.label)}<i class="el-arrow" aria-hidden="true"></i></button></th>`;
    }).join('');
    const rows = list.map((e) => {
      const locked = opts.locked?.(e.z) ?? false;
      const cells = TABLE_COLUMNS.map((k) => {
        const c = COL[k];
        if (k === 'symbol') return `<td><span class="el-sym" style="--c:${BLOCK_COLOUR[e.block]}">${e.symbol}</span></td>`;
        if (k === 'name') return `<th scope="row">${esc(e.name)}</th>`;
        return `<td class="${c.numeric ? 'n' : ''}">${esc(c.text(e))}</td>`;
      }).join('');
      return `<tr class="${locked ? 'is-locked' : ''}${e.z === opts.current ? ' is-current' : ''}" data-z="${e.z}" tabindex="0">${cells}</tr>`;
    }).join('');
    body.innerHTML = `<div class="el-scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  };

  const paintSorts = () => {
    root.querySelectorAll<HTMLButtonElement>('.el-sort').forEach((b) => {
      const on = b.dataset.key === sort;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('is-desc', on && desc);
    });
  };

  const render = () => {
    const list = visible();
    none.hidden = list.length > 0;
    if (variant === 'rows') drawRows(list);
    else drawTable(list);
    paintSorts();
  };

  const setSort = (key: SortKey) => {
    // Picking the active sort again flips its direction.
    desc = key === sort ? !desc : false;
    sort = key;
    remember(opts.storageKey, { key: sort, desc });
    render();
    // Back to the top of whatever scrolls: the table's own frame, or the drawer around the rows.
    (root.querySelector('.el-scroll') ?? root.closest('.ui-drawer-body'))?.scrollTo({ top: 0 });
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sortBtn = t.closest<HTMLElement>('.el-sort, th button');
    if (sortBtn?.dataset.key) { setSort(sortBtn.dataset.key as SortKey); return; }
    const hit = t.closest<HTMLElement>('[data-z]');
    if (hit && body.contains(hit)) opts.onPick?.(Number(hit.dataset.z));
  });
  body.addEventListener('keydown', (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-z]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); opts.onPick?.(Number(tr.dataset.z)); }
  });
  input.addEventListener('input', () => {
    query = input.value.trim();
    clear.hidden = !query;
    root.classList.toggle('is-searching', !!query);
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = visible()[0];
    if (first) { e.preventDefault(); opts.onPick?.(first.z); }
  });
  clear.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });

  render();
  // Bring the current element into view once the list is laid out.
  requestAnimationFrame(() => body.querySelector<HTMLElement>('.is-current')?.scrollIntoView({ block: 'center' }));

  return {
    el: root,
    focusSearch: () => input.focus(),
    refresh: render,
  };
}
