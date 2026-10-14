// Home's two daily games, both drawn from facts the app already holds (elements.json and
// element-facts.json), the same for every player on a given day:
//   - the atom of the day, to find among four atom cards with up to three clues;
//   - Nu's questions, three a day with two choices each, with a streak.
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

/** A small seeded generator, so a day deals the same quiz on every device. */
function seeded(seed: number): () => number {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
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

/** A sentence with the atom's name (and its symbol, where it is written as one) blanked out. */
export function masked(text: string, e: Element): string {
  // Longer names hide inside other words too ("kupfernickel"); short ones only as words, so
  // "tin" leaves "distinct" alone.
  const b = e.name.length >= 5 ? '' : '\\b';
  let t = text.replace(new RegExp(`${b}${esc(e.name)}${b}`, 'gi'), '______');
  t = e.symbol.length > 1
    ? t.replace(new RegExp(`\\b${esc(e.symbol)}\\b`, 'g'), '__')
    : t.replace(new RegExp(`([,(] ?)${esc(e.symbol)}(?=[,)])`, 'g'), '$1__');
  return t;
}

const num = (n: number) => Math.round(n).toLocaleString('en-US');
const celsius = (k: number) => `${num(k - 273.15).replace(/^-/, '−')} °C`;

/** The three clues, hardest first: when it was found, a property, then its headline fact. */
export function clues(z: number): string[] {
  const e = elementAt(z);
  const who = e.discoverers?.trim() ?? '';
  const found = e.discoveryYear
    ? `Found in ${e.discoveryYear}${who && !/ancient/i.test(who) ? ` by ${who.replace(/\.$/, '')}` : ''}.`
    : /ancient/i.test(who) ? 'Known since ancient times.' : 'No one knows who found it first.';
  const prop = e.melt !== null ? `Melts at ${celsius(e.melt)}`
    : e.boil !== null ? `Boils at ${celsius(e.boil)}`
    : e.weight !== null ? `Its atomic mass is ${e.weight.toFixed(1)}` : `It has ${e.z} protons`;
  const dens = e.density !== null && e.melt !== null ? `, and its density is ${density(e.density)}` : '';
  return [found, `${prop}${dens}.`, masked(headline(z), e)];
}

function density(d: number): string {
  return `${d >= 1 ? d.toFixed(d >= 10 ? 1 : 2) : Number(d.toPrecision(2))} g/cm³`;
}

/** The headline fact, unmasked, for the reveal. */
export function headlineOf(z: number): string {
  return headline(z);
}

// ---------- Nu's question ----------
// Three a day, each with two choices: two atom cards, or two words or years. Atoms in questions
// come from the ones most people have heard of, and compared values are far apart, so a
// question is about knowing atoms rather than recalling a number.

export type QuizType = 'melt' | 'boil' | 'dense' | 'first' | 'radioactive' | 'noble' | 'phase' | 'year' | 'metal';
export const QUIZ_TYPES: QuizType[] = ['melt', 'boil', 'dense', 'first', 'radioactive', 'noble', 'phase', 'year', 'metal'];

/** A choice: an atom's card, or a word or a year on a button. */
export type QuizOption = { z: number } | { text: string };

export interface QuizQuestion {
  type: QuizType;
  text: string;
  options: [QuizOption, QuizOption];
  answer: 0 | 1;
  /** What each card shows once answered ("1,538 °C"); '' for none. */
  after: [string, string];
  /** For a question about one atom: the atom, and a line shown once answered. */
  about?: number;
  note?: string;
}

/** Atoms most people have heard of. */
export const FAMILIAR = [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 27, 28, 29, 30, 35, 36, 47, 50, 53, 54, 74, 78, 79, 80, 82, 86, 88, 92, 94];

const ROOM = 293.15;
const METALS = new Set(['Alkali metals', 'Alkaline earth metals', 'Transition metals', 'Poor metals', 'Lanthanides', 'Actinides']);
const SERIES_ONE: Record<string, string> = {
  'Alkali metals': 'alkali metal', 'Alkaline earth metals': 'alkaline earth metal', 'Transition metals': 'transition metal',
  'Poor metals': 'post-transition metal', Metalloids: 'metalloid', Nonmetals: 'nonmetal', Halogens: 'halogen',
  'Noble gases': 'noble gas', Lanthanides: 'lanthanide', Actinides: 'actinide',
};
const kindOf = (e: Element): string => SERIES_ONE[e.series] ?? e.series.toLowerCase();
const aKind = (e: Element): string => `${/^[aeiou]/.test(kindOf(e)) ? 'an' : 'a'} ${kindOf(e)}`;
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

/** Two atoms compared on a value, the answer the higher or the lower one. */
function compare(type: QuizType, pick: Pick, rnd: () => number, value: (e: Element) => number | null, minRatio: number,
  ask: [string, string], show: (v: number) => string): QuizQuestion | null {
  const a = pick(FAMILIAR), b = pick(FAMILIAR);
  const va = value(elementAt(a)), vb = value(elementAt(b));
  if (a === b || va === null || vb === null || ratio(va, vb) < minRatio) return null;
  const high = rnd() < 0.5;
  const answer: 0 | 1 = (va > vb) === high ? 0 : 1;
  return { type, text: high ? ask[0] : ask[1], options: [{ z: a }, { z: b }], answer, after: [show(va), show(vb)] };
}

/** One atom that is something, one that isn't, in a random order. */
function oneOf(type: QuizType, pick: Pick, rnd: () => number, is: (e: Element) => boolean, text: string, show: (e: Element) => string): QuizQuestion | null {
  const yes = FAMILIAR.filter((z) => is(elementAt(z))), no = FAMILIAR.filter((z) => !is(elementAt(z)));
  if (!yes.length || !no.length) return null;
  const y = pick(yes), n = pick(no);
  const first = rnd() < 0.5;
  const [a, b] = first ? [y, n] : [n, y];
  return { type, text, options: [{ z: a }, { z: b }], answer: first ? 0 : 1, after: [show(elementAt(a)), show(elementAt(b))] };
}

const MAKE: Record<QuizType, (pick: Pick, rnd: () => number) => QuizQuestion | null> = {
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
  radioactive: (pick, rnd) => oneOf('radioactive', pick, rnd, (e) => e.stableIsotopes === 0, 'Which is radioactive?',
    (e) => (e.stableIsotopes === 0 ? 'No stable isotopes' : `${e.stableIsotopes} stable isotope${e.stableIsotopes === 1 ? '' : 's'}`)),
  noble: (pick, rnd) => oneOf('noble', pick, rnd, (e) => e.series === 'Noble gases', 'Which is a noble gas?', (e) => kindOf(e).replace(/^./, (c) => c.toUpperCase())),
  phase: (pick) => {
    // Most atoms are solids: pick the answer's state first, so gases and liquids come up too.
    const p = pick(['Solid', 'Solid', 'Gas', 'Gas', 'Liquid'] as Phase[]);
    const e = elementAt(pick(FAMILIAR.filter((z) => phaseOf(elementAt(z)) === p)));
    const other = pick((['Solid', 'Liquid', 'Gas'] as Phase[]).filter((x) => x !== p));
    const both = (['Solid', 'Liquid', 'Gas'] as Phase[]).filter((x) => x === p || x === other);
    return {
      type: 'phase', text: `What is ${e.name.toLowerCase()} at room temperature?`,
      options: [{ text: both[0] }, { text: both[1] }], answer: both[0] === p ? 0 : 1, after: ['', ''], about: e.z,
      note: `${e.name} melts at ${celsius(e.melt!)} and boils at ${celsius(e.boil!)}.`,
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
    const who = e.discoverers?.trim();
    return {
      type: 'year', text: `When was ${e.name.toLowerCase()} discovered?`,
      options: [{ text: String(a) }, { text: String(b) }], answer: a === y ? 0 : 1, after: ['', ''], about: e.z,
      note: `${e.name} was found in ${y}${who && !/ancient/i.test(who) ? ` by ${who.replace(/\.$/, '')}` : ''}.`,
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

/** The atoms a question names. */
export const atomsOf = (q: QuizQuestion): number[] => [...q.options.flatMap((o) => ('z' in o ? [o.z] : [])), ...(q.about ? [q.about] : [])];

/** Today's questions: each of a different kind, no atom twice. */
export function quizOf(index: number, count = 3): QuizQuestion[] {
  const rnd = seeded(index * 3 + 1);
  const pick: Pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const out: QuizQuestion[] = [];
  const used = new Set<number>();
  for (let tries = 0; out.length < count && tries < 1000; tries++) {
    const type = pick(QUIZ_TYPES);
    if (out.some((q) => q.type === type)) continue;
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
