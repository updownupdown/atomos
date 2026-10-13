// The live parts of an atom's Info pages (info.ts tabHTML): the Structure page's switch between
// orbitals and shells, and the Isotopes page's filter. Mounted inside one page's root, so the
// atom screen and the Atlas page can each hold a page without reaching into the other's.

import { elementAt } from './data';
import { SHAPE_AT } from '../core/progress';
import type { OrbitalShape } from '../core/save';
import { createSegments } from '../ui/components';
import { ISO_FILTERS, STRUCTURE_VIEWS } from './visuals';

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
  if (!STRUCTURE_VIEWS.some((v) => v.id === st.structView)) st.structView = 'orbitals';
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

/** The isotope page's filter: All, Stable, In nature, Radioactive; kept while stepping through elements. */
function mountIsotopeFilter(root: HTMLElement, st: InfoState): void {
  const slot = root.querySelector<HTMLElement>('#iso-filter');
  const table = root.querySelector<HTMLElement>('#iso-table');
  if (!slot || !table) return;
  const counts = JSON.parse(slot.dataset.counts ?? '{}') as Record<string, number>;
  const apply = (id: string) => {
    st.isoFilter = id;
    let shown = 0;
    table.querySelectorAll<HTMLElement>('.it-row[data-kinds]').forEach((row) => {
      const on = row.dataset.kinds!.split(' ').includes(id);
      row.hidden = !on;
      if (on) shown++;
    });
    table.classList.toggle('is-empty', shown === 0);
  };
  const seg = createSegments(ISO_FILTERS.map((f) => ({ id: f.id, label: `${f.label} ${counts[f.id] ?? 0}` })), { active: st.isoFilter, label: 'Show isotopes', onChange: apply });
  slot.append(seg.el);
  seg.select(st.isoFilter);
  apply(st.isoFilter);
}
