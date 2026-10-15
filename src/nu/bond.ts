// What Nu remembers of you, kept on the device under BOND_KEY:
//   warmth   how warmly it glows: play with it (in its park, or by finding it) and it warms up;
//            left alone it cools again over a couple of days.
//   naps     away a few days, and Nu is asleep in the logo when you come back: it breathes slowly
//            and doesn't go off to play until you wake it (tap the logo, or visit its park).
//   treats   each puzzle win leaves Nu a treat (a photon), waiting in its park until it eats it.
//   toys     each period finished gives Nu a new toy for its park: a tiny model of that period's
//            atom. `toysSeen` are the ones it has already been given.
//   hiding   once a day Nu hides by something on a screen you visit; tap it there to find it.
// No DOM here: src/ui/nu.ts (the guide), the park and Home read and write it.

import { loadSave, type SaveData } from '../core/save';
import { atomBuilt, rowSpan } from '../core/progress';

const BOND_KEY = 'atomos.nu-bond';
/** Warmth halves every this long. */
const WARMTH_HALF_MS = 36 * 3600_000;
/** Away this long, and Nu is napping when you come back. */
export const NAP_AFTER_MS = 3 * 24 * 3600_000;
/** Treats wait up to this many; more wins don't pile up past it. */
export const MAX_TREATS = 9;
/** Tries a day at hiding (it stops once found). */
export const HIDES_A_DAY = 3;

interface Bond {
  warm: number;
  warmAt: number;
  seen: number;
  napping: boolean;
  treats: number;
  toysSeen: number[];
  finds: number;
  hideDay: string;
  hides: number;
  foundDay: string;
}

const fresh = (): Bond => ({ warm: 0, warmAt: 0, seen: 0, napping: false, treats: 0, toysSeen: [], finds: 0, hideDay: '', hides: 0, foundDay: '' });

function read(): Bond {
  const b = fresh();
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BOND_KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of ['warm', 'warmAt', 'seen', 'treats', 'finds', 'hides'] as const) if (Number.isFinite(o[k])) b[k] = o[k] as number;
      for (const k of ['hideDay', 'foundDay'] as const) if (typeof o[k] === 'string') b[k] = o[k] as string;
      b.napping = o.napping === true;
      if (Array.isArray(o.toysSeen)) b.toysSeen = o.toysSeen.filter((n): n is number => Number.isInteger(n));
    }
  } catch { /* nothing kept */ }
  return b;
}

function write(b: Bond): void {
  try { localStorage.setItem(BOND_KEY, JSON.stringify(b)); } catch { /* not kept */ }
}

function change(f: (b: Bond) => void): Bond {
  const b = read();
  f(b);
  write(b);
  return b;
}

/** Today, as a key ("2026-10-15") and a day number, in the player's own time zone. */
export function dayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function dayIndex(now = new Date()): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
}

// ---- Warmth and naps ----

/** How warm Nu is now, 0 to 1. */
export function warmth(now = Date.now()): number {
  const b = read();
  return b.warm * Math.pow(0.5, Math.max(0, now - b.warmAt) / WARMTH_HALF_MS);
}

/** Playing with Nu warms it up by `k` (it never goes past 1). */
export function warmUp(k: number, now = Date.now()): number {
  const w = Math.min(1, warmth(now) + k);
  change((b) => { b.warm = w; b.warmAt = now; });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('atomos:nu-bond'));
  return w;
}

/** The app opens: away a few days, and Nu is napping. Then notes that you're here. */
export function arrive(now = Date.now()): boolean {
  const b = change((o) => {
    if (o.seen && now - o.seen > NAP_AFTER_MS) o.napping = true;
    o.seen = now;
  });
  return b.napping;
}

/** You're still here (the app is used): keeps "last seen" fresh. */
export function stillHere(now = Date.now()): void {
  change((b) => { b.seen = now; });
}

export function napping(): boolean { return read().napping; }

/** Nu wakes up. True if it was asleep. */
export function wake(): boolean {
  if (!read().napping) return false;
  change((b) => { b.napping = false; });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('atomos:nu-bond'));
  return true;
}

// ---- Treats ----

export function treats(): number { return read().treats; }

/** A puzzle won: one more treat waiting in the park. */
export function addTreat(): void {
  change((b) => { b.treats = Math.min(MAX_TREATS, b.treats + 1); });
}

/** Nu ate a treat. */
export function eatTreat(): void {
  change((b) => { b.treats = Math.max(0, b.treats - 1); });
}

// ---- Toys from finished periods ----

/** The periods with every atom built. */
export function periodsDone(save: SaveData = loadSave()): number[] {
  const done: number[] = [];
  for (let p = 1; p <= 7; p++) {
    const [a, z] = rowSpan(p);
    let all = true;
    for (let n = a; n <= z && all; n++) all = atomBuilt(n, save);
    if (all) done.push(p);
  }
  return done;
}

/** Periods whose toy Nu has already been given. */
export function toysSeen(): number[] { return read().toysSeen; }

export function giveToy(period: number): void {
  change((b) => { if (!b.toysSeen.includes(period)) b.toysSeen.push(period); });
}

// ---- Hide and seek ----

/** Whether Nu may hide today: not found yet, and tries left. */
export function hideDue(now = new Date()): boolean {
  const b = read(), day = dayKey(now);
  if (b.foundDay === day) return false;
  return b.hideDay !== day || b.hides < HIDES_A_DAY;
}

/** Nu goes to hide: one try used. */
export function hideTried(now = new Date()): void {
  const day = dayKey(now);
  change((b) => { if (b.hideDay !== day) { b.hideDay = day; b.hides = 0; } b.hides++; });
}

/** Found! */
export function found(now = new Date()): number {
  const b = change((o) => { o.foundDay = dayKey(now); o.finds++; });
  return b.finds;
}

export function finds(): number { return read().finds; }

/** Found today already. */
export function foundToday(now = new Date()): boolean { return read().foundDay === dayKey(now); }
