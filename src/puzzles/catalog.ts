// Every puzzle type in the game, in one list, so the Puzzles home can show where each one sits
// and the game can ask for a board by id. An atom's nucleus and electrons are each built by one
// puzzle from a pool, fixed per atom in src/data/atom-games.json (src/core/assign.ts): the
// nucleus from Tokamak, Inertia, Tessera and Nova, the electrons from Quanta, Flux, Chroma and
// Aurum. Tessera, Chroma, Flux, Nova, Inertia and Aurum also build lasting isotopes, and Lumen
// fleeting ones; Glyph opens the display unlocks. Reserve games are played from the Puzzles
// screen only, until they earn a place.

import { elementAt as element } from '../gallery/data';
import { ICON_NAMES, icon } from '../ui/icons';
import type { IconName } from '../ui/icons.gen';
import { applyPlacement, configuration, newAtom, resolvePlacement } from '../core/physics';
import { newCapture, newMerge } from './merge';
import { MergeView, sup, INSTRUCTIONS as MERGE_HOW, CAPTURE_INSTRUCTIONS as CAPTURE_HOW } from './mergeView';
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
import { newBond } from './bond';
import { BondView, INSTRUCTIONS as BOND_HOW } from './bondView';
import * as BondV from './bondView';
import { newSpin } from './spin';
import { SpinView, INSTRUCTIONS as SPIN_HOW } from './spinView';
import * as SpinV from './spinView';
import { newFission } from './fission';
import { FissionView, INSTRUCTIONS as FISSION_HOW } from './fissionView';
import * as FissionV from './fissionView';
import { atomGame } from '../core/atomGames';
import { dialFor, elementForDial, difficulty, nativeSpan, zForDial } from './difficulty';
import { newPlanar } from './planar';
import { PlanarView, INSTRUCTIONS as PLANAR_HOW } from './planarView';
import * as PlanarV from './planarView';
import { newCircuit } from './circuit';
import { CircuitView, INSTRUCTIONS as CIRCUIT_HOW } from './circuitView';
import * as CircuitV from './circuitView';
import { newValence } from './valence';
import { ValenceView, INSTRUCTIONS as VALENCE_HOW } from './valenceView';
import * as ValenceV from './valenceView';
import { newEmit } from './emit';
import { EmitView, INSTRUCTIONS as EMIT_HOW } from './emitView';
import * as EmitV from './emitView';
import { newSort } from './sort';
import { SortView, INSTRUCTIONS as SORT_HOW } from './sortView';
import * as SortV from './sortView';
import { newFlood } from './flood';
import { FloodView, INSTRUCTIONS as FLOOD_HOW } from './floodView';
import * as FloodV from './floodView';
import { newDipole } from './dipole';
import { DipoleView, INSTRUCTIONS as DIPOLE_HOW } from './dipoleView';
import * as DipoleV from './dipoleView';
import { newTrace } from './trace';
import { TraceView, INSTRUCTIONS as TRACE_HOW } from './traceView';
import * as TraceV from './traceView';
import { newShells } from './shells';
import { ShellsView, INSTRUCTIONS as SHELLS_HOW } from './shellsView';
import * as ShellsV from './shellsView';
import { newDrop } from './drop';
import { DropView, INSTRUCTIONS as DROP_HOW } from './dropView';
import * as DropV from './dropView';
import { newPush } from './push';
import { PushView, INSTRUCTIONS as PUSH_HOW } from './pushView';
import * as PushV from './pushView';
import { newCollide } from './collide';
import { CollideView, INSTRUCTIONS as COLLIDE_HOW } from './collideView';
import * as CollideV from './collideView';
import { newAnnihil } from './annihil';
import { AnnihilView, INSTRUCTIONS as ANNIHIL_HOW } from './annihilView';
import * as AnnihilV from './annihilView';
import { newSolo } from './solo';
import { SoloView, INSTRUCTIONS as SOLO_HOW } from './soloView';
import * as SoloV from './soloView';
import { newBlocks } from './blocks';
import { BlocksView, INSTRUCTIONS as BLOCKS_HOW } from './blocksView';
import * as BlocksV from './blocksView';
import { SUBSHELL_COLORS, type PuzzleView, type RuleCard } from './view';

/** Which atom steps a game builds, from the committed table: "12 nuclei and 3 electron sets". */
function atomSteps(id: string): string {
  let nuclei = 0, shells = 0;
  for (let z = 1; z <= 118; z++) {
    if (atomGame(z, 'nucleus') === id && z > 1) nuclei++;
    if (atomGame(z, 'shells') === id) shells++;
  }
  const parts = [nuclei ? `${nuclei} ${nuclei === 1 ? 'nucleus' : 'nuclei'}` : '', shells ? `${shells} atoms' electrons` : ''].filter(Boolean);
  return parts.length ? parts.join(' and ') : 'no atom steps';
}

/** A view module's rule cards, once it exports them. */
const rulesOf = (m: object): RuleCard[] | undefined => (m as { RULES?: RuleCard[] }).RULES;

/** The icon file each puzzle type is drawn with (src/icons/puzzle-*.svg). */
const ICON_SLUG: Record<string, string> = {
  merge: 'merge', orbitalGrid: 'orbital-grid', sliding: 'sliding', packing: 'packing', lines: 'field-lines',
  slideStop: 'slide-stop', light: 'light', rutherford: 'rutherford', codebreaker: 'codebreaker', colorCharge: 'color-charge',
  bond: 'bond', spin: 'spin', fission: 'fission',
  capture: 'capture',
  planar: 'planar',
  circuit: 'circuit',
  valence: 'valence',
  emit: 'emit',
  sort: 'sort',
  flood: 'flood',
  dipole: 'dipole',
  trace: 'trace',
  shells: 'shells',
  drop: 'drop',
  push: 'push',
  collide: 'collide',
  annihil: 'annihil',
  solo: 'solo',
  blocks: 'blocks',
};

/** A puzzle type's icon, or the generic puzzles icon until its own is drawn. */
export function puzzleIcon(id: string, size = 24): string {
  const name = `puzzle-${ICON_SLUG[id] ?? id}`;
  return icon((ICON_NAMES as string[]).includes(name) ? (name as IconName) : 'puzzles', { size });
}

export type Tier = 'every' | 'facet' | 'gate' | 'reserve';

/** What each tier means, for the Puzzles home. */
export const TIER_NOTE: Record<Tier, string> = {
  every: 'The first two puzzles you meet, building nuclei and electrons; other puzzles share those steps atom by atom.',
  facet: 'Build isotopes, and share the atom steps. Each lasting isotope has its own puzzle; for a fleeting one you pick.',
  gate: 'Open new ways to see the atoms: the nucleus view and the orbital shapes.',
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
  /** One line on what winning takes, under the puzzle's name for its first plays. */
  goal: string;
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
  /** A ladder game's generator: its board for element z from a seed, harder the heavier the
   *  element (src/puzzles/difficulty.ts walks the ladder for a dial); `a` is the mass number, for
   *  puzzles that build a particular isotope's nucleus (Tokamak). */
  ladder?: (z: number, seed: number, reducedMotion: boolean, a?: number) => PuzzleView;
  /** A native game's generator: its board at dial d (1 to 100) from a seed. */
  native?: (d: number, seed: number, reducedMotion: boolean, z: number, a?: number) => PuzzleView;
  /** The dial span of a native game, when it is not the whole 1 to 100. */
  nativeSpan?: [number, number];
  /** Present once the puzzle is built; planned types have none. A board at dial d, for element z
   *  (Tokamak's nucleus; the science) and mass number a. */
  dealAt?: (d: number, seed: number, reducedMotion: boolean, z: number, a?: number) => PuzzleView;
  /** The board for atom z from a seed, at the atom's dial (atomDial, brought into the game's span). */
  deal?: (z: number, seed: number, reducedMotion: boolean, a?: number) => PuzzleView;
  /** Deal number n for atom z. */
  make?: (z: number, deal: number, reducedMotion: boolean) => PuzzleView;
  /** Deal number n at dial d, for the Puzzles screen. */
  makeAt?: (d: number, deal: number, reducedMotion: boolean) => PuzzleView;
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
    goal: 'Merge clusters into the ones the nucleus needs.',
    blurb: 'Swipe to slide the board; two clusters of the same size merge. Gather the clusters the nucleus wants.',
    role: 'Builds nuclei, sharing that step with the other hands-on puzzles, and is one of the puzzles a fleeting isotope can be built with.',
    get live() { return `Build mode: ${atomSteps('merge')}; any fleeting isotope, by choice.`; },
    instructions: MERGE_HOW,
    zRange: [2, 118],
    ladder: (z, seed, reduced, a) => new MergeView(newMerge({ z, a: a ?? element(z).commonA }, seed), reduced),
    science: (z) => {
      const el = element(z);
      const parts = [];
      for (let b = 256; b >= 1; b >>= 1) if (el.commonA & b) parts.push(b);
      return `<h2>Tokamak: the science</h2>
        <p>A nucleus is protons and neutrons, its <b>nucleons</b>, held together by the strong force. ${sup(String(el.commonA))}${el.symbol}, ${el.name}'s most common isotope, has ${el.commonA} of them: ${z} protons and ${el.commonA - z} neutrons.</p>
        <p>Stars build the elements up to iron by <b>fusion</b>: light nuclei slam together and stick, releasing energy. Hydrogen fuses to helium in the Sun; three heliums make carbon in red giants.</p>
        ${z > 26 ? `<p>Past iron, fusion costs more energy than it gives, so ${el.name} was never made this way. Heavy nuclei are built by <b>neutron capture</b>: slowly inside old giant stars, or in seconds when neutron stars collide, with some of the captured neutrons turning into protons. Here the board is just a game: the heaviest nuclei are dealt bigger clusters, and tungsten blocks from the reactor's armor get in the way.</p>` : ''}
        <p class="muted">Game rule: the board counts nucleons in clusters that double when two of a size meet, and ${el.commonA} written that way is ${parts.join(' + ')}. Real nuclei are not assembled by pairing clusters, and nothing slides about inside a star.</p>`;
    },
  },
  {
    id: 'orbitalGrid', name: 'Quanta', tier: 'every',
    use: 'Electrons · every atom',
    get rules() { return rulesOf(GridV); },
    goal: 'Fill the grid with no symbol twice in a row, column or block.',
    blurb: 'Fill the grid so every row, column and outlined block holds each orbital once. Drag symbols from the stacks under the grid.',
    role: 'Settles electrons, sharing that step with the other thinking puzzles.',
    get live() { return `Build mode: ${atomSteps('orbitalGrid')}.`; },
    instructions: GRID_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new OrbitalGridView(newOrbitalGrid(z, seed), reduced),
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
    goal: 'Clear a path so the red bar can slide out.',
    blurb: 'Slide the bars and blocks out of the way so the red key bar can slide out.',
    role: 'Builds isotopes, leaning toward the heavy atoms, where its deepest boards are.',
    get live() { return `Build mode: ${atomSteps('sliding')}; 41 lasting isotopes, and any fleeting isotope by choice.`; },
    instructions: SLIDING_HOW,
    zRange: [27, 118],
    ladder: (z, seed, reduced) => new SlidingView(newSliding(z, seed), reduced),
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
    goal: 'Fill the square around its gaps, using every piece.',
    blurb: 'Drag every piece into the square, around the studded gaps, until it is full; they fit in only one way. Tap a piece to turn it.',
    role: 'Builds isotopes, leaning toward the lighter atoms.',
    get live() { return `Build mode: ${atomSteps('packing')}; 72 lasting isotopes, and any fleeting isotope by choice.`; },
    instructions: PACKING_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new PackingView(newPacking(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Tessera: the science</h2>
        <p>Same element, different weights: an <b>isotope</b> is ${el.name} with a different number of neutrons. ${el.name} has ${el.isotopes.length} known isotopes, ${el.isotopes.filter((i) => i.stable).length} of them stable. Too many or too few neutrons and the nucleus is unstable, so the stable ones sit in a narrow <b>valley</b> on the chart of nuclides.</p>
        <p>Nucleons do pack: the nucleus is a dense liquid-like drop, and its radius grows with the cube root of the mass number, which is why a heavy nucleus is only a few times wider than a light one.</p>
        <p class="muted">Game rule: the square, its gaps and its pieces are a game of fitting shapes with a single answer, not the real arrangement of nucleons, which have no fixed positions at all.</p>`;
    },
  },
  {
    id: 'lines', name: 'Flux', tier: 'facet',
    use: 'Isotopes',
    get rules() { return rulesOf(LinesV); },
    goal: 'Draw one line from + to − that keeps every mark happy.',
    blurb: 'Draw one line from a + charge to a − charge that keeps every mark on the board happy.',
    role: 'Builds isotopes, leaning toward the heavy atoms; planned for a chapter per particle (17).',
    get live() { return `Build mode: ${atomSteps('lines')}; 41 lasting isotopes, and any fleeting isotope by choice.`; },
    instructions: LINES_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new LinesView(newLines(z, seed), reduced),
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
    goal: 'Absorb every photon, then stop on the red ring.',
    blurb: 'Swipe and the electron slides until something stops it. Absorb every photon, then stop on the red ring.',
    role: 'Builds isotopes. (Rows of the table now open by progress instead.)',
    get live() { return `Build mode: ${atomSteps('slideStop')}; 38 lasting isotopes, and any fleeting isotope by choice.`; },
    instructions: SLIDESTOP_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new SlideStopView(newSlideStop(z, seed), reduced),
    science: () => `<h2>Inertia: the science</h2>
      <p>A thing in motion keeps moving until a force acts on it: Newton's first law. On the lattice the nuclei are the only obstacles, so the electron slides until one stops it.</p>
      <p>Electrons in a metal behave a little like this. They move freely through the lattice and are scattered only by defects and vibrations; the colder and purer the metal, the further they travel between collisions, which is why resistance falls with temperature.</p>
      <p class="muted">Game rule: the maze is a maze. Real electrons do not skate from nucleus to nucleus.</p>`,
  },
  {
    id: 'light', name: 'Lumen', tier: 'facet',
    use: 'Isotopes',
    get rules() { return rulesOf(LightV); },
    goal: 'Place the tray pieces so light reaches every ring.',
    blurb: 'Set the mirrors and splitters from the tray so light reaches every ring and no dark sensor. Each board has one answer, and it uses every piece.',
    role: 'Builds fleeting isotopes, when you pick it; lasting isotopes keep their own puzzles.',
    live: 'Build mode: any fleeting isotope by choice.',
    instructions: LIGHT_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new LightView(newLight(z, seed), reduced),
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
    goal: 'Probe every empty cell; too many direct hits ruin the plate.',
    blurb: 'Probe the foil cell by cell and fire the few alpha beams the plate grants; counts and beam tracks reveal where every nucleus sits. Read them well: the plate takes only a few direct hits before it is ruined.',
    role: 'Builds isotopes, leaning toward the lighter atoms.',
    get live() { return `Build mode: ${atomSteps('rutherford')}; 30 lasting isotopes, and any fleeting isotope by choice.`; },
    instructions: RUTHERFORD_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new RutherfordView(newRutherford(z, seed), reduced),
    science: () => `<h2>Aurum: the science</h2>
      <p>In 1909 Hans Geiger and Ernest Marsden fired alpha particles at a sheet of gold foil. Nearly all passed straight through, but about one in eight thousand bounced back, which Rutherford said was as surprising as a shell rebounding off tissue paper. The only explanation: almost all of the atom's mass and all its positive charge sit in a <b>nucleus</b> tens of thousands of times smaller than the atom.</p>
      <p>The lesson was that an atom is almost entirely empty: probe it at random and you nearly always pass straight through.</p>
      <p class="muted">Game rule: the counts on the plate are a deduction game, not a measurement. Real scattering happens by the electric force at every angle, and a gold atom has one nucleus, not many. Here a beam only stops on a head-on hit; real alpha particles are pushed aside at every angle, and only a rare few come straight back. The method, inferring what you cannot see from what your probes report, is Rutherford's.</p>`,
  },
  {
    id: 'codebreaker', name: 'Glyph', tier: 'gate',
    use: 'Display unlocks · 4 in all',
    get rules() { return rulesOf(CodeV); },
    goal: 'Crack the sealed code of four.',
    blurb: 'Guess the sealed sequence of four; each guess earns clues about what was right.',
    role: 'Played twelve times in all, never more: each solve opens a way to see the collection (two map lenses, six looks, the nucleus view, and the p, d and f orbital shapes).',
    live: 'Atoms: the nucleus view. Build mode: the p, d and f orbital shapes on boron, scandium and cerium.',
    instructions: CODE_HOW,
    zRange: [104, 118],
    ladder: (z, seed, reduced) => new CodebreakerView(newCodebreaker(z, seed), reduced),
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
    goal: 'Clear the grid in color-neutral groups.',
    blurb: 'Bind the quarks into color-neutral groups until the grid is clear; on heavier elements a gluon can swap two colors.',
    role: 'Builds isotopes, leaning toward the lighter atoms; planned for the quark and gluon chapters of the particles too.',
    get live() { return `Build mode: ${atomSteps('colorCharge')}; 72 lasting isotopes, and any fleeting isotope by choice.`; },
    instructions: CHARGE_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new ColorChargeView(newColorCharge(z, seed), reduced),
    science: () => `<h2>Chroma: the science</h2>
      <p>Protons and neutrons are each made of three <b>quarks</b>, held by the strong force. Quarks carry a kind of charge physicists call <b>color</b>, with three values nicknamed red, green and blue. A quark is never found alone: quarks only exist in groups whose colors cancel to "white".</p>
      <p>There are two ways to cancel. Three quarks, one of each color, make a <b>baryon</b> such as the proton. A quark and an antiquark carrying the matching anticolor make a <b>meson</b>, such as the pion. Three antiquarks make an <b>antibaryon</b>, such as the antiproton.</p>
      <p><b>Gluons</b> carry the strong force and carry color themselves, so exchanging one changes the colors of both quarks; in the game that is the swap.</p>
      <p class="muted">Game rule: color charge has nothing to do with real color, and quarks do not sit on a grid; the shapes on the board are only for play.</p>`,
  },
  {
    id: 'bond', name: 'Tether', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(BondV); },
    goal: 'Join every pair of dots; paths never cross.',
    blurb: 'Drag a path from each dot to its partner of the same color. Paths never cross, and every cell ends up on a path.',
    role: 'A reserve game to try out: a rote, hands-on one for the nucleus pool, if it earns a place.',
    instructions: BOND_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new BondView(newBond(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Tether: the science</h2>
        <p>Atoms join by sharing electrons in pairs: a <b>covalent bond</b> is two electrons, one from each atom, held between them. ${el.name}'s outermost electrons are the ones that bond, and the pairs it can make are what its chemistry is built from.</p>
        <p>A bond is a pair, and a pair is a bond: drawing one line between two matching dots is the whole idea, made into a puzzle.</p>
        <p class="muted">Game rule: bonds do not run along paths on a grid, and nothing in a molecule fills every cell.</p>`;
    },
  },
  {
    id: 'spin', name: 'Parity', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(SpinV); },
    goal: 'Fill the grid with ups and downs, balanced and never three alike.',
    blurb: 'Tap cells to set spin up or down. Every row and column holds as many ups as downs, three alike never sit in a line, and linked cells match or differ as marked.',
    role: 'A reserve game to try out: a thinking one for the electron pool, if it earns a place.',
    instructions: SPIN_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new SpinView(newSpin(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Parity: the science</h2>
        <p>Every electron carries <b>spin</b>, a quantum property with two settings, called up and down. Two electrons can share an orbital only with opposite spins: the Pauli exclusion principle, which is why ${el.name}'s ${z} electrons fill their orbitals in pairs.</p>
        <p>Spin is also why a filled shell is magnetically quiet: its ups and downs cancel. ${el.name}'s unpaired spins, if it has any, are what make it magnetic.</p>
        <p class="muted">Game rule: the balanced rows and the "never three" rule are the puzzle's, not the atom's.</p>`;
    },
  },
  {
    id: 'fission', name: 'Cascade', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(FissionV); },
    goal: 'Split every nucleus in the fewest taps.',
    blurb: 'Tap a nucleus: its neutrons fly the way its chevrons point and split what they hit, and so on down the chain. Split every nucleus in as few taps as the board allows.',
    role: 'A reserve game to try out: a rote one with a chain reaction to watch, for the nucleus pool, if it earns a place.',
    instructions: FISSION_HOW,
    zRange: [1, 118],
    ladder: (z, seed, reduced) => new FissionView(newFission(z, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Cascade: the science</h2>
        <p>Some heavy nuclei split when a neutron hits them: <b>fission</b>. Uranium-235 breaks into two lighter nuclei and throws out two or three more neutrons, and if those hit more uranium the splitting feeds itself: a <b>chain reaction</b>. A reactor keeps it steady with moderators and control rods that slow and soak up neutrons; a bomb lets it run away.</p>
        <p>${z >= 90 ? `${el.name} is heavy enough that some of its isotopes can be split this way.` : `${el.name} is far too light to split: its nucleus is more tightly bound than its pieces would be, so breaking it costs energy instead of releasing it.`}</p>
        <p class="muted">Game rule: real neutrons fly off in every direction, not along chevrons, and a chain needs enough fuel packed closely, not a well-aimed tap.</p>`;
    },
  },
  {
    id: 'capture', name: 'Kiln', tier: 'reserve',
    use: 'Practice',
    get rules() { return MergeV.CAPTURE_RULES; },
    goal: 'Kiln mode: build one cluster of exactly the mass number.',
    blurb: 'Tokamak in capture mode: equal clusters double, and a cluster of 8 or more captures any lone neutron it meets, growing by one. Build one cluster of exactly the mass number.',
    role: "A reserve game to try out: Tokamak's capture mode for the nuclei past iron, if it earns a place.",
    instructions: CAPTURE_HOW,
    zRange: [27, 118],
    ladder: (z, seed, reduced, a) => new MergeView(newCapture({ z, a: a ?? element(z).commonA }, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Kiln: the science</h2>
        <p>Iron and nickel have the most tightly bound nuclei, so fusing anything heavier costs energy instead of releasing it. Almost every nucleus past iron was built by <b>neutron capture</b>: a neutron has no charge, so the nucleus does not push it away, and it is captured, raising the mass number by one. When the new nucleus is unstable, one of its neutrons beta-decays into a proton and the nucleus moves one element up.</p>
        <p>The <b>s-process</b> (slow) captures neutrons often years apart inside old giant stars, building on iron seeds up to lead and bismuth. The <b>r-process</b> (rapid) captures many within seconds, in merging neutron stars and perhaps rare supernovae, and is the only way to make thorium and uranium. ${sup(String(el.commonA))}${el.symbol}, ${el.name}'s most common isotope, has ${el.commonA} nucleons: ${z} protons and ${el.commonA - z} neutrons.</p>
        <p class="muted">Game rule: the seeds, the doubling of two equal clusters and the 8-nucleon threshold for a capture are the puzzle's. Real heavy nuclei grow from iron-group seeds one neutron at a time and never merge in pairs.</p>`;
    },
  },
  {
    id: 'planar', name: 'Unfurl', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(PlanarV); },
    goal: 'Drag the atoms until no two bonds cross.',
    blurb: 'A molecule drawn in a tangle: drag its atoms anywhere until no bond crosses another or runs through an atom.',
    role: 'A reserve game to try out: a hands-on, spatial one, if it earns a place.',
    instructions: PLANAR_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new PlanarView(newPlanar(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Unfurl: the science</h2>
        <p>Chemists draw a molecule as a <b>structural formula</b>: each atom a point or a letter, each bond a line between two of them. A drawing like this records which atoms are bonded to which, its <b>connectivity</b>, and that alone tells many molecules apart.</p>
        <p>Most molecules can be drawn flat with no two bonds crossing; mathematicians call such a network of points and lines <b>planar</b>. Rings, chains and branches all can, and so can cages such as cubane and the soccer-ball-shaped buckminsterfullerene, which is why structural formulas stay readable. A few molecules cannot: chemists have built some on purpose whose bonds can never all be drawn flat without a crossing.</p>
        <p>In a structural formula ${el.name} is written as its symbol, ${el.symbol}, with a line to each atom it is bonded to.</p>
        <p class="muted">Game rule: the atoms here are unnamed, and the bonds stretch freely; in a real molecule bond lengths and angles are fixed, and its shape is three-dimensional.</p>`;
    },
  },
  {
    id: 'circuit', name: 'Volta', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(CircuitV); },
    goal: 'Turn the tiles until current from the cell reaches every one.',
    blurb: 'Turn wire tiles so current from the cell reaches every tile and lights every lamp, with no loose ends and no loops.',
    role: 'A reserve game to try out: a deduction one, if it earns a place.',
    instructions: CIRCUIT_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new CircuitView(newCircuit(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Volta: the science</h2>
        <p>An electric <b>current</b> is a flow of charge, in a metal wire a drift of electrons. A <b>cell</b> pushes it: a chemical reaction inside drives electrons out of its negative terminal, round the circuit and back in at the positive one. A filament lamp lights when current flows through its thin filament and heats it until it glows.</p>
        <p>Metals conduct because their outermost electrons are not held by any one atom but move freely through the whole solid. ${conducts(z)}</p>
        <p class="muted">Game rule: current only flows round a closed loop back to the cell, and here the wires end at lamps. Think of each wire as a cable with two conductors, out and back, the way a house is wired.</p>`;
    },
  },
  {
    id: 'valence', name: 'Valence', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(ValenceV); },
    goal: 'Bond every atom to its number in one molecule.',
    blurb: 'Drag between atoms to add single and double bonds. Each atom takes exactly its number of bonds, bonds never cross, and every atom joins one molecule.',
    role: 'A reserve game to try out: a thinking one for the electron pool, if it earns a place.',
    instructions: VALENCE_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new ValenceView(newValence(d, seed), reduced),
    science: () => `<h2>Valence: the science</h2>
      <p>An atom's <b>valence</b> is how many bonds it usually forms: hydrogen makes one, oxygen two, nitrogen three and carbon four. A covalent bond is a pair of electrons shared between two atoms, and the lighter elements tend to bond until their outer shell holds eight electrons (two for hydrogen).</p>
      <p>Two atoms can share more than one pair. In carbon dioxide, O=C=O, the carbon holds each oxygen with a <b>double bond</b>, so it still has four bonds in all; the two atoms of nitrogen gas share a triple bond.</p>
      <p class="muted">Game rule: the numbers are bond counts, not elements. Real atoms rarely make more than four bonds (sulfur makes six in sulfur hexafluoride), bonds here go no higher than double, and molecules are not laid out on a grid.</p>`,
  },
  {
    id: 'emit', name: 'Emit', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(EmitV); },
    goal: 'Light every cell; no lamp in another lamp\u2019s light.',
    blurb: 'Place lamps that light their row and column up to the walls. Light every open cell, keep every lamp out of the others\u2019 light, and match the numbered walls.',
    role: 'A reserve game to try out: a thinking one for the electron pool, if it earns a place.',
    instructions: EMIT_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new EmitView(newEmit(d, seed), reduced),
    science: () => `<h2>Emit: the science</h2>
      <p>An electron in an atom can only hold certain energies. When one drops from a higher level to a lower one, the atom gives the difference off as a <b>photon</b>, a packet of light whose color is set by the size of the drop. Every element has its own set of levels, so each glows with its own colors, its <b>emission spectrum</b>: the red of a neon sign, the yellow of a sodium street lamp.</p>
      <p>Light crosses empty space in straight lines, and anything opaque in its way leaves a shadow behind it.</p>
      <p class="muted">Game rule: real lamps shine every way, not just along a row and a column, and two beams pass through each other unharmed; the rule that no lamp may sit in another's light is the puzzle's.</p>`,
  },
  {
    id: 'sort', name: 'Vials', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(SortV); },
    goal: 'Pour each color of light into a vial of its own.',
    blurb: 'Tap a vial, then another: the like bands on top pour across onto the same color or into an empty vial. Gather every line of the spectrum whole, in as few pours as the board allows.',
    role: 'A reserve game to try out: a rote, satisfying one, if it earns a place.',
    instructions: SORT_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new SortView(newSort(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Vials: the science</h2>
        <p>A hot gas of one element glows only at certain wavelengths: its <b>emission lines</b>. Each line is light given off when an electron drops from one energy level to a lower one, and the gap between the two levels fixes the line's color. Hydrogen's four visible lines sit at 656 nm (red), 486 nm (blue-green), 434 nm (blue-violet) and 410 nm (violet).</p>
        <p>A spectrometer spreads mixed light out by wavelength so the lines stand apart, and every element's pattern is its own. ${z <= 99 ? `${el.name}'s lines are how it can be picked out in a flame, a lamp or the light of a star.` : `${el.name} has only ever been made a few atoms at a time, so its lines are mostly worked out by calculation rather than measured.`}</p>
        <p class="muted">Game rule: light is not poured, and the bands' colors are play colors, not ${el.name}'s real lines.</p>`;
    },
  },
  {
    id: 'flood', name: 'Flood', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(FloodV); },
    goal: 'Grow the crystal over the whole board within the picks allowed.',
    blurb: 'Tap a color: the crystal in the corner takes it, and every touching cell of that color joins. Plan the order of colors to fill the board within the picks allowed.',
    role: 'A reserve game to try out: a planning one with a growth to watch, if it earns a place.',
    instructions: FLOOD_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new FloodView(newFlood(d, seed), reduced),
    science: () => {
      return `<h2>Flood: the science</h2>
        <p>A <b>crystal</b> is atoms stacked in one repeating pattern, a lattice, that runs unbroken through the whole piece. It grows from a small seed: atoms from the melt or solution around it settle onto its faces in the places the lattice has ready for them, so the pattern spreads outward one layer at a time.</p>
        <p>Snowflakes, salt and quartz are crystals, and almost every solid metal is a mass of tiny crystal grains, each its own lattice. Growing one large crystal, as is done for the silicon in computer chips, takes a seed and slow, steady cooling.</p>
        <p class="muted">Game rule: a real crystal adds atoms of its own kind; it does not change what it is made of to take in its neighbors.</p>`;
    },
  },
  {
    id: 'dipole', name: 'Dipole', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(DipoleV); },
    goal: 'Place the magnets so every edge number is met and like poles never touch.',
    blurb: 'Each domino is a magnet, + at one end and − at the other, or a blank. The numbers count the + and − poles in each row and column, and like poles never touch.',
    role: 'A reserve game to try out: a thinking one, if it earns a place.',
    instructions: DIPOLE_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new DipoleView(newDipole(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Dipole: the science</h2>
        <p>Every magnet has two poles, north and south, and cutting one in half only makes two smaller magnets: nobody has ever found a lone pole. Such a pair of equal and opposite ends is a <b>dipole</b>. Like poles push each other away and opposite poles pull together.</p>
        <p>Electrons are tiny magnetic dipoles too, because of their spin. In most atoms they pair up and cancel. ${[26, 27, 28, 64].includes(z) ? `${el.name} is one of the few elements whose unpaired spins line up by themselves in the solid, which makes it a magnet in its own right.` : `${el.name} is not one of the few elements, such as iron, cobalt and nickel, whose unpaired spins line up by themselves into a magnet.`}</p>
        <p class="muted">Game rule: a magnet's poles are north and south; the + and − here borrow the signs of an electric dipole, and real like poles can touch if pushed together.</p>`;
    },
  },
  {
    id: 'trace', name: 'Tracer', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(TraceV); },
    goal: 'Draw one trail through every cell, meeting the numbers in order.',
    blurb: 'Drag from the 1 and lay one trail through every cell exactly once, meeting the numbers in order and ending on the last. Walls block the way.',
    role: 'A reserve game to try out: a thinking one with a single path to find, if it earns a place.',
    instructions: TRACE_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new TraceView(newTrace(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Tracer: the science</h2>
        <p>Charged particles leave trails. In a <b>cloud chamber</b> or a <b>bubble chamber</b>, an electron passing through leaves a line of droplets or bubbles behind it, and physicists read what happened from the shape of the track: a tight spiral in a magnetic field is a light, slow particle such as an electron; a short, thick, straight track is a heavy one such as an alpha particle.</p>
        <p>${el.name} has ${z} electron${z === 1 ? '' : 's'}; knock one loose with enough energy and a chamber would show its track for a fraction of a second.</p>
        <p class="muted">Game rule: a real track is a smooth curve through space, not a walk from cell to cell, and nothing makes it visit every place once in order.</p>`;
    },
  },
  {
    id: 'shells', name: 'Shells', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(ShellsV); },
    goal: 'Turn the rings until every bead faces its mark.',
    blurb: 'Drag the rings round the nucleus. Every bead must face a mark on the ring outside it, and the outermost ring the dial; linked rings turn together, so the order of the turns is the puzzle.',
    role: 'A reserve game to try out: a thinking one for the electron pool, if it earns a place.',
    instructions: SHELLS_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new ShellsView(newShells(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      const byShell: number[] = [];
      for (const sub of el.subshells) byShell[sub.n - 1] = (byShell[sub.n - 1] ?? 0) + sub.count;
      const counts = byShell.map((c) => c ?? 0);
      return `<h2>Shells: the science</h2>
        <p>An atom's electrons sit in <b>shells</b> round the nucleus, named K, L, M, N, O, P and Q from the inside out. Shell n can hold at most 2n² electrons: 2 in the first, 8 in the second, 18 in the third and 32 in the fourth. The shells split into sub-shells, s, p, d and f, whose colors the rings borrow.</p>
        <p>${el.name}'s ${z === 1 ? 'one electron sits' : `${z} electrons sit`} in ${counts.length === 1 ? 'one shell' : `${counts.length} shells`}${counts.length > 1 ? `, holding ${counts.join(', ')} from the inside out` : ''}.</p>
        <p>Niels Bohr drew the shells as rings in 1913, and the picture stuck, though quantum mechanics later replaced the rings with clouds of probability.</p>
        <p class="muted">Game rule: shells do not turn like the dials of a lock, their electrons do not sit in slots, and real shells hold far more electrons than a ring here has beads. Each ring's color is just its own, borrowed from the sub-shell palette.</p>`;
    },
  },
  {
    id: 'drop', name: 'Well', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(DropV); },
    goal: 'Fill the well to the brim with the falling clusters.',
    blurb: 'Clusters of protons and neutrons come one by one. Choose where each falls, and which way it is turned, so the well fills to the brim with no gap; a gap sealed under a cluster stays.',
    role: 'A reserve game to try out: a rote, hands-on one for the nucleus pool, if it earns a place.',
    instructions: DROP_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new DropView(newDrop(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Well: the science</h2>
        <p>Nucleons pack together at almost the same density in nearly every nucleus, about 0.16 nucleons per cubic femtometer. Like a drop of liquid, a nucleus grows in volume with the number of particles in it and has no room left for gaps. This is the <b>liquid drop model</b>, which George Gamow proposed in 1928 and Carl Friedrich von Weizsäcker turned into a formula for nuclear masses.</p>
        <p>The nucleus of ${el.name.toLowerCase()}-${el.commonA} holds ${el.commonA} nucleons: ${z} ${z === 1 ? 'proton' : 'protons'} and ${el.commonA - z} ${el.commonA - z === 1 ? 'neutron' : 'neutrons'}.</p>
        <p>The clusters are real light nuclei: a proton and a neutron make a deuteron, three nucleons make tritium or helium-3, and two protons with two neutrons make an alpha particle, the helium-4 nucleus that heavy atoms throw out when they decay.</p>
        <p class="muted">Game rule: nucleons do not fall into wells or sit in square cells, and a nucleus is not built from clusters dropped one by one.</p>`;
    },
  },
  {
    id: 'push', name: 'Shepherd', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(PushV); },
    goal: 'Push every nucleon onto a socket of its own kind.',
    blurb: 'Walk the probe round a small walled chamber and push protons and neutrons onto their sockets, one at a time and never pulling. Walking is free; par is the fewest pushes.',
    role: 'A reserve game to try out: a thinking one with a plan to find, for the nucleus pool, if it earns a place.',
    instructions: PUSH_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new PushView(newPush(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Shepherd: the science</h2>
        <p>A nucleus is built from two kinds of <b>nucleon</b>: <b>protons</b>, each with one positive charge, and <b>neutrons</b>, with none. ${el.name} has ${z} proton${z === 1 ? '' : 's'}; that count is what makes it ${el.name}, while the number of neutrons can vary from one isotope to the next.</p>
        <p>Inside the nucleus the nucleons are held by the strong force, which pulls on protons and neutrons alike at very short range and easily beats the protons' electric push on each other.</p>
        <p class="muted">Game rule: nucleons are not pushed about one at a time, and a nucleus has no sockets; protons and neutrons are colored only to tell them apart.</p>`;
    },
  },
  {
    id: 'collide', name: 'Hadron', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(CollideV); },
    goal: 'Collect the target particles within the move budget.',
    blurb: 'Swap two neighboring particles to line up three or more of a kind; they collide and vanish and new ones fall in. Four make a jet, five a shower. Collect the targets before the moves run out.',
    role: 'A reserve game to try out: a rote, relaxing match-three for the particle chapters, if it earns a place.',
    instructions: COLLIDE_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new CollideView(newCollide(d, seed), reduced),
    science: () => `<h2>Hadron: the science</h2>
      <p>Everything ordinary is built from a few kinds of particle. <b>Quarks</b> (up, down and strange are three of the six) are never seen alone: they come bound in threes, as protons and neutrons, or in quark and antiquark pairs. <b>Leptons</b> live alone: the electron, its heavier cousin the <b>muon</b>, and the ghostly <b>neutrino</b>, which passes through the whole Earth almost untouched.</p>
      <p>Physicists meet them by colliding particles at enormous energies. The debris comes out as narrow sprays called <b>jets</b>, the trace of a quark or gluon knocked loose, and as <b>showers</b>, cascades of particles set off when something hits a detector's dense layers.</p>
      <p class="muted">Game rule: three alike in a line do not vanish, particles do not sit on a grid, and a jet or shower here is only a way to clear tiles.</p>`,
  },
  {
    id: 'annihil', name: 'Nullis', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(AnnihilV); },
    goal: 'Jump pieces over their opposites until one is left.',
    blurb: 'A piece jumps over a neighbor of the opposite kind, matter over antimatter or antimatter over matter, into the empty hole beyond, and the one it jumps is annihilated. Clear the board down to a single piece.',
    role: 'A reserve game to try out: a thinking one with a quick flash on every move, for the particle chapters, if it earns a place.',
    instructions: ANNIHIL_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new AnnihilView(newAnnihil(d, seed), reduced),
    science: () => `<h2>Nullis: the science</h2>
      <p>Nearly every kind of particle has an <b>antiparticle</b>, with the same mass and the opposite charge: the electron has the positron, the proton the antiproton. When a particle meets its antiparticle they <b>annihilate</b>: both vanish and their mass turns into energy. An electron and a positron meeting at rest usually become two gamma-ray photons, flying off in opposite directions.</p>
      <p>Hospitals use this every day: in a PET scan, positrons from a tracer annihilate with electrons in the body, and the scanner reads the paired photons to see where the tracer went.</p>
      <p>Why the universe is made of matter at all, when the Big Bang should have made equal amounts of both, is still an open question.</p>
      <p class="muted">Game rule: in a real annihilation both particles vanish; here the jumping piece survives, and the pieces are generic matter and antimatter, not any one particle.</p>`,
  },
  {
    id: 'solo', name: 'Solus', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(SoloV); },
    goal: 'One electron in every row, column and orbital; none touching.',
    blurb: 'Place one electron in every row, every column and every colored orbital. No two electrons touch, not even at a corner. Cross off cells as you rule them out.',
    role: 'A reserve game to try out: a thinking one for the electron pool, if it earns a place.',
    instructions: SOLO_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new SoloView(newSolo(d, seed), reduced),
    science: () => `<h2>Solus: the science</h2>
      <p>Electrons in an atom fill <b>subshells</b> made of orbitals: one orbital in an s subshell, three in p, five in d and seven in f. Each orbital can hold two electrons, spinning opposite ways.</p>
      <p>When a subshell is filling, its electrons spread out first: each orbital takes one electron before any takes a second. This is <b>Hund's rule</b>, and it comes from electrons repelling one another, so they keep apart. A half-filled subshell, one electron in every orbital, is especially stable; nitrogen's 2p and manganese's 3d are examples.</p>
      <p class="muted">Game rule: orbitals are not patches of a grid, and the rows, columns and "never touching" rule are the puzzle's own.</p>`,
  },
  {
    id: 'blocks', name: 'Cubit', tier: 'reserve',
    use: 'Practice',
    get rules() { return rulesOf(BlocksV); },
    goal: 'Cut the grid into rectangles, one number in each, sized by its number.',
    blurb: 'Drag from corner to corner to draw rectangles. Each holds exactly one number, which is its area in cells, and together they cover the whole grid.',
    role: 'A reserve game to try out: a thinking one for the electron pool, if it earns a place.',
    instructions: BLOCKS_HOW,
    zRange: [1, 118],
    native: (d, seed, reduced) => new BlocksView(newBlocks(d, seed), reduced),
    science: (z) => {
      const el = element(z);
      return `<h2>Cubit: the science</h2>
        <p>An atom's electrons sit in <b>subshells</b> of fixed size. An <span style="color:${SUBSHELL_COLORS.s}">s</span> subshell holds at most 2 electrons, <span style="color:${SUBSHELL_COLORS.p}">p</span> holds 6, <span style="color:${SUBSHELL_COLORS.d}">d</span> holds 10 and <span style="color:${SUBSHELL_COLORS.f}">f</span> holds 14: two for each of its 1, 3, 5 or 7 orbitals.</p>
        <p>${el.name}'s ${z} electron${z === 1 ? '' : 's'} fill these subshells from the lowest energy up, each one full before the next begins, give or take a few exceptions among the transition metals and the heavier elements.</p>
        <p class="muted">Game rule: the rectangles only borrow the subshells' colors by size; nothing in an atom is cut into rectangles.</p>`;
    },
  },
];

/** How element z conducts electricity, in a sentence, for Circuit's science page. */
function conducts(z: number): string {
  const el = element(z);
  if (z >= 100 || z === 85 || z === 87) return `${el.name} has never been made in a piece big enough to wire up, so how well it conducts has never been measured.`;
  if (z === 6) return 'Carbon is not a metal, but as graphite it conducts: in each of its flat sheets some electrons spread across the whole layer.';
  if (el.series === 'Metalloids') return `${el.name} is a metalloid: it conducts electricity, but far less well than a typical metal.`;
  if (/metal/i.test(el.series)) return `${el.name} is a metal, and conducts this way.`;
  return `${el.name} is not a metal: its electrons stay bound to their own atoms or molecules, so on its own it conducts poorly or not at all.`;
}

// Every built game deals from the dial: a native game straight from it, a ladder game at the
// element the dial picks on its ladder (Tokamak keeps the real nucleus's mass number).
for (const p of PUZZLES) {
  const { ladder, native } = p;
  if (native) {
    nativeSpan(p.id, ...(p.nativeSpan ?? []));
    p.dealAt = (d, seed, reduced, z, a) => native(dialFor(p.id, d), seed, reduced, z, a);
  } else if (ladder) {
    p.dealAt = (d, seed, reduced, z, a) => ladder(zForDial(p.id, d, z), seed, reduced, a ?? element(z).commonA);
  } else continue;
  p.deal = (z, seed, reduced, a) => p.dealAt!(difficulty(p.id, z), seed, reduced, z, a);
  p.make = (z, n, reduced) => p.deal!(z, dealSeed(p.id, z, n), reduced);
  p.makeAt = (d, n, reduced) => p.dealAt!(dialFor(p.id, d), dealSeed(`${p.id}@dial`, d, n), reduced, elementForDial(p.id, dialFor(p.id, d)));
}

export function puzzleType(id: string): PuzzleType {
  return PUZZLES.find((p) => p.id === id)!;
}
