// Nu, the guide: a neutrino, a point of light with no face. It rests as the Next icon (a dot
// left of a play triangle, reading as an arrow) and moves as a dot with a fading trail. These
// helpers draw it and move it; nextButton and confirmDialog (components.ts) use them, and
// firstTimeLine lets it speak once when something happens for the first time.
//
// Every motion here is skipped under Reduce motion (the system setting or the app's own), and
// the flying and speaking stop when the player turns Nu off in Settings (nuEnabled).

import { loadSave, writeSave } from '../core/save';
import { icon } from './icons';

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

/** The Nu icon drawn in two parts, so the landing can show the dot first and then reveal the
 *  triangle with a mask that grows rightward from the dot. Same shape as icons/nu.svg. */
export function nuIconHtml(size = 20): string {
  const id = `nu-clip-${++uid}`;
  return `<svg class="nu-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`
    + `<defs><clipPath id="${id}"><rect class="nu-mask" x="7.6" y="2" width="15" height="20"/></clipPath></defs>`
    + `<circle class="nu-dot" cx="4.4" cy="12" r="2.65" fill="currentColor"/>`
    + `<path class="nu-tri" clip-path="url(#${id})" d="M10.2 5.6V18.4L20 12Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`
    + `</svg>`;
}

/** Nu lands: the dot arrives, then the triangle is revealed left to right, about 600 ms.
 *  `root` holds an icon from nuIconHtml. Resolves when done (at once under Reduce motion). */
export function landNu(root: Element): Promise<void> {
  const dot = root.querySelector<SVGElement>('.nu-dot');
  const mask = root.querySelector<SVGElement>('.nu-mask');
  if (!dot || !mask || !dot.animate || reducedMotion()) return Promise.resolve();
  dot.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.35)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 260, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' });
  const sweep = mask.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
    { duration: 340, delay: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'backwards' });
  return sweep.finished.then(() => undefined, () => undefined);
}

/** A dot orbiting an icon, for the confirm dialog while it waits. `settle()` brings Nu back into
 *  the middle and fades it (on Cancel). */
export function nuOrbit(iconName: 'restart' | 'atom'): { el: HTMLElement; settle(): Promise<void> } {
  const el = document.createElement('div');
  el.className = reducedMotion() ? 'nu-orbit is-still' : 'nu-orbit';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="nu-orbit-icon">${icon(iconName, { size: 30 })}</span><span class="nu-orbit-arm"><i class="nu-orbit-dot"></i></span>`;
  const settle = (): Promise<void> => {
    const arm = el.querySelector<HTMLElement>('.nu-orbit-arm')!;
    const dot = el.querySelector<HTMLElement>('.nu-orbit-dot')!;
    if (!dot.animate || reducedMotion()) return Promise.resolve();
    arm.style.animationPlayState = 'paused';
    return dot.animate([{ transform: 'translateX(0) scale(1)', opacity: 1 }, { transform: 'translateX(-30px) scale(0.3)', opacity: 0 }],
      { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }).finished.then(() => undefined, () => undefined);
  };
  return { el, settle };
}

/** Nu streaks across `over` (or the screen) from left to right with a fading trail, like a track
 *  in a cloud chamber. `onSweep(p)` runs every frame with p from 0 to 1, so the caller can fade
 *  what lies behind the trail. Resolves when Nu has crossed. Under Reduce motion it calls
 *  onSweep(1) once and resolves. */
export function nuStreak(over?: Element | null, onSweep?: (p: number) => void, ms = 560): Promise<void> {
  if (reducedMotion()) {
    onSweep?.(1);
    return Promise.resolve();
  }
  const r = over?.getBoundingClientRect() ?? new DOMRect(0, window.innerHeight * 0.4, window.innerWidth, window.innerHeight * 0.2);
  const layer = document.createElement('div');
  layer.className = 'nu-streak';
  layer.style.cssText = `left:${r.left}px;top:${r.top + r.height / 2}px;width:${r.width}px`;
  layer.innerHTML = '<i class="nu-streak-trail"></i><i class="nu-streak-dot"></i>';
  document.body.append(layer);
  const dot = layer.querySelector<HTMLElement>('.nu-streak-dot')!;
  const trail = layer.querySelector<HTMLElement>('.nu-streak-trail')!;
  return new Promise((done) => {
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const p = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in and out
      dot.style.transform = `translateX(${p * r.width}px)`;
      trail.style.width = `${p * r.width}px`;
      trail.style.opacity = String(1 - t * 0.6);
      onSweep?.(p);
      if (t < 1) requestAnimationFrame(frame);
      else {
        layer.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.finally(() => layer.remove());
        if (!layer.animate) layer.remove();
        done();
      }
    };
    requestAnimationFrame(frame);
  });
}

const TRAIL_MS = 160;

/** Nu flies from `from` (an element or a rectangle) to `to`, a dot with a fading trail along a
 *  gentle arc, then lands: it stops where the icon's dot sits and the triangle is revealed. `to`
 *  should hold an icon from nuIconHtml (a nextButton or a first-time line); anything else gets
 *  the flight to its middle. Under a second. With Nu off or Reduce motion it only lands (which
 *  is instant under Reduce motion). */
export function nuFly(from: Element | DOMRect, to: Element): Promise<void> {
  if (!nuEnabled() || reducedMotion() || !to.isConnected) return landNu(to);
  const a = from instanceof Element ? from.getBoundingClientRect() : from;
  const dotEl = to.querySelector('.nu-dot');
  const b = (dotEl ?? to).getBoundingClientRect();
  const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
  // Bow the path sideways by a fifth of its length, so it reads as flight rather than a slide.
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const cx = (x0 + x1) / 2 - dy * 0.2, cy = (y0 + y1) / 2 + dx * 0.2;
  const at = (t: number): [number, number] => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1];
  const icon = to.querySelector<SVGElement>('.nu-icon');
  if (icon) icon.style.opacity = '0';
  const layer = document.createElement('div');
  layer.className = 'nu-fly';
  const SEGS = 12;
  layer.innerHTML = `<svg width="100%" height="100%">${Array.from({ length: SEGS }, (_, i) => `<line style="opacity:${(1 - i / SEGS).toFixed(2)};stroke-width:${(3.4 * (1 - i / SEGS) + 0.4).toFixed(2)}"/>`).join('')}</svg><b></b>`;
  document.body.append(layer);
  const trail = layer.querySelector<SVGSVGElement>('svg')!;
  const segs = [...trail.querySelectorAll('line')];
  const head = layer.querySelector<HTMLElement>('b')!;
  const ms = Math.min(900, 420 + len * 0.6);
  const ease = (t: number) => 1 - (1 - t) ** 3; // fast start, soft stop
  return new Promise((done) => {
    const t0 = performance.now();
    const frame = (now: number) => {
      const el = now - t0;
      const t = Math.min(1, el / ms);
      const [x, y] = at(ease(t));
      head.style.transform = `translate(${x}px, ${y}px)`;
      // The trail: where Nu was over the last TRAIL_MS, fading toward its tail.
      const pts = Array.from({ length: SEGS + 1 }, (_, i) => at(ease(Math.max(0, Math.min(1, (el - (TRAIL_MS * i) / SEGS) / ms)))));
      segs.forEach((l, i) => {
        l.setAttribute('x1', pts[i][0].toFixed(1)); l.setAttribute('y1', pts[i][1].toFixed(1));
        l.setAttribute('x2', pts[i + 1][0].toFixed(1)); l.setAttribute('y2', pts[i + 1][1].toFixed(1));
      });
      trail.style.opacity = String(1 - t * 0.7);
      if (t < 1) { requestAnimationFrame(frame); return; }
      layer.remove();
      if (icon) icon.style.opacity = '';
      void landNu(to).then(done);
    };
    requestAnimationFrame(frame);
  });
}

/** A line Nu says once, the first time something happens: the Nu icon and one sentence, placed
 *  just above `anchor`. Nu flies in from the top of the screen and the words fade in. It goes
 *  away (and counts as seen) once the player acts: the next tap anywhere, or a key. If it is
 *  taken off the page before that, it shows again next time. Returns null when this id has
 *  been seen, or when Nu is off in Settings.
 *
 *    firstTimeLine('first-build', 'Each atom is two puzzles: its nucleus and its electrons. Play either one.', cards);
 */
export function firstTimeLine(id: string, text: string, anchor: Element): HTMLElement | null {
  if (!nuEnabled() || loadSave().seenLines[id]) return null;
  const line = document.createElement('p');
  line.className = 'nu-line';
  line.setAttribute('role', 'status');
  line.innerHTML = `${nuIconHtml(18)}<span></span>`;
  line.querySelector('span')!.textContent = text;
  anchor.before(line);
  const still = reducedMotion();
  if (!still) {
    line.classList.add('is-arriving');
    void nuFly(new DOMRect(window.innerWidth / 2, -20, 0, 0), line).then(() => line.classList.remove('is-arriving'));
  }
  const shownAt = performance.now();
  const act = () => {
    if (performance.now() - shownAt < 600) return; // the tap that brought it doesn't count
    window.removeEventListener('pointerdown', act, true);
    window.removeEventListener('keydown', act, true);
    const save = loadSave();
    save.seenLines[id] = Date.now();
    writeSave(save);
    if (still || !line.animate) { line.remove(); return; }
    line.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 260, easing: 'ease-in' }).finished.finally(() => line.remove());
  };
  window.addEventListener('pointerdown', act, true);
  window.addEventListener('keydown', act, true);
  return line;
}
