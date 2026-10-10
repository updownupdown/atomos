// Every puzzle type the game will have, in one list: the two that are built,
// and the rest from the locked progression map, so the playground can show
// where each one sits and the game can ask for a level by id.

import { elementAt as element } from '../gallery/data';
import { applyPlacement, configuration, newAtom, resolvePlacement } from '../core/physics';
import { newMerge } from './merge';
import { MergeView, sup, INSTRUCTIONS as MERGE_HOW } from './mergeView';
import { newSliding } from './sliding';
import { SlidingView, INSTRUCTIONS as SLIDING_HOW } from './slidingView';
import { newPacking } from './packing';
import { PackingView, INSTRUCTIONS as PACKING_HOW } from './packingView';
import { newLines } from './lines';
import { LinesView, INSTRUCTIONS as LINES_HOW } from './linesView';
import { newSlideStop } from './slideStop';
import { SlideStopView, INSTRUCTIONS as SLIDESTOP_HOW } from './slideStopView';
import { newLight } from './light';
import { LightView, INSTRUCTIONS as LIGHT_HOW } from './lightView';
import { newCodebreaker } from './codebreaker';
import { CodebreakerView, INSTRUCTIONS as CODE_HOW } from './codebreakerView';
import { newRutherford } from './rutherford';
import { RutherfordView, INSTRUCTIONS as RUTHERFORD_HOW } from './rutherfordView';
import { newOrbitalGrid } from './orbitalGrid';
import { OrbitalGridView, INSTRUCTIONS as GRID_HOW } from './orbitalGridView';
import { newColorCharge } from './colorCharge';
import { ColorChargeView, INSTRUCTIONS as CHARGE_HOW } from './colorChargeView';
import * as MergeV from './mergeView';
import * as SlidingV from './slidingView';
import * as PackingV from './packingView';
import * as LinesV from './linesView';
import * as SlideStopV from './slideStopView';
import * as LightV from './lightView';
import * as CodeV from './codebreakerView';
import * as RutherfordV from './rutherfordView';
import * as GridV from './orbitalGridView';
import * as ChargeV from './colorChargeView';
import { SUBSHELL_COLORS, type PuzzleView, type RuleCard } from './view';

/** A view module's rule cards, once it exports them. */
const rulesOf = (m: object): RuleCard[] | undefined => (m as { RULES?: RuleCard[] }).RULES;

export type Tier = 'every' | 'facet' | 'gate' | 'reserve';

/** What each tier means, for the Puzzles home. */
export const TIER_NOTE: Record<Tier, string> = {
  every: 'Played for every atom you build.',
  facet: 'Unlock extra layers of an atom: isotopes, orbital shapes, particles.',
  gate: 'Open new parts of the game: periods, gallery lenses, the synthetic elements.',
  reserve: 'Built to try out; no place in the game yet.',
};

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
  /** Where the game actually uses it today; absent while it lives only in the playground. Keep this true to the code. */
  live?: string;
  /** What it is for, in two or three words, for the puzzle header. */
  use: string;
  /** One card per rule and symbol, with a small animated example, for the Instructions modal. */
  rules?: RuleCard[];
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
    use: 'Nucleus · He to Fe',
    get rules() { return rulesOf(MergeV); },
    blurb: 'Swipe to slide the board; two clusters of the same size merge. Gather the clusters the nucleus wants.',
    role: 'Builds the nucleus of every element up to iron.',
    live: 'Build mode: every nucleus from helium to iron.',
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
    id: 'orbitalGrid', name: 'Orbital Grid', tier: 'every',
    use: 'Electrons · every atom',
    get rules() { return rulesOf(GridV); },
    blurb: 'Fill the grid so every row, column and outlined block holds each orbital once.',
    role: 'Settles the electrons of every element, standing in for Shell Rings until a better electron puzzle is found.',
    live: 'Build mode: the electrons of every element.',
    instructions: GRID_HOW,
    zRange: [1, 118],
    make: (z, deal, reduced) => new OrbitalGridView(newOrbitalGrid(z, dealSeed('orbitalGrid', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Orbital Grid: the science</h2>
        <p>Electrons in an atom sit in <b>orbitals</b>, grouped into sub-shells named <span style="color:${SUBSHELL_COLORS.s}">s</span>, <span style="color:${SUBSHELL_COLORS.p}">p</span>, <span style="color:${SUBSHELL_COLORS.d}">d</span> and <span style="color:${SUBSHELL_COLORS.f}">f</span>. Each orbital holds at most two electrons, and those two must spin opposite ways, up and down: the <b>Pauli exclusion principle</b>, which says no two electrons in an atom may share every quantum number.</p>
        <p>That rule of "never the same twice" is what this grid plays with. Fill ${el.name}'s orbitals lowest energy first and you get ${groundConfiguration(z)}.</p>
        <p class="muted">Game rule: the grid is a logic puzzle using orbital labels as symbols. The cells are not places in the atom, and real orbitals are not arranged in rows.</p>`;
    },
  },
  {
    id: 'sliding', name: 'Sliding Block', tier: 'every',
    use: 'Nucleus · Co onward',
    get rules() { return rulesOf(SlidingV); },
    blurb: 'Slide the bars and blocks out of the way so the red key bar can slide out.',
    role: 'Builds the nucleus of every element past iron, where fusion stops paying.',
    live: 'Build mode: every nucleus from cobalt on.',
    instructions: SLIDING_HOW,
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
    use: 'Isotope vaults',
    get rules() { return rulesOf(PackingV); },
    blurb: 'Drag the pieces into the outline until it is filled exactly; tap a piece to turn it.',
    role: 'Opens an element\'s isotope vault; later isotopes rotate Packing, Merge and Sliding Block.',
    instructions: PACKING_HOW,
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
    use: 'Orbital shapes',
    get rules() { return rulesOf(LinesV); },
    blurb: 'Draw one line from a start to an end that keeps every mark on the board happy.',
    role: 'Discovers each new orbital shape (19) and a chapter per particle (17).',
    instructions: LINES_HOW,
    zRange: [1, 118],
    make: (z, deal, reduced) => new LinesView(newLines(z, dealSeed('lines', z, deal)), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Field Lines: the science</h2>
        <p>An electron in an atom is a standing wave, and a standing wave has <b>nodes</b>: surfaces where it is exactly zero. The nodes divide space into lobes, and the sign of the wave flips from one lobe to the next. That is what gives the p orbital its two lobes, the d orbital its four, and so on. ${el.name}'s outermost electrons sit in ${el.subshells[el.subshells.length - 1].key} orbitals.</p>
        <p>The number of nodes is fixed by the quantum numbers: an orbital with principal number n has n − 1 of them in total, split between spherical shells and planes or cones through the nucleus.</p>
        <p class="muted">Game rule: the line that sorts colors into pockets is a playful stand-in for a nodal surface; the colors are the sub-shell palette, not real field lines.</p>`;
    },
  },
  {
    id: 'slideStop', name: 'Slide Until Stop', tier: 'gate',
    use: 'Period gates',
    get rules() { return rulesOf(SlideStopV); },
    blurb: 'Swipe to skate: the droplet slides until something stops it. Collect every spark, then stop on the red ring.',
    role: 'Opens each new period of the table.',
    instructions: SLIDESTOP_HOW,
    zRange: [1, 118],
    make: (z, deal, reduced) => new SlideStopView(newSlideStop(z, dealSeed('slideStop', z, deal)), reduced),
    science: () => `<h2>Slide Until Stop: the science</h2>
      <p>A thing in motion keeps moving until a force acts on it: Newton's first law. On the ice board the rocks are the only forces, so the droplet slides until one stops it.</p>
      <p>Electrons in a metal behave a little like this. They move freely through the lattice and are scattered only by defects and vibrations; the colder and purer the metal, the further they travel between collisions, which is why resistance falls with temperature.</p>
      <p class="muted">Game rule: the maze is a maze. Real electrons do not skate from rock to rock.</p>`,
  },
  {
    id: 'light', name: 'Light Routing', tier: 'gate',
    use: 'Gallery lenses',
    get rules() { return rulesOf(LightV); },
    blurb: 'Flip the mirrors and splitters until light reaches every ring and none touches a dark sensor.',
    role: 'Opens each new lens (arrangement) of the gallery.',
    instructions: LIGHT_HOW,
    zRange: [1, 118],
    make: (z, deal, reduced) => new LightView(newLight(z, dealSeed('light', z, deal)), reduced),
    science: () => `<h2>Light Routing: the science</h2>
      <p>Light reflects from a mirror at the angle it arrived, and its path runs the same backwards: ray optics. Everything we know about atoms began with light: the sharp colored lines in an element's spectrum are photons released as electrons drop between energy levels, and each element has its own set.</p>
      <p>A spectrometer is exactly this puzzle made serious: slits, mirrors and a prism or grating steering light onto a detector.</p>
      <p>A colored filter works by absorption: it passes its own color and swallows the rest, which is why light already tinted one color cannot get through a filter of another.</p>
      <p class="muted">Game rule: no atom contains mirrors.</p>`,
  },
  {
    id: 'rutherford', name: 'Rutherford Probe', tier: 'gate',
    use: 'Nucleus view',
    get rules() { return rulesOf(RutherfordV); },
    blurb: 'Probe the plate cell by cell; each count says how many nuclei sit around it. Find them all without a direct hit.',
    role: 'Played once; opens the nucleus view.',
    instructions: RUTHERFORD_HOW,
    zRange: [1, 118],
    make: (z, deal, reduced) => new RutherfordView(newRutherford(z, dealSeed('rutherford', z, deal)), reduced),
    science: () => `<h2>Rutherford Probe: the science</h2>
      <p>In 1909 Hans Geiger and Ernest Marsden fired alpha particles at a sheet of gold foil. Nearly all passed straight through, but about one in eight thousand bounced back, which Rutherford said was as surprising as a shell rebounding off tissue paper. The only explanation: almost all of the atom's mass and all its positive charge sit in a <b>nucleus</b> tens of thousands of times smaller than the atom.</p>
      <p>The lesson was that an atom is almost entirely empty: probe it at random and you nearly always pass straight through.</p>
      <p class="muted">Game rule: the counts on the plate are a deduction game, not a measurement. Real scattering happens by the electric force at every angle, and a gold atom has one nucleus, not many. The method, inferring what you cannot see from what your probes report, is Rutherford's.</p>`,
  },
  {
    id: 'codebreaker', name: 'Codebreaker', tier: 'gate',
    use: 'Synthetic elements',
    get rules() { return rulesOf(CodeV); },
    blurb: 'Guess the sealed sequence of four; each guess earns clues about what was right.',
    role: 'Guards the 15 synthetic elements.',
    instructions: CODE_HOW,
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
    id: 'colorCharge', name: 'Color Charge', tier: 'reserve',
    use: 'Reserve',
    get rules() { return rulesOf(ChargeV); },
    blurb: 'Bind the quarks into color-neutral groups until the grid is clear.',
    role: 'In reserve for the quark chapter of the particles, if it earns a place.',
    instructions: CHARGE_HOW,
    zRange: [1, 118],
    make: (z, deal, reduced) => new ColorChargeView(newColorCharge(z, dealSeed('colorCharge', z, deal)), reduced),
    science: () => `<h2>Color Charge: the science</h2>
      <p>Protons and neutrons are each made of three <b>quarks</b>, held by the strong force. Quarks carry a kind of charge physicists call <b>color</b>, with three values nicknamed red, green and blue. A quark is never found alone: quarks only exist in groups whose colors cancel to "white".</p>
      <p>There are two ways to cancel. Three quarks, one of each color, make a <b>baryon</b> such as the proton. A quark and an antiquark carrying the matching anticolor make a <b>meson</b>, such as the pion.</p>
      <p class="muted">Game rule: color charge has nothing to do with real color, and quarks do not sit on a grid; the shapes on the board are only for play.</p>`,
  },
];

export function puzzleType(id: string): PuzzleType {
  return PUZZLES.find((p) => p.id === id)!;
}
