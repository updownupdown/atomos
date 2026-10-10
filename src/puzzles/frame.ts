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
  if (gaps.length) ctx.setLineDash(dashFor(box, r, lw, gaps));
  ctx.stroke();
  ctx.setLineDash([]);
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
 * The dash pattern that leaves the gaps open. roundRect's path starts at (x + r, y) and runs
 * clockwise: top edge, top-right corner, right edge, and so on. Each gap becomes an interval of
 * that path (widened by the line width, which the round caps take back), and the dash pattern
 * is the stretches between them.
 */
export function dashFor(box: { x: number; y: number; w: number; h: number }, r: number, lw: number, gaps: FrameGap[]): number[] {
  const { x, y, w, h } = box;
  const sw = w - 2 * r, sh = h - 2 * r, q = (Math.PI * r) / 2;
  const total = 2 * sw + 2 * sh + 4 * q;
  // Where each side's straight run starts along the path, and its start coordinate.
  const start: Record<Side, number> = { top: 0, right: sw + q, bottom: 2 * sw + sh + 2 * q, left: 2 * sw + 2 * sh + 3 * q };
  const along = (g: FrameGap): number => {
    switch (g.side) {
      case 'top': return start.top + (g.at - (x + r));
      case 'right': return start.right + (g.at - (y + r));
      case 'bottom': return start.bottom + (x + w - r - g.at);
      default: return start.left + (y + h - r - g.at);
    }
  };
  const cuts = gaps
    .map((g) => {
      const c = along(g), half = g.size / 2 + lw / 2;
      return [Math.max(0, c - half), Math.min(total, c + half)] as [number, number];
    })
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const dash: number[] = [];
  let pos = 0;
  for (const [a, b] of cuts) {
    if (a < pos) { pos = Math.max(pos, b); continue; }
    dash.push(a - pos, b - a);
    pos = b;
  }
  dash.push(Math.max(0, total - pos), 0);
  return dash;
}
