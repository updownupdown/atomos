// The atom's progress box: one row with its stable parts and fleeting isotopes, each a count
// and a ring round its icon, then Build. The atom's Info pages show it over their tabs. `news`
// can put a green line of what was just gained in the rings' place for 3 s; Collect borrows its
// look (.pb-news) for its own.
//
//   ┌ Stable 7/8 ◎   Fleeting 20/26 ◎   [Build] ┐      narrow, the counts go

import { elementAt } from './data';
import { fleetingCount, rowOf, rowOpen, segmentsOf } from '../core/progress';
import type { SaveData } from '../core/save';
import { fleetingOpen } from './locks';
import { atomShares, shareRing } from './atomlist';
import { icon } from '../ui/icons';
import './progressbox.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One part's progress: the word, the count (which narrow boxes drop) and a ring round the
 *  part's icon. */
function progLine(word: string, figure: string, share: number, ico: string, off = false): string {
  const done = !off && share >= 1;
  return `<div class="pb-prog${off ? ' is-off' : ''}${done ? ' is-done' : ''}"><span class="pb-prog-txt"><span class="pb-prog-word">${word}</span><b class="pb-prog-n">${figure}</b></span>${shareRing(off ? 0 : share, ico, 32)}</div>`;
}

export class ProgressBox {
  readonly el: HTMLElement;
  private progs: HTMLElement;
  private newsEl: HTMLElement;
  private build: HTMLButtonElement;
  private z = 1;
  private newsTimer = 0;

  constructor(onBuild: (z: number) => void, className = '') {
    this.el = document.createElement('div');
    this.el.className = `pbox${className ? ` ${className}` : ''}`;
    this.el.innerHTML = `
      <div class="pb-slot"><div class="pb-progs"></div><div class="pb-news" role="status" hidden></div></div>
      <button type="button" class="pb-build">${icon('build', { size: 20 })}<span>Build</span></button>`;
    this.progs = this.el.querySelector('.pb-progs')!;
    this.newsEl = this.el.querySelector('.pb-news')!;
    this.build = this.el.querySelector('.pb-build')!;
    this.build.onclick = () => onBuild(this.z);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.fit()).observe(this.el);
  }

  /** The counts show only while both parts fit on the row whole. */
  private fit(): void {
    this.el.classList.remove('is-tight');
    const slot = this.progs.parentElement!;
    if (!slot.clientWidth) return;
    this.el.classList.toggle('is-tight', this.progs.scrollWidth > slot.clientWidth + 0.5);
  }

  /** Paint atom `z`'s progress. A period not open yet can't be built: Build waits, grayed. */
  show(z: number, save: SaveData): void {
    if (z !== this.z) this.hideNews();
    this.z = z;
    const fleetOn = fleetingOpen(save);
    const s = atomShares(z, save, fleetOn);
    const segs = segmentsOf(z, save);
    const f = fleetingCount(z, save);
    this.progs.innerHTML = progLine('Stable', `${segs.filter((x) => x.done).length}/${segs.length}`, s.stable, 'isotope-stable')
      + (f.total ? progLine('Fleeting', fleetOn ? `${f.built}/${f.total}` : '–', s.fleeting ?? 0, 'isotope-fleeting', !fleetOn) : '');
    const open = rowOpen(rowOf(z), save);
    const name = elementAt(z).name;
    this.build.disabled = !open;
    this.build.setAttribute('aria-label', open ? `Build ${name}` : `${name} is locked`);
    this.fit();
  }

  /** For a moment, in place of the rings: a green line of what the atom just gained. */
  news(n: { added: string; note: string }): void {
    window.clearTimeout(this.newsTimer);
    this.newsEl.innerHTML = `<b>${esc(n.added)}</b><span>${esc(n.note)}</span>`;
    this.newsEl.hidden = false;
    this.progs.classList.add('is-hidden');
    this.newsTimer = window.setTimeout(() => this.hideNews(), 3000);
  }

  hideNews(): void {
    window.clearTimeout(this.newsTimer);
    this.newsEl.hidden = true;
    this.progs.classList.remove('is-hidden');
  }
}
