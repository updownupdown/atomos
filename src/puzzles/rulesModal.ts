// The Instructions modal for any puzzle: the game's icon and name pinned at the top, its goal,
// large and given room, then one card per rule, then the player's Stats (Won and Flawless at each
// level) and its Specs (what a flawless solve needs and how its boards are made). Each card has its title and text (the key phrase in bold, written
// **so** in the rule), then its pictures side by side, the rule kept and the rule broken, drawn
// as stills as wide as the sheet allows. The card crossing the middle of the sheet is the
// current one: it sits on a gray plate, its title in cyan, and its pictures play, one after the other,
// over and over; the rest sit black, holding their finished stills. Scrolled to the very end, the
// last card is current; tapping a card brings it to the middle. There are no Play buttons. Under
// Reduce motion the current card still turns gray but its pictures stay still.
// Shared by Build and the Puzzles screen.

import { openModal } from '../ui/modal';
import { icon } from '../ui/icons';
import { puzzleIcon, type PuzzleType } from './catalog';
import { levelStats } from './levelButtons';
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
      <div class="rule-head"><b>${escape(r.title)}</b></div>
      <p>${bolded(r.text)}</p>
      ${pics.length ? `<div class="rule-pics${pair ? ' rule-pics--pair' : ''}">${figures}</div>` : ''}
    </li>`;
  }).join('');
  // The name comes first so the modal pins it beside the X while the rules scroll.
  let stop = () => {};
  const sheet = openModal(`<h2 class="how-title"><span class="how-icon" aria-hidden="true">${puzzleIcon(t.id, 18)}</span><span>${escape(t.name)}</span></h2><div class="how">
      <section class="how-goal"><h3>Goal</h3><p>${escape(t.goal)}</p></section>
      <p class="how-blurb">${t.blurb}</p>
      ${rules.length ? `<ul class="rules">${cards}</ul>` : ''}
      <section class="how-stats"><h3>Stats</h3><div class="how-stats-key"><span>${icon('check', { size: 14 })}Won</span><span>${icon('star', { size: 14 })}Flawless</span></div></section>
      ${t.instructions ?? ''}
      ${opts.footer ?? ''}
    </div>`, () => { stop(); sheet.classList.remove('is-rules'); });
  sheet.classList.add('is-rules');
  sheet.querySelector('.how-stats')?.append(levelStats(t.id));
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

/** Draws the stills, then keeps the card across the middle of the sheet in focus, playing its
 *  pictures in a loop. Returns a function that stops everything (the modal closing). */
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

  const cards = [...root.querySelectorAll<HTMLElement>('.rule[data-i]')];
  let active: HTMLElement | null = null;
  let stopLoop = () => {};
  const focus = (card: HTMLElement | null) => {
    if (card === active) return;
    active?.classList.remove('is-current');
    stopLoop();
    stopLoop = () => {};
    active = card;
    if (!card) return;
    card.classList.add('is-current');
    const list = pics.get(card.dataset.i!);
    if (list?.length && !reduced) stopLoop = loop(list, root);
  };
  /** The card across the sheet's middle line; the last one at the very end; else the nearest. */
  const pick = (): HTMLElement | null => {
    if (!cards.length) return null;
    const box = root.getBoundingClientRect();
    const mid = box.top + box.height / 2;
    const last = cards[cards.length - 1];
    const end = root.scrollHeight > root.clientHeight + 2 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
    if (end && last.getBoundingClientRect().bottom <= box.bottom + 1) return last;
    let best = cards[0], gap = Infinity;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
      if (d < gap) { gap = d; best = c; }
    }
    return best;
  };
  let pending = 0;
  const onScroll = () => {
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; focus(pick()); });
  };
  root.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  // Tapping a card brings it to the middle.
  for (const c of cards) {
    c.addEventListener('click', () => {
      c.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      focus(c);
    });
  }
  requestAnimationFrame(() => focus(pick()));
  return () => {
    root.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    cancelAnimationFrame(pending);
    focus(null);
  };
}

/** Plays a card's pictures one after the other, each from its start to its finished still, and
 *  then again from the first, until stopped; stopping leaves the finished stills. */
function loop(list: Pic[], root: HTMLElement): () => void {
  let raf = 0;
  let k = 0;
  let t0 = performance.now();
  let over = false;
  list.forEach((p) => paint(p.canvas, p.ill, 0));
  const frame = (now: number) => {
    if (over || !root.isConnected) return;
    const p = list[k];
    const t = (now - t0) / 1000;
    paint(p.canvas, p.ill, Math.min(t, p.ill.duration));
    if (t >= p.ill.duration + 0.9) {
      k = (k + 1) % list.length;
      t0 = now;
      // The next picture starts from its first frame; a lone picture starts over.
      paint(list[k].canvas, list[k].ill, 0);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    over = true;
    cancelAnimationFrame(raf);
    list.forEach((p) => paint(p.canvas, p.ill, p.ill.duration));
  };
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

/** A rule's text, escaped, with its **key phrase** in bold. */
function bolded(s: string): string {
  return escape(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
