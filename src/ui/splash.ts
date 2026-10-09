// The splash: the lithium-ion mark assembling itself on the plate while the app boots.
// Nucleons pop into the honeycomb, the shell draws itself, and the two electrons swing
// round the ring into their gaps. Then the plate lifts and the gallery is underneath.
// With reduced motion the finished mark simply shows for a moment and fades.

import { markInner } from './mark';

const HOLD_MS = 2150;        // when the fade starts, after the electrons have settled
const REDUCED_HOLD_MS = 900;
const FADE_MS = 450;

export function showSplash(): void {
  const el = document.createElement('div');
  el.className = 'splash';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="grain"></div>
    <svg class="splash-mark" viewBox="0 0 100 100">${markInner()}</svg>
    <div class="splash-word">Atomos</div>
    <div class="splash-sub">every atom, up close</div>`;
  document.body.appendChild(el);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) el.classList.add('play');

  const lift = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), FADE_MS + 50);
  };
  setTimeout(lift, reduced ? REDUCED_HOLD_MS : HOLD_MS);
  // A tap skips straight to the app.
  el.addEventListener('pointerdown', lift, { once: true });
}
