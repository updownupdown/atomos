// The moment a board is solved: it stays on screen for a couple of seconds while light passes
// through it, and only then does the win panel come. The board takes one slow breath (it swells
// a little and settles) while a wave of light opens from its middle and runs out through the
// pieces, lighting each one as it passes, then the pieces hold a faint glow that fades. The light
// falls only on what the board has drawn (the canvas is clear around it), never on the empty
// black. No sparks, no glints. Build, Puzzles and the gate puzzles all hold for WIN_HOLD_MS and
// draw the solved board through drawSolved.

import type { Area } from './view';

/** How long the solved board shows before the win panel (calm motion: a short beat). */
export const WIN_HOLD_MS = 2000;
export const WIN_HOLD_REDUCED_MS = 400;

export const winHold = (reduced: boolean) => (reduced ? WIN_HOLD_REDUCED_MS : WIN_HOLD_MS);

const ease = (x: number) => 1 - (1 - x) ** 3;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The board's breath, `ms` after the win: its scale, 1 to 1.03 and back over 0.9 s. */
export function winScale(ms: number, reduced = false): number {
  if (reduced) return 1;
  const k = clamp01(ms / 900);
  return 1 + 0.03 * Math.sin(Math.PI * k) ** 2;
}

/** Draws a solved board `ms` after the win: `draw` paints the board, breathing about the area's
 *  middle, and the light passes through it. */
export function drawSolved(ctx: CanvasRenderingContext2D, area: Area, ms: number, reduced: boolean, draw: () => void): void {
  const s = winScale(ms, reduced);
  if (s === 1) draw();
  else {
    const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    draw();
    ctx.restore();
  }
  drawWinFx(ctx, area, ms, reduced);
}

/** The light over a solved board, `ms` after the win (nothing under Reduce motion). It is drawn
 *  'source-atop', so it lands only on the board's own pixels. */
export function drawWinFx(ctx: CanvasRenderingContext2D, area: Area, ms: number, reduced = false): void {
  if (reduced) return;
  const t = ms / 1000;
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
  const R = Math.hypot(area.w, area.h) / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = '#ffffff';
  // The wave: a broad band of light, soft at its edges, opening from the middle to past the corners.
  const k = clamp01(t / 1.2);
  if (k > 0 && k < 1) {
    const r = R * 1.15 * ease(k);
    const w = R * 0.16;
    const fade = 1 - k * k;
    // Six strokes, widest and faintest first, stack into a band that is brightest at its middle.
    for (let i = 0; i < 6; i++) {
      const lw = w * (2.4 - i * 0.4);
      ctx.globalAlpha = 0.09 * fade;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // The afterglow: every piece a little brighter, fading out.
  const g = clamp01((t - 0.5) / 1.4);
  if (g > 0 && g < 1) {
    ctx.globalAlpha = 0.2 * Math.sin(Math.PI * g);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(area.x - area.w * 0.05, area.y - area.h * 0.05, area.w * 1.1, area.h * 1.1);
  }
  ctx.restore();
}
