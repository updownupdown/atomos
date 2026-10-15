// What the Atlas has to earn, and the moment each one opens. Shapes open as periods are built,
// colors and the time-lapse with the first win of their game (src/core/unlocks.ts). When one
// opens, a toast says so; the next visit to the Atlas shows it off once (atlas.ts takeFresh).
//
//   watchEarnings();                 // once, at start
//   earnables(save)                  // every shape, color and toy, open or not, with how to earn it

import { gameWon, isUnlocked, nextForPeriod, nextMeeting, periodCount, SHAPE_PERIOD, SHOWN_BY, type UnlockId } from '../core/unlocks';
import { playsOf } from '../core/plays';
import { loadSave, type SaveData } from '../core/save';
import { PUZZLES } from '../puzzles/catalog';
import { showToast } from '../ui/components';
import { elementAt } from './data';
import { LAYOUTS } from './layouts';
import { LOOKS } from './looks';
import { nuShow } from '../ui/nu';

export type EarnKind = 'shape' | 'color' | 'toy';

export interface Earnable {
  id: UnlockId;
  kind: EarnKind;
  label: string;
  open: boolean;
  /** How it opens, or opened: "Build all of Period 3", "Opened by Tessera". */
  how: string;
  /** A shape: its period and how far it is built. */
  period?: number;
  count?: { built: number; total: number };
  /** The atom to build next toward it. */
  next?: number | null;
  /** A color or toy: its game, whether it has been played, and where building next meets it. */
  game?: string;
  played?: boolean;
}

export const gameName = (id: string): string => PUZZLES.find((p) => p.id === id)?.name ?? id;
/** "a Tessera puzzle", "an Aurum puzzle". */
export const aPuzzle = (id: string): string => { const n = gameName(id); return `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n} puzzle`; };

/** Every shape, color and toy there is to earn in the Atlas, in the order they are listed. */
export function earnables(save: SaveData = loadSave()): Earnable[] {
  const out: Earnable[] = [];
  for (const l of LAYOUTS) {
    const period = SHAPE_PERIOD[l.id];
    if (period === undefined) continue;
    const id = `lens:${l.id}` as UnlockId;
    const open = isUnlocked(id, save);
    out.push({ id, kind: 'shape', label: l.label, open, period, count: periodCount(period, save), next: open ? null : nextForPeriod(period, save), how: `Build all of Period ${period}` });
  }
  for (const l of LOOKS) {
    const id = `look:${l.id}` as UnlockId;
    const game = SHOWN_BY[id];
    if (!game) continue;
    out.push(colorOrToy(id, 'color', l.label, game, save));
  }
  out.push(colorOrToy('toy:timelapse', 'toy', 'Time-lapse', SHOWN_BY['toy:timelapse'], save));
  return out;
}

function colorOrToy(id: UnlockId, kind: EarnKind, label: string, game: string, save: SaveData): Earnable {
  const open = isUnlocked(id, save);
  return {
    id, kind, label, open, game,
    played: playsOf(game) > 0 || gameWon(game, save),
    next: open ? null : nextMeeting(game, save),
    how: open ? `Opened by ${gameName(game)}` : `Win ${aPuzzle(game)}`,
  };
}

/** "Meet it on boron" for a locked color, or how else to find its game. */
export function meetText(e: Earnable): string {
  if (e.next) return `Meet it on ${elementAt(e.next).name.toLowerCase()}`;
  return e.game === 'light' ? 'Pick it for a fleeting isotope' : 'Find it on the Puzzles screen';
}

// ---- The moment something opens ---------------------------------------------------------------

const SEEN_KEY = 'atomos.atlas.earned.v1';
const FRESH_KEY = 'atomos.atlas.fresh.v1';

const readList = (key: string): string[] | null => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch { return null; }
};
const writeList = (key: string, v: string[]) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off: no fanfare */ } };

/** Everything open now that a toast could announce: the Atlas earnables and the nucleus view. */
function openNow(save: SaveData): string[] {
  const ids = earnables(save).filter((e) => e.open).map((e) => e.id as string);
  if (isUnlocked('nucleus-view', save)) ids.push('nucleus-view');
  return ids;
}

function toastText(id: string): string {
  if (id === 'nucleus-view') return 'The nucleus view is open';
  const e = earnables().find((x) => x.id === id);
  if (!e) return '';
  return e.kind === 'shape' ? `${e.label} is open in the Atlas` : e.kind === 'toy' ? 'Time-lapse is open in the Atlas' : `${e.label} colors are open in the Atlas`;
}

let watching = false;
/** Watches wins and progress, and announces anything newly open. The first run only notes what
 *  is open already, so an existing player is not greeted with a pile of toasts. */
export function watchEarnings(): void {
  if (watching) return;
  watching = true;
  if (!readList(SEEN_KEY)) writeList(SEEN_KEY, openNow(loadSave()));
  let timer = 0;
  const check = () => {
    clearTimeout(timer);
    // After the save is written and the win sheet is up.
    timer = window.setTimeout(() => {
      const save = loadSave();
      if (save.settings.unlockAll) return;
      const seen = new Set(readList(SEEN_KEY) ?? []);
      const now = openNow(save).filter((id) => !seen.has(id));
      if (!now.length) return;
      writeList(SEEN_KEY, [...seen, ...now]);
      writeList(FRESH_KEY, [...(readList(FRESH_KEY) ?? []), ...now.filter((id) => id !== 'nucleus-view')]);
      now.forEach((id, i) => setTimeout(() => showToast(toastText(id), { tone: 'good', duration: 3400 }), i * 900));
      // Nu carries the news to the Atlas button, where there is one on screen.
      setTimeout(() => {
        const learn = [...document.querySelectorAll<HTMLElement>('#nav-gallery, #bh-to-info')].find((b) => !b.hidden && b.getClientRects().length);
        if (learn) nuShow(learn, { key: 'earned' });
      }, 600);
    }, 500);
  };
  window.addEventListener('atomos:win', check);
  window.addEventListener('atomos:progress', check);
}

/** What opened since the Atlas last showed it off, oldest first; clears the list. */
export function takeFresh(): string[] {
  const v = readList(FRESH_KEY) ?? [];
  if (v.length) writeList(FRESH_KEY, []);
  return v;
}
