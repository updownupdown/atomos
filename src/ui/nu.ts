// Nu, the guide: a neutrino, a point of light with no face, and there is only ever one. It rests
// in the Home icon, or in the dot of the screen's Next icon (a dot left of a play triangle,
// reading as an arrow), and moves as a dot with a fading trail, always from where it is. These
// helpers draw it and move it (see "The one Nu" below); nextButton and confirmDialog
// (components.ts) use them, and firstTimeLine lets it speak once when something happens for
// the first time.
//
// Every motion here is skipped under Reduce motion (the system setting or the app's own), and
// the flying and speaking stop when the player turns Nu off in Settings (nuEnabled).

import { loadSave, writeSave } from '../core/save';

/** Reduce motion: the system setting or the app's Settings switch. */
export function reducedMotion(): boolean {
  try {
    if (loadSave().settings.reducedMotion) return true;
  } catch { /* no storage: fall through */ }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Whether Nu flies and speaks (Settings, on by default). Off, only the still icon on Next stays. */
export function nuEnabled(): boolean {
  try {
    return loadSave().settings.nu !== false;
  } catch {
    return true;
  }
}

let uid = 0;

/** The Nu icon: the dot (Nu's slot, an empty ring until Nu lands in it) and the play triangle,
 *  so the landing can reveal the triangle with a mask that grows rightward from the dot. Same
 *  shape as icons/nu.svg. With Nu off in Settings the ring is drawn solid, as a printed icon. */
export function nuIconHtml(size = 20): string {
  const id = `nu-clip-${++uid}`;
  return `<svg class="nu-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`
    + `<defs><clipPath id="${id}"><rect class="nu-mask" x="7.6" y="2" width="15" height="20"/></clipPath></defs>`
    + `<circle class="nu-dot nu-slot" cx="4.4" cy="12" r="2.65"/>`
    + `<path class="nu-tri" clip-path="url(#${id})" d="M10.2 5.6V18.4L20 12Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`
    + `</svg>`;
}

/** A Next button first seen: the triangle is revealed left to right from the dot, about 350 ms.
 *  `root` holds an icon from nuIconHtml. Resolves when done (at once under Reduce motion). */
export function landNu(root: Element): Promise<void> {
  const mask = root.querySelector<SVGElement>('.nu-mask');
  if (!mask || !mask.animate || reducedMotion()) return Promise.resolve();
  const sweep = mask.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
    { duration: 340, delay: 120, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'backwards' });
  return sweep.finished.then(() => undefined, () => undefined);
}

/** Nu streaks across `over` (or the screen) from left to right, like a track in a cloud chamber:
 *  Nu flies from wherever it is to the left edge, gathers, races across with a trail and a rose
 *  wake the height of the board, and bursts in a ring at the right edge, from where it flies
 *  home. `onSweep(p)` runs at once with 0, then every frame of the crossing with p from 0 to 1,
 *  so the caller can fade what lies behind the wake. Resolves when Nu has crossed. Under Reduce
 *  motion, or with Nu off, it calls onSweep(1) once and resolves. */
export async function nuStreak(over?: Element | null, onSweep?: (p: number) => void, ms = 620): Promise<void> {
  if (reducedMotion() || !nuEnabled()) {
    onSweep?.(1);
    return;
  }
  onSweep?.(0);
  const r0 = over?.getBoundingClientRect() ?? new DOMRect(0, window.innerHeight * 0.25, window.innerWidth, window.innerHeight * 0.5);
  await guide().travel({ x: r0.left, y: r0.top + r0.height / 2 }, 460);
  const r = over?.getBoundingClientRect() ?? r0;
  const layer = document.createElement('div');
  layer.className = 'nu-streak';
  layer.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  layer.innerHTML = '<i class="nu-streak-wake"></i><i class="nu-streak-trail"></i><i class="nu-streak-dot"></i><i class="nu-streak-ring"></i>';
  document.body.append(layer);
  guide().hold();
  const dot = layer.querySelector<HTMLElement>('.nu-streak-dot')!;
  const trail = layer.querySelector<HTMLElement>('.nu-streak-trail')!;
  const wake = layer.querySelector<HTMLElement>('.nu-streak-wake')!;
  const ring = layer.querySelector<HTMLElement>('.nu-streak-ring')!;
  const GATHER = 180;
  return new Promise((done) => {
    const t0 = performance.now();
    const frame = (now: number) => {
      const el = now - t0;
      if (el < GATHER) {
        // Gathering: Nu swells at the left edge.
        const g = el / GATHER;
        dot.style.transform = `translateX(0) scale(${(g < 0.7 ? 0.7 + g / 0.7 * 1.2 : 1.9 - (g - 0.7) / 0.3 * 0.9).toFixed(3)})`;
        requestAnimationFrame(frame);
        return;
      }
      const t = Math.min(1, (el - GATHER) / ms);
      const p = t * t * (3 - 2 * t); // smoothstep: a quick launch, a clean exit
      const x = p * r.width;
      dot.style.transform = `translateX(${x}px)`;
      trail.style.width = `${x}px`;
      wake.style.width = `${x}px`;
      wake.style.opacity = String(1 - t * 0.5);
      onSweep?.(p);
      if (t < 1) { requestAnimationFrame(frame); return; }
      ring.style.left = `${r.width}px`;
      ring.classList.add('is-on');
      dot.remove();
      // Nu carries on from the right edge, back to where it rests.
      guide().release({ x: r.left + r.width, y: r.top + r.height / 2 });
      if (!layer.animate) { layer.remove(); done(); return; }
      layer.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: 520 }).finished.finally(() => layer.remove());
      done();
    };
    requestAnimationFrame(frame);
  });
}

// ---- The one Nu -------------------------------------------------------------------------------
//
// There is one Nu on the screen. It rests in a slot: the empty ring in the middle of the Home
// icon (.nu-home-slot) when it has nothing to show, or the ring in the Nu icon of whatever is
// marked data-nu-perch and in view (the screen's Next button, a first-time line, a guide card),
// the highest data-nu-perch number first. At rest the slot itself is filled (.is-nu) and the
// flying dot is hidden. When the slot it wants changes, Nu flies there from wherever it is, on
// a gentle arc with a fading trail; it never appears from nowhere.
//
// nuShow(el) sends it to circle something for 5 s, after which it goes back to rest and leaves
// that thing alone for a minute. Any touch elsewhere, or the thing leaving the screen, sends it
// back at once. With Nu off in Settings there is no Nu at all (body.nu-off): the slots are drawn
// as printed dots, and the Home icon's is hidden.

/** How long Nu circles something, and how long before the same thing may be shown again. */
export const NU_SHOW_MS = 5000;
export const NU_COOLDOWN_MS = 60_000;
/** Once round, in ms, while circling. */
const NU_TURN_MS = 2600;
const TRAIL_MS = 160;
const SEGS = 12;
/** The flying dot's size, in px; it shrinks to the slot's size as it lands. */
const HEAD = 10;

type Pt = { x: number; y: number };
/** What Nu circles: an element, or a function giving a rectangle on screen (null once it's gone). */
export type NuTarget = Element | (() => DOMRect | null);

export interface NuShowOptions {
  /** Shown once a minute at most under this key. */
  key?: string;
  /** How long Nu circles, in ms, from when it arrives. Default 5 s. */
  ms?: number;
  /** The circle's radius in px; by default just outside the target. */
  r?: number;
}

interface Task {
  target: NuTarget | Pt;
  ms: number;
  r?: number;
  /** When it set off (the circle's clock), the angle it joins the circle at, and when it arrived. */
  t0: number;
  a0: number;
  arrived: number;
  /** Not ended by a touch (a trip to a point, for the streak). */
  sticky?: boolean;
  onArrive?: () => void;
}

const hasDom = (): boolean => typeof document !== 'undefined' && typeof window !== 'undefined';

function middle(r: DOMRect): Pt {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Whether a rectangle's middle is on screen. */
function inView(r: DOMRect): boolean {
  if (!r.width && !r.height) return false;
  const m = middle(r);
  return m.x >= 0 && m.y >= 0 && m.x <= window.innerWidth && m.y <= window.innerHeight;
}

/** Whether a slot can be seen: laid out, on screen and, for a perch, not under something else. */
function visible(slot: Element, covered: boolean): boolean {
  if (!slot.isConnected || !slot.getClientRects().length) return false;
  const r = slot.getBoundingClientRect();
  if (!inView(r)) return false;
  if (!covered) return true;
  const m = middle(r);
  const hit = document.elementFromPoint(m.x, m.y);
  const host = slot.closest('[data-nu-perch]') ?? slot;
  return !!hit && (host.contains(hit) || hit.contains(host));
}

class Guide {
  private layer!: HTMLElement;
  private head!: HTMLElement;
  private lines: SVGLineElement[] = [];
  private trail!: SVGSVGElement;
  private started = false;
  /** Where Nu is (the flying dot, or the slot it rests in). Null before it has been anywhere. */
  private pos: Pt | null = null;
  /** The slot Nu rests in, filled. */
  private rest: Element | null = null;
  /** The slot it is flying to, to rest. */
  private toward: Element | null = null;
  private task: Task | null = null;
  private flight: { from: Pt; t0: number; ms: number } | null = null;
  private hist: { x: number; y: number; t: number }[] = [];
  private frame = 0;
  private queued = 0;
  private held = false;
  private cool = new Map<string, number>();

  start(): void {
    if (this.started || !hasDom()) return;
    this.started = true;
    this.layer = document.createElement('div');
    this.layer.className = 'nu-guide';
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.innerHTML = `<svg width="100%" height="100%">${Array.from({ length: SEGS }, (_, i) => `<line style="opacity:${(1 - i / SEGS).toFixed(2)};stroke-width:${(3.4 * (1 - i / SEGS) + 0.4).toFixed(2)}"/>`).join('')}</svg><b></b>`;
    document.body.append(this.layer);
    this.trail = this.layer.querySelector('svg')!;
    this.lines = [...this.trail.querySelectorAll('line')];
    this.head = this.layer.querySelector('b')!;
    const look = () => this.soon();
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-nu-perch', 'class'] });
    window.addEventListener('scroll', look, { capture: true, passive: true });
    window.addEventListener('resize', look);
    window.addEventListener('atomos:settings', look);
    // A touch anywhere but on what Nu is showing sends it back.
    window.addEventListener('pointerdown', (e) => {
      const t = this.task;
      if (!t || t.sticky) return;
      if (t.target instanceof Element && t.target.contains(e.target as Node)) return;
      this.endTask();
    }, true);
    this.soon();
  }

  /** Looks again on the next frame. */
  soon(): void {
    if (!this.started || this.queued) return;
    this.queued = requestAnimationFrame(() => { this.queued = 0; this.look(); });
  }

  show(target: NuTarget, o: NuShowOptions): boolean {
    if (!hasDom() || !nuEnabled()) return false;
    this.start();
    const now = performance.now();
    if (o.key) {
      const last = this.cool.get(o.key);
      if (last !== undefined && now - last < NU_COOLDOWN_MS) return true;
      this.cool.set(o.key, now);
    }
    if (!this.rectOf(target)) return true;
    this.begin({ target, ms: o.ms ?? NU_SHOW_MS, r: o.r, t0: now, a0: 0, arrived: 0 });
    return true;
  }

  /** Flies to a point and resolves when there (at once if Nu has never been anywhere). */
  travel(to: Pt, maxMs: number): Promise<void> {
    this.start();
    return new Promise((done) => {
      this.begin({ target: to, ms: 0, t0: performance.now(), a0: 0, arrived: 0, sticky: true, onArrive: done }, maxMs);
    });
  }

  /** Hides Nu while someone else draws it (the streak). */
  hold(): void {
    this.held = true;
    this.task = null;
    this.flight = null;
    this.layer.classList.remove('is-on');
  }

  /** Nu is back, at `at`, and goes to rest from there. */
  release(at: Pt): void {
    this.held = false;
    this.pos = at;
    this.place(at, 1);
    this.layer.classList.add('is-on');
    this.look();
  }

  /** Back to rest now. */
  home(): void {
    this.endTask();
  }

  private endTask(): void {
    if (!this.task) return;
    const t = this.task;
    this.task = null;
    this.flight = null;
    t.onArrive?.();
    this.look();
  }

  private begin(t: Task, maxMs = 900): void {
    if (this.rest?.isConnected && this.rest.getClientRects().length) this.pos = this.clamp(middle(this.rest.getBoundingClientRect()));
    this.leaveRest();
    if (!this.pos) {
      // Nowhere yet: start where it is going.
      const r = this.rectOf(t.target);
      if (r) this.pos = middle(r);
    }
    const from = this.pos ?? { x: window.innerWidth / 2, y: window.innerHeight };
    const goal = this.taskPoint(t, performance.now(), from);
    t.a0 = goal ? Math.atan2(from.y - goal.c.y, from.x - goal.c.x) : 0;
    this.task = t;
    this.toward = null;
    this.fly(from, maxMs);
  }

  /** Where the task's target is on screen now. */
  private rectOf(target: NuTarget | Pt): DOMRect | null {
    if (typeof target === 'function') return target();
    if (target instanceof Element) {
      if (!target.isConnected || !target.getClientRects().length) return null;
      const r = target.getBoundingClientRect();
      return inView(r) ? r : null;
    }
    return new DOMRect(target.x, target.y, 0, 0);
  }

  /** The point Nu should be at for this task now, and the middle it circles. */
  private taskPoint(t: Task, now: number, from?: Pt): { p: Pt; c: Pt } | null {
    const r = this.rectOf(t.target);
    if (!r) return null;
    const c = middle(r);
    if (!(t.target instanceof Element) && typeof t.target !== 'function') return { p: c, c };
    const rad = t.r ?? Math.max(16, Math.max(r.width, r.height) / 2 + 8);
    let o: Pt;
    if (reducedMotion()) o = { x: rad * Math.SQRT1_2, y: -rad * Math.SQRT1_2 };
    else {
      const a0 = from ? Math.atan2(from.y - c.y, from.x - c.x) : t.a0;
      const a = a0 + ((now - t.t0) / NU_TURN_MS) * 2 * Math.PI;
      o = { x: rad * Math.cos(a), y: rad * Math.sin(a) };
    }
    const m = 6;
    return { p: { x: Math.max(m, Math.min(window.innerWidth - m, c.x + o.x)), y: Math.max(m, Math.min(window.innerHeight - m, c.y + o.y)) }, c };
  }

  /** The slot Nu should rest in now: the best perch in view, or home. */
  private restSlot(): Element | null {
    let best: Element | null = null, rank = -Infinity;
    for (const host of document.querySelectorAll<HTMLElement>('[data-nu-perch]')) {
      const slot = host.querySelector('.nu-slot');
      const n = Number(host.dataset.nuPerch) || 1;
      // A line or card (9) floats on top; a Next button may be under a sheet or modal.
      if (!slot || n <= rank || !visible(slot, n < 9)) continue;
      best = slot; rank = n;
    }
    if (best) return best;
    for (const slot of document.querySelectorAll('.nu-home-slot')) if (visible(slot, false)) return slot;
    return null;
  }

  private look(): void {
    if (!this.started) return;
    const on = nuEnabled();
    document.body.classList.toggle('nu-off', !on);
    if (!on) {
      this.task = null;
      this.flight = null;
      this.toward = null;
      this.leaveRest();
      this.layer.classList.remove('is-on');
      return;
    }
    if (this.held) return;
    if (this.task) {
      if (!this.rectOf(this.task.target)) { this.endTask(); return; }
      this.run();
      return;
    }
    const slot = this.restSlot();
    if (slot && (slot === this.rest || slot === this.toward)) return;
    if (this.rest && slot !== this.rest) {
      if (this.rest.isConnected && this.rest.getClientRects().length) this.pos = this.clamp(middle(this.rest.getBoundingClientRect()));
      this.leaveRest();
    }
    if (!slot) {
      // Nowhere to rest (the dock is hidden): Nu fades where it is.
      this.toward = null;
      this.flight = null;
      this.layer.classList.remove('is-on');
      return;
    }
    const at = middle(slot.getBoundingClientRect());
    if (!this.pos || reducedMotion() || Math.hypot(at.x - this.pos.x, at.y - this.pos.y) < 4) {
      this.land(slot);
      return;
    }
    this.toward = slot;
    this.fly(this.pos);
  }

  private clamp(p: Pt): Pt {
    return { x: Math.max(0, Math.min(window.innerWidth, p.x)), y: Math.max(0, Math.min(window.innerHeight, p.y)) };
  }

  private fly(from: Pt, maxMs = 900): void {
    const goal = this.goal(performance.now());
    const len = goal ? Math.hypot(goal.x - from.x, goal.y - from.y) : 0;
    this.flight = { from, t0: performance.now(), ms: reducedMotion() ? 0 : Math.min(maxMs, 380 + len * 0.6) };
    this.hist = [];
    this.layer.classList.add('is-on');
    this.run();
  }

  /** Where Nu is heading this frame. */
  private goal(now: number): Pt | null {
    if (this.task) return this.taskPoint(this.task, now)?.p ?? null;
    if (this.toward?.isConnected) return middle(this.toward.getBoundingClientRect());
    return null;
  }

  private run(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = 0;
    if (this.held) return;
    const g = this.goal(now);
    if (!g) { this.flight = null; this.look(); return; }
    let p = g, k = 1;
    const f = this.flight;
    if (f) {
      const t = f.ms ? Math.min(1, (now - f.t0) / f.ms) : 1;
      const e = 1 - (1 - t) ** 3; // fast start, soft stop
      // Bow the path sideways by a fifth of its length, so it reads as flight, not a slide.
      const dx = g.x - f.from.x, dy = g.y - f.from.y;
      const cx = (f.from.x + g.x) / 2 - dy * 0.2, cy = (f.from.y + g.y) / 2 + dx * 0.2;
      p = { x: (1 - e) ** 2 * f.from.x + 2 * (1 - e) * e * cx + e * e * g.x, y: (1 - e) ** 2 * f.from.y + 2 * (1 - e) * e * cy + e * e * g.y };
      if (this.toward) {
        const size = this.toward.getBoundingClientRect().width || HEAD;
        k = 1 + (Math.min(1, size / HEAD) - 1) * e * e;
      }
      if (t >= 1) {
        this.flight = null;
        if (this.toward) { this.pos = g; this.land(this.toward); return; }
        const task = this.task;
        if (task && !task.arrived) {
          task.arrived = now;
          if (task.onArrive && task.sticky) { this.pos = g; this.task = null; task.onArrive(); this.place(g, 1); return; }
        }
      }
    }
    const task = this.task;
    if (task && task.arrived && !this.flight && now - task.arrived >= task.ms) {
      this.pos = p;
      this.endTask();
      return;
    }
    this.pos = p;
    this.place(p, k);
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Draws the dot at `p` (scaled by k) and the trail behind it. */
  private place(p: Pt, k: number): void {
    const now = performance.now();
    this.head.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${k.toFixed(3)})`;
    this.hist.unshift({ x: p.x, y: p.y, t: now });
    while (this.hist.length > 2 && now - this.hist[this.hist.length - 1].t > TRAIL_MS) this.hist.pop();
    const at = (age: number): Pt => this.hist.find((h) => now - h.t >= age) ?? this.hist[this.hist.length - 1];
    this.lines.forEach((l, i) => {
      const a = at((TRAIL_MS * i) / SEGS), b = at((TRAIL_MS * (i + 1)) / SEGS);
      l.setAttribute('x1', a.x.toFixed(1)); l.setAttribute('y1', a.y.toFixed(1));
      l.setAttribute('x2', b.x.toFixed(1)); l.setAttribute('y2', b.y.toFixed(1));
    });
  }

  private land(slot: Element): void {
    this.toward = null;
    this.flight = null;
    this.rest = slot;
    this.pos = middle(slot.getBoundingClientRect());
    slot.classList.add('is-nu');
    this.layer.classList.remove('is-on');
    this.hist = [];
    (slot.closest('[data-nu-perch]') ?? slot).dispatchEvent(new CustomEvent('nu:land'));
  }

  private leaveRest(): void {
    this.rest?.classList.remove('is-nu');
    this.rest = null;
  }
}

let theGuide: Guide | null = null;
function guide(): Guide {
  theGuide ??= new Guide();
  theGuide.start();
  return theGuide;
}

/** Wakes Nu: it settles in its slot and starts watching the screen. The shell calls this once. */
export function startNu(): void {
  if (hasDom()) guide();
}

/** Nu circles `target` for 5 s (or `o.ms`), then goes back to rest. A touch anywhere else, or the
 *  target leaving the screen, ends it early. With a `key`, the same thing is shown once a minute
 *  at most. False when there is no Nu to send (off in Settings), so the caller can fall back. */
export function nuShow(target: NuTarget, o: NuShowOptions = {}): boolean {
  if (!hasDom()) return false;
  return guide().show(target, o);
}

/** Sends Nu back to rest now. */
export function nuHome(): void {
  theGuide?.home();
}

/** Whether a first-time line or offer may still show: Nu is on and it hasn't been acted on. */
export function firstTimeDue(id: string): boolean {
  return nuEnabled() && !loadSave().seenLines[id];
}

/** Records a first-time line or offer as seen, so it never shows again. */
export function markSeen(id: string): void {
  const save = loadSave();
  save.seenLines[id] = Date.now();
  writeSave(save);
}

/** A line Nu says once, the first time something happens: the Nu icon and one sentence, placed
 *  just above `anchor`. Nu flies into it from wherever it is and the words fade in. It goes
 *  away (and counts as seen) once the player acts: the next tap anywhere, or a key. If it is
 *  taken off the page before that, it shows again next time. Returns null when this id has
 *  been seen, or when Nu is off in Settings.
 *
 *    firstTimeLine('first-build', 'Each atom is two puzzles: its nucleus and its electrons. Play either one.', cards);
 */
export function firstTimeLine(id: string, text: string, anchor: Element): HTMLElement | null {
  if (!firstTimeDue(id)) return null;
  const line = document.createElement('p');
  line.className = 'nu-line';
  line.setAttribute('role', 'status');
  line.dataset.nuPerch = '9';
  line.innerHTML = `${nuIconHtml(18)}<span></span>`;
  line.querySelector('span')!.textContent = text;
  anchor.before(line);
  const still = reducedMotion();
  if (!still) {
    // The words fade in once Nu has landed in the line's icon.
    line.classList.add('is-arriving');
    const shown = () => line.classList.remove('is-arriving');
    line.addEventListener('nu:land', shown, { once: true });
    window.setTimeout(shown, 1200);
  }
  startNu();
  const shownAt = performance.now();
  const act = () => {
    if (performance.now() - shownAt < 600) return; // the tap that brought it doesn't count
    window.removeEventListener('pointerdown', act, true);
    window.removeEventListener('keydown', act, true);
    markSeen(id);
    delete line.dataset.nuPerch;
    if (still || !line.animate) { line.remove(); return; }
    line.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 260, easing: 'ease-in' }).finished.finally(() => line.remove());
  };
  window.addEventListener('pointerdown', act, true);
  window.addEventListener('keydown', act, true);
  return line;
}
