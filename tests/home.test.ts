import { describe, expect, it } from 'vitest';
import { FAMILIAR, QUIZ_TYPES, atomOfDay, atomsOf, candidates, clues, dayBefore, finishQuiz, liveStreak, masked, quizOf, today, type DayState } from '../src/home/daily';
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
      const all = clues(z);
      expect(all).toHaveLength(3);
      for (const c of all) expect(c.toLowerCase()).not.toMatch(new RegExp(e.name.length >= 5 ? e.name.toLowerCase() : `\\b${e.name.toLowerCase()}\\b`));
    }
  });

  it('blanks the symbol where it is written as one', () => {
    expect(masked("Its symbol, Ag, comes from the Latin 'argentum'.", elementAt(47))).toBe("Its symbol, __, comes from the Latin 'argentum'.");
    expect(masked('Its symbol, W, comes from wolfram.', elementAt(74))).toBe('Its symbol, __, comes from wolfram.');
  });
});

describe("Nu's question", () => {
  it('deals three two-choice questions of different kinds every day, on well-known atoms', () => {
    for (let d = 0; d < 400; d++) {
      const qs = quizOf(d);
      expect(qs).toHaveLength(3);
      expect(new Set(qs.map((q) => q.type)).size).toBe(3);
      const zs = qs.flatMap(atomsOf);
      expect(new Set(zs).size).toBe(zs.length);
      for (const q of qs) {
        expect(q.options).toHaveLength(2);
        expect(JSON.stringify(q.options[0])).not.toBe(JSON.stringify(q.options[1]));
        expect(atomsOf(q).every((z) => FAMILIAR.includes(z))).toBe(true);
      }
    }
  });

  it('marks the right answer', () => {
    const seen = new Set<string>();
    for (let d = 0; d < 400; d++) {
      for (const q of quizOf(d)) {
        seen.add(q.type);
        const [a, b] = q.options.map((o) => ('z' in o ? elementAt(o.z) : null));
        const pick = q.answer === 0 ? a : b, other = q.answer === 0 ? b : a;
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
