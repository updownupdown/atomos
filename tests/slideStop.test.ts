import { describe, expect, it } from 'vitest';
import { DIRS, analyzeSlideStop, cracksOf, isRock, newSlideStop, reachable, slide, slideEnd, slideRun, slideStopPlan, solve, solved, tileRoles, type SlideStopState, type Tile } from '../src/puzzles/slideStop';
import { SlideStopView } from '../src/puzzles/slideStopView';
import { undoHelp, type Area, type Illustration, type RuleCard } from '../src/puzzles/view';
import { INSTRUCTIONS, RULES } from '../src/puzzles/slideStopView';
import { C } from '../src/puzzles/palette';

const ZS = [1, 3, 11, 19, 26, 37, 55, 87, 92, 118];

const KINDS = [
  ['sticky', (t: Tile) => t === '~'],
  ['cracks', (t: Tile) => t === '%'],
  ['arrows', (t: Tile) => '^v<>'.includes(t)],
] as const;

const parOf = (s: SlideStopState): number => solve(s)?.length ?? -1;
const swap = (s: SlideStopState, cell: number, t: Tile): SlideStopState => ({ ...s, tiles: s.tiles.map((x, i) => (i === cell ? t : x)) });

const board = (rows: string[], extra: Partial<SlideStopState> = {}): SlideStopState => {
  const size = rows.length;
  const tiles = rows.join('').split('') as Tile[];
  return { size, tiles, sparks: [], got: 0, broken: 0, start: 0, goal: 0, pos: 0, moves: 0, par: 1, ...extra };
};

describe('sliding', () => {
  // . # .
  // . . .
  // . . .
  const plain = board(['.#.', '...', '...'], { goal: 6 });

  it('slides until a rock or the edge', () => {
    expect(slideEnd(plain, 0, 'right')).toBe(0);
    expect(slideEnd(plain, 0, 'down')).toBe(6);
    expect(slideEnd(plain, 3, 'right')).toBe(5);
    expect(slideEnd(plain, 7, 'up')).toBe(4);
  });

  it('refuses a slide that goes nowhere and counts the ones that move', () => {
    expect(slide(plain, 'right')).toBeNull();
    expect(slide(plain, 'up')).toBeNull();
    const s = slide(plain, 'down')!;
    expect(s.pos).toBe(6);
    expect(s.moves).toBe(1);
    expect(plain.pos).toBe(0);
    expect(solved(s)).toBe(true);
  });

  it('finds the shortest route and reports dead ends', () => {
    expect(solve(plain)).toEqual(['down']);
    expect(reachable({ ...plain, goal: 1 })).toBe(false);
  });

  it('stops on a sticky patch', () => {
    const s = board(['.~..', '....', '....', '....']);
    expect(slideEnd(s, 0, 'right')).toBe(1);
    expect(slideEnd(s, 1, 'right')).toBe(3);
  });

  it('breaks a crack once the droplet has left it', () => {
    // A crack passed over breaks; one stopped on holds until left.
    const s = board(['.%.#', '....', '....', '....']);
    const a = slide(s, 'right')!;
    expect(a.pos).toBe(2);
    expect(isRock(a, 1)).toBe(true);
    expect(slideEnd(a, 2, 'left')).toBe(2);
    const t = board(['..%#', '....', '....', '....']);
    const b = slide(t, 'right')!;
    expect(b.pos).toBe(2);
    expect(isRock(b, 2)).toBe(false);
    const c = slide(b, 'down')!;
    expect(isRock(c, 2)).toBe(true);
    expect(cracksOf(c)).toEqual([2]);
  });

  it('enters an arrow only moving its way', () => {
    const s = board(['.>..', '....', '.v..', '....']);
    expect(slideEnd(s, 0, 'right')).toBe(3);
    // Against the arrow, or from the side, it is a wall.
    expect(slideEnd(s, 13, 'up')).toBe(13);
    expect(slideEnd(s, 5, 'up')).toBe(5);
    expect(slideEnd(s, 8, 'right')).toBe(8);
    // With it, the droplet passes straight over.
    expect(slideEnd(s, 5, 'down')).toBe(13);
    // Leaving an arrow is free in any direction.
    expect(slideEnd(s, 9, 'left')).toBe(8);
    expect(slideEnd(s, 1, 'down')).toBe(13);
  });

  it('needs every spark before the ring counts', () => {
    const s = board(['....', '....', '....', '....'], { sparks: [3], goal: 12 });
    const down = slide(s, 'down')!;
    expect(down.pos).toBe(12);
    expect(solved(down)).toBe(false);
    expect(solve(s)).toEqual(['right', 'down', 'left']);
    const r = slideRun(s, 'right');
    expect(r.got).toBe(1);
    expect(r.path).toEqual([1, 2, 3]);
  });
});

describe('levels', () => {
  it('is the same level for the same seed', () => {
    expect(newSlideStop(26, 7)).toEqual(newSlideStop(26, 7));
    expect(newSlideStop(26, 7)).not.toEqual(newSlideStop(26, 8));
    for (const z of [3, 55, 118]) expect(newSlideStop(z, 11)).toEqual(newSlideStop(z, 11));
  });

  it('is solvable, with par the shortest route, for a spread of elements and seeds', () => {
    for (const z of ZS) {
      const plan = slideStopPlan(z);
      for (let seed = 1; seed <= 12; seed++) {
        const level = newSlideStop(z, seed * 31 + z);
        expect(solved(level)).toBe(false);
        expect(level.pos).toBe(level.start);
        expect(level.tiles[level.start]).toBe('.');
        expect(level.tiles[level.goal]).toBe('.');
        expect(level.sparks).toHaveLength(plan.sparks);
        // Pruning keeps only the special tiles that matter: at least one of each kind the element brings, at most the plan's count.
        for (const [k, is] of KINDS) {
          const count = level.tiles.filter(is).length;
          expect(count).toBeLessThanOrEqual(plan[k]);
          expect(count).toBeGreaterThanOrEqual(plan[k] ? 1 : 0);
        }
        const path = solve(level)!;
        expect(path).not.toBeNull();
        expect(path.length).toBe(level.par);
        expect(level.par).toBeGreaterThanOrEqual(plan.minPar);
        expect(level.par).toBeLessThanOrEqual(plan.maxPar);
        let s = level;
        for (const d of path) s = slide(s, d)!;
        expect(solved(s)).toBe(true);
        expect(s.moves).toBe(level.par);
      }
    }
  });

  it('grows with the element and brings each tile in at its gate', () => {
    expect(newSlideStop(1, 3).size).toBe(7);
    expect(newSlideStop(50, 3).size).toBe(8);
    expect(newSlideStop(118, 3).size).toBe(9);
    expect(slideStopPlan(1)).toMatchObject({ sparks: 0, sticky: 0, cracks: 0, arrows: 0, decoys: 1 });
    expect(slideStopPlan(118).decoys).toBe(3);
    expect(slideStopPlan(3).sparks).toBe(1);
    expect(slideStopPlan(11).sticky).toBeGreaterThan(0);
    expect(slideStopPlan(19).cracks).toBeGreaterThan(0);
    expect(slideStopPlan(37).arrows).toBeGreaterThan(0);
  });

  it('never lets a slide land on a rock', () => {
    const level = newSlideStop(90, 99);
    for (const d of DIRS) {
      const s = slide(level, d);
      if (s) expect(isRock(s, s.pos)).toBe(false);
    }
  });

  it('deals fast', () => {
    let worst = 0, total = 0, count = 0;
    for (let z = 1; z <= 118; z += 3) {
      const t = performance.now();
      newSlideStop(z, z * 5 + 2);
      const ms = performance.now() - t;
      worst = Math.max(worst, ms);
      total += ms;
      count++;
    }
    expect(total / count).toBeLessThan(50);
    expect(worst).toBeLessThan(250);
  });
});

describe('design', () => {
  // A small sample per element: every check below runs a search per tile.
  const SAMPLE = ZS.flatMap((z) => [1, 2, 3, 4, 5, 6].map((seed) => ({ z, level: newSlideStop(z, seed * 97 + z) })));

  it('keeps only tiles that matter: every special tile is key, every nucleus key or one of a few decoys', () => {
    for (const { z, level } of SAMPLE) {
      const plan = slideStopPlan(z);
      const roles = tileRoles(level);
      for (const r of roles) {
        if (r.tile === '#') expect(['key', 'decoy'], `z ${z}: rock ${r.cell}`).toContain(r.role);
        else expect(r.role, `z ${z}: ${r.tile} at ${r.cell}`).toBe('key');
      }
      expect(roles.filter((r) => r.role === 'decoy').length).toBeLessThanOrEqual(plan.decoys);
    }
  });

  it('means what it says by key: without a key tile par changes, without any other it holds', () => {
    for (const { level } of SAMPLE.filter((_, i) => i % 4 === 0)) {
      for (const r of tileRoles(level)) {
        const alts = r.tile === '%' || '^v<>'.includes(r.tile) ? (['.', '#'] as Tile[]) : (['.'] as Tile[]);
        const changes = alts.some((t) => parOf(swap(level, r.cell, t)) !== level.par);
        expect(changes, `${r.tile} at ${r.cell}`).toBe(r.role === 'key');
      }
    }
  });

  it('makes each kind of special tile matter as a whole, and the photons force a detour', () => {
    for (const { z, level } of SAMPLE) {
      const plan = slideStopPlan(z);
      for (const [k, is] of KINDS) {
        if (!plan[k]) continue;
        const plain = { ...level, tiles: level.tiles.map((t) => (is(t) ? '.' : t)) as Tile[] };
        expect(parOf(plain), `z ${z}: ${k}`).not.toBe(level.par);
      }
      if (plan.sparks) expect(parOf({ ...level, sparks: [] }), `z ${z}`).toBeLessThan(level.par);
    }
  });

  it('is not won by sliding toward the target, and has wrong turns and a route that turns', () => {
    let wrong = 0;
    for (const { z, level } of SAMPLE) {
      const a = analyzeSlideStop(level);
      expect(a.par).toBe(level.par);
      expect(a.greedy, `z ${z}`).toBe(false);
      expect(a.dirs, `z ${z}`).toBeGreaterThanOrEqual(3);
      expect(a.states).toBeGreaterThan(level.par);
      wrong += a.wrongFirst;
    }
    // Most openings have a slide or two that looks fine and is not.
    expect(wrong / SAMPLE.length).toBeGreaterThanOrEqual(1.5);
  });

  it('asks for longer routes as the element grows', () => {
    const mean = (z: number) => SAMPLE.filter((x) => x.z === z).reduce((a, x) => a + x.level.par, 0) / 6;
    expect(mean(1)).toBeGreaterThanOrEqual(4);
    expect(mean(37)).toBeGreaterThan(mean(1));
    expect(mean(87)).toBeGreaterThan(mean(37));
    expect(mean(118)).toBeGreaterThanOrEqual(12);
  });

  it('tells a key nucleus from an idle one on a hand-made board', () => {
    // . # .   The ring is one slide down: the rock next to the start is idle.
    // . . .
    // . . .
    const idle = board(['.#.', '...', '...'], { goal: 6 });
    expect(tileRoles(idle)).toEqual([{ cell: 1, tile: '#', role: 'idle' }]);
    // . . .   From the left edge, the rock is the only thing that stops the electron on the ring.
    // S G #
    // . . .
    const key = board(['...', '..#', '...'], { start: 3, pos: 3, goal: 4 });
    expect(tileRoles(key)).toEqual([{ cell: 5, tile: '#', role: 'key' }]);
    const a = analyzeSlideStop(key);
    expect(a).toMatchObject({ par: 1, wrongFirst: 2, dirs: 1, detour: 0, tiles: 1 });
    // Only the left edge leads in: from any other cell the ring is out of reach.
    expect(a.traps).toBe(6);
  });
});

/** A canvas stand-in that records every coordinate drawn. */
function mockCtx(): { ctx: CanvasRenderingContext2D; pts: [number, number][] } {
  const pts: [number, number][] = [];
  const rec = (x: number, y: number) => pts.push([x, y]);
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'moveTo' || k === 'lineTo') return rec;
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'arcTo') return (x1: number, y1: number, x2: number, y2: number) => { rec(x1, y1); rec(x2, y2); };
      if (k === 'rect' || k === 'roundRect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      if (k === 'fillText') return (s: string, x: number, y: number) => { rec(x, y - 12); rec(x + s.length * 7, y); };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, pts };
}

describe('view', () => {
  const AREAS: Area[] = [{ x: 0, y: 0, w: 340, h: 430 }, { x: 10, y: 8, w: 1200, h: 700 }, { x: 0, y: 0, w: 600, h: 300 }];

  it('draws inside the area and keeps cells large but not huge', () => {
    for (const z of [1, 55, 118]) for (const area of AREAS) {
      const v = new SlideStopView(newSlideStop(z, 4), true);
      const { ctx, pts } = mockCtx();
      v.draw(ctx, area, 0);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(area.x - 0.5);
        expect(x).toBeLessThanOrEqual(area.x + area.w + 0.5);
        expect(y).toBeGreaterThanOrEqual(area.y - 0.5);
        expect(y).toBeLessThanOrEqual(area.y + area.h + 0.5);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((v as any).cell).toBeLessThanOrEqual(72);
      expect(v.hint().length).toBeLessThanOrEqual(40);
    }
  });

  it('plays the solver route by swipes', () => {
    const level = newSlideStop(55, 12);
    const v = new SlideStopView(level, true);
    const { ctx } = mockCtx();
    v.draw(ctx, AREAS[0], 0);
    const vec: Record<string, [number, number]> = { up: [0, -40], down: [0, 40], left: [-40, 0], right: [40, 0] };
    for (const d of solve(level)!) {
      v.down({ x: 170, y: 200 });
      v.up({ x: 170 + vec[d][0], y: 200 + vec[d][1] });
    }
    expect(v.won).toBe(true);
    expect(v.moves).toBe(level.par);
    expect(v.clean).toBe(true);
  });
});

describe('hints', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st = (v: SlideStopView) => (v as any).state as SlideStopState;
  const press = (v: SlideStopView, d: string) => v.key({ key: `Arrow${d[0].toUpperCase()}${d.slice(1)}` } as KeyboardEvent);
  const plain = (text: string) => {
    expect(text).toMatch(/^[A-Z][^—<>]*\.$/);
    expect(text.length).toBeLessThanOrEqual(60);
  };

  it('Look here points at the first slide of the best route and changes nothing', () => {
    for (const z of ZS) for (const seed of [1, 2]) {
      const v = new SlideStopView(newSlideStop(z, seed), true);
      const before = st(v);
      const snap = JSON.stringify(before);
      const h = v.help(1)!;
      plain(h.text);
      expect(h.moved).toBeUndefined();
      expect(h.text).toContain(solve(before)![0]);
      expect(st(v)).toBe(before);
      expect(JSON.stringify(st(v))).toBe(snap);
      expect(v.moves).toBe(0);
      // The mark is drawn inside the area, and only for the board it was asked on.
      const area = { x: 0, y: 0, w: 340, h: 430 };
      const { ctx, pts } = mockCtx();
      v.draw(ctx, area, 0);
      for (const [x, y] of pts) expect(x >= area.x - 0.5 && x <= area.x + area.w + 0.5 && y >= area.y - 0.5 && y <= area.y + area.h + 0.5).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((v as any).mark.state).toBe(st(v));
      press(v, solve(before)![0]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((v as any).mark.state).not.toBe(st(v));
    }
  });

  it('Show me wins by the shortest route, one counted, undoable slide per call', () => {
    for (const z of ZS) for (const seed of [1, 2, 3]) {
      const level = newSlideStop(z, seed);
      const v = new SlideStopView(level, true);
      let calls = 0;
      while (!v.won && calls < level.par * 3 + 10) {
        const before = v.moves;
        const h = v.help(2)!;
        plain(h.text);
        expect(h.moved).toBe(true);
        expect(v.moves).toBe(before + 1);
        expect(v.canUndo()).toBe(true);
        calls++;
      }
      expect(v.won).toBe(true);
      expect(v.moves).toBe(level.par);
      expect(v.help(1)).toBeNull();
      expect(v.help(2)).toBeNull();
      v.undo();
      expect(v.moves).toBe(level.par - 1);
    }
  });

  it('counts the undos back to a board that can still be won', () => {
    let found = 0;
    for (const z of ZS) for (let seed = 1; seed <= 8 && found < 12; seed++) {
      const level = newSlideStop(z, seed);
      // A first or second slide that leaves the ring out of reach.
      let path: string[] | null = null;
      for (const a of DIRS) {
        const s1 = slide(level, a);
        if (!s1 || path) continue;
        if (!reachable(s1)) { path = [a]; break; }
        for (const b of DIRS) {
          const s2 = slide(s1, b);
          if (s2 && !solved(s2) && !reachable(s2)) { path = [a, b]; break; }
        }
      }
      if (!path) continue;
      found++;
      const v = new SlideStopView(level, true);
      for (const d of path) press(v, d);
      expect(v.stuck).toBe(true);
      const moves = v.moves;
      expect(v.help(1)).toEqual(undoHelp(1));
      expect(v.help(2)).toEqual(undoHelp(1));
      expect(v.moves).toBe(moves);
      // Any slide from a dead end is still one: two undos now.
      const more = DIRS.find((d) => slide(st(v), d));
      if (more) {
        press(v, more);
        expect(v.help(2)).toEqual(undoHelp(2));
        v.undo();
      }
      v.undo();
      expect(v.help(1)!.text).not.toMatch(/Undo/);
    }
    expect(found).toBeGreaterThanOrEqual(5);
  });

  it('answers well within 200 ms on every element', () => {
    let worst = 0;
    for (let z = 1; z <= 118; z += 9) for (const seed of [1, 2]) {
      const v = new SlideStopView(newSlideStop(z, seed), true);
      for (let k = 0; k < 3 && !v.won; k++) {
        for (const level of [1, 2] as const) {
          const t0 = performance.now();
          v.help(level);
          worst = Math.max(worst, performance.now() - t0);
        }
      }
    }
    expect(worst).toBeLessThan(200);
  });
});

describe('rule cards', () => {
  it('has a card with pictures for every tile, drawn inside its box', () => {
    checkRules(RULES, ['Red ring', 'Photons', 'Unstable nuclei', 'Drift arrows']);
    expect(INSTRUCTIONS).toMatch(/^\s*<section class="how-specs"><h3>Specs<\/h3><ul>\s*<li><b>Flawless:<\/b>/);
    expect(INSTRUCTIONS).not.toMatch(/How to play/);
    expect(RULES.map((r) => r.title)).toEqual(['Slide', 'Red ring', 'Nuclei', 'Photons', 'Potential wells', 'Unstable nuclei', 'Drift arrows']);
  });

  it('names the tiles the same way in the hint', () => {
    const v = new SlideStopView(newSlideStop(19, 4), true);
    expect(v.hint()).toMatch(/photons? left/);
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
