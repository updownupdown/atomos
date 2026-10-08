// Element data for the prototype (hydrogen to neon).
// Ionisation energies are successive values in eV (IE1 removes the first electron
// from the neutral atom, IEZ removes the last one). Source: NIST Atomic Spectra
// Database ionization energies; transcribed by hand, to be replaced by a generated
// dataset before release.

export type Family =
  | 'reactive-nonmetal'
  | 'noble-gas'
  | 'alkali-metal'
  | 'alkaline-earth'
  | 'metalloid'
  | 'halogen';

export interface FamousLine {
  nm: number;
  label: string;
}

export interface ElementInfo {
  z: number;
  symbol: string;
  name: string;
  family: Family;
  /** Mass number of the most abundant isotope, used to draw the nucleus. */
  commonA: number;
  ionisation: number[];
  hint: string;
  facts: string[];
  famousLine?: FamousLine;
}

export const ELEMENTS: ElementInfo[] = [
  {
    z: 1, symbol: 'H', name: 'Hydrogen', family: 'reactive-nonmetal', commonA: 1,
    ionisation: [13.598],
    hint: 'The simplest atom: one proton, one electron.',
    facts: [
      'Hydrogen makes up about three quarters of the ordinary matter in the universe by mass.',
      'Its red 656 nm line, hydrogen-alpha, colours the glowing nebulae in astronomy photos.',
    ],
    famousLine: { nm: 656.3, label: 'Hydrogen-alpha' },
  },
  {
    z: 2, symbol: 'He', name: 'Helium', family: 'noble-gas', commonA: 4,
    ionisation: [24.587, 54.418],
    hint: 'Seen in the light of the Sun before anyone found it on Earth.',
    facts: [
      'Helium was spotted as an unknown yellow line in the Sun\'s spectrum in 1868, 27 years before it was isolated on Earth.',
      'It is the only element that stays liquid down to absolute zero at normal pressure.',
    ],
    famousLine: { nm: 587.6, label: 'Helium D3, the line that revealed it' },
  },
  {
    z: 3, symbol: 'Li', name: 'Lithium', family: 'alkali-metal', commonA: 7,
    ionisation: [5.392, 75.64, 122.454],
    hint: 'The lightest metal, and the heart of your phone battery.',
    facts: [
      'Lithium is so light that it floats on water, and even on oil.',
      'Lithium salts have been used as a psychiatric medicine since 1949.',
    ],
    famousLine: { nm: 670.8, label: 'The crimson of lithium flames' },
  },
  {
    z: 4, symbol: 'Be', name: 'Beryllium', family: 'alkaline-earth', commonA: 9,
    ionisation: [9.323, 18.211, 153.896, 217.719],
    hint: 'The James Webb Space Telescope looks at the universe through me.',
    facts: [
      'The 18 mirror segments of the James Webb Space Telescope are gold-coated beryllium.',
      'X-rays pass through beryllium almost untouched, so it is used for X-ray tube windows.',
    ],
  },
  {
    z: 5, symbol: 'B', name: 'Boron', family: 'metalloid', commonA: 11,
    ionisation: [8.298, 25.155, 37.931, 259.375, 340.226],
    hint: 'Stars barely make me. Cosmic rays do.',
    facts: [
      'Most boron is made by cosmic rays smashing heavier nuclei in space, not by fusion inside stars.',
      'Boron oxide turns ordinary glass into borosilicate glass, which shrugs off sudden heat.',
    ],
  },
  {
    z: 6, symbol: 'C', name: 'Carbon', family: 'reactive-nonmetal', commonA: 12,
    ionisation: [11.26, 24.383, 47.888, 64.494, 392.09, 489.993],
    hint: 'Diamond and pencil lead are both made of me.',
    facts: [
      'Diamond and graphite are both pure carbon. Only the way the atoms bond differs.',
      'Radiocarbon dating relies on carbon-14, which has a half-life of about 5,700 years.',
    ],
  },
  {
    z: 7, symbol: 'N', name: 'Nitrogen', family: 'reactive-nonmetal', commonA: 14,
    ionisation: [14.534, 29.601, 47.449, 77.474, 97.89, 552.072, 667.046],
    hint: 'Most of every breath you take.',
    facts: [
      'Nitrogen makes up about 78% of Earth\'s atmosphere.',
      'The triple bond in N₂ is one of the strongest in chemistry, which is why the nitrogen in air is so unreactive.',
    ],
  },
  {
    z: 8, symbol: 'O', name: 'Oxygen', family: 'reactive-nonmetal', commonA: 16,
    ionisation: [13.618, 35.121, 54.936, 77.414, 113.899, 138.12, 739.29, 871.41],
    hint: 'Nearly half the mass of Earth\'s crust.',
    facts: [
      'Oxygen is the most abundant element in Earth\'s crust, about 46% by mass.',
      'The green glow of the aurora is oxygen atoms emitting light at 557.7 nm.',
    ],
    famousLine: { nm: 557.7, label: 'The green of the aurora' },
  },
  {
    z: 9, symbol: 'F', name: 'Fluorine', family: 'halogen', commonA: 19,
    ionisation: [17.423, 34.971, 62.708, 87.175, 114.249, 157.165, 185.186, 953.91, 1103.12],
    hint: 'I pull on electrons harder than any other atom.',
    facts: [
      'Fluorine is the most electronegative element: no atom pulls harder on electrons.',
      'It reacts with almost everything, even the noble gas xenon.',
    ],
  },
  {
    z: 10, symbol: 'Ne', name: 'Neon', family: 'noble-gas', commonA: 20,
    ionisation: [21.565, 40.963, 63.45, 97.12, 126.21, 157.93, 207.28, 239.1, 1195.83, 1362.2],
    hint: 'I glow red-orange in signs.',
    facts: [
      'Only neon itself glows red-orange in a sign. Other colours come from other gases or coated tubes.',
      'Neon was discovered in 1898 by William Ramsay and Morris Travers.',
    ],
    famousLine: { nm: 640.2, label: 'The red of a neon sign' },
  },
];

export const MAX_Z = ELEMENTS.length;

export function element(z: number): ElementInfo {
  const e = ELEMENTS[z - 1];
  if (!e) throw new Error(`No element data for Z=${z}`);
  return e;
}

export const FAMILY_COLOURS: Record<Family, string> = {
  'reactive-nonmetal': '#6fd3ff',
  'noble-gas': '#b9a2ff',
  'alkali-metal': '#ffa36f',
  'alkaline-earth': '#ffd772',
  'metalloid': '#7fe6c8',
  'halogen': '#a6ff8f',
};

export const FAMILY_NAMES: Record<Family, string> = {
  'reactive-nonmetal': 'Reactive nonmetal',
  'noble-gas': 'Noble gas',
  'alkali-metal': 'Alkali metal',
  'alkaline-earth': 'Alkaline earth metal',
  'metalloid': 'Metalloid',
  'halogen': 'Halogen',
};

/** Names for the whole table, so the spiral map can show what lies ahead. */
export const ALL_SYMBOLS = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
  'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr ' +
  'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');
