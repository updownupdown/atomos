// The Instructions modal for any puzzle: its goal, large, under a Goal heading, then one card
// per rule. Each card has its title and text, then its pictures side by side, the rule kept and
// the rule broken, drawn as stills as wide as the sheet allows. Each card plays once on its own
// when it has scrolled past the middle of the screen, in order; a card's Play (Stop while it
// plays) replays it, and tapping a picture plays just that one. Only one plays at a time.
// Shared by Build and the Puzzles screen.

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
    <li class="rule" data-i="${i}">
      <div class="rule-head">
        <b>${escape(r.title)}</b>
        ${pics.length ? `<button class="rule-play" data-i="${i}" type="button" aria-label="Play the example for ${escape(r.title)}"><i class="rule-ico">${icon('play', { size: 16 })}</i><span>Play</span></button>` : ''}
      </div>
      <p>${escape(r.text)}</p>
      ${pics.length ? `<div class="rule-pics${pair ? ' rule-pics--pair' : ''}">${figures}</div>` : ''}
    </li>`;
  }).join('');
  // The name comes first so the modal pins it beside the X while the rules scroll.
  let stop = () => {};
  const sheet = openModal(`<h2>${escape(t.name)}</h2><div class="how">
      <section class="how-goal"><h3>Goal</h3><p>${escape(t.goal)}</p></section>
      <p class="how-blurb">${t.blurb}</p>
      ${rules.length ? `<ul class="rules">${cards}</ul>` : ''}
      ${t.instructions ?? ''}
      ${opts.footer ?? ''}
    </div>`, () => { stop(); sheet.classList.remove('is-rules'); });
  sheet.classList.add('is-rules');
  stop = wire(sheet, rules, Boolean(opts.reducedMotion));
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

/** Draws the stills, wires Play and the pictures, and plays each card once as it passes the
 *  middle of the screen. Returns a function that stops everything (the modal closing). */
function wire(root: HTMLElement, rules: RuleCard[], reduced: boolean): () => void {
  syncPalette();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pics = new Map<string, Pic[]>();
  root.querySelectorAll<HTMLCanvasElement>('canvas.rule-demo').forEach((canvas) => {
    // Pictures are drawn in a 140 x 104 box and scaled to the size they show at, kept sharp.
    const w = Math.max(PIC_W, canvas.clientWidth || PIC_W);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round((w * PIC_H / PIC_W) * dpr);
    const i = canvas.dataset.i!;
    const ill = picsOf(rules[Number(i)])[Number(canvas.dataset.k)].ill;
    const list = pics.get(i) ?? [];
    list.push({ canvas, ill });
    pics.set(i, list);
    paint(canvas, ill, ill.duration);
  });

  let playing: { btn: HTMLButtonElement; stop: () => void } | null = null;
  /** Cards that have passed the middle and not yet played on their own, in order. */
  const queue: string[] = [];
  const played = new Set<string>();
  const next = () => {
    if (playing) return;
    const i = queue.shift();
    if (i === undefined) return;
    const btn = root.querySelector<HTMLButtonElement>(`.rule-play[data-i="${i}"]`);
    if (btn) start(btn, pics.get(i) ?? [], true);
    else next();
  };
  const start = (btn: HTMLButtonElement, list: Pic[], auto = false) => {
    played.add(btn.dataset.i!);
    const run = play(list, btn, reduced, root, () => {
      if (playing?.btn !== btn) return;
      playing = null;
      // The next card in line plays once this one has finished on its own.
      if (auto || queue.length) window.setTimeout(next, 250);
    });
    playing = { btn, stop: run };
  };
  root.querySelectorAll<HTMLButtonElement>('.rule-play').forEach((btn) => {
    btn.onclick = () => {
      const same = playing?.btn === btn;
      const was = playing;
      playing = null;
      was?.stop();
      if (same) return;
      start(btn, pics.get(btn.dataset.i!) ?? []);
    };
  });
  // Tapping a picture plays just that picture.
  for (const [i, list] of pics) {
    const btn = root.querySelector<HTMLButtonElement>(`.rule-play[data-i="${i}"]`);
    if (!btn) continue;
    for (const pic of list) {
      pic.canvas.onclick = () => {
        const was = playing;
        playing = null;
        was?.stop();
        start(btn, [pic]);
      };
    }
  }

  // Each card plays once by itself when its pictures pass the middle of the screen (or are
  // above it when the sheet opens), one at a time, in order. Not under Reduce motion.
  if (reduced || typeof IntersectionObserver === 'undefined') return () => { playing?.stop(); };
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const i = (e.target as HTMLElement).dataset.i!;
      const past = e.isIntersecting || e.boundingClientRect.top < (e.rootBounds?.top ?? 0);
      if (!past || played.has(i) || queue.includes(i)) continue;
      queue.push(i);
    }
    queue.sort((a, b) => Number(a) - Number(b));
    next();
  }, { root, rootMargin: '0px 0px -50% 0px' });
  root.querySelectorAll<HTMLElement>('.rule[data-i]').forEach((card) => {
    const target = card.querySelector<HTMLElement>('.rule-pics');
    if (target) { target.dataset.i = card.dataset.i; seen.observe(target); }
  });
  return () => {
    seen.disconnect();
    queue.length = 0;
    const was = playing;
    playing = null;
    was?.stop();
  };
}

/** Plays a card's pictures one after the other, each from its start to its finished still. */
function play(list: Pic[], btn: HTMLButtonElement, reduced: boolean, root: HTMLElement, done: () => void): () => void {
  let raf = 0;
  let timer = 0;
  let k = 0;
  let t0 = performance.now();
  let over = false;
  const label = btn.querySelector('span')!;
  const ico = btn.querySelector('.rule-ico')!;
  const end = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    btn.classList.remove('is-playing');
    label.textContent = 'Play';
    ico.innerHTML = icon('play', { size: 16 });
    list.forEach((p) => { p.canvas.classList.remove('is-live'); paint(p.canvas, p.ill, p.ill.duration); });
    done();
  };
  btn.classList.add('is-playing');
  label.textContent = 'Stop';
  ico.innerHTML = icon('stop', { size: 16 });
  // Every picture starts from its first frame, so the sequence reads in order.
  list.forEach((p) => paint(p.canvas, p.ill, 0));
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
    paint(p.canvas, p.ill, Math.min(t, p.ill.duration));
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

function paint(canvas: HTMLCanvasElement, ill: Illustration, t: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const k = canvas.width / PIC_W;
  ctx.setTransform(k, 0, 0, k, 0, 0);
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
