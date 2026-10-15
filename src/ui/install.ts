// The one-time offer to keep Atomos on the home screen. It waits until the first atom is built,
// then shows once on Home, floating just above the bar. Where the browser can install the app
// itself (Chrome, Edge, Samsung Internet on Android and desktop) Add brings up its install
// prompt; on iPhone and iPad, where only the Share menu can, it says where to tap instead.
// Elsewhere, or once Atomos already runs from the home screen, it never shows. Answering it
// either way, or installing from the browser's own menu, counts as seen (save.seenLines).
//
//   initInstallOffer();   // once, at start, before the browser's install event can fire

import { MAX_Z } from '../gallery/data';
import { atomBuilt } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import { icon } from './icons';
import { markSvg } from './mark';
import { markSeen, reducedMotion } from './nu';
import './install.css';

const SEEN = 'add-home';

/** Chrome's install event: prompt() once, then userChoice says what the player picked. */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** How the offer can be taken up here: the browser's own prompt, the Share menu, or not at all. */
export type InstallWay = 'prompt' | 'ios' | null;

/** Whether the offer is due: a way to install, not installed yet, an atom built, never answered. */
export function installOfferDue(o: { way: InstallWay; standalone: boolean; seen: boolean; builtAny: boolean }): boolean {
  return o.way !== null && !o.standalone && !o.seen && o.builtAny;
}

/** Whether any atom is built. */
export function anyAtomBuilt(save: SaveData = loadSave()): boolean {
  for (let z = 1; z <= MAX_Z; z++) if (atomBuilt(z, save)) return true;
  return false;
}

/** iPhone and iPad, where only the Share menu adds a page to the home screen (iPadOS
 *  reports itself as a Mac, but a Mac has no touch screen). */
export function isIos(ua: string, platform: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
}

let deferred: InstallEvent | null = null;
let card: HTMLElement | null = null;

function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function way(): InstallWay {
  if (deferred) return 'prompt';
  return isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) ? 'ios' : null;
}

function seenOffer(): boolean {
  try {
    return !!loadSave().seenLines[SEEN];
  } catch {
    return false;
  }
}

function due(): boolean {
  try {
    const save = loadSave();
    return installOfferDue({ way: way(), standalone: standalone(), seen: !!save.seenLines[SEEN], builtAny: anyAtomBuilt(save) });
  } catch {
    return false;
  }
}

function hide(seen: boolean): void {
  if (seen) markSeen(SEEN);
  const c = card;
  card = null;
  if (!c) return;
  if (reducedMotion() || !c.animate) { c.remove(); return; }
  c.style.pointerEvents = 'none';
  c.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).finished.finally(() => c.remove());
}

function show(): void {
  if (card || !due()) return;
  const ios = way() === 'ios';
  const c = document.createElement('aside');
  c.className = 'install-offer';
  c.setAttribute('aria-label', 'Add Atomos to your home screen');
  c.innerHTML = `
    <div class="io-row">
      <span class="io-mark" aria-hidden="true">${markSvg()}</span>
      <div class="io-text">
        <strong>Keep Atomos on your home screen</strong>
        <span>${ios
          ? `Tap Share <span class="io-share">${icon('share', { size: 18 })}</span> then Add to Home Screen.`
          : 'It opens full screen, works offline and keeps your progress safer.'}</span>
      </div>
    </div>
    <div class="io-btns"></div>`;
  const btns = c.querySelector('.io-btns')!;
  const button = (label: string, cls: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.onclick = onClick;
    btns.append(b);
  };
  if (ios) {
    button('Got it', 'primary', () => hide(true));
  } else {
    button('Not now', 'secondary', () => hide(true));
    button('Add', 'primary', () => {
      const ev = deferred;
      deferred = null;
      hide(true);
      if (ev) void ev.prompt().catch(() => {});
    });
  }
  document.body.append(c);
  card = c;
  if (!reducedMotion() && c.animate) {
    c.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
  }
}

/** Listens for the browser's install event and shows the offer each time Home opens while it's due. */
export function initInstallOffer(): void {
  if (typeof window === 'undefined' || typeof matchMedia === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Until it's answered, the offer stands in for the browser's own banner and comes once an
    // atom is built; after that the browser does as it likes.
    if (seenOffer()) return;
    e.preventDefault();
    deferred = e as InstallEvent;
    if (document.body.dataset.screen === 'home') show();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    hide(true);
  });
  // Home is the only place it shows; leaving Home takes it away until the next visit.
  const watch = () => {
    if (document.body.dataset.screen === 'home') show();
    else if (card) hide(false);
  };
  new MutationObserver(watch).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
  watch();
}
