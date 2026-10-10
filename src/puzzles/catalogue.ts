// Every puzzle type the game will have, in one list: the two that are built,
// and the rest from the locked progression map, so the playground can show
// where each one sits and the game can ask for a level by id.

import { elementAt as element } from '../gallery/data';
import { applyPlacement, configuration, newAtom, resolvePlacement } from '../core/physics';
import { newMerge } from './merge';
import { MergeView, sup, INSTRUCTIONS as MERGE_HOW } from './mergeView';
import { newRings } from './rings';
import { newSliding } from './sliding';
import { SlidingView } from './slidingView';
import { newPacking } from './packing';
import { PackingView } from './packingView';
import { newLines } from './lines';
import { LinesView } from './linesView';
import { newSlideStop } from './slideStop';
import { SlideStopView } from './slideStopView';
import { newLight } from './light';
import { LightView } from './lightView';
import { newCodebreaker } from './codebreaker';
import { CodebreakerView } from './codebreakerView';
import { newRutherford } from './rutherford';
import { RutherfordView } from './rutherfordView';
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
  /** How to play, and notes for playtesting, as sheet HTML for the Instructions modal. */
  instructions?: string;
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
    blurb: 'Swipe to slide the board; two clusters of the same size merge. Gather the clusters the nucleus wants.',
    role: 'Builds the nucleus of every element up to iron.',
    instructions: MERGE_HOW,
    zRange: [2, 26],
    make: (z, deal, reduced) => new MergeView(newMerge({ z, a: element(z).commonA }, dealSeed('merge', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      const parts = [];
      for (let b = 64; b >= 1; b >>= 1) if (el.commonA & b) parts.push(b);
      return `<h2>Merge: the science</h2>
        <p>A nucleus is protons and neutrons, its <b>nucleons</b>, held together by the strong force. ${sup(String(el.commonA))}${el.symbol}, ${el.name}'s most common isotope, has ${el.commonA} of them: ${z} protons and ${el.commonA - z} neutrons.</p>
        <p>Stars build the elements up to iron by <b>fusion</b>: light nuclei slam together and stick, releasing energy. Hydrogen fuses to helium in the Sun; three heliums make carbon in red giants. Past iron, fusion costs more energy than it gives, which is why the heavier elements need a different puzzle.</p>
        <p class="muted">Game rule: the board counts nucleons in clusters that double when two of a size meet, and ${el.commonA} written that way is ${parts.join(' + ')}. Real nuclei are not assembled by pairing clusters, and nothing slides about inside a star.</p>`;
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
    blurb: 'Drag the bars out of the way so the red key bar can slide out.',
    role: 'Builds the nucleus of every element past iron, where fusion stops paying.',
    zRange: [27, 118],
    make: (z, deal, reduced) => new SlidingView(newSliding(z, dealSeed('sliding', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Sliding Block: the science</h2>
        <p>Fusion stops paying at iron: its nucleus is the most tightly bound of all, so sticking more nuclei to it costs energy instead of releasing it. The elements past iron, ${el.name} among them, are made another way: a nucleus <b>captures neutrons</b> one at a time, and some of those neutrons turn into protons by beta decay, nudging it up the table.</p>
        <p>The slow version (the <b>s-process</b>) happens over thousands of years inside old red giants. The rapid version (the <b>r-process</b>) happens in seconds, when neutron stars collide or a massive star explodes, and makes the heaviest elements of all: gold, platinum, uranium.</p>
        <p class="muted">Game rule: the crowded tray and the key bar are a picture of a nucleus squeezing in one more piece, not a model of neutron capture. ${el.name}'s most common isotope has ${el.commonA} nucleons.</p>`;
    },
  },
  {
    id: 'packing', name: 'Packing', tier: 'facet',
    blurb: 'Drag the pieces into the outline until it is filled exactly; tap a piece to turn it.',
    role: 'Opens an element\'s isotope vault; later isotopes rotate Packing, Merge and Sliding Block.',
    zRange: [1, 118],
    make: (z, deal, reduced) => new PackingView(newPacking(z, dealSeed('packing', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Packing: the science</h2>
        <p>Same element, different weights: an <b>isotope</b> is ${el.name} with a different number of neutrons. ${el.name} has ${el.isotopes.length} known isotopes, ${el.isotopes.filter((i) => i.stable).length} of them stable. Too many or too few neutrons and the nucleus is unstable, so the stable ones sit in a narrow <b>valley</b> on the chart of nuclides.</p>
        <p>Nucleons do pack: the nucleus is a dense liquid-like drop, and its radius grows with the cube root of the mass number, which is why a heavy nucleus is only a few times wider than a light one.</p>
        <p class="muted">Game rule: the pieces are a game of fitting shapes, not the real arrangement of nucleons, which have no fixed positions at all.</p>`;
    },
  },
  {
    id: 'lines', name: 'Field Lines', tier: 'facet',
    blurb: 'Draw one line from the circle to the tail: cover every dot and keep each colour in its own pocket.',
    role: 'Discovers each new orbital shape (19) and a chapter per particle (17).',
    zRange: [1, 118],
    make: (z, deal, reduced) => new LinesView(newLines(z, dealSeed('lines', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Field Lines: the science</h2>
        <p>An electron in an atom is a standing wave, and a standing wave has <b>nodes</b>: surfaces where it is exactly zero. The nodes divide space into lobes, and the sign of the wave flips from one lobe to the next. That is what gives the p orbital its two lobes, the d orbital its four, and so on. ${el.name}'s outermost electrons sit in ${el.subshells[el.subshells.length - 1].key} orbitals.</p>
        <p>The number of nodes is fixed by the quantum numbers: an orbital with principal number n has n − 1 of them in total, split between spherical shells and planes or cones through the nucleus.</p>
        <p class="muted">Game rule: the line that sorts colours into pockets is a playful stand-in for a nodal surface; the colours are the sub-shell palette, not real field lines.</p>`;
    },
  },
  {
    id: 'slideStop', name: 'Slide Until Stop', tier: 'gate',
    blurb: 'Swipe to skate: the droplet slides until it hits a rock. Stop on the red ring.',
    role: 'Opens each new period of the table.',
    zRange: [1, 118],
    make: (z, deal, reduced) => new SlideStopView(newSlideStop(z, dealSeed('slideStop', z, deal)), reduced),
    science: () => `<h2>Slide Until Stop: the science</h2>
      <p>A thing in motion keeps moving until a force acts on it: Newton's first law. On the ice board the rocks are the only forces, so the droplet slides until one stops it.</p>
      <p>Electrons in a metal behave a little like this. They move freely through the lattice and are scattered only by defects and vibrations; the colder and purer the metal, the further they travel between collisions, which is why resistance falls with temperature.</p>
      <p class="muted">Game rule: the maze is a maze. Real electrons do not skate from rock to rock.</p>`,
  },
  {
    id: 'light', name: 'Light Routing', tier: 'gate',
    blurb: 'Tap the mirrors to flip them until the beam lights every ring.',
    role: 'Opens each new lens (arrangement) of the gallery.',
    zRange: [1, 118],
    make: (z, deal, reduced) => new LightView(newLight(z, dealSeed('light', z, deal)), reduced),
    science: () => `<h2>Light Routing: the science</h2>
      <p>Light reflects from a mirror at the angle it arrived, and its path runs the same backwards: ray optics. Everything we know about atoms began with light: the sharp coloured lines in an element's spectrum are photons released as electrons drop between energy levels, and each element has its own set.</p>
      <p>A spectrometer is exactly this puzzle made serious: slits, mirrors and a prism or grating steering light onto a detector.</p>
      <p class="muted">Game rule: no atom contains mirrors.</p>`,
  },
  {
    id: 'rutherford', name: 'Rutherford Probe', tier: 'gate',
    blurb: 'Fire probes into the box and deduce the hidden nucleus from how they come out.',
    role: 'Played once; opens the nucleus view.',
    zRange: [1, 118],
    make: (z, deal, reduced) => new RutherfordView(newRutherford(z, dealSeed('rutherford', z, deal)), reduced),
    science: () => `<h2>Rutherford Probe: the science</h2>
      <p>In 1909 Hans Geiger and Ernest Marsden fired alpha particles at a sheet of gold foil. Nearly all passed straight through, but about one in eight thousand bounced back, which Rutherford said was as surprising as a shell rebounding off tissue paper. The only explanation: almost all of the atom's mass and all its positive charge sit in a <b>nucleus</b> tens of thousands of times smaller than the atom.</p>
      <p class="muted">Game rule: real scattering is by the electric force at every angle; the straight tracks and right-angle turns are the Black Box game's rules. The method, deducing the unseen from how probes scatter, is Rutherford's.</p>`,
  },
  {
    id: 'codebreaker', name: 'Codebreaker', tier: 'gate',
    blurb: 'Guess the sealed sequence of four; each guess earns clues about what was right.',
    role: 'Guards the 15 synthetic elements.',
    zRange: [104, 118],
    make: (z, deal, reduced) => new CodebreakerView(newCodebreaker(z, dealSeed('codebreaker', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Codebreaker: the science</h2>
        <p>${el.name} does not occur in nature. Elements past uranium are made a few atoms at a time by firing one nucleus at another in an accelerator, and nobody ever sees them: they are identified by <b>inference</b>, from the chain of decays their detectors record, each alpha particle narrowing down which nuclide it must have been.</p>
        <p>Claiming a new element means convincing a joint committee of chemists and physicists that the decay chain could only be that nuclide. ${el.name} was ${el.discoveryYear ? `first made in ${el.discoveryYear}` : 'accepted after years of such arguments'}.</p>
        <p class="muted">Game rule: the clue dots stand in for detector signatures; the secret is a code, not a nucleus.</p>`;
    },
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
