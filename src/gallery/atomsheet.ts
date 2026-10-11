// The View's microscope sheet: what used to sit round the 3D atom as plate markings (the
// electron configuration and its counts top left, the isotopes top right), gathered into one
// sheet so the atom has the whole screen.

import { BLOCK_COLOUR, formatHalfLife, shortConfiguration, sup, type Element } from './data';
import { fillOrder } from './atom';

const ISO_SHOWN = 10;

/** The sheet's HTML for an element; `built` says whether its parts are built yet. */
export function atomSheetHTML(e: Element, built: { nucleus: boolean; electrons: boolean }): string {
  const stable = e.isotopes.filter((i) => i.stable).sort((a, b) => (b.abundance ?? 0) - (a.abundance ?? 0));
  const unstable = e.isotopes.filter((i) => !i.stable).sort((a, b) => (b.halfLife ?? 0) - (a.halfLife ?? 0));
  const shown = [...stable, ...unstable].slice(0, ISO_SHOWN);
  const moreStable = stable.length - shown.filter((i) => i.stable).length;
  const moreUnstable = unstable.length - shown.filter((i) => !i.stable).length;
  const more = [moreStable ? `${moreStable} more stable` : '', moreUnstable ? `${moreUnstable} more unstable` : ''].filter(Boolean);
  const stat = (v: string | number, label: string) => `<div class="as-stat"><b>${v}</b><span>${label}</span></div>`;
  const order = fillOrder(e);
  const layers = [...e.subshells].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map((s) =>
    `<li class="${s.core ? 'is-core' : ''}" style="--c:${BLOCK_COLOUR[s.l]}"><b>${s.key}${sup(s.count)}</b></li>`).join('');
  const isoRows = shown.map((i) => `<li class="${i.stable ? 'is-stable' : ''}">
      <span class="as-iso-name">${e.symbol}-${i.a}${i.a === e.commonA ? '<i>most common</i>' : ''}</span>
      <span class="as-iso-val">${i.stable ? (i.abundance == null ? 'trace' : `${Number(i.abundance.toPrecision(3))}%`) : i.halfLife == null ? 'half-life unknown' : `half-life ${formatHalfLife(i.halfLife, true)}`}</span>
    </li>`).join('');
  const n = e.commonA - e.z;
  return `<h2>${e.name}</h2>
    <div class="atom-sheet">
      <section class="as-sec">
        <h3 class="as-cap">Electrons${built.electrons ? '' : '<span>not built yet</span>'}</h3>
        <p class="as-config">${shortConfiguration(e)}</p>
        <ol class="as-layers" aria-label="Layers, in the order they fill">${layers}</ol>
        <div class="as-stats">
          ${stat(e.shells, e.shells === 1 ? 'shell' : 'shells')}
          ${stat(e.subshells.length, e.subshells.length === 1 ? 'layer' : 'layers')}
          ${stat(e.z, e.z === 1 ? 'electron' : 'electrons')}
          ${stat(`${e.vdw}<small> pm</small>`, `radius${e.vdwEstimated ? ' (est.)' : ''}`)}
        </div>
      </section>
      <section class="as-sec">
        <h3 class="as-cap">Nucleus${built.nucleus ? '' : '<span>not built yet</span>'}</h3>
        <div class="as-stats">
          ${stat(e.z, e.z === 1 ? 'proton' : 'protons')}
          ${stat(n, n === 1 ? 'neutron' : 'neutrons')}
          ${stat(`${(2 * e.nucleusRadius).toFixed(1)}<small> fm</small>`, 'across')}
        </div>
      </section>
      <section class="as-sec">
        <h3 class="as-cap">Isotopes<span>${stable.length} stable · ${unstable.length} unstable</span></h3>
        <ul class="as-iso">${isoRows}</ul>
        ${more.length ? `<p class="as-more">And ${more.join(' and ')}.</p>` : ''}
      </section>
    </div>`;
}
