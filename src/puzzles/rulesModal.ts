// The Instructions modal for any puzzle: its goal, then one card per rule with
// the symbol drawn as it looks on the board and a small looping example, then
// how the puzzle is used in the game. Shared by Build and the Puzzles screen.

import { openModal } from '../ui/modal';
import type { PuzzleType } from './catalog';
import { syncPalette } from './palette';
import type { RuleCard } from './view';

const DEMO_W = 120;
const DEMO_H = 96;

/** Opens the Instructions modal for a puzzle type and runs its rule demos while it is open. */
export function openRules(t: PuzzleType, opts: { reducedMotion?: boolean; footer?: string } = {}): HTMLElement {
  const rules = t.rules ?? [];
  const cards = rules.map((r, i) => `
    <li class="rule">
      ${r.demo ? `<canvas class="rule-demo" data-i="${i}" width="${DEMO_W}" height="${DEMO_H}" aria-hidden="true"></canvas>` : '<span class="rule-demo rule-demo--none" aria-hidden="true"></span>'}
      <div class="rule-text"><b>${escape(r.title)}</b><p>${escape(r.text)}</p></div>
    </li>`).join('');
  const sheet = openModal(`<div class="how">
      <h2>${escape(t.name)}</h2>
      <p class="how-goal">${t.blurb}</p>
      ${rules.length ? `<ul class="rules">${cards}</ul>` : ''}
      ${t.instructions ?? ''}
      ${opts.footer ?? ''}
    </div>`);
  runDemos(sheet, rules, Boolean(opts.reducedMotion));
  return sheet;
}

/** Animates every rule demo in `root` until it leaves the page. */
function runDemos(root: HTMLElement, rules: RuleCard[], reduced: boolean): void {
  syncPalette();
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>('canvas.rule-demo')];
  if (!canvases.length) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of canvases) {
    c.width = DEMO_W * dpr;
    c.height = DEMO_H * dpr;
  }
  const t0 = performance.now();
  const frame = (now: number) => {
    if (!root.isConnected) return;
    // With reduced motion, show each example at a still moment late in its loop.
    const t = reduced ? 2.5 : (now - t0) / 1000;
    for (const c of canvases) {
      const rule = rules[Number(c.dataset.i)];
      const ctx = c.getContext('2d');
      if (!ctx || !rule?.demo) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, DEMO_W, DEMO_H);
      try {
        rule.demo(ctx, DEMO_W, DEMO_H, t);
      } catch {
        // A demo that fails leaves its card with text only.
      }
    }
    if (!reduced) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
