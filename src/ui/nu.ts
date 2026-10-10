// Nu, the guide: a neutrino, a point of light with no face. It rests as the Next icon (a dot
// left of a play triangle, reading as an arrow) and moves as a dot with a fading trail. These
// helpers draw it and move it; nextButton and confirmDialog (components.ts) use them.
//
// Every motion here is skipped under Reduce motion (the system setting or the app's own).

import { loadSave } from '../core/save';
import { icon } from './icons';

/** Reduce motion: the system setting or the app's Settings switch. */
export function reducedMotion(): boolean {
  try {
    if (loadSave().settings.reducedMotion) return true;
  } catch { /* no storage: fall through */ }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
