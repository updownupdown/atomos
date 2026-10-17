// The games in Nu's park (park.ts), A to Z as they sit in its picker, with their icons.
// Kept apart from the park so Home can name Nu's pick of the day without loading the park.

import { dayIndex } from './bond';

export type GameId = 'sling' | 'course' | 'echo' | 'orbit' | 'shells' | 'herd' | 'hockey' | 'pairs' | 'dive' | 'flash' | 'halo' | 'pulse' | 'ripple' | 'hop' | 'juggle' | 'pull' | 'twin' | 'grow' | 'rain' | 'spot' | 'tilt' | 'flip' | 'more' | 'stick'
  | 'blast' | 'bumper' | 'cross' | 'cue' | 'dodge' | 'hue' | 'land' | 'order' | 'pop' | 'ready' | 'recall' | 'swing'
  | 'carve' | 'bank' | 'surf' | 'shade'
  | 'pole' | 'poise' | 'ferry' | 'fuse' | 'gate' | 'tune' | 'beat' | 'chord' | 'phase';

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
  { id: 'hockey', label: 'Hockey', icon: S(`<circle cx="12" cy="5.5" r="3" ${F}/><circle cx="12" cy="18" r="3.6" ${ST}/><circle cx="15" cy="11.5" r="1.8" ${F}/><path d="M4 2.5v3M20 2.5v3" ${ST}/>`) },
  { id: 'pairs', label: 'Pairs', icon: S(`<rect x="3" y="3" width="8" height="8" rx="4" ${F}/><rect x="13" y="3" width="8" height="8" rx="4" ${ST}/><rect x="3" y="13" width="8" height="8" rx="4" ${ST}/><rect x="13" y="13" width="8" height="8" rx="4" ${F}/>`) },
  { id: 'flash', label: 'Flash', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><circle cx="12" cy="4.5" r="2" ${ST}/><circle cx="18.5" cy="8.2" r="2" ${ST}/><circle cx="18.5" cy="15.8" r="2" ${F}/><circle cx="12" cy="19.5" r="2" ${ST}/><circle cx="5.5" cy="15.8" r="2" ${ST}/><circle cx="5.5" cy="8.2" r="2" ${ST}/>`) },
  { id: 'halo', label: 'Halo', icon: S(`<circle cx="12" cy="12" r="8.5" ${ST}/><circle cx="12" cy="12" r="2.2" ${F}/><circle cx="18" cy="6" r="2.4" ${F}/><path d="M14 14.5l2 2" ${ST}/>`) },
  { id: 'pulse', label: 'Pulse', icon: S(`<circle cx="12" cy="12" r="2.4" ${F}/><circle cx="12" cy="12" r="6" ${ST}/><circle cx="12" cy="12" r="9.6" ${ST} stroke-dasharray="3 3"/>`) },
  { id: 'ripple', label: 'Ripple', icon: S(`<circle cx="6" cy="18" r="2.2" ${F}/><path d="M6 11.5a6.5 6.5 0 0 1 6.5 6.5" ${ST}/><path d="M6 5.5A12.5 12.5 0 0 1 18.5 18" ${ST}/><circle cx="18" cy="6" r="2.6" ${ST}/>`) },
  { id: 'hop', label: 'Hop', icon: S(`<circle cx="15" cy="5" r="2.8" ${F}/><path d="M13.5 12.5h6M4.5 19h6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`) },
  { id: 'juggle', label: 'Juggle', icon: S(`<circle cx="12" cy="7.5" r="4" ${F}/><path d="M7 15.5l2 2M17 15.5l-2 2" ${ST}/><path d="M4 21h16" ${ST}/>`) },
  { id: 'pull', label: 'Pull', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><circle cx="4.5" cy="4.5" r="2" ${F}/><circle cx="19.5" cy="19.5" r="2" ${F}/><path d="M7.5 7.5l1.5 1.5M16.5 16.5L15 15" ${ST}/><circle cx="19.5" cy="4.5" r="2" ${ST}/><circle cx="4.5" cy="19.5" r="2" ${ST}/>`) },
  { id: 'twin', label: 'Twin', icon: S(`<circle cx="6.5" cy="6.5" r="3.5" ${F}/><circle cx="17.5" cy="17.5" r="3.5" ${ST}/><circle cx="12" cy="12" r="1.3" ${F}/>`) },
  { id: 'grow', label: 'Grow', icon: S(`<circle cx="10" cy="13" r="6" ${F}/><circle cx="19" cy="6" r="1.8" ${F}/><circle cx="19.5" cy="17.5" r="3" ${ST}/>`) },
  { id: 'rain', label: 'Rain', icon: S(`<circle cx="7" cy="4.5" r="1.9" ${F}/><circle cx="16" cy="7" r="1.9" ${F}/><circle cx="11" cy="11" r="1.9" ${ST}/><circle cx="12" cy="19" r="3.2" ${F}/>`) },
  { id: 'spot', label: 'Spot', icon: S(`<circle cx="6" cy="6" r="2.4" ${F}/><circle cx="12" cy="6" r="2.4" ${F}/><circle cx="18" cy="6" r="2.4" ${F}/><circle cx="6" cy="12.5" r="2.4" ${F}/><circle cx="12.5" cy="12.5" r="3.4" ${ST}/><circle cx="18" cy="12.5" r="2.4" ${F}/><circle cx="6" cy="19" r="2.4" ${F}/><circle cx="12" cy="19" r="2.4" ${F}/><circle cx="18" cy="19" r="2.4" ${F}/>`) },
  { id: 'tilt', label: 'Tilt', icon: S(`<path d="M3 17L21 9" ${ST}/><circle cx="10" cy="10.5" r="3" ${F}/><circle cx="17" cy="18" r="2.6" ${ST}/>`) },
  { id: 'flip', label: 'Flip', icon: S(`<path d="M3 3h18M3 21h18" ${ST}/><circle cx="7" cy="6.8" r="2.8" ${F}/><rect x="14.5" y="12" width="4.5" height="9" rx="2.25" ${ST}/>`) },
  { id: 'more', label: 'More', icon: S(`<path d="M12 3v18" ${ST} stroke-dasharray="2 3.5"/><circle cx="4.5" cy="7" r="1.9" ${F}/><circle cx="8" cy="12" r="1.9" ${F}/><circle cx="4.5" cy="17" r="1.9" ${F}/><circle cx="18" cy="12" r="1.9" ${F}/>`) },
  { id: 'stick', label: 'Stick', icon: S(`<circle cx="12" cy="10" r="3.5" ${F}/><circle cx="12" cy="10" r="7" ${ST} stroke-dasharray="2 3"/><circle cx="5.5" cy="7.5" r="1.9" ${F}/><circle cx="17.5" cy="5" r="1.9" ${F}/><circle cx="12" cy="21" r="1.9" ${ST}/>`) },
  { id: 'blast', label: 'Blast', icon: S(`<circle cx="12" cy="12" r="3.2" ${F}/><circle cx="4.5" cy="5" r="2" ${ST}/><circle cx="19.5" cy="17" r="2" ${ST}/><circle cx="17.5" cy="6.5" r="1.5" ${F}/><path d="M14.5 9.5l1.5-1.5" ${ST}/>`) },
  { id: 'bumper', label: 'Bumper', icon: S(`<circle cx="8" cy="6" r="3" ${ST}/><circle cx="16.5" cy="9" r="3" ${ST}/><circle cx="12" cy="14" r="2" ${F}/><path d="M3.5 18l5 2.5M20.5 18l-5 2.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`) },
  { id: 'cross', label: 'Cross', icon: S(`<circle cx="12" cy="20" r="2.4" ${F}/><circle cx="5" cy="14" r="1.8" ${F}/><circle cx="17" cy="14" r="1.8" ${F}/><circle cx="9" cy="8.5" r="1.8" ${F}/><circle cx="20" cy="8.5" r="1.8" ${F}/><path d="M4 3.5h16" ${ST}/>`) },
  { id: 'cue', label: 'Cue', icon: S(`<circle cx="7" cy="17" r="3" ${F}/><circle cx="14" cy="9" r="2.6" ${ST}/><circle cx="18.5" cy="5" r="2.6" ${ST}/><path d="M3 21l1.5-1.5" ${ST}/>`) },
  { id: 'dodge', label: 'Dodge', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><circle cx="4" cy="6" r="1.7" ${ST}/><circle cx="20" cy="8" r="1.7" ${ST}/><circle cx="6" cy="19.5" r="1.7" ${ST}/><circle cx="18.5" cy="19" r="1.7" ${ST}/>`) },
  { id: 'hue', label: 'Hue', icon: S(`<path d="M12 3.5a6 6 0 0 1 6 6" ${ST}/><path d="M18 9.5a6 6 0 0 1-6 6" ${ST} stroke-dasharray="2 3"/><path d="M12 15.5a6 6 0 0 1-6-6" ${ST}/><path d="M6 9.5a6 6 0 0 1 6-6" ${ST} stroke-dasharray="2 3"/><circle cx="12" cy="20.5" r="2.3" ${F}/>`) },
  { id: 'land', label: 'Land', icon: S(`<circle cx="9" cy="6" r="3" ${F}/><circle cx="9" cy="11.5" r="1.3" ${F}/><circle cx="9" cy="14.5" r="1" ${F}/><path d="M3 20.5h18" ${ST}/><path d="M13 20.5h6" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>`) },
  { id: 'order', label: 'Order', icon: S(`<circle cx="4.5" cy="15" r="1.6" ${F}/><circle cx="9.5" cy="14" r="2.5" ${F}/><circle cx="17" cy="12.5" r="4.2" ${ST}/>`) },
  { id: 'pop', label: 'Pop', icon: S(`<circle cx="5" cy="4.5" r="2.2" ${F}/><circle cx="10" cy="4.5" r="2.2" ${ST}/><circle cx="15" cy="4.5" r="2.2" ${F}/><circle cx="7.5" cy="9" r="2.2" ${F}/><circle cx="12.5" cy="9" r="2.2" ${ST}/><circle cx="12" cy="19.5" r="2.4" ${F}/><path d="M12 16l.8-3" ${ST}/>`) },
  { id: 'ready', label: 'Ready', icon: S(`<circle cx="12" cy="12" r="3.5" ${F}/><circle cx="12" cy="12" r="8.5" ${ST}/><path d="M12 1.5v2M12 20.5v2" ${ST}/>`) },
  { id: 'recall', label: 'Recall', icon: S(`<circle cx="5" cy="5" r="2.2" ${F}/><circle cx="12" cy="5" r="2.2" ${ST}/><circle cx="19" cy="5" r="2.2" ${ST}/><circle cx="5" cy="12" r="2.2" ${ST}/><circle cx="12" cy="12" r="2.2" ${F}/><circle cx="19" cy="12" r="2.2" ${ST}/><circle cx="5" cy="19" r="2.2" ${ST}/><circle cx="12" cy="19" r="2.2" ${ST}/><circle cx="19" cy="19" r="2.2" ${F}/>`) },
  { id: 'swing', label: 'Swing', icon: S(`<circle cx="7" cy="4" r="2" ${F}/><path d="M7 6.5l5 7" ${ST} stroke-dasharray="1.5 2.5"/><circle cx="13.5" cy="15.5" r="3" ${F}/><circle cx="19.5" cy="5.5" r="2" ${ST}/>`) },
  { id: 'dive', label: 'Dive', icon: S(`<path d="M8.4 4.3A8.5 8.5 0 1 0 15.6 4.3" ${ST}/><circle cx="12" cy="13" r="3" ${F}/><circle cx="12" cy="2.8" r="2" ${F}/>`) },
  { id: 'pole', label: 'Pole', icon: S(`<circle cx="12" cy="12" r="3" ${F}/><circle cx="12" cy="12" r="6.5" ${ST}/><path d="M17.5 4.5h4M19.5 2.5v4M2.5 19.5h4" ${ST}/>`) },
  { id: 'poise', label: 'Poise', icon: S(`<path d="M3 15.5l18-3" ${ST}/><circle cx="12" cy="17" r="2" ${F}/><path d="M12 19v3" ${ST}/><circle cx="6" cy="11.5" r="3" ${F}/><circle cx="18" cy="8.5" r="2.2" ${ST}/>`) },
  { id: 'ferry', label: 'Ferry', icon: S(`<circle cx="12" cy="12" r="1.8" ${F}/><path d="M9.5 3.3A9 9 0 1 0 14.5 3.3" ${ST}/><path d="M13.5 16.8A5 5 0 1 0 10.5 16.8" ${ST}/><circle cx="20.5" cy="20.5" r="1.8" ${F}/>`) },
  { id: 'fuse', label: 'Fuse', icon: S(`<circle cx="9" cy="3.8" r="2.3" ${F}/><path d="M3 8.5h18" ${ST} stroke-dasharray="2 3"/><circle cx="7" cy="17.5" r="3.5" ${F}/><circle cx="15.5" cy="16" r="5" ${ST}/>`) },
  { id: 'gate', label: 'Gate', icon: S(`<circle cx="12" cy="5" r="2.8" ${F}/><circle cx="5" cy="13" r="1.8" ${F}/><circle cx="13" cy="13" r="1.8" ${F}/><circle cx="11" cy="20.5" r="1.8" ${ST}/><circle cx="19" cy="20.5" r="1.8" ${ST}/>`) },
  { id: 'tune', label: 'Tune', icon: S(`<path d="M2 12c2-6 4-6 6 0s4 6 6 0" ${ST}/><path d="M14 12c1.5-4 2.5-4 4 0s2.5 4 4 0" ${ST} stroke-dasharray="2 2.5"/><circle cx="14" cy="12" r="2.6" ${F}/>`) },
  { id: 'beat', label: 'Beat', icon: S(`<path d="M2 12Q7 3 12 12T22 12" ${ST}/><path d="M2 12Q7 21 12 12T22 12" ${ST} stroke-dasharray="2 2.5"/><circle cx="7" cy="7.5" r="2.4" ${F}/>`) },
  { id: 'chord', label: 'Chord', icon: S(`<path d="M3 4v12M21 4v12" ${ST}/><path d="M3 10c2-5 4-5 6 0s4 5 6 0 4-5 6 0" ${ST}/><circle cx="15" cy="10" r="2.6" ${ST}/><circle cx="9" cy="20.5" r="2" ${F}/>`) },
  { id: 'phase', label: 'Phase', icon: S(`<path d="M2 16c2.5-8 5.5-8 8 0s5.5 8 8 0" ${ST}/><circle cx="6" cy="9.5" r="3" ${ST}/><circle cx="18" cy="9.5" r="3" ${ST} stroke-dasharray="2 2"/><circle cx="10" cy="16" r="2.4" ${F}/>`) },
  { id: 'carve', label: 'Carve', icon: S(`<rect x="3" y="3" width="18" height="18" rx="3" ${ST}/><path d="M11 3v18M11 12h10" ${ST}/><rect x="13" y="14" width="6" height="5" rx="1" ${F}/><circle cx="7" cy="8" r="1.8" ${F}/>`) },
  { id: 'bank', label: 'Bank', icon: S(`<path d="M11 17.5L3.5 11L15 5" ${ST} stroke-dasharray="2 3"/><circle cx="18" cy="4.5" r="2.6" ${ST}/><circle cx="12" cy="20" r="2.6" ${F}/>`) },
  { id: 'surf', label: 'Surf', icon: S(`<path d="M2 17c3-6 6-6 9 0s6 6 9 0" ${ST}/><circle cx="9" cy="7" r="2.8" ${F}/><circle cx="17" cy="5" r="1.6" ${F}/>`) },
  { id: 'shade', label: 'Shade', icon: S(`<circle cx="4" cy="4" r="2.2" ${F}/><path d="M5.5 5.5L21 12M5.5 5.5L12 21" ${ST}/><circle cx="18" cy="19" r="3.5" ${ST}/><circle cx="18" cy="19" r="1.6" ${F}/>`) },
];

export const GAMES = LIST.slice().sort((a, b) => a.label.localeCompare(b.label));

/** The game Nu fancies today: the same all day, a different one most days. It circles it in the
 *  park's picker, and Home's Nu section offers it. */
export function nuPick(index = dayIndex()): (typeof GAMES)[number] {
  return GAMES[((index * 5 + 3) % GAMES.length + GAMES.length) % GAMES.length];
}
