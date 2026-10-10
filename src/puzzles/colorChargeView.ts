// Drawing and touch for Color Charge: drag across tiles (or tap them one by
// one) to pick a group; a color-neutral group binds, its gluon strings snap
// tight and it collapses into one white hadron. On gluon levels a gluon token
// sits under the grid: tap it, then two neighboring tiles, to swap their
// colors. A swap stays provisional for a moment (washed colors, a dashed
// silver outline, a gluon curl between the two). Any move that strands tiles
// (a swap or a group) shows them for two seconds and then undoes itself,
// handing the move (and the gluon) back; meanwhile a group that did it is
// drawn not quite white, tinted with its charges under a dashed outline.
// Regions that can no longer all be bound glow inside a thick amber rim, and a
// tile no group could hold dims under an amber ring with a "!" mark. Never
// red. Under the board, a tally of the particles to make: each kind's icon and
// how many of them are bound.
//
// Everything is painted from a Scene, a plain description of the board and its
// running animations, so the rule cards replay the same drawing as the board.

import { adjacent, bind, canBind, canSwap, cloneCharge, COLOR_LETTERS, gluonsLeft, groupKind, isolated, nextStep, onTrack, solved, stranded, swap, tally, type ColorChargeState, type GroupKind, type Quark, type Tally } from './colorCharge';
import { drawFrame, frameBox, framePad, frameWidth } from './frame';
import { C, fitGrid, font, tile } from './palette';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

/**
 * The three charge colors, read at draw time from Color Charge's own tokens
 * (--c-charge-r/g/b); the letters carry them too.
 */
export const chargeColor = (k: number): string => [C.chargeR, C.chargeG, C.chargeB][k];

const FAIL_MS = 380;
const BIND_MS = 560;
const SWAP_MS = 420;
const LABEL_MS = 1100;
const STRAND_MS = 320;
const TOKEN = 44;
/** A swap that keeps the grid clearable stays provisional this long after it lands, then settles. */
const SETTLE_MS = 450;
/** A move that strands tiles shows them this long after it is made, then undoes itself. */
export const UNDO_MS = 2000;
/** How long a settling swap takes to lose its provisional look, and how long "undone" stays in the hint. */
const FADE_MS = 220;
const SNAPPED_HINT_MS = 1600;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Reserve puzzle, proposed for the quark chapter of the particles. The grid grows from 3×3 (z 1–10) to 4×3 (11–30), 4×4 with two mesons (31–54), 4×5 with four mesons and an antibaryon (55–86) and 5×5 with five mesons and two antibaryons (87–118). Gluons: one at z 21–30, 45–54, 71–86 and 87–103, two on the synthetic elements (104–118). Every grid has exactly one clearance: a gluon level cannot be cleared without its swaps, and only one set of swaps and groups clears it. Par is the groups plus the swaps; every bind and every swap is a move, Undo is free and takes it back, and clean means clearing the grid within par. A move that strands tiles is taken back on its own after two seconds. Under the board, a tally counts each kind of particle bound out of those the grid makes. Keyboard: G arms a gluon, Escape drops the pick.</p>`;

// ---- the scene ------------------------------------------------------------------------

interface BindAnim { cells: number[]; kind: GroupKind; at: number }
/** A swap that has landed (at `at`) and settles or snaps back at `until`. */
interface Provisional { a: number; b: number; at: number; until: number }

/** Everything the board shows at one moment, with its animations' start times. */
interface Scene {
  cols: number;
  rows: number;
  tiles: Quark[];
  bound: number[];
  groups: number[][];
  swaps: [number, number][];
  gluons: number;
  sel: number[];
  armed: boolean;
  /** Free tiles in regions that can no longer all be bound. */
  stranded: number[];
  /** Of those, the tiles no neutral group could hold at all. */
  dead: number[];
  strandedAt: number;
  binds: BindAnim[];
  swapAnim: { a: number; b: number; at: number } | null;
  /** A swap not settled yet: drawn washed and dashed with a curl between, until `until`. */
  provisional: Provisional | null;
  fail: { cells: number[]; at: number } | null;
  wonAt: number | null;
  /**
   * A group that stranded tiles and undoes itself at `until`: drawn not quite
   * white once its bind (made at `at`) has played. `group` indexes `groups`.
   */
  pending?: { group: number; at: number; until: number } | null;
  /** Cells left out of the board altogether (rule-card boards that are not rectangles). */
  hidden?: boolean[];
  /** Rule pictures: the pick was refused, so its rings and strings stay amber. */
  rejected?: boolean;
  /** Rule pictures: 'hold' keeps a new particle's name up once it has risen; 'off' shows no names. */
  names?: 'hold' | 'off';
}

/** `legend` is the top of the particle tally under the board (and the gluons). */
interface Geom { cell: number; x: number; y: number; tokens: Area[]; area: Area; legend: number }

/** The gap between the board (or its gluons) and the tally. */
const LEGEND_GAP = 12;

function boardGeom(area: Area, cols: number, rows: number, gluons: number, opts: { maxCell?: number; margin?: number; top?: number; token?: number; side?: boolean; legend?: number } = {}): Geom {
  const tokenSide = opts.token ?? TOKEN;
  const gap = 10;
  const tokens: Area[] = [];
  if (opts.side && gluons) {
    // Rule cards: the gluons stand left of the grid, to leave the tiny board its height.
    const strip = tokenSide + 8;
    const g = fitFramed({ ...area, x: area.x + strip, w: area.w - strip }, cols, rows, { margin: opts.margin ?? 10, maxCell: opts.maxCell ?? 72, top: opts.top ?? 0 });
    const total = gluons * tokenSide + (gluons - 1) * gap;
    for (let k = 0; k < gluons; k++) tokens.push({ x: g.x - g.room - strip, y: g.y + (g.h - total) / 2 + k * (tokenSide + gap), w: tokenSide, h: tokenSide });
    return { cell: g.cell, x: g.x, y: g.y, tokens, area, legend: g.y + g.h + g.room };
  }
  const strip = gluons ? tokenSide + 16 : 0;
  const legend = opts.legend ? LEGEND_GAP + opts.legend : 0;
  const g = fitFramed(area, cols, rows, { margin: opts.margin ?? 10, maxCell: opts.maxCell ?? 72, top: opts.top ?? 0, bottom: strip + legend });
  const below = g.y + g.h + g.room;
  const total = gluons * tokenSide + (gluons - 1) * gap;
  for (let k = 0; k < gluons; k++) {
    tokens.push({ x: g.x + (g.w - total) / 2 + k * (tokenSide + gap), y: below + 12, w: tokenSide, h: tokenSide });
  }
  return { cell: g.cell, x: g.x, y: g.y, tokens, area, legend: below + strip + LEGEND_GAP };
}

/** The room the board frame takes round a grid of this cell size: its padding and half its stroke. */
const frameRoom = (c: number): number => framePad(c) + frameWidth(c) / 2 + 1;

/**
 * Fits the grid with room round it for the frame. The room shrinks (never grows) with the cell,
 * so the room for the cell fitted without it is always enough.
 */
function fitFramed(area: Area, cols: number, rows: number, opts: { margin: number; maxCell: number; top: number; bottom?: number }): { cell: number; x: number; y: number; w: number; h: number; room: number } {
  const room = frameRoom(fitGrid(area, cols, rows, opts).cell);
  const g = fitGrid(area, cols, rows, { ...opts, margin: opts.margin + room });
  return { ...g, room };
}

/**
 * The gap between a tile and its cell's edge. Never more than a quarter of the
 * cell, so a board squeezed to a few pixels (a screen being laid out) still has
 * tiles of positive size: a negative size throws in roundRect and stops the frame loop.
 */
const tilePad = (c: number): number => Math.min(c * 0.25, Math.max(3, c * 0.08));

const ease2 = (t: number): number => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

function paint(ctx: CanvasRenderingContext2D, sc: Scene, G: Geom, now: number, reduced: boolean): void {
  const c = G.cell, pad = tilePad(c), w = c - pad * 2, rad = c * 0.18;
  const center = (i: number): Point => ({ x: G.x + (i % sc.cols + 0.5) * c, y: G.y + (Math.floor(i / sc.cols) + 0.5) * c });
  const animOf = (cells: number[]) => (reduced ? undefined : sc.binds.find((b) => b.cells.length === cells.length && b.cells.every((i) => cells.includes(i)) && now - b.at < BIND_MS));
  const swapT = sc.swapAnim && !reduced ? (now - sc.swapAnim.at) / SWAP_MS : 1;
  const swapping = swapT < 1 ? sc.swapAnim : null;
  const failT = sc.fail && !reduced ? (now - sc.fail.at) / FAIL_MS : 1;
  const strandSet = new Set(sc.stranded);
  const strandT = reduced ? 1 : ease((now - sc.strandedAt) / STRAND_MS);
  const won = sc.wonAt !== null;

  // The frame round the board, and a faint dot at each cell's center (seen only while a tile is away).
  drawFrame(ctx, frameBox(G.x, G.y, sc.cols * c, sc.rows * c, c), { width: frameWidth(c), radius: c * 0.2 + framePad(c) });
  ctx.fillStyle = C.surface3;
  for (let i = 0; i < sc.tiles.length; i++) {
    if (sc.hidden?.[i]) continue;
    const p = center(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.5, c * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }

  // Bound groups at rest: one white hadron each.
  sc.groups.forEach((grp, gi) => {
    if (animOf(grp)) return;
    let glow = 0;
    if (won && !reduced) {
      const t = (now - sc.wonAt! - gi * 90) / 700;
      glow = t < 0 ? 0 : t < 1 ? 0.35 + 0.65 * Math.sin(Math.PI * t) : 0.35;
    } else if (won) glow = 0.35;
    const pend = sc.pending?.group === gi ? pendingLook(sc.pending, now, reduced) : 0;
    hadron(ctx, grp.map(center), grp.map((i) => sc.tiles[i]), links(sc.cols, grp), w, rad, glow, pend);
    if (pend > 0) {
      // A dashed silver rim, like a swap not settled yet: this particle is about to come apart.
      ctx.save();
      ctx.globalAlpha = Math.min(1, pend * 2);
      cellOutline(ctx, grp.map((i) => ({ x: i % sc.cols, y: Math.floor(i / sc.cols) })), G.x, G.y, c, pad - Math.max(2, c * 0.05), rad * 1.15);
      ctx.setLineDash([w * 0.1, w * 0.075]);
      ctx.lineDashOffset = reduced ? 0 : -now / 45;
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = Math.max(1.5, w * 0.04);
      ctx.stroke();
      ctx.restore();
    }
  });

  // Stranded regions glow amber underneath, so the gaps between their tiles read as one patch.
  const pulse = reduced ? 1 : 0.5 + 0.5 * Math.sin(now / 380);
  const rimIn = pad * 0.5;
  const edges = (i: number) => {
    const r = Math.floor(i / sc.cols), k = i % sc.cols;
    const out = (j: number, ok: boolean) => !ok || !strandSet.has(j);
    return { top: out(i - sc.cols, r > 0), bottom: out(i + sc.cols, r < sc.rows - 1), left: out(i - 1, k > 0), right: out(i + 1, k < sc.cols - 1) };
  };
  if (strandSet.size && strandT > 0) {
    ctx.save();
    ctx.globalAlpha = strandT * (0.13 + 0.09 * pulse);
    ctx.fillStyle = C.warn;
    for (const i of strandSet) {
      const x0 = G.x + (i % sc.cols) * c, y0 = G.y + Math.floor(i / sc.cols) * c;
      const o = edges(i);
      const l = o.left ? rimIn : 0, t = o.top ? rimIn : 0, r = o.right ? rimIn : 0, b = o.bottom ? rimIn : 0;
      ctx.fillRect(x0 + l, y0 + t, c - l - r, c - t - b);
    }
    ctx.restore();
  }

  // Free tiles; a tile no group could hold dims. A swap not settled yet is washed and dashed.
  const deadSet = new Set(sc.dead);
  const prov = sc.provisional;
  const provK = !prov ? 0 : now < prov.until ? 1 : reduced ? 0 : Math.max(0, 1 - (now - prov.until) / FADE_MS);
  const dash = reduced ? 0 : -now / 45;
  for (let i = 0; i < sc.tiles.length; i++) {
    if (sc.bound[i] >= 0) continue;
    if (swapping && (i === swapping.a || i === swapping.b)) continue;
    const p = center(i);
    if (sc.fail?.cells.includes(i) && failT < 1) p.x += Math.sin(failT * Math.PI * 6) * c * 0.06 * (1 - failT);
    const k = prov && (i === prov.a || i === prov.b) ? provK : 0;
    quark(ctx, p.x, p.y, w, rad, sc.tiles[i], deadSet.has(i) ? 1 - 0.6 * strandT : 1, k, dash);
  }

  // Stranded regions: a thick amber rim, gently pulsing, and on each dead tile an amber ring and a "!" mark.
  if (strandSet.size && strandT > 0) {
    ctx.save();
    ctx.globalAlpha = strandT * (reduced ? 1 : 0.72 + 0.28 * pulse);
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = Math.max(2.5, c * 0.05);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = C.warn;
    ctx.shadowBlur = c * (reduced ? 0.12 : 0.06 + 0.14 * pulse);
    ctx.beginPath();
    // One unbroken rim: each edge runs on into the next cell's, turns in at an outer corner
    // and out at an inner one.
    const has = (r: number, k: number) => r >= 0 && k >= 0 && r < sc.rows && k < sc.cols && strandSet.has(r * sc.cols + k);
    const end = (out: boolean, diagonal: boolean) => (out ? rimIn : diagonal ? -rimIn : 0);
    for (const i of strandSet) {
      const r = Math.floor(i / sc.cols), k = i % sc.cols;
      const x0 = G.x + k * c, y0 = G.y + r * c;
      const o = edges(i);
      if (o.top) { ctx.moveTo(x0 + end(o.left, has(r - 1, k - 1)), y0 + rimIn); ctx.lineTo(x0 + c - end(o.right, has(r - 1, k + 1)), y0 + rimIn); }
      if (o.bottom) { ctx.moveTo(x0 + end(o.left, has(r + 1, k - 1)), y0 + c - rimIn); ctx.lineTo(x0 + c - end(o.right, has(r + 1, k + 1)), y0 + c - rimIn); }
      if (o.left) { ctx.moveTo(x0 + rimIn, y0 + end(o.top, has(r - 1, k - 1))); ctx.lineTo(x0 + rimIn, y0 + c - end(o.bottom, has(r + 1, k - 1))); }
      if (o.right) { ctx.moveTo(x0 + c - rimIn, y0 + end(o.top, has(r - 1, k + 1))); ctx.lineTo(x0 + c - rimIn, y0 + c - end(o.bottom, has(r + 1, k + 1))); }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = strandT;
    for (const i of deadSet) {
      const p = center(i);
      const lw = Math.max(2.5, c * 0.045), grow = lw * 1.4;
      tile(ctx, p.x - w / 2 - grow, p.y - w / 2 - grow, w + grow * 2, w + grow * 2, rad * 1.15, null, C.warn, lw);
      warnMark(ctx, p.x + w / 2 - w * 0.06, p.y - w / 2 + w * 0.06, Math.max(6, c * 0.13));
    }
    ctx.restore();
  }

  // A swap in flight: the two tiles orbit each other about the edge they share, joined by a gluon.
  if (swapping) {
    const pa = center(swapping.a), pb = center(swapping.b);
    const e = ease2(swapT);
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const th = Math.PI * e, cos = Math.cos(th), sin = Math.sin(th);
    const at = (p: Point): Point => ({ x: mx + (p.x - mx) * cos - (p.y - my) * sin, y: my + (p.x - mx) * sin + (p.y - my) * cos });
    const size = w * (1 - 0.4 * Math.sin(Math.PI * e));
    ctx.save();
    ctx.globalAlpha = Math.sin(Math.PI * e);
    ctx.strokeStyle = C.silver;
    ctx.lineWidth = 1.75;
    coil(ctx, pa.x, pa.y, pb.x, pb.y, c * 0.1, 3, now / 90);
    ctx.restore();
    // The tile now at a came from b, and the other way round.
    const ta = at(pb), tb = at(pa);
    // Provisional from the start, unless this is a swap being taken back.
    const k = prov && prov.a === swapping.a && prov.b === swapping.b ? 1 : 0;
    quark(ctx, ta.x, ta.y, size, rad * size / w, sc.tiles[swapping.a], 1, k, dash);
    quark(ctx, tb.x, tb.y, size, rad * size / w, sc.tiles[swapping.b], 1, k, dash);
  }

  // Groups binding right now: strings snap tight, the tiles pull in and turn white.
  for (const b of sc.binds) {
    const p = (now - b.at) / BIND_MS;
    if (reduced || p >= 1 || p < 0) continue;
    const pts0 = b.cells.map(center);
    const mid = { x: pts0.reduce((a, q) => a + q.x, 0) / pts0.length, y: pts0.reduce((a, q) => a + q.y, 0) / pts0.length };
    const qs = b.cells.map((i) => sc.tiles[i]);
    const L = links(sc.cols, b.cells);
    if (p < 0.42) {
      const q = p / 0.42;
      const pull = ease(q) * 0.16;
      const pts = pts0.map((pt) => ({ x: pt.x + (mid.x - pt.x) * pull, y: pt.y + (mid.y - pt.y) * pull }));
      pts.forEach((pt, k) => {
        quark(ctx, pt.x, pt.y, w * (1 - 0.06 * q), rad, qs[k], 1);
        if (q > 0.5) {
          ctx.save();
          ctx.globalAlpha = (q - 0.5) * 2;
          tile(ctx, pt.x - w * (1 - 0.06 * q) / 2, pt.y - w * (1 - 0.06 * q) / 2, w * (1 - 0.06 * q), w * (1 - 0.06 * q), rad, C.tile);
          ctx.restore();
        }
      });
      ctx.save();
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = Math.max(1.5, c * 0.035);
      ctx.lineCap = 'round';
      for (const [i, j] of L) coil(ctx, pts[i].x, pts[i].y, pts[j].x, pts[j].y, c * 0.11 * (1 - ease(q)), 3, q * 9);
      ctx.restore();
    } else {
      const r = (p - 0.42) / 0.58;
      // Collapsed, then springing back to rest with a little overshoot.
      const back = 1 - ease(r);
      const pull = 0.16 * back - 0.03 * Math.sin(Math.PI * Math.min(1, r * 1.4)) * (1 - r);
      const pts = pts0.map((pt) => ({ x: pt.x + (mid.x - pt.x) * pull, y: pt.y + (mid.y - pt.y) * pull }));
      hadron(ctx, pts, qs, L, w * (1 - 0.06 * back), rad, 0.9 * (1 - r));
      // A ring flashes out from the new particle.
      ctx.save();
      ctx.globalAlpha = 0.7 * (1 - r);
      cellOutline(ctx, b.cells.map((i) => ({ x: i % sc.cols, y: Math.floor(i / sc.cols) })), G.x, G.y, c, pad - c * 0.14 * ease(r), rad + c * 0.1 * ease(r));
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Swaps already made: a small gluon across the edge the two tiles share. While a swap is
  // provisional the gluon is still live: a bigger curl, rolling, that shrinks to the mark as it settles.
  for (const [a, b] of sc.swaps) {
    const pa = center(a), pb = center(b);
    const t = swapping && swapping.a === a && swapping.b === b ? ease(swapT) : 1;
    const dx = (pb.x - pa.x) / c, dy = (pb.y - pa.y) / c;
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const both = sc.bound[a] >= 0 && sc.bound[b] >= 0;
    const live = prov && prov.a === a && prov.b === b ? provK : 0;
    const span = c * (0.24 + 0.08 * live), amp = c * (0.07 + 0.03 * live);
    const phase = live && !reduced ? now / 110 : 0;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.lineCap = 'round';
    if (live) {
      // A dark underlay keeps the curl readable where it crosses the tiles.
      ctx.strokeStyle = C.bg;
      ctx.lineWidth = Math.max(3.5, c * 0.075);
      ctx.globalAlpha = t * live * 0.7;
      coil(ctx, mx - dx * span, my - dy * span, mx + dx * span, my + dy * span, amp, 2, phase);
      ctx.globalAlpha = t;
    }
    ctx.strokeStyle = both ? C.pewter : C.silver;
    ctx.lineWidth = Math.max(1.5, c * (0.03 + 0.008 * live));
    coil(ctx, mx - dx * span, my - dy * span, mx + dx * span, my + dy * span, amp, 2, phase);
    ctx.restore();
  }

  // The pick: an accent ring per tile, joined by strings that pull straight once the pick is neutral.
  if (sc.sel.length) {
    const neutral = !sc.armed && !sc.rejected && sc.sel.length > 1 && groupKind(sc.tiles, sc.sel) !== null;
    const dead = sc.rejected || (!sc.armed && hopeless(sc.tiles, sc.sel));
    ctx.save();
    ctx.strokeStyle = dead ? C.warn : C.accent;
    ctx.lineCap = 'round';
    ctx.lineWidth = neutral ? 2.5 : 1.75;
    for (let k = 1; k < sc.sel.length; k++) {
      const p = center(sc.sel[k - 1]), q = center(sc.sel[k]);
      coil(ctx, p.x, p.y, q.x, q.y, neutral ? 0 : c * 0.09, 3, sc.armed ? now / 120 : 0);
    }
    for (const i of sc.sel) {
      const p = center(i);
      tile(ctx, p.x - w / 2 - 2.5, p.y - w / 2 - 2.5, w + 5, w + 5, rad * 1.1, null, dead ? C.warn : C.accent, 2);
    }
    ctx.restore();
  }
  if (sc.fail && failT < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - failT;
    for (const i of sc.fail.cells) {
      const p = center(i);
      tile(ctx, p.x - w / 2 - 2.5, p.y - w / 2 - 2.5, w + 5, w + 5, rad * 1.1, null, C.warn, 2);
    }
    ctx.restore();
  }

  // The name of each new particle, rising off it.
  if (!reduced && sc.names !== 'off') {
    for (const b of sc.binds) {
      const raw = (now - b.at - BIND_MS * 0.42) / LABEL_MS;
      const hold = sc.names === 'hold';
      if (raw < 0 || (raw >= 1 && !hold)) continue;
      const t = hold ? Math.min(raw, 0.5) : raw;
      const pts = b.cells.map(center);
      const x = pts.reduce((a, q) => a + q.x, 0) / pts.length;
      const px = Math.max(10, Math.min(14, c * 0.22));
      const top = Math.min(...pts.map((q) => q.y)) - w / 2;
      const bottom = Math.max(...pts.map((q) => q.y)) + w / 2;
      const rise = ease(t) * c * 0.12;
      // Above the particle, or below it when the top row leaves no room.
      const th = px * 1.6;
      const y = top - 3 - th - c * 0.12 >= G.area.y ? top - 3 - rise : Math.min(G.area.y + G.area.h - 1, bottom + 3 + th + c * 0.12 - rise);
      tag(ctx, x, y, b.kind, px, t < 0.15 ? t / 0.15 : t > 0.6 ? (1 - t) / 0.4 : 1, G.area);
    }
  }

  // The gluons: one token each, spent ones left as an empty socket.
  const left = sc.gluons - sc.swaps.length;
  G.tokens.forEach((r, k) => gluonToken(ctx, r, k >= left ? 'spent' : sc.armed && k === left - 1 ? 'armed' : 'ready', now, reduced));
}

/**
 * How far a group that stranded tiles is drawn from finished (0 white, 1 its
 * charges' colors), once its bind has played: it fades in, then creeps on and
 * breathes as the undo comes. Reduced motion holds it still.
 */
function pendingLook(p: { at: number; until: number }, now: number, reduced: boolean): number {
  if (reduced) return 0.45;
  const start = p.at + BIND_MS;
  if (now < start) return 0;
  const k = Math.min(1, (now - start) / FADE_MS);
  const left = Math.min(1, (now - start) / Math.max(1, p.until - start));
  return k * (0.32 + 0.22 * left + 0.06 * Math.sin((now - start) / 160));
}

/** Pairs of neighbors in a group, as indexes into it. */
function links(cols: number, cells: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) if (adjacent(cols, cells[a], cells[b])) out.push([a, b]);
  return out;
}

/** Two picked tiles that no third tile could make neutral. */
function hopeless(tiles: Quark[], sel: number[]): boolean {
  if (sel.length !== 2) return false;
  const [a, b] = sel.map((i) => tiles[i]);
  if (groupKind(tiles, sel)) return false;
  return a.anti !== b.anti || a.color === b.color;
}

// ---- pieces ---------------------------------------------------------------------------

/**
 * A free tile: a quark is a solid tile in its color, an antiquark a hollow one
 * with a bar over its letter. `provisional` (0-1) is a swap not settled yet: the
 * color washes pale, an antiquark's rim breaks into dashes, and a
 * dashed silver outline (marching by `dash`) rings the tile.
 */
function quark(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rad: number, q: Quark, alpha: number, provisional = 0, dash = 0): void {
  const full = chargeColor(q.color);
  // Washed pale toward gray, never darker: dark is for a tile nothing can hold.
  const color = provisional > 0 ? mix(full, C.silverDim, 0.42 * provisional) : full;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (q.anti) {
    const lw = Math.max(2, w * 0.045);
    if (provisional > 0.5) ctx.setLineDash([w * 0.11, w * 0.07]);
    tile(ctx, x - w / 2 + lw / 2, y - w / 2 + lw / 2, w - lw, w - lw, rad, C.surface2, color, lw);
    ctx.setLineDash([]);
    letter(ctx, x, y, w, COLOR_LETTERS[q.color], color, true);
  } else {
    tile(ctx, x - w / 2, y - w / 2, w, w, rad, color);
    letter(ctx, x, y, w, COLOR_LETTERS[q.color], C.tileInk, false);
  }
  if (provisional > 0) {
    const lw = Math.max(1.5, w * 0.04), grow = lw * 1.6;
    ctx.globalAlpha *= provisional;
    ctx.setLineDash([w * 0.1, w * 0.075]);
    ctx.lineDashOffset = dash;
    tile(ctx, x - w / 2 - grow, y - w / 2 - grow, w + grow * 2, w + grow * 2, rad * 1.15, null, C.silver, lw);
  }
  ctx.restore();
}

/** Blends two #rrggbb colors; any other form comes back unblended. */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) : null);
  const x = p(a), y = p(b);
  if (!x || !y) return a;
  return `#${x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** A small amber warning mark: a disc with "!", pinned to a tile no group could hold. */
function warnMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = C.warn;
  ctx.fill();
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.stroke();
  ctx.fillStyle = C.tileInk;
  ctx.font = font(r * 1.45, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y + r * 0.06);
  ctx.restore();
}

function letter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, text: string, color: string, bar: boolean): void {
  ctx.fillStyle = color;
  ctx.font = font(w * 0.46, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + w * 0.02);
  if (bar) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, w * 0.045);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.12, y - w * 0.2);
    ctx.lineTo(x + w * 0.12, y - w * 0.2);
    ctx.stroke();
  }
}

/** The outline of a group as one shape: a rounded tile per cell, bridged to its neighbors. */
function hadronPath(ctx: CanvasRenderingContext2D, pts: Point[], L: [number, number][], w: number, rad: number): void {
  ctx.beginPath();
  for (const p of pts) ctx.roundRect(p.x - w / 2, p.y - w / 2, w, w, Math.min(rad, w / 2));
  for (const [i, j] of L) {
    const a = pts[i], b = pts[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * w / 2, ny = ((b.x - a.x) / len) * w / 2;
    let poly = [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
    // Same winding as roundRect, so the union fills without holes.
    let area = 0;
    for (let k = 0; k < 4; k++) area += poly[k].x * poly[(k + 1) % 4].y - poly[(k + 1) % 4].x * poly[k].y;
    if (area < 0) poly = poly.reverse();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let k = 1; k < 4; k++) ctx.lineTo(poly[k].x, poly[k].y);
    ctx.closePath();
  }
}

/**
 * The outer rim of a set of grid cells as one rounded path, inset by `inset`
 * pixels (negative grows it), for the flash around a new particle.
 */
function cellOutline(ctx: CanvasRenderingContext2D, cells: Point[], ox: number, oy: number, cell: number, inset: number, radius: number): void {
  const has = new Set(cells.map((p) => `${p.x},${p.y}`));
  // Boundary edges, clockwise in screen space, keyed by their start vertex.
  const next = new Map<string, Point>();
  for (const p of cells) {
    if (!has.has(`${p.x},${p.y - 1}`)) next.set(`${p.x},${p.y}`, { x: p.x + 1, y: p.y });
    if (!has.has(`${p.x + 1},${p.y}`)) next.set(`${p.x + 1},${p.y}`, { x: p.x + 1, y: p.y + 1 });
    if (!has.has(`${p.x},${p.y + 1}`)) next.set(`${p.x + 1},${p.y + 1}`, { x: p.x, y: p.y + 1 });
    if (!has.has(`${p.x - 1},${p.y}`)) next.set(`${p.x},${p.y + 1}`, { x: p.x, y: p.y });
  }
  // Groups of up to three cells have one loop and no vertex shared by two edges.
  const [k0] = next.keys();
  const [sx, sy] = k0.split(',').map(Number);
  const loop: Point[] = [];
  let cur: Point = { x: sx, y: sy };
  for (let guard = 0; guard < 64; guard++) {
    loop.push(cur);
    cur = next.get(`${cur.x},${cur.y}`)!;
    if (cur.x === sx && cur.y === sy) break;
  }
  const corners = loop.filter((v, i) => {
    const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
    return !((a.x === v.x && v.x === b.x) || (a.y === v.y && v.y === b.y));
  });
  const n = corners.length;
  const pts = corners.map((v, i) => {
    const prev = corners[(i + n - 1) % n], nxt = corners[(i + 1) % n];
    const d1 = { x: Math.sign(v.x - prev.x), y: Math.sign(v.y - prev.y) }, d2 = { x: Math.sign(nxt.x - v.x), y: Math.sign(nxt.y - v.y) };
    return { x: ox + v.x * cell + inset * (-d1.y - d2.y), y: oy + v.y * cell + inset * (d1.x + d2.x) };
  });
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    const r = Math.max(0, Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2));
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (i === 0) ctx.moveTo(m.x, m.y);
    else ctx.lineTo(m.x, m.y);
    ctx.arcTo(b.x, b.y, c.x, c.y, r);
  }
  ctx.closePath();
}

/**
 * A bound group: one white particle, with a small mark of each charge it was
 * made from. `pending` (0-1) tints each tile back toward its charge's color:
 * not quite bound, about to be undone.
 */
function hadron(ctx: CanvasRenderingContext2D, pts: Point[], qs: Quark[], L: [number, number][], w: number, rad: number, glow: number, pending = 0): void {
  ctx.save();
  if (glow > 0) { ctx.shadowColor = C.silver; ctx.shadowBlur = w * 0.35 * glow; }
  hadronPath(ctx, pts, L, w, rad);
  ctx.fillStyle = C.tile;
  ctx.fill();
  if (pending > 0) {
    ctx.globalAlpha = pending;
    pts.forEach((p, k) => tile(ctx, p.x - w / 2, p.y - w / 2, w, w, rad, chargeColor(qs[k].color)));
  }
  ctx.restore();
  // The string inside, faint, and a dot per charge.
  ctx.save();
  ctx.strokeStyle = C.silverDim;
  ctx.lineWidth = Math.max(1, w * 0.03);
  ctx.beginPath();
  for (const [i, j] of L) { ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); }
  ctx.stroke();
  const r = Math.max(2.5, w * 0.09);
  pts.forEach((p, k) => {
    const color = chargeColor(qs[k].color);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (qs[k].anti) {
      ctx.fillStyle = C.tile;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, r * 0.5);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  });
  ctx.restore();
}

/**
 * A gluon as Feynman diagrams draw it: a curly line from one point to another.
 * `amp` 0 is a straight, taut string. Uses the current stroke style.
 */
function coil(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, amp: number, loops: number, phase: number): void {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  ctx.beginPath();
  if (amp < 0.3) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }
  const n = loops * 16;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const env = Math.sin(Math.PI * u);
    const ph = Math.PI * 2 * loops * u + phase;
    const along = len * u - amp * env * 1.1 * Math.sin(ph);
    const across = amp * env * Math.cos(ph) - amp * env * 0.2;
    const x = x1 + ux * along - uy * across, y = y1 + uy * along + ux * across;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** A gluon token under the grid: ready, armed (waiting for two tiles) or spent. */
function gluonToken(ctx: CanvasRenderingContext2D, r: Area, mode: 'ready' | 'armed' | 'spent', now: number, reduced: boolean): void {
  const rad = r.w * 0.24;
  ctx.save();
  if (mode === 'spent') {
    ctx.setLineDash([3, 4]);
    tile(ctx, r.x, r.y, r.w, r.h, rad, null, C.line2, 1);
    ctx.setLineDash([]);
    ctx.strokeStyle = C.text3;
  } else if (mode === 'armed') {
    tile(ctx, r.x, r.y, r.w, r.h, rad, C.surface3, C.accent, 2);
    ctx.strokeStyle = C.accent;
  } else {
    tile(ctx, r.x, r.y, r.w, r.h, rad, C.surface2, C.line2, 1);
    ctx.strokeStyle = C.text;
  }
  ctx.lineWidth = Math.max(1.25, r.w * 0.04);
  ctx.lineCap = 'round';
  const cy = r.y + r.h / 2;
  coil(ctx, r.x + r.w * 0.16, cy, r.x + r.w * 0.84, cy, r.h * 0.13, 3, mode === 'armed' && !reduced ? now / 140 : 0);
  ctx.restore();
}

/** A small name tag for a particle that just formed. */
function tag(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, px: number, alpha: number, bounds: Area): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.font = font(px, 500);
  const tw = ctx.measureText(text).width + px * 1.1;
  const th = px * 1.6;
  const x = Math.max(bounds.x + tw / 2 + 1, Math.min(bounds.x + bounds.w - tw / 2 - 1, cx));
  tile(ctx, x - tw / 2, y - th, tw, th, th / 2, C.surface2, C.line2, 1);
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - th / 2 + 1);
  ctx.restore();
}

// ---- the tally ------------------------------------------------------------------------

const PLURAL: Record<GroupKind, string> = { baryon: 'Baryons', antibaryon: 'Antibaryons', meson: 'Mesons' };
const SINGULAR: Record<GroupKind, string> = { baryon: 'Baryon', antibaryon: 'Antibaryon', meson: 'Meson' };

interface Legend { px: number; rows: { t: Tally; w: number }[][]; gap: number; rowH: number; h: number }

const legendName = (t: Tally): string => (t.need === 1 ? SINGULAR : PLURAL)[t.kind];
/** The icon's cell: a particle drawn as a small white pill of two or three cells. */
const iconCell = (px: number): number => px * 0.8;
const iconW = (kind: GroupKind, px: number): number => iconCell(px) * (kind === 'meson' ? 2 : 3);

/**
 * Lays the tally out to fit `width`: one row at the largest size that fits
 * (13 px down to 11), else rows at 11 px, as many items on each as fit.
 */
function legendLayout(ctx: CanvasRenderingContext2D, items: Tally[], width: number): Legend {
  const measure = (px: number) => items.map((t) => {
    ctx.font = font(px, 500);
    const name = ctx.measureText(`${legendName(t)} `).width;
    ctx.font = font(px, 600);
    // The widest the count gets, so the row does not shift as it fills.
    const count = ctx.measureText(`${t.need}/${t.need}`).width;
    return { t, w: iconW(t.kind, px) + px * 0.5 + name + count };
  });
  const sum = (row: { w: number }[], gap: number) => row.reduce((a, x) => a + x.w, 0) + gap * Math.max(0, row.length - 1);
  for (const px of [13, 12, 11]) {
    const row = measure(px), gap = px * 1.3;
    if (sum(row, gap) <= width || px === 11) {
      const rows: { t: Tally; w: number }[][] = [];
      for (const x of row) {
        const last = rows[rows.length - 1];
        if (last && sum([...last, x], gap) <= width) last.push(x);
        else rows.push([x]);
      }
      const rowH = Math.round(px * 1.75);
      return { px, rows, gap, rowH, h: items.length ? rowH * rows.length : 0 };
    }
  }
  throw new Error('unreachable');
}

/** The tally: each kind's icon, its name and how many are bound out of how many the grid makes. Green once all are. */
function drawLegend(ctx: CanvasRenderingContext2D, L: Legend, cx: number, top: number): void {
  const { px } = L;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  L.rows.forEach((row, r) => {
    const total = row.reduce((a, x) => a + x.w, 0) + L.gap * (row.length - 1);
    let x = cx - total / 2;
    const y = top + r * L.rowH + L.rowH / 2;
    for (const { t, w } of row) {
      const full = t.done >= t.need;
      particleIcon(ctx, x, y, t.kind, px);
      let tx = x + iconW(t.kind, px) + px * 0.5;
      const name = `${legendName(t)} `;
      ctx.font = font(px, 500);
      ctx.fillStyle = full ? C.good : C.text2;
      ctx.fillText(name, tx, y + 0.5);
      tx += ctx.measureText(name).width;
      ctx.font = font(px, 600);
      ctx.fillStyle = full ? C.good : C.text;
      ctx.fillText(`${t.done}/${t.need}`, tx, y + 0.5);
      x += w + L.gap;
    }
  });
  ctx.restore();
}

/**
 * A particle kind as a small white pill: a baryon's three charges as filled
 * dots, an antibaryon's as rings, a meson's quark and antiquark as one of each
 * (in pewter: a meson can be any color).
 */
function particleIcon(ctx: CanvasRenderingContext2D, x: number, cy: number, kind: GroupKind, px: number): void {
  const s = iconCell(px), n = kind === 'meson' ? 2 : 3, h = s * 1.15;
  tile(ctx, x, cy - h / 2, s * n, h, h / 2, C.tile);
  const r = s * 0.24;
  for (let k = 0; k < n; k++) {
    const color = kind === 'meson' ? C.pewter : chargeColor(k);
    const anti = kind === 'antibaryon' || (kind === 'meson' && k === 1);
    ctx.beginPath();
    ctx.arc(x + s * (k + 0.5), cy, anti ? r * 0.85 : r, 0, Math.PI * 2);
    if (anti) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.25, r * 0.55);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
}

// ---- the view -------------------------------------------------------------------------

export class ColorChargeView implements PuzzleView {
  private state: ColorChargeState;
  private history: ColorChargeState[] = [];
  /** The tiles picked so far, in order. */
  private sel: number[] = [];
  private dragging = false;
  private changed = false;
  private pendingRemove = -1;
  /** A gluon is armed: the next two neighbors picked swap colors. */
  private armed = false;
  private tokenDown = false;
  private fail: { cells: number[]; at: number } | null = null;
  private binds: BindAnim[] = [];
  private swapAnim: { a: number; b: number; at: number } | null = null;
  /** The last swap, while it still looks provisional. */
  private provisional: Provisional | null = null;
  /**
   * A move that stranded tiles, made at `at`: it undoes itself at `until`,
   * back to the board before it (`history[depth - 1]`). `group` is the bound
   * group it made, or -1 for a swap.
   */
  private pending: { kind: GroupKind | 'swap'; cells: number[]; group: number; at: number; until: number; depth: number } | null = null;
  /** The last move that undid itself, and when, for the hint. */
  private snapped: { kind: GroupKind | 'swap'; at: number } | null = null;
  private lost: number[] = [];
  private dead: number[] = [];
  private lostAt = 0;
  private wonAt: number | null = null;
  private geom: Geom = { cell: 1, x: 0, y: 0, tokens: [], area: { x: 0, y: 0, w: 0, h: 0 }, legend: 0 };
  private reduced: boolean;
  /** Look here: the tiles to ring, for the board it was asked on. */
  private mark: { state: ColorChargeState; cells: number[] } | null = null;

  /**
   * `clock` is the time base input is stamped with; it must match the `now`
   * passed to draw (requestAnimationFrame's, by default). Tests inject one.
   */
  constructor(private readonly initial: ColorChargeState, reducedMotion: boolean, private readonly clock: () => number = () => performance.now()) {
    this.state = cloneCharge(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  stats(): { progress: Stat } { const s = this.state; return { progress: { label: 'Bound', value: `${s.groups.length}/${s.par - s.gluons}` } }; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    const s = this.state;
    if (this.won) return 'All color-neutral';
    const p = this.pending;
    if (p) return `That ${p.kind} strands tiles: undoing`;
    if (this.lost.length) return 'Stranded tiles: undo to free them';
    const q = this.snapped;
    if (q && this.clock() - q.at < SNAPPED_HINT_MS) return q.kind === 'swap' ? 'Swap undone: gluon back' : `${SINGULAR[q.kind]} undone: it stranded tiles`;
    if (this.armed) return 'Gluon ready: pick two neighbors';
    const left = gluonsLeft(s);
    const g = left ? `, ${left} gluon${left === 1 ? '' : 's'}` : '';
    return `${s.groups.length} / ${s.par - s.gluons} bound${g}`;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (this.won) return null;
    if (!onTrack(s)) {
      // A dead end: count back through the history to the last board that can still be cleared.
      for (let n = 1; n <= this.history.length; n++) if (onTrack(this.history[this.history.length - n])) return undoHelp(n);
      return { text: 'Restart to get back on track.' };
    }
    const step = nextStep(s);
    if (!step) return null;
    if (step.kind === 'swap') {
      const [a, b] = step.cells;
      if (level === 2) {
        this.sel = [];
        this.trySwap(a, b);
        return { text: 'Swapped their colors with a gluon.', moved: true };
      }
      this.mark = { state: s, cells: [a, b] };
      return { text: 'These two need to trade colors with a gluon.' };
    }
    const kind = groupKind(s.tiles, step.cells)!;
    if (level === 2) {
      this.armed = false;
      this.sel = [...step.cells];
      this.tryBind();
      return { text: `Bound ${kind === 'antibaryon' ? 'an' : 'a'} ${kind}.`, moved: true };
    }
    this.mark = { state: s, cells: step.cells };
    if (step.only < 0) return { text: `This ${kind} is part of the only way to clear the grid.` };
    return { text: `This ${s.tiles[step.only].anti ? 'antiquark' : 'quark'} can join only this ${kind}.` };
  }

  restart(): void {
    this.state = cloneCharge(this.initial);
    this.history = [];
    this.reset();
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    // Undo while a stranding move waits to undo itself just takes it back now.
    if (this.pending) { this.snap(this.clock()); return true; }
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.reset();
    return true;
  }

  private reset(): void {
    this.sel = [];
    this.armed = false;
    this.binds = [];
    this.swapAnim = null;
    this.provisional = null;
    this.pending = null;
    this.snapped = null;
    this.fail = null;
    this.wonAt = null;
    this.judge();
    this.lostAt = 0;
  }

  /** Finds the stranded regions and, in them, the tiles no group could hold. */
  private judge(): void {
    const s = this.state;
    this.lost = stranded(s);
    this.dead = this.lost.filter((i) => isolated(s, i));
  }

  /** Makes a move; true when it strands tiles that were not stranded before. */
  private commit(next: ColorChargeState): boolean {
    const now = this.clock();
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    this.sel = [];
    // A new move settles the last swap for good.
    if (this.provisional && this.provisional.until > now) this.provisional = { ...this.provisional, until: now };
    const was = this.lost.length;
    this.judge();
    const strands = this.lost.length > 0 && !was;
    if (strands) this.lostAt = now + (this.reduced ? 0 : BIND_MS * 0.6);
    if (solved(next)) this.wonAt = now + (this.reduced ? 0 : BIND_MS * 0.5);
    return strands;
  }

  /** A move just made stranded tiles: it undoes itself after UNDO_MS, unless a pending one already will. */
  private hold(kind: GroupKind | 'swap', cells: number[], group: number, now: number): void {
    this.pending ??= { kind, cells: [...cells], group, at: now, until: now + UNDO_MS, depth: this.history.length };
  }

  private tryBind(): void {
    const next = bind(this.state, this.sel);
    if (next) {
      const kind = groupKind(this.state.tiles, this.sel)!;
      const now = this.clock();
      this.binds = this.binds.filter((b) => now - b.at < BIND_MS + LABEL_MS);
      const cells = [...this.sel];
      this.binds.push({ cells, kind, at: now });
      if (this.commit(next)) this.hold(kind, cells, next.groups.length - 1, now);
      return;
    }
    if (this.sel.length >= 3) this.flunk();
  }

  private trySwap(a: number, b: number): void {
    const next = swap(this.state, a, b);
    if (!next) { this.flunk(); return; }
    const now = this.clock();
    this.armed = false;
    this.swapAnim = { a, b, at: now };
    const strands = this.commit(next);
    // The swap stays provisional for a moment after it lands; one that strands tiles shows them, then undoes itself.
    const land = now + (this.reduced ? 0 : SWAP_MS);
    if (strands) {
      this.lostAt = land;
      this.hold('swap', [a, b], -1, now);
    }
    this.provisional = { a, b, at: land, until: strands ? Math.max(land, this.pending!.until) : land + SETTLE_MS };
  }

  /**
   * Takes back a move that stranded tiles, like Undo (the move, and a swap's
   * gluon, refunded), along with anything made on top of it; a swap's tiles
   * swing home.
   */
  private snap(now: number): void {
    const p = this.pending;
    this.pending = null;
    if (!p || p.depth < 1 || p.depth > this.history.length) return;
    this.state = this.history[p.depth - 1];
    this.history.length = p.depth - 1;
    this.reset();
    this.snapped = { kind: p.kind, at: now };
    if (p.kind === 'swap' && !this.reduced) this.swapAnim = { a: p.cells[0], b: p.cells[1], at: now };
  }

  /** Lets a pending stranding move undo itself once its time is up. */
  private settle(now: number): void {
    if (this.pending && now >= this.pending.until) this.snap(now);
  }

  private flunk(): void {
    this.fail = { cells: this.sel, at: this.clock() };
    this.sel = [];
  }

  private toggleArmed(): void {
    if (this.won) return;
    if (this.armed) { this.armed = false; this.sel = []; return; }
    if (gluonsLeft(this.state) <= 0) return;
    // Two neighbors already picked: swap them at once.
    if (this.sel.length === 2 && canSwap(this.state, this.sel[0], this.sel[1])) { this.trySwap(this.sel[0], this.sel[1]); return; }
    this.armed = true;
    if (this.sel.length !== 1) this.sel = [];
  }

  // ---- input ----------------------------------------------------------------------

  private tileAt(p: Point, strict: boolean): number {
    const { cell, x, y } = this.geom;
    const fc = (p.x - x) / cell, fr = (p.y - y) / cell;
    const c = Math.floor(fc), r = Math.floor(fr);
    if (c < 0 || r < 0 || c >= this.state.cols || r >= this.state.rows) return -1;
    // While dragging, only the middle of a tile counts, so cutting a corner does not pick a diagonal.
    if (strict && Math.hypot(fc - c - 0.5, fr - r - 0.5) > 0.42) return -1;
    return r * this.state.cols + c;
  }

  private tokenAt(p: Point): boolean {
    return this.geom.tokens.some((r) => p.x >= r.x - 4 && p.x <= r.x + r.w + 4 && p.y >= r.y - 4 && p.y <= r.y + r.h + 4);
  }

  private free(i: number): boolean { return i >= 0 && this.state.bound[i] < 0; }

  /** How many tiles a pick can hold: two for a swap, three for a group. */
  private get cap(): number { return this.armed ? 2 : 3; }

  down(p: Point): void {
    if (this.won) return;
    // A stranding move is on show: any touch takes it back at once and does nothing else.
    if (this.pending) { this.snap(this.clock()); return; }
    if (this.tokenAt(p)) { this.tokenDown = true; return; }
    const t = this.tileAt(p, false);
    this.dragging = true;
    this.changed = false;
    this.pendingRemove = -1;
    if (!this.free(t)) { this.sel = []; return; }
    if (this.sel.includes(t)) { this.pendingRemove = t; return; }
    if (this.sel.length && this.sel.length < this.cap && this.sel.some((j) => adjacent(this.state.cols, j, t))) this.sel = [...this.sel, t];
    else this.sel = [t];
    this.changed = true;
  }

  move(p: Point): void {
    if (!this.dragging || !this.sel.length) return;
    const t = this.tileAt(p, true);
    if (t < 0 || t === this.sel[this.sel.length - 1]) return;
    if (t === this.sel[this.sel.length - 2]) {
      this.sel = this.sel.slice(0, -1);
      this.changed = true;
      return;
    }
    if (this.free(t) && !this.sel.includes(t) && this.sel.length < this.cap && adjacent(this.state.cols, this.sel[this.sel.length - 1], t)) {
      this.sel = [...this.sel, t];
      this.changed = true;
    }
  }

  up(p: Point): void {
    if (this.tokenDown) {
      this.tokenDown = false;
      if (this.tokenAt(p)) this.toggleArmed();
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    if (this.pendingRemove >= 0 && !this.changed) {
      this.sel = this.sel.filter((i) => i !== this.pendingRemove);
      this.pendingRemove = -1;
      return;
    }
    if (this.armed) {
      if (this.sel.length === 2) this.trySwap(this.sel[0], this.sel[1]);
      return;
    }
    this.tryBind();
  }

  cancel(): void {
    this.dragging = false;
    this.tokenDown = false;
    this.sel = [];
  }

  key(e: KeyboardEvent): boolean {
    if (this.pending && (e.key === 'Escape' || e.key === 'g' || e.key === 'G')) { this.snap(this.clock()); return true; }
    if (e.key === 'Escape' && (this.sel.length || this.armed)) { this.sel = []; this.armed = false; return true; }
    if ((e.key === 'g' || e.key === 'G') && this.state.gluons) { this.toggleArmed(); return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.settle(now);
    const s = this.state;
    const p = this.pending;
    const group = p ? p.group : -1;
    // The tally leaves out a particle that is about to be undone.
    const legend = legendLayout(ctx, tally(s, group), area.w - 20);
    this.geom = boardGeom(area, s.cols, s.rows, s.gluons, { legend: legend.h });
    paint(ctx, {
      cols: s.cols, rows: s.rows, tiles: s.tiles, bound: s.bound, groups: s.groups, swaps: s.swaps, gluons: s.gluons,
      sel: this.sel, armed: this.armed, stranded: this.lost, dead: this.dead, strandedAt: this.lostAt,
      binds: this.binds, swapAnim: this.swapAnim, provisional: this.provisional, fail: this.fail, wonAt: this.wonAt !== null && now >= this.wonAt ? this.wonAt : null,
      pending: p && group >= 0 ? { group, at: p.at, until: p.until } : null,
    }, this.geom, now, this.reduced);
    drawLegend(ctx, legend, this.geom.x + (this.geom.cell * s.cols) / 2, this.geom.legend);

    // Look here: each tile of the group (or the two to swap).
    if (this.mark?.state === s && !this.won) {
      const { cell: c, x, y } = this.geom;
      const pad = tilePad(c);
      for (const i of this.mark.cells) drawHelpMark(ctx, x + (i % s.cols) * c + pad, y + Math.floor(i / s.cols) * c + pad, c - pad * 2, c - pad * 2, now, this.reduced, c * 0.18);
    }
  }
}

// ---- rule cards -----------------------------------------------------------------------

type StoryEvent =
  | { at: number; pick: number }
  | { at: number; clear: true }
  | { at: number; arm: true }
  | { at: number; swap: [number, number] }
  /** The pick is refused: its rings and strings turn amber and stay. */
  | { at: number; reject: true }
  | { at: number; bind: number[] };

interface Story {
  cols: number;
  rows: number;
  /** Tiles as letters, row by row: r g b for quarks, R G B for antiquarks, . for an empty cell. */
  tiles: string;
  gluons?: number;
  /** Seconds the story takes; the still is its last frame. */
  duration: number;
  caption: string;
  events: StoryEvent[];
  /** Show the board's real stranded marks as the story plays. */
  strands?: boolean;
  /** Leave room above the board for a particle's name and keep it up once it has risen; otherwise no names. */
  names?: boolean;
}

const parseTiles = (s: string): (Quark | null)[] =>
  [...s.replace(/\s/g, '')].map((ch) => (ch === '.' ? null : { color: 'rgb'.indexOf(ch.toLowerCase()) as 0 | 1 | 2, anti: ch !== ch.toLowerCase() }));

/**
 * A picture for the Instructions modal: a short story on a tiny board, drawn
 * with the board's own painter. It plays from 0 to `duration`; the still is
 * the last frame. A move that strands tiles is caught while it is on show
 * (the board would undo it right after).
 */
function picture(d: Story): Illustration {
  const cells = parseTiles(d.tiles);
  const hidden = cells.map((q) => !q);
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void => {
    const ms = Math.max(0, Math.min(t, d.duration)) * 1000;
    const gluons = d.gluons ?? 0;
    // Empty cells count as bound to a group that is never drawn, so the rules leave them alone.
    let s: ColorChargeState = {
      cols: d.cols, rows: d.rows, tiles: cells.map((q) => q ?? { color: 0, anti: false }),
      bound: hidden.map((e) => (e ? 999 : -1)), groups: [], gluons, swaps: [], solution: [], solutionSwaps: [], moves: 0, par: 0,
    };
    let sel: number[] = [];
    let armed = false;
    let rejected = false;
    let binds: BindAnim[] = [];
    let swapAnim: Scene['swapAnim'] = null;
    let provisional: Provisional | null = null;
    let pending: Scene['pending'] = null;
    let strandAt = 0;
    for (const e of d.events) {
      if (e.at * 1000 > ms) break;
      const at = e.at * 1000;
      if ('pick' in e) sel = [...sel, e.pick];
      else if ('clear' in e) { sel = []; rejected = false; }
      else if ('arm' in e) armed = true;
      else if ('reject' in e) rejected = true;
      else if ('swap' in e) {
        const next = swap(s, e.swap[0], e.swap[1]);
        const strands = !!next && stranded(next).length > 0;
        s = next ?? s;
        armed = false;
        sel = [];
        swapAnim = { a: e.swap[0], b: e.swap[1], at };
        // A stranding swap stays provisional to the end of the story; a good one settles.
        provisional = { a: e.swap[0], b: e.swap[1], at: at + SWAP_MS, until: strands ? Infinity : at + SWAP_MS + SETTLE_MS };
        strandAt = at + SWAP_MS;
      } else {
        const kind = groupKind(s.tiles, e.bind);
        if (kind && canBind(s, e.bind)) {
          s = bind(s, e.bind)!;
          binds = [...binds, { cells: e.bind, kind, at }];
          strandAt = at + BIND_MS * 0.6;
          // A group that strands tiles is on show, not quite bound, to the end of the story.
          if (d.strands && !pending && stranded(s).length) pending = { group: s.groups.length - 1, at, until: Infinity };
        }
        sel = [];
      }
    }
    const lost = d.strands ? stranded(s) : [];
    const G = boardGeom({ x: 0, y: 0, w, h }, d.cols, d.rows, gluons, { maxCell: Math.min(48, h * 0.42), margin: 4, top: d.names ? Math.min(26, h * 0.25) : 0, token: Math.min(TOKEN, Math.max(18, h * 0.24)), side: true });
    ctx.save();
    paint(ctx, {
      cols: d.cols, rows: d.rows, tiles: s.tiles, bound: s.bound, groups: s.groups, swaps: s.swaps, gluons,
      sel, armed, rejected, stranded: lost, dead: lost.filter((i) => isolated(s, i)), strandedAt: strandAt,
      binds, swapAnim, provisional, fail: null, wonAt: null, hidden, names: d.names ? 'hold' : 'off', pending,
    }, G, ms, false);
    // The finger, on the last tile picked or on the gluon it just armed; the still leaves it out.
    if (ms >= d.duration * 1000) { /* the still */ } else if (sel.length) {
      const i = sel[sel.length - 1];
      finger(ctx, G.x + (i % d.cols + 0.68) * G.cell, G.y + (Math.floor(i / d.cols) + 0.7) * G.cell, G.cell * 0.14);
    } else if (armed && G.tokens.length) {
      const r = G.tokens[G.tokens.length - 1];
      finger(ctx, r.x + r.w * 0.68, r.y + r.h * 0.7, G.cell * 0.14);
    }
    ctx.restore();
  };
  return { draw, duration: d.duration, caption: d.caption };
}

/** A fingertip, for the demos only. */
function finger(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.globalAlpha *= 0.85;
  ctx.fillStyle = C.text;
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(5, r), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * The rules, each with the rule kept (good) and, where something can go wrong,
 * the rule broken (bad). Stills are the last frame; Play runs good, then bad.
 */
export const RULES: RuleCard[] = [
  {
    title: 'Baryon',
    text: 'Every tile is a quark with a color charge: red, green or blue. Drag across three in a line or an L, one of each color, and they bind into a white baryon; clear the whole grid.',
    good: picture({
      cols: 2, rows: 2, tiles: 'rg.b', duration: 2.6, names: true, caption: 'One of each: baryon',
      events: [{ at: 0.3, pick: 0 }, { at: 0.65, pick: 1 }, { at: 1.0, pick: 3 }, { at: 1.3, bind: [0, 1, 3] }],
    }),
    bad: picture({
      cols: 2, rows: 2, tiles: 'rg.g', duration: 1.8, names: true, caption: 'Two greens: no bind',
      events: [{ at: 0.3, pick: 0 }, { at: 0.65, pick: 1 }, { at: 1.0, pick: 3 }, { at: 1.3, reject: true }],
    }),
  },
  {
    title: 'Stranded tiles',
    text: 'Every tile must end up in a group. Tiles that can no longer all be bound glow inside a thick amber rim, and a tile nothing could bind also gets an amber ring and a ! mark. The move that stranded them fades and is undone after two seconds.',
    good: picture({
      cols: 3, rows: 2, tiles: 'rgb gbr', duration: 2.4, caption: 'Two rows: all bound',
      events: [{ at: 0.3, pick: 0 }, { at: 0.55, pick: 1 }, { at: 0.8, pick: 2 }, { at: 1.0, bind: [0, 1, 2] }, { at: 1.7, bind: [3, 4, 5] }],
    }),
    bad: picture({
      cols: 3, rows: 2, tiles: 'rgb gbr', duration: 2.4, strands: true, caption: 'This L strands three',
      events: [{ at: 0.3, pick: 0 }, { at: 0.6, pick: 1 }, { at: 0.9, pick: 4 }, { at: 1.1, bind: [0, 1, 4] }],
    }),
  },
  {
    title: 'Gluon',
    text: 'Gluons carry color. Tap a gluon, then two neighboring quarks (or two antiquarks): they trade colors, for one move. The swap looks dashed until it settles; one that strands tiles undoes itself and hands the gluon back.',
    good: picture({
      cols: 3, rows: 3, tiles: 'bgg bbr grr', gluons: 1, duration: 4, strands: true, caption: 'Swap, then three baryons',
      events: [
        { at: 0.3, arm: true }, { at: 0.6, pick: 2 }, { at: 0.9, pick: 5 }, { at: 1.1, swap: [2, 5] },
        { at: 2.2, bind: [0, 1, 2] }, { at: 2.65, bind: [3, 6, 7] }, { at: 3.1, bind: [4, 5, 8] },
      ],
    }),
    bad: picture({
      cols: 3, rows: 3, tiles: 'bgg bbr grr', gluons: 1, duration: 2.9, strands: true, caption: 'Strands tiles: undone',
      events: [{ at: 0.3, arm: true }, { at: 0.6, pick: 0 }, { at: 0.9, pick: 1 }, { at: 1.1, swap: [0, 1] }],
    }),
  },
  {
    title: 'Antiquark',
    text: 'A hollow tile with a bar over its letter is an antiquark, carrying an anticolor such as antigreen. It never joins quarks in a baryon.',
    good: picture({
      cols: 3, rows: 2, tiles: 'rgb RGB', duration: 1.6, caption: 'Hollow, barred: antiquarks',
      events: [{ at: 0.3, pick: 3 }, { at: 0.6, pick: 4 }, { at: 0.9, pick: 5 }, { at: 1.4, clear: true }],
    }),
    bad: picture({
      cols: 3, rows: 1, tiles: 'rgB', duration: 1.8, caption: 'No antiquark in a baryon',
      events: [{ at: 0.3, pick: 0 }, { at: 0.65, pick: 1 }, { at: 1.0, pick: 2 }, { at: 1.3, reject: true }],
    }),
  },
  {
    title: 'Meson',
    text: 'A quark binds with the antiquark of its own color beside it, such as green with antigreen, into a meson.',
    good: picture({
      cols: 2, rows: 1, tiles: 'gG', duration: 2.2, names: true, caption: 'Green, antigreen: meson',
      events: [{ at: 0.3, pick: 0 }, { at: 0.7, pick: 1 }, { at: 1.0, bind: [0, 1] }],
    }),
    bad: picture({
      cols: 2, rows: 1, tiles: 'gR', duration: 1.5, names: true, caption: 'Green, antired: amber',
      events: [{ at: 0.3, pick: 0 }, { at: 0.7, pick: 1 }],
    }),
  },
  {
    title: 'Antibaryon',
    text: 'Three antiquarks in a line or an L, one of each anticolor, bind into an antibaryon, the antimatter partner of a baryon.',
    good: picture({
      cols: 3, rows: 1, tiles: 'BRG', duration: 2.6, names: true, caption: 'Each anticolor: antibaryon',
      events: [{ at: 0.3, pick: 0 }, { at: 0.65, pick: 1 }, { at: 1.0, pick: 2 }, { at: 1.3, bind: [0, 1, 2] }],
    }),
    bad: picture({
      cols: 3, rows: 1, tiles: 'BRR', duration: 1.8, names: true, caption: 'Two antireds: no bind',
      events: [{ at: 0.3, pick: 0 }, { at: 0.65, pick: 1 }, { at: 1.0, pick: 2 }, { at: 1.3, reject: true }],
    }),
  },
];
