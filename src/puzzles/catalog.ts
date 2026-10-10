// Every puzzle type in the game, in one list, so the Puzzles home can show where each one sits
// and the game can ask for a board by id. Every game has one job: Tokamak builds every nucleus
// and Quanta every atom's electrons; Tessera, Chroma, Flux, Nova, Inertia and Aurum build
// isotopes; Glyph opens the display unlocks; Lumen waits in reserve for its redesign.

import { elementAt as element } from '../gallery/data';
import { ICON_NAMES, icon } from '../ui/icons';
import type { IconName } from '../ui/icons.gen';
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

/** The icon file each puzzle type is drawn with (src/icons/puzzle-*.svg). */
const ICON_SLUG: Record<string, string> = {
  merge: 'merge', orbitalGrid: 'orbital-grid', sliding: 'sliding', packing: 'packing', lines: 'field-lines',
  slideStop: 'slide-stop', light: 'light', rutherford: 'rutherford', codebreaker: 'codebreaker', colorCharge: 'color-charge',
};

/** A puzzle type's icon, or the generic puzzles icon until its own is drawn. */
export function puzzleIcon(id: string, size = 24): string {
  const name = `puzzle-${ICON_SLUG[id] ?? id}`;
  return icon((ICON_NAMES as string[]).includes(name) ? (name as IconName) : 'puzzles', { size });
}

export type Tier = 'every' | 'facet' | 'gate' | 'reserve';

/** What each tier means, for the Puzzles home. */
export const TIER_NOTE: Record<Tier, string> = {
  every: 'Played for every atom you build: its nucleus and its electrons.',
  facet: 'Build isotopes. Each lasting isotope has its own puzzle; for a fleeting one you pick.',
  gate: 'Open new ways to see the collection: gallery lenses, looks, the nucleus view and orbital shapes.',
  reserve: 'Built to try out; no place in the game yet.',
};

export const TIER_LABEL: Record<Tier, string> = {
  every: 'Every atom',
  facet: 'Isotopes',
  gate: 'Display unlocks',
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
  /** Present once the puzzle is built; planned types have none. Deal number n of element z. */
  make?: (z: number, deal: number, reducedMotion: boolean) => PuzzleView;
  /** The board for element z from a given seed; `a` is the mass number, for puzzles that build a
   *  particular isotope's nucleus (Tokamak). */
  deal?: (z: number, seed: number, reducedMotion: boolean, a?: number) => PuzzleView;
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
    id: 'merge', name: 'Tokamak', tier: 'every',
    use: 'Nucleus · every atom',
    get rules() { return rulesOf(MergeV); },
    blurb: 'Swipe to slide the board; two clusters of the same size merge. Gather the clusters the nucleus wants.',
    role: 'Builds the nucleus of every element, and is one of the puzzles a fleeting isotope can be built with.',
    live: 'Build mode: every nucleus from helium to oganesson; any fleeting isotope, by choice.',
    instructions: MERGE_HOW,
    zRange: [2, 118],
    deal: (z, seed, reduced, a) => new MergeView(newMerge({ z, a: a ?? element(z).commonA }, seed), reduced),
    science: (z) => {
      const el = element(z);
      const parts = [];
      for (let b = 256; b >= 1; b >>= 1) if (el.commonA & b) parts.push(b);
      return `<h2>Tokamak: the science</h2>
        <p>A nucleus is protons and neutrons, its <b>nucleons</b>, held together by the strong force. ${sup(String(el.commonA))}${el.symbol}, ${el.name}'s most common isotope, has ${el.commonA} of them: ${z} protons and ${el.commonA - z} neutrons.</p>
        <p>Stars build the elements up to iron by <b>fusion</b>: light nuclei slam together and stick, releasing energy. Hydrogen fuses to helium in the Sun; three heliums make carbon in red giants.</p>
        ${z > 26 ? `<p>Past iron, fusion costs more energy than it gives, so ${el.name} was never made this way. Heavy nuclei are built by <b>neutron capture</b>: slowly inside old giant stars, or in seconds when neutron stars collide, with some of the captured neutrons turning into protons. Here the board is just a game, dealing bigger clusters so a heavy nucleus takes about as long as iron's.</p>` : ''}
        <p class="muted">Game rule: the board counts nucleons in clusters that double when two of a size meet, and ${el.commonA} written that way is ${parts.join(' + ')}. Real nuclei are not assembled by pairing clusters, and nothing slides about inside a star.</p>`;
    },
  },
  {
    id: 'orbitalGrid', name: 'Quanta', tier: 'every',
    use: 'Electrons · every atom',
    get rules() { return rulesOf(GridV); },
    blurb: 'Fill the grid so every row, column and outlined block holds each orbital once. Drag symbols from the stacks under the grid.',
    role: 'Settles the electrons of every element, standing in for Shell Rings until a better electron puzzle is found.',
    live: 'Build mode: the electrons of every element.',
    instructions: GRID_HOW,
    zRange: [1, 118],
    deal: (z, seed, reduced) => new OrbitalGridView(newOrbitalGrid(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Quanta: the science</h2>
        <p>Electrons in an atom sit in <b>orbitals</b>, grouped into sub-shells named <span style="color:${SUBSHELL_COLORS.s}">s</span>, <span style="color:${SUBSHELL_COLORS.p}">p</span>, <span style="color:${SUBSHELL_COLORS.d}">d</span> and <span style="color:${SUBSHELL_COLORS.f}">f</span>. Each orbital holds at most two electrons, and those two must spin opposite ways, up and down: the <b>Pauli exclusion principle</b>, which says no two electrons in an atom may share every quantum number.</p>
        <p>That rule of "never the same twice" is what this grid plays with. Fill ${el.name}'s orbitals lowest energy first and you get ${groundConfiguration(z)}.</p>
        <p class="muted">Game rule: the grid is a logic puzzle using orbital labels as symbols. The cells are not places in the atom, and real orbitals are not arranged in rows.</p>`;
    },
  },
  {
    id: 'sliding', name: 'Nova', tier: 'facet',
    use: 'Isotopes',
    get rules() { return rulesOf(SlidingV); },
    blurb: 'Slide the bars and blocks out of the way so the red key bar can slide out.',
    role: 'Builds isotopes, leaning toward the heavy atoms, where its deepest boards are.',
    live: 'Build mode: 41 lasting isotopes, and any fleeting isotope by choice.',
    instructions: SLIDING_HOW,
    zRange: [27, 118],
    deal: (z, seed, reduced) => new SlidingView(newSliding(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Nova: the science</h2>
        <p>Fusion stops paying at iron: its nucleus is the most tightly bound of all, so sticking more nuclei to it costs energy instead of releasing it. The elements past iron, ${el.name} among them, are made another way: a nucleus <b>captures neutrons</b> one at a time, and some of those neutrons turn into protons by beta decay, nudging it up the table.</p>
        <p>The slow version (the <b>s-process</b>) happens over thousands of years inside old red giants. The rapid version (the <b>r-process</b>) happens in seconds, when neutron stars collide or a massive star explodes, and makes the heaviest elements of all: gold, platinum, uranium.</p>
        <p>Each captured neutron makes a heavier <b>isotope</b> of the same element, until one decays and the nucleus moves up a place.</p>
        <p class="muted">Game rule: the crowded tray and the key bar are a picture of a nucleus squeezing in one more piece, not a model of neutron capture. ${el.name}'s most common isotope has ${el.commonA} nucleons.</p>`;
    },
  },
  {
    id: 'packing', name: 'Tessera', tier: 'facet',
    use: 'Isotopes',
    get rules() { return rulesOf(PackingV); },
    blurb: 'Drag the pieces into the outline until it is filled exactly; tap a piece to turn it.',
    role: 'Builds isotopes, leaning toward the lighter atoms.',
    live: 'Build mode: 72 lasting isotopes, and any fleeting isotope by choice.',
    instructions: PACKING_HOW,
    zRange: [1, 118],
    deal: (z, seed, reduced) => new PackingView(newPacking(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Tessera: the science</h2>
        <p>Same element, different weights: an <b>isotope</b> is ${el.name} with a different number of neutrons. ${el.name} has ${el.isotopes.length} known isotopes, ${el.isotopes.filter((i) => i.stable).length} of them stable. Too many or too few neutrons and the nucleus is unstable, so the stable ones sit in a narrow <b>valley</b> on the chart of nuclides.</p>
        <p>Nucleons do pack: the nucleus is a dense liquid-like drop, and its radius grows with the cube root of the mass number, which is why a heavy nucleus is only a few times wider than a light one.</p>
        <p class="muted">Game rule: the pieces are a game of fitting shapes, not the real arrangement of nucleons, which have no fixed positions at all.</p>`;
    },
  },
  {
    id: 'lines', name: 'Flux', tier: 'facet',
    use: 'Isotopes',
    get rules() { return rulesOf(LinesV); },
    blurb: 'Draw one line from a + charge to a − charge that keeps every mark on the board happy.',
    role: 'Builds isotopes, leaning toward the heavy atoms; planned for a chapter per particle (17).',
    live: 'Build mode: 41 lasting isotopes, and any fleeting isotope by choice.',
    instructions: LINES_HOW,
    zRange: [1, 118],
    deal: (z, seed, reduced) => new LinesView(newLines(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Flux: the science</h2>
        <p>An electron in an atom is a standing wave, and a standing wave has <b>nodes</b>: surfaces where it is exactly zero. The nodes divide space into lobes, and the sign of the wave flips from one lobe to the next. That is what gives the p orbital its two lobes, the d orbital its four, and so on. ${el.name}'s outermost electrons sit in ${el.subshells[el.subshells.length - 1].key} orbitals.</p>
        <p>The number of nodes is fixed by the quantum numbers: an orbital with principal number n has n − 1 of them in total, split between spherical shells and planes or cones through the nucleus.</p>
        <p class="muted">Game rule: the line that sorts colors into pockets is a playful stand-in for a nodal surface; the colors are the sub-shell palette, not real field lines.</p>`;
    },
  },
  {
    id: 'slideStop', name: 'Inertia', tier: 'facet',
    use: 'Isotopes',
    get rules() { return rulesOf(SlideStopV); },
    blurb: 'Swipe and the electron slides until something stops it. Absorb every photon, then stop on the red ring.',
    role: 'Builds isotopes. (Rows of the table now open by progress instead.)',
    live: 'Build mode: 38 lasting isotopes, and any fleeting isotope by choice.',
    instructions: SLIDESTOP_HOW,
    zRange: [1, 118],
    deal: (z, seed, reduced) => new SlideStopView(newSlideStop(z, seed), reduced),
    science: () => `<h2>Inertia: the science</h2>
      <p>A thing in motion keeps moving until a force acts on it: Newton's first law. On the lattice the nuclei are the only obstacles, so the electron slides until one stops it.</p>
      <p>Electrons in a metal behave a little like this. They move freely through the lattice and are scattered only by defects and vibrations; the colder and purer the metal, the further they travel between collisions, which is why resistance falls with temperature.</p>
      <p class="muted">Game rule: the maze is a maze. Real electrons do not skate from nucleus to nucleus.</p>`,
  },
  {
    id: 'light', name: 'Lumen', tier: 'reserve',
    use: 'Being redesigned',
    get rules() { return rulesOf(LightV); },
    blurb: 'Flip the mirrors and splitters until light reaches every ring and none touches a dark sensor.',
    role: 'Being redesigned around placing the optics yourself; it joins the isotope puzzles once ready.',
    instructions: LIGHT_HOW,
    zRange: [1, 118],
    deal: (z, seed, reduced) => new LightView(newLight(z, seed), reduced),
    science: () => `<h2>Lumen: the science</h2>
      <p>Light reflects from a mirror at the angle it arrived, and its path runs the same backwards: ray optics. Everything we know about atoms began with light: the sharp colored lines in an element's spectrum are photons released as electrons drop between energy levels, and each element has its own set.</p>
      <p>A spectrometer is exactly this puzzle made serious: slits, mirrors and a prism or grating steering light onto a detector.</p>
      <p>A colored filter works by absorption: it passes its own color and swallows the rest, which is why light already tinted one color cannot get through a filter of another.</p>
      <p class="muted">Game rule: no atom contains mirrors.</p>`,
  },
  {
    id: 'rutherford', name: 'Aurum', tier: 'facet',
    use: 'Isotopes',
    get rules() { return rulesOf(RutherfordV); },
    blurb: 'Probe the foil cell by cell and fire a few alpha beams from the rim; counts and beam tracks reveal where every nucleus sits. Find them all without a direct hit.',
    role: 'Builds isotopes, leaning toward the lighter atoms.',
    live: 'Build mode: 30 lasting isotopes, and any fleeting isotope by choice.',
    instructions: RUTHERFORD_HOW,
    zRange: [1, 118],
    deal: (z, seed, reduced) => new RutherfordView(newRutherford(z, seed), reduced),
    science: () => `<h2>Aurum: the science</h2>
      <p>In 1909 Hans Geiger and Ernest Marsden fired alpha particles at a sheet of gold foil. Nearly all passed straight through, but about one in eight thousand bounced back, which Rutherford said was as surprising as a shell rebounding off tissue paper. The only explanation: almost all of the atom's mass and all its positive charge sit in a <b>nucleus</b> tens of thousands of times smaller than the atom.</p>
      <p>The lesson was that an atom is almost entirely empty: probe it at random and you nearly always pass straight through.</p>
      <p class="muted">Game rule: the counts on the plate are a deduction game, not a measurement. Real scattering happens by the electric force at every angle, and a gold atom has one nucleus, not many. Here a beam only stops on a head-on hit; real alpha particles are pushed aside at every angle, and only a rare few come straight back. The method, inferring what you cannot see from what your probes report, is Rutherford's.</p>`,
  },
  {
    id: 'codebreaker', name: 'Glyph', tier: 'gate',
    use: 'Display unlocks · 12 in all',
    get rules() { return rulesOf(CodeV); },
    blurb: 'Guess the sealed sequence of four; each guess earns clues about what was right.',
    role: 'Played twelve times in all, never more: each solve opens a way to see the collection (two gallery lenses, six looks, the nucleus view, and the p, d and f orbital shapes).',
    live: 'Gallery: the Ribbon and Circle lenses, six looks and the nucleus view. Build mode: the p, d and f orbital shapes on boron, scandium and cerium.',
    instructions: CODE_HOW,
    zRange: [104, 118],
    deal: (z, seed, reduced) => new CodebreakerView(newCodebreaker(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Glyph: the science</h2>
        <p>${el.name} does not occur in nature. Elements past uranium are made a few atoms at a time by firing one nucleus at another in an accelerator, and nobody ever sees them: they are identified by <b>inference</b>, from the chain of decays their detectors record, each alpha particle narrowing down which nuclide it must have been.</p>
        <p>Claiming a new element means convincing a joint committee of chemists and physicists that the decay chain could only be that nuclide. ${el.name} was ${el.discoveryYear ? `first made in ${el.discoveryYear}` : 'accepted after years of such arguments'}.</p>
        <p class="muted">Game rule: the clue dots stand in for detector signatures; the secret is a code, not a nucleus.</p>`;
    },
  },
  {
    id: 'colorCharge', name: 'Chroma', tier: 'facet',
    use: 'Isotopes',
    get rules() { return rulesOf(ChargeV); },
    blurb: 'Bind the quarks into color-neutral groups until the grid is clear; on heavier elements a gluon can swap two colors.',
    role: 'Builds isotopes, leaning toward the lighter atoms; planned for the quark and gluon chapters of the particles too.',
    live: 'Build mode: 72 lasting isotopes, and any fleeting isotope by choice.',
    instructions: CHARGE_HOW,
    zRange: [1, 118],
    deal: (z, seed, reduced) => new ColorChargeView(newColorCharge(z, seed), reduced),
    science: () => `<h2>Chroma: the science</h2>
      <p>Protons and neutrons are each made of three <b>quarks</b>, held by the strong force. Quarks carry a kind of charge physicists call <b>color</b>, with three values nicknamed red, green and blue. A quark is never found alone: quarks only exist in groups whose colors cancel to "white".</p>
      <p>There are two ways to cancel. Three quarks, one of each color, make a <b>baryon</b> such as the proton. A quark and an antiquark carrying the matching anticolor make a <b>meson</b>, such as the pion. Three antiquarks make an <b>antibaryon</b>, such as the antiproton.</p>
      <p><b>Gluons</b> carry the strong force and carry color themselves, so exchanging one changes the colors of both quarks; in the game that is the swap.</p>
      <p class="muted">Game rule: color charge has nothing to do with real color, and quarks do not sit on a grid; the shapes on the board are only for play.</p>`,
  },
];

for (const p of PUZZLES) if (p.deal) p.make = (z, n, reduced) => p.deal!(z, dealSeed(p.id, z, n), reduced);

export function puzzleType(id: string): PuzzleType {
  return PUZZLES.find((p) => p.id === id)!;
}
