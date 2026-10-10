// The Instructions modal for any puzzle: its goal, then one card per rule. Each card has its
// title and text, then its pictures side by side, the rule kept and the rule broken, drawn as
// stills. Nothing moves until the player taps a card's Play, which plays the kept picture and
// then the broken one; only one card plays at a time. Shared by Build and the Puzzles screen.

import { openModal } from '../ui/modal';
import { icon } from '../ui/icons';
import type { PuzzleType } from './catalog';
import { syncPalette } from './palette';
import type { Illustration, RuleCard } from './view';

const PIC_W = 140;
const PIC_H = 104;
/** How long an old single-loop demo plays, and the moment its still is taken from. */
const LEGACY_SECONDS = 4;
const LEGACY_STILL = 2.5;

interface Pic { canvas: HTMLCanvasElement; ill: Illustration }
type Kind = 'good' | 'bad' | 'one';

/** Opens the Instructions modal for a puzzle type. */
export function openRules(t: PuzzleType, opts: { reducedMotion?: boolean; footer?: string } = {}): HTMLElement {
  const rules = t.rules ?? [];
  const cards = rules.map((r, i) => {
    const pics = picsOf(r);
    const pair = pics.length > 1;
    const figures = pics.map((p, k) => {
      const caption = p.ill.caption ?? (pair ? (p.kind === 'bad' ? 'Not like this' : 'Like this') : '');
      const mark = pair ? icon(p.kind === 'bad' ? 'close' : 'check', { size: 14 }) : '';
      return `
        <figure class="rule-pic rule-pic--${p.kind}">
          <canvas class="rule-demo" data-i="${i}" data-k="${k}" width="${PIC_W}" height="${PIC_H}" aria-hidden="true"></canvas>
          ${caption ? `<figcaption>${mark}<span>${escape(caption)}</span></figcaption>` : ''}
        </figure>`;
    }).join('');
    return `
    <li class="rule">
      <div class="rule-head">
        <b>${escape(r.title)}</b>
        ${pics.length ? `<button class="rule-play" data-i="${i}" type="button" aria-label="Play the example for ${escape(r.title)}">${icon('play', { size: 16 })}<span>Play</span></button>` : ''}
      </div>
      <p>${escape(r.text)}</p>
      ${pics.length ? `<div class="rule-pics${pair ? ' rule-pics--pair' : ''}">${figures}</div>` : ''}
    </li>`;
  }).join('');
  // The name comes first so the modal pins it beside the X while the rules scroll.
  const sheet = openModal(`<h2>${escape(t.name)}</h2><div class="how">
      <p class="how-goal">${t.blurb}</p>
      ${rules.length ? `<ul class="rules">${cards}</ul>` : ''}
      ${t.instructions ?? ''}
      ${opts.footer ?? ''}
    </div>`);
  wire(sheet, rules, Boolean(opts.reducedMotion));
  return sheet;
}

/** A card's pictures in order: kept, then broken; or the old single loop as one picture. */
function picsOf(r: RuleCard): { kind: Kind; ill: Illustration }[] {
  const out: { kind: Kind; ill: Illustration }[] = [];
  if (r.good) out.push({ kind: r.bad ? 'good' : 'one', ill: r.good });
  if (r.bad) out.push({ kind: 'bad', ill: r.bad });
  if (!out.length && r.demo) {
    const demo = r.demo;
    out.push({ kind: 'one', ill: { draw: (ctx, w, h, t) => demo(ctx, w, h, t >= LEGACY_SECONDS ? LEGACY_STILL : t), duration: LEGACY_SECONDS } });
  }
  return out;
}

function wire(root: HTMLElement, rules: RuleCard[], reduced: boolean): void {
  syncPalette();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pics = new Map<string, Pic[]>();
  root.querySelectorAll<HTMLCanvasElement>('canvas.rule-demo').forEach((canvas) => {
    canvas.width = PIC_W * dpr;
    canvas.height = PIC_H * dpr;
    const i = canvas.dataset.i!;
    const ill = picsOf(rules[Number(i)])[Number(canvas.dataset.k)].ill;
    const list = pics.get(i) ?? [];
    list.push({ canvas, ill });
    pics.set(i, list);
    paint(canvas, ill, ill.duration, dpr);
  });

  let playing: { btn: HTMLButtonElement; stop: () => void } | null = null;
  root.querySelectorAll<HTMLButtonElement>('.rule-play').forEach((btn) => {
    btn.onclick = () => {
      const same = playing?.btn === btn;
      playing?.stop();
      if (same) return;
      const list = pics.get(btn.dataset.i!) ?? [];
      const run = play(list, btn, reduced, dpr, root, () => { if (playing?.btn === btn) playing = null; });
      playing = { btn, stop: run };
    };
  });
}

/** Plays a card's pictures one after the other, each from its start to its finished still. */
function play(list: Pic[], btn: HTMLButtonElement, reduced: boolean, dpr: number, root: HTMLElement, done: () => void): () => void {
  let raf = 0;
  let timer = 0;
  let k = 0;
  let t0 = performance.now();
  let over = false;
  const label = btn.querySelector('span')!;
  const end = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    btn.classList.remove('is-playing');
    label.textContent = 'Play';
    list.forEach((p) => { p.canvas.classList.remove('is-live'); paint(p.canvas, p.ill, p.ill.duration, dpr); });
    done();
  };
  btn.classList.add('is-playing');
  label.textContent = 'Stop';
  // Every picture starts from its first frame, so the sequence reads in order.
  list.forEach((p) => paint(p.canvas, p.ill, 0, dpr));
  if (reduced) {
    // No motion: the first frames for a beat, then the finished stills.
    timer = window.setTimeout(end, 1200);
    return end;
  }
  const frame = (now: number) => {
    if (!root.isConnected) return;
    const p = list[k];
    const t = (now - t0) / 1000;
    p.canvas.classList.add('is-live');
    paint(p.canvas, p.ill, Math.min(t, p.ill.duration), dpr);
    if (t >= p.ill.duration + 0.6) {
      p.canvas.classList.remove('is-live');
      k += 1;
      t0 = now;
      if (k >= list.length) { end(); return; }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return end;
}

function paint(canvas: HTMLCanvasElement, ill: Illustration, t: number, dpr: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, PIC_W, PIC_H);
  try {
    ill.draw(ctx, PIC_W, PIC_H, t);
  } catch {
    // A picture that fails leaves its card with text only.
  }
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
