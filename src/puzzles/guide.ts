// Nu's guide cards in a game: a pink card that floats under the status line, says one thing,
// then, after a few seconds, fades while Nu leaves the card's icon and circles the button it was
// about (with Reduce motion, the button rings instead).
// There is nothing to tap and nothing to close; taps pass through to the board. Each card shows
// once per player, across every game, until progress is reset (the ids live in the save's
// seenLines), and not at all with Nu off.
//   - The first game ever played: the rules are under the i button.
//   - The first time a player seems stuck and the Hint button lights up: what Hint does.
// If the player leaves the game before the card has flown, it shows again next time.

import { firstTimeDue, markSeen, nuIconHtml, nuShow, reducedMotion } from '../ui/nu';

export type GuideId = 'guide-rules' | 'guide-hint';

/** How long the card stays before Nu leaves it, in ms. */
const STAY_MS = 3200;

let showing: HTMLElement | null = null;

/** Shows the card under `foot` (the game bar's status line), then sends Nu from it to `to`.
 *  False when it doesn't show (seen already, Nu off, or another card is up). */
export function guideCard(id: GuideId, foot: HTMLElement, to: HTMLElement, kicker: string, text: string): boolean {
  if (showing?.isConnected || !firstTimeDue(id)) return false;
  const card = document.createElement('div');
  card.className = 'ui-callout ui-callout--float gbar-offer guide-card';
  card.setAttribute('role', 'status');
  // Nu rests in the card's icon while it is up.
  card.dataset.nuPerch = '9';
  card.innerHTML = `<span class="ui-callout-pic" aria-hidden="true">${nuIconHtml(24)}</span><span class="ui-callout-text"><small></small><b></b></span><i class="guide-time" aria-hidden="true"></i>`;
  card.querySelector('small')!.textContent = kicker;
  card.querySelector('b')!.textContent = text;
  card.style.setProperty('--guide-ms', `${STAY_MS}ms`);
  foot.append(card);
  showing = card;

  window.setTimeout(() => {
    if (!card.isConnected) return;
    markSeen(id);
    if (showing === card) showing = null;
    // Nu goes from the card to the button, then the card fades.
    if (!to.isConnected || reducedMotion() || !nuShow(to, { ms: 4000 })) {
      to.classList.add('is-guided');
      window.setTimeout(() => to.classList.remove('is-guided'), 2600);
    }
    delete card.dataset.nuPerch;
    card.classList.add('is-leaving');
    window.setTimeout(() => card.remove(), 240);
  }, STAY_MS);
  return true;
}

/** The first game: the rules are under i. */
export function guideRules(foot: HTMLElement, info: HTMLElement | null): void {
  if (info) void guideCard('guide-rules', foot, info, 'Learn to play', "Every game's rules are under the i button, whenever you want them.");
}

/** The first time a player seems stuck: what Hint does. True when the card shows. */
export function guideHint(hint: HTMLElement): boolean {
  const foot = hint.closest?.('.gbar')?.querySelector<HTMLElement>('.gfoot');
  return !!foot && guideCard('guide-hint', foot, hint, 'Stuck?', 'Hint shows where to look. Tap it again and it plays a move.');
}
