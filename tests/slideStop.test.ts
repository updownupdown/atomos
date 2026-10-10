import { describe, expect, it } from 'vitest';
import { DIRS, cracksOf, isRock, newSlideStop, reachable, slide, slideEnd, slideRun, slideStopPlan, solve, solved, type SlideStopState, type Tile } from '../src/puzzles/slideStop';
import { SlideStopView } from '../src/puzzles/slideStopView';
import type { Area, Illustration, RuleCard } from '../src/puzzles/view';
import { INSTRUCTIONS, RULES } from '../src/puzzles/slideStopView';
import { C } from '../src/puzzles/palette';

const ZS = [1, 3, 11, 19, 26, 37, 55, 87, 92, 118];

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
        expect(level.tiles.filter((t) => t === '~')).toHaveLength(plan.sticky);
        expect(level.tiles.filter((t) => t === '%')).toHaveLength(plan.cracks);
        expect(level.tiles.filter((t) => '^v<>'.includes(t))).toHaveLength(plan.arrows);
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
    expect(slideStopPlan(1)).toMatchObject({ sparks: 0, sticky: 0, cracks: 0, arrows: 0 });
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
    let worst = 0;
    for (let z = 1; z <= 118; z += 3) {
      const t = performance.now();
      newSlideStop(z, z * 5 + 2);
      worst = Math.max(worst, performance.now() - t);
    }
    expect(worst).toBeLessThan(150);
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

describe('rule cards', () => {
  it('has a card with pictures for every tile, drawn inside its box', () => {
    checkRules(RULES, ['Red ring', 'Photons', 'Unstable nuclei', 'Drift arrows']);
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">/);
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
