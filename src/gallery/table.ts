// Tables: every element in one reference table, with a search, filters, a sort and a grouping.
// It shows only what it is asked about: the symbol, number and name, then the column it is
// sorted by and each column it is filtered by. Grouping splits it into headed sections
// (periods, groups, blocks, categories or states). No progress here: that is Collect's.
//
//   const table = createTable({ onPick: (z) => openAtom(z) });
//   panel.append(table.el);

import { ELEMENTS, BLOCK_COLOUR, type Element } from './data';
import { COL, ROOM_STATES, roomState, sortElements, type SortKey } from '../ui/elementlist';
import { searchElements } from '../ui/search';
import { icon } from '../ui/icons';
import { loadSave } from '../core/save';
import './table.css';

export type GroupKey = 'none' | 'period' | 'group' | 'block' | 'series' | 'state';
export type FilterKey = 'block' | 'period' | 'series' | 'state';

/** The table's choices: what it is sorted and grouped by, and the values each filter keeps
 *  (an empty list keeps everything). */
export interface TableState {
  sort: SortKey;
  desc: boolean;
  group: GroupKey;
  filters: Record<FilterKey, string[]>;
}

const BASE: SortKey[] = ['symbol', 'z', 'name'];
/** Every column but Fleeting, which is progress. */
export const TABLE_SORTS: SortKey[] = ['z', 'name', 'symbol', 'weight', 'group', 'period', 'block', 'series', 'state', 'density', 'melt', 'boil', 'electronegativity', 'radius', 'discovered'];
export const GROUPS: { id: GroupKey; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'period', label: 'Period' }, { id: 'group', label: 'Group' },
  { id: 'block', label: 'Block' }, { id: 'series', label: 'Category' }, { id: 'state', label: 'State' },
];
const FILTER_KEYS: FilterKey[] = ['block', 'period', 'series', 'state'];
const seriesRank = (s: string) => COL.series.value(ELEMENTS.find((e) => e.series === s)!, null as never) as number;
const SERIES = [...new Set(ELEMENTS.map((e) => e.series))].sort((a, b) => seriesRank(a) - seriesRank(b));
/** The values each filter offers, in table order, with their labels. */
export const FILTERS: Record<FilterKey, { label: string; values: { id: string; label: string }[] }> = {
  block: { label: 'Block', values: ['s', 'p', 'd', 'f'].map((b) => ({ id: b, label: `${b} block` })) },
  period: { label: 'Period', values: [1, 2, 3, 4, 5, 6, 7].map((p) => ({ id: String(p), label: String(p) })) },
  series: { label: 'Category', values: SERIES.map((s) => ({ id: s, label: s })) },
  state: { label: 'State at 25 °C', values: ROOM_STATES.map((s) => ({ id: s, label: s })) },
};
const filterValue = (e: Element, k: FilterKey): string => (k === 'block' ? e.block : k === 'period' ? String(e.period) : k === 'series' ? e.series : roomState(e));

const DEFAULT: TableState = { sort: 'z', desc: false, group: 'none', filters: { block: [], period: [], series: [], state: [] } };

/** Read saved choices, keeping only what still makes sense. */
export function readTableState(raw: string | null): TableState {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || typeof v !== 'object') return structuredClone(DEFAULT);
    const filters = { ...DEFAULT.filters };
    for (const k of FILTER_KEYS) {
      const ok = new Set(FILTERS[k].values.map((x) => x.id));
      filters[k] = Array.isArray(v.filters?.[k]) ? v.filters[k].filter((x: unknown) => typeof x === 'string' && ok.has(x)) : [];
    }
    return {
      sort: TABLE_SORTS.includes(v.sort) ? v.sort : 'z',
      desc: v.desc === true,
      group: GROUPS.some((g) => g.id === v.group) ? v.group : 'none',
      filters,
    };
  } catch {
    return structuredClone(DEFAULT);
  }
}

/** The columns on show: symbol, number and name, then the sort's column, then each filter's. */
export function tableColumns(st: TableState): SortKey[] {
  const cols = [...BASE];
  if (!cols.includes(st.sort)) cols.push(st.sort);
  for (const k of FILTER_KEYS) if (st.filters[k].length && !cols.includes(k)) cols.push(k);
  return cols;
}

/** The rows in order, cut into sections when grouped (one untitled section otherwise). A search
 *  puts best matches first in a single section, and ignores the filters' order but not their cut. */
export function tableRows(st: TableState, query = ''): { title: string; rows: Element[] }[] {
  const save = loadSave();
  const keep = (e: Element) => FILTER_KEYS.every((k) => !st.filters[k].length || st.filters[k].includes(filterValue(e, k)));
  if (query.trim()) return [{ title: '', rows: searchElements(query).filter(keep) }];
  const list = sortElements(ELEMENTS, st.sort, st.desc, save).filter(keep);
  if (st.group === 'none') return [{ title: '', rows: list }];
  // Sections follow the grouping column's own order; inside each, the rows keep the sort.
  const col = COL[st.group];
  const order = sortElements(ELEMENTS, st.group, false, save).map((e) => col.section!(e));
  const titles = [...new Set(order)];
  const by = new Map<string, Element[]>(titles.map((t) => [t, []]));
  for (const e of list) by.get(col.section!(e))!.push(e);
  return titles.map((title) => ({ title, rows: by.get(title)! })).filter((s) => s.rows.length);
}

export interface Table {
  el: HTMLElement;
  focusSearch(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const STORE = 'atomos.tables';

export function createTable(opts: { onPick: (z: number) => void }): Table {
  let st: TableState;
  try { st = readTableState(localStorage.getItem(STORE)); } catch { st = readTableState(null); }
  let query = '';
  const remember = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* storage off: the choices just reset */ } };
  const filtered = () => FILTER_KEYS.some((k) => st.filters[k].length);

  const menu = (cls: string, items: { id: string; label: string }[]) =>
    `<div class="el-menu tb-menu ${cls}" role="menu" hidden>${items.map((it) => `<button type="button" role="menuitemradio" class="el-opt" data-id="${esc(it.id)}"><span>${esc(it.label)}</span>${icon('check', { size: 20 })}</button>`).join('')}</div>`;

  const root = document.createElement('div');
  root.className = 'tb';
  root.innerHTML = `
    <div class="tb-tools">
      <div class="el-searchrow">
        <label class="el-search">
          <span class="el-search-icon">${icon('search', { size: 22 })}</span>
          <input type="search" placeholder="Name, symbol or number" aria-label="Search elements" autocomplete="off" spellcheck="false" enterkeyhint="go">
          <button type="button" class="el-clear" aria-label="Clear search" hidden>${icon('clear', { size: 26 })}</button>
        </label>
        <button type="button" class="ui-icon-btn el-filter" aria-label="Filter" aria-expanded="false" aria-controls="tb-filters">${icon('filter', { size: 22 })}</button>
      </div>
      <div class="tb-filters" id="tb-filters" hidden>
        ${FILTER_KEYS.map((k) => `<div class="tb-fgroup"><small>${esc(FILTERS[k].label)}</small><div class="ui-pills" role="group" aria-label="${esc(FILTERS[k].label)}">${FILTERS[k].values.map((v) => `<button type="button" role="checkbox" class="ui-pill tb-pill" data-f="${k}" data-v="${esc(v.id)}">${esc(v.label)}</button>`).join('')}</div></div>`).join('')}
        <button type="button" class="tb-clearf">Clear filters</button>
      </div>
      <div class="tb-bar">
        <div class="el-sortbox tb-box" data-menu="sort">
          <button type="button" class="el-sortbtn tb-btn" aria-haspopup="menu" aria-expanded="false"></button>
          <button type="button" class="el-dir" aria-label="Reverse the order"></button>
          ${menu('tb-menu--left', TABLE_SORTS.map((k) => ({ id: k, label: COL[k].label })))}
        </div>
        <div class="el-sortbox tb-box" data-menu="group">
          <button type="button" class="el-sortbtn tb-btn" aria-haspopup="menu" aria-expanded="false"></button>
          ${menu('', GROUPS)}
        </div>
        <span class="el-count tb-count" aria-live="polite"></span>
      </div>
    </div>
    <div class="tb-scroll"></div>
    <div class="el-none" hidden><p>No element matches that.</p><div class="el-none-act"></div></div>`;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const clear = root.querySelector<HTMLButtonElement>('.el-clear')!;
  const scroll = root.querySelector<HTMLElement>('.tb-scroll')!;
  const none = root.querySelector<HTMLElement>('.el-none')!;
  const filterBtn = root.querySelector<HTMLButtonElement>('.el-filter')!;
  const panel = root.querySelector<HTMLElement>('.tb-filters')!;

  const draw = () => {
    const cols = tableColumns(st);
    const sections = tableRows(st, query);
    const count = sections.reduce((n, s) => n + s.rows.length, 0);
    const head = cols.map((k) => {
      const c = COL[k];
      const aria = !query && st.sort === k ? (st.desc ? 'descending' : 'ascending') : 'none';
      return `<th scope="col" class="${c.numeric ? 'n' : ''}" aria-sort="${aria}"><button type="button" data-key="${k}">${esc(c.short ?? c.label)}<i class="tb-arrow" aria-hidden="true"></i></button></th>`;
    }).join('');
    const save = loadSave();
    const cell = (e: Element, k: SortKey) => {
      if (k === 'symbol') return `<td><span class="tb-sym" style="--c:${BLOCK_COLOUR[e.block]}">${e.symbol}</span></td>`;
      if (k === 'name') return `<th scope="row">${esc(e.name)}</th>`;
      const c = COL[k];
      return `<td class="${c.numeric ? 'n' : ''}${k === st.sort && !query ? ' is-sort' : ''}">${esc(c.text(e, save))}</td>`;
    };
    const body = sections.map((s) => {
      const title = s.title ? `<tr class="tb-sec"><th colspan="${cols.length}" scope="colgroup"><span>${esc(s.title)}</span><small>${s.rows.length}</small></th></tr>` : '';
      // Alternate plates restart in each section, so its first row is always the plain one.
      return title + s.rows.map((e, i) => `<tr class="${i % 2 ? 'alt' : ''}" data-z="${e.z}" tabindex="0">${cols.map((k) => cell(e, k)).join('')}</tr>`).join('');
    }).join('');
    scroll.innerHTML = count ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` : '';
    scroll.hidden = !count;
    none.hidden = !!count;
    const act = none.querySelector<HTMLElement>('.el-none-act')!;
    act.innerHTML = filtered() ? '<button type="button" class="secondary tb-clearf">Clear filters</button>' : '';
    root.querySelector('.tb-count')!.textContent = count === ELEMENTS.length ? `${count} elements` : `${count} of ${ELEMENTS.length}`;
    paintTools();
  };

  const paintTools = () => {
    const [sortBtn, groupBtn] = root.querySelectorAll<HTMLButtonElement>('.tb-btn');
    sortBtn.innerHTML = `<span><small>Sort</small> ${esc(COL[st.sort].label)}</span>${icon('chevron-down', { size: 18 })}`;
    sortBtn.setAttribute('aria-label', `Sort by ${COL[st.sort].label}`);
    const g = GROUPS.find((x) => x.id === st.group)!;
    groupBtn.innerHTML = `<span><small>Group</small> ${esc(g.label)}</span>${icon('chevron-down', { size: 18 })}`;
    groupBtn.setAttribute('aria-label', `Group by ${g.label}`);
    root.querySelectorAll<HTMLElement>('[data-menu="sort"] .el-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === st.sort)));
    root.querySelectorAll<HTMLElement>('[data-menu="group"] .el-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === st.group)));
    const dir = root.querySelector<HTMLButtonElement>('.el-dir')!;
    dir.innerHTML = icon(st.desc ? 'chevron-down' : 'chevron-up', { size: 18 });
    dir.setAttribute('aria-label', st.desc ? 'Descending: tap for ascending' : 'Ascending: tap for descending');
    root.querySelectorAll<HTMLElement>('.tb-pill').forEach((p) => p.setAttribute('aria-checked', String(st.filters[p.dataset.f as FilterKey].includes(p.dataset.v!))));
    filterBtn.classList.toggle('is-on', filtered());
    panel.querySelector<HTMLElement>('.tb-clearf')!.hidden = !filtered();
    root.classList.toggle('is-searching', !!query);
  };

  const change = (fn: () => void) => { fn(); remember(); draw(); scroll.scrollTo({ top: 0 }); };
  const setSort = (k: SortKey, flip: boolean) => change(() => { st.desc = k === st.sort ? (flip ? !st.desc : st.desc) : false; st.sort = k; });

  // The two dropdowns: one open at a time, closed by a tap elsewhere or Escape.
  const openMenu = (box: HTMLElement | null) => {
    root.querySelectorAll<HTMLElement>('.tb-box').forEach((b) => {
      const on = b === box;
      b.querySelector<HTMLElement>('.el-menu')!.hidden = !on;
      b.querySelector('.tb-btn')!.setAttribute('aria-expanded', String(on));
    });
    box?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  };
  const away = (e: Event) => {
    if (!root.isConnected) { document.removeEventListener('pointerdown', away, true); return; }
    if (!(e.target as HTMLElement).closest('.tb-box')) openMenu(null);
  };
  document.addEventListener('pointerdown', away, true);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.querySelector('.tb-menu:not([hidden])')) { e.stopPropagation(); openMenu(null); }
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-z]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); opts.onPick(Number(tr.dataset.z)); }
  });

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('.tb-btn');
    if (btn) { const box = btn.closest<HTMLElement>('.tb-box')!; openMenu(box.querySelector('.el-menu')!.hasAttribute('hidden') ? box : null); return; }
    const opt = t.closest<HTMLElement>('.el-opt');
    if (opt?.dataset.id) {
      const which = opt.closest<HTMLElement>('.tb-box')!.dataset.menu;
      openMenu(null);
      if (which === 'sort') setSort(opt.dataset.id as SortKey, false);
      else change(() => { st.group = opt.dataset.id as GroupKey; });
      return;
    }
    if (t.closest('.el-dir')) { change(() => { st.desc = !st.desc; }); return; }
    if (t.closest('.el-filter')) {
      panel.hidden = !panel.hidden;
      filterBtn.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    const pill = t.closest<HTMLElement>('.tb-pill');
    if (pill) {
      const k = pill.dataset.f as FilterKey, v = pill.dataset.v!;
      change(() => { st.filters[k] = st.filters[k].includes(v) ? st.filters[k].filter((x) => x !== v) : [...st.filters[k], v]; });
      return;
    }
    if (t.closest('.tb-clearf')) { change(() => { st.filters = { block: [], period: [], series: [], state: [] }; }); return; }
    const th = t.closest<HTMLElement>('thead button');
    if (th?.dataset.key) { setSort(th.dataset.key as SortKey, true); return; }
    const row = t.closest<HTMLElement>('tr[data-z]');
    if (row) opts.onPick(Number(row.dataset.z));
  });
  input.addEventListener('input', () => {
    query = input.value.trim();
    clear.hidden = !query;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = tableRows(st, query)[0]?.rows[0];
    if (first) { e.preventDefault(); opts.onPick(first.z); }
  });
  clear.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });

  draw();
  return { el: root, focusSearch: () => input.focus() };
}
