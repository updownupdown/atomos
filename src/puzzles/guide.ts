// Nu's guide cards in a game: a pink card that floats under the status line, says one thing,
// then, after a few seconds, flies into the button it was about and leaves that button ringing.
// There is nothing to tap and nothing to close; taps pass through to the board. Each card shows
// once per player, across every game, until progress is reset (the ids live in the save's
// seenLines), and not at all with Nu off.
//   - The first game ever played: the rules are under the i button.
//   - The first time a player seems stuck and the Hint button lights up: what Hint does.
// If the player leaves the game before the card has flown, it shows again next time.

import { firstTimeDue, markSeen, nuIconHtml, reducedMotion } from '../ui/nu';

export type GuideId = 'guide-rules' | 'guide-hint';

/** How long the card stays before it flies, in ms. */
const STAY_MS = 3200;
const FLY_MS = 650;

let showing: HTMLElement | null = null;

/** Shows the card under `foot` (the game bar's status line), then flies it into `to`. */
export function guideCard(id: GuideId, foot: HTMLElement, to: HTMLElement, kicker: string, text: string): void {
  if (showing?.isConnected || !firstTimeDue(id)) return;
  const still = reducedMotion();
  const card = document.createElement('div');
  card.className = 'ui-callout ui-callout--float gbar-offer guide-card';
  card.setAttribute('role', 'status');
  card.innerHTML = `<span class="ui-callout-pic" aria-hidden="true">${nuIconHtml(24)}</span><span class="ui-callout-text"><small></small><b></b></span><i class="guide-time" aria-hidden="true"></i>`;
  card.querySelector('small')!.textContent = kicker;
  card.querySelector('b')!.textContent = text;
  card.style.setProperty('--guide-ms', `${STAY_MS}ms`);
  foot.append(card);
  showing = card;

  window.setTimeout(() => {
    if (!card.isConnected) return;
    const done = () => {
      card.remove();
      if (showing === card) showing = null;
      markSeen(id);
      if (!to.isConnected) return;
      to.classList.add('is-guided');
      window.setTimeout(() => to.classList.remove('is-guided'), 2600);
    };
    const a = card.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    if (still || !b.width || typeof card.animate !== 'function') {
      card.classList.add('is-leaving');
      window.setTimeout(done, 220);
      return;
    }
    // Shrink toward the button's middle, rounding into a dot as it goes.
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const s = Math.max(0.04, b.width / a.width);
    card.animate([
      { transform: 'translate(0, 0) scale(1)', borderRadius: '11px', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(${Math.max(s, 0.35)}, ${Math.max(s, 0.5)})`, borderRadius: '24px', opacity: 0.9, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s}, ${b.height / a.height})`, borderRadius: '50%', opacity: 0 },
    ], { duration: FLY_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' }).finished.then(done, done);
  }, STAY_MS);
}

/** The first game: the rules are under i. */
export function guideRules(foot: HTMLElement, info: HTMLElement | null): void {
  if (info) guideCard('guide-rules', foot, info, 'Learn to play', "Every game's rules are under the i button, whenever you want them.");
}

/** The first time a player seems stuck: what Hint does. */
export function guideHint(hint: HTMLElement): void {
  const foot = hint.closest?.('.gbar')?.querySelector<HTMLElement>('.gfoot');
  if (foot) guideCard('guide-hint', foot, hint, 'Stuck?', 'Hint shows where to look. Tap it again and it plays a move.');
}
