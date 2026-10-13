// The live parts of an atom's Info pages (info.ts tabHTML): the Structure page's switch between
// orbitals and shells, and the Isotopes page's filter. Mounted inside one page's root, so the
// atom screen and the Atlas page can each hold a page without reaching into the other's.

import { elementAt } from './data';
import { SHAPE_AT } from '../core/progress';
import type { OrbitalShape } from '../core/save';
import { createSegments, createSlider } from '../ui/components';
import { icon } from '../ui/icons';
import { buildOrder, ISO_FILTERS, orbitalFill, STRUCTURE_VIEWS } from './visuals';
import { Together3D } from './together3d';

/** What the pages remember while stepping from one atom to the next. */
export interface InfoState {
  isoFilter: string;
  structView: string;
  /** Orbital kinds Glyph has not discovered yet: their 2D shapes show a "?". */
  hiddenShapes: OrbitalShape[];
}

/** Wire up whatever the page just rendered into `root` holds. */
export function mountInfoPage(root: HTMLElement, st: InfoState): void {
  mountIsotopeFilter(root, st);
  mountStructureSwitch(root, st);
  mountTogether(root, st);
  mountLinks(root);
}

/** The ways out of a page: the little table and "See in Atlas" go to the Atlas (colored by that
 *  property, with this atom picked); 3D opens the atom full screen. The app shell answers. */
function mountLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('.ov-locate, .see-atlas').forEach((b) => (b.onclick = () => {
    b.dispatchEvent(new CustomEvent('atomos:atlas', { bubbles: true, detail: { z: Number(b.dataset.z), look: b.dataset.look ?? null } }));
  }));
  root.querySelectorAll<HTMLButtonElement>('.st-3d').forEach((b) => (b.onclick = () => {
    b.dispatchEvent(new CustomEvent('atomos:view3d', { bubbles: true, detail: { z: Number(b.dataset.z) } }));
  }));
}

/** Structure's Together view: every orbital at once. The slider adds the electrons one at a time
 *  in the order they fill (each orbital lights pale with one electron and full with two); Play
 *  runs it from nothing; a layer chip picks one layer out; True scale shrinks the inner layers
 *  to their real size. Kinds of shape Glyph hasn't found yet show as a plain ring. */
function mountTogether(root: HTMLElement, st: InfoState): void {
  const box = root.querySelector<HTMLElement>('.tg');
  if (!box) return;
  const e = elementAt(Number(box.dataset.z));
  const order = buildOrder(e).map((s) => ({ s, i: e.subshells.indexOf(s) }));
  const subs = new Map([...box.querySelectorAll<SVGGElement>('.tg-sub')].map((g) => [Number(g.dataset.i), g]));
  const chips = [...box.querySelectorAll<HTMLButtonElement>('.tg-chip')];
  const read = box.querySelector<HTMLElement>('.tg-read')!;
  const hidden = new Set<string>(st.hiddenShapes);
  for (const g of subs.values()) g.classList.toggle('is-unknown', hidden.has(g.dataset.l!));
  let n = e.z;
  let picked: number | null = null;
  let timer = 0;
  const reach = new Map<number, number>();
  // The same picture in 3D, turning, when WebGL is there; the SVG underneath otherwise.
  const view3d = Together3D.create(box.querySelector('.tg-stage')!, e, e.subshells.map((_, i) => Number(subs.get(i)!.dataset.r)), hidden);
  const paint = () => {
    // Hand out n electrons in filling order, up to each layer's real count.
    let left = n;
    let filling: { key: string; c: number; cap: number } | null = null;
    for (const { s, i } of order) {
      const c = Math.min(left, s.count);
      left -= c;
      const g = subs.get(i)!;
      g.classList.toggle('is-empty', c === 0);
      g.classList.toggle('is-dim', picked != null && picked !== i);
      g.classList.toggle('is-picked', picked === i);
      const fill = orbitalFill(c, s.capacity);
      g.querySelectorAll<SVGGElement>('.tg-orb').forEach((o) => o.setAttribute('class', `tg-orb f${fill[Number(o.dataset.k)]}`));
      if (c > 0) filling = { key: s.key, c, cap: s.capacity };
      reach.set(i, c);
    }
    view3d?.set(e.subshells.map((_, i) => reach.get(i) ?? 0), picked);
    chips.forEach((b) => {
      const i = Number(b.dataset.i);
      b.setAttribute('aria-pressed', String(picked === i));
      b.disabled = (reach.get(i) ?? 0) === 0;
    });
    if (picked != null) {
      const s = e.subshells[picked];
      const c = reach.get(picked) ?? 0;
      read.innerHTML = `<b style="color:var(--b)">${s.key}</b> ${c} of ${s.capacity} electrons, ${s.capacity / 2} orbital${s.capacity === 2 ? '' : 's'}${hidden.has(s.l) ? ' · shape still undiscovered' : ''}`;
      (read.firstElementChild as HTMLElement).style.setProperty('--b', getComputedStyle(subs.get(picked)!).getPropertyValue('--b'));
    } else {
      const f = filling as { key: string; c: number; cap: number } | null;
      read.innerHTML = n === 0 ? 'The bare nucleus: drag to add electrons'
        : n === e.z ? `<b>${e.z}</b> electron${e.z === 1 ? '' : 's'} in ${order.length} layer${order.length === 1 ? '' : 's'}.${order.length > 1 ? ' Tap a layer to pick it out.' : ''}`
        : `<b>${n}</b> of ${e.z} electrons · filling ${f!.key}, ${f!.c} of ${f!.cap}`;
    }
  };
  const slider = createSlider({ min: 0, max: e.z, value: n, label: 'Electrons added', format: (v) => `${v}`, onInput: (v) => { stop(); n = v; paint(); } });
  box.querySelector('.tg-slider')!.append(slider.el);
  const play = box.querySelector<HTMLButtonElement>('.tg-play')!;
  const paintPlay = () => { play.innerHTML = icon(timer ? 'pause' : 'play', { size: 22 }); play.setAttribute('aria-label', timer ? 'Pause' : 'Build it up: add the electrons one by one'); };
  const stop = () => { if (timer) { clearInterval(timer); timer = 0; paintPlay(); } };
  play.onclick = () => {
    if (timer) { stop(); return; }
    picked = null;
    if (n >= e.z) n = 0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { n = e.z; slider.set(n); paint(); return; }
    const ms = Math.max(45, Math.min(380, 3600 / e.z));
    timer = window.setInterval(() => {
      n++;
      slider.set(n);
      paint();
      if (n >= e.z || !box.isConnected) stop();
    }, ms);
    paintPlay();
    paint();
  };
  chips.forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.i);
    picked = picked === i ? null : i;
    paint();
  }));
  paintPlay();
  paint();
}

/** The structure page's ways to see the atom: the orbitals assembled layer by layer, and the shells. */
function mountStructureSwitch(root: HTMLElement, st: InfoState): void {
  const slot = root.querySelector<HTMLElement>('#struct-switch');
  if (!slot) return;
  const views = [...root.querySelectorAll<HTMLElement>('.st-view')];
  const apply = (id: string) => {
    st.structView = id;
    for (const v of views) v.hidden = v.dataset.view !== id;
  };
  if (!STRUCTURE_VIEWS.some((v) => v.id === st.structView)) st.structView = 'together';
  const seg = createSegments(STRUCTURE_VIEWS, { active: st.structView, label: 'How to see the structure', onChange: apply });
  slot.append(seg.el);
  // Orbitals' Details: each orbital's name, each subshell's count and the notes; remembered.
  const details = root.querySelector<HTMLInputElement>('#om-details');
  if (details) {
    const map = root.querySelector<HTMLElement>('.om')!;
    const paint = () => { map.classList.toggle('is-detailed', details.checked); root.querySelector('.om-notes')?.toggleAttribute('hidden', !details.checked); };
    try { details.checked = localStorage.getItem('atomos.orbitals.details') === '1'; } catch { /* storage off */ }
    details.onchange = () => { try { localStorage.setItem('atomos.orbitals.details', details.checked ? '1' : '0'); } catch { /* storage off */ } paint(); };
    paint();
  }
  // The 2D shapes keep the same secret as 3D Shapes: a kind Glyph has not found yet shows a "?".
  const hidden = new Set<string>(st.hiddenShapes);
  const kinds = new Set<string>();
  root.querySelectorAll<HTMLElement>('.os-glyph[data-l]').forEach((g) => {
    const off = hidden.has(g.dataset.l!);
    g.classList.toggle('is-hidden', off);
    if (off) kinds.add(g.dataset.l!);
  });
  const note = root.querySelector<HTMLElement>('.os-hidden-note');
  if (note && kinds.size) {
    const ls = [...kinds] as OrbitalShape[];
    const and = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
    note.hidden = false;
    note.textContent = `The ${and(ls)} shapes are still undiscovered. Find them with Glyph on ${and(ls.map((l) => elementAt(SHAPE_AT[l]).name.toLowerCase()))}.`;
  }
  seg.select(st.structView);
  apply(st.structView);
}

/** The isotope page's filter: Lasting, Fleeting, All; kept while stepping through elements. A row
 *  opens its mass and spin when tapped. */
function mountIsotopeFilter(root: HTMLElement, st: InfoState): void {
  const slot = root.querySelector<HTMLElement>('#iso-filter');
  const table = root.querySelector<HTMLElement>('#iso-table');
  if (!slot || !table) return;
  const counts = JSON.parse(slot.dataset.counts ?? '{}') as Record<string, number>;
  table.querySelectorAll<HTMLButtonElement>('.it-row').forEach((b) => (b.onclick = () => {
    const more = b.nextElementSibling as HTMLElement;
    more.hidden = !more.hidden;
    b.setAttribute('aria-expanded', String(!more.hidden));
  }));
  const apply = (id: string) => {
    st.isoFilter = id;
    let shown = 0;
    table.querySelectorAll<HTMLElement>('.it-item[data-kinds]').forEach((row) => {
      const on = row.dataset.kinds!.split(' ').includes(id);
      row.hidden = !on;
      if (on) shown++;
    });
    table.classList.toggle('is-empty', shown === 0);
  };
  if (!ISO_FILTERS.some((f) => f.id === st.isoFilter)) st.isoFilter = 'lasting';
  const seg = createSegments(ISO_FILTERS.map((f) => ({ id: f.id, label: `${f.label} ${counts[f.id] ?? 0}` })), { active: st.isoFilter, label: 'Show isotopes', onChange: apply });
  slot.append(seg.el);
  seg.select(st.isoFilter);
  apply(st.isoFilter);
}
