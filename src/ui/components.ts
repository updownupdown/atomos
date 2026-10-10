// Shared interface pieces: icon buttons, the modal close button, tabs, switch toggles, a range
// slider, toasts, hold-to-confirm and the drawer. Every screen builds its controls from these so they look
// and behave the same everywhere. Styles live in components.css and read tokens.css.
//
// Each builder returns plain DOM, so it drops into code that renders with innerHTML too:
// render a placeholder, then replace it with the element (or use switchHtml, which is a string).

import { icon } from './icons';

// Stand-in glyphs from before the icon library; drawn on the 24 px grid with 2 px padding.
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

/** The universal tab row: labels on a hairline, the active one in cyan with a blue bar under
 *  it that slides between tabs. Arrow keys move between them. Use it wherever a view splits
 *  into sections, so players learn it once. */
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

// ---- Radio segments ------------------------------------------------------------------------

export interface SegmentItem {
  id: string;
  label: string;
  icon?: string;
}

export interface Segments {
  el: HTMLElement;
  readonly active: string;
  select(id: string, notify?: boolean): void;
}

/** A choice of modes: two to four options side by side, exactly one picked, each with a radio
 *  mark so it reads as "pick one" rather than as an action. Arrow keys move the choice. */
export function createSegments(items: SegmentItem[], opts: { active?: string; onChange?: (id: string) => void; label?: string } = {}): Segments {
  const root = el('div', 'ui-seg');
  root.setAttribute('role', 'radiogroup');
  if (opts.label) root.setAttribute('aria-label', opts.label);
  const buttons = items.map((t) => {
    const b = el('button', 'ui-seg-opt', `<i class="ui-seg-dot" aria-hidden="true"></i>${t.icon ?? ''}<span>${esc(t.label)}</span>`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.id = t.id;
    root.append(b);
    return b;
  });
  let active = opts.active ?? items[0]?.id ?? '';
  const select = (id: string, notify = false) => {
    active = id;
    for (const b of buttons) {
      const on = b.dataset.id === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (notify) opts.onChange?.(id);
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.ui-seg-opt');
    if (b && b.dataset.id !== active) select(b.dataset.id!, true);
  });
  root.addEventListener('keydown', (e) => {
    const i = buttons.findIndex((b) => b.dataset.id === active);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = buttons[(i + step + buttons.length) % buttons.length];
    select(next.dataset.id!, true);
    next.focus();
  });
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

// ---- Toasts -------------------------------------------------------------------------------

export type ToastTone = 'info' | 'good' | 'warn' | 'bad';

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before it leaves on its own; 0 keeps it until close(). Default 2600. */
  duration?: number;
  /** Optional 24 px icon before the text. */
  icon?: string;
  /** Show a progress bar along the bottom, driven with setProgress(). */
  progress?: boolean;
}

export interface Toast {
  el: HTMLElement;
  setText(text: string): void;
  /** 0 to 1. */
  setProgress(t: number): void;
  setTone(tone: ToastTone): void;
  /** Leaves after `ms`, or straight away. */
  close(ms?: number): void;
}

function toastHost(): HTMLElement {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', 'toasts');
    host.id = 'toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  return host;
}

/** A pill at the top of the screen, clear of the thumb. Use it for confirmations, finds and
 *  warnings, and (with `progress`) for hold-to-confirm actions. */
export function showToast(text: string, o: ToastOptions = {}): Toast {
  const t = el('div', `ui-toast ui-toast--${o.tone ?? 'info'}`,
    `${o.icon ?? ''}<span class="ui-toast-text"></span>${o.progress ? '<span class="ui-toast-bar"><i></i></span>' : ''}`);
  t.setAttribute('role', 'status');
  const label = t.querySelector<HTMLElement>('.ui-toast-text')!;
  const bar = t.querySelector<HTMLElement>('.ui-toast-bar i');
  label.textContent = text;
  toastHost().append(t);
  let timer = 0;
  let gone = false;
  const close = (ms = 0) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (gone) return;
      gone = true;
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 200);
    }, ms);
  };
  const duration = o.duration ?? 2600;
  if (duration > 0) close(duration);
  return {
    el: t,
    setText: (s) => { label.textContent = s; },
    setProgress: (p) => { if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`; },
    setTone: (tone) => { t.className = `ui-toast ui-toast--${tone}`; },
    close,
  };
}

// ---- Hold to confirm -----------------------------------------------------------------------

export interface HoldOptions {
  /** Shown in the toast while holding, e.g. "Hold to restart". */
  label: string;
  /** Shown once the hold completes, e.g. "Restarted"; omit to just close the toast. */
  doneLabel?: string;
  /** How long to hold, in milliseconds. */
  holdMs?: number;
  onConfirm: () => void;
}

/** Makes any button act only after being held. While pressed, a toast at the top of the screen
 *  fills its progress bar (the button itself is under the thumb); letting go early drains it
 *  and leaves the hint up briefly, so a plain tap teaches the rule. Enter or Space held down
 *  works too. Returns a function that unbinds it. */
export function bindHold(b: HTMLElement, o: HoldOptions): () => void {
  const holdMs = o.holdMs ?? 900;
  let toast: Toast | null = null;
  let progress = 0;
  let holding = false;
  let raf = 0;
  let last = 0;

  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    progress = holding ? Math.min(1, progress + dt / holdMs) : Math.max(0, progress - dt / 150);
    toast?.setProgress(progress);
    if (holding && progress >= 1) {
      holding = false;
      progress = 0;
      b.classList.remove('is-holding');
      if (o.doneLabel && toast) {
        toast.setText(o.doneLabel);
        toast.setTone('good');
        toast.setProgress(1);
        toast.close(900);
      } else toast?.close();
      toast = null;
      o.onConfirm();
      return;
    }
    if (holding || progress > 0) raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (holding) return;
    holding = true;
    b.classList.add('is-holding');
    if (!toast) toast = showToast(o.label, { progress: true, duration: 0 });
    else { toast.close(60 * 60 * 1000); }
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (!holding) return;
    holding = false;
    b.classList.remove('is-holding');
    const t = toast;
    t?.close(holdMs);
    setTimeout(() => { if (toast === t && !holding) toast = null; }, holdMs);
  };
  const down = (e: PointerEvent) => { if (e.button === 0) { b.setPointerCapture(e.pointerId); start(); } };
  const key = (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } };
  const keyUp = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') stop(); };
  const menu = (e: Event) => e.preventDefault();
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointercancel', stop);
  b.addEventListener('lostpointercapture', stop);
  b.addEventListener('keydown', key);
  b.addEventListener('keyup', keyUp);
  b.addEventListener('contextmenu', menu);
  b.setAttribute('aria-label', o.label);
  return () => {
    for (const [ev, fn] of [['pointerdown', down], ['pointerup', stop], ['pointercancel', stop], ['lostpointercapture', stop], ['keydown', key], ['keyup', keyUp], ['contextmenu', menu]] as const) {
      b.removeEventListener(ev, fn as EventListener);
    }
  };
}

export interface HoldButtonOptions {
  icon: string;
  /** What the hold does, e.g. "Restart"; the toast reads "Hold to restart". */
  label: string;
  /** Shown when the hold completes, e.g. "Restarted". */
  doneLabel?: string;
  holdMs?: number;
  onConfirm: () => void;
  className?: string;
}

/** An icon button wired with bindHold. */
export function createHoldButton(o: HoldButtonOptions): HTMLButtonElement {
  const b = iconButton({ icon: o.icon, label: `Hold to ${o.label.toLowerCase()}`, className: `ui-hold ${o.className ?? ''}`.trim() });
  bindHold(b, { label: `Hold to ${o.label.toLowerCase()}`, doneLabel: o.doneLabel, holdMs: o.holdMs, onConfirm: o.onConfirm });
  return b;
}

// ---- Drawer --------------------------------------------------------------------------------

export interface DrawerOptions {
  /** Spoken name of the panel. */
  label: string;
  /** Optional heading shown beside the chevron. */
  title?: string;
  /** What goes inside; it scrolls if it is taller than the panel. */
  content?: Node;
  onClose?: () => void;
}

export interface Drawer {
  el: HTMLElement;
  /** The scrolling area; append content here. */
  body: HTMLElement;
  close(): void;
}

let openDrawers = 0;

/** A panel that rises from the bottom and covers most of the screen, leaving the header and
 *  a strip of the page above it in view. Unlike a modal it closes with a chevron, by tapping
 *  the page above it, by dragging the chevron down, or with Escape. */
export function openDrawer(o: DrawerOptions): Drawer {
  const scrim = el('div', 'ui-drawer-scrim');
  const panel = el('section', 'ui-drawer');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', o.label);
  const head = el('div', 'ui-drawer-head');
  const handle = el('button', 'ui-drawer-handle', icon('chevron-down'));
  handle.type = 'button';
  handle.setAttribute('aria-label', 'Close');
  head.append(handle);
  if (o.title) head.append(el('h2', 'ui-drawer-title', esc(o.title)));
  const body = el('div', 'ui-drawer-body');
  if (o.content) body.append(o.content);
  panel.append(head, body);
  scrim.append(panel);
  document.body.append(scrim);
  openDrawers++;
  const before = document.activeElement as HTMLElement | null;
  requestAnimationFrame(() => scrim.classList.add('is-open'));

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openDrawers--;
    window.removeEventListener('keydown', onKey, true);
    scrim.classList.remove('is-open');
    panel.style.transform = '';
    const done = () => { scrim.remove(); before?.focus?.(); o.onClose?.(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setTimeout(done, 220);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });

  // Drag the chevron (or the head) down to close; a short tap closes too.
  let startY = 0;
  let dy = 0;
  let dragging = false;
  head.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    dy = 0;
    head.setPointerCapture(e.pointerId);
    panel.classList.add('is-dragging');
  });
  head.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translate(-50%, ${dy}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('is-dragging');
    if (dy > 80 || dy < 6) close();
    else panel.style.transform = '';
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', () => { dragging = false; panel.classList.remove('is-dragging'); panel.style.transform = ''; });
  handle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } });
  handle.focus({ preventScroll: true });
  return { el: panel, body, close };
}

/** True while any drawer is open, so screens can ignore their own keys meanwhile. */
export const drawerOpen = (): boolean => openDrawers > 0;

// ---- Disclosure (expand / collapse) --------------------------------------------------------
//
// A card that folds detail away: a title row with an optional hint (a count, a unit) and a
// round chevron that turns as it opens; the body slides open. It is a native <details>, so it
// works in HTML strings, with the keyboard and without script; with script the height animates.
//
//   body.innerHTML = disclosureHTML({ title: 'All the numbers', hint: '32 rows', body: table });
//   root.append(createDisclosure({ title: 'Why', body: node }));

export interface DisclosureOptions {
  title: string;
  /** Short text at the right of the title row, before the chevron. */
  hint?: string;
  /** HTML string, or a Node for createDisclosure. */
  body: string | Node;
  open?: boolean;
  /** Extra class on the <details>. */
  className?: string;
}

/** The disclosure as an HTML string; animation is wired once for the whole page. */
export function disclosureHTML(o: DisclosureOptions & { body: string }): string {
  bindDisclosures();
  return `<details class="ui-disclosure${o.className ? ' ' + o.className : ''}"${o.open ? ' open' : ''}>`
    + `<summary class="ui-disclosure-head"><span class="ui-disclosure-title">${esc(o.title)}</span>`
    + `${o.hint ? `<span class="ui-disclosure-hint">${esc(o.hint)}</span>` : ''}`
    + `<span class="ui-disclosure-chev" aria-hidden="true">${ICON_CHEVRON}</span></summary>`
    + `<div class="ui-disclosure-body"><div class="ui-disclosure-in">${o.body}</div></div></details>`;
}

/** The disclosure as an element. */
export function createDisclosure(o: DisclosureOptions): HTMLDetailsElement {
  const holder = document.createElement('div');
  holder.innerHTML = disclosureHTML({ ...o, body: typeof o.body === 'string' ? o.body : '' });
  const d = holder.firstElementChild as HTMLDetailsElement;
  if (typeof o.body !== 'string') d.querySelector('.ui-disclosure-in')!.append(o.body);
  return d;
}

let disclosuresBound = false;
/** One listener animates every disclosure: the body grows from 0 to its height, or back. */
export function bindDisclosures(): void {
  if (disclosuresBound || typeof document === 'undefined') return;
  disclosuresBound = true;
  document.addEventListener('click', (e) => {
    const head = (e.target as HTMLElement).closest?.('.ui-disclosure-head');
    const d = head?.parentElement as HTMLDetailsElement | null;
    if (!head || !d?.classList.contains('ui-disclosure')) return;
    const body = d.querySelector<HTMLElement>('.ui-disclosure-body');
    if (!body || !body.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    const opening = !d.open;
    d.classList.toggle('is-opening', opening);
    if (opening) d.open = true;
    const full = body.scrollHeight;
    const a = body.animate(
      opening ? [{ height: '0px', opacity: 0 }, { height: `${full}px`, opacity: 1 }] : [{ height: `${full}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
      { duration: Math.min(420, 180 + full * 0.25), easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    );
    if (!opening) d.classList.add('is-closing');
    a.onfinish = () => {
      if (!opening) d.open = false;
      d.classList.remove('is-opening', 'is-closing');
    };
  });
}
