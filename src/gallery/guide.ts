// "How to read this": what the header microscope opens on the atom screen.
// Each View tab already is the science, so the microscope explains the tab on
// screen: what its picture shows, where the numbers come from, and what was
// simplified to draw it.

import type { ViewTab } from './info';

const GUIDE: Record<ViewTab, { title: string; parts: [string, string][] }> = {
  model: {
    title: 'Reading the model',
    parts: [
      ['What the dots are', 'Each colored cloud is one layer of electrons: s blue, p green, d amber, f violet. Where the dots are dense, an electron is more likely to be found. Nothing is orbiting: the dots are samples of a probability, which is why they fade out and reappear somewhere else.'],
      ['Shapes', 'The layers use the hydrogen-like orbital shapes, spaced with Slater\'s rules for how much the inner electrons shield the outer ones. The lobes are sharpened a little so they read on a small screen. Cloud shows only the dots, Shapes the textbook surfaces, Hybrid both.'],
      ['Size', 'The outer edge sits at the atom\'s van der Waals radius, the size it has when it touches a neighbor. The scale circles are 300, 400, 500 and 600 pm across; a picometer is a trillionth of a meter. The bright dot in the middle marks the nucleus, which at true scale would be tens of thousands of times too small to see.'],
      ['Changing element', 'Step to a neighbor and the layers both atoms share stay put while the added electrons fade in white, or the removed ones fade out red.'],
    ],
  },
  overview: {
    title: 'Reading the overview',
    parts: [
      ['The label', 'Atomic number, symbol and atomic weight, then the element\'s family, its place in the periodic table, its block (the kind of layer it is filling) and its electron configuration.'],
      ['Facts', 'The headline and the four facts were written for Atomos and spot-checked against standard references. Elements from rutherfordium on have only been made a few atoms at a time, so their configurations are predictions.'],
      ['Photos', 'Photos come from Wikimedia Commons, credited with their author and license under each one. Some radioactive elements have no photo of a real sample.'],
    ],
  },
  structure: {
    title: 'Reading the structure',
    parts: [
      ['The blueprint', 'An exploded drawing of the atom, assembled from the nucleus up, one numbered step per layer in the order the layers fill. It is an illustration, not to scale.'],
      ['Filling order', 'Layers mostly fill in the Madelung order: 1s, 2s, 2p, 3s, 3p, 4s, 3d and so on. Some elements break it, such as chromium and copper, and the drawing shows what the element really does.'],
      ['Pairs of dots', 'Each orbital holds two electrons. Within a layer, electrons spread out one per orbital before any pair up (Hund\'s rule), which is how the dots are drawn.'],
    ],
  },
  isotopes: {
    title: 'Reading the isotopes',
    parts: [
      ['Tiles', 'Every atom of an element has the same number of protons; isotopes differ in neutrons. Each tile is one isotope, named by its mass number, protons plus neutrons.'],
      ['Bright and dim', 'Bright tiles are stable, and their bar is their share of the element as found in nature. A few of these are only observationally stable: no decay has ever been seen, though theory allows one.'],
      ['Bars on the others', 'A bar on an unstable tile shows its half-life on a log scale, from a nanosecond to the age of the universe, so a step along the bar is a factor, not an amount.'],
    ],
  },
  properties: {
    title: 'Reading the properties',
    parts: [
      ['Ticks', 'Each line is one property. Every faint tick is another element with a measured value; the bright one is this element, with its rank among them.'],
      ['Scales', 'Density and the two abundances use a log scale, because they span many powers of ten. The rest are linear. Elements with no measurement are left off rather than guessed.'],
      ['Oxidation states', 'The bars count how many elements use each charge in their compounds; this element\'s own states are highlighted.'],
    ],
  },
  story: {
    title: 'Reading the story',
    parts: [
      ['The timeline', 'Each dot is one element, stacked by the decade it was identified, from 1650 on. Elements known before then sit together at the left. This element\'s dot is the bright one.'],
      ['The name', 'Where the name comes from, who found the element and where, where it comes from today and what it is used for. This text comes from the open-source mendeleev dataset Atomos is built on.'],
    ],
  },
};

export function guideHTML(tab: ViewTab): string {
  const g = GUIDE[tab];
  return `<h2>${g.title}</h2>${g.parts.map(([h, p]) => `<h3>${h}</h3><p>${p}</p>`).join('')}`;
}
