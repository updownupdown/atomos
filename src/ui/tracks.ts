// The progress tracks: two thin vertical lanes, Stable on the left and Fleeting on the right,
// running down the right edge of a list of rows (the Build page's steps, the Collect screen's
// atoms in a period, the win sheet's few stops) without ever shifting sideways. Where a row has
// something to build the lane widens into a stop: a dot for one thing, a short bar for many
// (an atom's share). Each lane is green from the top for as long as progress runs unbroken;
// below the first gap it is gray, and anything done further down shows white, never green.
// Nu circles the stop where the Stable lane's green ends, or, once Stable is whole, where the
// Fleeting lane's does. A part just won rings white for a moment.
//
// Use: describe each row's stops, let trackStates() work out the green run and Nu, then put
// trackCell(state) at the right edge of each row (the row must be position: relative or a
// flex/grid item that stretches; the cell fills its height). Rows may sit apart: give their
// container --trk-gap (the space between rows) and the lanes bridge it.
//
//   const states = trackStates(rows.map((r) => ({ stable: { done: r.built }, fleeting: null })));
//   rowEls.forEach((el, i) => el.append(trackCell(states[i])));
//   header.append(trackLegend());            // "Stable" and "Fleeting" over their lanes

import { icon } from './icons';

export type Lane = 'stable' | 'fleeting';

/** What a row holds in one lane: nothing (the lane runs straight through), a dot (one thing to
 *  build) or a bar (several, `share` of them done). */
export interface Stop {
  done: boolean;
  /** For a bar: how much is done, 0 to 1. A dot is done or not. */
  share?: number;
  kind?: 'dot' | 'bar';
  /** Won just now: rings white for a moment. */
  just?: boolean;
  /** Not open yet (a locked period): drawn dim. */
  locked?: boolean;
}

export interface TrackRow {
  stable?: Stop | null;
  fleeting?: Stop | null;
}

/** One lane through one row, worked out. `above`/`below`: whether the lane is green above and
 *  below the row's stop (or all through, without one). */
export interface LaneState {
  stop: Stop | null;
  above: boolean;
  below: boolean;
  /** This stop is where the green ends: the next thing to build in this lane. */
  next: boolean;
  /** Nu circles this stop. */
  nu: boolean;
}

export interface TrackState {
  stable: LaneState;
  fleeting: LaneState;
}

/** Works out the green runs and where Nu goes, for rows in order from the top. `nu: false` leaves
 *  Nu out (a screen that guides some other way). */
export function trackStates(rows: TrackRow[], opts: { nu?: boolean } = {}): TrackState[] {
  const lanes: Lane[] = ['stable', 'fleeting'];
  const out: TrackState[] = rows.map(() => ({ stable: blank(), fleeting: blank() }));
  const whole: Record<Lane, boolean> = { stable: true, fleeting: true };
  for (const lane of lanes) {
    let run = true;
    rows.forEach((r, i) => {
      const stop = r[lane] ?? null;
      const s = out[i][lane];
      s.stop = stop;
      s.above = run;
      if (stop && !stop.done) {
        if (run) s.next = true;
        run = false;
        whole[lane] = false;
      }
      s.below = run;
    });
  }
  if (opts.nu !== false) {
    const lane: Lane = whole.stable ? 'fleeting' : 'stable';
    const at = out.find((s) => s[lane].next && !s[lane].stop?.locked);
    if (at) at[lane].nu = true;
  }
  return out;
}

function blank(): LaneState {
  return { stop: null, above: false, below: false, next: false, nu: false };
}

/** The two lanes for one row, to put at its right edge. `cap`: 'top' starts the lanes at the
 *  row's middle (the first row, or a legend row); 'bottom' ends them there. */
export function trackCell(state: TrackState, opts: { cap?: 'top' | 'bottom' } = {}): HTMLElement {
  const cell = document.createElement('div');
  cell.className = `trk${opts.cap ? ` trk--cap-${opts.cap}` : ''}`;
  cell.setAttribute('aria-hidden', 'true');
  cell.innerHTML = lane('stable', state.stable) + lane('fleeting', state.fleeting);
  return cell;
}

function lane(name: Lane, s: LaneState): string {
  const cls = ['trk-lane', `trk-lane--${name}`, s.above ? 'is-above' : '', s.below ? 'is-below' : ''].filter(Boolean).join(' ');
  return `<span class="${cls}">${s.stop ? stopHtml(s) : ''}</span>`;
}

function stopHtml(s: LaneState): string {
  const st = s.stop!;
  const run = s.above && st.done;
  const cls = [
    'trk-stop',
    st.kind === 'bar' ? 'trk-stop--bar' : '',
    st.done ? 'is-done' : '',
    run ? 'is-run' : '',
    s.next ? 'is-next' : '',
    s.nu ? 'is-nu' : '',
    st.just ? 'is-just' : '',
    st.locked ? 'is-locked' : '',
  ].filter(Boolean).join(' ');
  if (st.kind === 'bar') {
    const share = Math.max(0, Math.min(1, st.share ?? (st.done ? 1 : 0)));
    return `<i class="${cls}"><b style="height:${Math.round(share * 100)}%"></b></i>`;
  }
  return `<i class="${cls}"></i>`;
}

/** "Stable" and "Fleeting" with their icons, each over its lane: put it at the right edge of
 *  the row above the first, like a cell. */
export function trackLegend(opts: { labels?: boolean } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = `trk-legend${opts.labels === false ? ' trk-legend--icons' : ''}`;
  el.innerHTML = `
    <span class="trk-key trk-key--stable" title="Stable">${icon('isotope-stable', { size: 16 })}<span>Stable</span></span>
    <span class="trk-key trk-key--fleeting" title="Fleeting">${icon('isotope-fleeting', { size: 16 })}<span>Fleeting</span></span>`;
  return el;
}
