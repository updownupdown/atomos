// The atom list: every atom in one plain list, grouped by period, for getting from one atom to
// another quickly. Each row is the atom's number, symbol and name, then two bars: its stable
// parts and its fleeting isotopes. No pictures, so it opens at once.
//
// It opens from the Atoms button (createListToggle) at the top right of Collect's title row and
// of the atom bar, and looks the same from both. The button's fill is the share of atoms built;
// its chevron turns while the list is open. The list drops from under the bar that holds the
// button: the whole collection's progress on top, then the periods, each heading carrying its
// stable and fleeting percents over those columns. Nu swims round the bar of the next thing to
// build. At the foot, Top scrolls back up and Next goes to the Up next atom. Tapping a row picks
// that atom and closes the list, as do the button again, the mask below it, Escape and Back.
//
//   const toggle = createListToggle({ current: () => z, onPick: (z) => show(z) });
//   bar.append(toggle.el);

import { MAX_Z, elementAt } from './data';
import { atomBuilt, fleetingCount, rowOpen, rowSpan, segmentsOf } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import { nextStep } from '../core/next';
import { fleetingOpen } from './locks';
import { icon } from '../ui/icons';
import { nextButton } from '../ui/components';
import './atomlist.css';

export interface ListToggleOptions {
  /** The atom on screen now: marked in the list and scrolled to. */
  current: () => number;
  /** A row (or Next) was tapped: the list has started closing. */
  onPick: (z: number) => void;
}

export interface ListToggle {
  el: HTMLButtonElement;
  /** Repaint the fill (progress changed). */
  refresh(): void;
}

/** The whole collection: atoms built, and the shares of the stable parts and fleeting
 *  isotopes built, from 0 to 1. */
export function collectionProgress(save: SaveData): { built: number; atoms: number; stable: number; fleeting: number } {
  let built = 0, sb = 0, st = 0, fb = 0, ft = 0;
  for (let z = 1; z <= MAX_Z; z++) {
    if (atomBuilt(z, save)) built++;
    const segs = segmentsOf(z, save);
    sb += segs.filter((s) => s.done).length;
    st += segs.length;
    const f = fleetingCount(z, save);
    fb += f.built;
    ft += f.total;
  }
  return { built, atoms: MAX_Z, stable: st ? sb / st : 0, fleeting: ft ? fb / ft : 0 };
}

/** One period's stable and fleeting shares, from 0 to 1. */
export function periodShares(period: number, save: SaveData): { built: number; atoms: number; stable: number; fleeting: number } {
  const [first, last] = rowSpan(period);
  let built = 0, sb = 0, st = 0, fb = 0, ft = 0;
  for (let z = first; z <= last; z++) {
    if (atomBuilt(z, save)) built++;
    const segs = segmentsOf(z, save);
    sb += segs.filter((s) => s.done).length;
    st += segs.length;
    const f = fleetingCount(z, save);
    fb += f.built;
    ft += f.total;
  }
  return { built, atoms: last - first + 1, stable: st ? sb / st : 0, fleeting: ft ? fb / ft : 0 };
}

/** One atom's two shares: its stable parts, and its fleeting isotopes (null when it has none
 *  or they are not open yet). */
export function atomShares(z: number, save: SaveData, fleetOn = fleetingOpen(save)): { stable: number; fleeting: number | null } {
  const segs = segmentsOf(z, save);
  const f = fleetingCount(z, save);
  return {
    stable: segs.length ? segs.filter((s) => s.done).length / segs.length : 0,
    fleeting: fleetOn && f.total ? f.built / f.total : null,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
/** As a percent label, never rounding a start down to nothing or a near miss up to all. */
const pctText = (v: number) => (v <= 0 ? '0%' : v >= 1 ? '100%' : `${Math.min(99, Math.max(1, Math.round(v * 100)))}%`);

/** A share as a bar: white while it runs, green once full, an empty track before it starts.
 *  `nu` puts Nu swimming round it: the next thing to build is there. */
export function shareBar(share: number | null, cls = '', nu = false): string {
  const swim = nu ? '<em class="al-swim" aria-hidden="true"><b></b></em>' : '';
  if (share === null) return `<span class="al-bar is-off ${cls}">${swim}</span>`;
  return `<span class="al-bar ${cls}${share >= 1 ? ' is-done' : ''}${nu ? ' is-nu' : ''}"><i style="width:${pct(share)}"></i>${swim}</span>`;
}

/** Which of the next atom's bars the next step fills: fleeting for a fleeting isotope. */
export function nextLane(stage: string): 'stable' | 'fleeting' {
  return stage.startsWith('fl-') ? 'fleeting' : 'stable';
}

/** A progress ring with an icon in its middle, for the list's top and Collect's side. */
export function shareRing(share: number, ico: string, size = 48): string {
  const r = 20, c = 2 * Math.PI * r;
  const on = c * Math.max(0, Math.min(1, share));
  return `<span class="al-ring${share >= 1 ? ' is-done' : ''}" style="width:${size}px;height:${size}px" aria-hidden="true">`
    + `<svg viewBox="0 0 48 48"><circle class="al-ring-track" cx="24" cy="24" r="${r}"/>`
    + `<circle class="al-ring-on" cx="24" cy="24" r="${r}" stroke-dasharray="${on.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 24 24)"${share <= 0 ? ' hidden' : ''}/></svg>`
    + `<span class="al-ring-ico">${icon(ico as never, { size: Math.round(size * 0.42) })}</span></span>`;
}

const toggles = new Set<ListToggle & { setOpen(open: boolean): void }>();
let openList: { close: () => void } | null = null;

export function createListToggle(o: ListToggleOptions): ListToggle {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'alist-toggle';
  el.setAttribute('aria-expanded', 'false');
  el.setAttribute('aria-haspopup', 'dialog');
  el.innerHTML = `<span class="alist-fill"></span><span class="alist-ico">${icon('atom', { size: 20 })}</span><span class="alist-word">Atoms</span>${icon('chevron-down', { size: 18 })}`;
  const fill = el.querySelector<HTMLElement>('.alist-fill')!;
  const t = {
    el,
    refresh() {
      const save = loadSave();
      let built = 0;
      for (let z = 1; z <= MAX_Z; z++) if (atomBuilt(z, save)) built++;
      fill.style.width = pct(built / MAX_Z);
      el.setAttribute('aria-label', `${el.getAttribute('aria-expanded') === 'true' ? 'Hide' : 'Show'} all atoms`);
    },
    setOpen(open: boolean) {
      el.setAttribute('aria-expanded', String(open));
      el.classList.toggle('is-open', open);
      t.refresh();
    },
  };
  el.onclick = () => {
    if (openList) { openList.close(); return; }
    openAtomList(el, o);
  };
  toggles.add(t);
  window.addEventListener('atomos:progress', () => t.refresh());
  t.refresh();
  return t;
}

/** Open the list under the bar holding `anchor`. */
function openAtomList(anchor: HTMLElement, o: ListToggleOptions): void {
  const save = loadSave();
  const fleetOn = fleetingOpen(save);
  const current = o.current();
  const step = nextStep(save);
  const bar = anchor.closest<HTMLElement>('.nav, .atom-bar') ?? anchor;
  const top = Math.round(bar.getBoundingClientRect().bottom);

  const scrim = document.createElement('div');
  scrim.className = 'alist-scrim';
  scrim.style.setProperty('--alist-top', `${top}px`);
  const panel = document.createElement('section');
  panel.className = 'alist';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'All atoms');
  const scroll = document.createElement('div');
  scroll.className = 'al-scroll';

  // The whole collection: three rings, atoms built, stable and fleeting.
  const all = collectionProgress(save);
  const gauge = (share: number, ico: string, word: string, line: string, off = false) =>
    `<div class="al-gauge${off ? ' is-off' : ''}">${shareRing(off ? 0 : share, ico, 56)}<b>${off ? '–' : pctText(share)}</b><span>${word}</span><small>${line}</small></div>`;
  let html = `<div class="al-sum" aria-label="${esc(`Your collection: ${all.built} of ${all.atoms} atoms built, ${pctText(all.stable)} stable, ${fleetOn ? pctText(all.fleeting) : 'no'} fleeting`)}">`
    + gauge(all.built / all.atoms, 'atom', 'Atoms', `${all.built} of ${all.atoms}`)
    + gauge(all.stable, 'isotope-stable', 'Stable', 'nuclei, electrons, isotopes')
    + gauge(all.fleeting, 'isotope-fleeting', 'Fleeting', fleetOn ? 'short-lived isotopes' : 'open after one atom', !fleetOn)
    + '</div>';
  for (let p = 1; p <= 7; p++) {
    const [first, last] = rowSpan(p);
    const ps = periodShares(p, save);
    const open = rowOpen(p, save);
    html += `<h3 class="al-period${open ? '' : ' is-locked'}"><span class="al-period-name">${open ? '' : `<span class="al-lock">${icon('lock', { size: 16 })}</span>`}Period ${p}<small>${ps.built} of ${ps.atoms} built</small></span>`
      + `<span class="al-period-pcts"><span${ps.stable >= 1 ? ' class="is-done"' : ''}>${pctText(ps.stable)}</span><span${fleetOn && ps.fleeting >= 1 ? ' class="is-done"' : ''}>${fleetOn ? pctText(ps.fleeting) : '–'}</span></span></h3><ul class="al-rows">`;
    for (let z = first; z <= last; z++) {
      const e = elementAt(z);
      const s = atomShares(z, save, fleetOn);
      const done = atomBuilt(z, save);
      const lane = step?.z === z ? nextLane(step.stage) : null;
      html += `<li><button type="button" class="al-row${z === current ? ' is-current' : ''}${done ? ' is-built' : ''}" data-z="${z}" aria-label="${esc(`${e.name}, ${z}: ${pctText(s.stable)} stable${s.fleeting === null ? '' : `, ${pctText(s.fleeting)} fleeting`}${lane ? ', next to build' : ''}`)}"${z === current ? ' aria-current="true"' : ''}>`
        + `<span class="al-z">${z}</span><b class="al-sym">${e.symbol}</b><span class="al-name">${esc(e.name)}</span>`
        + `<span class="al-bars">${shareBar(s.stable, '', lane === 'stable')}${shareBar(s.fleeting, '', lane === 'fleeting')}</span></button></li>`;
    }
    html += '</ul>';
  }
  scroll.innerHTML = html;

  // The foot: Top, then Next.
  const foot = document.createElement('div');
  foot.className = 'al-foot';
  const topBtn = document.createElement('button');
  topBtn.type = 'button';
  topBtn.className = 'al-top';
  topBtn.innerHTML = `${icon('chevron-up', { size: 20 })}<span>Top</span>`;
  topBtn.onclick = () => scroll.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  foot.append(topBtn);
  if (step) foot.append(nextButton({ label: 'Next', compact: true, landKey: 'atom-list', onClick: () => { close(); o.onPick(step.z); } }));

  panel.append(scroll, foot);
  scrim.append(panel);
  document.body.append(scrim);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openList = null;
    window.removeEventListener('keydown', onKey, true);
    for (const t of toggles) t.setOpen(false);
    scrim.classList.remove('is-open');
    const done = () => scrim.remove();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setTimeout(done, 200);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  window.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.al-row');
    if (row) { close(); o.onPick(Number(row.dataset.z)); return; }
    if (e.target === scrim) close();
  });
  openList = { close };
  for (const t of toggles) if (t.el === anchor) t.setOpen(true);

  // The atom on screen sits in the middle of the list's view.
  const cur = scroll.querySelector<HTMLElement>('.al-row.is-current');
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    if (cur) {
      scroll.scrollTop = Math.max(0, cur.offsetTop - scroll.clientHeight / 2 + cur.offsetHeight / 2);
      cur.focus({ preventScroll: true });
    } else scroll.querySelector<HTMLElement>('.al-row')?.focus({ preventScroll: true });
  });
}

/** Close the list if it is open (the screen is changing). */
export function closeAtomList(): void {
  openList?.close();
}
