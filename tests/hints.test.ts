import { describe, expect, it } from 'vitest';
import { HintControl } from '../src/puzzles/hints';
import type { Help, PuzzleView } from '../src/puzzles/view';

/** A puzzle that only counts moves and records the help levels asked for. */
function fake(): PuzzleView & { asked: number[]; moves: number } {
  const v = {
    asked: [] as number[], moves: 0, won: false, stuck: false, par: 5, clean: true,
    draw() {}, down() {}, move() {}, up() {}, cancel() {}, key: () => false,
    undo: () => { v.moves = Math.max(0, v.moves - 1); return true; }, canUndo: () => v.moves > 0,
    restart: () => { v.moves = 0; }, hint: () => '',
    help(level: 1 | 2): Help {
      v.asked.push(level);
      if (level === 2) { v.moves++; return { text: 'Placed it.', moved: true }; }
      return { text: 'Look at this cell.' };
    },
  };
  return v;
}

function button() {
  const on = new Set<string>();
  return { classList: { add: (c: string) => on.add(c), toggle: (c: string, f: boolean) => (f ? on.add(c) : on.delete(c)), contains: (c: string) => on.has(c) } } as unknown as HTMLButtonElement;
}

describe('the Hint button', () => {
  it('looks first, then shows on the same board, then looks again', () => {
    const p = fake();
    const h = new HintControl(() => p, () => {}, button());
    h.ask();
    expect(h.line(p)).toBe('Look at this cell.');
    h.ask();
    expect(p.asked).toEqual([1, 2]);
    expect(h.line(p)).toBe('Placed it.');
    h.ask();
    expect(p.asked).toEqual([1, 2, 1]);
  });

  it('starts over at Look here once the player moves', () => {
    const p = fake();
    const h = new HintControl(() => p, () => {}, button());
    h.ask();
    p.moves++;
    expect(h.line(p)).toBeNull();
    h.ask();
    expect(p.asked).toEqual([1, 1]);
  });

  it('marks a run that used Show me, until it is restarted', () => {
    const p = fake();
    const h = new HintControl(() => p, () => {}, button());
    h.ask();
    expect(h.used(p)).toBe(false);
    h.ask();
    expect(h.used(p)).toBe(true);
    p.restart();
    h.restarted(p);
    expect(h.used(p)).toBe(false);
  });

  it('nudges after 45 seconds without progress, three undos in a row or a second restart', () => {
    const p = fake();
    const b = button();
    const h = new HintControl(() => p, () => {}, b);
    const nudged = () => (b.classList as unknown as { contains(c: string): boolean }).contains('is-nudge');
    h.watch(p, 0);
    h.watch(p, 44_000);
    expect(nudged()).toBe(false);
    h.watch(p, 46_000);
    expect(nudged()).toBe(true);
    p.moves++;
    h.watch(p, 47_000);
    expect(nudged()).toBe(false);
    h.undone(); h.undone();
    expect(nudged()).toBe(false);
    h.undone();
    expect(nudged()).toBe(true);
    h.ask();
    expect(nudged()).toBe(false);
    h.restarted(p);
    expect(nudged()).toBe(false);
    h.restarted(p);
    expect(nudged()).toBe(true);
  });
});
