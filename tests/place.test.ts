import { describe, expect, it } from 'vitest';
import { readPlace } from '../src/core/place';

describe('readPlace', () => {
  it('reopens a saved atom in its mode', () => {
    expect(readPlace(JSON.stringify({ screen: 'atom', mode: 'build', z: 26 }))).toEqual({ screen: 'atom', mode: 'build', z: 26 });
  });
  it('keeps other screens', () => {
    expect(readPlace(JSON.stringify({ screen: 'puzzles', mode: 'view', z: 3 })).screen).toBe('puzzles');
  });
  it('falls back to Collect when the place is missing or invalid', () => {
    const home = { screen: 'collect', mode: 'view', z: 1 };
    expect(readPlace(null)).toEqual(home);
    expect(readPlace('not json')).toEqual(home);
    expect(readPlace(JSON.stringify({ screen: 'lab' }))).toEqual(home);
    expect(readPlace(JSON.stringify({ screen: 'atom', z: 999 }))).toEqual(home);
  });
});
