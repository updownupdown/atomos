import { describe, expect, it } from 'vitest';
import { dashFor, framePad, frameWidth, type FrameGap } from '../src/puzzles/frame';

const box = { x: 10, y: 20, w: 200, h: 100 };
const r = 10, lw = 4;
const sw = box.w - 2 * r, sh = box.h - 2 * r, q = (Math.PI * r) / 2;
const perimeter = 2 * sw + 2 * sh + 4 * q;
const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);

/** Whether the stroke is drawn at distance p along the path (from roundRect's start, clockwise). */
function drawnAt(gaps: FrameGap[], p: number): boolean {
  const { dash, offset } = dashFor(box, r, lw, gaps);
  let k = (((p + offset) % perimeter) + perimeter) % perimeter;
  for (let i = 0; i < dash.length; i++) {
    if (k < dash[i]) return i % 2 === 0;
    k -= dash[i];
  }
  return true;
}

// Path distances of each side's midpoint, and the canvas coordinate along that side.
const mid = {
  top: { p: sw / 2, at: box.x + box.w / 2 },
  right: { p: sw + q + sh / 2, at: box.y + box.h / 2 },
  bottom: { p: sw + sh + 2 * q + sw / 2, at: box.x + box.w / 2 },
  left: { p: 2 * sw + sh + 3 * q + sh / 2, at: box.y + box.h / 2 },
} as const;

describe('board frame', () => {
  it('lays one dash pattern exactly once around the path, never opening with a zero dash', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const { dash } = dashFor(box, r, lw, [{ side, at: mid[side].at, size: 20 }]);
      expect(sum(dash), side).toBeCloseTo(perimeter, 6);
      expect(dash[0], side).toBeGreaterThan(0);
      expect(dash.every((d) => d >= 0), side).toBe(true);
    }
  });

  it('opens each side\'s gap at that side, and nowhere else', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const gaps: FrameGap[] = [{ side, at: mid[side].at, size: 20 }];
      expect(drawnAt(gaps, mid[side].p), `${side} gap center`).toBe(false);
      // Just inside the widened gap (size / 2 + lw / 2 = 12) and just outside it.
      expect(drawnAt(gaps, mid[side].p + 11), `${side} gap edge`).toBe(false);
      expect(drawnAt(gaps, mid[side].p + 13), `${side} past the gap`).toBe(true);
      for (const other of ['top', 'right', 'bottom', 'left'] as const) {
        if (other !== side) expect(drawnAt(gaps, mid[other].p), `${side} gap, ${other} side`).toBe(true);
      }
    }
  });

  it('wraps a gap across the path\'s start without a stray dot', () => {
    // The path starts at x + r on the top edge; a gap centered there runs back round the corner.
    const gaps: FrameGap[] = [{ side: 'top', at: box.x + r, size: 10 }];
    const { dash } = dashFor(box, r, lw, gaps);
    expect(dash[0]).toBeGreaterThan(0);
    expect(sum(dash)).toBeCloseTo(perimeter, 6);
    expect(drawnAt(gaps, 0)).toBe(false);
    expect(drawnAt(gaps, 5)).toBe(false);
    expect(drawnAt(gaps, perimeter - 5)).toBe(false);
    expect(drawnAt(gaps, 20)).toBe(true);
    expect(drawnAt(gaps, perimeter - 20)).toBe(true);
  });

  it('merges overlapping gaps and keeps the rest of the pattern in place', () => {
    const gaps: FrameGap[] = [
      { side: 'bottom', at: mid.bottom.at, size: 20 },
      { side: 'bottom', at: mid.bottom.at + 8, size: 20 },
      { side: 'left', at: mid.left.at, size: 10 },
    ];
    const { dash } = dashFor(box, r, lw, gaps);
    expect(dash).toHaveLength(4);
    expect(sum(dash)).toBeCloseTo(perimeter, 6);
    expect(drawnAt(gaps, mid.bottom.p)).toBe(false);
    expect(drawnAt(gaps, mid.bottom.p - 19)).toBe(false); // the second gap reaches 8 + 12 back along the path
    expect(drawnAt(gaps, mid.left.p)).toBe(false);
    expect(drawnAt(gaps, mid.top.p)).toBe(true);
    expect(drawnAt(gaps, mid.right.p)).toBe(true);
  });

  it('scales with the cell and always clears a tile corner', () => {
    expect(frameWidth(20)).toBe(3);
    expect(frameWidth(200)).toBe(7);
    for (const c of [20, 40, 72, 96]) expect(framePad(c)).toBeGreaterThan(frameWidth(c) / 2 + 4);
  });
});
