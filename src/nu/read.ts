// Nu reads along in the Atlas. Now and then, when an atom's page opens, Nu comes over and runs
// under a paragraph or two in view, like a finger following the lines (nuShow's `read`). Sent
// there by Nu itself (the park's "Read from the Atlas", or Home's "Nu wants to read about"),
// it's always interested and reads a few. A touch elsewhere, or scrolling the text away, sends
// it home, as with anything Nu shows. Kept apart from the Atlas: it only looks for the open
// page's panel.

import { nuEnabled, nuShow } from '../ui/nu';

/** How long after being asked Nu still means to read the page that opens. */
const KEEN_MS = 8000;
/** On its own, Nu reads at most this often, and only some of the time. */
const QUIET_MS = 3 * 60_000;
const CHANCE = 0.3;

let asked: { z: number; at: number } | null = null;
let last = -Infinity;
let busy = false;
let started = false;

/** Nu wants to read this atom's page: the next atom page to open, it reads along. */
export function readWithNu(z: number): void {
  asked = { z, at: Date.now() };
}

/** Listens for atom pages opening (the shell calls this once). */
export function startReadAlong(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('atomos:nav', () => window.setTimeout(check, 700));
}

/** The open atom page's panel, if the Atlas is on screen with one. */
function panel(): HTMLElement | null {
  if (document.body.dataset.screen !== 'gallery') return null;
  return document.querySelector<HTMLElement>('.at-page:not([hidden]) .ap-panel');
}

function check(): void {
  if (busy || !nuEnabled()) return;
  const host = panel();
  if (!host) return;
  const keen = !!asked && Date.now() - asked.at < KEEN_MS;
  asked = null;
  const now = performance.now();
  if (!keen && (now - last < QUIET_MS || Math.random() > CHANCE)) return;
  last = now;
  read(host, keen ? 3 : 1, new Set());
}

/** Reads the first block of text in view it hasn't read yet, then (keen) the next. */
function read(host: HTMLElement, n: number, done: Set<Element>): void {
  if (!host.isConnected || panel() !== host) return;
  const top = 72, bottom = window.innerHeight - 56;
  const el = [...host.querySelectorAll('p, li')].find((b) => {
    if (done.has(b) || (b.textContent ?? '').trim().length < 40) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.top >= top && r.bottom <= bottom;
  });
  if (!el) return;
  done.add(el);
  busy = true;
  const ms = Math.min(9000, Math.max(2500, (el.textContent ?? '').length * 45));
  // Napping, Nu never gets going: don't wait on it for ever.
  const safety = window.setTimeout(() => { busy = false; }, ms + 15_000);
  const from = performance.now();
  const finish = () => {
    window.clearTimeout(safety);
    busy = false;
    // Read to the end (not sent home by a touch): on to the next, if keen.
    if (n > 1 && performance.now() - from > ms) window.setTimeout(() => read(host, n - 1, done), 500);
  };
  if (!nuShow(el, { read: true, ms, onDone: finish })) { window.clearTimeout(safety); busy = false; }
}
