import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameWon, isUnlocked, nextForPeriod, nextMeeting, periodBuilt, unlockPuzzle, unlockZ } from '../src/core/unlocks';
import { defaultSave, type SaveData } from '../src/core/save';
import { recordWin } from '../src/core/wins';
import { stepsOf } from '../src/core/progress';
import { atomGame } from '../src/core/atomGames';

const store = new Map<string, string>();
beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => { store.clear(); delete (globalThis as { localStorage?: unknown }).localStorage; });

/** A save with atoms 1 to n built. */
function built(n: number): SaveData {
  const s = defaultSave();
  for (let z = 1; z <= n; z++) {
    s.built[z] = { flawless: true };
    s.steps[z] = Object.fromEntries(stepsOf(z).map((id) => [id, { flawless: true, best: 5 }]));
  }
  return s;
}

describe('earning the Atlas', () => {
  it('opens each shape once its whole period is built', () => {
    const save = built(9);
    expect(periodBuilt(1, save)).toBe(true);
    expect(isUnlocked('lens:ribbon', save)).toBe(false);
    expect(nextForPeriod(2, save)).toBe(10);
    const more = built(10);
    expect(isUnlocked('lens:ribbon', more)).toBe(true);
    expect(isUnlocked('lens:spiral', more)).toBe(false);
    expect(isUnlocked('lens:spiral', built(18))).toBe(true);
    expect(isUnlocked('lens:pyramid', built(117))).toBe(false);
    expect(isUnlocked('lens:pyramid', built(118))).toBe(true);
  });

  it('opens each color with the first win of its game, anywhere', () => {
    const save = defaultSave();
    expect(isUnlocked('look:density', save)).toBe(false);
    recordWin('packing', 10, false);
    expect(isUnlocked('look:density', save)).toBe(true);
    expect(isUnlocked('look:melt', save)).toBe(false);
    // Building helium's nucleus is a Tokamak win.
    expect(atomGame(2, 'nucleus')).toBe('merge');
    expect(gameWon('merge', built(2))).toBe(true);
    expect(isUnlocked('look:melt', built(2))).toBe(true);
    // A fleeting isotope built with Lumen.
    const lit = defaultSave();
    lit.isotopes['1-5'] = { collected: true, game: 'light', at: 1 };
    expect(isUnlocked('look:discovery', lit)).toBe(true);
  });

  it('moves the nucleus view to Aurum, and gives Glyph the time-lapse', () => {
    const save = defaultSave();
    expect(unlockPuzzle('nucleus-view')).toBe('rutherford');
    expect(isUnlocked('nucleus-view', save)).toBe(false);
    recordWin('rutherford', 20, true);
    expect(isUnlocked('nucleus-view', save)).toBe(true);
    expect(isUnlocked('look:size', save)).toBe(true);
    expect(unlockPuzzle('toy:timelapse')).toBe('codebreaker');
    expect(isUnlocked('toy:timelapse', save)).toBe(false);
  });

  it('keeps everything a save already opened, and everything with Settings', () => {
    const save = defaultSave();
    save.unlocks['lens:ribbon'] = { at: 1, z: 8 };
    save.unlocks['look:state'] = { at: 1, z: 104 };
    save.unlocks['nucleus-view'] = { at: 1, z: 40 };
    for (const id of ['lens:ribbon', 'look:state', 'nucleus-view'] as const) expect(isUnlocked(id, save)).toBe(true);
    expect(isUnlocked('lens:circle', save)).toBe(false);
    save.settings.unlockAll = true;
    expect(isUnlocked('lens:pyramid', save)).toBe(true);
    expect(isUnlocked('toy:timelapse', save)).toBe(true);
  });

  it('points a locked color at the next atom that plays its game', () => {
    expect(nextMeeting('orbitalGrid', defaultSave())).toBe(1);
    expect(nextMeeting('merge', defaultSave())).toBe(2);
  });
});

describe('gate puzzles', () => {
  it('deal Glyph a little harder for each Glyph unlock, and a replay the same board', () => {
    const save = defaultSave();
    expect(unlockZ('toy:timelapse', save)).toBe(105);
    save.unlocks['lens:ribbon'] = { at: 1, z: 105 };
    expect(unlockZ('lens:ribbon', save)).toBe(105);
    expect(unlockZ('toy:timelapse', save)).toBe(106);
    // Another game's unlock is no rung on Glyph's ladder.
    save.unlocks['look:density'] = { at: 1, z: 3 };
    expect(unlockZ('toy:timelapse', save)).toBe(106);
  });

  it('deal the other games their first atom\'s board, and a replay the same board', () => {
    const save = defaultSave();
    expect(unlockZ('look:density', save)).toBe(3);
    expect(unlockZ('nucleus-view', save)).toBe(5);
    save.unlocks['nucleus-view'] = { at: 1, z: 40 };
    expect(unlockZ('nucleus-view', save)).toBe(40);
    save.unlocks['lens:ribbon'] = { at: 1, z: 8 };
    expect(unlockZ('lens:ribbon', save)).toBe(104);
  });
});
