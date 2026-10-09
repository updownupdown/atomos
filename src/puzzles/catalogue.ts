// Every puzzle type the game will have, in one list: the two that are built,
// and the rest from the locked progression map, so the playground can show
// where each one sits and the game can ask for a level by id.

import { element } from '../core/elements';
import { applyPlacement, configuration, newAtom, resolvePlacement } from '../core/physics';
import { newMerge } from './merge';
import { MergeView, sup } from './mergeView';
import { newRings } from './rings';
import { RingsView } from './ringsView';
import { SUBSHELL_COLOURS, type PuzzleView } from './view';

export type Tier = 'every' | 'facet' | 'gate' | 'reserve';

export const TIER_LABEL: Record<Tier, string> = {
  every: 'Every atom',
  facet: 'Facets',
  gate: 'Gates',
  reserve: 'Reserve',
};

export interface PuzzleType {
  id: string;
  name: string;
  tier: Tier;
  /** What the player does, in a line. */
  blurb: string;
  /** Where it sits in the progression. */
  role: string;
  /** Elements it makes sense for (inclusive). */
  zRange: [number, number];
  /** Present once the puzzle is built; planned types have none. */
  make?: (z: number, deal: number, reducedMotion: boolean) => PuzzleView;
  /** The science behind it, as sheet HTML. */
  science?: (z: number) => string;
}

/** The seed for a given element and deal, so a deal replays the same for everyone. */
export function dealSeed(id: string, z: number, deal: number): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h ^ (z * 7919)) + deal * 104729) >>> 0;
}

function groundConfiguration(z: number): string {
  let a = newAtom(z);
  for (let i = 0; i < z; i++) {
    const r = resolvePlacement(a);
    if (r?.kind === 'placed') a = applyPlacement(a, r.orbital, r.spin);
  }
  return configuration(a);
}

export const PUZZLES: PuzzleType[] = [
  {
    id: 'merge', name: 'Merge', tier: 'every',
    blurb: 'Swipe to slide the board; matching nuclei fuse into heavier ones.',
    role: 'Builds the nucleus of every element up to iron. Being redesigned so that like merges with like.',
    zRange: [2, 26],
    make: (z, deal, reduced) => new MergeView(newMerge({ z, a: element(z).commonA }, dealSeed('merge', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Merge: the science</h2>
        <p>A nucleus is protons and neutrons held together by the strong force. Stars build the elements up to iron by <b>fusion</b>: light nuclei slam together and stick, releasing energy. Hydrogen fuses to helium in the Sun; three heliums make carbon in red giants.</p>
        <p>On this board, two nuclei fuse only when their sum is a nuclide that really exists. A proton and a neutron make deuterium, two deuterons an alpha, but two protons make nothing: helium-2 falls apart at once. Beryllium-8 cracks because the real one splits back into two alphas in a hundred-quadrillionth of a second, which is why stars need three heliums at once to make carbon.</p>
        <p class="muted">Game rule: real nuclei do not slide about, and fusing anything past hydrogen takes the heat of a star. ${sup(String(el.commonA))}${el.symbol} is ${el.name}'s most common isotope, ${z} protons and ${el.commonA - z} neutrons.</p>`;
    },
  },
  {
    id: 'rings', name: 'Shell Rings', tier: 'every',
    blurb: 'Turn the rings and hop electrons through the gate until every socket is lit.',
    role: 'Settles the electron shells of all 118 elements.',
    zRange: [1, 118],
    make: (z, deal, reduced) => new RingsView(newRings(z, dealSeed('rings', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Shell Rings: the science</h2>
        <p>Electrons live in <b>shells</b> round the nucleus, and shell n holds at most 2n² electrons: 2, then 8, then 18. That is the real reason the periodic table has rows of 2, 8, 8, 18. Each ring here has exactly that many slots.</p>
        <p>The sockets are coloured by sub-shell: <span style="color:${SUBSHELL_COLOURS.s}">s</span> holds 2, <span style="color:${SUBSHELL_COLOURS.p}">p</span> holds 6, <span style="color:${SUBSHELL_COLOURS.d}">d</span> 10, <span style="color:${SUBSHELL_COLOURS.f}">f</span> 14. Electrons fill the lowest-energy sockets first, which for ${el.name} gives ${groundConfiguration(z)}. Every socket lit and nothing stray is the <b>ground state</b>.</p>
        <p class="muted">Game rule: electrons are not beads and there is no gate; a real electron is a cloud of probability, which is what the atom behind this puzzle shows.</p>`;
    },
  },
  {
    id: 'sliding', name: 'Sliding Block', tier: 'every',
    blurb: 'Slide the blocks out of the way so the key piece reaches the exit.',
    role: 'Builds the nucleus of every element past iron, where fusion stops paying.',
    zRange: [27, 118],
  },
  {
    id: 'packing', name: 'Packing', tier: 'facet',
    blurb: 'Fit the pieces into the outline so nothing sticks out.',
    role: 'Opens an element\'s isotope vault; later isotopes rotate Packing, Merge and Sliding Block.',
    zRange: [1, 118],
  },
  {
    id: 'lines', name: 'Field Lines', tier: 'facet',
    blurb: 'Draw one path through the grid that obeys every mark it passes.',
    role: 'Discovers each new orbital shape (19) and a chapter per particle (17).',
    zRange: [1, 118],
  },
  {
    id: 'decay', name: 'Decay Path', tier: 'facet',
    blurb: 'Follow a radioactive isotope step by step down to something stable.',
    role: 'Rare, visual and number-free; only for radioactive isotopes.',
    zRange: [1, 118],
  },
  {
    id: 'slideStop', name: 'Slide Until Stop', tier: 'gate',
    blurb: 'Skate across the ice: you only stop when you hit something.',
    role: 'Opens each new period of the table.',
    zRange: [1, 118],
  },
  {
    id: 'light', name: 'Light Routing', tier: 'gate',
    blurb: 'Turn the mirrors so the beam lands on every target.',
    role: 'Opens each new lens (arrangement) of the gallery.',
    zRange: [1, 118],
  },
  {
    id: 'rutherford', name: 'Rutherford Probe', tier: 'gate',
    blurb: 'Fire particles at the unseen and work out what is there from how they scatter.',
    role: 'Played once; opens the nucleus view.',
    zRange: [79, 79],
  },
  {
    id: 'codebreaker', name: 'Codebreaker', tier: 'gate',
    blurb: 'Guess the hidden sequence from the clues each guess earns.',
    role: 'Guards the 15 synthetic elements.',
    zRange: [104, 118],
  },
  {
    id: 'colour', name: 'Colour Charge', tier: 'reserve',
    blurb: 'Combine three colours so every piece ends up white.',
    role: 'In reserve for quarks, if a particle chapter wants it.',
    zRange: [1, 118],
  },
  {
    id: 'orbitalGrid', name: 'Orbital Grid', tier: 'reserve',
    blurb: 'Place the orbitals so every row and column balances.',
    role: 'In reserve.',
    zRange: [1, 118],
  },
];

export function puzzleType(id: string): PuzzleType {
  return PUZZLES.find((p) => p.id === id)!;
}
