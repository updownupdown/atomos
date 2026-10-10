// Drawing and touch for Color Charge: drag across tiles (or tap them one by
// one) to pick a group; a color-neutral group binds, its gluon strings snap
// tight and it collapses into one white hadron. On gluon levels a gluon token
// sits under the grid: tap it, then two neighboring tiles, to swap their
// colors. Regions that can no longer all be bound get an amber rim, and a
// tile no group could hold dims inside an amber ring.
//
// Everything is painted from a Scene, a plain description of the board and its
// running animations, so the rule cards replay the same drawing as the board.

import { adjacent, bind, canBind, canSwap, cloneCharge, COLOR_LETTERS, gluonsLeft, groupKind, isolated, solved, stranded, swap, type ColorChargeState, type GroupKind, type Quark } from './colorCharge';
import { C, fitGrid, font, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView, type RuleCard } from './view';

/**
 * The three charge colors, read at draw time; the letters carry them too.
 * Stand-ins until the palette has charge tokens: C.s is an orbital color and
 * C.bad / C.good mean wrong and right elsewhere.
 */
export const chargeColor = (k: number): string => [C.bad, C.good, C.s][k];

const FAIL_MS = 380;
const BIND_MS = 560;
const SWAP_MS = 420;
const LABEL_MS = 1100;
const STRAND_MS = 320;
const TOKEN = 44;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Reserve puzzle, proposed for the quark chapter of the particles. The grid grows from 3×3 (z 1–10) to 4×3 (11–30), 4×4 with two mesons (31–54), 4×5 with four mesons and an antibaryon (55–86) and 5×5 with five mesons and two antibaryons (87–118). Gluons: one at z 21–30, 45–54, 71–86 and 87–103, two on the synthetic elements (104–118). Every grid has exactly one clearance: a gluon level cannot be cleared without its swaps, and only one set of swaps and groups clears it. Par is the groups plus the swaps; every bind and every swap is a move, Undo is free and takes it back, and clean means clearing the grid within par. Keyboard: G arms a gluon, Escape drops the pick.</p>`;

// ---- the scene ------------------------------------------------------------------------

interface BindAnim { cells: number[]; kind: GroupKind; at: number }

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
  fail: { cells: number[]; at: number } | null;
  wonAt: number | null;
  /** Cells left out of the board altogether (rule-card boards that are not rectangles). */
  hidden?: boolean[];
}

interface Geom { cell: number; x: number; y: number; tokens: Area[]; area: Area }

function boardGeom(area: Area, cols: number, rows: number, gluons: number, opts: { maxCell?: number; margin?: number; top?: number; token?: number; side?: boolean } = {}): Geom {
  const tokenSide = opts.token ?? TOKEN;
  const gap = 10;
  const tokens: Area[] = [];
  if (opts.side && gluons) {
    // Rule cards: the gluons stand left of the grid, to leave the tiny board its height.
    const strip = tokenSide + 8;
    const g = fitGrid({ ...area, x: area.x + strip, w: area.w - strip }, cols, rows, { margin: opts.margin ?? 10, maxCell: opts.maxCell ?? 72, top: opts.top ?? 0 });
    const total = gluons * tokenSide + (gluons - 1) * gap;
    for (let k = 0; k < gluons; k++) tokens.push({ x: g.x - strip, y: g.y + (g.h - total) / 2 + k * (tokenSide + gap), w: tokenSide, h: tokenSide });
    return { cell: g.cell, x: g.x, y: g.y, tokens, area };
  }
  const strip = gluons ? tokenSide + 16 : 0;
  const g = fitGrid(area, cols, rows, { margin: opts.margin ?? 10, maxCell: opts.maxCell ?? 72, top: opts.top ?? 0, bottom: strip });
  const total = gluons * tokenSide + (gluons - 1) * gap;
  for (let k = 0; k < gluons; k++) {
    tokens.push({ x: g.x + (g.w - total) / 2 + k * (tokenSide + gap), y: g.y + g.h + 12, w: tokenSide, h: tokenSide });
  }
  return { cell: g.cell, x: g.x, y: g.y, tokens, area };
}

const ease2 = (t: number): number => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

function paint(ctx: CanvasRenderingContext2D, sc: Scene, G: Geom, now: number, reduced: boolean): void {
  const c = G.cell, pad = Math.max(3, c * 0.08), w = c - pad * 2, rad = c * 0.18;
  const center = (i: number): Point => ({ x: G.x + (i % sc.cols + 0.5) * c, y: G.y + (Math.floor(i / sc.cols) + 0.5) * c });
  const animOf = (cells: number[]) => (reduced ? undefined : sc.binds.find((b) => b.cells.length === cells.length && b.cells.every((i) => cells.includes(i)) && now - b.at < BIND_MS));
  const swapT = sc.swapAnim && !reduced ? (now - sc.swapAnim.at) / SWAP_MS : 1;
  const swapping = swapT < 1 ? sc.swapAnim : null;
  const failT = sc.fail && !reduced ? (now - sc.fail.at) / FAIL_MS : 1;
  const strandSet = new Set(sc.stranded);
  const strandT = reduced ? 1 : ease((now - sc.strandedAt) / STRAND_MS);
  const won = sc.wonAt !== null;

  // Faint sockets under every cell, so the grid reads as a board.
  for (let i = 0; i < sc.tiles.length; i++) {
    if (sc.hidden?.[i]) continue;
    const p = center(i);
    tile(ctx, p.x - w / 2, p.y - w / 2, w, w, rad, null, C.line, 1);
  }

  // Bound groups at rest: one white hadron each.
  sc.groups.forEach((grp, gi) => {
    if (animOf(grp)) return;
    let glow = 0;
    if (won && !reduced) {
      const t = (now - sc.wonAt! - gi * 90) / 700;
      glow = t < 0 ? 0 : t < 1 ? 0.35 + 0.65 * Math.sin(Math.PI * t) : 0.35;
    } else if (won) glow = 0.35;
    hadron(ctx, grp.map(center), grp.map((i) => sc.tiles[i]), links(sc.cols, grp), w, rad, glow);
  });

  // Free tiles; a tile no group could hold dims.
  const deadSet = new Set(sc.dead);
  for (let i = 0; i < sc.tiles.length; i++) {
    if (sc.bound[i] >= 0) continue;
    if (swapping && (i === swapping.a || i === swapping.b)) continue;
    const p = center(i);
    if (sc.fail?.cells.includes(i) && failT < 1) p.x += Math.sin(failT * Math.PI * 6) * c * 0.06 * (1 - failT);
    quark(ctx, p.x, p.y, w, rad, sc.tiles[i], deadSet.has(i) ? 1 - 0.55 * strandT : 1);
  }

  // Stranded regions: an amber dashed rim around them, and a ring on each dead tile.
  if (strandSet.size) {
    const breathe = reduced ? 1 : 0.7 + 0.3 * Math.sin(now / 420);
    ctx.save();
    ctx.globalAlpha = strandT * breathe;
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (const i of strandSet) {
      const x0 = G.x + (i % sc.cols) * c, y0 = G.y + Math.floor(i / sc.cols) * c;
      const r = Math.floor(i / sc.cols), k = i % sc.cols;
      const out = (j: number, ok: boolean) => !ok || !strandSet.has(j);
      const e = pad * 0.5;
      if (out(i - sc.cols, r > 0)) { ctx.moveTo(x0 + e, y0 + e); ctx.lineTo(x0 + c - e, y0 + e); }
      if (out(i + sc.cols, r < sc.rows - 1)) { ctx.moveTo(x0 + e, y0 + c - e); ctx.lineTo(x0 + c - e, y0 + c - e); }
      if (out(i - 1, k > 0)) { ctx.moveTo(x0 + e, y0 + e); ctx.lineTo(x0 + e, y0 + c - e); }
      if (out(i + 1, k < sc.cols - 1)) { ctx.moveTo(x0 + c - e, y0 + e); ctx.lineTo(x0 + c - e, y0 + c - e); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const i of deadSet) {
      const p = center(i);
      tile(ctx, p.x - w / 2 - 2.5, p.y - w / 2 - 2.5, w + 5, w + 5, rad * 1.1, null, C.warn, 2);
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
    quark(ctx, ta.x, ta.y, size, rad * size / w, sc.tiles[swapping.a], 1);
    quark(ctx, tb.x, tb.y, size, rad * size / w, sc.tiles[swapping.b], 1);
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

  // Swaps already made: a small gluon across the edge the two tiles share.
  for (const [a, b] of sc.swaps) {
    const pa = center(a), pb = center(b);
    const t = swapping && swapping.a === a && swapping.b === b ? ease(swapT) : 1;
    const dx = (pb.x - pa.x) / c, dy = (pb.y - pa.y) / c;
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const both = sc.bound[a] >= 0 && sc.bound[b] >= 0;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.strokeStyle = both ? C.pewter : C.silver;
    ctx.lineWidth = Math.max(1.5, c * 0.03);
    ctx.lineCap = 'round';
    coil(ctx, mx - dx * c * 0.24, my - dy * c * 0.24, mx + dx * c * 0.24, my + dy * c * 0.24, c * 0.07, 2, 0);
    ctx.restore();
  }

  // The pick: an accent ring per tile, joined by strings that pull straight once the pick is neutral.
  if (sc.sel.length) {
    const neutral = !sc.armed && sc.sel.length > 1 && groupKind(sc.tiles, sc.sel) !== null;
    ctx.save();
    ctx.strokeStyle = C.accent;
    ctx.lineCap = 'round';
    ctx.lineWidth = neutral ? 2.5 : 1.75;
    for (let k = 1; k < sc.sel.length; k++) {
      const p = center(sc.sel[k - 1]), q = center(sc.sel[k]);
      coil(ctx, p.x, p.y, q.x, q.y, neutral ? 0 : c * 0.09, 3, sc.armed ? now / 120 : 0);
    }
    const dead = !sc.armed && hopeless(sc.tiles, sc.sel);
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
  if (!reduced) {
    for (const b of sc.binds) {
      const t = (now - b.at - BIND_MS * 0.42) / LABEL_MS;
      if (t < 0 || t >= 1) continue;
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

/** A free tile: a quark is a solid tile in its color, an antiquark a hollow one with a bar over its letter. */
function quark(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rad: number, q: Quark, alpha: number): void {
  const color = chargeColor(q.color);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (q.anti) {
    const lw = Math.max(2, w * 0.045);
    tile(ctx, x - w / 2 + lw / 2, y - w / 2 + lw / 2, w - lw, w - lw, rad, C.surface2, color, lw);
    letter(ctx, x, y, w, COLOR_LETTERS[q.color], color, true);
  } else {
    tile(ctx, x - w / 2, y - w / 2, w, w, rad, color);
    letter(ctx, x, y, w, COLOR_LETTERS[q.color], C.tileInk, false);
  }
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

/** A bound group: one white particle, with a small mark of each charge it was made from. */
function hadron(ctx: CanvasRenderingContext2D, pts: Point[], qs: Quark[], L: [number, number][], w: number, rad: number, glow: number): void {
  ctx.save();
  if (glow > 0) { ctx.shadowColor = C.silver; ctx.shadowBlur = w * 0.35 * glow; }
  hadronPath(ctx, pts, L, w, rad);
  ctx.fillStyle = C.tile;
  ctx.fill();
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
  private lost: number[] = [];
  private dead: number[] = [];
  private lostAt = 0;
  private wonAt: number | null = null;
  private geom: Geom = { cell: 1, x: 0, y: 0, tokens: [], area: { x: 0, y: 0, w: 0, h: 0 } };
  private reduced: boolean;

  constructor(private readonly initial: ColorChargeState, reducedMotion: boolean) {
    this.state = cloneCharge(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    const s = this.state;
    if (this.won) return 'All color-neutral';
    if (this.lost.length) return 'Stranded tiles: undo to free them';
    if (this.armed) return 'Gluon ready: pick two neighbors';
    const left = gluonsLeft(s);
    const g = left ? `, ${left} gluon${left === 1 ? '' : 's'}` : '';
    return `${s.groups.length} / ${s.par - s.gluons} bound${g}`;
  }

  restart(): void {
    this.state = cloneCharge(this.initial);
    this.history = [];
    this.reset();
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
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

  private commit(next: ColorChargeState): void {
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    this.sel = [];
    const was = this.lost.length;
    this.judge();
    if (this.lost.length && !was) this.lostAt = performance.now() + (this.reduced ? 0 : BIND_MS * 0.6);
    if (solved(next)) this.wonAt = performance.now() + (this.reduced ? 0 : BIND_MS * 0.5);
  }

  private tryBind(): void {
    const next = bind(this.state, this.sel);
    if (next) {
      const kind = groupKind(this.state.tiles, this.sel)!;
      const now = performance.now();
      this.binds = this.binds.filter((b) => now - b.at < BIND_MS + LABEL_MS);
      this.binds.push({ cells: [...this.sel], kind, at: now });
      this.commit(next);
      return;
    }
    if (this.sel.length >= 3) this.flunk();
  }

  private trySwap(a: number, b: number): void {
    const next = swap(this.state, a, b);
    if (!next) { this.flunk(); return; }
    this.armed = false;
    this.swapAnim = { a, b, at: performance.now() };
    this.commit(next);
  }

  private flunk(): void {
    this.fail = { cells: this.sel, at: performance.now() };
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
    if (e.key === 'Escape' && (this.sel.length || this.armed)) { this.sel = []; this.armed = false; return true; }
    if ((e.key === 'g' || e.key === 'G') && this.state.gluons) { this.toggleArmed(); return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    this.geom = boardGeom(area, s.cols, s.rows, s.gluons);
    paint(ctx, {
      cols: s.cols, rows: s.rows, tiles: s.tiles, bound: s.bound, groups: s.groups, swaps: s.swaps, gluons: s.gluons,
      sel: this.sel, armed: this.armed, stranded: this.lost, dead: this.dead, strandedAt: this.lostAt,
      binds: this.binds, swapAnim: this.swapAnim, fail: this.fail, wonAt: this.wonAt !== null && now >= this.wonAt ? this.wonAt : null,
    }, this.geom, now, this.reduced);
  }
}

// ---- rule cards -----------------------------------------------------------------------

type DemoEvent =
  | { at: number; pick: number }
  | { at: number; clear: true }
  | { at: number; arm: true }
  | { at: number; swap: [number, number] }
  | { at: number; bind: number[] };

interface Demo {
  cols: number;
  rows: number;
  /** Tiles as letters, row by row: r g b for quarks, R G B for antiquarks, . for an empty cell. */
  tiles: string;
  gluons?: number;
  /** Loop length in seconds; the board fades back to the start over its last half second. */
  loop: number;
  events: DemoEvent[];
  /** Show the board's real stranded marks as the story plays. */
  strands?: boolean;
}

const parseTiles = (s: string): (Quark | null)[] =>
  [...s.replace(/\s/g, '')].map((ch) => (ch === '.' ? null : { color: 'rgb'.indexOf(ch.toLowerCase()) as 0 | 1 | 2, anti: ch !== ch.toLowerCase() }));

/** Replays a short story on a tiny board with the board's own painter. */
function playDemo(d: Demo): (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void {
  const cells = parseTiles(d.tiles);
  const hidden = cells.map((q) => !q);
  return (ctx, w, h, t) => {
    const tt = t % d.loop;
    const ms = tt * 1000;
    const gluons = d.gluons ?? 0;
    // Empty cells count as bound to a group that is never drawn, so the rules leave them alone.
    let s: ColorChargeState = {
      cols: d.cols, rows: d.rows, tiles: cells.map((q) => q ?? { color: 0, anti: false }),
      bound: hidden.map((e) => (e ? 999 : -1)), groups: [], gluons, swaps: [], solution: [], solutionSwaps: [], moves: 0, par: 0,
    };
    let sel: number[] = [];
    let armed = false;
    let binds: BindAnim[] = [];
    let swapAnim: Scene['swapAnim'] = null;
    let lastAt = 0;
    for (const e of d.events) {
      if (e.at * 1000 > ms) break;
      lastAt = e.at * 1000;
      if ('pick' in e) sel = [...sel, e.pick];
      else if ('clear' in e) sel = [];
      else if ('arm' in e) armed = true;
      else if ('swap' in e) {
        s = swap(s, e.swap[0], e.swap[1]) ?? s;
        armed = false;
        sel = [];
        swapAnim = { a: e.swap[0], b: e.swap[1], at: e.at * 1000 };
      } else {
        const kind = groupKind(s.tiles, e.bind);
        if (kind && canBind(s, e.bind)) {
          s = bind(s, e.bind)!;
          binds = [...binds, { cells: e.bind, kind, at: e.at * 1000 }];
        }
        sel = [];
      }
    }
    const lost = d.strands ? stranded(s) : [];
    const G = boardGeom({ x: 0, y: 0, w, h }, d.cols, d.rows, gluons, { maxCell: Math.min(48, h * 0.42), margin: 4, top: d.events.some((e) => 'bind' in e) ? Math.min(26, h * 0.25) : 0, token: Math.min(TOKEN, Math.max(18, h * 0.24)), side: true });
    const fade = tt > d.loop - 0.5 ? (d.loop - tt) / 0.5 : tt < 0.25 ? tt / 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    paint(ctx, {
      cols: d.cols, rows: d.rows, tiles: s.tiles, bound: s.bound, groups: s.groups, swaps: s.swaps, gluons,
      sel, armed, stranded: lost, dead: lost.filter((i) => isolated(s, i)), strandedAt: lastAt + BIND_MS * 0.6,
      binds, swapAnim, fail: null, wonAt: null, hidden,
    }, G, ms, false);
    // The finger, on the last tile picked or on the gluon it just armed.
    if (sel.length) {
      const i = sel[sel.length - 1];
      finger(ctx, G.x + (i % d.cols + 0.68) * G.cell, G.y + (Math.floor(i / d.cols) + 0.7) * G.cell, G.cell * 0.14);
    } else if (armed && G.tokens.length) {
      const r = G.tokens[G.tokens.length - 1];
      finger(ctx, r.x + r.w * 0.68, r.y + r.h * 0.7, G.cell * 0.14);
    }
    ctx.restore();
  };
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

export const RULES: RuleCard[] = [
  {
    title: 'Baryon',
    text: 'Every tile is a quark with a color charge: red, green or blue. Drag across three in a line or an L, one of each color, and they bind into a white baryon; clear the whole grid.',
    demo: playDemo({
      cols: 2, rows: 2, tiles: 'rg.b', loop: 4,
      events: [{ at: 0.5, pick: 0 }, { at: 0.9, pick: 1 }, { at: 1.3, pick: 3 }, { at: 1.6, bind: [0, 1, 3] }],
    }),
  },
  {
    title: 'Stranded tiles',
    text: 'Every tile must end up in a group. Tiles that can no longer all be bound get an amber dashed rim, and a tile nothing could bind dims in an amber ring; undo to free them.',
    demo: playDemo({
      cols: 3, rows: 2, tiles: 'rgb gbr', loop: 5, strands: true,
      events: [{ at: 0.5, pick: 0 }, { at: 0.85, pick: 1 }, { at: 1.2, pick: 4 }, { at: 1.5, bind: [0, 1, 4] }],
    }),
  },
  {
    title: 'Gluon',
    text: 'Gluons carry color. Tap a gluon under the grid, then two neighboring quarks (or two antiquarks): they trade colors, for one move, and a small curl marks the swap.',
    demo: playDemo({
      cols: 3, rows: 2, tiles: 'rgg rbb', gluons: 1, loop: 6,
      events: [
        { at: 0.5, arm: true }, { at: 1.0, pick: 2 }, { at: 1.4, pick: 5 }, { at: 1.6, swap: [2, 5] },
        { at: 2.6, bind: [0, 1, 2] }, { at: 3.4, bind: [3, 4, 5] },
      ],
    }),
  },
  {
    title: 'Antiquark',
    text: 'A hollow tile with a bar over its letter is an antiquark, carrying an anticolor such as antigreen. It never joins quarks in a baryon, so a pick of a quark and a different antiquark rings amber.',
    demo: playDemo({
      cols: 3, rows: 1, tiles: 'rGB', loop: 3.6,
      events: [{ at: 0.6, pick: 0 }, { at: 1.1, pick: 1 }, { at: 2.8, clear: true }],
    }),
  },
  {
    title: 'Meson',
    text: 'A quark binds with the antiquark of its own color beside it, such as red with antired, into a meson.',
    demo: playDemo({
      cols: 2, rows: 1, tiles: 'gG', loop: 3.6,
      events: [{ at: 0.5, pick: 0 }, { at: 0.9, pick: 1 }, { at: 1.2, bind: [0, 1] }],
    }),
  },
  {
    title: 'Antibaryon',
    text: 'Three antiquarks in a line or an L, one of each anticolor, bind into an antibaryon, the antimatter partner of a baryon.',
    demo: playDemo({
      cols: 3, rows: 1, tiles: 'BRG', loop: 4,
      events: [{ at: 0.5, pick: 0 }, { at: 0.85, pick: 1 }, { at: 1.2, pick: 2 }, { at: 1.5, bind: [0, 1, 2] }],
    }),
  },
];
