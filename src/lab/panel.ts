// The lab's control panel: compact, collapsible, thumb-friendly at 360 px and tidy on desktop.
// It owns no state; every control reports a patch and the lab re-renders the panel from state.

import { L_OF, elementAt, type Block } from '../gallery/data';
import { THRESHOLDS } from './model';
import { mChoices, orbitalChoices } from './model';
import type { LabState } from './state';
import { QUALITIES, type Experiment, type ExperimentOption } from './types';

type Patch = Partial<LabState>;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A slider option's value as shown beside its label. */
function fmt(o: ExperimentOption, v: number): string {
  return o.range?.format ? o.range.format(v) : String(v);
}

function seg(name: string, items: { id: string; label: string }[], active: string): string {
  return `<div class="lab-seg" data-seg="${name}">${items
    .map((i) => `<button type="button" data-id="${esc(i.id)}" class="${i.id === active ? 'on' : ''}">${esc(i.label)}</button>`)
    .join('')}</div>`;
}

export class Panel {
  private root: HTMLElement;
  private body: HTMLElement;

  constructor(
    host: HTMLElement,
    private experiments: { id: string; name: string }[],
    /** `soft`: a slider is moving; skip rebuilding the panel under the finger. */
    private onChange: (patch: Patch, soft?: boolean) => void,
    /** `soft`: a slider is moving. */
    private onOption: (id: string, value: string, soft?: boolean) => void,
  ) {
    this.root = document.createElement('aside');
    this.root.className = 'lab-panel';
    this.root.innerHTML = `
      <button type="button" class="lab-head" id="lab-toggle" aria-expanded="true">
        <span class="lab-title"><b id="lab-sym"></b> <span id="lab-name"></span> · <span id="lab-orb"></span></span>
        <span class="lab-chev" aria-hidden="true">▾</span>
      </button>
      <div class="lab-body" id="lab-body"></div>`;
    host.appendChild(this.root);
    this.body = this.root.querySelector('#lab-body')!;
    this.root.querySelector('#lab-toggle')!.addEventListener('click', () => {
      this.onChange({ panelOpen: this.root.classList.contains('closed') });
    });
    this.body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!b) return;
      const group = b.parentElement?.dataset.seg;
      const id = b.dataset.id!;
      if (!group) return;
      if (group === 'orbital') this.onChange({ orbital: id });
      else if (group === 'm') this.onChange({ m: Number(id) });
      else if (group === 'quality') this.onChange({ quality: id as LabState['quality'] });
      else if (group === 'threshold') this.onChange({ threshold: Number(id) as LabState['threshold'] });
      else if (group.startsWith('opt:')) this.onOption(group.slice(4), id);
    });
  }

  /** The title row: element and what is shown. */
  header(s: LabState): void {
    const e = elementAt(s.z);
    this.root.classList.toggle('closed', !s.panelOpen);
    this.root.querySelector('#lab-toggle')!.setAttribute('aria-expanded', String(s.panelOpen));
    this.root.querySelector('#lab-sym')!.textContent = e.symbol;
    this.root.querySelector('#lab-name')!.textContent = e.name;
    const { orbital, ms } = this.pick(s);
    this.root.querySelector('#lab-orb')!.textContent =
      orbital === 'total' ? 'Total' : orbital === 'valence' ? 'Valence' : s.full || !ms.length ? orbital : ms[Math.min(s.m, ms.length - 1)];
  }

  private pick(s: LabState) {
    const e = elementAt(s.z);
    const orbs = orbitalChoices(e);
    const orbital = orbs.some((o) => o.id === s.orbital) ? s.orbital : 'total';
    const single = orbital !== 'total' && orbital !== 'valence';
    const l = single ? L_OF[orbital[orbital.length - 1] as Block] : 0;
    const ms = single && l > 0 ? mChoices(orbital) : [];
    return { e, orbs, orbital, single, l, ms };
  }

  render(s: LabState, exp: Experiment, values: Record<string, string>): void {
    this.header(s);
    const { e, orbs, orbital, single, l, ms } = this.pick(s);
    const focus = document.activeElement as HTMLElement | null;
    const focusId = focus?.id;
    this.body.innerHTML = `
      <label class="lab-row lab-col"><span class="lab-lab">Visualization</span>
        <select id="lab-exp">${this.experiments
          .map((x) => `<option value="${x.id}"${x.id === exp.id ? ' selected' : ''}>${esc(x.name)}</option>`)
          .join('')}</select>
      </label>
      <p class="lab-desc">${esc(exp.description)}</p>
      <div class="lab-row lab-col"><span class="lab-lab">Element <span class="lab-val">${e.z} · ${esc(e.symbol)} · ${esc(e.name)}</span></span>
        <div class="lab-el">
          <button type="button" class="lab-btn" id="lab-prev" aria-label="Previous element">‹</button>
          <input type="range" id="lab-z" min="1" max="118" step="1" value="${e.z}" aria-label="Atomic number">
          <button type="button" class="lab-btn" id="lab-next" aria-label="Next element">›</button>
        </div>
      </div>
      ${exp.uses.orbital === false ? '' : `<div class="lab-row lab-col"><span class="lab-lab">Orbital</span>${seg('orbital', orbs, orbital)}</div>
      ${single && l > 0 ? `<label class="lab-check"><input type="checkbox" id="lab-full"${s.full ? ' checked' : ''}> Full subshell (sum over m)</label>` : ''}
      ${single && l > 0 && !s.full ? `<div class="lab-row lab-col">${seg('m', ms.map((n, i) => ({ id: String(i), label: n })), String(Math.min(s.m, ms.length - 1)))}</div>` : ''}
      ${!single ? `<label class="lab-check"><input type="checkbox" id="lab-full"${s.full ? ' checked' : ''}> Round open subshells (sum over m)</label>` : ''}`}
      ${(exp.options ?? []).map((o) => o.range
        ? `<label class="lab-row lab-col"><span class="lab-lab">${esc(o.label)} <span class="lab-val">${esc(fmt(o, Number(values[o.id])))}</span></span>
            <input type="range" data-opt="${esc(o.id)}" min="${o.range.min}" max="${o.range.max}" step="${o.range.step}" value="${esc(values[o.id])}"></label>`
        : `<div class="lab-row lab-col"><span class="lab-lab">${esc(o.label)}</span>${seg('opt:' + o.id, o.choices ?? [], values[o.id] ?? o.choices?.[0]?.id ?? '')}</div>`).join('')}
      <div class="lab-row lab-col"><span class="lab-lab">Quality</span>${seg('quality', QUALITIES, s.quality)}</div>
      ${exp.uses.threshold ? `<div class="lab-row lab-col"><span class="lab-lab">Shown region holds</span>${seg('threshold', THRESHOLDS.map((t) => ({ id: String(t), label: t + '%' })), String(s.threshold))}</div>` : ''}
      ${exp.uses.brightness !== false ? `<label class="lab-row lab-col"><span class="lab-lab">Brightness <span class="lab-val">${s.brightness.toFixed(2)}×</span></span>
        <input type="range" id="lab-bright" min="-2" max="2" step="0.05" value="${Math.log2(s.brightness)}"></label>` : ''}
      ${exp.uses.cutaway ? `<label class="lab-row lab-col"><span class="lab-lab">Cutaway <span class="lab-val">${Math.round(s.cutaway * 180)}°</span></span>
        <input type="range" id="lab-cut" min="0" max="1" step="0.01" value="${s.cutaway}"></label>` : ''}
      <label class="lab-check"><input type="checkbox" id="lab-rot"${s.autoRotate ? ' checked' : ''}> Auto-rotate</label>
      <p class="lab-foot"><a href="./">← Back to Atomos</a></p>`;
    const $ = <T extends HTMLElement>(id: string) => this.body.querySelector<T>('#' + id);
    $<HTMLSelectElement>('lab-exp')!.onchange = (ev) => this.onChange({ exp: (ev.target as HTMLSelectElement).value });
    $('lab-prev')!.onclick = () => this.onChange({ z: Math.max(1, s.z - 1) });
    $('lab-next')!.onclick = () => this.onChange({ z: Math.min(118, s.z + 1) });
    const zIn = $<HTMLInputElement>('lab-z')!;
    zIn.oninput = () => {
      const el = elementAt(Number(zIn.value));
      zIn.closest('.lab-row')!.querySelector('.lab-val')!.textContent = `${el.z} · ${el.symbol} · ${el.name}`;
      this.onChange({ z: el.z }, true);
    };
    zIn.onchange = () => this.onChange({ z: Number(zIn.value) });
    const full = $<HTMLInputElement>('lab-full');
    if (full) full.onchange = () => this.onChange({ full: full.checked });
    const bright = $<HTMLInputElement>('lab-bright');
    if (bright) bright.oninput = () => {
      const v = Math.pow(2, Number(bright.value));
      bright.closest('.lab-row')!.querySelector('.lab-val')!.textContent = `${v.toFixed(2)}×`;
      this.onChange({ brightness: v }, true);
    };
    const cut = $<HTMLInputElement>('lab-cut');
    if (cut) cut.oninput = () => {
      cut.closest('.lab-row')!.querySelector('.lab-val')!.textContent = `${Math.round(Number(cut.value) * 180)}°`;
      this.onChange({ cutaway: Number(cut.value) }, true);
    };
    this.body.querySelectorAll<HTMLInputElement>('input[data-opt]').forEach((inp) => {
      const o = (exp.options ?? []).find((x) => x.id === inp.dataset.opt)!;
      inp.oninput = () => {
        inp.closest('.lab-row')!.querySelector('.lab-val')!.textContent = fmt(o, Number(inp.value));
        this.onOption(o.id, inp.value, true);
      };
      inp.onchange = () => this.onOption(o.id, inp.value);
    });
    const rot = $<HTMLInputElement>('lab-rot')!;
    rot.onchange = () => this.onChange({ autoRotate: rot.checked });
    if (focusId) this.body.querySelector<HTMLElement>('#' + focusId)?.focus({ preventScroll: true });
  }
}
