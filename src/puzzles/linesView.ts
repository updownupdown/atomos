// Drawing and touch for Field Lines: press a + charge and drag along the
// channels between the tiles; let go on a − charge at the rim to check the
// line. Arrows draw from the keyboard, Enter checks, Backspace steps back,
// Escape clears.
//
// The board is painted by `paintLines`, which the rule cards' demos share, so
// every symbol in the Instructions modal is drawn exactly as on the board.

import { adjacent, check, clearPath, cloneLines, completeLine, edgeKey, edgeOf, extend, isEnd, isStart, nextStretch, pathEdges, regions, retract, same, sharedPrefix, solved, verdict, type Kind, type LinesState, type Mark, type Near, type Pt } from './lines';
import { drawFrame, framePad, frameWidth, type FrameGap } from './frame';
import { bead, C, fitGrid, tile } from './palette';
import { drawHelpMark, ease, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

const FLASH_MS = 700;
const GRAB = 0.45;
/** One slow breath of the glow on the line's head, in ms. */
const BREATH_MS = 2400;

interface Failure {
  /** The state the failure belongs to; any edit retires it. */
  state: LinesState;
  failed: number[];
  missed: string[];
  at: number;
}

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">A facet puzzle. Grids grow from 4×4 tiles (H to K, z 1–19) to 5×5 (Ca to Cs, 20–55) and 6×6 (from Ba, 56). Marks arrive in bands so each one is introduced on its own terms: beads and orbitals from H; bars from Mg (12); gaps from Cr (24); pairs from Kr (36); shapes from Sn (50). From Gd (64) every level draws one of the heavier marks (bars, pairs, shapes) plus one or two partners, with three-mark levels growing more common toward the end of the table; from Hg (80) about half the boards get a second + charge or a second − charge. Mark counts rise gently with the element.</p>
<p class="meta">Every level is read off a hidden line, so it always has an answer; any line that meets every mark wins, not only the hidden one. Par is one check: a line that wins the first time it is checked counts as clean. Each release on a − charge is one check (one move).</p>
`;

// ---- the shared painter ----------------------------------------------------------------

/** Where the board sits: node (0, 0) in pixels and the cell size. */
interface Grid { x: number; y: number; c: number }

/** Everything about one frame of the board apart from the level itself. */
interface Paint {
  path: Pt[];
  /** The live end of the line while it is being drawn, in pixels. */
  tip: Point | null;
  /** Marks broken at the last check, how bright their flash is (0 to 1), and whether the line shows red. */
  failed: ReadonlySet<number>;
  missed: ReadonlySet<string>;
  pulse: number;
  red: boolean;
  won: boolean;
  /** How far the win glow has grown, 0 to 1. */
  wonT: number;
  /** A refused step at the pen tip, 1 fresh to 0 gone. */
  bump: number;
  /** The start picked by Tab, or -1. */
  picked: number;
  /** Soft glows on (off under reduced motion). */
  glow: boolean;
  /**
   * The glowing dot on the line's head, where it can be picked up and drawn on:
   * how bright its glow breathes (0 to 1), or null for none.
   */
  head: number | null;
  /** A fill per tile, for the pockets picture; null for the board's own. */
  tint?: (i: number) => string | null;
  /** The color broken marks, a red line and a refused step are flagged in: the board's red, or amber in the rule pictures. */
  flag?: string;
}

const px = (g: Grid, p: Pt): Point => ({ x: g.x + p.x * g.c, y: g.y + p.y * g.c });

/** The way an end's terminal points out of the board. */
function tailDir(s: LinesState, end: Pt): Pt {
  if (end.x === 0) return { x: -1, y: 0 };
  if (end.x === s.cols) return { x: 1, y: 0 };
  if (end.y === 0) return { x: 0, y: -1 };
  if (end.y === s.rows) return { x: 0, y: 1 };
  return { x: 0, y: -1 };
}

/** The − terminal of an end: its center and radius. */
function terminal(g: Grid, node: Point, td: Pt): { x: number; y: number; r: number } {
  const r = Math.max(5, g.c * 0.12);
  return { x: node.x + td.x * g.c * 0.3, y: node.y + td.y * g.c * 0.3, r };
}

function paintLines(ctx: CanvasRenderingContext2D, s: LinesState, g: Grid, o: Paint): void {
  const { c } = g;
  const path = o.path;
  const covered = pathEdges(path);
  const lw = Math.max(4, c * 0.12);
  const last = path[path.length - 1];
  const flagCol = o.flag ?? C.bad;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The frame round the board, opened where a charge sits on it: a + charge on the rim sits in
  // its gap like the logo's electrons, and a − charge's stub leaves through one.
  boardFrame(ctx, s, g);

  // Tiles, with channels between them where the line runs.
  const inset = c * 0.1;
  for (let i = 0; i < s.cols * s.rows; i++) {
    const q = px(g, { x: i % s.cols, y: Math.floor(i / s.cols) });
    tile(ctx, q.x + inset, q.y + inset, c - inset * 2, c - inset * 2, c * 0.18, o.tint?.(i) ?? C.surface, null);
  }

  // Channels, broken where there is a gap.
  const gaps = new Set(s.gaps);
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = Math.max(1.5, c * 0.045);
  ctx.beginPath();
  const channel = (a: Pt, b: Pt) => {
    const p = px(g, a), q = px(g, b);
    if (gaps.has(edgeKey(a, b))) {
      const f = 0.3; // the middle 40% is missing
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f);
      ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + (p.x - q.x) * f, q.y + (p.y - q.y) * f);
    } else {
      ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
    }
  };
  for (let y = 0; y <= s.rows; y++) for (let x = 0; x <= s.cols; x++) {
    if (x < s.cols) channel({ x, y }, { x: x + 1, y });
    if (y < s.rows) channel({ x, y }, { x, y: y + 1 });
  }
  ctx.stroke();
  // Gap ends get small caps so the break reads as deliberate.
  ctx.fillStyle = C.line3;
  for (const k of s.gaps) {
    const [a, b] = edgeOf(k).map((p) => px(g, p));
    for (const [p, q] of [[a, b], [b, a]]) {
      ctx.beginPath();
      ctx.arc(p.x + (q.x - p.x) * 0.3, p.y + (q.y - p.y) * 0.3, Math.max(2, c * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cell marks.
  const markGlow = o.won && o.glow;
  for (let i = 0; i < s.marks.length; i++) {
    const m = s.marks[i];
    if (!m) continue;
    const q = px(g, { x: i % s.cols + 0.5, y: Math.floor(i / s.cols) + 0.5 });
    if (o.failed.has(i)) {
      ctx.save();
      ctx.globalAlpha = o.pulse;
      tile(ctx, q.x - c * 0.36, q.y - c * 0.36, c * 0.72, c * 0.72, c * 0.16, null, flagCol, Math.max(1.5, c * 0.035));
      ctx.restore();
    }
    drawMark(ctx, m, q.x, q.y, c, markGlow);
  }

  // Edge beads.
  for (const k of s.dots) {
    const [a, b] = edgeOf(k).map((p) => px(g, p));
    const on = covered.has(k);
    const r = Math.max(4, c * 0.09);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (o.missed.has(k)) bead(ctx, mx, my, r * 1.15, flagCol, { alpha: 0.5 + 0.5 * o.pulse, glow: o.glow ? flagCol : undefined });
    else bead(ctx, mx, my, r, on ? C.silver : C.silverDim, { rim: on ? undefined : C.pewter, glow: on && o.glow ? C.silver : undefined });
  }

  // The line: a soft halo under a bright core, running into the − terminal once it arrives.
  const reached = !!last && isEnd(s, last) && path.length > 1;
  if (path.length) {
    const pts = path.map((p) => px(g, p));
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
      if (o.tip) ctx.lineTo(o.tip.x, o.tip.y);
      if (reached && !o.tip) {
        const td = tailDir(s, last);
        const q = pts[pts.length - 1];
        const t = terminal(g, q, td);
        ctx.lineTo(t.x - td.x * t.r, t.y - td.y * t.r);
      }
    };
    ctx.save();
    ctx.strokeStyle = o.red ? flagCol : C.silver;
    ctx.globalAlpha = o.red ? 0.22 : 0.12 + 0.18 * o.wonT;
    ctx.lineWidth = c * (0.28 + 0.1 * o.wonT);
    trace();
    ctx.stroke();
    ctx.restore();
    ctx.save();
    if (o.won && o.glow) { ctx.shadowColor = C.silver; ctx.shadowBlur = c * 0.25 * o.wonT; }
    ctx.strokeStyle = o.red ? flagCol : C.silver;
    ctx.globalAlpha = o.red ? 0.55 + 0.45 * o.pulse : 1;
    ctx.lineWidth = lw;
    trace();
    ctx.stroke();
    ctx.restore();
  }

  // − charges at the rim: where a line may finish, in the target red.
  for (const end of s.ends) {
    const node = px(g, end);
    const arrived = reached && same(last, end) && !o.tip;
    endCharge(ctx, g, node, tailDir(s, end), arrived, o.won && o.glow);
  }

  // + charges: where a line may begin, drawn over the line it sends out.
  s.starts.forEach((st, k) => {
    const q = px(g, st);
    const begun = path.length > 0 && same(path[0], st);
    startCharge(ctx, q.x, q.y, c, begun, k === o.picked, o.glow);
  });

  // The head of the line: a glowing dot in the line's color, to pick up and draw on from.
  if (o.head !== null && path.length > 1) {
    const q = o.tip ?? px(g, last);
    lineHead(ctx, q.x, q.y, c, o.red ? flagCol : C.silver, o.head);
  }

  // A nudge at the pen tip when a step was refused.
  if (o.bump > 0 && path.length) {
    const q = o.tip ?? px(g, path[path.length - 1]);
    ctx.strokeStyle = flagCol;
    ctx.globalAlpha = 0.8 * o.bump;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(q.x, q.y, c * (0.2 + 0.1 * (1 - o.bump)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** The frame round a board, with a gap wherever a charge would sit on its line. */
function boardFrame(ctx: CanvasRenderingContext2D, s: LinesState, g: Grid): void {
  const { c } = g;
  const p = framePad(c), lw = frameWidth(c);
  const box = { x: g.x - p, y: g.y - p, w: s.cols * c + p * 2, h: s.rows * c + p * 2 };
  // The corner's curve keeps clear of the corner node, where two rim channels meet square: the
  // node sits (r - p)·√2 from the arc's center, so r can be no more than this for the stroke's
  // inner edge to pass it with a few pixels to spare.
  const spare = lw / 2 + Math.max(1.5, c * 0.045) / 2 + Math.max(3, c * 0.05);
  const r = Math.max(lw, Math.min(c * 0.2 + p, (p * Math.SQRT2 - spare) / (Math.SQRT2 - 1), box.w / 2, box.h / 2));
  const clear = lw * 0.9;
  const holes: Hole[] = [];
  // A + charge's bead, where it reaches the frame's line.
  const rs = startRadius(c);
  for (const st of s.starts) holes.push({ at: px(g, st), r: rs + clear });
  // A − charge: where its stub crosses the line, as wide as its ring.
  for (const end of s.ends) {
    const node = px(g, end), td = tailDir(s, end), t = terminal(g, node, td);
    holes.push({ at: { x: node.x + td.x * p, y: node.y + td.y * p }, r: t.r + clear, cross: true });
  }
  frameWithHoles(ctx, box, r, lw, holes);
}

/** Something on the frame's line that it must open round: a disc at `at`, or (`cross`) a stub crossing the line there, `r` either side. */
interface Hole { at: Point; r: number; cross?: boolean }

type Box = { x: number; y: number; w: number; h: number };

/** A point on the frame's center line, `d` along it from where roundRect starts (x + r, y), running clockwise. */
function along(b: Box, r: number, d: number): Point {
  const sw = b.w - 2 * r, sh = b.h - 2 * r, q = (Math.PI * r) / 2;
  const arc = (cx: number, cy: number, a0: number, u: number): Point => ({ x: cx + r * Math.cos(a0 + u / Math.max(r, 1e-6)), y: cy + r * Math.sin(a0 + u / Math.max(r, 1e-6)) });
  if (d < sw) return { x: b.x + r + d, y: b.y };
  d -= sw;
  if (d < q) return arc(b.x + b.w - r, b.y + r, -Math.PI / 2, d);
  d -= q;
  if (d < sh) return { x: b.x + b.w, y: b.y + r + d };
  d -= sh;
  if (d < q) return arc(b.x + b.w - r, b.y + b.h - r, 0, d);
  d -= q;
  if (d < sw) return { x: b.x + b.w - r - d, y: b.y + b.h };
  d -= sw;
  if (d < q) return arc(b.x + r, b.y + b.h - r, Math.PI / 2, d);
  d -= q;
  if (d < sh) return { x: b.x, y: b.y + b.h - r - d };
  return arc(b.x + r, b.y + r, Math.PI, d - sh);
}

/**
 * Draws the frame with an opening round each hole that reaches its line. The openings are found
 * along the frame's own path (so one at a corner follows the curve), merged where they meet,
 * and handed to drawFrame as gaps. drawFrame's path starts at the top-left corner, and an
 * opening over that point would leave a stray round cap there, so when one does the frame is
 * drawn mirrored (the box maps onto itself) to start the path at another corner.
 */
function frameWithHoles(ctx: CanvasRenderingContext2D, box: Box, r: number, lw: number, holes: Hole[]): void {
  const sw = box.w - 2 * r, sh = box.h - 2 * r, q = (Math.PI * r) / 2;
  const total = 2 * sw + 2 * sh + 4 * q;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const n = Math.max(8, Math.ceil(total / 1.5));
  for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const cuts: [number, number][] = [];
    for (const h of holes) {
      const p = { x: cx + (h.at.x - cx) * fx, y: cy + (h.at.y - cy) * fy };
      let best = 0, bd = Infinity;
      for (let k = 0; k < n; k++) {
        const d = (k / n) * total, o = along(box, r, d), e = Math.hypot(o.x - p.x, o.y - p.y);
        if (e < bd) { bd = e; best = d; }
      }
      // How far either way the opening runs: the hole's reach where its line crosses, plus the
      // stroke's own half width.
      const reach = h.cross ? h.r : bd < h.r + lw / 2 ? Math.sqrt((h.r + lw / 2) ** 2 - bd * bd) : 0;
      if (!h.cross && bd >= h.r + lw / 2) continue;
      cuts.push([best - reach, best + reach]);
    }
    // An opening over the path's start (or its end, the same point) would leave a stray cap.
    if (cuts.some(([a, b]) => a < lw || b > total - lw)) continue;
    cuts.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const k of cuts) {
      const last = merged[merged.length - 1];
      if (last && k[0] <= last[1] + lw) last[1] = Math.max(last[1], k[1]);
      else merged.push([...k]);
    }
    const gaps = merged.map(([a, b]) => gapAt(box, r, (a + b) / 2, b - a));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(fx, fy);
    ctx.translate(-cx, -cy);
    drawFrame(ctx, box, { width: lw, radius: r, gaps });
    ctx.restore();
    return;
  }
  // Openings at all four corners: no start is free, so draw it whole rather than with a stray cap.
  drawFrame(ctx, box, { width: lw, radius: r });
}

/**
 * A gap of `size` centered `d` along the frame's path. drawFrame places a top-side gap at
 * (at - x - r) along the path, and that holds past the top run too, round every corner and side,
 * so any point of the path can be named as a top-side gap.
 */
function gapAt(b: Box, r: number, d: number, size: number): FrameGap {
  return { side: 'top', at: b.x + r + d, size };
}

/** A + charge's radius. */
const startRadius = (c: number): number => Math.max(11, c * 0.26);

/**
 * The head of a line: a dot in the line's color with a soft glow that breathes
 * with `breath` (0 to 1), and a faint halo, so it reads as a handle to pick up.
 */
function lineHead(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, col: string, breath: number): void {
  const r = Math.max(5, c * 0.12);
  ctx.save();
  ctx.fillStyle = col;
  ctx.globalAlpha = 0.14 + 0.1 * breath;
  ctx.beginPath();
  ctx.arc(x, y, r * (1.75 + 0.15 * breath), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowColor = col;
  ctx.shadowBlur = c * (0.22 + 0.16 * breath);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Twice over, so the glow carries on a dark board.
  ctx.fill();
  ctx.restore();
}

/** A + charge: a warm proton-colored bead with a bold plus, where a line begins. */
function startCharge(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, begun: boolean, picked: boolean, glow: boolean): void {
  const r = startRadius(c);
  bead(ctx, x, y, r, C.proton, { rim: begun ? C.silver : undefined, glow: begun && glow ? C.proton : undefined });
  ctx.save();
  ctx.strokeStyle = C.tileInk;
  ctx.lineWidth = Math.max(2, r * 0.2);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.52, y); ctx.lineTo(x + r * 0.52, y);
  ctx.moveTo(x, y - r * 0.52); ctx.lineTo(x, y + r * 0.52);
  ctx.stroke();
  if (picked) {
    // Keyboard pick between two starts.
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = Math.max(1.5, c * 0.035);
    ctx.beginPath();
    ctx.arc(x, y, r + Math.max(3, c * 0.06), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A − charge just outside the rim: a red ring with a minus, tied to its node by a short stub. */
function endCharge(ctx: CanvasRenderingContext2D, g: Grid, node: Point, td: Pt, arrived: boolean, glow: boolean): void {
  const t = terminal(g, node, td);
  ctx.save();
  ctx.strokeStyle = C.target;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, g.c * 0.04);
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(node.x, node.y);
  ctx.lineTo(t.x - td.x * t.r, t.y - td.y * t.r);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.bg;
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
  ctx.fill();
  if (arrived) {
    if (glow) { ctx.shadowColor = C.target; ctx.shadowBlur = t.r * 1.5; }
    ctx.fillStyle = C.target;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
  ctx.lineWidth = Math.max(1.5, g.c * 0.045);
  ctx.stroke();
  ctx.strokeStyle = arrived ? C.silver : C.target;
  ctx.lineWidth = Math.max(1.5, t.r * 0.28);
  ctx.beginPath();
  ctx.moveTo(t.x - t.r * 0.48, t.y);
  ctx.lineTo(t.x + t.r * 0.48, t.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * An orbital's outline in miniature, in its sub-shell color: s round, p two
 * lobes, d four, f six. Filled for an orbital mark, hollow for a pair.
 */
function orbital(ctx: CanvasRenderingContext2D, k: Kind, x: number, y: number, r: number, hollow: boolean, lw: number): void {
  const col = C[k];
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  const paint = () => { if (hollow) ctx.stroke(); else ctx.fill(); };
  if (k === 's') {
    ctx.beginPath();
    ctx.arc(x, y, r * (hollow ? 0.6 : 0.62), 0, Math.PI * 2);
    paint();
    return;
  }
  const n = k === 'p' ? 2 : k === 'd' ? 4 : 6;
  // p leans on a diagonal so its hollow outline never reads as an 8.
  const a0 = k === 'f' ? -Math.PI / 2 : -Math.PI / 4;
  const half = k === 'p' ? 0.36 : k === 'd' ? 0.28 : 0.2;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const len = r * (hollow ? 0.94 : 1);
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5, len * 0.5, r * half, a, 0, Math.PI * 2);
    paint();
  }
}

/** One cell symbol, centered on (x, y). */
function drawMark(ctx: CanvasRenderingContext2D, m: Mark, x: number, y: number, c: number, glow: boolean): void {
  ctx.save();
  switch (m.type) {
    case 'color':
    case 'pair': {
      if (glow) { ctx.shadowColor = C[m.c]; ctx.shadowBlur = c * 0.2; }
      orbital(ctx, m.c, x, y, c * 0.24, m.type === 'pair', Math.max(1.5, c * 0.045));
      break;
    }
    case 'count': {
      // Bars: one to three upright strokes, a tally of the sides the line runs along.
      const h = c * 0.28;
      const gap = c * 0.11;
      if (glow) { ctx.shadowColor = C.silver; ctx.shadowBlur = c * 0.15; }
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = Math.max(2, c * 0.055);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < m.n; k++) {
        const bx = x + (k - (m.n - 1) / 2) * gap;
        ctx.moveTo(bx, y - h / 2);
        ctx.lineTo(bx, y + h / 2);
      }
      ctx.stroke();
      break;
    }
    case 'shape': {
      // Beads joined by bonds, the shape's own outline in miniature.
      const w = Math.max(...m.cells.map((p) => p.x)) + 1, h = Math.max(...m.cells.map((p) => p.y)) + 1;
      const pitch = Math.min(c * 0.2, (c * 0.62) / Math.max(w, h));
      const ox = x - ((w - 1) * pitch) / 2, oy = y - ((h - 1) * pitch) / 2;
      const has = new Set(m.cells.map((p) => `${p.x},${p.y}`));
      ctx.strokeStyle = C.pewter;
      ctx.lineWidth = Math.max(1.5, pitch * 0.22);
      ctx.beginPath();
      for (const p of m.cells) {
        if (has.has(`${p.x + 1},${p.y}`)) { ctx.moveTo(ox + p.x * pitch, oy + p.y * pitch); ctx.lineTo(ox + (p.x + 1) * pitch, oy + p.y * pitch); }
        if (has.has(`${p.x},${p.y + 1}`)) { ctx.moveTo(ox + p.x * pitch, oy + p.y * pitch); ctx.lineTo(ox + p.x * pitch, oy + (p.y + 1) * pitch); }
      }
      ctx.stroke();
      for (const p of m.cells) bead(ctx, ox + p.x * pitch, oy + p.y * pitch, Math.max(2, pitch * 0.32), C.silverDim, { glow: glow ? C.silver : undefined });
      break;
    }
  }
  ctx.restore();
}

// ---- the view ------------------------------------------------------------------------

export class LinesView implements PuzzleView {
  private state: LinesState;
  private history: LinesState[] = [];
  private drawing = false;
  private pointer: Point | null = null;
  private failure: Failure | null = null;
  private wonAt = 0;
  private bumpAt = 0;
  private startPick = 0;
  private grid: Grid = { x: 0, y: 0, c: 40 };
  private reduced: boolean;
  /** The whole line the hints last steered by, kept while the drawn line follows it. */
  private route: Pt[] | null = null;
  private steered: { state: LinesState; route: Pt[]; off: number; sure: boolean } | null = null;
  /** Look here: the nodes to ring and the mark they pass, for the board it was asked on. */
  private mark: { state: LinesState; nodes: Pt[]; near: Near | null } | null = null;

  constructor(private readonly initial: LinesState, reducedMotion: boolean) {
    this.state = cloneLines(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  stats(): { progress?: Stat } {
    const s = this.state;
    if (!s.dots.length) return {};
    const edges = pathEdges(s.path);
    return { progress: { label: 'Dots', value: `${s.dots.filter((k) => edges.has(k)).length}/${s.dots.length}` } };
  }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'Every mark is met';
    const f = this.liveFailure();
    if (f) {
      const n = f.failed.length + f.missed.length;
      return n ? `${n} mark${n === 1 ? '' : 's'} broken` : 'Not a lawful line';
    }
    return '';
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (this.won) return null;
    const { route, off, sure } = this.steer();
    if (off >= 0) {
      // No finish of the line turned up: back to where it leaves the hidden walk, which surely works.
      const restart = off === 0;
      if (level === 2) {
        this.drawing = false;
        this.pointer = null;
        this.remember();
        this.state = { ...cloneLines(s), path: (restart ? [route[0]] : s.path.slice(0, off)).map((q) => ({ ...q })) };
        return { text: restart ? 'Moved the line to the other start.' : sure ? 'Took the line back to where it went wrong.' : 'Took the line back to a point that works.', moved: true };
      }
      this.mark = { state: s, nodes: restart ? [s.path[0], route[0]] : s.path.slice(off - 1, off + 1), near: null };
      if (restart) return { text: sure ? 'The line has to start from the other charge.' : 'The line may not work from this start, so try the other one.' };
      return { text: sure ? 'The line goes the wrong way here.' : 'The line may not work past here, so try another way.' };
    }
    const drawn = s.path.length;
    if (drawn === route.length) {
      // The whole line is down, only not checked yet.
      if (level === 2) { this.drawing = false; this.judge(); return { text: 'Checked the line.', moved: true }; }
      this.mark = { state: s, nodes: [route[route.length - 1]], near: null };
      return { text: 'The line is done, so check it.' };
    }
    const { nodes, near } = nextStretch(s, route, drawn);
    if (level === 2) {
      this.stroke(nodes);
      return { text: this.won ? 'Finished the line.' : 'Drew the next stretch of the line.', moved: true };
    }
    this.mark = { state: s, nodes: drawn ? [s.path[drawn - 1], ...nodes] : nodes, near };
    return { text: nearText(s, near, isEnd(s, nodes[nodes.length - 1]) && drawn + nodes.length === route.length) };
  }

  /**
   * The line the hints steer by, and where the drawn line leaves it (-1 while
   * it follows). The hidden walk comes first, then the last route, then any
   * lawful finish of the line as drawn. When none turns up, the line has gone
   * wrong, and `off` is where it leaves the hidden walk; `sure` says the
   * search proved there is no finish, rather than giving up.
   */
  private steer(): { route: Pt[]; off: number; sure: boolean } {
    const s = this.state;
    if (this.steered?.state === s) return this.steered;
    const keep = (route: Pt[], off: number, sure: boolean) => (this.steered = { state: s, route, off, sure });
    for (const r of [s.solution, this.route]) if (r && sharedPrefix(s.path, r) === s.path.length) return keep(r, -1, true);
    const found = completeLine(s, s.path, undefined, s.solution);
    if (found.line) return keep(this.route = found.line, -1, true);
    return keep(s.solution, sharedPrefix(s.path, s.solution), found.sure);
  }

  /** Draws on through `nodes` as one stroke of the pen, and checks the line if it lets go on a − charge. */
  private stroke(nodes: Pt[]): void {
    this.drawing = false;
    this.pointer = null;
    this.remember();
    let st = this.state;
    const fresh = !st.path.length;
    if (fresh) st = { ...cloneLines(st), path: [{ ...nodes[0] }] };
    for (const n of fresh ? nodes.slice(1) : nodes) st = extend(st, n) ?? st;
    this.state = st;
    const last = st.path[st.path.length - 1];
    if (st.path.length > 1 && isEnd(st, last)) this.judge();
  }

  restart(): void {
    this.state = cloneLines(this.initial);
    this.history = [];
    this.drawing = false;
    this.pointer = null;
    this.failure = null;
    this.wonAt = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.drawing = false;
    this.pointer = null;
    return true;
  }

  private remember(): void {
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
  }

  private liveFailure(): Failure | null {
    return this.failure && this.failure.state === this.state ? this.failure : null;
  }

  private judge(): void {
    const v = verdict(this.state, this.state.path);
    this.remember();
    this.state = check(this.state);
    if (this.state.won) this.wonAt = performance.now();
    else this.failure = { state: this.state, failed: v.failed, missed: v.missed, at: performance.now() };
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): void {
    this.grid = boardGrid(area, this.state, 8, 72);
  }

  private px(p: Pt): Point {
    return px(this.grid, p);
  }

  /** The node under a point, when close enough to grab. */
  private nodeAt(p: Point): Pt | null {
    const { x, y, c } = this.grid;
    const n = { x: Math.round((p.x - x) / c), y: Math.round((p.y - y) / c) };
    if (n.x < 0 || n.y < 0 || n.x > this.state.cols || n.y > this.state.rows) return null;
    const q = this.px(n);
    return Math.hypot(p.x - q.x, p.y - q.y) <= c * GRAB ? n : null;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void {
    if (this.won) return;
    const s = this.state;
    const n = this.nodeAt(p);
    if (!n) return;
    const at = s.path.findIndex((q) => same(q, n));
    if (at >= 0) {
      // Pick the line up at any point on it: the rest is lifted off.
      this.remember();
      if (at < s.path.length - 1) this.state = { ...cloneLines(s), path: s.path.slice(0, at + 1).map((q) => ({ ...q })) };
      this.drawing = true;
      this.pointer = p;
      return;
    }
    if (isStart(s, n)) {
      this.remember();
      this.state = { ...cloneLines(s), path: [{ ...n }] };
      this.drawing = true;
      this.pointer = p;
    }
  }

  move(p: Point): void {
    if (!this.drawing) return;
    this.pointer = p;
    const { c } = this.grid;
    // Step toward the pointer one node at a time, so a quick flick still lays a continuous line.
    for (let guard = 0; guard < 4; guard++) {
      const last = this.state.path[this.state.path.length - 1];
      if (!last) return;
      const q = this.px(last);
      const dx = p.x - q.x, dy = p.y - q.y;
      if (Math.abs(dx) < c * 0.55 && Math.abs(dy) < c * 0.55) return;
      const step = Math.abs(dx) > Math.abs(dy) ? { x: last.x + Math.sign(dx), y: last.y } : { x: last.x, y: last.y + Math.sign(dy) };
      const next = extend(this.state, step);
      if (!next) {
        // Blocked straight ahead: allow the other axis if the pointer has clearly left the line.
        const alt = Math.abs(dx) > Math.abs(dy) ? { x: last.x, y: last.y + Math.sign(dy) } : { x: last.x + Math.sign(dx), y: last.y };
        const alternative = (Math.abs(dx) > Math.abs(dy) ? Math.abs(dy) : Math.abs(dx)) > c * 0.55 ? extend(this.state, alt) : null;
        if (!alternative) return;
        this.state = alternative;
        continue;
      }
      this.state = next;
    }
  }

  up(p: Point): void {
    if (!this.drawing) return;
    this.move(p);
    this.drawing = false;
    this.pointer = null;
    const last = this.state.path[this.state.path.length - 1];
    if (last && this.state.path.length > 1 && isEnd(this.state, last)) this.judge();
  }

  cancel(): void {
    this.drawing = false;
    this.pointer = null;
  }

  key(e: KeyboardEvent): boolean {
    if (this.won) return false;
    const s = this.state;
    const dir: Record<string, Pt> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const d = dir[e.key];
    if (d) {
      e.preventDefault();
      let st = s;
      if (!st.path.length) st = extend(st, st.starts[this.startPick % st.starts.length]) ?? st;
      const last = st.path[st.path.length - 1];
      const next = extend(st, { x: last.x + d.x, y: last.y + d.y });
      if (next) { this.remember(); this.state = next; }
      else this.bumpAt = performance.now();
      return true;
    }
    if (e.key === 'Tab' && s.starts.length > 1 && !s.path.length) {
      e.preventDefault();
      this.startPick = (this.startPick + 1) % s.starts.length;
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const last = s.path[s.path.length - 1];
      if (last && s.path.length > 1 && isEnd(s, last)) this.judge();
      else this.bumpAt = performance.now();
      return true;
    }
    if (e.key === 'Backspace') {
      const next = retract(s);
      if (next) { this.remember(); this.state = next; }
      return true;
    }
    if (e.key === 'Escape') {
      const next = clearPath(s);
      if (next) { this.remember(); this.state = next; }
      return true;
    }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.layout(area);
    const s = this.state;
    const won = this.won;
    const fail = this.liveFailure();
    const path = s.path;
    const tip = this.drawing && this.pointer && path.length ? this.tipPoint(this.px(path[path.length - 1]), path[path.length - 1]) : null;
    paintLines(ctx, s, this.grid, {
      path,
      tip,
      failed: new Set(fail?.failed ?? []),
      missed: new Set(fail?.missed ?? []),
      pulse: fail ? (this.reduced ? 1 : flash(now - fail.at)) : 0,
      red: !!fail,
      won,
      wonT: won ? (this.reduced ? 1 : ease((now - this.wonAt) / 500)) : 0,
      bump: this.reduced ? 0 : Math.max(0, 1 - (now - this.bumpAt) / 300),
      picked: !path.length && s.starts.length > 1 ? this.startPick % s.starts.length : -1,
      glow: !this.reduced,
      head: won ? null : this.reduced ? 1 : 0.5 + 0.5 * Math.sin((now / BREATH_MS) * Math.PI * 2),
    });

    // Look here: the stretch of line, and the mark it passes.
    const m = this.mark?.state === s && !won ? this.mark : null;
    if (m) {
      const { c } = this.grid;
      const pts = m.nodes.map((q) => this.px(q));
      const x0 = Math.min(...pts.map((q) => q.x)), x1 = Math.max(...pts.map((q) => q.x));
      const y0 = Math.min(...pts.map((q) => q.y)), y1 = Math.max(...pts.map((q) => q.y));
      const pad = c * 0.22;
      drawHelpMark(ctx, x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2, now, this.reduced, pad);
      if (m.near && 'bead' in m.near) {
        const [a, b] = edgeOf(m.near.bead).map((q) => this.px(q));
        const r = c * 0.16;
        drawHelpMark(ctx, (a.x + b.x) / 2 - r, (a.y + b.y) / 2 - r, r * 2, r * 2, now, this.reduced, r);
      } else if (m.near) {
        const q = this.px({ x: m.near.cell % s.cols, y: Math.floor(m.near.cell / s.cols) });
        const inset = c * 0.1;
        drawHelpMark(ctx, q.x + inset, q.y + inset, c - inset * 2, c - inset * 2, now, this.reduced, c * 0.18);
      }
    }
  }

  /** Where the live segment from the pen's last node should end: toward the pointer, along one axis. */
  private tipPoint(last: Point, node: Pt): Point | null {
    const p = this.pointer!;
    const c = this.grid.c;
    const dx = p.x - last.x, dy = p.y - last.y;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const step = horizontal ? { x: node.x + Math.sign(dx), y: node.y } : { x: node.x, y: node.y + Math.sign(dy) };
    if (!adjacent(node, step) || !extend(this.state, step)) return null;
    const len = Math.min(c * 0.5, horizontal ? Math.abs(dx) : Math.abs(dy));
    return horizontal ? { x: last.x + Math.sign(dx) * len, y: last.y } : { x: last.x, y: last.y + Math.sign(dy) * len };
  }
}

const WORDS = ['no', 'one', 'two', 'three', 'four'];

/** Why a stretch of line goes where it goes, from the mark it passes. */
function nearText(s: LinesState, near: Near | null, finishing: boolean): string {
  if (near && 'bead' in near) return 'The line runs over this bead next.';
  const m = near ? s.marks[near.cell] : null;
  switch (m?.type) {
    case 'count': return `This tile needs the line along ${WORDS[m.n]} of its sides.`;
    case 'color': return 'The line keeps this orbital apart from the other colors.';
    case 'pair': return 'The line closes this pair in with its partner.';
    case 'shape': return 'The line traces the outline of this shape.';
    default: return finishing ? 'The line ends at this charge.' : 'The line runs this way next.';
  }
}

/** Broken marks flash, then settle to a steady red until the line changes. */
function flash(ms: number): number {
  return 0.55 + 0.45 * Math.max(0, 1 - ms / FLASH_MS) * (0.5 + 0.5 * Math.cos((ms / 120) * Math.PI));
}

/** Fits a board, with room round the rim for the − terminals: about 0.45 of a cell each side. */
function boardGrid(area: Area, s: { cols: number; rows: number }, margin: number, maxCell: number): Grid {
  const fit = fitGrid(area, s.cols + 0.9, s.rows + 0.9, { margin, maxCell });
  const c = fit.cell;
  return { x: fit.x + 0.45 * c, y: fit.y + 0.45 * c, c };
}

// ---- rule pictures ---------------------------------------------------------------------

/** One stroke in a picture: a line drawn in, then judged; or pushed at a gap and refused. */
interface Stroke {
  path: Pt[];
  /** The node the pen pushes toward from the end of `path` and is refused (a gap). */
  blocked?: Pt;
}

const P = (...xy: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] });
  return out;
};

/** A small picture board, 3 tiles by 2 unless told otherwise. */
function mini(o: Partial<LinesState> & { at?: Record<number, Mark> }): LinesState {
  const cols = o.cols ?? 3, rows = o.rows ?? 2;
  const marks: (Mark | null)[] = Array(cols * rows).fill(null);
  for (const [i, m] of Object.entries(o.at ?? {})) marks[Number(i)] = m;
  return { cols, rows, starts: o.starts ?? P(0, 2), ends: o.ends ?? P(3, 0), dots: o.dots ?? [], gaps: o.gaps ?? [], marks, rules: [], path: [], moves: 0, par: 1, won: false, solution: [] };
}

/** Seconds: the finger lands, each node of the line, the verdict coming in, then a rest on the finished still. */
const PRESS = 0.3;
const STEP = 0.16;
const VERDICT = 0.45;
const REST = 0.5;
/** How far along a broken channel the pen gets before it is refused: to the gap's near cap. */
const PUSH = 0.26;

/**
 * One rule picture: the + charge is pressed, the line draws in a node at a
 * time, and the real verdict comes in as on the board: a kept line glows, a
 * broken mark is flagged in amber (a missed bead, an outlined tile, or a ring
 * where the pen was refused at a gap). The last frame is the finished verdict.
 */
function picture(s: LinesState, st: Stroke, caption: string, opts: { emph?: 'end'; pockets?: boolean } = {}): Illustration {
  const v = verdict(s, st.path);
  const ok = v.ok && !st.blocked;
  const failed = new Set(v.failed);
  const missed = new Set(v.missed);
  const n = st.path.length;
  const draw = PRESS + STEP * (n - 1) + (st.blocked ? STEP : 0);
  const duration = Math.min(4, Math.max(1.5, draw + VERDICT + REST));
  const none = new Set<never>();
  const pocketOf = opts.pockets ? regions(s.cols, s.rows, st.path) : null;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const g = boardGrid({ x: 0, y: 0, w, h }, s, 4, 999);
      // How far the line has come: whole nodes, then a fraction toward the next (or into the gap).
      const f = Math.max(0, (t - PRESS) / STEP);
      const whole = Math.min(n - 1, Math.floor(f));
      let tip: Point | null = null;
      if (whole < n - 1) {
        const a = px(g, st.path[whole]), b = px(g, st.path[whole + 1]), r = f - whole;
        tip = { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
      } else if (st.blocked && f > n - 1) {
        const a = px(g, st.path[n - 1]), b = px(g, st.blocked), r = Math.min(PUSH, (f - (n - 1)) * PUSH * 1.6);
        tip = { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
      }
      const done = t >= draw;
      const k = done ? ease((t - draw) / VERDICT) : 0;
      paintLines(ctx, s, g, {
        path: t < PRESS ? [] : st.path.slice(0, whole + 1),
        tip,
        failed: done && !ok ? failed : none,
        missed: done && !ok ? missed : none,
        pulse: k,
        red: false,
        won: done && ok,
        wonT: done && ok ? k : 0,
        bump: done && st.blocked ? k : 0,
        picked: -1,
        glow: true,
        head: done && ok ? null : 1,
        tint: pocketOf && done && ok ? (i) => (pocketOf[i] === pocketOf[0] ? C.surface3 : C.surface2) : undefined,
        flag: C.warn,
      });
      // The finger landing: an accent ripple on the + charge.
      if (t > 0 && t < PRESS + 0.25) press(ctx, px(g, st.path[0]), g.c, t / (PRESS + 0.25));
      if (opts.emph === 'end' && !done) {
        const end = st.path[n - 1];
        const tm = terminal(g, px(g, end), tailDir(s, end));
        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 6);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tm.x, tm.y, tm.r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}

/** An accent ripple spreading from a press. */
function press(ctx: CanvasRenderingContext2D, p: Point, c: number, k: number): void {
  ctx.save();
  ctx.strokeStyle = C.accent;
  ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, c * (0.2 + 0.25 * k), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Two pockets of three: an L on the left and its mirror on the right.
const SPLIT = P(1, 0, 1, 1, 2, 1, 2, 2);
// Straight down the middle: a pocket of two on the left, four on the right.
const SPLIT_WIDE = P(1, 0, 1, 1, 1, 2, 2, 2);
const SPLIT_ENDS = { starts: P(1, 0), ends: P(2, 2) };

const BEADS = mini({ dots: [edgeKey({ x: 1, y: 2 }, { x: 2, y: 2 })] });
const GAPS = mini({ gaps: [edgeKey({ x: 1, y: 1 }, { x: 2, y: 1 })] });
const ORBITALS = mini({ ...SPLIT_ENDS, at: { 0: { type: 'color', c: 's' }, 4: { type: 'color', c: 's' }, 2: { type: 'color', c: 'p' } } });
const BARS = mini({ at: { 1: { type: 'count', n: 2 } } });
// In s blue, well away from the amber the broken marks are flagged in.
const PAIRS = mini({ ...SPLIT_ENDS, at: { 0: { type: 'pair', c: 's' }, 4: { type: 'pair', c: 's' }, 2: { type: 'pair', c: 's' }, 5: { type: 'color', c: 's' } } });
const SHAPES = mini({ ...SPLIT_ENDS, at: { 3: { type: 'shape', cells: P(0, 0, 0, 1, 1, 1) } } });

export const RULES: RuleCard[] = [
  {
    title: 'Start',
    text: 'Press a + charge and drag one line along the channels between the tiles. A line never crosses itself.',
    good: picture(mini({}), { path: P(0, 2, 1, 2, 1, 1, 2, 1, 2, 0, 3, 0) }, 'One line, + to −'),
  },
  {
    title: 'End',
    text: 'Let go on a − charge at the rim and the line is checked against every mark on the board.',
    good: picture(mini({ starts: P(0, 0), ends: P(3, 2) }), { path: P(0, 0, 1, 0, 1, 1, 2, 1, 3, 1, 3, 2) }, 'Let go on the −', { emph: 'end' }),
  },
  {
    title: 'Pockets',
    text: 'The line walls the tiles into pockets, and the rim is a wall too. Most marks are about the pocket they sit in.',
    good: picture(mini(SPLIT_ENDS), { path: SPLIT }, 'Two pockets of three', { pockets: true }),
  },
  {
    title: 'Beads',
    text: 'The line must run over every bead on a channel.',
    good: picture(BEADS, { path: P(0, 2, 1, 2, 2, 2, 2, 1, 3, 1, 3, 0) }, 'Passes every bead'),
    bad: picture(BEADS, { path: P(0, 2, 0, 1, 1, 1, 2, 1, 3, 1, 3, 0) }, 'Misses a bead'),
  },
  {
    title: 'Gaps',
    text: 'The line cannot cross a broken channel.',
    good: picture(GAPS, { path: P(0, 2, 0, 1, 1, 1, 1, 0, 2, 0, 3, 0) }, 'Goes round the gap'),
    bad: picture(GAPS, { path: P(0, 2, 0, 1, 1, 1), blocked: { x: 2, y: 1 } }, 'Cannot cross a gap'),
  },
  {
    title: 'Orbitals',
    text: 'No pocket may hold two kinds of orbital. Wall the different shapes apart.',
    good: picture(ORBITALS, { path: SPLIT }, 'Kinds walled apart'),
    bad: picture(ORBITALS, { path: SPLIT_WIDE }, 'Two kinds together'),
  },
  {
    title: 'Bars',
    text: 'The line runs along exactly as many of the tile\'s four sides as it has bars: one, two or three.',
    good: picture(BARS, { path: P(0, 2, 0, 1, 1, 1, 1, 0, 2, 0, 3, 0) }, 'Two bars, two sides'),
    bad: picture(BARS, { path: P(0, 2, 0, 1, 1, 1, 2, 1, 3, 1, 3, 0) }, 'Two bars, one side'),
  },
  {
    title: 'Pairs',
    text: 'A hollow orbital\'s pocket holds exactly two orbitals of its kind, hollow or filled, itself included.',
    good: picture(PAIRS, { path: SPLIT }, 'Two in each pocket'),
    bad: picture(PAIRS, { path: SPLIT_WIDE }, 'One here, three there'),
  },
  {
    title: 'Shapes',
    text: 'The pocket holding a shape must be exactly that shape, the same way up. Two shapes in one pocket fit together to fill it.',
    good: picture(SHAPES, { path: SPLIT }, 'Pocket is the shape'),
    bad: picture(SHAPES, { path: SPLIT_WIDE }, 'Pocket is too small'),
  },
  {
    title: 'Two starts or ends',
    text: 'Some boards have two + charges or two − charges. Use whichever you like.',
    good: picture(mini({ starts: P(0, 2, 3, 2), ends: P(1, 0, 3, 0) }), { path: P(3, 2, 2, 2, 2, 1, 3, 1, 3, 0) }, 'Either one will do'),
  },
];
