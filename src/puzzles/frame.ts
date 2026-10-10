// The board frame every game draws around its playing field, in the logo's line: one thick,
// round-capped stroke in a single quiet color, with gaps cut in it where something enters or
// leaves (an exit, a port), the way the Atomos mark's shell is cut where its electrons sit.
// Shared by all games so the boards read as one set.

import { C } from './palette';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** An opening in the frame. `at` is the opening's center along its side, in canvas pixels
 *  (an x for top and bottom, a y for left and right); `size` is its length. `dot` sets a small
 *  disc in the opening, like the logo's electrons. */
export interface FrameGap {
  side: Side;
  at: number;
  size: number;
  dot?: string;
}

export interface FrameOptions {
  /** Corner radius of the stroke's center line. Default: a quarter of the frame's padding plus the cell radius. */
  radius?: number;
  /** Stroke width; frameWidth(cell) by default. */
  width?: number;
  color?: string;
  /** A flat fill inside the frame, drawn under the stroke. */
  fill?: string | null;
  gaps?: FrameGap[];
  alpha?: number;
}

/** The frame's stroke for a board of this cell size: about a fifteenth of a cell, 3 to 7 px. */
export function frameWidth(cell: number): number {
  return Math.max(3, Math.min(7, cell * 0.07));
}

/** The space to leave between a board's cells and the frame's center line, so the stroke never
 *  touches a tile's corner. */
export function framePad(cell: number): number {
  return Math.round(frameWidth(cell) / 2 + Math.max(5, cell * 0.1));
}

/** The box (around the cells x, y, w, h) that the frame's center line follows. */
export function frameBox(x: number, y: number, w: number, h: number, cell: number): { x: number; y: number; w: number; h: number } {
  const p = framePad(cell);
  return { x: x - p, y: y - p, w: w + p * 2, h: h + p * 2 };
}

/**
 * Draws the frame along the box (its center line). Gaps are cut with a line dash laid along the
 * rounded rectangle's own path, so the open ends stay round like the logo's arcs.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, opts: FrameOptions = {}): void {
  const { x, y, w, h } = box;
  if (!(w > 0 && h > 0)) return;
  const lw = opts.width ?? 5;
  const r = Math.max(0, Math.min(opts.radius ?? 14, w / 2, h / 2));
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.fill();
  }
  ctx.strokeStyle = opts.color ?? C.frame;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  const gaps = opts.gaps ?? [];
  if (gaps.length) {
    const { dash, offset } = dashFor(box, r, lw, gaps);
    ctx.setLineDash(dash);
    ctx.lineDashOffset = offset;
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  for (const g of gaps) {
    if (!g.dot) continue;
    const [gx, gy] = gapPoint(box, g);
    ctx.fillStyle = g.dot;
    ctx.beginPath();
    ctx.arc(gx, gy, lw * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The center of a gap on the frame's line. */
export function gapPoint(box: { x: number; y: number; w: number; h: number }, g: FrameGap): [number, number] {
  switch (g.side) {
    case 'top': return [g.at, box.y];
    case 'bottom': return [g.at, box.y + box.h];
    case 'left': return [box.x, g.at];
    default: return [box.x + box.w, g.at];
  }
}

/**
 * The dash pattern that leaves the gaps open, and the offset to draw it at. roundRect's path
 * starts at (x + r, y) and runs clockwise: top edge, top-right corner, right edge, and so on.
 * Each gap becomes an interval of that path (widened by the line width, which the round caps
 * take back); intervals that cross the path's start wrap round it, and overlapping ones merge.
 * The pattern starts where the first gap ends, so it never opens with a zero-length dash (which
 * round caps would draw as a dot), and `offset` lines that start up with the path.
 */
export function dashFor(box: { x: number; y: number; w: number; h: number }, r: number, lw: number, gaps: FrameGap[]): { dash: number[]; offset: number } {
  const { x, y, w, h } = box;
  const sw = w - 2 * r, sh = h - 2 * r, q = (Math.PI * r) / 2;
  const total = 2 * sw + 2 * sh + 4 * q;
  // Where each side's straight run starts along the path.
  const start: Record<Side, number> = { top: 0, right: sw + q, bottom: sw + sh + 2 * q, left: 2 * sw + sh + 3 * q };
  const along = (g: FrameGap): number => {
    switch (g.side) {
      case 'top': return start.top + (g.at - (x + r));
      case 'right': return start.right + (g.at - (y + r));
      case 'bottom': return start.bottom + (x + w - r - g.at);
      default: return start.left + (y + h - r - g.at);
    }
  };
  const raw: [number, number][] = [];
  for (const g of gaps) {
    const c = along(g), half = g.size / 2 + lw / 2;
    if (!(half > 0)) continue;
    if (half * 2 >= total) return { dash: [0, total], offset: 0 };
    const a = ((c - half) % total + total) % total, b = a + half * 2;
    if (b <= total) raw.push([a, b]);
    else raw.push([a, total], [0, b - total]);
  }
  if (!raw.length) return { dash: [total, 0], offset: 0 };
  raw.sort((p, q2) => p[0] - q2[0]);
  const cuts: [number, number][] = [];
  for (const [a, b] of raw) {
    const last = cuts[cuts.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else cuts.push([a, b]);
  }
  // A cut ending at the path's end and one starting at its start are one gap across the start.
  if (cuts.length > 1 && cuts[cuts.length - 1][1] >= total && cuts[0][0] <= 0) {
    const tail = cuts.pop()!;
    cuts[0] = [tail[0] - total, cuts[0][1]];
  }
  if (cuts.length === 1 && cuts[0][1] - cuts[0][0] >= total) return { dash: [0, total], offset: 0 };
  // From the end of the first cut: stroke to the next cut, skip it, and so on round to the first.
  const dash: number[] = [];
  const from = cuts[0][1];
  for (let i = 0; i < cuts.length; i++) {
    const next = cuts[(i + 1) % cuts.length];
    const nextA = i + 1 < cuts.length ? next[0] : next[0] + total;
    const end = i === 0 ? from : cuts[i][1];
    dash.push(nextA - end, (i + 1 < cuts.length ? next[1] : next[1] + total) - nextA);
  }
  // Pattern position 0 sits at path position `from`, so the path's start is total - from into it.
  return { dash, offset: ((total - from) % total + total) % total };
}

// ---- frames round any shape of cells ------------------------------------------------

const ringCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

/**
 * The frame traced round an arbitrary set of cells (an outline with notches and holes), as a
 * ring of the frame's width standing framePad off the cells. It is cut from the cells grown by
 * two amounts (outer edge minus inner edge), so it can never cross itself where two parts of
 * the outline come close, at inner corners or round a cell that only touches the edge at a
 * corner. Convex corners are rounded by the growth itself, inner corners stay sharp. The ring is drawn once into a cached
 * bitmap for this shape, size and color.
 */
export function drawCellFrame(ctx: CanvasRenderingContext2D, cells: { x: number; y: number }[], ox: number, oy: number, cell: number, color: string = C.frame): void {
  if (!cells.length || !(cell > 0)) return;
  const lw = frameWidth(cell), pad = framePad(cell);
  const outer = pad + lw / 2, inner = pad - lw / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + 1); y1 = Math.max(y1, c.y + 1); }
  const m = outer + 2;
  const wCss = (x1 - x0) * cell + 2 * m, hCss = (y1 - y0) * cell + 2 * m;
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const scale = Math.max(1, Math.min(3, t ? Math.hypot(t.a, t.b) : 1));
  const make = makeCanvas(Math.ceil(wCss * scale), Math.ceil(hCss * scale));
  if (!make) {
    // No canvas to draw into (tests): a plain outline per cell keeps the geometry checkable.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    for (const c of cells) {
      ctx.beginPath();
      ctx.rect(ox + c.x * cell - pad, oy + c.y * cell - pad, cell + 2 * pad, cell + 2 * pad);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const key = `${cells.map((c) => `${c.x},${c.y}`).join(';')}|${cell.toFixed(2)}|${scale}|${color}`;
  let bmp = ringCache.get(key);
  if (!bmp) {
    bmp = make;
    const g = bmp.getContext('2d') as CanvasRenderingContext2D | null;
    if (!g) return;
    g.scale(scale, scale);
    const grow = (e: number, r: number) => {
      g.beginPath();
      for (const c of cells) {
        const x = m + (c.x - x0) * cell - e, y = m + (c.y - y0) * cell - e;
        g.roundRect(x, y, cell + 2 * e, cell + 2 * e, Math.max(0, Math.min(r, cell / 2 + e)));
      }
      g.fill();
    };
    g.fillStyle = color;
    // A corner rounder than the growth would notch the straight runs where two cells meet.
    grow(outer, outer);
    g.globalCompositeOperation = 'destination-out';
    grow(inner, inner);
    if (ringCache.size > 24) ringCache.delete(ringCache.keys().next().value!);
    ringCache.set(key, bmp);
  }
  ctx.drawImage(bmp as CanvasImageSource, ox + x0 * cell - m, oy + y0 * cell - m, wCss, hCss);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (!(w > 0 && h > 0)) return null;
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}
