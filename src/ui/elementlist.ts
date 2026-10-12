// The element list: every element as a roomy row, with search and sorting, for the picker and
// the gallery's Collection. Its columns and sorting are shared with Tables (gallery/table.ts),
// so an element is found the same way everywhere.
//
//   const list = createElementList({ onPick: (z) => go(z), current: 26 });
//   drawer.body.append(list.el);
//
// Rows are grouped under small headings that follow the sort (periods, groups, blocks,
// categories, first letters or how far each atom is built). Pills, behind the Filter button
// beside the search, filter the rows by stage (not started, in progress, completed); a dropdown picks the sort. Tapping a row, or Enter on
// it, calls onPick. With `thumbs`, a row that stays on screen a moment swaps its tile for a
// picture of the atom (the gallery's Collection).

import { ELEMENTS, BLOCK_COLOUR, type Element } from '../gallery/data';
import { icon } from './icons';
import { searchElements } from './search';
import { fleetingCount, fleetingTotal, segmentsOf } from '../core/progress';
import { fleetingOpen, rowLockNote } from '../gallery/locks';
import { loadSave, type SaveData } from '../core/save';
import './elementlist.css';

export type SortKey = 'z' | 'name' | 'symbol' | 'weight' | 'group' | 'period' | 'block' | 'series' | 'density' | 'melt' | 'boil' | 'electronegativity' | 'radius' | 'discovered' | 'fleeting' | 'state';

interface Column {
  key: SortKey;
  label: string;
  /** Short label for narrow table headers. */
  short?: string;
  value: (e: Element, save: SaveData) => number | string | null;
  text: (e: Element, save: SaveData) => string;
  numeric?: boolean;
  /** Heading for the group a row falls in when the list is sorted by this column. */
  section?: (e: Element) => string;
}

const BLOCK_ORDER = { s: 0, p: 1, d: 2, f: 3 } as const;
const SERIES_ORDER = ['Alkali metals', 'Alkaline earth metals', 'Transition metals', 'Poor metals', 'Metalloids', 'Nonmetals', 'Halogens', 'Noble gases', 'Lanthanides', 'Actinides'];
const dash = '–';
const num = (v: number | null, digits = 2) => (v === null ? dash : String(+v.toFixed(digits)));
const celsius = (k: number | null) => (k === null ? dash : `${Math.round(k - 273.15)}`);

/** Solid, liquid or gas at room temperature (25 °C), from the melting and boiling points;
 *  Unknown where they have never been measured. */
export type RoomState = 'Solid' | 'Liquid' | 'Gas' | 'Unknown';
export const ROOM_STATES: RoomState[] = ['Solid', 'Liquid', 'Gas', 'Unknown'];
const ROOM_K = 298.15;
export function roomState(e: Element): RoomState {
  if (e.melt === null) return 'Unknown';
  if (e.melt > ROOM_K) return 'Solid';
  if (e.boil === null) return 'Unknown';
  return e.boil > ROOM_K ? 'Liquid' : 'Gas';
}

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
  // Fleeting isotopes built, out of how many the atom has (they never count toward its 100%).
  { key: 'fleeting', label: 'Fleeting', value: (e, s) => fleetingCount(e.z, s).built, text: (e, s) => { const f = fleetingCount(e.z, s); return `${f.built} / ${f.total}`; }, numeric: true },
  { key: 'state', label: 'State', value: (e) => { const st = roomState(e); return st === 'Unknown' ? null : ROOM_STATES.indexOf(st); }, text: (e) => roomState(e), section: (e) => roomState(e) },
  { key: 'discovered', label: 'Discovered', value: (e) => e.discoveryYear ?? -1, text: (e) => (e.discoveryYear === null ? 'Ancient' : String(e.discoveryYear)), numeric: true },
];
export const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<SortKey, Column>;

/** The sorts in the dropdown ('progress' reads the save). */
type ListSort = SortKey | 'progress';
const LIST_SORTS: ListSort[] = ['z', 'name', 'progress', 'group', 'period', 'block', 'series'];
const sortLabel = (k: ListSort) => (k === 'progress' ? 'Progress' : COL[k].label);

/** How far an atom is built, for the stage pills. */
export type Stage = 'new' | 'started' | 'done';
export const STAGES: { id: Stage | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'new', label: 'Not started' }, { id: 'started', label: 'In progress' }, { id: 'done', label: 'Completed' },
];
const STAGE_HEADING: Record<Stage, string> = { new: 'Not started', started: 'In progress', done: 'Completed' };
export const stageOf = (pct: number): Stage => (pct >= 100 ? 'done' : pct > 0 ? 'started' : 'new');

/** Elements in order for a sort. Missing values go last whichever way the sort runs; ties
 *  fall back to atomic number. */
export function sortElements(list: Element[], key: SortKey, desc = false, save: SaveData = loadSave()): Element[] {
  const c = COL[key];
  const values = new Map(list.map((e) => [e.z, c.value(e, save)]));
  return [...list].sort((a, b) => {
    const va = values.get(a.z)!, vb = values.get(b.z)!;
    if (va === null && vb === null) return a.z - b.z;
    if (va === null) return 1;
    if (vb === null) return -1;
    const d = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return (desc ? -d : d) || a.z - b.z;
  });
}

export interface ElementListOptions {
  onPick?: (z: number) => void;
  /** The element on screen now; marked and scrolled to. */
  current?: number;
  /** Elements whose Build is still locked, marked with a lock. They can still be picked and viewed. */
  locked?: (z: number) => boolean;
  /** Starting sort. Defaults to the last one used, then atomic number. */
  sort?: SortKey;
  /** Remembers the sort under this name between visits. */
  storageKey?: string;
  /** A picture of each atom (a data URL), asked for once its row has been on screen a moment. */
  thumbs?: (z: number) => Promise<string | null>;
  /** A button under an empty stage filter (e.g. the Next button), or null for none. */
  emptyAction?: () => HTMLElement | null;
  /** Show the fleeting isotopes built across the whole table beside the count. */
  fleetingTotal?: boolean;
}

export interface ElementList {
  el: HTMLElement;
  /** Put focus in the search box. */
  focusSearch(): void;
  /** Redraw, e.g. after progress changes what is locked. */
  refresh(): void;
}

/** How long a row stays on screen before its picture is asked for. */
const DWELL_MS = 600;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const recall = (k?: string): { key: ListSort; desc: boolean; stage?: Stage | 'all' } | null => {
  if (!k) return null;
  try { const v = JSON.parse(localStorage.getItem(k) ?? 'null'); return v && (COL[v.key as SortKey] || v.key === 'progress') ? v : null; } catch { return null; }
};
const remember = (k: string | undefined, v: { key: ListSort; desc: boolean; stage: Stage | 'all' }) => {
  if (!k) return;
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off: the sort just resets */ }
};

export function createElementList(opts: ElementListOptions = {}): ElementList {
  const saved = recall(opts.storageKey);
  let sort: ListSort = opts.sort ?? saved?.key ?? 'z';
  let desc = opts.sort ? false : saved?.desc ?? false;
  let stage: Stage | 'all' = saved?.stage ?? 'all';
  let query = '';
  let save = loadSave();
  /** Each atom's share built (0 to 100), read from the save on every redraw. */
  const pctOf = (z: number) => {
    const segs = segmentsOf(z, save);
    return segs.length ? Math.round((segs.filter((x) => x.done).length / segs.length) * 100) : 0;
  };

  const root = document.createElement('div');
  root.className = 'el-list';
  root.innerHTML = `
    <div class="el-tools">
      <div class="el-searchrow">
        <label class="el-search">
          <span class="el-search-icon">${icon('search', { size: 22 })}</span>
          <input type="search" placeholder="Name, symbol or number" aria-label="Search elements" autocomplete="off" spellcheck="false" enterkeyhint="go">
          <button type="button" class="el-clear" aria-label="Clear search" hidden>${icon('clear', { size: 26 })}</button>
        </label>
        <button type="button" class="ui-icon-btn el-filter" aria-label="Filter" aria-expanded="false" aria-controls="">${icon('filter', { size: 22 })}</button>
      </div>
      <div class="el-stages ui-pills" role="radiogroup" aria-label="Show" hidden>${STAGES.map((st) => `<button type="button" role="radio" class="el-stage ui-pill" data-stage="${st.id}">${st.label}</button>`).join('')}</div>
      <div class="el-bar"><span class="el-count" aria-live="polite"></span>
        <div class="el-sortbox">
          <button type="button" class="el-dir" aria-label="Reverse the order"></button>
          <button type="button" class="el-sortbtn" aria-haspopup="menu" aria-expanded="false"></button>
          <div class="el-menu" role="menu" hidden>${LIST_SORTS.map((k) => `<button type="button" role="menuitemradio" class="el-opt" data-key="${k}"><span>${sortLabel(k)}</span>${icon('check', { size: 20 })}</button>`).join('')}</div>
        </div>
      </div>
    </div>
    <div class="el-body" role="listbox" aria-label="Elements"></div>
    <div class="el-none" hidden><p></p><div class="el-none-act"></div></div>`;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const clear = root.querySelector<HTMLButtonElement>('.el-clear')!;
  const body = root.querySelector<HTMLElement>('.el-body')!;
  const none = root.querySelector<HTMLElement>('.el-none')!;

  const sorted = (): Element[] => {
    if (sort !== 'progress') return sortElements(ELEMENTS, sort, desc, save);
    const pct = new Map(ELEMENTS.map((e) => [e.z, pctOf(e.z)]));
    return [...ELEMENTS].sort((a, b) => (desc ? pct.get(b.z)! - pct.get(a.z)! : pct.get(a.z)! - pct.get(b.z)!) || a.z - b.z);
  };
  const visible = (): Element[] => {
    // While searching, best matches first, whatever the sort.
    const list = query ? searchElements(query) : sorted();
    return stage === 'all' ? list : list.filter((e) => stageOf(pctOf(e.z)) === stage);
  };

  const tile = (e: Element) => `<span class="el-tile" style="--c:${BLOCK_COLOUR[e.block]}"><b>${e.symbol}</b></span>`;

  // How far each atom's Build has got: "Stable" (nucleus, electrons and the isotopes in the
  // vault) with its bar, then "Fleeting" with its own (grayed when the atom has none, or they
  // are not open yet). A label and its bar turn green once complete; under way the bar is white.
  const progress = (e: Element, save: SaveData) => {
    const segs = segmentsOf(e.z, save);
    const done = segs.filter((s) => s.done).length;
    const pct = segs.length ? Math.round((done / segs.length) * 100) : 0;
    const f = fleetingCount(e.z, save);
    const fleetOn = f.total > 0 && fleetingOpen(save);
    const fpct = fleetOn ? Math.round((f.built / f.total) * 100) : 0;
    const line = (label: string, p: number, na = false) =>
      `<span class="el-pl${na ? ' is-na' : p >= 100 ? ' is-done' : ''}"><small>${label}</small><i class="el-pbar"><i style="width:${p}%"></i></i></span>`;
    const aria = `${pct}% built${fleetOn ? `, ${f.built} of ${f.total} fleeting isotopes` : ''}`;
    return `<span class="el-prog" aria-label="${aria}">${line('Stable', pct)}${line('Fleeting', fpct, !fleetOn)}</span>`;
  };

  const row = (e: Element, save: SaveData) => {
    const locked = opts.locked?.(e.z) ?? false;
    // A locked atom: a lock before its name (Build waits for the row's gate; it can still be viewed).
    const cls = ['el-row', locked ? 'is-locked' : '', e.z === opts.current ? 'is-current' : ''].filter(Boolean).join(' ');
    const pic = thumbCache.get(e.z);
    return `<button type="button" role="option" class="${cls}" data-z="${e.z}" aria-selected="${e.z === opts.current}">
      ${opts.thumbs ? `<span class="el-pic${pic ? ' on' : ''}">${tile(e)}${pic ? `<img src="${pic}" alt="">` : ''}</span>` : tile(e)}
      <span class="el-id"><small>${e.z}</small><b>${esc(e.symbol)}</b></span>
      <span class="el-main"><b>${locked ? `<i class="el-lockico" role="img" aria-label="Build locked">${icon('lock', { size: 16 })}</i>` : ''}<span>${esc(e.name)}</span></b>${locked ? `<span>${esc(rowLockNote(e.z, save, true) || '')}</span>` : ''}</span>
      ${progress(e, save)}
    </button>`;
  };

  const drawRows = (list: Element[]) => {
    const section = query ? undefined : sort === 'progress' ? (e: Element) => STAGE_HEADING[stageOf(pctOf(e.z))] : COL[sort].section;
    let last = '';
    const html: string[] = [];
    for (const e of list) {
      if (section) {
        const s = section(e);
        if (s !== last) { html.push(`<h3 class="el-section">${esc(s)}</h3>`); last = s; }
      }
      html.push(row(e, save));
    }
    body.innerHTML = html.join('');
    watchRows();
  };

  const paintSorts = () => {
    root.querySelectorAll<HTMLButtonElement>('.el-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === sort)));
    root.querySelectorAll<HTMLButtonElement>('.el-stage').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.stage === stage)));
    // The filter button wears a dot while a stage other than All is picked.
    root.querySelector('.el-filter')?.classList.toggle('is-on', stage !== 'all');
    const btn = root.querySelector<HTMLButtonElement>('.el-sortbtn')!;
    btn.innerHTML = `<span>${sortLabel(sort)}</span>${icon('chevron-down', { size: 18 })}`;
    btn.setAttribute('aria-label', `Sort by ${sortLabel(sort)}`);
    const dir = root.querySelector<HTMLButtonElement>('.el-dir')!;
    dir.innerHTML = icon(desc ? 'chevron-down' : 'chevron-up', { size: 18 });
    dir.setAttribute('aria-label', desc ? 'Descending: tap for ascending' : 'Ascending: tap for descending');
  };

  const paintCount = (n: number) => {
    const c = root.querySelector<HTMLElement>('.el-count');
    if (!c) return;
    const what = stage === 'all' ? '' : ` ${STAGE_HEADING[stage].toLowerCase()}`;
    const f = opts.fleetingTotal && fleetingOpen(save) ? fleetingTotal(save) : null;
    c.textContent = `${n} element${n === 1 ? '' : 's'}${what}${f ? ` · Fleeting ${f.built.toLocaleString('en-US')} of ${f.total.toLocaleString('en-US')}` : ''}`;
  };

  // Pictures for the rows that stay on screen a moment (DWELL_MS), fetched one at a time.
  const thumbCache = new Map<number, string>();
  const timers = new Map<HTMLElement, number>();
  const io = opts.thumbs && typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      const rowEl = en.target as HTMLElement;
      const z = Number(rowEl.dataset.z);
      if (en.isIntersecting) {
        if (timers.has(rowEl) || thumbCache.has(z)) continue;
        timers.set(rowEl, window.setTimeout(() => {
          timers.delete(rowEl);
          void opts.thumbs!(z).then((url) => {
            if (!url) return;
            thumbCache.set(z, url);
            const pic = rowEl.isConnected ? rowEl.querySelector<HTMLElement>('.el-pic') : null;
            if (!pic || pic.querySelector('img')) return;
            const img = new Image();
            img.alt = '';
            img.src = url;
            pic.append(img);
            requestAnimationFrame(() => pic.classList.add('on'));
          });
        }, DWELL_MS));
      } else {
        const t = timers.get(rowEl);
        if (t) { clearTimeout(t); timers.delete(rowEl); }
      }
    }
  }, { threshold: 0.6 }) : null;
  const watchRows = () => {
    if (!io) return;
    io.disconnect();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    body.querySelectorAll<HTMLElement>('.el-row').forEach((r) => io.observe(r));
  };

  // What an empty list means: no match for the search, or nothing at this stage yet.
  const EMPTY: Record<Stage, string> = {
    done: 'Nothing complete yet. An atom is complete when its nucleus, electrons and stable and long-lived isotopes are built.',
    started: 'Nothing in progress. An atom is in progress once one of its puzzles is solved and until it is complete.',
    new: 'Every atom has been started.',
  };
  const paintEmpty = (empty: boolean) => {
    none.hidden = !empty;
    if (!empty) return;
    const byStage = !query && stage !== 'all';
    none.querySelector('p')!.textContent = byStage ? EMPTY[stage as Stage] : 'No element matches that.';
    const act = none.querySelector<HTMLElement>('.el-none-act')!;
    act.replaceChildren();
    const b = byStage && stage !== 'new' ? opts.emptyAction?.() : null;
    if (b) act.append(b);
  };

  const render = () => {
    save = loadSave();
    const list = visible();
    paintCount(list.length);
    paintEmpty(list.length === 0);
    drawRows(list);
    paintSorts();
  };

  const toTop = () => {
    // Back to the top of whatever scrolls: the panel around the rows, or the list itself.
    (root.closest('.ui-drawer-body') ?? root).scrollTo({ top: 0 });
  };
  const setSort = (key: ListSort) => {
    // A new sort starts ascending, except progress, which starts with the furthest along.
    desc = key === sort ? desc : key === 'progress';
    sort = key;
    remember(opts.storageKey, { key: sort, desc, stage });
    render();
    toTop();
  };
  const menu = root.querySelector<HTMLElement>('.el-menu');
  const sortBtn = root.querySelector<HTMLButtonElement>('.el-sortbtn');
  const openMenu = (on: boolean) => {
    if (!menu || !sortBtn) return;
    menu.hidden = !on;
    sortBtn.setAttribute('aria-expanded', String(on));
    if (on) menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  };
  const away = (e: Event) => {
    if (!root.isConnected) { document.removeEventListener('pointerdown', away, true); return; }
    if (menu && !menu.hidden && !(e.target as HTMLElement).closest('.el-sortbox')) openMenu(false);
  };
  document.addEventListener('pointerdown', away, true);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu && !menu.hidden) { e.stopPropagation(); openMenu(false); sortBtn?.focus(); } });

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.el-sortbtn')) { openMenu(menu?.hidden === true); return; }
    const filter = t.closest<HTMLButtonElement>('.el-filter');
    if (filter) {
      // The stage pills stay folded away until Filter is tapped, to keep the list compact.
      const pills = root.querySelector<HTMLElement>('.el-stages')!;
      pills.hidden = !pills.hidden;
      filter.setAttribute('aria-expanded', String(!pills.hidden));
      filter.setAttribute('aria-pressed', String(!pills.hidden));
      return;
    }
    if (t.closest('.el-dir')) { desc = !desc; remember(opts.storageKey, { key: sort, desc, stage }); render(); toTop(); return; }
    const opt = t.closest<HTMLElement>('.el-opt');
    if (opt?.dataset.key) { openMenu(false); setSort(opt.dataset.key as ListSort); return; }
    const pill = t.closest<HTMLElement>('.el-stage');
    if (pill?.dataset.stage) { stage = pill.dataset.stage as Stage | 'all'; remember(opts.storageKey, { key: sort, desc, stage }); render(); toTop(); return; }
    const hit = t.closest<HTMLElement>('[data-z]');
    if (hit && body.contains(hit)) opts.onPick?.(Number(hit.dataset.z));
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
