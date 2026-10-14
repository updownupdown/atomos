import { describe, expect, it } from 'vitest';
import { FAMILIAR, PLACE_NAMES, QUIZ_TYPES, atomOfDay, atomsOf, candidates, cluePool, clues, dayBefore, finishQuiz, liveStreak, masked, quizOf, today, type DayState } from '../src/home/daily';
import { MAX_Z, elementAt } from '../src/gallery/data';

describe('the atom of the day', () => {
  it('visits every atom once in 118 days', () => {
    const seen = new Set(Array.from({ length: MAX_Z }, (_, i) => atomOfDay(20000 + i)));
    expect(seen.size).toBe(MAX_Z);
  });

  it('offers four atom cards of different kinds, the answer among them', () => {
    for (let d = 0; d < 300; d++) {
      const z = atomOfDay(d);
      const c = candidates(z, d);
      expect(c).toContain(z);
      expect(new Set(c).size).toBe(4);
      expect(new Set(c.map((o) => elementAt(o).series)).size).toBe(4);
      expect([...c].sort((a, b) => a - b)).toEqual(c);
    }
  });

  it('never names the atom in its clues', () => {
    for (let z = 1; z <= MAX_Z; z++) {
      const e = elementAt(z);
      expect(clues(z, z)).toHaveLength(3);
      for (const c of cluePool(z).flat()) expect(c.toLowerCase()).not.toMatch(new RegExp(e.name.length >= 5 ? e.name.toLowerCase() : `\\b${e.name.toLowerCase()}\\b`));
    }
  });

  it('varies the clues from day to day', () => {
    const sets = new Set(Array.from({ length: 20 }, (_, d) => clues(26, d).join('|')));
    expect(sets.size).toBeGreaterThan(5);
  });

  it('blanks the symbol where it is written as one', () => {
    expect(masked("Its symbol, Ag, comes from the Latin 'argentum'.", elementAt(47))).toBe("Its symbol, __, comes from the Latin 'argentum'.");
    expect(masked('Its symbol, W, comes from wolfram.', elementAt(74))).toBe('Its symbol, __, comes from wolfram.');
  });
});

describe("Nu's question", () => {
  it('deals three questions about different things every day, on well-known atoms', () => {
    for (let d = 0; d < 400; d++) {
      const qs = quizOf(d);
      expect(qs).toHaveLength(3);
      expect(new Set(qs.map((q) => q.type)).size).toBe(3);
      expect(qs.filter((q) => q.type.endsWith('4')).length).toBeLessThanOrEqual(1);
      const zs = qs.flatMap(atomsOf);
      expect(new Set(zs).size).toBe(zs.length);
      for (const q of qs) {
        expect(q.options).toHaveLength(q.type.endsWith('4') ? 4 : 2);
        expect(new Set(q.options.map((o) => JSON.stringify(o))).size).toBe(q.options.length);
        expect(atomsOf(q).every((z) => FAMILIAR.includes(z) || (q.type === 'place' && PLACE_NAMES[z]))).toBe(true);
      }
    }
  });

  it('marks the right answer', () => {
    const seen = new Set<string>();
    for (let d = 0; d < 1500; d++) {
      for (const q of quizOf(d)) {
        seen.add(q.type);
        const cards = q.options.map((o) => ('z' in o ? elementAt(o.z) : null));
        const pick = cards[q.answer], other = cards[1 - q.answer], rest = cards.filter((_, i) => i !== q.answer);
        const text = 'text' in q.options[q.answer] ? (q.options[q.answer] as { text: string }).text : '';
        const about = q.about ? elementAt(q.about) : null;
        switch (q.type) {
          case 'melt': expect(pick!.melt! > other!.melt!).toBe(q.text.includes('higher')); break;
          case 'boil': expect(pick!.boil! > other!.boil!).toBe(q.text.includes('higher')); break;
          case 'dense': expect(pick!.density! > other!.density!).toBe(q.text === 'Which is denser?'); break;
          case 'first': expect(pick!.discoveryYear! < other!.discoveryYear!).toBe(q.text.includes('first')); break;
          case 'radioactive': expect([pick!.stableIsotopes, other!.stableIsotopes > 0]).toEqual([0, true]); break;
          case 'noble': expect([pick!.series, other!.series === 'Noble gases']).toEqual(['Noble gases', false]); break;
          case 'year': expect(Number(text)).toBe(about!.discoveryYear); break;
          case 'phase': expect(text).toBe(about!.melt! > 293 ? 'Solid' : about!.boil! < 293 ? 'Gas' : 'Liquid'); break;
          case 'crust': expect(pick!.crust! > other!.crust!).toBe(q.text.includes('more common')); break;
          case 'sea': expect(pick!.sea! > other!.sea!).toBe(q.text.includes('more common')); break;
          case 'place': expect([Boolean(PLACE_NAMES[pick!.z]), Boolean(PLACE_NAMES[other!.z])]).toEqual([true, false]); break;
          case 'stateTrue': expect(text === 'True').toBe(q.text.includes(`a ${(about!.melt! > 293 ? 'solid' : about!.boil! < 293 ? 'gas' : 'liquid')} at`)); break;
          case 'era': { const line = Number(/(\d{4})\?$/.exec(q.text)![1]); expect(text.startsWith('Before')).toBe(about!.discoveryYear! < line); break; }
          case 'kind4': expect(rest.every((e) => e!.series !== pick!.series)).toBe(true); break;
          case 'liquid4': expect([pick!.z === 35 || pick!.z === 80, rest.some((e) => e!.z === 35 || e!.z === 80)]).toEqual([true, false]); break;
          case 'first4': expect(rest.every((e) => e!.discoveryYear! >= pick!.discoveryYear! + 30)).toBe(true); break;
          case 'life4': expect([[1, 6, 7, 8, 15, 16].includes(pick!.z), rest.some((e) => [1, 6, 7, 8, 15, 16].includes(e!.z))]).toEqual([true, false]); break;
          case 'metal': expect(text === 'Yes').toBe(['Alkali metals', 'Alkaline earth metals', 'Transition metals', 'Poor metals', 'Lanthanides', 'Actinides'].includes(about!.series)); break;
        }
      }
    }
    expect([...seen].sort()).toEqual([...QUIZ_TYPES].sort());
  });

  it('is the same on every device on a given day', () => {
    expect(quizOf(20375)).toEqual(quizOf(20375));
  });

  it('counts a streak of days in a row', () => {
    const day = '2026-10-14';
    expect(dayBefore(day)).toBe('2026-10-13');
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    const base: DayState = { day, guess: { wrong: [], clues: 1, done: false }, quiz: [true, true, false], streak: 5, streakDay: '2026-10-13' };
    const done = finishQuiz(base);
    expect(done.streak).toBe(6);
    expect(finishQuiz(done).streak).toBe(6);
    expect(finishQuiz({ ...base, streakDay: '2026-10-10' }).streak).toBe(1);
    expect(liveStreak({ ...base, streakDay: '2026-10-11' })).toBe(0);
    expect(liveStreak(base)).toBe(5);
  });

  it('names days by the local date', () => {
    expect(today(new Date(2026, 9, 14, 23, 30)).key).toBe('2026-10-14');
  });
});
