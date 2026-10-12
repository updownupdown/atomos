// Collect: the atoms of one period at a time, and how far each is collected.
//
//   header
//   Period  1 2 3 4 5 6 7     each with a ring of its progress (stable outside, fleeting inside)
//   Atoms ▬  Stable ▬  Fleeting ▬            Stable | Fleeting   (the tracks' legend)
//   ┌ locked period: what opens it ┐
//   26 Fe Iron        (atom)        │ │     one row per atom, on black, with the two tracks
//   ...                                      running down the right edge
//   [ Up next card ]                          sticky at the foot
//
// Once scrolling settles one row is in focus: its name turns white and its picture comes alive,
// zoomed to fill its square without growing the row (LiveAtom); the rows fade with their distance
// from it. Which row that is follows a focus line that slides from the top row (scrolled to the top)
// to the bottom one (scrolled to the end), so every row can be focused without empty space
// above or below the list. A swipe sideways changes period. A tap on a row opens the atom. Each
// atom's picture says how far it is collected (thumbs.ts Tone).

import { elementAt } from './data';
import { atomPicture, LiveAtom, toneOf } from './thumbs';
import { atomBuilt, atomProgress, fleetingCount, rowOf, rowOpen, rowSpan, segmentsOf } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import { nextStep, openStep, type NextStep } from '../core/next';
import { fleetingOpen, periodSentence } from './locks';
import { trackCell, trackLegend, trackStates, type TrackRow } from '../ui/tracks';
import { createCallout, nextButton, swipeToDismiss } from '../ui/components';
import { puzzleIcon } from '../puzzles/catalog';
import { icon } from '../ui/icons';
import { reducedMotion } from '../ui/nu';
import './collect.css';

const PERIODS = [1, 2, 3, 4, 5, 6, 7];

export interface CollectHandlers {
  /** A row was tapped: open the atom. */
  onOpen: (z: number) => void;
}

/** One period's progress: atoms built, the stable parts built (every atom's nucleus, electrons
 *  and lasting isotopes) and the fleeting isotopes built, as counts and as shares from 0 to 1. */
export function periodProgress(period: number, save: SaveData): { atoms: number; built: number; stable: number; stableBuilt: number; stableTotal: number; fleeting: number; fleetingBuilt: number; fleetingTotal: number } {
  const [first, last] = rowSpan(period);
  let built = 0, sb = 0, st = 0, fb = 0, ft = 0;
  for (let z = first; z <= last; z++) {
    if (atomBuilt(z, save)) built++;
    const segs = segmentsOf(z, save);
    sb += segs.filter((x) => x.done).length;
    st += segs.length;
    const f = fleetingCount(z, save);
    fb += f.built;
    ft += f.total;
  }
  const atoms = last - first + 1;
  return { atoms, built, stable: st ? sb / st : 0, stableBuilt: sb, stableTotal: st, fleeting: ft ? fb / ft : 0, fleetingBuilt: fb, fleetingTotal: ft };
}

/** The two tracks' stops for each atom of a period: its stable share as a bar, and its fleeting
 *  share as a bar beside it (none for an atom without fleeting isotopes). */
export function periodTracks(period: number, save: SaveData): TrackRow[] {
  const [first, last] = rowSpan(period);
  const locked = !rowOpen(period, save);
  const fleetOn = fleetingOpen(save);
  const rows: TrackRow[] = [];
  for (let z = first; z <= last; z++) {
    const segs = segmentsOf(z, save);
    const share = segs.length ? segs.filter((s) => s.done).length / segs.length : 0;
    const f = fleetingCount(z, save);
    const fshare = f.total ? f.built / f.total : 0;
    rows.push({
      stable: { kind: 'bar', share, done: share >= 1, locked },
      fleeting: f.total ? { kind: 'bar', share: fleetOn ? fshare : 0, done: fleetOn && fshare >= 1, locked: locked || !fleetOn } : null,
    });
  }
  return rows;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Two rings round a period's number: stable outside, fleeting inside. */
function ringsSvg(stable: number, fleeting: number, fleetOn: boolean): string {
  const arc = (r: number, v: number, cls: string) => {
    const c = 2 * Math.PI * r;
    const on = Math.max(0, Math.min(1, v));
    return `<circle class="co-ring-track" cx="20" cy="20" r="${r}"/>`
      + (on > 0 ? `<circle class="co-ring-on ${cls}${on >= 1 ? ' is-done' : ''}" cx="20" cy="20" r="${r}" stroke-dasharray="${(c * on).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 20 20)"/>` : '');
  };
  return `<svg class="co-rings" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">${arc(18, stable, 'is-stable')}${fleetOn ? arc(14, fleeting, 'is-fleeting') : ''}</svg>`;
}

export class Collect {
  readonly el: HTMLElement;
  private save: SaveData = loadSave();
  private period = 1;
  private current = 0;
  private live = new LiveAtom();
  private periodsEl: HTMLElement;
  private statsEl: HTMLElement;
  private lockEl: HTMLElement;
  private list: HTMLElement;
  private shown = false;
  private upNext = Object.assign(createCallout({ kicker: '', title: '', pic: '', className: 'ui-callout--float up-next co-upnext' }), { hidden: true });
  private upNextGone: string | null = null;
  private settleTimer = 0;

  constructor(host: HTMLElement, private handlers: CollectHandlers) {
    this.el = host;
    host.innerHTML = `
      <div class="co-periods" role="tablist" aria-label="Periods"><span class="co-plabel">Period</span></div>
      <div class="co-stats"></div>
      <div class="co-lock" hidden></div>
      <div class="co-list" role="list" aria-label="Atoms"></div>`;
    this.periodsEl = host.querySelector('.co-periods')!;
    this.statsEl = host.querySelector('.co-stats')!;
    this.lockEl = host.querySelector('.co-lock')!;
    this.list = host.querySelector('.co-list')!;
    host.append(this.upNext);
    for (const p of PERIODS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'co-period';
      b.setAttribute('role', 'tab');
      b.dataset.p = String(p);
      b.onclick = () => this.setPeriod(p, null);
      this.periodsEl.append(b);
    }
    swipeToDismiss(this.upNext, () => { this.upNextGone = this.upNext.dataset.key ?? null; this.upNext.hidden = true; });
    this.bindList();
    window.addEventListener('atomos:progress', () => { if (this.shown) this.refresh(); });
  }

  /** Show Collect on the period of atom `z` (centered on it), or on the Up next atom's. */
  show(z?: number | null): void {
    this.el.hidden = false;
    this.shown = true;
    this.save = loadSave();
    const focus = z ?? nextStep(this.save)?.z ?? 1;
    this.paintUpNext();
    this.setPeriod(rowOf(focus), focus, false);
  }

  hide(): void {
    this.el.hidden = true;
    this.shown = false;
    this.live.stop();
  }

  /** Progress changed: repaint in place, keeping the period and the row in focus. */
  refresh(): void {
    this.save = loadSave();
    this.paintPeriods();
    this.paintStats();
    this.paintUpNext();
    this.paintRows(this.current);
  }

  private setPeriod(p: number, focus: number | null, animate = true, dir = 0): void {
    const changed = p !== this.period;
    this.period = p;
    this.paintPeriods();
    this.paintStats();
    const [first] = rowSpan(p);
    this.paintRows(focus ?? first);
    if (changed && animate && dir && !reducedMotion()) {
      this.list.classList.remove('slide-l', 'slide-r');
      void this.list.offsetWidth;
      this.list.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
    }
  }

  private paintPeriods(): void {
    const fleetOn = fleetingOpen(this.save);
    this.periodsEl.querySelectorAll<HTMLButtonElement>('.co-period').forEach((b) => {
      const p = Number(b.dataset.p);
      const prog = periodProgress(p, this.save);
      const open = rowOpen(p, this.save);
      b.innerHTML = `${ringsSvg(prog.stable, prog.fleeting, fleetOn)}<b>${p}</b>`;
      b.classList.toggle('is-locked', !open);
      b.setAttribute('aria-selected', String(p === this.period));
      b.setAttribute('aria-label', `Period ${p}: ${pct(prog.stable)} stable${fleetOn ? `, ${pct(prog.fleeting)} fleeting` : ''}${open ? '' : ', locked'}`);
    });
  }

  private paintStats(): void {
    const prog = periodProgress(this.period, this.save);
    const fleetOn = fleetingOpen(this.save);
    const bar = (v: number) => `<i class="co-bar${v >= 1 ? ' is-done' : ''}"><i style="width:${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%"></i></i>`;
    const stat = (ico: string, text: string, n: number, of: number, aria: string, off = false) =>
      `<div class="co-stat${off ? ' is-off' : ''}" aria-label="${esc(aria)}"><span class="co-stat-ico">${icon(ico as never, { size: 20 })}</span><span class="co-stat-main"><b>${esc(text)}</b><span class="co-stat-low">${bar(of ? n / of : 0)}<span class="co-count${n >= of && of ? ' is-done' : ''}">${n}/${of}</span></span></span></div>`;
    this.statsEl.innerHTML = stat('atom', 'Atoms', prog.built, prog.atoms, `${prog.built} of ${prog.atoms} atoms built`)
      + stat('isotope-stable', 'Stable', prog.stableBuilt, prog.stableTotal, `Stable: ${prog.stableBuilt} of ${prog.stableTotal} built`)
      + stat('isotope-fleeting', 'Fleeting', fleetOn ? prog.fleetingBuilt : 0, prog.fleetingTotal, fleetOn ? `Fleeting: ${prog.fleetingBuilt} of ${prog.fleetingTotal} built` : 'Fleeting isotopes open once an atom is built', !fleetOn);
    this.statsEl.append(trackLegend({ labels: false }));
    const open = rowOpen(this.period, this.save);
    this.lockEl.hidden = open;
    this.el.classList.toggle('is-locked', !open);
    if (!open) this.lockEl.innerHTML = `<span class="co-lock-ico">${icon('lock', { size: 20 })}</span><span>${esc(periodSentence(rowSpan(this.period)[0], this.save) ?? '')}</span>`;
  }

  /** The period's rows, then focus on atom `focus`. A strip above the first row carries the
   *  tracks up to the progress row; one below lets the last row clear the Up next card. */
  private paintRows(focus: number): void {
    const [first, last] = rowSpan(this.period);
    const states = trackStates(periodTracks(this.period, this.save));
    this.live.stop();
    this.list.replaceChildren();
    const lead = document.createElement('div');
    lead.className = 'co-pad co-pad--top';
    const top = states[0];
    const through = (above: boolean) => ({ stop: null, above, below: above, next: false, nu: false });
    lead.append(trackCell({ stable: through(top.stable.above), fleeting: through(top.fleeting.above) }));
    this.list.append(lead);
    for (let z = first; z <= last; z++) {
      const e = elementAt(z);
      const row = document.createElement('div');
      row.className = 'co-row';
      row.setAttribute('role', 'listitem');
      row.tabIndex = 0;
      row.dataset.z = String(z);
      const tone = toneOf(z, this.save);
      row.dataset.tone = tone;
      row.setAttribute('aria-label', `${e.name}, ${e.symbol}, ${z}: ${pct(atomProgress(z, this.save))} built`);
      row.innerHTML = `<span class="co-id"><small>${z}</small><b>${e.symbol}</b><span class="co-name">${esc(e.name)}</span></span><span class="co-pic"></span>`;
      row.append(trackCell(states[z - first], { cap: z === last ? 'bottom' : undefined }));
      this.list.append(row);
      const pic = row.querySelector<HTMLElement>('.co-pic')!;
      void atomPicture(z, tone).then((url) => {
        if (!url || !row.isConnected || pic.querySelector('img')) return;
        const img = new Image();
        img.alt = '';
        img.src = url;
        pic.prepend(img);
      });
    }
    const tail = document.createElement('div');
    tail.className = 'co-pad co-pad--end';
    this.list.append(tail);
    this.fitTail();
    const target = this.list.querySelector<HTMLElement>(`.co-row[data-z="${focus}"]`) ?? this.list.querySelector<HTMLElement>('.co-row');
    if (!target) return;
    this.focusRow(target);
    this.list.scrollTop = this.scrollFor(target);
    this.dim();
  }

  /** Room below the last row: enough to clear the Up next card. */
  private fitTail(): void {
    const card = this.el.classList.contains('has-upnext') && !this.upNext.hidden ? this.upNext.offsetHeight + 24 : 12;
    this.list.querySelector<HTMLElement>('.co-pad--end')?.style.setProperty('height', `${card}px`);
  }

  /** Row height, from the CSS (the row in focus is no taller). */
  private get rowHeight(): number {
    return parseFloat(getComputedStyle(this.list).getPropertyValue('--co-row')) || 100;
  }

  /** The focus line, in the list's own coordinates (from its top edge), at scroll `s`: at the
   *  middle of the top row when scrolled to the top, of the bottom row (above the Up next card)
   *  when scrolled to the end, and in between in proportion. Null when nothing scrolls. */
  private line(s = this.list.scrollTop): number | null {
    const max = this.list.scrollHeight - this.list.clientHeight;
    if (max <= 1) return null;
    const big = this.rowHeight;
    const lead = this.list.querySelector<HTMLElement>('.co-pad--top')?.offsetHeight ?? 0;
    const tail = this.list.querySelector<HTMLElement>('.co-pad--end')?.offsetHeight ?? 0;
    const a = lead + big / 2;
    const b = this.list.clientHeight - tail - big / 2;
    return a + (Math.max(0, Math.min(max, s)) / max) * (b - a);
  }

  /** The scroll that puts `row`, once it is the row in focus, on the focus line. */
  private scrollFor(row: HTMLElement): number {
    const max = this.list.scrollHeight - this.list.clientHeight;
    if (max <= 1) return 0;
    const h = this.rowHeight, big = h;
    const rows = [...this.list.querySelectorAll<HTMLElement>('.co-row')];
    const lead = this.list.querySelector<HTMLElement>('.co-pad--top')?.offsetHeight ?? 0;
    const tail = this.list.querySelector<HTMLElement>('.co-pad--end')?.offsetHeight ?? 0;
    const a = lead + big / 2;
    const b = this.list.clientHeight - tail - big / 2;
    const c = lead + rows.indexOf(row) * h + big / 2;
    return Math.max(0, Math.min(max, (c - a) / (1 + (b - a) / max)));
  }

  /** Rows fade with their distance from the focus line (CSS reads --k, 0 there to 1 a row
   *  away); with nothing to scroll, from the row in focus. */
  private dim(): void {
    const line = this.line();
    const cur = this.list.querySelector<HTMLElement>('.co-row.is-current');
    const mid = line ?? (cur ? cur.offsetTop - this.list.scrollTop + cur.offsetHeight / 2 : 0);
    const h = this.rowHeight;
    for (const r of this.list.querySelectorAll<HTMLElement>('.co-row')) {
      const k = Math.min(1, Math.abs(r.offsetTop - this.list.scrollTop + r.offsetHeight / 2 - mid) / h);
      r.style.setProperty('--k', k.toFixed(3));
    }
  }

  /** Scrolling has stopped: the row on the focus line comes into focus and glides onto it. */
  private settle(): void {
    const rows = [...this.list.querySelectorAll<HTMLElement>('.co-row')];
    const line = this.line();
    if (!rows.length || line === null) return;
    const dist = (r: HTMLElement) => Math.abs(r.offsetTop - this.list.scrollTop + r.offsetHeight / 2 - line);
    const row = rows.reduce((best, r) => (dist(r) < dist(best) ? r : best));
    if (!row.classList.contains('is-current')) this.focusRow(row);
    const to = this.scrollFor(row);
    if (Math.abs(to - this.list.scrollTop) > 1) this.list.scrollTo({ top: to, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  private focusRow(row: HTMLElement): void {
    const z = Number(row.dataset.z);
    for (const r of this.list.querySelectorAll('.co-row.is-current')) if (r !== row) r.classList.remove('is-current');
    row.classList.add('is-current');
    this.current = z;
    if (!this.shown || !this.live.ok) return;
    const pic = row.querySelector<HTMLElement>('.co-pic')!;
    if (this.live.canvas.parentElement !== pic) pic.append(this.live.canvas);
    this.live.show(z, toneOf(z, this.save), reducedMotion());
    this.live.start();
  }

  private bindList(): void {
    const list = this.list;
    let ticking = false;
    list.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; this.dim(); }); }
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.settle(), 140);
    }, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (this.shown) { this.fitTail(); this.dim(); } }).observe(list);
    list.addEventListener('click', (e) => {
      if (this.swiped) return;
      const row = (e.target as HTMLElement).closest<HTMLElement>('.co-row');
      if (row) this.handlers.onOpen(Number(row.dataset.z));
    });
    list.addEventListener('keydown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.co-row');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.handlers.onOpen(Number(row.dataset.z)); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const next = (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null;
        if (next?.classList.contains('co-row')) {
          e.preventDefault();
          next.focus({ preventScroll: true });
          this.focusRow(next);
          this.list.scrollTo({ top: this.scrollFor(next), behavior: reducedMotion() ? 'auto' : 'smooth' });
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.step(e.key === 'ArrowRight' ? 1 : -1);
    });
    // A swipe sideways changes period; up and down scrolls as usual.
    let start: { x: number; y: number; id: number } | null = null;
    list.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; this.swiped = false; });
    list.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) { this.swiped = true; this.step(dx < 0 ? 1 : -1); }
    });
    list.addEventListener('pointercancel', () => { start = null; });
  }
  private swiped = false;

  /** The next period (1) or the one before (-1). */
  private step(dir: 1 | -1): void {
    const p = this.period + dir;
    if (p < 1 || p > 7) return;
    this.setPeriod(p, null, true, dir);
  }

  /** The Up next card at the foot: the one next thing to do (nextStep), with its Next button. It
   *  doubles as Continue for a returning player: a half-done puzzle comes first. */
  private paintUpNext(): void {
    const step: NextStep | null = nextStep(this.save);
    const card = this.upNext;
    card.hidden = !step;
    this.el.classList.toggle('has-upnext', Boolean(step));
    if (!step) { card.replaceChildren(); return; }
    const key = `${step.kind}/${step.z}/${step.stage}`;
    // Swiped away: it stays away until there is a different next step.
    if (this.upNextGone === key) { card.hidden = true; this.el.classList.remove('has-upnext'); return; }
    if (card.dataset.key === key) return;
    card.dataset.key = key;
    const resume = step.kind === 'resume';
    card.querySelector('small')!.textContent = `${resume ? 'Continue' : 'Up next'}: ${step.gameName}`;
    card.querySelector('b')!.textContent = resume ? step.label.replace(/^Resume [^·]*·\s*/, '') : step.label;
    card.querySelector<HTMLElement>('.ui-callout-pic')!.innerHTML = puzzleIcon(step.game, 32);
    card.querySelector('.ui-callout-acts')!.replaceChildren(nextButton({ label: resume ? 'Resume' : 'Play', compact: true, landKey: 'collect-upnext', onClick: () => openStep(step) }));
  }

  /** For checks: the period and the atom in focus. */
  get state(): { period: number; z: number; live: { z: number; tone: string } } {
    return { period: this.period, z: this.current, live: this.live.state };
  }
}
