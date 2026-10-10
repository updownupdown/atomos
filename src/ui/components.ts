// Shared interface pieces: icon buttons, the modal close button, tabs, switch toggles, a range
// slider and a hold-to-confirm button. Every screen builds its controls from these so they look
// and behave the same everywhere. Styles live in components.css and read tokens.css.
//
// Each builder returns plain DOM, so it drops into code that renders with innerHTML too:
// render a placeholder, then replace it with the element (or use switchHtml, which is a string).

// Stand-in glyphs until the icon library lands; drawn on the 24 px grid with 2 px padding.
export const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
export const ICON_CHEVRON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

// ---- Icon buttons --------------------------------------------------------------------------

export interface IconButtonOptions {
  icon: string;
  /** Spoken name; also the tooltip. */
  label: string;
  onClick?: (e: MouseEvent) => void;
  className?: string;
}

/** A round 44 px button holding one 24 px icon. Add `ui-icon-btn--ghost` for no outline. */
export function iconButton(o: IconButtonOptions): HTMLButtonElement {
  const b = el('button', `ui-icon-btn ${o.className ?? ''}`.trim(), o.icon);
  b.type = 'button';
  b.setAttribute('aria-label', o.label);
  b.title = o.label;
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** The X that closes a modal or panel. Sits in the top-right corner of its parent. */
export function closeButton(onClick: () => void, label = 'Close'): HTMLButtonElement {
  return iconButton({ icon: ICON_CLOSE, label, onClick, className: 'ui-icon-btn--ghost ui-close' });
}

// ---- Tabs ----------------------------------------------------------------------------------

export interface TabItem {
  id: string;
  label: string;
  /** Optional icon shown before the label. */
  icon?: string;
}

export interface Tabs {
  el: HTMLElement;
  readonly active: string;
  select(id: string, notify?: boolean): void;
}

/** A row of tabs with a sliding underline. Arrow keys move between them. */
export function createTabs(items: TabItem[], opts: { active?: string; onChange?: (id: string) => void; label?: string } = {}): Tabs {
  const root = el('div', 'ui-tabs');
  root.setAttribute('role', 'tablist');
  if (opts.label) root.setAttribute('aria-label', opts.label);
  const bar = el('span', 'ui-tabs-bar');
  const buttons = items.map((t) => {
    const b = el('button', 'ui-tab', `${t.icon ?? ''}<span>${esc(t.label)}</span>`);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.id = t.id;
    root.append(b);
    return b;
  });
  root.append(bar);
  let active = opts.active ?? items[0]?.id ?? '';

  const place = () => {
    const b = buttons.find((x) => x.dataset.id === active);
    if (!b) return;
    bar.style.width = `${b.offsetWidth}px`;
    bar.style.transform = `translateX(${b.offsetLeft}px)`;
    if (root.scrollWidth > root.clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const select = (id: string, notify = false) => {
    active = id;
    for (const b of buttons) {
      const on = b.dataset.id === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    place();
    if (notify) opts.onChange?.(id);
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.ui-tab');
    if (b && b.dataset.id !== active) select(b.dataset.id!, true);
  });
  root.addEventListener('keydown', (e) => {
    const i = buttons.findIndex((b) => b.dataset.id === active);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = buttons[(i + step + buttons.length) % buttons.length];
    select(next.dataset.id!, true);
    next.focus();
  });
  // The underline needs real sizes: place it once the row is in the page and on resize.
  new ResizeObserver(place).observe(root);
  select(active);
  return { el: root, get active() { return active; }, select };
}

// ---- Switch toggle -------------------------------------------------------------------------

export interface SwitchOptions {
  label: string;
  help?: string;
  checked: boolean;
  /** Written to data-key, for code that reads settings back from the inputs. */
  key?: string;
}

/** A settings row with a switch, as an HTML string. The input is a real checkbox (role=switch),
 *  so `change` events and `.checked` work as before. */
export function switchHtml(o: SwitchOptions): string {
  return `<label class="ui-switch-row"><span class="ui-switch-text">${esc(o.label)}${o.help ? `<small>${esc(o.help)}</small>` : ''}</span>`
    + `<input type="checkbox" role="switch" class="ui-switch"${o.key ? ` data-key="${esc(o.key)}"` : ''}${o.checked ? ' checked' : ''}></label>`;
}

/** The same row as DOM, with a change handler. */
export function createSwitch(o: SwitchOptions & { onChange?: (on: boolean) => void }): { el: HTMLLabelElement; input: HTMLInputElement } {
  const holder = document.createElement('div');
  holder.innerHTML = switchHtml(o);
  const row = holder.firstElementChild as HTMLLabelElement;
  const input = row.querySelector('input')!;
  if (o.onChange) input.addEventListener('change', () => o.onChange!(input.checked));
  return { el: row, input };
}

// ---- Range slider --------------------------------------------------------------------------

export interface SliderOptions {
  min: number;
  max: number;
  value: number;
  step?: number;
  /** Spoken name. */
  label: string;
  /** Text for the value bubble and for screen readers; defaults to the number. */
  format?: (v: number) => string;
  /** Fires on every change while dragging. */
  onInput?: (v: number) => void;
  /** Fires once the drag or key press settles. */
  onChange?: (v: number) => void;
}

export interface Slider {
  el: HTMLElement;
  readonly value: number;
  set(v: number): void;
}

/** Rounds to the step and clamps to the range. Exported for tests. */
export function snapValue(v: number, min: number, max: number, step = 1): number {
  const snapped = min + Math.round((v - min) / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

/** A flat range slider. It shrinks to fit its row (it never forces a wrap) and the thumb
 *  shows a value bubble while held. Drag anywhere on the track; arrows, Page keys, Home, End. */
export function createSlider(o: SliderOptions): Slider {
  const step = o.step ?? 1;
  const fmt = o.format ?? ((v: number) => String(v));
  const root = el('div', 'ui-slider', '<span class="ui-slider-track"><span class="ui-slider-fill"></span></span><span class="ui-slider-thumb"><span class="ui-slider-bubble"></span></span>');
  root.setAttribute('role', 'slider');
  root.tabIndex = 0;
  root.setAttribute('aria-label', o.label);
  root.setAttribute('aria-valuemin', String(o.min));
  root.setAttribute('aria-valuemax', String(o.max));
  const bubble = root.querySelector<HTMLElement>('.ui-slider-bubble')!;
  let value = snapValue(o.value, o.min, o.max, step);

  const paint = () => {
    const t = o.max > o.min ? (value - o.min) / (o.max - o.min) : 0;
    root.style.setProperty('--t', String(t));
    root.setAttribute('aria-valuenow', String(value));
    root.setAttribute('aria-valuetext', fmt(value));
    bubble.textContent = fmt(value);
  };
  const update = (v: number, fire: boolean) => {
    const next = snapValue(v, o.min, o.max, step);
    if (next === value) return false;
    value = next;
    paint();
    if (fire) o.onInput?.(value);
    return true;
  };
  const fromX = (x: number) => {
    const track = root.querySelector('.ui-slider-track')!.getBoundingClientRect();
    const t = track.width ? (x - track.left) / track.width : 0;
    return o.min + Math.min(1, Math.max(0, t)) * (o.max - o.min);
  };

  let dragging = false;
  let startValue = value;
  root.addEventListener('pointerdown', (e) => {
    dragging = true;
    startValue = value;
    root.setPointerCapture(e.pointerId);
    root.classList.add('is-active');
    update(fromX(e.clientX), true);
    e.preventDefault();
    root.focus();
  });
  root.addEventListener('pointermove', (e) => { if (dragging) update(fromX(e.clientX), true); });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('is-active');
    if (value !== startValue) o.onChange?.(value);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('keydown', (e) => {
    const big = Math.max(step, (o.max - o.min) / 10);
    const delta: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big };
    let next: number | null = null;
    if (e.key in delta) next = value + delta[e.key];
    else if (e.key === 'Home') next = o.min;
    else if (e.key === 'End') next = o.max;
    if (next === null) return;
    e.preventDefault();
    if (update(next, true)) o.onChange?.(value);
  });
  paint();
  return { el: root, get value() { return value; }, set: (v: number) => { update(v, false); } };
}

// ---- Hold to confirm -----------------------------------------------------------------------

export interface HoldButtonOptions {
  icon: string;
  /** What the hold does, e.g. "Restart"; spoken as "Hold to restart". */
  label: string;
  /** How long to hold, in milliseconds. */
  holdMs?: number;
  onConfirm: () => void;
  className?: string;
}

/** An icon button that only acts after being held: a ring fills round it while pressed and
 *  drains if let go early. A quick tap shows "Hold" so the rule is discoverable. Enter or
 *  Space held down works too. */
export function createHoldButton(o: HoldButtonOptions): HTMLButtonElement {
  const holdMs = o.holdMs ?? 800;
  const R = 20;
  const C = 2 * Math.PI * R;
  const b = el('button', `ui-icon-btn ui-hold ${o.className ?? ''}`.trim(),
    `<svg class="ui-hold-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="${R}" pathLength="${C.toFixed(2)}" style="stroke-dasharray:${C.toFixed(2)};stroke-dashoffset:${C.toFixed(2)}"/></svg>${o.icon}<span class="ui-hold-tip" aria-hidden="true">Hold</span>`);
  b.type = 'button';
  b.setAttribute('aria-label', `Hold to ${o.label.toLowerCase()}`);
  b.title = `Hold to ${o.label.toLowerCase()}`;
  const ring = b.querySelector('circle')!;
  let progress = 0;
  let holding = false;
  let raf = 0;
  let last = 0;
  let tipTimer = 0;

  const draw = () => { ring.style.strokeDashoffset = String(C * (1 - progress)); };
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    progress = holding ? Math.min(1, progress + dt / holdMs) : Math.max(0, progress - dt / (holdMs / 3));
    draw();
    if (holding && progress >= 1) {
      holding = false;
      progress = 0;
      draw();
      b.classList.remove('is-holding');
      b.classList.add('is-done');
      setTimeout(() => b.classList.remove('is-done'), 300);
      o.onConfirm();
      return;
    }
    b.classList.toggle('is-draining', !holding && progress > 0);
    if (holding || progress > 0) raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (holding) return;
    holding = true;
    b.classList.add('is-holding');
    b.classList.remove('show-tip');
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (!holding) return;
    holding = false;
    b.classList.remove('is-holding');
    if (progress < 0.25) {
      b.classList.add('show-tip');
      clearTimeout(tipTimer);
      tipTimer = window.setTimeout(() => b.classList.remove('show-tip'), 1100);
    }
  };
  b.addEventListener('pointerdown', (e) => { if (e.button === 0) { b.setPointerCapture(e.pointerId); start(); } });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointercancel', stop);
  b.addEventListener('lostpointercapture', stop);
  b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } });
  b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') stop(); });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}
