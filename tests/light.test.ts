import { describe, expect, it } from 'vitest';
import { cfgFor, left, lift, newLight, place, reflect, solved, status, tap, trace, turn, type Cell, type LightState } from '../src/puzzles/light';
import { seeded } from '../src/puzzles/rng';
import { generate, solve, type Cfg, type NBoard } from '../src/puzzles/lightSolver';
import { INSTRUCTIONS, LightView, RULES } from '../src/puzzles/lightView';
import { C } from '../src/puzzles/palette';
import type { Illustration, RuleCard } from '../src/puzzles/view';

function grid(cells: Cell[], extra: Partial<LightState> = {}): LightState {
  return { size: Math.round(Math.sqrt(cells.length)), cells, entry: 0, entryDir: 'down', targets: [], darks: [], solution: [...cells], tray: { mirrors: 1, splitters: 0 }, features: [], moves: 0, par: 1, ...extra };
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
  // . . #
  // . . .
  const g = grid(['.', '.', '.', '.', '.', '#', '.', '.', '.'], { targets: [{ cell: 4, hue: 'w' }] });

  it('traces through placed mirrors and stops at blockers', () => {
    const b = trace(g);
    expect(b.visits.map((v) => v.cell)).toEqual([0, 3, 6]);
    const one = place(g, 3, 'mirror')!;
    expect(one.cells[3]).toBe('/');
    expect(trace(one).visits.map((v) => v.cell)).toEqual([0, 3]);
    const f = turn(one, 3)!;
    const b2 = trace(f);
    expect(b2.visits.map((v) => v.cell)).toEqual([0, 3, 4, 5]);
    expect(b2.visits[3].stop).toBe('edge');
    expect(b2.lit.has(5)).toBe(false);
    expect(solved(one)).toBe(false);
    expect(solved(f)).toBe(true);
    // Only placing counts: turning is free.
    expect(one.moves).toBe(1);
    expect(f.moves).toBe(1);
    expect(g.cells[3]).toBe('.');
  });

  it('places only tray pieces on open cells; a tap places, turns, then lifts', () => {
    expect(place(g, 5, 'mirror')).toBeNull(); // a blocker
    expect(place(g, 0, 'mirror')).toBeNull(); // the lamp's cell
    expect(place(g, 4, 'mirror')).toBeNull(); // a ring
    expect(place(g, 3, 'splitter')).toBeNull(); // none in the tray
    const one = place(g, 3, 'mirror')!;
    expect(place(one, 6, 'mirror')).toBeNull(); // the tray is empty
    expect(left(one)).toEqual({ mirror: 0, splitter: 0 });
    expect(turn(g, 5)).toBeNull();
    expect(turn(grid(['F/', '.', '.', '.']), 0)).toBeNull();
    expect(lift(grid(['Cs', '.', '.', '.']), 0)).toBeNull();
    const a = tap(g, 3, 'mirror')!;
    const b = tap(a, 3, 'mirror')!;
    const c = tap(b, 3, 'mirror')!;
    expect([a.cells[3], b.cells[3], c.cells[3]]).toEqual(['/', '\\', '.']);
    expect(left(c).mirror).toBe(1);
    // An empty cell takes the other kind once the chosen one is used up.
    const both = grid(['.', '.', '.', '.', '.', '.', '.', '.', '.'], { tray: { mirrors: 0, splitters: 1 } });
    expect(tap(both, 3, 'mirror')!.cells[3]).toBe('H/');
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

  it('has exactly one answer, which uses the whole tray, across the elements', () => {
    // A sample across every rung of the ladder; dealing is the slow part, so keep it modest.
    for (let z = 1; z <= 118; z += 9) {
      for (let seed = 1; seed <= 2; seed++) {
        const level = newLight(z, seed * 17 + z);
        expect(solved(level)).toBe(false);
        for (const t of level.targets) expect(level.cells[t.cell]).toBe('.');
        for (const d of level.darks) expect(level.cells[d]).toBe('.');
        expect(level.cells.some((c) => c === '/' || c === '\\' || c[0] === 'H')).toBe(false);
        expect(level.par).toBe(level.tray.mirrors + level.tray.splitters);
        // Placing the answer's pieces solves it in par moves.
        let s: LightState = level;
        level.solution.forEach((c, i) => {
          if (c === level.cells[i]) return;
          s = place(s, i, c[0] === 'H' ? 'splitter' : 'mirror')!;
          if (c === '\\' || c === 'H\\') s = turn(s, i)!;
        });
        expect(solved(s)).toBe(true);
        expect(s.moves).toBe(level.par);
        expect(s.cells).toEqual(level.solution);
        // Colored rings only with filters.
        if (level.features.includes('filters')) expect(level.cells.some((c) => c[0] === 'C')).toBe(true);
        else expect(level.targets.every((t) => t.hue === 'w')).toBe(true);
      }
    }
  }, 20_000);

  it('proves the answer unique: no other layout of tray pieces lights every ring', () => {
    const B: Cfg = { size: 6, mirrors: 3, splitters: 0, fixed: 0, decoys: 0, filters: 0, targets: 2, colored: 0, darksInit: 1, darksMax: 2, blockers: [1, 3], blockersMax: 8 };
    for (const cfg of [{ ...B, mirrors: 2 }, B, { ...B, mirrors: 2, splitters: 1, targets: 3 }, { ...B, filters: 1, targets: 3, colored: 1 }]) {
      for (let seed = 1; seed <= 6; seed++) {
        const b = generate(cfg, seed) as NBoard;
        expect(b).not.toBeNull();
        const r = solve(b, { nodeCap: 5e6 });
        expect(r.capped).toBe(false);
        expect(r.par).toBe(cfg.mirrors + cfg.splitters);
        expect(r.solutions.length).toBe(1);
      }
    }
  }, 20_000);

  it('climbs the ladder: tray size, darks, splitters, filters and bigger boards by element', () => {
    const at = (z: number) => cfgFor(z, seeded(3));
    expect(at(1).mirrors).toBe(1);
    expect(at(10).mirrors).toBe(2);
    expect(at(30).darksInit).toBe(1);
    expect(at(45).splitters).toBe(1);
    expect(at(65).filters).toBe(1);
    expect(at(75).filters).toBe(2);
    for (let d = 0; d < 10; d++) expect(cfgFor(90, seeded(d)).mirrors + cfgFor(90, seeded(d)).splitters).toBe(4);
    expect(at(110).size).toBe(7);
    expect(newLight(1, 2).par).toBe(1);
    expect(newLight(118, 2).size).toBe(7);
  });

  it('builds fast enough to deal on open', () => {
    for (const z of [1, 30, 50, 75, 90, 110]) {
      const t0 = performance.now();
      newLight(z, 7);
      expect(performance.now() - t0).toBeLessThan(3000); // well under a second on a desktop; CI is slower
    }
  });
});

describe('view and rule cards', () => {
  it('draws boards inside the area', () => {
    for (const z of [1, 60, 118]) for (const a of AREAS_ALL) {
      const v = new LightView(newLight(z, 3), true);
      const { ctx, pts } = recCtx();
      v.draw(ctx, a, 0);
      expect(inside(pts, a)).toBe(true);
      expect(v.hint().length).toBeLessThanOrEqual(40);
    }
  });

  it('has a card with pictures for every piece, drawn inside its box', () => {
    checkRules(RULES, ['Rings', 'Fixed mirrors', 'Filters', 'Colored rings', 'Dark sensors']);
    expect(INSTRUCTIONS).toMatch(/fleeting/);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
    expect(RULES.map((r) => r.title)).toEqual(['Mirrors', 'Rings', 'The tray', 'Fixed mirrors', 'Splitters', 'Filters', 'Colored rings', 'Dark sensors', 'Blockers']);
  });
});

/** A canvas stand-in that records every coordinate drawn and every color set. */
function recCtx(): { ctx: CanvasRenderingContext2D; pts: [number, number][]; colors: Set<unknown> } {
  const pts: [number, number][] = [];
  const colors = new Set<unknown>();
  const rec = (x: number, y: number) => pts.push([x, y]);
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'moveTo' || k === 'lineTo') return rec;
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'ellipse') return (x: number, y: number, rx: number, ry: number) => { const r = Math.max(rx, ry); rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'roundRect' || k === 'rect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      if (k === 'fillText') return (s: string, x: number, y: number) => { rec(x, y - 12); rec(x + s.length * 7, y); };
      return () => {};
    },
    set(t, k, v) {
      if (k === 'strokeStyle' || k === 'fillStyle') colors.add(v);
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, pts, colors };
}

function inside(pts: [number, number][], a: { x: number; y: number; w: number; h: number }): boolean {
  return pts.every(([x, y]) => x >= a.x - 0.5 && x <= a.x + a.w + 0.5 && y >= a.y - 0.5 && y <= a.y + a.h + 0.5);
}

const AREAS_ALL = [{ x: 0, y: 0, w: 340, h: 430 }, { x: 10, y: 8, w: 1200, h: 700 }, { x: 0, y: 0, w: 600, h: 300 }];

function checkRules(rules: RuleCard[], withBad: string[]): void {
  expect(rules.length).toBeGreaterThan(3);
  // Pictures in pairs where there is something to get wrong; a single kept one for the basics.
  expect(rules.filter((r) => r.bad).map((r) => r.title)).toEqual(withBad);
  for (const r of rules) {
    expect(r.title.trim().length, r.title).toBeGreaterThan(0);
    expect(r.title.length, r.title).toBeLessThanOrEqual(24);
    expect(r.text.trim().length, r.title).toBeGreaterThan(0);
    expect(r.text, r.title).not.toMatch(/[<>]/);
    expect(r.text.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, r.title).toBeLessThanOrEqual(2);
    expect(r.demo, r.title).toBeUndefined();
    expect(r.good, r.title).toBeDefined();
    const pics: [string, Illustration][] = [['good', r.good!]];
    if (r.bad) pics.push(['bad', r.bad]);
    for (const [kind, ill] of pics) {
      const name = `${r.title} (${kind})`;
      expect(ill.duration, name).toBeGreaterThanOrEqual(1.5);
      expect(ill.duration, name).toBeLessThanOrEqual(4);
      if (ill.caption !== undefined) expect(ill.caption.length, name).toBeLessThanOrEqual(21); // one line under a 140 px picture
      const times: number[] = [];
      for (let t = 0; t < ill.duration; t += 0.07) times.push(t);
      times.push(ill.duration);
      for (const [w, h] of [[140, 104], [120, 90]]) for (const t of times) {
        const { ctx, pts } = recCtx();
        ill.draw(ctx, w, h, t);
        expect(inside(pts, { x: 0, y: 0, w, h }), `${name} at ${t.toFixed(2)}s, ${w}x${h}`).toBe(true);
      }
      // The still (its last frame): a kept rule has nothing flagged; a broken one has its mark flagged in amber, never red.
      for (const [w, h] of [[140, 104], [120, 90]]) {
        const { ctx, colors } = recCtx();
        ill.draw(ctx, w, h, ill.duration);
        expect(colors.has(C.warn), name).toBe(kind === 'bad');
        expect(colors.has(C.bad), name).toBe(false);
      }
    }
  }
}
