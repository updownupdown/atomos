import { describe, expect, it } from 'vitest';
import { beamsLeft, choosePort, chord, cloneRutherford, cross, deduce, fire, hitsLeft, neighbors, newRutherford, nextLead, onTrack, portLine, probe, remaining, ruined, scope, solved, specFor, toggleMark, traceBeam, won, type RutherfordState } from '../src/puzzles/rutherford';
import { RULES, INSTRUCTIONS, RutherfordView } from '../src/puzzles/rutherfordView';
import { C } from '../src/puzzles/palette';
import type { RuleCard } from '../src/puzzles/view';

const SPREAD = [1, 6, 20, 21, 50, 51, 79, 85, 86, 92, 118];

/** A hand-made plate: nuclei and kinds given, clues computed. */
function plate(size: number, nuclei: number[], kinds: Record<number, 'scatter' | 'quiet'> = {}): RutherfordState {
  const n = size * size;
  const nuc = Array.from({ length: n }, (_, i) => nuclei.includes(i));
  const kind = Array.from({ length: n }, (_, i) => kinds[i] ?? 'plain');
  const base = { size, kind };
  return {
    size, nuclei: nuc, kind,
    clue: nuc.map((_, i) => scope(base, i).filter((j) => nuc[j]).length),
    probed: Array(n).fill(false), marked: Array(n).fill(false), found: Array(n).fill(false), fired: Array(4 * size).fill(false),
    hits: 0, hitLimit: 3, beams: 0, beamPar: 1, beamLimit: 99, moves: 0, total: nuclei.length,
  };
}

describe('geometry', () => {
  it('counts the eight neighbors, fewer at the rim', () => {
    expect(neighbors(5, 12)).toHaveLength(8);
    expect(neighbors(5, 0).sort((a, b) => a - b)).toEqual([1, 5, 6]);
  });

  it('a scatter cell covers its whole row and column', () => {
    const c = cross(5, 7).sort((a, b) => a - b);
    expect(c).toEqual([2, 5, 6, 8, 9, 12, 17, 22]);
  });
});

describe('probing', () => {
  it('reports counts, opens zeros and scores a direct hit without ending play', () => {
    // 4x4, one nucleus in the far corner.
    const s = plate(4, [15]);
    const t = probe(s, 0)!;
    expect(t.moves).toBe(1);
    // The zero cascade opens every safe cell.
    expect(solved(t)).toBe(true);
    expect(t.hits).toBe(0);
    const h = probe(s, 15)!;
    expect(h.hits).toBe(1);
    expect(h.probed[15]).toBe(true);
    expect(solved(h)).toBe(false);
    expect(probe(h, 15)).toBeNull();
  });

  it('scatter cells count along the row and column; quiet cells stop a cascade', () => {
    const s = plate(4, [3, 12], { 0: 'scatter', 5: 'quiet' });
    expect(s.clue[0]).toBe(2);
    const t = probe(s, 5)!;
    expect(t.probed.filter(Boolean)).toHaveLength(1);
  });

  it('marks block probing, count down the remaining nuclei and power a chord', () => {
    const s = plate(3, [0]);
    const m = toggleMark(s, 0)!;
    expect(remaining(m)).toBe(0);
    expect(probe(m, 0)).toBeNull();
    const p = probe(m, 4)!; // center: count 1
    expect(p.clue[4]).toBe(1);
    const c = chord(p, 4)!;
    expect(solved(c)).toBe(true);
    expect(c.hits).toBe(0);
    // A chord whose marks do not meet the count does nothing.
    expect(chord(probe(s, 4)!, 4)).toBeNull();
  });
});

describe('alpha beams', () => {
  it('numbers the ports clockwise from the top, each firing away from its side', () => {
    expect(portLine(4, 1).cells).toEqual([1, 5, 9, 13]); // top, column 1, downward
    expect(portLine(4, 4 + 2).cells).toEqual([11, 10, 9, 8]); // right, row 2, leftward
    expect(portLine(4, 8 + 0).cells).toEqual([12, 8, 4, 0]); // bottom, column 0, upward
    expect(portLine(4, 12 + 3).cells).toEqual([12, 13, 14, 15]); // left, row 3, rightward
  });

  it('passes straight through an empty line, opening every cell', () => {
    const s = plate(4, [5]);
    expect(traceBeam(s, 12 + 3)).toEqual({ path: [12, 13, 14, 15], stop: null });
    const t = fire(s, 12 + 3)!;
    expect([12, 13, 14, 15].every((i) => t.probed[i])).toBe(true);
    expect(t.beams).toBe(1);
    expect(t.moves).toBe(1);
    expect(t.hits).toBe(0);
    expect(fire(t, 12 + 3)).toBeNull();
  });

  it('bounces off the first nucleus in its way and reveals it, never as a hit', () => {
    const s = plate(4, [6, 7]);
    // Left port of row 1: crosses 4 and 5, stops at 6; 7 stays hidden behind it.
    const { path, stop } = traceBeam(s, 12 + 1);
    expect(path).toEqual([4, 5]);
    expect(stop).toBe(6);
    const m = toggleMark(toggleMark(s, 5)!, 6)!;
    const t = fire(m, 12 + 1)!;
    expect(t.probed[4] && t.probed[5]).toBe(true);
    expect(t.marked[5]).toBe(false); // a wrong mark on the track is cleared
    expect(t.found[6]).toBe(true);
    expect(t.probed[6]).toBe(false);
    expect(t.found[7]).toBe(false);
    expect(t.hits).toBe(0);
    expect(remaining(t)).toBe(1);
    // A found nucleus can be neither probed nor marked, and counts toward a clear-around.
    expect(probe(t, 6)).toBeNull();
    expect(toggleMark(t, 6)).toBeNull();
  });

  it('lets a found nucleus satisfy a clear-around', () => {
    const s = plate(3, [2]);
    const t = fire(s, 3 + 0)!; // right port, row 0: stops at once on cell 2
    expect(t.found[2]).toBe(true);
    const p = probe(t, 4)!;
    expect(solved(chord(p, 4)!)).toBe(true);
  });

  it('chooses beams only from what a player can see', () => {
    for (const seed of [3, 9, 14]) {
      const s = newRutherford(60, seed);
      const known = s.nuclei.map(() => false);
      const pick = choosePort(s, known);
      expect(pick).toBeGreaterThanOrEqual(0);
      // Move every hidden nucleus somewhere else hidden: the choice must not change.
      const hidden = s.nuclei.map((_, i) => i).filter((i) => !s.probed[i]);
      const moved = { ...s, nuclei: s.nuclei.map((x, i) => (s.probed[i] ? x : false)) };
      hidden.slice().reverse().slice(0, s.total).forEach((i) => { moved.nuclei[i] = true; });
      expect(choosePort(moved, known)).toBe(pick);
    }
  });

  it('turns a coin-flip into a deduction', () => {
    // Two cells, one nucleus, no clue tells them apart: the solver stalls without a beam.
    const s = plate(2, [1]);
    s.probed[2] = s.probed[3] = true;
    expect(solved(deduce(s).state)).toBe(false);
    const run = deduce(s, { beams: true });
    expect(solved(run.state)).toBe(true);
    expect(run.beams).toBe(1);
    expect(run.state.hits).toBe(0);
  });
});

describe('limits', () => {
  type Inside = { state: RutherfordState; act(i: number, m: boolean): void; tapPort(p: number): void; armed: number };
  const inside = (v: RutherfordView) => v as unknown as Inside;

  it('the hit that reaches the limit ruins the plate, and nothing more can be played', () => {
    // 4x4 with three nuclei: two hits are taken, the third ruins it.
    const s = { ...plate(4, [5, 10, 15]), hitLimit: 3, beamLimit: 2 };
    let t = probe(s, 5)!;
    expect(t.hits).toBe(1);
    expect(hitsLeft(t)).toBe(2);
    t = probe(t, 10)!;
    expect(ruined(t)).toBe(false);
    expect(hitsLeft(t)).toBe(1);
    const r = probe(t, 15)!;
    expect(r.hits).toBe(3);
    expect(ruined(r)).toBe(true);
    expect(hitsLeft(r)).toBe(0);
    // Every move is refused on a ruined plate, and it is never won, even with every safe cell open.
    expect(probe(r, 0)).toBeNull();
    expect(toggleMark(r, 0)).toBeNull();
    expect(fire(r, 0)).toBeNull();
    const all = { ...r, probed: r.probed.map(() => true) };
    expect(solved(all)).toBe(true);
    expect(won(all)).toBe(false);
  });

  it('a clear-around on a wrong mark can ruin the plate in one move', () => {
    // 3x3, the nucleus in corner 0, a wrong mark on 1: the clear-around on the center probes 0.
    const s = { ...plate(3, [0]), hitLimit: 1 };
    const p = probe(toggleMark(s, 1)!, 4)!;
    const c = chord(p, 4)!;
    expect(c.hits).toBe(1);
    expect(ruined(c)).toBe(true);
    expect(chord(c, 4)).toBeNull();
  });

  it('a ruined plate is stuck: Hint says undo, no move gets through, and undo brings it back', () => {
    for (const z of [10, 60]) {
      const s = newRutherford(z, 4);
      expect(s.hitLimit).toBe(specFor(z).hitLimit);
      const v = new RutherfordView(s, true);
      const hidden = s.nuclei.map((x, i) => (x && !s.probed[i] ? i : -1)).filter((i) => i >= 0);
      for (let k = 0; k < s.hitLimit - 1; k++) {
        inside(v).act(hidden[k], false);
        expect(v.stuck).toBe(false);
      }
      expect(v.hint()).toMatch(/· 1 hit left$/);
      expect(v.stats().progress).toEqual({ label: 'Hits', value: `${s.hitLimit - 1}/${s.hitLimit}` });
      const before = inside(v).state;
      inside(v).act(hidden[s.hitLimit - 1], false);
      expect(v.stuck).toBe(true);
      expect(v.won).toBe(false);
      expect(v.clean).toBe(false);
      expect(v.hint()).toBe('Plate ruined: undo or restart');
      expect(v.help(1)!.text).toBe('Undo your last move to get back on track.');
      expect(v.help(2)!.moved).toBeUndefined();
      // No move gets through: probing, marking, aiming.
      const ruinedState = inside(v).state;
      const safe = s.nuclei.findIndex((x, i) => !x && !ruinedState.probed[i]);
      inside(v).act(safe, false);
      inside(v).act(safe, true);
      inside(v).tapPort(0);
      expect(inside(v).armed).toBe(-1);
      expect(inside(v).state).toBe(ruinedState);
      // Undo brings back the plate before the last hit, still playable; the hits stay on the flawless record.
      expect(v.undo()).toBe(true);
      expect(inside(v).state).toBe(before);
      expect(v.stuck).toBe(false);
      expect(hitsLeft(inside(v).state)).toBe(1);
      expect(v.clean).toBe(false);
      v.restart();
      expect(v.stuck).toBe(false);
      expect(v.clean).toBe(true);
    }
  });

  it('beams are rationed: once the plate\'s are spent the ports close, and undo refunds one', () => {
    for (const z of [10, 60]) {
      const s = newRutherford(z, 7);
      expect(s.beamLimit).toBe(s.beamPar + specFor(z).spareBeams);
      let t = s;
      for (let k = 0; k < s.beamLimit; k++) {
        const next = fire(t, t.fired.findIndex((f) => !f));
        expect(next).not.toBeNull();
        t = next!;
      }
      expect(beamsLeft(t)).toBe(0);
      expect(t.fired.some((f) => !f)).toBe(true);
      for (let p = 0; p < t.fired.length; p++) expect(fire(t, p)).toBeNull();
      // Through the view: aiming a port does nothing once the beams are spent.
      const v = new RutherfordView(s, true);
      for (let p = 0; inside(v).state.beams < s.beamLimit; p++) { inside(v).tapPort(p); inside(v).tapPort(p); }
      const spent = inside(v).state;
      const free = spent.fired.findIndex((f) => !f);
      inside(v).tapPort(free);
      expect(inside(v).armed).toBe(-1);
      inside(v).tapPort(free);
      expect(inside(v).state).toBe(spent);
      expect(v.stats().par).toEqual({ label: 'Beams', value: `${s.beamLimit}/${s.beamPar}` });
      expect(v.hint()).toMatch(/· 0 beams ·/);
      v.undo();
      expect(beamsLeft(inside(v).state)).toBe(1);
      expect(v.beamsUsed).toBe(s.beamLimit);
    }
  });

  it('grants 3 hits and a spare beam up to z 50, 2 hits and no spare beyond', () => {
    expect(specFor(1)).toMatchObject({ hitLimit: 3, spareBeams: 1 });
    expect(specFor(50)).toMatchObject({ hitLimit: 3, spareBeams: 1 });
    expect(specFor(51)).toMatchObject({ hitLimit: 2, spareBeams: 0 });
    expect(specFor(118)).toMatchObject({ hitLimit: 2, spareBeams: 0 });
  });

  it('every plate can be finished without guessing within the beams it grants', () => {
    for (let z = 1; z <= 118; z += 3) {
      for (let seed = 1; seed <= 5; seed++) {
        const s = newRutherford(z, seed);
        expect(s.beamLimit).toBe(s.beamPar + specFor(z).spareBeams);
        expect(s.hitLimit).toBe(specFor(z).hitLimit);
        expect(onTrack(s), `z ${z} seed ${seed}`).toBe(true);
        // At par itself, with no spare.
        const run = deduce(s, { beams: s.beamPar });
        expect(solved(run.state), `z ${z} seed ${seed}`).toBe(true);
        expect(run.state.hits).toBe(0);
        expect(run.beams).toBeLessThanOrEqual(s.beamPar);
      }
    }
  });

  it('beams spent where they tell too little: Hint says how far to undo, and from there the plate finishes', () => {
    let seen = 0;
    for (const z of [30, 60, 90, 118]) {
      for (let seed = 1; seed <= 12 && seen < 6; seed++) {
        const s = newRutherford(z, seed);
        const v = new RutherfordView(s, true);
        // Spend every beam from the far end of the rim, with no thought for where they go.
        for (let p = s.fired.length - 1; inside(v).state.beams < s.beamLimit; p--) { inside(v).tapPort(p); inside(v).tapPort(p); }
        const st = inside(v).state;
        if (onTrack(st)) continue;
        seen++;
        const h = v.help(1)!;
        expect(h.text).toMatch(/^Undo (your last move|\d+ moves) to get back on track\.$/);
        const k = h.text.startsWith('Undo your') ? 1 : Number(/\d+/.exec(h.text)![0]);
        expect(v.help(2)!.moved).toBeUndefined();
        expect(inside(v).state).toBe(st);
        for (let i = 0; i < k; i++) v.undo();
        expect(onTrack(inside(v).state)).toBe(true);
        // Show me finishes from there with no hit.
        for (let calls = 0; !v.won; calls++) {
          expect(v.help(2)!.moved).toBe(true);
          expect(calls).toBeLessThan(s.size * s.size);
        }
        expect(inside(v).state.hits).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('levels', () => {
  it('is the same plate for the same seed', () => {
    expect(newRutherford(30, 4)).toEqual(newRutherford(30, 4));
  });

  it('sizes the plate and the nuclei by element', () => {
    expect(specFor(1).size).toBe(7);
    expect(specFor(50).size).toBe(8);
    expect(specFor(85).size).toBe(9);
    expect(specFor(118).size).toBe(10);
    for (const z of SPREAD) {
      const sp = specFor(z);
      const d = sp.nuclei / (sp.size * sp.size);
      expect(d).toBeGreaterThanOrEqual(0.14);
      expect(d).toBeLessThanOrEqual(0.21);
    }
  });

  it('opens with a small safe region and can be finished without guessing, using par beams', () => {
    let openSum = 0, plates = 0;
    for (const z of SPREAD) {
      for (let seed = 1; seed <= 8; seed++) {
        const s = newRutherford(z, seed);
        expect(s.nuclei.filter(Boolean)).toHaveLength(s.total);
        expect(s.hits).toBe(0);
        expect(s.beams).toBe(0);
        expect(s.fired).toHaveLength(4 * s.size);
        expect(s.probed.some(Boolean)).toBe(true);
        expect(s.probed.every((p, i) => !p || !s.nuclei[i])).toBe(true);
        const opened = s.probed.filter(Boolean).length / s.nuclei.length;
        expect(opened).toBeLessThan(0.7);
        openSum += opened;
        plates++;
        expect(solved(s)).toBe(false);
        // Beams are needed: deduction alone stalls...
        expect(solved(deduce(s).state)).toBe(false);
        // ...and with them the solver finishes in exactly the par it set.
        const run = deduce(s, { beams: true });
        expect(solved(run.state)).toBe(true);
        expect(run.state.hits).toBe(0);
        expect(run.beams).toBe(s.beamPar);
        expect(s.beamPar).toBeGreaterThanOrEqual(1);
        expect(s.beamPar).toBeLessThanOrEqual(specFor(z).maxBeams);
      }
    }
    // On average the opening is about a sixth of the plate.
    expect(openSum / plates).toBeLessThan(0.25);
  });

  it('aims for 2 beams on small plates and 3 on large ones', () => {
    expect(specFor(1).beams).toBe(2);
    expect(specFor(118).beams).toBe(3);
    let onAim = 0, all = 0;
    for (const z of SPREAD) for (let seed = 1; seed <= 6; seed++, all++) if (newRutherford(z, seed).beamPar === specFor(z).beams) onAim++;
    expect(onAim / all).toBeGreaterThan(0.8);
  });

  it('has both twists on the plate', () => {
    let scatter = 0, quiet = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = newRutherford(100, seed);
      scatter += s.kind.filter((k) => k === 'scatter').length;
      quiet += s.kind.filter((k) => k === 'quiet').length;
    }
    expect(scatter).toBeGreaterThan(0);
    expect(quiet).toBeGreaterThan(0);
  });

  it('generates fast for every element', () => {
    for (let z = 1; z <= 118; z++) {
      const t = performance.now();
      newRutherford(z, z * 7 + 3);
      expect(performance.now() - t).toBeLessThan(150);
    }
  });
});

/**
 * Records every coordinate a picture draws (through translate and scale), and every color it
 * paints with. Shapes drawn under a clip (a piece leaving through a gap, cut off at the edge)
 * are cut by the clip, so they are skipped.
 */
function record(draw: (ctx: CanvasRenderingContext2D) => void): { pts: [number, number][]; colors: Set<unknown> } {
  const pts: [number, number][] = [];
  const colors = new Set<unknown>();
  let m = { tx: 0, ty: 0, s: 1 };
  const stack: { m: typeof m; clipped: boolean }[] = [];
  let clipped = false;
  const rec = (x: number, y: number) => { if (!clipped) pts.push([m.tx + x * m.s, m.ty + y * m.s]); };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'save') return () => { stack.push({ m: { ...m }, clipped }); };
      if (k === 'restore') return () => { const top = stack.pop(); if (top) { m = top.m; clipped = top.clipped; } };
      if (k === 'clip') return () => { clipped = true; };
      if (k === 'translate') return (x: number, y: number) => { m = { ...m, tx: m.tx + x * m.s, ty: m.ty + y * m.s }; };
      if (k === 'scale') return (sx: number) => { m = { ...m, s: m.s * sx }; };
      if (k === 'moveTo' || k === 'lineTo') return rec;
      if (k === 'arc') return (x: number, y: number, r: number) => { rec(x - r, y - r); rec(x + r, y + r); };
      if (k === 'ellipse') return (x: number, y: number, rx: number, ry: number) => { rec(x - rx, y - ry); rec(x + rx, y + ry); };
      if (k === 'rect' || k === 'roundRect' || k === 'fillRect' || k === 'strokeRect') return (x: number, y: number, w: number, h: number) => { rec(x, y); rec(x + w, y + h); };
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      return () => {};
    },
    set(o, k, v) {
      o[k] = v;
      if (k === 'strokeStyle' || k === 'fillStyle') colors.add(v);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  draw(ctx);
  return { pts, colors };
}

/** Every card has a title and plain text; every picture stays in its box all through its play. */
function checkPictures(rules: RuleCard[]): void {
  for (const r of rules) {
    expect(r.title.length, r.title).toBeGreaterThan(0);
    expect(r.text.length, r.title).toBeGreaterThan(0);
    expect(r.text, r.title).not.toMatch(/[<>]/);
    expect(r.demo, r.title).toBeUndefined();
    if (r.bad) expect(r.good, r.title).toBeDefined();
    for (const pic of [r.good, r.bad]) {
      if (!pic) continue;
      expect(pic.duration, r.title).toBeGreaterThanOrEqual(1.5);
      expect(pic.duration, r.title).toBeLessThanOrEqual(4);
      for (const [w, h] of [[140, 104], [120, 90]]) {
        for (let i = 0; i <= 40; i++) {
          const t = (pic.duration * i) / 40;
          const { pts } = record((ctx) => pic.draw(ctx, w, h, t));
          for (const [x, y] of pts) {
            expect(x, `${r.title} ${w}x${h} at ${t.toFixed(2)}s`).toBeGreaterThanOrEqual(-0.5);
            expect(x, `${r.title} ${w}x${h} at ${t.toFixed(2)}s`).toBeLessThanOrEqual(w + 0.5);
            expect(y, `${r.title} ${w}x${h} at ${t.toFixed(2)}s`).toBeGreaterThanOrEqual(-0.5);
            expect(y, `${r.title} ${w}x${h} at ${t.toFixed(2)}s`).toBeLessThanOrEqual(h + 0.5);
          }
        }
      }
    }
  }
}

describe('view', () => {
  it('has a rule card with a picture for every symbol and action', () => {
    const titles = RULES.map((r) => r.title);
    expect(titles).toEqual(['Probe', 'Counts', 'Marks', 'Clear around', 'Scatter cells', 'Quiet cells', 'Alpha beams', 'Bounce back', 'Beams granted', 'Direct hit', 'Ruined plate', 'Nuclei left']);
    checkPictures(RULES);
    for (const r of RULES) {
      expect(r.good, r.title).toBeDefined();
      expect(r.text).not.toMatch(/<|>/);
      expect(r.text.split(/[.!](\s|$)/).filter((x) => x && x.trim()).length).toBeLessThanOrEqual(2);
    }
    expect(INSTRUCTIONS).toMatch(/^\s*<h3>In the game<\/h3>\s*<p class="meta">[^<]+<\/p>\s*$/);
  });

  it('shows the mistake beside the right move, flagged in amber or by the board\'s own direct hit', () => {
    expect(RULES.filter((r) => r.bad).map((r) => r.title)).toEqual(['Clear around', 'Scatter cells', 'Beams granted', 'Direct hit', 'Ruined plate']);
    for (const r of RULES.filter((x) => x.bad)) {
      const bad = record((ctx) => r.bad!.draw(ctx, 140, 104, r.bad!.duration)).colors;
      expect(bad.has(C.warn) || ((r.title === 'Direct hit' || r.title === 'Ruined plate') && bad.has(C.bad)), r.title).toBe(true);
      expect(record((ctx) => r.good!.draw(ctx, 140, 104, r.good!.duration)).colors.has(C.warn), r.title).toBe(false);
      expect(record((ctx) => r.good!.draw(ctx, 140, 104, r.good!.duration)).colors.has(C.bad), r.title).toBe(false);
    }
  });

  it('never calls the hidden objects anything but nuclei', () => {
    const text = [INSTRUCTIONS, ...RULES.map((r) => `${r.title} ${r.text}`)].join(' ');
    // The banned words are spelled in pieces so they appear nowhere, not even here.
    expect(text).not.toMatch(new RegExp(['\\bmi', 'ne|swe', 'ep'].join(''), 'i'));
  });

  it('keeps the hint short', () => {
    const v = new RutherfordView(newRutherford(118, 2), true);
    expect(v.hint().length).toBeLessThanOrEqual(40);
    expect(v.hint()).toMatch(/^\d+ nuclei left · \d beams? · \d hits? left$/);
  });

  it('undo refunds a beam move but not its place in the beam count', () => {
    const s = newRutherford(30, 5);
    const v = new RutherfordView(s, true);
    const port = s.fired.findIndex((f, p) => !f && traceBeam(s, p).path.some((i) => !s.probed[i]));
    // Fire twice through the private path the pointer uses: aim, then fire.
    (v as unknown as { tapPort(p: number): void }).tapPort(port);
    expect(v.moves).toBe(0);
    (v as unknown as { tapPort(p: number): void }).tapPort(port);
    expect(v.moves).toBe(1);
    expect(v.beamsUsed).toBe(1);
    expect(v.undo()).toBe(true);
    expect(v.moves).toBe(0);
    expect(v.beamsUsed).toBe(1);
    // Firing the same port again costs nothing more.
    (v as unknown as { tapPort(p: number): void }).tapPort(port);
    (v as unknown as { tapPort(p: number): void }).tapPort(port);
    expect(v.beamsUsed).toBe(1);
    v.restart();
    expect(v.beamsUsed).toBe(0);
  });

  it('a hit spoils flawless even after undo, and the spare beam past par does too', () => {
    const s = newRutherford(10, 3);
    expect(s.beamLimit).toBe(s.beamPar + 1);
    const v = new RutherfordView(s, true);
    const nucleus = s.nuclei.findIndex((x, i) => x && !s.probed[i]);
    (v as unknown as { act(i: number, m: boolean): void }).act(nucleus, false);
    expect(v.clean).toBe(false);
    v.undo();
    expect(v.clean).toBe(false);
    const w = new RutherfordView(s, true);
    const fireAt = (p: number) => { (w as unknown as { tapPort(p: number): void }).tapPort(p); (w as unknown as { tapPort(p: number): void }).tapPort(p); };
    for (let p = 0; p < s.beamPar; p++) fireAt(p);
    expect(w.clean).toBe(true);
    fireAt(s.beamPar);
    expect(w.clean).toBe(false);
  });
});

describe('help', () => {
  type Inside = { state: RutherfordState; mark: { state: RutherfordState; cells: number[]; port: number } | null; act(i: number, m: boolean): void };
  const inside = (v: RutherfordView) => v as unknown as Inside;
  const DEALS = [1, 20, 21, 50, 51, 85, 86, 118].flatMap((z) => [1, 2, 3].map((seed) => ({ z, seed })));

  /** One plain sentence: no markup, no em dash. */
  const plain = (text: string) => {
    expect(text).toMatch(/^[A-Z][^<>\u2014]*\.$/);
    expect(text.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length).toBe(1);
  };

  /** The player's own move that turns a into b, if there is one: a probe, a mark or a beam. */
  const playerMove = (a: RutherfordState, b: RutherfordState): string | null => {
    for (let i = 0; i < a.nuclei.length; i++) {
      if (JSON.stringify(probe(a, i)) === JSON.stringify(b)) return 'probe';
      if (JSON.stringify(toggleMark(a, i)) === JSON.stringify(b)) return 'mark';
    }
    for (let p = 0; p < a.fired.length; p++) if (JSON.stringify(fire(a, p)) === JSON.stringify(b)) return 'beam';
    return null;
  };

  it('Look here marks a decided cell or a port and leaves the plate alone', () => {
    for (const { z, seed } of DEALS) {
      const v = new RutherfordView(newRutherford(z, seed), true);
      // On the fresh plate, then again a few moves in.
      for (let round = 0; round < 2; round++) {
        const before = inside(v).state, snap = JSON.stringify(before), moves = v.moves;
        const h = v.help(1)!;
        plain(h.text);
        expect(h.moved).toBeUndefined();
        expect(inside(v).state).toBe(before);
        expect(JSON.stringify(inside(v).state)).toBe(snap);
        expect(v.moves).toBe(moves);
        const m = inside(v).mark!;
        expect(m.state).toBe(before);
        expect(m.cells.length + (m.port >= 0 ? 1 : 0)).toBeGreaterThan(0);
        // The decided cell is still unknown; the numbers beside it are open.
        if (m.cells.length) {
          expect(before.probed[m.cells[0]]).toBe(false);
          for (const c of m.cells.slice(1)) expect(before.probed[c] && !before.nuclei[c]).toBe(true);
        } else expect(before.fired[m.port]).toBe(false);
        for (let k = 0; k < 4; k++) v.help(2);
        // Any move clears the mark.
        expect(inside(v).mark?.state).not.toBe(inside(v).state);
      }
    }
  });

  it('Show me finishes every plate with no hit, one player move at a time', () => {
    for (const { z, seed } of DEALS) {
      const s = newRutherford(z, seed);
      const v = new RutherfordView(s, true);
      let calls = 0;
      while (!v.won) {
        const a = inside(v).state;
        const h = v.help(2)!;
        plain(h.text);
        expect(h.moved).toBe(true);
        const b = inside(v).state;
        const kind = playerMove(a, b);
        expect(kind, `z ${z} seed ${seed} call ${calls}`).not.toBeNull();
        expect(v.moves - a.moves).toBe(kind === 'mark' ? 0 : 1);
        expect(++calls).toBeLessThanOrEqual(s.size * s.size);
      }
      expect(v.help(1)).toBeNull();
      expect(v.help(2)).toBeNull();
      // Never a direct hit, and no more beams than par.
      expect(v.clean, `z ${z} seed ${seed}`).toBe(true);
      expect(inside(v).state.beams).toBeLessThanOrEqual(s.beamPar);
      // Each step can be undone like the player's own.
      expect(v.undo()).toBe(true);
      expect(v.won).toBe(false);
    }
  });

  it('points at a mark on a safe cell, and Show me takes it off', () => {
    for (const { z, seed } of DEALS) {
      const s = newRutherford(z, seed);
      const v = new RutherfordView(s, true);
      const wrong = s.nuclei.findIndex((x, i) => !x && !s.probed[i]);
      inside(v).act(wrong, true);
      const marked = inside(v).state;
      expect(marked.marked[wrong]).toBe(true);
      const h = v.help(1)!;
      expect(h.text).toBe('This mark is on a safe cell.');
      expect(inside(v).mark!.cells).toEqual([wrong]);
      expect(inside(v).state).toBe(marked);
      const fix = v.help(2)!;
      expect(fix.moved).toBe(true);
      expect(inside(v).state.marked[wrong]).toBe(false);
      expect(JSON.stringify(inside(v).state)).toBe(JSON.stringify(toggleMark(marked, wrong)));
      expect(v.moves).toBe(marked.moves);
    }
  });

  it('trusts a mark only once the numbers prove it, and steps past a proved one', () => {
    for (const { z, seed } of DEALS) {
      const s = newRutherford(z, seed);
      const lead = nextLead(s)!;
      expect(lead).not.toBeNull();
      // A right but unproved mark changes nothing about what the numbers say.
      const j = s.nuclei.findIndex((x, i) => x && !s.probed[i] && !(lead.kind === 'cell' && lead.cell === i));
      expect(nextLead(toggleMark(s, j)!)).toEqual(lead);
      // Once a proved nucleus is marked, the lead moves on.
      if (lead.kind === 'cell' && lead.nucleus) expect(nextLead(toggleMark(s, lead.cell)!)).not.toEqual(lead);
    }
  });

  it('answers in well under 200 ms on every element', () => {
    let worst = 0;
    const time = (f: () => void) => { const t = performance.now(); f(); worst = Math.max(worst, performance.now() - t); };
    for (let z = 1; z <= 118; z++) {
      const v = new RutherfordView(newRutherford(z, z), true);
      for (let k = 0; k < 6 && !v.won; k++) { time(() => v.help(1)); time(() => v.help(2)); }
    }
    expect(worst).toBeLessThan(50);
  });
});
