// Nu reads along in the Atlas. Now and then, when an atom's page opens, Nu comes over and runs
// under a paragraph in view, like a finger following the lines (nuShow's `read`). Sent there
// by Nu itself (the park's "Read from the Atlas", or Home's "Nu wants to read about"), it's
// always interested: it starts at the top of Overview, reads a couple, and may then go on to
// another tab or two (it circles the tab, opens it, and reads there). A touch elsewhere, or scrolling the text away, sends
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

/** The open atom page's tab button, by id ('overview', 'structure', ...). */
function tab(id: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.at-page:not([hidden]) .ap-tabs [role="tab"][data-id="${id}"]`);
}

function tabs(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.at-page:not([hidden]) .ap-tabs [role="tab"]')].map((b) => b.dataset.id ?? '');
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
  if (!keen) { read(host, 1, new Set(), null); return; }
  // Sent to read: always from the top of Overview, and then perhaps on to another tab or two.
  const ov = tab('overview');
  if (ov && ov.getAttribute('aria-selected') !== 'true') ov.click();
  window.setTimeout(() => { const h = panel(); if (h) read(h, 2, new Set(), ['overview']); }, 400);
}

/** Reads the first block of text in view it hasn't read yet, then (keen) the next. Roaming
 *  (`seen` lists the tabs read so far), Nu may then go to another tab, tap it, and read on. */
function read(host: HTMLElement, n: number, done: Set<Element>, seen: string[] | null): void {
  if (!host.isConnected || panel() !== host) return;
  const top = 72, bottom = window.innerHeight - 56;
  const el = [...host.querySelectorAll('p, li')].find((b) => {
    if (done.has(b) || (b.textContent ?? '').trim().length < 40) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.top >= top && r.bottom <= bottom;
  });
  if (!el) { if (seen) roam(seen); return; }
  done.add(el);
  busy = true;
  const ms = Math.min(9000, Math.max(2500, (el.textContent ?? '').length * 45));
  // Napping, Nu never gets going: don't wait on it for ever.
  const safety = window.setTimeout(() => { busy = false; }, ms + 15_000);
  const from = performance.now();
  const finish = () => {
    window.clearTimeout(safety);
    busy = false;
    // Sent home by a touch: that's that.
    if (performance.now() - from < ms) return;
    if (n > 1) window.setTimeout(() => read(host, n - 1, done, seen), 500);
    else if (seen) roam(seen);
  };
  if (!nuShow(el, { read: true, ms, onDone: finish })) { window.clearTimeout(safety); busy = false; }
}

/** After a tab, now and then Nu goes to look at another: it circles the tab, opens it, reads. */
function roam(seen: string[]): void {
  const left = tabs().filter((t) => !seen.includes(t));
  if (!left.length || seen.length >= 3 || Math.random() > 0.6) return;
  const id = left[Math.floor(Math.random() * left.length)], btn = tab(id);
  if (!btn) return;
  busy = true;
  const ms = 1400, from = performance.now();
  const go = () => {
    busy = false;
    if (performance.now() - from < ms || !btn.isConnected) return;
    btn.click();
    window.setTimeout(() => { const h = panel(); if (h) read(h, 1 + Math.round(Math.random()), new Set(), [...seen, id]); }, 500);
  };
  if (!nuShow(btn, { ms, onDone: go })) busy = false;
}
