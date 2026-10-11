// The moment a board is solved: it stays on screen for a couple of seconds while light plays
// over it (a ring opening from the middle, a sheen sweeping across, sparks in the orbital colors
// drifting out and glints twinkling over the board), and only then does the win panel come. Build,
// Practice and the gate puzzles all hold for WIN_HOLD_MS and draw drawWinFx over the board.

import { C } from './palette';
import type { Area } from './view';

/** How long the solved board shows before the win panel (calm motion: a short beat). */
export const WIN_HOLD_MS = 2000;
export const WIN_HOLD_REDUCED_MS = 400;

export const winHold = (reduced: boolean) => (reduced ? WIN_HOLD_REDUCED_MS : WIN_HOLD_MS);

const SPARKS = Array.from({ length: 28 }, (_, i) => {
  const a = i * 2.39996 + Math.sin(i * 12.9898) * 0.3;
  return { a, speed: 0.55 + ((i * 37) % 11) / 22, size: 1.2 + ((i * 53) % 7) / 4, delay: ((i * 29) % 9) / 30, tint: i % 5 };
});

/** Glints scattered over the board, each twinkling once: where (0..1 of the area), when and how big. */
const GLINTS = Array.from({ length: 14 }, (_, i) => ({
  x: 0.1 + 0.8 * ((i * 0.618034) % 1),
  y: 0.1 + 0.8 * ((i * 0.381966 + 0.27) % 1),
  delay: 0.25 + ((i * 7) % 12) / 10,
  size: 7 + ((i * 5) % 6) * 1.6,
}));

const ease = (x: number) => 1 - (1 - x) ** 3;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Draws the win effect over a solved board, `ms` after the win (nothing in calm motion). */
export function drawWinFx(ctx: CanvasRenderingContext2D, area: Area, ms: number, reduced = false): void {
  const t = ms / 1000;
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
  const R = Math.hypot(area.w, area.h) / 2;
  ctx.save();
  if (!reduced) {
    // A ring of light opening from the middle and fading as it passes the edge.
    const k = clamp01(t / 1.1);
    if (k < 1) {
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = 2 + 6 * (1 - k);
      ctx.beginPath();
      ctx.arc(cx, cy, R * ease(k), 0, Math.PI * 2);
      ctx.stroke();
    }
    // A soft sheen sweeping across the board, once.
    const s = clamp01((t - 0.15) / 0.9);
    if (s > 0 && s < 1) {
      ctx.save();
      roundRect(ctx, area.x, area.y, area.w, area.h, 12);
      ctx.clip();
      const x = area.x - area.w * 0.4 + (area.w * 1.8) * ease(s);
      const g = ctx.createLinearGradient(x - 80, area.y, x + 80, area.y + area.h * 0.35);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(area.x, area.y, area.w, area.h);
      ctx.restore();
    }
    // Glints twinkling over the board, one after another.
    for (const g of GLINTS) {
      const u = clamp01((t - g.delay) / 0.7);
      if (u <= 0 || u >= 1) continue;
      glint(ctx, area.x + area.w * g.x, area.y + area.h * g.y, g.size * Math.sin(u * Math.PI), u * 1.4, Math.sin(u * Math.PI));
    }
    // Sparks in the orbital colors drifting out from the middle.
    const tints = [C.silver, C.s, C.p, C.d, C.f];
    for (const p of SPARKS) {
      ctx.fillStyle = tints[p.tint];
      const u = clamp01((t - p.delay) / 1.6);
      if (u <= 0 || u >= 1) continue;
      const d = R * 0.95 * p.speed * ease(u);
      ctx.globalAlpha = (1 - u) * 0.9;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(p.a) * d, cy + Math.sin(p.a) * d, p.size * (1 - u * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A four-pointed glint of white light, turned by `spin`. */
function glint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, alpha: number): void {
  if (r <= 0.5) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = C.silver;
  ctx.shadowColor = C.silver;
  ctx.shadowBlur = r;
  ctx.beginPath();
  const w = r * 0.18;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(a + Math.PI / 4) * w, Math.sin(a + Math.PI / 4) * w);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
