// The panel that celebrates a solved puzzle: a burst of light, what was won,
// the numbers that matter, and big buttons for what to do next. Shared by
// Build and the Puzzles screen.

import { C, syncPalette } from './palette';
import { nextButton } from '../ui/components';

export interface WinStat {
  label: string;
  value: string;
}

export interface WinAction {
  label: string;
  primary?: boolean;
  /** The Next step: drawn as the app's one Next button, ahead of the others. */
  next?: boolean;
  onClick: () => void;
}

export interface WinInfo {
  /** A word above the title: "Flawless", "Solved", "Built". */
  kicker: string;
  title: string;
  flawless: boolean;
  stats: WinStat[];
  /** What this win means in the game, in a sentence. */
  note?: string;
  actions: WinAction[];
}

/** Shows the panel over `host` (which must be positioned). Returns a function that closes it. */
export function showWin(host: HTMLElement, info: WinInfo, reducedMotion = false): () => void {
  host.querySelector('.win')?.remove();
  const root = document.createElement('div');
  root.className = `win${info.flawless ? ' win--flawless' : ''}${reducedMotion ? ' win--still' : ''}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', info.title);
  root.innerHTML = `
    <div class="win-card">
      <canvas class="win-burst" aria-hidden="true"></canvas>
      <div class="win-mark" aria-hidden="true">${info.flawless ? STAR : CHECK}</div>
      <p class="win-kicker">${info.kicker}</p>
      <h2 class="win-title">${info.title}</h2>
      ${info.stats.length ? `<dl class="win-stats">${info.stats.map((s) => `<div><dt>${s.label}</dt><dd>${s.value}</dd></div>`).join('')}</dl>` : ''}
      ${info.note ? `<p class="win-note">${info.note}</p>` : ''}
      <div class="win-actions"></div>
    </div>`;
  const actions = root.querySelector<HTMLElement>('.win-actions')!;
  for (const a of info.actions) {
    if (a.next) {
      actions.append(nextButton({ label: a.label, onClick: () => { close(); a.onClick(); }, landKey: `win:${info.title}`, className: 'win-next' }));
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = a.primary ? 'primary' : 'secondary';
    b.textContent = a.label;
    b.onclick = () => { close(); a.onClick(); };
    actions.append(b);
  }
  host.append(root);
  const stop = reducedMotion ? () => {} : burst(root.querySelector<HTMLCanvasElement>('.win-burst')!, info.flawless);
  const close = () => { stop(); root.remove(); };
  actions.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  return close;
}

const CHECK = '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 24.5l6 6 12-13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STAR = '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 11.5l3.6 7.6 8.3 1.1-6.1 5.8 1.5 8.2L24 30.2l-7.3 4 1.5-8.2-6.1-5.8 8.3-1.1z" fill="currentColor"/></svg>';

/** Sparks of light flying out from the mark and fading, about a second and a half. */
function burst(canvas: HTMLCanvasElement, flawless: boolean): () => void {
  syncPalette();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const colors = flawless ? [C.accent, C.silver, C.good, C.accent] : [C.accent, C.silver, C.silverDim];
  const n = flawless ? 46 : 30;
  const sparks = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    return { a, v: 90 + Math.random() * 150, r: 1.2 + Math.random() * 2.2, c: colors[i % colors.length], spin: (Math.random() - 0.5) * 1.2 };
  });
  const cx = w / 2;
  const cy = 52;
  const t0 = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (t > 1.6) return;
    // A ring of light opening from the mark.
    ctx.globalAlpha = Math.max(0, 0.5 - t * 0.5);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 24 + t * 160, 0, Math.PI * 2);
    ctx.stroke();
    for (const s of sparks) {
      const d = s.v * (1 - Math.exp(-t * 2.4)) / 2.4 * 2;
      const a = s.a + s.spin * t;
      ctx.globalAlpha = Math.max(0, 1 - t / 1.5);
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
