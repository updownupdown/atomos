// The games in Nu's park (park.ts), in the order they sit round its picker, with their icons.
// Kept apart from the park so Home can name Nu's pick of the day without loading the park.

import { dayIndex } from './bond';

export type GameId = 'sling' | 'course' | 'echo' | 'orbit' | 'shells' | 'herd' | 'trace' | 'tag';

export const S = (d: string) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${d}</svg>`;
export const ST = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"';
export const F = 'fill="currentColor"';

/** The games, in the order they sit round the picker. */
export const GAMES: { id: GameId; label: string; icon: string }[] = [
  { id: 'orbit', label: 'Orbit', icon: S(`<circle cx="12" cy="12" r="8" ${ST}/><circle cx="12" cy="4" r="2.6" ${F}/>`) },
  { id: 'sling', label: 'Sling', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><path d="M3.5 18C5 9 15 4 20.5 8.5" ${ST}/><circle cx="20.5" cy="8.5" r="2" ${F}/>`) },
  { id: 'shells', label: 'Shells', icon: S(`<circle cx="5.5" cy="14" r="3.5" ${ST}/><circle cx="12" cy="14" r="3.5" ${F}/><circle cx="18.5" cy="14" r="3.5" ${ST}/>`) },
  { id: 'echo', label: 'Echo', icon: S(`<circle cx="12" cy="4.5" r="2.3" ${F}/><circle cx="19.5" cy="10" r="2.3" ${F}/><circle cx="16.7" cy="19" r="2.3" ${F}/><circle cx="7.3" cy="19" r="2.3" ${F}/><circle cx="4.5" cy="10" r="2.3" ${F}/>`) },
  { id: 'herd', label: 'Herd', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><circle cx="12" cy="12" r="7" ${ST} stroke-dasharray="2 4"/><circle cx="20" cy="5" r="1.8" ${F}/><circle cx="4" cy="19" r="1.8" ${F}/>`) },
  { id: 'course', label: 'Course', icon: S(`<path d="M7 21V17c0-3 10-2 10-5.5S7 8.5 7 5.5V3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="7" cy="3.2" r="2" ${F}/>`) },
  { id: 'trace', label: 'Trace', icon: S(`<path d="M4 18c3-8 6 2 9-5s5-6 7-4" ${ST}/><circle cx="20" cy="9" r="2.2" ${F}/>`) },
  { id: 'tag', label: 'Tag', icon: S(`<circle cx="15" cy="9" r="3.4" ${F}/><path d="M4 20l6-6M9 20H4v-5" ${ST} stroke-linejoin="round"/>`) },
];

/** The game Nu fancies today: the same all day, a different one most days. It circles it in the
 *  park's picker, and Home's Nu section offers it. */
export function nuPick(index = dayIndex()): (typeof GAMES)[number] {
  return GAMES[((index * 5 + 3) % GAMES.length + GAMES.length) % GAMES.length];
}
