import { describe, expect, it } from 'vitest';
import { differing, featuresFor, fewestTaps, flip, INTRO, newLight, reflect, sizeFor, solved, status, trace, turnable, type Cell, type LightState } from '../src/puzzles/light';
import { seeded } from '../src/puzzles/rng';

function grid(cells: Cell[], extra: Partial<LightState> = {}): LightState {
  return { size: Math.round(Math.sqrt(cells.length)), cells, entry: 0, entryDir: 'down', targets: [], darks: [], solution: [...cells], features: [], moves: 0, par: 1, ...extra };
}

describe('beam', () => {
  it('reflects off every slanted piece', () => {
    expect(reflect('/', 'right')).toBe('up');
    expect(reflect('/', 'down')).toBe('left');
    expect(reflect('\\', 'right')).toBe('down');
    expect(reflect('\\', 'up')).toBe('left');
    expect(reflect('F/', 'right')).toBe('up');
    expect(reflect('H\\', 'right')).toBe('down');
    expect(reflect('.', 'up')).toBe('up');
  });

  // . . .
  // / . #
  // . . .
  const g = grid(['.', '.', '.', '/', '.', '#', '.', '.', '.'], { targets: [{ cell: 4, hue: 'w' }], solution: ['.', '.', '.', '\\', '.', '#', '.', '.', '.'] });

  it('traces through mirrors and stops at blockers', () => {
    const b = trace(g);
    expect(b.visits.map((v) => v.cell)).toEqual([0, 3]);
    expect(b.visits[1].exits).toEqual(['left']);
    const f = flip(g, 3)!;
    const b2 = trace(f);
    expect(b2.visits.map((v) => v.cell)).toEqual([0, 3, 4, 5]);
    expect(b2.visits[3].stop).toBe('edge');
    expect(b2.lit.has(5)).toBe(false);
    expect(solved(g)).toBe(false);
    expect(solved(f)).toBe(true);
    expect(f.moves).toBe(1);
    expect(g.cells[3]).toBe('/');
  });

  it('only flips turnable pieces', () => {
    expect(flip(g, 0)).toBeNull();
    expect(flip(g, 5)).toBeNull();
    expect(flip(grid(['F/', '.', '.', '.']), 0)).toBeNull();
    expect(flip(grid(['Cs', '.', '.', '.']), 0)).toBeNull();
    expect(flip(grid(['H/', '.', '.', '.']), 0)!.cells[0]).toBe('H\\');
    expect(flip(flip(g, 3)!, 3)!.cells).toEqual(g.cells);
  });

  it('splits at a half-silvered pane: straight on and reflected', () => {
    // Beam down column 0; a splitter at (0,1) sends a copy right along row 1.
    const s = grid(['.', '.', '.', 'H\\', '.', '.', '.', '.', '.']);
    const b = trace(s);
    for (const i of [0, 3, 6, 4, 5]) expect(b.lit.has(i)).toBe(true);
    expect(b.lit.has(1)).toBe(false);
  });

  it('ends even when splitters make a loop', () => {
    // A ring of mirrors with a splitter: light would circle forever without the visited set.
    // H\ .  \
    //  .  .  .
    //  \  .  /
    const s = grid(['H\\', '.', '\\', '.', '.', '.', '\\', '.', '/'], { entry: 0, entryDir: 'right' });
    const b = trace(s);
    expect(b.visits.length).toBeLessThan(9 * 4 * 5);
    expect(b.lit.has(8)).toBe(true);
  });

  it('tints through a filter and absorbs the wrong color', () => {
    // Down column 0: white, then a blue filter, then a green filter that absorbs it.
    const s = grid(['.', '.', '.', 'Cs', '.', '.', 'Cp', '.', '.'], { targets: [{ cell: 4, hue: 's' }] });
    const b = trace(s);
    expect([...b.lit.get(0)!]).toEqual(['w']);
    expect([...b.lit.get(3)!]).toEqual(['w']);
    expect([...b.lit.get(6)!]).toEqual(['s']);
    expect(b.visits.find((v) => v.cell === 6)!.stop).toBe('center');
    // The same color passes.
    const pass = trace(grid(['.', '.', '.', 'Cs', '.', '.', 'Cs', '.', '.']));
    expect(pass.visits.find((v) => v.cell === 6)!.exits).toEqual(['down']);
  });

  it('needs colored rings lit in their color and dark sensors unlit', () => {
    // Row 0 rightward: white to (1,0), tinted blue from the filter on.
    const base = { entry: 0, entryDir: 'right' as const };
    const s = grid(['.', 'Cs', '.', '.', '.', '.', '.', '.', '.'], { ...base, targets: [{ cell: 2, hue: 's' }] });
    expect(status(s).won).toBe(true);
    const wrong = grid(['.', 'Cs', '.', '.', '.', '.', '.', '.', '.'], { ...base, targets: [{ cell: 2, hue: 'p' }] });
    expect(status(wrong).won).toBe(false);
    expect(status(wrong).wrongHue).toEqual([2]);
    const any = grid(['.', 'Cs', '.', '.', '.', '.', '.', '.', '.'], { ...base, targets: [{ cell: 2, hue: 'w' }] });
    expect(status(any).won).toBe(true);
    const dark = grid(['.', 'Cs', '.', '.', '.', '.', '.', '.', '.'], { ...base, targets: [{ cell: 2, hue: 'w' }], darks: [1] });
    expect(status(dark).darkLit).toEqual([1]);
    expect(status(dark).won).toBe(false);
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    expect(newLight(50, 4)).toEqual(newLight(50, 4));
    expect(newLight(50, 4)).not.toEqual(newLight(50, 5));
  });

  it('starts unsolved and is solved in exactly par taps, for every element', () => {
    for (let z = 1; z <= 118; z++) {
      for (let seed = 1; seed <= 4; seed++) {
        const level = newLight(z, seed * 17 + z);
        expect(solved(level)).toBe(false);
        expect(level.size).toBe(sizeFor(z));
        expect(level.targets.length).toBe(z < 50 ? 2 : 3);
        for (const t of level.targets) expect(level.cells[t.cell]).toBe('.');
        for (const d of level.darks) expect(level.cells[d]).toBe('.');
        const diff = differing(level);
        expect(diff.length).toBe(level.par);
        expect(level.par).toBeGreaterThanOrEqual(1);
        // Par is the true minimum.
        expect(fewestTaps(level, level.par)).toBe(level.par);
        let s = level;
        for (const i of diff) s = flip(s, i)!;
        expect(solved(s)).toBe(true);
        expect(s.moves).toBe(level.par);
        expect(s.cells).toEqual(level.solution);
        // Every planned piece kind is on the board.
        const has = (pred: (c: Cell) => boolean) => level.cells.some(pred);
        if (level.features.includes('fixed')) expect(has((c) => c[0] === 'F')).toBe(true);
        if (level.features.includes('splitters')) expect(has((c) => c[0] === 'H')).toBe(true);
        if (level.features.includes('filters')) {
          expect(has((c) => c[0] === 'C')).toBe(true);
          expect(level.targets.some((t) => t.hue !== 'w')).toBe(true);
        } else expect(level.targets.every((t) => t.hue === 'w')).toBe(true);
        expect(level.darks.length > 0).toBe(level.features.includes('darks'));
        expect(level.cells.filter(turnable).length).toBeGreaterThanOrEqual(level.par);
      }
    }
  });

  it('introduces pieces gradually', () => {
    const seen = (z: number) => { const out = new Set<string>(); for (let d = 0; d < 30; d++) featuresFor(z, seeded(d)).forEach((f) => out.add(f)); return out; };
    expect(seen(5).size).toBe(0);
    expect([...seen(INTRO.fixed)]).toEqual(['fixed']);
    expect(seen(INTRO.darks)).toContain('darks');
    expect(seen(INTRO.darks).has('splitters')).toBe(false);
    expect(seen(INTRO.splitters)).toContain('splitters');
    expect(seen(INTRO.splitters).has('filters')).toBe(false);
    expect(seen(INTRO.filters)).toContain('filters');
    expect(seen(110).size).toBe(4);
    for (let d = 0; d < 30; d++) {
      expect(featuresFor(INTRO.splitters + 3, seeded(d))).toContain('splitters');
      const late = featuresFor(100, seeded(d));
      expect(late.length).toBeGreaterThanOrEqual(2);
      expect(late.length).toBeLessThanOrEqual(3);
    }
  });

  it('builds fast', () => {
    for (let z = 1; z <= 118; z += 3) {
      const t0 = performance.now();
      newLight(z, 7);
      expect(performance.now() - t0).toBeLessThan(150);
    }
  });

  it('grows with the element', () => {
    expect(newLight(1, 2).size).toBe(5);
    expect(newLight(50, 2).size).toBe(6);
    expect(newLight(118, 2).size).toBe(7);
    expect(newLight(118, 2).par).toBeGreaterThanOrEqual(2);
  });
});
