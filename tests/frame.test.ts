import { describe, expect, it } from 'vitest';
import { dashFor, framePad, frameWidth } from '../src/puzzles/frame';

const box = { x: 10, y: 20, w: 200, h: 100 };
const r = 10;
const perimeter = 2 * (box.w - 2 * r) + 2 * (box.h - 2 * r) + 2 * Math.PI * r;
const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);

describe('board frame', () => {
  it('lays one dash pattern exactly once around the path', () => {
    const dash = dashFor(box, r, 4, [{ side: 'right', at: 70, size: 20 }]);
    expect(sum(dash)).toBeCloseTo(perimeter, 6);
    expect(dash).toHaveLength(4);
  });

  it('opens each gap where it is asked for, widened by the line width the round caps take back', () => {
    // A gap centered on the right side: the path reaches the right edge's straight run after
    // the top run and one quarter corner.
    const dash = dashFor(box, r, 4, [{ side: 'right', at: 70, size: 20 }]);
    const rightStart = box.w - 2 * r + (Math.PI * r) / 2;
    const center = rightStart + (70 - (box.y + r));
    expect(dash[0]).toBeCloseTo(center - 12, 6);
    expect(dash[1]).toBeCloseTo(24, 6);
  });

  it('keeps gaps in path order whichever side they are on', () => {
    const dash = dashFor(box, r, 4, [
      { side: 'left', at: 70, size: 10 },
      { side: 'top', at: 60, size: 10 },
      { side: 'bottom', at: 100, size: 10 },
    ]);
    expect(sum(dash)).toBeCloseTo(perimeter, 6);
    expect(dash.every((d) => d >= 0)).toBe(true);
  });

  it('scales with the cell and always clears a tile corner', () => {
    expect(frameWidth(20)).toBe(3);
    expect(frameWidth(200)).toBe(7);
    for (const c of [20, 40, 72, 96]) expect(framePad(c)).toBeGreaterThan(frameWidth(c) / 2 + 4);
  });
});
