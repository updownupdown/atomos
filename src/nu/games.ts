// The games in Nu's park (park.ts), A to Z as they sit in its picker, with their icons.
// Kept apart from the park so Home can name Nu's pick of the day without loading the park.

import { dayIndex } from './bond';

export type GameId = 'sling' | 'course' | 'echo' | 'orbit' | 'shells' | 'herd' | 'trace' | 'hockey' | 'chain' | 'split' | 'pairs' | 'dive' | 'flash' | 'halo' | 'pulse';

export const S = (d: string) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${d}</svg>`;
export const ST = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"';
export const F = 'fill="currentColor"';

/** The games, A to Z, as they sit in the picker's grid. */
const LIST: { id: GameId; label: string; icon: string }[] = [
  { id: 'orbit', label: 'Orbit', icon: S(`<circle cx="12" cy="12" r="8" ${ST}/><circle cx="12" cy="4" r="2.6" ${F}/>`) },
  { id: 'sling', label: 'Sling', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><path d="M3.5 18C5 9 15 4 20.5 8.5" ${ST}/><circle cx="20.5" cy="8.5" r="2" ${F}/>`) },
  { id: 'shells', label: 'Shells', icon: S(`<circle cx="5.5" cy="14" r="3.5" ${ST}/><circle cx="12" cy="14" r="3.5" ${F}/><circle cx="18.5" cy="14" r="3.5" ${ST}/>`) },
  { id: 'echo', label: 'Echo', icon: S(`<circle cx="12" cy="4.5" r="2.3" ${F}/><circle cx="19.5" cy="10" r="2.3" ${F}/><circle cx="16.7" cy="19" r="2.3" ${F}/><circle cx="7.3" cy="19" r="2.3" ${F}/><circle cx="4.5" cy="10" r="2.3" ${F}/>`) },
  { id: 'herd', label: 'Herd', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><circle cx="12" cy="12" r="7" ${ST} stroke-dasharray="2 4"/><circle cx="20" cy="5" r="1.8" ${F}/><circle cx="4" cy="19" r="1.8" ${F}/>`) },
  { id: 'course', label: 'Course', icon: S(`<path d="M7 21V17c0-3 10-2 10-5.5S7 8.5 7 5.5V3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="7" cy="3.2" r="2" ${F}/>`) },
  { id: 'trace', label: 'Trace', icon: S(`<path d="M4 18c3-8 6 2 9-5s5-6 7-4" ${ST}/><circle cx="20" cy="9" r="2.2" ${F}/>`) },
  { id: 'hockey', label: 'Hockey', icon: S(`<circle cx="12" cy="5.5" r="3" ${F}/><circle cx="12" cy="18" r="3.6" ${ST}/><circle cx="15" cy="11.5" r="1.8" ${F}/><path d="M4 2.5v3M20 2.5v3" ${ST}/>`) },
  { id: 'chain', label: 'Chain', icon: S(`<circle cx="18" cy="6" r="3" ${F}/><circle cx="12" cy="9.5" r="2" ${F}/><circle cx="7.5" cy="13.5" r="2" ${F}/><circle cx="6" cy="19" r="2" ${F}/>`) },
  { id: 'split', label: 'Split', icon: S(`<circle cx="8" cy="5" r="2.2" ${F}/><circle cx="12.5" cy="4.5" r="2.2" ${ST}/><circle cx="16.5" cy="6.5" r="2.2" ${F}/><circle cx="12" cy="13" r="1.8" ${ST}/><path d="M6 20.5a8 8 0 0 1 12 0" ${ST}/>`) },
  { id: 'pairs', label: 'Pairs', icon: S(`<rect x="3" y="3" width="8" height="8" rx="4" ${F}/><rect x="13" y="3" width="8" height="8" rx="4" ${ST}/><rect x="3" y="13" width="8" height="8" rx="4" ${ST}/><rect x="13" y="13" width="8" height="8" rx="4" ${F}/>`) },
  { id: 'flash', label: 'Flash', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><circle cx="12" cy="4.5" r="2" ${ST}/><circle cx="18.5" cy="8.2" r="2" ${ST}/><circle cx="18.5" cy="15.8" r="2" ${F}/><circle cx="12" cy="19.5" r="2" ${ST}/><circle cx="5.5" cy="15.8" r="2" ${ST}/><circle cx="5.5" cy="8.2" r="2" ${ST}/>`) },
  { id: 'halo', label: 'Halo', icon: S(`<circle cx="12" cy="12" r="8.5" ${ST}/><circle cx="12" cy="12" r="2.2" ${F}/><circle cx="18" cy="6" r="2.4" ${F}/><path d="M14 14.5l2 2" ${ST}/>`) },
  { id: 'pulse', label: 'Pulse', icon: S(`<circle cx="12" cy="12" r="2.4" ${F}/><circle cx="12" cy="12" r="6" ${ST}/><circle cx="12" cy="12" r="9.6" ${ST} stroke-dasharray="3 3"/>`) },
  { id: 'dive', label: 'Dive', icon: S(`<path d="M8.4 4.3A8.5 8.5 0 1 0 15.6 4.3" ${ST}/><circle cx="12" cy="13" r="3" ${F}/><circle cx="12" cy="2.8" r="2" ${F}/>`) },
];

export const GAMES = LIST.slice().sort((a, b) => a.label.localeCompare(b.label));

/** The game Nu fancies today: the same all day, a different one most days. It circles it in the
 *  park's picker, and Home's Nu section offers it. */
export function nuPick(index = dayIndex()): (typeof GAMES)[number] {
  return GAMES[((index * 5 + 3) % GAMES.length + GAMES.length) % GAMES.length];
}

/** Some days Nu would rather read than play: the atom it wants to read about in the Atlas
 *  today, or null on a day it wants to play. One day in three, the same atom all day. */
export function nuReads(index = dayIndex(), atoms = 118): number | null {
  if (((index % 3) + 3) % 3 !== 1) return null;
  return 1 + (((index * 37 + 11) % atoms) + atoms) % atoms;
}
