// The win sheet's picture of an atom's progress, drawn with the shared tracks (src/ui/tracks.ts)
// so it reads the same as the Build page's: a row for each thing to build on the Stable lane
// (the nucleus, the electrons, each lasting isotope), then a row with the Fleeting lane's share
// as a bar. Green runs from the top as far as progress is unbroken, the part just won rings
// white, and Nu circles the next stop. Only the part just won and the next one are named.

import { fleetingCount, segmentsOf } from '../core/progress';
import type { SaveData } from '../core/save';
import { trackCell, trackLegend, trackStates, type TrackRow } from '../ui/tracks';

/** `just`: the parts this win completed, as segment ids ('nucleus', 'shells', or a mass
 *  number) or 'fleeting'. */
export function winTrack(z: number, save: SaveData, just: string[]): HTMLElement {
  const segs = segmentsOf(z, save);
  const next = segs.find((s) => !s.done);
  const fl = fleetingCount(z, save);
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

  const rows: TrackRow[] = segs.map((s) => ({ stable: { done: s.done, just: just.includes(s.id) } }));
  const labels = segs.map((s) => (just.includes(s.id) || s === next ? s.label : ''));
  if (fl.total) {
    rows.push({ fleeting: { done: fl.built === fl.total, kind: 'bar', share: fl.built / fl.total, just: just.includes('fleeting') } });
    labels.push(`${fl.built}/${fl.total}`);
  }
  const states = trackStates(rows);

  const head = document.createElement('div');
  head.className = 'wt-head';
  head.append(trackLegend({ labels: false }));
  const list = document.createElement('ol');
  list.className = 'wt-rows';
  states.forEach((state, i) => {
    const li = document.createElement('li');
    li.className = `wt-row${rows[i].fleeting ? ' wt-row--fleeting' : ''}${state.stable.nu || state.fleeting.nu ? ' is-next' : ''}`;
    li.innerHTML = `<span class="wt-label">${labels[i]}</span>`;
    li.append(trackCell(state, { cap: i === states.length - 1 ? 'bottom' : undefined }));
    list.append(li);
  });
  el.append(head, list);
  return el;
}
