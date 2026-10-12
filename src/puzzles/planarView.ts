// Drawing and touch for Planar: drag atoms until no two bonds cross. Atoms are silver beads
// with a dark core; bonds are thick lines, slate blue while clear and amber while they cross
// another bond or run through an atom, with an amber dot at every crossing. The atom in hand
// lights cyan. When nothing crosses, every bond glows green.
//
// The board is painted by `paintPlanar`, which the rule cards' pictures share.

import { ATOM_R, clonePlanar, crossPoint, moveAtom, nextMove, problemsOf, solved, worstAtom, type PlanarState, type Problems, type Pt } from './planar';
import { C } from './palette';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Planar is a reserve game, played from the Practice screen. The easiest board holds 6 atoms and 7 bonds; the hardest, 22 atoms and about 43 bonds, with the bonds per atom rising steadily in between. Every molecule is first laid out with no crossings, then dealt round a ring in a scrambled order, so it can always be untangled. Par is how many atoms that hidden layout moves, once it is turned to keep as many dealt atoms in place as it can. It is a soft target: any drawing with nothing crossing wins, and a good eye can sometimes beat it.</p>
`;

/** Clear bonds: a calm slate blue. */
const BOND = '#8fb0cc';
/** Above this many crossings, only the atom in hand's crossings are dotted. */
const DOTS = 24;
/** Milliseconds an atom glides when Show me or Undo moves it. */
const GLIDE = 320;
/** Milliseconds the green glow takes to come up on a win. */
const GLOW = 700;

/** The board square: its corner and side, in canvas pixels. */
interface Geo { x: number; y: number; s: number }

interface Paint {
  /** Flag crossings, bonds through atoms and atoms on atoms in amber. */
  mark: boolean;
  /** Atom radius in pixels. */
  r: number;
  /** The atom in hand, lit cyan. */
  held?: number;
  /** The win glow, 0 to 1: bonds turn green. */
  glow?: number;
  /** Problems already worked out for these positions. */
  problems?: Problems;
}

const at = (g: Geo, p: Pt): Point => ({ x: g.x + p.x * g.s, y: g.y + p.y * g.s });

/** Frame's nominal cell, so its stroke and padding match the grid games'. */
const frameCell = (s: number): number => Math.min(64, s / 6);

/** The frame round the board. */
function lattice(ctx: CanvasRenderingContext2D, g: Geo): void {
  const c = frameCell(g.s);
  drawFrame(ctx, frameBox(g.x, g.y, g.s, g.s, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c), color: C.frame });
}

/** An atom: a silver bead with a dark core, cyan when in hand, green-lit on a win. */
function atom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, held: boolean, glow: number): void {
  ctx.save();
  if (held) { ctx.shadowColor = C.accent; ctx.shadowBlur = r * 1.4; }
  else if (glow > 0) { ctx.shadowColor = C.good; ctx.shadowBlur = r * 1.2 * glow; }
  ctx.fillStyle = held ? C.accent : C.silver;
  ctx.beginPath();
  ctx.arc(x, y, r * (held ? 1.15 : 1), 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = C.tileInk;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Paints the board: the frame, every bond and every atom, with the problems in amber. */
export function paintPlanar(ctx: CanvasRenderingContext2D, pos: Pt[], edges: [number, number][], g: Geo, o: Paint): void {
  lattice(ctx, g);
  const r = o.r;
  const pr = o.mark ? (o.problems ?? problemsOf(pos, edges)) : null;
  const badEdge = new Set<number>();
  const badAtom = new Set<number>();
  if (pr) {
    for (const [e, f] of pr.crossings) { badEdge.add(e); badEdge.add(f); }
    for (const [e, k] of pr.through) { badEdge.add(e); badAtom.add(k); }
    for (const [a, b] of pr.overlaps) { badAtom.add(a); badAtom.add(b); }
  }
  const glow = o.glow ?? 0;
  // Thinner bonds on crowded boards, so the tangle stays readable.
  const lw = Math.max(2.5, r * (edges.length > 28 ? 0.32 : 0.42));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = lw;
  // Clear bonds first, then the amber ones on top so a crossing always reads.
  for (const pass of [false, true]) {
    edges.forEach(([a, b], e) => {
      if (badEdge.has(e) !== pass) return;
      const p = at(g, pos[a]), q = at(g, pos[b]);
      ctx.strokeStyle = pass ? C.warn : glow > 0 ? C.good : BOND;
      if (!pass && glow > 0) { ctx.shadowColor = C.good; ctx.shadowBlur = lw * 3 * glow; }
      ctx.globalAlpha = pass ? 1 : 0.9;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
  }
  ctx.restore();
  // A dot on every crossing, ringed in the board's black so it stands off both bonds. On a
  // thick tangle only the crossings of the atom in hand get one, so the dots stay meaningful.
  if (pr) {
    const many = pr.crossings.length > DOTS;
    const mine = (e: number) => o.held !== undefined && edges[e].includes(o.held);
    for (const [e, f] of pr.crossings) {
      if (many && !mine(e) && !mine(f)) continue;
      const [a, b] = edges[e], [c, d] = edges[f];
      const x = at(g, crossPoint(pos[a], pos[b], pos[c], pos[d]));
      ctx.fillStyle = C.bg;
      ctx.beginPath();
      ctx.arc(x.x, x.y, lw * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.warn;
      ctx.beginPath();
      ctx.arc(x.x, x.y, lw * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  pos.forEach((p, i) => {
    if (i === o.held) return;
    const q = at(g, p);
    if (badAtom.has(i)) {
      ctx.save();
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = Math.max(2, r * 0.3);
      ctx.beginPath();
      ctx.arc(q.x, q.y, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    atom(ctx, q.x, q.y, r, false, glow);
  });
  // The atom in hand last, over everything.
  if (o.held !== undefined && o.held >= 0) { const q = at(g, pos[o.held]); atom(ctx, q.x, q.y, r, true, 0); }
}

export class PlanarView implements PuzzleView {
  private state: PlanarState;
  private history: PlanarState[] = [];
  /** The drag under way: which atom, the board before it, and where on the atom it was taken. */
  private drag: { atom: number; before: PlanarState; off: Pt; from: Point; far: boolean } | null = null;
  private geo: Geo = { x: 0, y: 0, s: 0 };
  private reduced: boolean;
  private mark: { state: PlanarState; atom: number } | null = null;
  /** Atoms gliding to their places after Show me or Undo. */
  private glide: { from: Pt[]; to: PlanarState; at: number } | null = null;
  private wonAt: number | null = null;

  constructor(private readonly initial: PlanarState, reducedMotion: boolean) {
    this.state = clonePlanar(initial);
    this.reduced = reducedMotion;
  }

  /** Won once the last glide has landed and no atom is in hand. */
  get won(): boolean { return !this.drag && !this.gliding() && solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  stats(): { progress: Stat } {
    return { progress: { label: 'Crossings', value: String(problemsOf(this.state.pos, this.state.edges).crossings.length) } };
  }

  hint(): string {
    if (this.won) return 'Untangled: nothing crosses';
    const p = problemsOf(this.state.pos, this.state.edges);
    const c = p.crossings.length;
    if (c) return c === 1 ? '1 crossing left' : `${c} crossings left`;
    if (p.through.length) return 'A bond runs through an atom';
    if (p.overlaps.length) return 'Two atoms sit on each other';
    return 'Untangled: nothing crosses';
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    if (level === 2) {
      const m = nextMove(s);
      if (!m) return null;
      this.apply(moveAtom(s, m.atom, m.to), true);
      return { text: m.left > 1 ? `Moved an atom to its place in a clear layout: ${m.left - 1} more to go at most.` : 'Moved the last atom into place.', moved: true };
    }
    const a = worstAtom(s);
    if (a < 0) return null;
    this.mark = { state: s, atom: a };
    const p = problemsOf(s.pos, s.edges);
    const crosses = p.crossings.filter(([e, f]) => s.edges[e].includes(a) || s.edges[f].includes(a)).length;
    if (crosses) return { text: crosses === 1 ? 'One of this atom\'s bonds crosses another.' : `This atom's bonds cross ${crosses} times: the most on the board.` };
    if (p.overlaps.some(([x, y]) => x === a || y === a)) return { text: 'This atom sits on another one.' };
    return { text: 'A bond runs through this atom, or one of its bonds runs through another.' };
  }

  private apply(next: PlanarState | null, animate: boolean): void {
    if (!next) return;
    if (animate && !this.reduced) this.glide = { from: this.shown(), to: next, at: performance.now() };
    this.history.push(this.state);
    if (this.history.length > 200) this.history.shift();
    this.state = next;
  }

  restart(): void {
    this.state = clonePlanar(this.initial);
    this.history = [];
    this.drag = null;
    this.glide = null;
    this.wonAt = null;
  }

  canUndo(): boolean { return this.history.length > 0 && !this.drag; }

  undo(): boolean {
    if (this.drag) return false;
    const prev = this.history.pop();
    if (!prev) return false;
    if (!this.reduced) this.glide = { from: this.shown(), to: prev, at: performance.now() };
    this.state = prev;
    this.wonAt = null;
    return true;
  }

  private gliding(): boolean {
    const g = this.glide;
    return !!g && g.to === this.state && performance.now() - g.at < GLIDE;
  }

  /** Where the atoms show right now: part way along a glide, or where they are. */
  private shown(now = performance.now()): Pt[] {
    const g = this.glide;
    if (!g || g.to !== this.state) return this.state.pos;
    const k = ease((now - g.at) / GLIDE);
    return this.state.pos.map((p, i) => ({ x: g.from[i].x + (p.x - g.from[i].x) * k, y: g.from[i].y + (p.y - g.from[i].y) * k }));
  }

  // ---- input ----------------------------------------------------------------------

  private toBoard(p: Point): Pt {
    const g = this.geo;
    return { x: (p.x - g.x) / g.s, y: (p.y - g.y) / g.s };
  }

  down(p: Point): void {
    if (this.won || !this.geo.s) return;
    this.glide = null;
    const s = this.state;
    const r = ATOM_R * this.geo.s;
    // The nearest atom within a finger's reach.
    const reach = Math.max(24, r * 2.4);
    let best = -1, bestD = Infinity;
    s.pos.forEach((q, i) => {
      const c = { x: this.geo.x + q.x * this.geo.s, y: this.geo.y + q.y * this.geo.s };
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < reach && d < bestD) { best = i; bestD = d; }
    });
    if (best < 0) return;
    const b = this.toBoard(p);
    this.drag = { atom: best, before: s, off: { x: s.pos[best].x - b.x, y: s.pos[best].y - b.y }, from: p, far: false };
    this.state = clonePlanar(s);
  }

  move(p: Point): void {
    const d = this.drag;
    if (!d) return;
    if (Math.hypot(p.x - d.from.x, p.y - d.from.y) > 3) d.far = true;
    if (!d.far) return;
    const b = this.toBoard(p);
    const next = moveAtom(d.before, d.atom, { x: b.x + d.off.x, y: b.y + d.off.y });
    if (next) { next.moves = d.before.moves; this.state = next; }
  }

  up(p: Point): void {
    const d = this.drag;
    if (!d) return;
    this.move(p);
    this.drag = null;
    const a = d.before.pos[d.atom], b = this.state.pos[d.atom];
    if (!d.far || (a.x === b.x && a.y === b.y)) { this.state = d.before; return; }
    this.history.push(d.before);
    if (this.history.length > 200) this.history.shift();
    this.state.moves = d.before.moves + 1;
  }

  cancel(): void {
    const d = this.drag;
    this.drag = null;
    if (d) this.state = d.before;
  }

  key(): boolean { return false; }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const g = fitBoard(area, 8);
    this.geo = g;
    if (this.glide && (this.glide.to !== s || performance.now() - this.glide.at >= GLIDE)) this.glide = null;
    const pos = this.shown();
    const done = this.won;
    if (!done) this.wonAt = null;
    else this.wonAt ??= now;
    const glow = done ? (this.reduced ? 1 : Math.min(1, (now - this.wonAt!) / GLOW)) : 0;
    paintPlanar(ctx, pos, s.edges, g, { mark: true, r: ATOM_R * g.s, held: this.drag?.atom, glow });
    const m = this.mark?.state === s && !done && !this.drag ? this.mark : null;
    if (m) {
      const q = at(g, pos[m.atom]);
      const r = ATOM_R * g.s * 1.9;
      drawHelpMark(ctx, q.x - r, q.y - r, r * 2, r * 2, now, this.reduced, r);
    }
  }
}

/** The board square in an area: as big as fits, with room for the frame round it. */
function fitBoard(area: Area, margin: number): Geo {
  const guess = Math.max(1, Math.min(area.w, area.h) - margin * 2);
  const c = frameCell(guess);
  const room = framePad(c) + frameWidth(c) / 2 + 1;
  const s = Math.max(8, Math.min(area.w, area.h) - 2 * (margin + room));
  return { x: area.x + (area.w - s) / 2, y: area.y + (area.h - s) / 2, s };
}

// ---- rule pictures ---------------------------------------------------------------------

const LEAD = 0.4;
const DRAG = 0.8;
const REST = 0.6;

interface Drag { atom: number; to: [number, number] }

/**
 * One rule picture: atoms at [x, y] in board units with their bonds, then each drag in turn
 * (the atom lit in hand while it moves). A bad picture flags its problems in amber; a `win`
 * picture glows green once its last drag lands.
 */
function picture(atoms: [number, number][], edges: [number, number][], drags: Drag[], caption: string, o: { bad?: boolean; win?: boolean } = {}): Illustration {
  const raw = LEAD + drags.length * (DRAG + 0.15) + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  const start: Pt[] = atoms.map(([x, y]) => ({ x, y }));
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const u = t * pace;
      const pos = start.map((p) => ({ ...p }));
      let held: number | undefined;
      drags.forEach((d, k) => {
        const t0 = LEAD + k * (DRAG + 0.15);
        if (u < t0) return;
        const e = ease((u - t0) / DRAG);
        const from = { ...pos[d.atom] };
        pos[d.atom] = { x: from.x + (d.to[0] - from.x) * e, y: from.y + (d.to[1] - from.y) * e };
        if (u < t0 + DRAG) held = d.atom;
      });
      const g = fitBoard({ x: 0, y: 0, w, h }, 2);
      const end = LEAD + drags.length * (DRAG + 0.15);
      const glow = o.win ? Math.max(0, Math.min(1, (u - end) / 0.3)) : 0;
      paintPlanar(ctx, pos, edges, g, { mark: !!o.bad, r: g.s * 0.065, held, glow, problems: o.bad ? problemsOf(pos, edges, 0.065, 0.12) : undefined });
    },
  };
}

/** A square ring of atoms with a fifth inside, bonded to the top two. */
const RING: [number, number][] = [[0.18, 0.2], [0.82, 0.2], [0.82, 0.8], [0.18, 0.8], [0.5, 0.45]];
const RING_BONDS: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 0], [4, 1]];

export const RULES: RuleCard[] = [
  {
    title: 'Atoms',
    text: 'Drag an atom anywhere on the board, and its bonds stretch to follow it.',
    good: picture([[0.2, 0.25], [0.55, 0.15], [0.82, 0.45], [0.45, 0.8]], [[0, 1], [1, 2], [2, 3], [3, 0]], [{ atom: 3, to: [0.25, 0.75] }, { atom: 2, to: [0.8, 0.8] }], 'Drag, bonds follow'),
  },
  {
    title: 'No crossing',
    text: 'Bonds may meet only at the atoms they join. A bond that crosses another turns amber.',
    good: picture(RING, RING_BONDS, [{ atom: 4, to: [0.62, 0.62] }], 'All clear'),
    bad: picture(RING, RING_BONDS, [{ atom: 4, to: [0.5, 0.91] }], 'Bonds cross', { bad: true }),
  },
  {
    title: 'Not through atoms',
    text: 'A bond may not run through an atom it does not join, and two atoms may not sit on each other.',
    good: picture(RING, RING_BONDS, [{ atom: 4, to: [0.5, 0.62] }], 'Clear of the atoms'),
    bad: picture(RING, RING_BONDS, [{ atom: 4, to: [0.5, 0.8] }], 'Through an atom', { bad: true }),
  },
  {
    title: 'Untangle',
    text: 'Each drag is a move, and par is how many atoms a known clear layout moves. When nothing crosses, the molecule glows green.',
    good: picture([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.5, 0.5]], [[0, 1], [1, 2], [2, 3], [3, 0], [4, 0], [4, 2]], [{ atom: 4, to: [0.45, 0.4] }, { atom: 1, to: [0.75, 0.3] }], 'Two drags, all clear', { win: true }),
  },
];
