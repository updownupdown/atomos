// A fact about an atom for the win sheet: its history, discovery, uses, origins or a curiosity,
// drawn at random from what the Info screen already holds (src/data/element-facts.json and
// element-story.json). Physical properties are left out; the Info screen has those.

import FACTS from '../data/element-facts.json';
import STORY from '../data/element-story.json';

const PHYSICAL = /\b(melts?|melting|boils?|boiling|density|dense|denser|conducts?|conductor|°|kelvin|lightest|heaviest|hardest|softest|radius|electronegativ\w*|shiny|silvery|lustrous|brittle|malleable|ductile|colorless|odorless|gas at|liquid at|solid at)\b/i;

const facts = FACTS as { h?: string; f?: string[] }[];
const story = STORY as { z: number; origins?: string[]; uses?: string[] }[];

/** Every fact there is about element z, physical properties left out. */
export function factsOf(z: number): string[] {
  const f = facts[z - 1];
  const s = story.find((e) => e.z === z);
  return [...(f?.f ?? []), ...(s?.origins ?? []), ...(s?.uses ?? [])]
    .map((t) => t.replace(/^Historical:\s*/, ''))
    .filter((t) => !PHYSICAL.test(t));
}

let last = '';

/** A random fact about element z, not the one shown last time when there is a choice. */
export function atomFact(z: number): string | undefined {
  const all = factsOf(z);
  const pool = all.length > 1 ? all.filter((t) => t !== last) : all;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick) last = pick;
  return pick;
}
