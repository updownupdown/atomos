// The win sheet's picture of an atom's progress: two short vertical tracks, Stable and Fleeting,
// in the manner of the Collect screen's. The Stable track has a stop for each thing to build
// (the nucleus, the electrons, each lasting isotope); it is green from the top as far as the
// progress runs unbroken, the part just won rings white, and Nu circles the next stop. The
// Fleeting track fills with the share of fleeting isotopes built.
// Stand-in until the Collect screen's shared tracks land; the sheet only needs an element.

import { fleetingCount, segmentsOf } from '../core/progress';
import type { SaveData } from '../core/save';
import { icon } from '../ui/icons';

/** `just`: the parts this win completed, as segment ids ('nucleus', 'shells', or a mass
 *  number) or 'fleeting'. */
export function winTrack(z: number, save: SaveData, just: string[]): HTMLElement {
  const segs = segmentsOf(z, save);
  const firstGap = segs.findIndex((s) => !s.done);
  const run = firstGap < 0 ? segs.length : firstGap;
  const next = segs.find((s) => !s.done);
  const fl = fleetingCount(z, save);
  const flShare = fl.total ? fl.built / fl.total : 0;
  const stableDone = run === segs.length;
  const el = document.createElement('div');
  el.className = 'wt';
  el.setAttribute('role', 'img');
  const justSeg = segs.find((s) => just.includes(s.id));
  el.setAttribute('aria-label', [
    justSeg ? `${justSeg.label} done.` : '',
    `Stable ${segs.filter((s) => s.done).length} of ${segs.length}.`,
    fl.total ? `Fleeting ${fl.built} of ${fl.total}.` : '',
    next ? `Next: ${next.label}.` : '',
  ].filter(Boolean).join(' '));
  const stops = segs.map((s, i) => {
    const cls = [
      'wt-stop',
      s.done ? 'is-done' : '',
      i < run ? 'is-run' : '',
      just.includes(s.id) ? 'is-just' : '',
      s === next ? 'is-next' : '',
    ].filter(Boolean).join(' ');
    const label = just.includes(s.id) || s === next ? `<span class="wt-label">${s.label}</span>` : '';
    return `<li class="${cls}"><i></i>${label}</li>`;
  }).join('');
  el.innerHTML = `
    <div class="wt-col wt-col--stable">
      <span class="wt-key">${icon('isotope-stable', { size: 16 })}Stable</span>
      <ol class="wt-line">${stops}</ol>
    </div>
    ${fl.total ? `<div class="wt-col wt-col--fleeting${stableDone ? ' is-open' : ''}${just.includes('fleeting') ? ' is-just' : ''}">
      <span class="wt-key">${icon('isotope-fleeting', { size: 16 })}Fleeting</span>
      <div class="wt-bar"><i style="height:${Math.round(flShare * 100)}%"></i></div>
      <span class="wt-count">${fl.built}/${fl.total}</span>
    </div>` : ''}`;
  return el;
}
