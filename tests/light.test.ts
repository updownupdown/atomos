import { describe, expect, it } from 'vitest';
import { cfgFor, left, lift, newLight, open, place, reflect, solved, status, tap, trace, turn, turnable, type Cell, type LightState } from '../src/puzzles/light';
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

describe('hints', () => {
  // One deal per band of the ladder, dealt once: dealing is the slow part.
  const levels = [1, 12, 30, 45, 65, 75, 85, 95, 110, 118].map((z) => newLight(z, 5));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st = (v: LightView) => (v as any).state as LightState;
  const plain = (text: string) => {
    expect(text).toMatch(/^[A-Z][^—<>]*\.$/);
    expect(text.length).toBeLessThanOrEqual(60);
  };
  /** Taps cell i the way a player would. */
  const tapAt = (v: LightView, i: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (v as any).tryTap(i);
  };

  it('Look here rings a cell the answer needs and changes nothing', () => {
    for (const level of levels) {
      const v = new LightView(level, true);
      const before = st(v);
      const h = v.help(1)!;
      plain(h.text);
      expect(h.text).toMatch(/^This cell needs a (mirror|splitter)\.$/);
      expect(h.moved).toBeUndefined();
      expect(st(v)).toBe(before);
      expect(st(v).cells).toEqual(level.cells);
      expect(v.moves).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (v as any).mark;
      expect(turnable(level.solution[m.cell])).toBe(true);
      expect(level.cells[m.cell]).toBe('.');
      const { ctx, pts } = recCtx();
      v.draw(ctx, AREAS_ALL[0], 0);
      expect(inside(pts, AREAS_ALL[0])).toBe(true);
    }
  });

  it('Show me solves a fresh deal at par, one undoable placement per call', () => {
    for (const level of levels) {
      const v = new LightView(level, true);
      let calls = 0;
      while (!v.won && calls < level.par * 3 + 10) {
        const before = v.moves;
        const h = v.help(2)!;
        plain(h.text);
        expect(h.text).toMatch(/^Placed a (mirror|splitter)\.$/);
        expect(h.moved).toBe(true);
        expect(v.moves).toBe(before + 1);
        calls++;
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBe(level.par);
      expect(st(v).cells).toEqual(level.solution);
      expect(v.help(1)).toBeNull();
      expect(v.help(2)).toBeNull();
      // One undo takes back the last placement whole.
      v.undo();
      expect(v.moves).toBe(level.par - 1);
      expect(st(v).cells.filter((c, i) => c !== level.solution[i])).toHaveLength(1);
    }
  });

  it('points out a wrong piece first, and Show me turns it or takes it back for free', () => {
    for (const level of levels) {
      const v = new LightView(level, true);
      // A piece where the answer has none, and every needed cell tapped once (set slanted /).
      const stray = level.cells.findIndex((c, i) => open(level, i) && !turnable(level.solution[i]));
      tapAt(v, stray);
      for (let i = 0; i < level.cells.length; i++) if (turnable(level.solution[i]) && left(st(v)).mirror + left(st(v)).splitter > 0) tapAt(v, i);
      const before = st(v);
      const h1 = v.help(1)!;
      plain(h1.text);
      expect(h1.text).toMatch(/faces the wrong way|doesn't belong here|not a/);
      expect(st(v)).toBe(before);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (v as any).mark;
      expect(turnable(before.cells[m.cell]) && before.cells[m.cell] !== level.solution[m.cell]).toBe(true);
      let calls = 0;
      while (!v.won && calls < level.par * 3 + 10) {
        const moves = v.moves;
        const h = v.help(2)!;
        plain(h.text);
        expect(h.moved).toBe(true);
        // Only setting a piece counts, as for a player.
        expect(v.moves).toBe(moves + (h.text.startsWith('Placed') ? 1 : 0));
        calls++;
      }
      expect(v.won).toBe(true);
      expect(st(v).cells).toEqual(level.solution);
    }
  });

  it('answers well within 200 ms', () => {
    let worst = 0;
    for (const level of levels) {
      const v = new LightView(level, true);
      for (let k = 0; k < 3; k++) for (const lv of [1, 2] as const) {
        const t0 = performance.now();
        v.help(lv);
        worst = Math.max(worst, performance.now() - t0);
      }
    }
    expect(worst).toBeLessThan(200);
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
