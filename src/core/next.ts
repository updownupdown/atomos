// The one next thing to do, wherever the player is: the Gallery's Up next card, the Next button on
// the Build page and the win panel all ask nextStep(), so they always agree. In order:
//   1. a puzzle left half done (the Build page reports it with notePaused);
//   2. the current atom's nucleus, then its electrons, if its period is open;
//   3. a new orbital shape to discover on the current atom, once that atom is built;
//   4. the lowest-numbered open atom that isn't built, its nucleus first;
//   5. the first missing lasting isotope, lowest atom first;
//   6. an orbital shape not yet discovered on an atom that is built.
// Fleeting isotopes are never the next step: they are for when the player wants more.
// openStep() and openAtom() take the player there; the app shell supplies the way (setNavigator).

import { atomGame } from './atomGames';
import { MAX_Z, elementAt } from '../gallery/data';
import { SHAPE_AT, atomBuilt, isotopeGame, isotopeCollected, lastingIsotopes, rowOf, rowOpen, shapeAt, stepState, stepsOf } from './progress';
import { loadSave, type OrbitalShape, type SaveData, type StepId } from './save';

export type NextKind = 'resume' | 'nucleus' | 'electrons' | 'lasting' | 'discovery';

export interface NextStep {
  z: number;
  kind: NextKind;
  /** The isotope's mass number, for a lasting isotope (or a paused isotope puzzle). */
  a?: number;
  /** Catalog id of the puzzle that plays it, e.g. 'merge'. */
  game: string;
  /** The puzzle's name, e.g. "Tokamak". */
  gameName: string;
  /** Player text: "Helium's nucleus", "Helium-3", "The p orbital shape", "Resume Tessera · H-2". */
  label: string;
  /** The Build page stage that plays it: 'nucleus', 'shells', 'iso-3', 'shape', 'fl-5-light'. */
  stage: string;
}

/** Puzzle names by catalog id, kept here so the gallery needn't load the puzzles to show one. */
export const GAME_NAMES: Record<string, string> = {
  merge: 'Tokamak', orbitalGrid: 'Quanta', sliding: 'Nova', packing: 'Tessera', lines: 'Flux',
  slideStop: 'Inertia', light: 'Lumen', rutherford: 'Aurum', codebreaker: 'Glyph', colorCharge: 'Chroma',
  bond: 'Bond', spin: 'Spin', fission: 'Fission',
};

let paused: { z: number; stage: string; game: string } | null = null;

/** The Build page reports the puzzle it keeps half done (or null once there is none). */
export function notePaused(p: { z: number; stage: string; game: string } | null): void {
  paused = p;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function stepNext(z: number, id: StepId): NextStep {
  const name = elementAt(z).name;
  const game = atomGame(z, id === 'nucleus' ? 'nucleus' : 'shells');
  return id === 'nucleus'
    ? { z, kind: 'nucleus', game, gameName: GAME_NAMES[game], label: `${name}'s nucleus`, stage: 'nucleus' }
    : { z, kind: 'electrons', game, gameName: GAME_NAMES[game], label: `${name}'s electrons`, stage: 'shells' };
}

function shapeNext(z: number, l: OrbitalShape): NextStep {
  return { z, kind: 'discovery', game: 'codebreaker', gameName: GAME_NAMES.codebreaker, label: `The ${l} orbital shape`, stage: 'shape' };
}

/** What a Build page stage plays, for a paused puzzle. */
function stageNext(z: number, stage: string, game: string): NextStep {
  const el = elementAt(z);
  const fl = /^fl-(\d+)-/.exec(stage);
  const iso = /^iso-(\d+)$/.exec(stage);
  const a = fl ? Number(fl[1]) : iso ? Number(iso[1]) : undefined;
  const what = a !== undefined ? `${el.symbol}-${a}`
    : stage === 'shape' ? `${shapeAt(z) ?? ''} orbital shape`
    : stage === 'nucleus' ? `${el.name}'s nucleus` : `${el.name}'s electrons`;
  const gameName = GAME_NAMES[game] ?? cap(game);
  return { z, kind: 'resume', ...(a !== undefined ? { a } : {}), game, gameName, label: `Resume ${gameName} · ${what}`, stage };
}

/** The atom's first step still to do, if its period is open. */
function openStepOf(z: number, save: SaveData): NextStep | null {
  if (!rowOpen(rowOf(z), save)) return null;
  const id = stepsOf(z).find((s) => !stepState(save, z, s).done);
  return id ? stepNext(z, id) : null;
}

function undiscovered(z: number, save: SaveData): OrbitalShape | undefined {
  const l = shapeAt(z);
  return l && !save.shapes[l] && atomBuilt(z, save) ? l : undefined;
}

/** The one next thing to do (see the top of this file), or null when everything is done. */
export function nextStep(save: SaveData = loadSave(), currentZ?: number): NextStep | null {
  if (paused && (currentZ === undefined || paused.z === currentZ)) return stageNext(paused.z, paused.stage, paused.game);
  if (currentZ !== undefined && currentZ >= 1 && currentZ <= MAX_Z) {
    const here = openStepOf(currentZ, save);
    if (here) return here;
    const l = undiscovered(currentZ, save);
    if (l) return shapeNext(currentZ, l);
  }
  for (let z = 1; z <= MAX_Z; z++) {
    const s = openStepOf(z, save);
    if (s) return s;
  }
  for (let z = 1; z <= MAX_Z; z++) {
    if (!atomBuilt(z, save)) continue;
    const iso = lastingIsotopes(z).find((i) => !isotopeCollected(save, z, i.a));
    if (!iso) continue;
    const game = isotopeGame(z, iso.a) ?? 'packing';
    return { z, kind: 'lasting', a: iso.a, game, gameName: GAME_NAMES[game], label: `${elementAt(z).name}-${iso.a}`, stage: `iso-${iso.a}` };
  }
  for (const l of Object.keys(SHAPE_AT) as OrbitalShape[]) {
    const z = SHAPE_AT[l];
    if (undiscovered(z, save)) return shapeNext(z, l);
  }
  return null;
}

function lastingNext(z: number, save: SaveData): NextStep | null {
  if (!atomBuilt(z, save)) return null;
  const iso = lastingIsotopes(z).find((i) => !isotopeCollected(save, z, i.a));
  if (!iso) return null;
  const game = isotopeGame(z, iso.a) ?? 'packing';
  return { z, kind: 'lasting', a: iso.a, game, gameName: GAME_NAMES[game], label: `${elementAt(z).name}-${iso.a}`, stage: `iso-${iso.a}` };
}

/** The next thing to do on this atom itself: a step, its orbital shape, a lasting isotope. */
export function nextStepHere(z: number, save: SaveData = loadSave()): NextStep | null {
  const step = openStepOf(z, save);
  if (step) return step;
  const l = undiscovered(z, save);
  return l ? shapeNext(z, l) : lastingNext(z, save);
}

/** The next thing to do on any other atom: the first step after this atom (wrapping round),
 *  then another atom's lasting isotope or shape. */
export function nextStepElsewhere(z: number, save: SaveData = loadSave()): NextStep | null {
  for (let k = 1; k < MAX_Z; k++) {
    const s = openStepOf(((z - 1 + k) % MAX_Z) + 1, save);
    if (s) return s;
  }
  for (let o = 1; o <= MAX_Z; o++) {
    if (o === z) continue;
    const s = lastingNext(o, save);
    if (s) return s;
  }
  for (const l of Object.keys(SHAPE_AT) as OrbitalShape[]) {
    if (SHAPE_AT[l] !== z && undiscovered(SHAPE_AT[l], save)) return shapeNext(SHAPE_AT[l], l);
  }
  return null;
}

/** The step as a button label: "Next: helium's nucleus", or "Resume Tessera · H-2". */
export function nextLabel(step: NextStep): string {
  return step.kind === 'resume' ? step.label : `Next: ${step.label.charAt(0).toLowerCase()}${step.label.slice(1)}`;
}

export interface Navigator {
  /** The atom's Build page, with the step's puzzle open. */
  openStep(step: NextStep): void;
  /** The atom's Build page if it isn't built yet, its View page if it is. */
  openAtom(z: number): void;
}

let nav: Navigator | null = null;

/** The app shell says how to get around; until it has, these do nothing. */
export function setNavigator(n: Navigator): void {
  nav = n;
}

/** Takes the player to a step: the atom's Build page with that puzzle started. */
export function openStep(step: NextStep): void {
  nav?.openStep(step);
}

/** Opens an atom: Build if it isn't built yet, View if it is. */
export function openAtom(z: number): void {
  nav?.openAtom(z);
}
