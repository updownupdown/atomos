// "How to read this": the guide behind the button at the foot of each View page. Each page is
// already the science; the guide says what its pictures show, where the numbers come from, what
// was simplified to draw them, and a little of the wider story, with small drawings in place of
// long explanations. Detail most readers can skip folds away in a disclosure.

import { BLOCK_COLOUR, type Element } from './data';
import type { Tab } from './info';
import { lifeMeter } from './visuals';
import { disclosureHTML } from '../ui/components';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (n: number) => n.toFixed(1);
const section = (title: string, html: string) => `<h3>${title}</h3>${html}`;
const p = (text: string) => `<p>${text}</p>`;

/** The four blocks as colored chips, with where each sits in the periodic table. */
function blockLegend(): string {
  const rows: [keyof typeof BLOCK_COLOUR, string, string][] = [
    ['s', 's block', 'Groups 1 and 2, plus helium. One round layer.'],
    ['p', 'p block', 'Groups 13 to 18. Three dumbbell-shaped orbitals.'],
    ['d', 'd block', 'The transition metals. Five orbitals, mostly four-lobed.'],
    ['f', 'f block', 'Lanthanides and actinides. Seven intricate orbitals.'],
  ];
  return `<ul class="gd-blocks">${rows.map(([b, name, text]) => `<li><i style="background:${BLOCK_COLOUR[b]}"></i><b>${name}</b><span>${text}</span></li>`).join('')}</ul>`;
}

/** This element's tile with its parts named. */
function tileAnatomy(e: Element): string {
  const w = e.weight == null ? '' : `${Number(e.weight.toPrecision(5))}`;
  return `<div class="gd-anatomy">
    <div class="ov-tile" style="--b:${BLOCK_COLOUR[e.block]}"><span>${e.z}</span><b>${e.symbol}</b><em>${w}</em></div>
    <ul>
      <li><b>${e.z}</b> Atomic number: the protons in every ${esc(e.name.toLowerCase())} nucleus, and the electrons round a neutral atom.</li>
      <li><b>${e.symbol}</b> Symbol, often from the Latin or Greek name.</li>
      ${w ? `<li><b>${w}</b> Atomic weight: the average mass of its atoms as found on Earth, in daltons (a twelfth of a carbon-12 atom).</li>` : ''}
      <li><b class="gd-strip" style="background:${BLOCK_COLOUR[e.block]}"></b> The colored edge is its block.</li>
    </ul>
  </div>`;
}

/** The filling-order chart: subshells in rows, read along the diagonals. */
function madelungChart(e: Element): string {
  const L = ['s', 'p', 'd', 'f'] as const;
  const mine = new Set(e.subshells.map((s) => s.key));
  const cell = 46, ox = 22, oy = 16;
  let cells = '';
  for (let n = 1; n <= 7; n++) for (let l = 0; l < Math.min(n, 4); l++) {
    const key = `${n}${L[l]}`;
    const x = ox + l * cell, y = oy + (n - 1) * 30;
    cells += `<g class="${mine.has(key) ? 'gd-m is-mine' : 'gd-m'}" style="--b:${BLOCK_COLOUR[L[l]]}"><rect x="${x}" y="${y}" width="38" height="22" rx="6"/><text x="${x + 19}" y="${y + 15.5}">${key}</text></g>`;
  }
  // Diagonals of equal n + l, from upper right to lower left.
  let arrows = '';
  for (let k = 1; k <= 8; k++) {
    const pts: [number, number][] = [];
    for (let l = 3; l >= 0; l--) { const n = k - l; if (n >= 1 && n <= 7 && l < n) pts.push([ox + l * cell + 19, oy + (n - 1) * 30 + 11]); }
    if (pts.length < 2) continue;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    arrows += `<path class="gd-diag" d="M ${f1(a[0] + 16)} ${f1(a[1] - 10)} L ${f1(b[0] - 16)} ${f1(b[1] + 10)}"/>`;
  }
  return `<svg class="gd-madelung" viewBox="0 0 230 236" role="img" aria-label="Subshells in rows by shell; electrons fill them along the diagonals, top right to bottom left, one diagonal after another.">${arrows}${cells}</svg>`;
}

/** A log ruler from a nanosecond to the age of the universe, as the isotope bars use it. */
function lifeRuler(): string {
  const W = 300, x0 = 14, x1 = W - 24;
  const ticks: [number, string][] = [[1e-9, '1 ns'], [1, '1 s'], [86400, 'day'], [3.156e7, 'year'], [3.156e13, '1 My'], [4.35e17, 'universe']];
  const X = (t: number) => x0 + lifeMeter(t) * (x1 - x0);
  return `<svg class="gd-ruler" viewBox="0 0 ${W} 46" role="img" aria-label="The half-life scale: a nanosecond, a second, a day, a year, a million years, the age of the universe, spaced by powers of ten.">
    <rect class="gd-ruler-bar" x="${x0}" y="10" width="${x1 - x0}" height="6" rx="3"/>
    ${ticks.map(([t, label]) => `<path class="gd-ruler-tick" d="M ${f1(X(t))} 6 V 20"/><text x="${f1(X(t))}" y="36">${label}</text>`).join('')}
  </svg>`;
}

const PROPERTY_WORDS: [string, string][] = [
  ['Density', 'Mass per volume of the pure element; for gases, of the liquid or solid. Osmium is the densest, hydrogen the lightest.'],
  ['Melting and boiling points', 'In kelvin and degrees Celsius; 0 K is absolute zero, −273.15 °C. Tungsten melts at the highest temperature of any metal; helium never freezes at normal pressure.'],
  ['Electronegativity', 'How strongly an atom pulls shared electrons towards itself in a bond, on the Pauling scale. Fluorine is highest at 3.98.'],
  ['First ionization energy', 'The energy to pull away one electron, in electronvolts. Noble gases hold on hardest; alkali metals let go easily.'],
  ['Size', 'The van der Waals radius: half the distance between two atoms that touch without bonding.'],
  ['Crust and seawater', 'How much of the element is in Earth\'s crust (milligrams per kilogram) and in seawater (milligrams per liter).'],
  ['Oxidation states', 'The charges an atom commonly takes in compounds: positive when it gives electrons away, negative when it takes them.'],
];

const ERAS: [string, string][] = [
  ['Before 1650', 'Gold, silver, copper, iron, tin, lead, mercury, sulfur and carbon were known in antiquity; arsenic, antimony and bismuth came later through metalworking and alchemy.'],
  ['1700s', 'Chemistry becomes a science. Gases such as hydrogen, nitrogen and oxygen are isolated, and Lavoisier defines an element as what cannot be broken down further.'],
  ['1800s', 'Electrolysis frees the reactive metals (sodium, potassium, calcium), spectroscopy finds new ones by the colors they glow, and Mendeleev\'s table of 1869 predicts the gaps.'],
  ['1890s to 1930s', 'The noble gases and the radioactive elements such as polonium and radium appear, and X-ray spectra fix each element\'s atomic number.'],
  ['1940 on', 'Almost everything new is made, not found: in reactors, bomb debris and particle accelerators, some only a few atoms at a time. Oganesson, element 118, was first made in 2002.'],
];

function guide(e: Element, tab: Tab): { title: string; html: string } {
  const name = esc(e.name.toLowerCase());
  switch (tab) {
    case 'overview': return {
      title: 'Reading the overview',
      html:
        section('The tile', tileAnatomy(e))
        + section('Blocks and colors', p('Every element sits in one of four blocks, named after the kind of electron layer it is filling. The same four colors mark the layers in the 3D view, the orbitals and the puzzles.') + blockLegend())
        + section('The 3D view', p('Each colored cloud is one layer of electrons. Where the dots are dense, an electron is more likely to be found. Nothing is orbiting: the dots are samples of a probability, which is why they fade and reappear somewhere else. The bright dot in the middle marks the nucleus; at true scale it would be tens of thousands of times too small to see.')
          + p('The edge of the cloud sits at the atom\'s van der Waals radius, and the scale circles are 300, 400, 500 and 600 pm across (a picometer is a trillionth of a meter). Show or hide the circles at the bottom left. Under Draw as, Cloud shows only the dots, Shapes the textbook orbital surfaces, Hybrid both. Pinch (or scroll) to look closer; the view drifts back to the shared scale after a moment, so every element stays comparable.')
          + p('Zoom to Nucleus (opened by solving a Glyph puzzle) swaps the atom for its nucleus, about a hundred thousand times smaller: every proton (gold) and neutron (silver) of the most common isotope, with circles 4, 8, 12 and 16 fm across (a femtometer is a thousandth of a picometer). The balls show how many there are and how big the nucleus is, not fixed places: nucleons have none.')
          + p('Double-tap the atom to dive in and out. The dive keeps the true proportions: everything grows 37,500 times, evenly in powers of ten, while the width of the view counts down from picometers to femtometers. The cloud swells past you and fades, then there is a long stretch of nothing, because an atom is almost entirely empty space, until the nucleus grows out of a point.')
          + disclosureHTML({ title: 'How the clouds are made', body: p('The shapes are the hydrogen-like orbitals, the exact solutions for a single electron, spaced by Slater\'s rules for how much the inner electrons shield the outer ones from the nucleus. Real many-electron atoms differ in the detail, and the lobes are sharpened a little so they read on a phone. Stepping to a neighbor keeps the layers both atoms share; added electrons fade in white and removed ones fade out red.') }))
        + section('Facts and photos', p(`The headline and facts were written for Atomos and spot-checked against standard references. Photos come from Wikimedia Commons, credited under each one with the author and license; a few radioactive elements have no photo of a real sample.${e.z >= 104 ? ` Elements from rutherfordium on, ${name} among them, have only been made a few atoms at a time, so much of what we show of them is prediction.` : ''}`)),
    };
    case 'structure': return {
      title: 'Reading the structure',
      html:
        section('Two ways to see it', p(`<b>Together</b> draws every orbital of ${name} at once, centered on the nucleus, each layer as far out as its electrons usually reach (85% of the layer lies inside), always to true scale. The inner layers sit inside the outer ones, which is how they fit in the real atom: they overlap rather than stack. It turns slowly; drag sideways to turn it yourself. Drag the slider, or press Play, to add the electrons one at a time in the order they fill: an orbital lights pale with one electron and full with two. Tapping a layer zooms in on it without changing any size, which is the only way to see the tiny inner layers of a heavy atom.`)
          + p(`Under it is the orbital diagram a chemist would draw: one line per shell, a box per orbital, and an arrow in a box per electron, its direction standing for its spin, a lone one in cyan. The boxes fill with the slider. Tap a subshell to pick out its layer and see each of its orbitals as a flat cut through its middle, the way textbooks sketch them (a circle for s, two lobes for p, four or two and a ring for d, more for f), named. A shape Glyph has not revealed yet (on boron, scandium and cerium) shows a question mark, and a plain ring in the picture.`)
          + p('<b>Shells</b> is the accurate picture: how likely an electron is at each distance from the nucleus. Each colored hill is one layer, its area set by its electrons; the white line is the total, and its peaks are the shells K, L, M and onward. Layers of different shells overlap, which is why real atoms have no hard rings. The distance axis is stretched near the nucleus (a square-root scale) so the tight inner shells show next to the wide outer ones, and the dashed line marks the van der Waals edge.')
          + disclosureHTML({ title: 'How the shells are computed', body: p('Each layer uses the hydrogen-like radial function for its shell and type, with Slater\'s effective nuclear charge for how strongly the inner electrons shield it. All distances are then scaled by one factor so the outer layer\'s edge sits on the van der Waals radius, exactly as in the 3D view. Full quantum calculations give somewhat different shapes, especially for the outer shells of heavy atoms, but the order and overlap of the shells come out the same.') }))
        + section('Filling order', p('Electrons fill the lowest-energy layers first. Write the layers in rows by shell and the order runs along the diagonals: 1s, 2s, 2p, 3s, 3p, 4s, 3d, 4p and so on. That is why 4s fills before 3d. The layers this atom uses are lit.') + madelungChart(e)
          + disclosureHTML({ title: 'Exceptions to the rule', body: p('About twenty elements break the diagonal rule. Chromium and copper move one electron from 4s into 3d, because a half-full or full d layer is especially stable; palladium empties its 5s altogether. The orbitals and the numbers always show what the element really does, not what the rule predicts.') }))
        + section('Dots and pairs', p('Each orbital holds at most two electrons, with opposite spins. Inside a layer, electrons spread out one per orbital before any pair up (Hund\'s rule). Each arrow is an electron; an orbital with one arrow has room for another. Unpaired electrons are what make atoms like iron magnetic.')),
    };
    case 'isotopes': return {
      title: 'Reading the isotopes',
      html:
        section('What an isotope is', p(`Every ${name} atom has ${e.z} proton${e.z === 1 ? '' : 's'}; isotopes differ only in their neutrons. Each is named by its mass number, protons plus neutrons, as in ${e.symbol}-${e.isotopes[0]?.a ?? e.z * 2}. Chemically they behave almost the same; their nuclei do not.`))
        + section('Your collection', p(`Lasting isotopes are the stable ones and any with a half-life over a year. Each has its own puzzle, and building them, with the nucleus and electrons, makes ${name} 100% built. Fleeting isotopes are all the others. They have their own count and never hold back the 100%. You pick the puzzle for each, and the shorter it lives, the harder the board. A fleeting isotope you build stays in your collection marked decayed, with its half-life, because a real sample would be gone long before you looked again.`))
        + section('The neutron chart', p('One bar per isotope, from the fewest neutrons on the left to the most on the right. The taller a bar, the longer that isotope lasts; stable ones reach the top in cyan. Together they show the element\'s valley of stability: a ridge where neutrons and protons balance, falling away on both sides. The outlined bar is the most common isotope.'))
        + section('The table', p('Each row is one isotope. Its bar is how long it lasts: full and cyan when stable, otherwise its half-life, the time for half of a sample to decay. The scale goes up in powers of ten, so each step along the bar means many times longer, not a little longer.') + lifeRuler()
          + p('The ring is its share of the element as found in nature. A few stable isotopes are only observationally stable: no decay has ever been seen, though theory allows one. The list opens on the lasting isotopes; Fleeting shows the rest, and All shows every one. Tap a row for its neutrons, mass and spin.'))
        + disclosureHTML({ title: 'Why some nuclei are stable', body: p('Protons repel each other; neutrons add the strong force that holds a nucleus together without adding repulsion. Light elements are stable with about as many neutrons as protons, heavy ones need about half again as many. Too few or too many neutrons and the nucleus decays towards the balance. Nothing heavier than lead has a stable isotope.') }),
    };
    case 'properties': return {
      title: 'Reading the properties',
      html:
        section('Dots and ranks', p(`Each card is one property: its name, ${name}'s value and rank, and under them every element with a measured value as a dot. Dots sit in four lanes by block, in the block colors, so patterns show at a glance: the p block holds the most electronegative elements, the d block the densest and hardest to melt. ${esc(e.name)} is the ringed dot, and its rank is counted from whichever end is nearer. See in Atlas colors the whole table by that property.`))
        + section('The thermometer', p('Heat runs from absolute zero on the left: solid up to the melting point, liquid up to the boiling point, gas beyond. The white mark is room temperature, so where it falls is the state you would find the element in.'))
        + section('Scales', p('Density and the two abundances use a log scale, because they span many powers of ten: from a gas lighter than air to osmium, from oxygen at nearly half the crust to traces measured in billionths. The other properties are linear. Temperatures are given in kelvin and in degrees Celsius.'))
        + section('What is left out', p('Elements with no measurement are left off rather than guessed. From rutherfordium on, only a few atoms have ever been made, so their values are predictions: they are shown on their own page but kept out of everyone else\'s ranks.'))
        + disclosureHTML({ title: 'What each property means', body: `<dl class="gd-defs">${PROPERTY_WORDS.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl>` }),
    };
  }
}

export function guideHTML(e: Element, tab: Tab): string {
  const g = guide(e, tab);
  return `<h2>${g.title}</h2><div class="gd">${g.html}</div>`;
}
