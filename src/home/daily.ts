// Home's two daily games, both drawn from facts the app already holds (elements.json and
// element-facts.json), the same for every player on a given day:
//   - the atom of the day, to find among four atom cards with up to three clues;
//   - Nu's questions, three a day with two choices or four atom cards each, with a streak.
// What the player has answered today sits under its own storage key, apart from the save; the
// backup carries it with every other atomos.* key.

import FACTS from '../data/element-facts.json';
import { MAX_Z, elementAt, type Element } from '../gallery/data';

const KEY = 'atomos.home.v1';

/** Today's date as the player sees it, "2026-10-14", and its day number since 1970. */
export function today(now = new Date()): { key: string; index: number } {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { key, index: Math.floor(Date.UTC(y, m, d) / 864e5) };
}

/** A small seeded generator (mulberry32), so a day deals the same quiz on every device, and
 *  one day's deal has nothing to do with the next one's. */
function seeded(seed: number): () => number {
  let a = Math.imul(seed, 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The atom of the day: every atom once in 118 days, in a scattered order (47 is prime to 118). */
export function atomOfDay(index: number): number {
  return (((index * 47) % MAX_Z) + MAX_Z) % MAX_Z + 1;
}

/** The four atom cards to pick from: the answer, two atoms most people know and one of any kind,
 *  each of a different kind (noble gas, transition metal, halogen...) from the answer and from
 *  one another, so the clues can tell them apart. In order of atomic number. */
export function candidates(z: number, index: number, n = 4): number[] {
  const rnd = seeded(index + 7);
  const out = [z];
  const kinds = new Set([elementAt(z).series]);
  for (let tries = 0; out.length < n && tries < 2000; tries++) {
    const pool = out.length < n - 1 ? FAMILIAR : null;
    const o = pool ? pool[Math.floor(rnd() * pool.length)] : 1 + Math.floor(rnd() * MAX_Z);
    const k = elementAt(o).series;
    if (out.includes(o) || (kinds.has(k) && tries < 1000)) continue;
    out.push(o);
    kinds.add(k);
  }
  return out.sort((a, b) => a - b);
}

const headline = (z: number): string => (FACTS as { h?: string }[])[z - 1]?.h ?? '';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words that give an atom away without naming it: the person or place it is named after. */
const GIVEAWAY: Record<number, string[]> = {
  2: ['Helios'], 105: ['Dubna'], 41: ['Niobe'], 46: ['Pallas'], 90: ['Thor'], 114: ['Flyorov', 'Flerov'], 12: ['Magnesia'], 25: ['Magnesia'], 31: ['Gallia'], 39: ['Ytterby'], 44: ['Russia'], 58: ['Ceres'],
  65: ['Ytterby'], 67: ['Holmia', 'Stockholm'], 68: ['Ytterby'], 69: ['Thule'], 70: ['Ytterby'], 72: ['Hafnia'],
  75: ['Rhine', 'Rhenus'], 77: ['Iris'], 84: ['Poland'], 94: ['Pluto'], 96: ['Curie'], 100: ['Fermi'],
  101: ['Mendeleev', 'Mendeleyev'], 107: ['Bohr'], 108: ['Hesse'], 111: ['Röntgen', 'Roentgen'], 115: ['Moscow'],
  117: ['Tennessee'], 118: ['Oganessian'], 92: ['Uranus'],
};

/** A sentence with the atom's name (and its symbol, where it is written as one) blanked out,
 *  and with it the person or place it is named after ("Albert ______" for einsteinium). */
export function masked(text: string, e: Element): string {
  // Longer names hide inside other words too ("kupfernickel"); short ones only as words, so
  // "tin" leaves "distinct" alone.
  const b = e.name.length >= 5 ? '' : '\\b';
  let t = text.replace(new RegExp(`${b}${esc(e.name)}${b}`, 'gi'), '______');
  // "Einstein" in einsteinium, "America" in americium: the stem before -ium, from five letters.
  const stem = /^(.{5,}?)(ium|um)$/i.exec(e.name)?.[1];
  for (const w of [...(stem ? [stem] : []), ...(GIVEAWAY[e.z] ?? [])]) t = t.replace(new RegExp(`\\b${esc(w)}\\w*`, 'gi'), '______');
  t = e.symbol.length > 1
    ? t.replace(new RegExp(`\\b${esc(e.symbol)}\\b`, 'g'), '__')
    : t.replace(new RegExp(`([,(] ?)${esc(e.symbol)}(?=[,)])`, 'g'), '$1__');
  return t;
}

const num = (n: number) => Math.round(n).toLocaleString('en-US');
const celsius = (k: number) => `${num(k - 273.15).replace(/^-/, '−')} °C`;

const article = (place: string) => (/^(United States|USSR)$/.test(place) ? `the ${place}` : place);
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** Discoverers as a sentence reads them: "A, B and C". */
const people = (who: string) => (/ and /.test(who) ? who : andList(who.split(/,\s*/)));

/** How much of something there is, from mg/kg: "46%", "56 parts per million". */
export function share(mgPerKg: number): string {
  const n = (v: number) => Number(v.toPrecision(2)).toLocaleString('en-US', { maximumFractionDigits: 4 });
  const parts = (v: number, per: string) => `${n(v)} part${n(v) === '1' ? '' : 's'} per ${per}`;
  if (mgPerKg >= 1000) return `${n(mgPerKg / 1e4)}%`;
  if (mgPerKg >= 1) return parts(mgPerKg, 'million');
  return parts(mgPerKg * 1000, 'billion');
}

/** Facts about where an atom is found or what it is used for: the softest way in. */
const SOFT = /\b(uses?|used|alloys?|made (?:from|into)|your|body|blood|bones?|teeth|plants?|food|air|water|sea|oceans?|crust|rocks?|minerals?|ores?|mined?|stars?|sun|batter(?:y|ies)|steel|coins?|jewel\w*|lamps?|lights?|screens?|magnets?|glass|paint|pigments?|medic\w*|fuel|reactors?|electronics|fertilizer|wires?|cans?|pipes?|tools?)\b/i;
/** Facts about its discovery or its name, which belong with the story clues. */
const STORY = /\b(discovered|identified|isolated|named|name|symbol|Latin|Greek|first made|first found|announced)\b/i;

/** The atom of the day's clues in three pools, one clue drawn from each, in this order:
 *  1. where it's found or what it's used for (a fact, else its share of the crust);
 *  2. its story and character: who found it and where, the headline fact, what kind it is;
 *  3. numbers, last: melting and boiling points, density, stable isotopes. */
export function cluePool(z: number): [string[], string[], string[]] {
  const e = elementAt(z);
  const who = e.discoverers ?? '';
  const ancient = /ancient/i.test(who);
  const facts = ((FACTS as { f?: string[] }[])[z - 1]?.f ?? []);
  const crust = e.crust !== null && e.crust >= 0.001 ? `It makes up ${share(e.crust)} of Earth's crust.` : '';

  const soft = facts.filter((f) => SOFT.test(f) && !STORY.test(f)).map((f) => masked(f, e));
  if (!soft.length && crust) soft.push(crust);

  const story: string[] = [];
  if (e.discoveryYear) story.push(`Found in ${e.discoveryYear}${who && !ancient ? ` by ${people(who)}` : ''}.`);
  else if (ancient) story.push('Known since ancient times.');
  if (e.discoveryPlace && !ancient) story.push(`First found in ${andList(e.discoveryPlace.split('/').map(article))}${e.discoveryYear ? `, in ${e.discoveryYear}` : ''}.`);
  const p = phaseOf(e);
  // The headline fact twice as often as the kind, which the four cards alone can give away.
  const h = masked(headline(z), e);
  story.push(h, h, `It's ${aKind(e)}${p ? `, a ${p.toLowerCase()} at room temperature` : ''}.`);
  // Facts that are neither use nor story (rarer atoms often have only these) open the day
  // when nothing softer is known.
  if (!soft.length) soft.push(...facts.filter((f) => !STORY.test(f)).map((f) => masked(f, e)));
  if (!soft.length) soft.push(story[story.length - 1]);

  const numbers: string[] = [];
  if (e.melt !== null) numbers.push(`Melts at ${celsius(e.melt)}${e.density !== null ? `, and its density is ${density(e.density)}` : ''}.`);
  else if (e.boil !== null) numbers.push(`Boils at ${celsius(e.boil)}.`);
  if (e.boil !== null && e.melt !== null) numbers.push(`Boils at ${celsius(e.boil)}.`);
  numbers.push(e.stableIsotopes ? `It has ${e.stableIsotopes} stable isotope${e.stableIsotopes === 1 ? '' : 's'}.` : 'It has no stable isotopes: every atom of it is radioactive.');
  if (crust && soft[0] !== crust) numbers.push(crust);
  const rest = story.filter((c) => c && !soft.includes(c));
  return [soft, rest.length ? rest : story, numbers];
}

/** The day's three clues: where it's found or used first, numbers last; one from each part of
 *  the pool, a different mix every day. */
export function clues(z: number, index = 0): string[] {
  const rnd = seeded(index * 5 + 3);
  return cluePool(z).map((pool) => pool[Math.floor(rnd() * pool.length)]);
}

function density(d: number): string {
  return `${d >= 1 ? d.toFixed(d >= 10 ? 1 : 2) : Number(d.toPrecision(2))} g/cm³`;
}

/** The headline fact, unmasked, for the reveal. */
export function headlineOf(z: number): string {
  return headline(z);
}

// ---------- Nu's question ----------
// Three a day, each about something different: two choices (two atom cards, or two words or
// years) or four atom cards to find one among. Atoms come from the ones most people have heard
// of, and compared values are far apart, so a question is about knowing atoms rather than
// recalling a number.

export type QuizType =
  | 'melt' | 'boil' | 'dense' | 'first' | 'radioactive' | 'noble' | 'phase' | 'year' | 'metal'
  | 'crust' | 'sea' | 'place' | 'stateTrue' | 'era'
  | 'kind4' | 'liquid4' | 'first4' | 'life4';

/** What a question is about: a day asks about three different things. */
const TOPIC: Record<QuizType, string> = {
  melt: 'heat', boil: 'heat', phase: 'state', stateTrue: 'state', liquid4: 'state',
  dense: 'density', first: 'found', year: 'found', era: 'found', first4: 'found',
  radioactive: 'nucleus', noble: 'kind', metal: 'kind', kind4: 'kind',
  crust: 'where', sea: 'where', place: 'name', life4: 'life',
};
export const QUIZ_TYPES = Object.keys(TOPIC) as QuizType[];

/** A choice: an atom's card, or a word or a year on a button. */
export type QuizOption = { z: number } | { text: string };

export interface QuizQuestion {
  type: QuizType;
  text: string;
  /** Two choices, or four atom cards. */
  options: QuizOption[];
  answer: number;
  /** What each card shows once answered ("1,538 °C"); '' for none. */
  after: string[];
  /** For a question about one atom: the atom, and a line shown once answered. */
  about?: number;
  note?: string;
}

/** Atoms most people have heard of. */
export const FAMILIAR = [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 27, 28, 29, 30, 35, 36, 47, 50, 53, 54, 74, 78, 79, 80, 82, 86, 88, 92, 94];

/** Atoms named after a place, and the place. */
export const PLACE_NAMES: Record<number, string> = {
  12: 'Magnesia, in Greece', 21: 'Scandinavia', 25: 'Magnesia, in Greece', 29: 'Cyprus', 31: 'France (Gallia)',
  32: 'Germany', 38: 'Strontian, in Scotland', 39: 'Ytterby, in Sweden', 44: 'Russia (Ruthenia)', 63: 'Europe',
  65: 'Ytterby, in Sweden', 67: 'Stockholm (Holmia)', 68: 'Ytterby, in Sweden', 69: 'Thule, the far north',
  70: 'Ytterby, in Sweden', 71: 'Paris (Lutetia)', 72: 'Copenhagen (Hafnia)', 75: 'the Rhine', 84: 'Poland',
  87: 'France', 95: 'the Americas', 97: 'Berkeley, California', 98: 'California', 105: 'Dubna, in Russia',
  108: 'Hesse, in Germany', 110: 'Darmstadt, in Germany', 113: 'Japan (Nihon)', 115: 'Moscow', 117: 'Tennessee',
};

/** In every living thing: the six elements all life is built from. */
const LIFE = [1, 6, 7, 8, 15, 16];
/** Elements no living thing needs. */
const NOT_LIFE = [2, 10, 18, 36, 54, 86, 79, 78, 82, 80, 92, 94, 88, 22, 13, 3, 47];

const ROOM = 293.15;
const METALS = new Set(['Alkali metals', 'Alkaline earth metals', 'Transition metals', 'Poor metals', 'Lanthanides', 'Actinides']);
const SERIES_ONE: Record<string, string> = {
  'Alkali metals': 'alkali metal', 'Alkaline earth metals': 'alkaline earth metal', 'Transition metals': 'transition metal',
  'Poor metals': 'post-transition metal', Metalloids: 'metalloid', Nonmetals: 'nonmetal', Halogens: 'halogen',
  'Noble gases': 'noble gas', Lanthanides: 'lanthanide', Actinides: 'actinide',
};
const kindOf = (e: Element): string => SERIES_ONE[e.series] ?? e.series.toLowerCase();
const aKind = (e: Element): string => `${/^[aeiou]/.test(kindOf(e)) ? 'an' : 'a'} ${kindOf(e)}`;
const Kind = (e: Element): string => kindOf(e).replace(/^./, (c) => c.toUpperCase());
const ratio = (a: number, b: number) => Math.max(a, b) / Math.min(a, b);

type Phase = 'Solid' | 'Liquid' | 'Gas';
/** An atom's state at room temperature, or null when it is near a change or unknown. */
function phaseOf(e: Element): Phase | null {
  if (e.melt === null || e.boil === null) return null;
  if (e.melt > ROOM + 15) return 'Solid';
  if (e.boil < ROOM - 15) return 'Gas';
  if (e.melt < ROOM - 15 && e.boil > ROOM + 15) return 'Liquid';
  return null;
}

type Pick = <T>(xs: readonly T[]) => T;
type Make = (pick: Pick, rnd: () => number) => QuizQuestion | null;

/** Two atoms compared on a value, the answer the higher or the lower one. */
function compare(type: QuizType, pick: Pick, rnd: () => number, value: (e: Element) => number | null, minRatio: number,
  ask: [string, string], show: (v: number) => string, pool: readonly number[] = FAMILIAR): QuizQuestion | null {
  const a = pick(pool), b = pick(pool);
  const va = value(elementAt(a)), vb = value(elementAt(b));
  if (a === b || va === null || vb === null || ratio(va, vb) < minRatio) return null;
  const high = rnd() < 0.5;
  const answer = (va > vb) === high ? 0 : 1;
  return { type, text: high ? ask[0] : ask[1], options: [{ z: a }, { z: b }], answer, after: [show(va), show(vb)] };
}

/** The one atom that is something among others that aren't: two cards, or four. */
function oneOf(type: QuizType, pick: Pick, yes: number[], no: number[], n: number, text: string, show: (e: Element) => string, note?: string): QuizQuestion | null {
  if (!yes.length || no.length < n - 1) return null;
  const zs = [pick(yes)];
  for (let tries = 0; zs.length < n && tries < 100; tries++) { const o = pick(no); if (!zs.includes(o)) zs.push(o); }
  if (zs.length < n) return null;
  const y = zs[0];
  zs.sort((a, b) => a - b);
  // Two cards keep a random order; four sit in order of atomic number like the atom of the day.
  if (n === 2 && pick([true, false])) zs.reverse();
  return { type, text, options: zs.map((z) => ({ z })), answer: zs.indexOf(y), after: zs.map((z) => show(elementAt(z))), ...(note ? { note } : {}) };
}

const familiar = (is: (e: Element) => boolean) => FAMILIAR.filter((z) => is(elementAt(z)));
const foundIn = (e: Element) => (e.discoveryYear ? `Found in ${e.discoveryYear}` : 'Ancient');

const MAKE: Record<QuizType, Make> = {
  melt: (pick, rnd) => compare('melt', pick, rnd, (e) => e.melt, 1.3, ['Which has the higher melting point?', 'Which has the lower melting point?'], celsius),
  boil: (pick, rnd) => compare('boil', pick, rnd, (e) => e.boil, 1.3, ['Which has the higher boiling point?', 'Which has the lower boiling point?'], celsius),
  // Gases left out: their densities are tiny numbers that make the answer obvious.
  dense: (pick, rnd) => compare('dense', pick, rnd, (e) => (phaseOf(e) === 'Gas' ? null : e.density), 1.5, ['Which is denser?', 'Which is less dense?'], density),
  first: (pick, rnd) => {
    const q = compare('first', pick, rnd, (e) => e.discoveryYear, 1, ['Which was discovered more recently?', 'Which was discovered first?'], String);
    if (!q) return null;
    const [a, b] = q.options.map((o) => elementAt((o as { z: number }).z).discoveryYear!);
    return Math.abs(a - b) >= 40 ? q : null;
  },
  crust: (pick, rnd) => compare('crust', pick, rnd, (e) => e.crust, 10, ['Which is more common in Earth\'s crust?', 'Which is rarer in Earth\'s crust?'], share,
    familiar((e) => e.crust !== null && e.crust > 0)),
  sea: (pick, rnd) => compare('sea', pick, rnd, (e) => e.sea, 10, ['Which is more common in seawater?', 'Which is rarer in seawater?'], share,
    familiar((e) => e.sea !== null && e.sea > 0)),
  radioactive: (pick) => oneOf('radioactive', pick, familiar((e) => e.stableIsotopes === 0), familiar((e) => e.stableIsotopes > 0), 2, 'Which is radioactive?',
    (e) => (e.stableIsotopes === 0 ? 'No stable isotopes' : `${e.stableIsotopes} stable isotope${e.stableIsotopes === 1 ? '' : 's'}`)),
  noble: (pick) => oneOf('noble', pick, familiar((e) => e.series === 'Noble gases'), familiar((e) => e.series !== 'Noble gases'), 2, 'Which is a noble gas?', Kind),
  // The place-named atom may be any of them; the other is a well-known atom named otherwise.
  place: (pick) => oneOf('place', pick, Object.keys(PLACE_NAMES).map(Number), FAMILIAR.filter((z) => !PLACE_NAMES[z]), 2, 'Which is named after a place?',
    (e) => (PLACE_NAMES[e.z] ? `Named after ${PLACE_NAMES[e.z]}` : '')),
  kind4: (pick) => {
    const series = pick(['Halogens', 'Alkali metals', 'Noble gases', 'Alkaline earth metals']);
    const one = elementAt(familiar((e) => e.series === series)[0]);
    return oneOf('kind4', pick, familiar((e) => e.series === series), familiar((e) => e.series !== series), 4, `Which of these is ${aKind(one)}?`, Kind);
  },
  liquid4: (pick) => oneOf('liquid4', pick, familiar((e) => phaseOf(e) === 'Liquid'), familiar((e) => phaseOf(e) === 'Solid' || phaseOf(e) === 'Gas'), 4,
    'Which of these is a liquid at room temperature?', (e) => phaseOf(e) ?? ''),
  first4: (pick) => {
    const q = oneOf('first4', pick, familiar((e) => e.discoveryYear !== null), familiar((e) => e.discoveryYear !== null), 4, 'Which of these was discovered first?', foundIn);
    if (!q) return null;
    const years = q.options.map((o) => elementAt((o as { z: number }).z).discoveryYear!);
    const first = Math.min(...years);
    // The earliest must stand clear of the rest, by 30 years.
    if (years.filter((y) => y < first + 30).length !== 1) return null;
    return { ...q, answer: years.indexOf(first) };
  },
  life4: (pick) => oneOf('life4', pick, LIFE, NOT_LIFE, 4, 'Which of these is in every living thing?', () => '',
    'Hydrogen, carbon, nitrogen, oxygen, phosphorus and sulfur are in every living thing.'),
  phase: (pick) => {
    // Most atoms are solids: pick the answer's state first, so gases and liquids come up too.
    const p = pick(['Solid', 'Solid', 'Gas', 'Gas', 'Liquid'] as Phase[]);
    const e = elementAt(pick(familiar((x) => phaseOf(x) === p)));
    const other = pick((['Solid', 'Liquid', 'Gas'] as Phase[]).filter((x) => x !== p));
    const both = (['Solid', 'Liquid', 'Gas'] as Phase[]).filter((x) => x === p || x === other);
    return {
      type: 'phase', text: `What is ${e.name.toLowerCase()} at room temperature?`,
      options: [{ text: both[0] }, { text: both[1] }], answer: both[0] === p ? 0 : 1, after: ['', ''], about: e.z,
      note: `${e.name} melts at ${celsius(e.melt!)} and boils at ${celsius(e.boil!)}.`,
    };
  },
  stateTrue: (pick, rnd) => {
    const p = pick(['Solid', 'Gas', 'Gas', 'Liquid', 'Liquid'] as Phase[]);
    const e = elementAt(pick(familiar((x) => phaseOf(x) === p)));
    // Half the time the statement is true; otherwise it names another state.
    const said = rnd() < 0.5 ? p : pick((['Solid', 'Liquid', 'Gas'] as Phase[]).filter((x) => x !== p));
    return {
      type: 'stateTrue', text: `True or false: ${e.name} is a ${said.toLowerCase()} at room temperature.`,
      options: [{ text: 'True' }, { text: 'False' }], answer: said === p ? 0 : 1, after: ['', ''], about: e.z,
      note: `${e.name} is a ${p.toLowerCase()}: it melts at ${celsius(e.melt!)} and boils at ${celsius(e.boil!)}.`,
    };
  },
  year: (pick, rnd) => {
    const e = elementAt(pick(FAMILIAR));
    const y = e.discoveryYear;
    if (y === null) return null;
    const off = (40 + Math.floor(rnd() * 80)) * (rnd() < 0.5 ? -1 : 1);
    const d = y + off > 2010 || y + off < 1600 ? y - off : y + off;
    if (d > 2010 || d < 1600) return null;
    const [a, b] = [y, d].sort((p, q) => p - q);
    return {
      type: 'year', text: `When was ${e.name.toLowerCase()} discovered?`,
      options: [{ text: String(a) }, { text: String(b) }], answer: a === y ? 0 : 1, after: ['', ''], about: e.z,
      note: foundNote(e),
    };
  },
  era: (pick) => {
    const e = elementAt(pick(FAMILIAR));
    const y = e.discoveryYear;
    if (y === null) return null;
    // A round year 20 to 100 years from the real one.
    const line = pick([1700, 1750, 1800, 1850, 1900, 1950].filter((t) => Math.abs(t - y) >= 20 && Math.abs(t - y) <= 100));
    if (!line) return null;
    return {
      type: 'era', text: `Was ${e.name.toLowerCase()} discovered before or after ${line}?`,
      options: [{ text: `Before ${line}` }, { text: `After ${line}` }], answer: y < line ? 0 : 1, after: ['', ''], about: e.z,
      note: foundNote(e),
    };
  },
  metal: (pick) => {
    const e = elementAt(pick(FAMILIAR));
    if (e.series === 'Metalloids') return null;
    return {
      type: 'metal', text: `Is ${e.name.toLowerCase()} a metal?`,
      options: [{ text: 'Yes' }, { text: 'No' }], answer: METALS.has(e.series) ? 0 : 1, after: ['', ''], about: e.z,
      note: `${e.name} is ${aKind(e)}.`,
    };
  },
};

function foundNote(e: Element): string {
  const who = e.discoverers ?? '';
  return `${e.name} was found in ${e.discoveryYear}${who && !/ancient/i.test(who) ? ` by ${people(who)}` : ''}.`;
}

/** The atoms a question names. */
export const atomsOf = (q: QuizQuestion): number[] => [...q.options.flatMap((o) => ('z' in o ? [o.z] : [])), ...(q.about ? [q.about] : [])];

/** Today's questions: each about something different, at most one with four cards, no atom twice. */
export function quizOf(index: number, count = 3): QuizQuestion[] {
  const rnd = seeded(index * 3 + 1);
  const pick: Pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const out: QuizQuestion[] = [];
  const used = new Set<number>();
  for (let tries = 0; out.length < count && tries < 2000; tries++) {
    const type = pick(QUIZ_TYPES);
    if (out.some((q) => TOPIC[q.type] === TOPIC[type])) continue;
    if (type.endsWith('4') && out.some((q) => q.type.endsWith('4'))) continue;
    const q = MAKE[type](pick, rnd);
    if (!q) continue;
    const zs = atomsOf(q);
    if (zs.some((z) => used.has(z))) continue;
    zs.forEach((z) => used.add(z));
    out.push(q);
  }
  return out;
}

// ---------- today's answers ----------

export interface DayState {
  day: string;
  /** Wrong guesses at the atom of the day, the clues shown (1 to 3), and whether it is over. */
  guess: { wrong: number[]; clues: number; done: boolean };
  /** Nu's questions answered so far: right or wrong, in order. */
  quiz: boolean[];
  /** Days in a row with the quiz finished, and the last such day. */
  streak: number;
  streakDay: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Today's state: yesterday's answers are dropped, the streak kept. */
export function readDay(day = today().key): DayState {
  let v: unknown = null;
  try { v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* storage off: a fresh day */ }
  const r = isRecord(v) ? v : {};
  const streak = typeof r.streak === 'number' && r.streak > 0 ? Math.floor(r.streak) : 0;
  const streakDay = typeof r.streakDay === 'string' ? r.streakDay : '';
  if (r.day !== day) return { day, guess: { wrong: [], clues: 1, done: false }, quiz: [], streak, streakDay };
  const g = isRecord(r.guess) ? r.guess : {};
  return {
    day,
    guess: {
      wrong: Array.isArray(g.wrong) ? g.wrong.filter((z): z is number => typeof z === 'number') : [],
      clues: typeof g.clues === 'number' ? Math.max(1, Math.min(3, g.clues)) : 1,
      done: g.done === true,
    },
    quiz: Array.isArray(r.quiz) ? r.quiz.filter((x): x is boolean => typeof x === 'boolean') : [],
    streak,
    streakDay,
  };
}

export function writeDay(s: DayState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage off: today's answers are lost on leaving */ }
}

/** The day before `day` ("2026-10-13" for "2026-10-14"). */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return today(new Date(y, m - 1, d - 1)).key;
}

/** The streak to show: it lapses once a whole day passes without the quiz. */
export function liveStreak(s: DayState): number {
  return s.streakDay === s.day || s.streakDay === dayBefore(s.day) ? s.streak : 0;
}

/** Counts the quiz finished today (once): the streak grows from yesterday's, or starts at 1. */
export function finishQuiz(s: DayState): DayState {
  if (s.streakDay === s.day) return s;
  const streak = s.streakDay === dayBefore(s.day) ? s.streak + 1 : 1;
  return { ...s, streak, streakDay: s.day };
}
