// Details, the Atlas's list view: every element as a row, with filters, a sort and a grouping;
// the search lives in the Atlas's tools row and is handed in. Each row shows the atom's plate in
// the chosen Color, its name, number and category, and the value it is sorted by, drawn as a bar
// so a sort reads at a glance. Grouping splits it into headed sections (periods, groups, blocks,
// categories or states). No progress here: that is Collect's.
//
//   const table = createTable({ onPick: (z) => openPage(z) });
//   table.setQuery('iron');

import { ELEMENTS, placeColour, type Element } from './data';
import { inkOn } from './looks';
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

/** Columns whose values past rutherfordium are predictions, not measurements. */
const PREDICTED: SortKey[] = ['density', 'melt', 'boil'];
/** Whether an element's value in a column is a prediction. */
export const isPredicted = (e: Element, k: SortKey): boolean => PREDICTED.includes(k) && e.z >= 104 && COL[k].value(e, null as never) !== null;
/** Predicted values go after every measured one, keeping their own order. */
function afterMeasured(list: Element[], k: SortKey): Element[] {
  if (!PREDICTED.includes(k)) return list;
  return [...list.filter((e) => !isPredicted(e, k)), ...list.filter((e) => isPredicted(e, k))];
}

/** The rows in order, cut into sections when grouped (one untitled section otherwise). A search
 *  puts best matches first in a single section, and ignores the filters' order but not their cut. */
export function tableRows(st: TableState, query = ''): { title: string; rows: Element[] }[] {
  const save = loadSave();
  const keep = (e: Element) => FILTER_KEYS.every((k) => !st.filters[k].length || st.filters[k].includes(filterValue(e, k)));
  if (query.trim()) return [{ title: '', rows: searchElements(query).filter(keep) }];
  const list = afterMeasured(sortElements(ELEMENTS, st.sort, st.desc, save), st.sort).filter(keep);
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
  /** Show only the elements a search finds, best matches first ('' for all). */
  setQuery(q: string): void;
  /** Each plate's fill. */
  setColors(fn: (e: Element) => string): void;
  /** The elements in the order shown, search aside: an atom's page walks the whole sorted list. */
  order(): number[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const STORE = 'atomos.tables';
const SERIES_ONE: Record<string, string> = {
  'Alkali metals': 'Alkali metal', 'Alkaline earth metals': 'Alkaline earth metal', 'Transition metals': 'Transition metal',
  'Poor metals': 'Post-transition metal', Metalloids: 'Metalloid', Nonmetals: 'Nonmetal', Halogens: 'Halogen',
  'Noble gases': 'Noble gas', Lanthanides: 'Lanthanide', Actinides: 'Actinide',
};
/** "Transition metal", one of a category. */
export const seriesOne = (e: Element): string => SERIES_ONE[e.series] ?? e.series;
/** The unit after a sorted value. */
const UNIT: Partial<Record<SortKey, string>> = { density: 'g/cm³', melt: '°C', boil: '°C', radius: 'pm' };
/** Sorts whose value is already on the row (the number and the name). */
const ON_ROW: SortKey[] = ['z', 'name', 'symbol'];

export function createTable(opts: { onPick: (z: number) => void }): Table {
  let st: TableState;
  try { st = readTableState(localStorage.getItem(STORE)); } catch { st = readTableState(null); }
  let query = '';
  let colors: (e: Element) => string = placeColour;
  const remember = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* storage off: the choices just reset */ } };
  const filtered = () => FILTER_KEYS.some((k) => st.filters[k].length);

  const menu = (cls: string, items: { id: string; label: string }[]) =>
    `<div class="el-menu tb-menu ${cls}" role="menu" hidden>${items.map((it) => `<button type="button" role="menuitemradio" class="el-opt" data-id="${esc(it.id)}"><span>${esc(it.label)}</span>${icon('check', { size: 20 })}</button>`).join('')}</div>`;

  const root = document.createElement('div');
  root.className = 'tb';
  root.innerHTML = `
    <div class="tb-tools">
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
        <span class="tb-countf"><span class="el-count tb-count" aria-live="polite"></span><button type="button" class="ui-icon-btn el-filter" aria-label="Filter" aria-expanded="false" aria-controls="tb-filters">${icon('filter', { size: 22 })}</button></span>
      </div>
      <div class="tb-filters" id="tb-filters" hidden>
        ${FILTER_KEYS.map((k) => `<div class="tb-fgroup"><small>${esc(FILTERS[k].label)}</small><div class="ui-pills" role="group" aria-label="${esc(FILTERS[k].label)}">${FILTERS[k].values.map((v) => `<button type="button" role="checkbox" class="ui-pill tb-pill" data-f="${k}" data-v="${esc(v.id)}">${esc(v.label)}</button>`).join('')}</div></div>`).join('')}
        <button type="button" class="tb-clearf">Clear filters</button>
      </div>
    </div>
    <div class="tb-scroll" role="list"></div>
    <div class="el-none" hidden><p>No element matches that.</p><div class="el-none-act"></div></div>`;
  const scroll = root.querySelector<HTMLElement>('.tb-scroll')!;
  const none = root.querySelector<HTMLElement>('.el-none')!;
  const filterBtn = root.querySelector<HTMLButtonElement>('.el-filter')!;
  const panel = root.querySelector<HTMLElement>('.tb-filters')!;
  // The filters float in a box under the bar; a tap anywhere else puts them away.
  const showFilters = (on: boolean) => {
    panel.hidden = !on;
    filterBtn.setAttribute('aria-expanded', String(on));
  };

  const draw = () => {
    const sections = tableRows(st, query);
    const count = sections.reduce((n, s) => n + s.rows.length, 0);
    const save = loadSave();
    const k = st.sort;
    const c = COL[k];
    const showValue = !query && !ON_ROW.includes(k);
    // The bar runs from the smallest measured value on show to the largest.
    let lo = Infinity, hi = -Infinity;
    if (showValue && c.numeric) for (const s of sections) for (const e of s.rows) {
      const v = c.value(e, save);
      if (typeof v === 'number' && !(k === 'discovered' && v < 0)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    const value = (e: Element) => {
      if (!showValue) return '';
      const v = c.value(e, save);
      const text = c.text(e, save);
      const known = v !== null && text !== '–';
      const bar = c.numeric && known && hi > lo && typeof v === 'number' && !(k === 'discovered' && v < 0)
        ? `<i class="tb-bar-track"><u style="width:${Math.max(3, ((v - lo) / (hi - lo)) * 100).toFixed(1)}%"></u></i>` : '';
      const unit = known && UNIT[k] ? ` <small>${UNIT[k]}</small>` : '';
      const pred = isPredicted(e, k) ? '<small class="tb-pred">predicted</small>' : '';
      return `<span class="tb-val"><b>${esc(known ? text : 'not known')}</b>${unit}${pred}${bar}</span>`;
    };
    const row = (e: Element, i: number) => {
      const fill = colors(e);
      return `<div class="tb-row${i % 2 ? ' alt' : ''}" role="listitem button" data-z="${e.z}" tabindex="0">
        <span class="tb-sym" style="background:${fill};color:${inkOn(fill)}">${e.symbol}</span>
        <span class="tb-name"><b>${esc(e.name)}</b><small>${e.z} · ${esc(seriesOne(e))}</small></span>${value(e)}</div>`;
    };
    // Alternate plates restart in each section, so its first row is always the plain one.
    scroll.innerHTML = sections.map((s) => (s.title ? `<div class="tb-sec"><span>${esc(s.title)}</span><small>${s.rows.length}</small></div>` : '') + s.rows.map(row).join('')).join('');
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
  const setSort = (k: SortKey) => change(() => { st.desc = k === st.sort ? st.desc : ['density', 'melt', 'boil', 'electronegativity', 'radius', 'weight'].includes(k); st.sort = k; });

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
    if (!root.isConnected) return;
    const t = e.target as HTMLElement;
    if (!t.closest('.tb-box')) openMenu(null);
    if (!panel.hidden && !t.closest('.tb-filters, .el-filter')) showFilters(false);
  };
  document.addEventListener('pointerdown', away, true);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.querySelector('.tb-menu:not([hidden])')) { e.stopPropagation(); openMenu(null); }
    const tr = (e.target as HTMLElement).closest<HTMLElement>('[data-z]');
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
      if (which === 'sort') setSort(opt.dataset.id as SortKey);
      else change(() => { st.group = opt.dataset.id as GroupKey; });
      return;
    }
    if (t.closest('.el-dir')) { change(() => { st.desc = !st.desc; }); return; }
    if (t.closest('.el-filter')) { showFilters(Boolean(panel.hidden)); return; }
    const pill = t.closest<HTMLElement>('.tb-pill');
    if (pill) {
      const k = pill.dataset.f as FilterKey, v = pill.dataset.v!;
      change(() => { st.filters[k] = st.filters[k].includes(v) ? st.filters[k].filter((x) => x !== v) : [...st.filters[k], v]; });
      return;
    }
    if (t.closest('.tb-clearf')) { change(() => { st.filters = { block: [], period: [], series: [], state: [] }; }); return; }
    const row = t.closest<HTMLElement>('[data-z]');
    if (row) opts.onPick(Number(row.dataset.z));
  });

  draw();
  return {
    el: root,
    setQuery: (q: string) => { if (q === query) return; query = q; draw(); scroll.scrollTo({ top: 0 }); },
    setColors: (fn) => { colors = fn; draw(); },
    order: () => tableRows(st).flatMap((sec) => sec.rows.map((e) => e.z)),
  };
}
