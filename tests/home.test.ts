import { describe, expect, it } from 'vitest';
import { atomOfDay, candidates, clues, dayBefore, finishQuiz, liveStreak, masked, quizOf, today, valueText, type DayState } from '../src/home/daily';
import { ELEMENTS, MAX_Z, elementAt } from '../src/gallery/data';

describe('the atom of the day', () => {
  it('visits every atom once in 118 days', () => {
    const seen = new Set(Array.from({ length: MAX_Z }, (_, i) => atomOfDay(20000 + i)));
    expect(seen.size).toBe(MAX_Z);
  });

  it('outlines up to four atoms of its period, the answer among them', () => {
    for (let d = 0; d < 300; d++) {
      const z = atomOfDay(d);
      const c = candidates(z, d);
      expect(c).toContain(z);
      expect(c.length).toBe(Math.min(4, ELEMENTS.filter((e) => e.period === elementAt(z).period).length));
      expect(c.every((o) => elementAt(o).period === elementAt(z).period)).toBe(true);
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
  it('deals three fair questions every day', () => {
    for (let d = 0; d < 200; d++) {
      const qs = quizOf(d);
      expect(qs).toHaveLength(3);
      for (const q of qs) {
        expect(q.a).not.toBe(q.b);
        expect(valueText(q.prop, q.a)).not.toBe('unknown');
        expect(valueText(q.prop, q.b)).not.toBe('unknown');
      }
    }
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
