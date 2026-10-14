// Home's two daily games, both drawn from facts the app already holds (elements.json and
// element-facts.json), the same for every player on a given day:
//   - the atom of the day, to guess on the table: three clues, four outlined atoms;
//   - Nu's question, a short higher-or-lower quiz on two atoms' properties, with a streak.
// What the player has answered today sits under its own storage key, apart from the save; the
// backup carries it with every other atomos.* key.

import FACTS from '../data/element-facts.json';
import { ELEMENTS, MAX_Z, elementAt, type Element } from '../gallery/data';

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

/** The atoms outlined on the table: up to four neighbors in the answer's period, the answer
 *  among them at a place that changes from day to day. */
export function candidates(z: number, index: number): number[] {
  const p = elementAt(z).period;
  const row = ELEMENTS.filter((e) => e.period === p).map((e) => e.z);
  const n = Math.min(4, row.length);
  const at = row.indexOf(z);
  const shift = Math.floor(seeded(index + 7)() * n);
  const start = Math.max(0, Math.min(row.length - n, at - shift));
  return row.slice(start, start + n);
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
const celsius = (k: number) => `${num(k - 273.15)} °C`;

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

export type QuizProp = 'melt' | 'boil' | 'density' | 'year';

export interface QuizQuestion {
  prop: QuizProp;
  /** The atom whose value is shown. */
  a: number;
  /** The atom to judge against it. */
  b: number;
  /** Whether b's value is the higher one (for a year: the later). */
  higher: boolean;
}

const VALUE: Record<QuizProp, (e: Element) => number | null> = {
  melt: (e) => e.melt,
  boil: (e) => e.boil,
  density: (e) => e.density,
  year: (e) => e.discoveryYear,
};

/** What the question asks, e.g. "Does tungsten melt hotter or colder than iron?". */
export function questionText(q: QuizQuestion): string {
  const b = elementAt(q.b).name.toLowerCase(), a = elementAt(q.a).name.toLowerCase();
  switch (q.prop) {
    case 'melt': return `Does ${b} melt hotter or colder than ${a}?`;
    case 'boil': return `Does ${b} boil hotter or colder than ${a}?`;
    case 'density': return `Is ${b} denser or lighter than ${a}?`;
    case 'year': return `Was ${b} found earlier or later than ${a}?`;
  }
}

/** The two answers, the higher one first. */
export function answerWords(prop: QuizProp): [string, string] {
  return prop === 'melt' || prop === 'boil' ? ['Hotter', 'Colder'] : prop === 'density' ? ['Denser', 'Lighter'] : ['Later', 'Earlier'];
}

/** An atom's value as the quiz shows it: "1,538 °C", "7.87 g/cm³", "1803". */
export function valueText(prop: QuizProp, z: number): string {
  const v = VALUE[prop](elementAt(z));
  if (v === null) return 'unknown';
  if (prop === 'melt' || prop === 'boil') return celsius(v);
  if (prop === 'density') return density(v);
  return String(v);
}

/** Today's three questions: each a pair of atoms with the value known for both, far enough
 *  apart to be fair (a tenth apart, or 20 years). */
export function quizOf(index: number, count = 3): QuizQuestion[] {
  const rnd = seeded(index * 3 + 1);
  const props: QuizProp[] = ['melt', 'density', 'year', 'boil'];
  const out: QuizQuestion[] = [];
  const used = new Set<number>();
  for (let tries = 0; out.length < count && tries < 500; tries++) {
    const prop = props[(out.length + Math.floor(rnd() * props.length)) % props.length];
    const a = 1 + Math.floor(rnd() * MAX_Z), b = 1 + Math.floor(rnd() * MAX_Z);
    if (a === b || used.has(a) || used.has(b)) continue;
    const va = VALUE[prop](elementAt(a)), vb = VALUE[prop](elementAt(b));
    if (va === null || vb === null) continue;
    const apart = prop === 'year' ? Math.abs(va - vb) >= 20 : Math.abs(va - vb) >= 0.1 * Math.max(Math.abs(va), Math.abs(vb));
    if (!apart) continue;
    used.add(a); used.add(b);
    out.push({ prop, a, b, higher: vb > va });
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
