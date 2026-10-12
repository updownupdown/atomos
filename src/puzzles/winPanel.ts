// The sheet that ends a game, won or lost, shared by Build, the Puzzles screen and the gate
// puzzles. A mask covers the whole screen, header included; tapping it closes the sheet (each
// screen says where that leaves the player). On the sheet, top to bottom:
//   - the result: its mark and word (Built, Flawless, Out of guesses), what it was for, then
//     Moves and Par; beside it, a picture of where this win sits in the atom's progress;
//   - the choices: keep going on this atom or move on, or in Puzzles a new game at any level;
//   - an invitation to explore the atom: a fact about it, with View and Learn.

import { syncPalette, C } from './palette';
import { nextButton } from '../ui/components';
import { icon } from '../ui/icons';
import { puzzleIcon } from './catalog';
import { levelWord } from './difficulty';

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

export interface WinLevels {
  /** The level just played, 1 (very easy) to 5 (expert). */
  current: number;
  /** The levels this game reaches. */
  reachable: number[];
  pick: (level: number) => void;
}

export interface WinInfo {
  /** won, won flawless, or lost (out of moves for good). */
  outcome: 'won' | 'flawless' | 'lost';
  /** The result in a word or two: "Built", "Flawless", "Solved", "Out of guesses". */
  headline: string;
  /** What it was for: "Lithium's nucleus", "Tessera · Carbon". */
  title: string;
  /** The game played, for its icon. */
  game?: string;
  stats: WinStat[];
  /** The right half of the top row: where this sits in the atom's progress (winTrack.ts). */
  track?: HTMLElement;
  /** The choices in the middle; one may be the Next step. */
  actions: WinAction[];
  /** Puzzles only: play again at any level, the current one marked. */
  levels?: WinLevels;
  /** The bottom: an invitation to explore the atom. */
  explore?: { name: string; fact?: string; actions: WinAction[] };
  /** Tapping the mask (or Escape): the sheet closes, then this runs. */
  onDismiss?: () => void;
}

/** Shows the sheet over everything. Returns a function that closes it (without onDismiss). With
 *  `host`, it stays inside that element instead (the component library's preview). */
export function showWin(info: WinInfo, reducedMotion = false, host?: HTMLElement): () => void {
  document.querySelectorAll('.win').forEach((w) => (w as HTMLElement & { closeWin?: () => void }).closeWin?.());
  const root = document.createElement('div') as HTMLDivElement & { closeWin?: () => void };
  root.className = `win win--${info.outcome}${reducedMotion ? ' win--still' : ''}${host ? ' win--inline' : ''}`;
  const mark = info.outcome === 'lost' ? LOST : info.outcome === 'flawless' ? STAR : CHECK;
  const gameIcon = info.game ? `<span class="win-game" aria-hidden="true">${puzzleIcon(info.game, 18)}</span>` : '';
  root.innerHTML = `
    <div class="win-card" role="dialog" aria-modal="true" aria-label="${esc(info.headline)}: ${esc(info.title)}">
      <canvas class="win-burst" aria-hidden="true"></canvas>
      <div class="win-top${info.track ? '' : ' win-top--solo'}">
        <div class="win-result">
          <div class="win-head"><span class="win-mark" aria-hidden="true">${mark}</span><b class="win-headline">${esc(info.headline)}</b></div>
          <p class="win-title">${gameIcon}<span>${esc(info.title)}</span></p>
          ${info.stats.length ? `<dl class="win-stats">${info.stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join('')}</dl>` : ''}
        </div>
        <div class="win-track-slot"></div>
      </div>
      <div class="win-actions"></div>
      ${info.levels ? `<div class="win-levels"><p class="win-sub">Play another</p><div class="win-level-row" role="group" aria-label="Difficulty"></div></div>` : ''}
      ${info.explore ? `<div class="win-explore">
        <p class="win-sub">Explore ${esc(info.explore.name)}</p>
        ${info.explore.fact ? `<p class="win-fact">${esc(info.explore.fact)}</p>` : ''}
        <div class="win-explore-actions"></div>
      </div>` : ''}
    </div>`;
  if (info.track) root.querySelector('.win-track-slot')!.append(info.track);
  else root.querySelector('.win-track-slot')!.remove();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    stop();
    window.removeEventListener('keydown', onKey, true);
    root.classList.add('is-leaving');
    window.setTimeout(() => root.remove(), reducedMotion ? 0 : 160);
  };
  const run = (a: WinAction) => () => { close(); a.onClick(); };
  const dismiss = () => { close(); info.onDismiss?.(); };

  const actions = root.querySelector<HTMLElement>('.win-actions')!;
  for (const a of info.actions) actions.append(a.next
    ? nextButton({ label: a.label, onClick: run(a), landKey: `win:${info.title}`, className: 'win-next' })
    : button(a.label, a.primary ? 'primary' : 'secondary', run(a)));
  if (!info.actions.length) actions.remove();

  if (info.levels) {
    const row = root.querySelector<HTMLElement>('.win-level-row')!;
    const lv = info.levels;
    for (let level = 1; level <= 5; level++) {
      const b = button('', `win-level${level === lv.current ? ' is-current' : ''}`, () => { close(); lv.pick(level); });
      const word = levelWord(level);
      b.innerHTML = `<span class="win-pips" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span><span>${word}</span>`;
      b.setAttribute('aria-label', `${word}${level === lv.current ? ', the level just played' : ''}`);
      if (level === lv.current) b.setAttribute('aria-current', 'true');
      b.disabled = !lv.reachable.includes(level);
      row.append(b);
    }
  }
  if (info.explore) {
    const ex = root.querySelector<HTMLElement>('.win-explore-actions')!;
    for (const a of info.explore.actions) ex.append(button(a.label, 'win-explore-btn', run(a)));
  }

  // The mask: a tap outside the card closes the sheet.
  root.addEventListener('pointerdown', (e) => { if (e.target === root) dismiss(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    dismiss();
  };
  window.addEventListener('keydown', onKey, true);

  root.closeWin = close;
  (host ?? document.body).append(root);
  const stop = reducedMotion || info.outcome === 'lost' ? () => {} : burst(root.querySelector<HTMLCanvasElement>('.win-burst')!, info.outcome === 'flawless');
  root.querySelector<HTMLButtonElement>('.win-actions button, .win-level.is-current, .win-level:not(:disabled)')?.focus({ preventScroll: true });
  return close;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CHECK = icon('check', { size: 28 });
const STAR = icon('star', { size: 28 });
const LOST = icon('close', { size: 28 });

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
  const colors = flawless ? [C.good, C.silver, C.s, C.p, C.d, C.f] : [C.accent, C.silver, C.s, C.p];
  const n = flawless ? 46 : 30;
  const sparks = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    return { a, v: 90 + Math.random() * 150, r: 1.2 + Math.random() * 2.2, c: colors[i % colors.length], spin: (Math.random() - 0.5) * 1.2 };
  });
  // From the mark, top left.
  const cx = 34;
  const cy = 34;
  const t0 = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (t > 1.6) return;
    ctx.globalAlpha = Math.max(0, 0.5 - t * 0.5);
    ctx.strokeStyle = flawless ? C.good : C.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 16 + t * 160, 0, Math.PI * 2);
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
