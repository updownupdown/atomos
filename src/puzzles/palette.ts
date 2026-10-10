// The puzzles' shared look, for canvas drawing. Flat fills and fine lines, no
// radial gradients, in Outfit. Colours come from the design tokens in
// src/ui/tokens.css (read at start-up by syncPalette), so a palette change
// there reaches every puzzle; the values below are only the fallbacks.

export const FONT = "'Outfit Variable', 'Outfit', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

export const C = {
  bg: '#0c0b0a',
  plate: '#16140f',
  surface: '#17150f',
  surface2: '#201d17',
  text: '#e2dccf',
  text2: '#9a9284',
  text3: '#6d665a',
  line: 'rgba(226, 220, 207, 0.16)',
  line2: 'rgba(226, 220, 207, 0.28)',
  line3: 'rgba(226, 220, 207, 0.55)',
  silver: '#f3eee2',
  silverDim: '#cfc8b8',
  pewter: '#8f887a',
  accent: '#e0503a',
  good: '#9fc98a',
  warn: '#e0a24a',
  /** Orbital colours: the same in every atom and every puzzle. */
  s: '#5f8ae0',
  p: '#2ea57a',
  d: '#c07f1e',
  f: '#a865d6',
  /** Nucleons: protons warm, neutrons grey. */
  proton: '#d6963c',
  neutron: '#7a7468',
};

/** Which design token each palette colour follows. */
const TOKENS: Partial<Record<keyof typeof C, string>> = {
  bg: '--c-bg', plate: '--c-plate', surface: '--c-surface', surface2: '--c-surface-2',
  text: '--c-text', text2: '--c-text-2', text3: '--c-text-3',
  line: '--c-line', line2: '--c-line-2', line3: '--c-line-3',
  silver: '--c-silver', accent: '--c-accent', good: '--c-good', warn: '--c-warn',
  s: '--c-orb-s', p: '--c-orb-p', d: '--c-orb-d', f: '--c-orb-f',
};

/** Re-reads the palette from the design tokens. Runs once on load; call again after a theme change. */
export function syncPalette(): void {
  if (typeof document === 'undefined') return;
  const css = getComputedStyle(document.documentElement);
  for (const [key, prop] of Object.entries(TOKENS) as [keyof typeof C, string][]) {
    const v = css.getPropertyValue(prop).trim();
    if (v) C[key] = v;
  }
}
syncPalette();

/** A font string for canvas text. */
export function font(px: number, weight = 500): string {
  return `${weight} ${Math.round(px)}px ${FONT}`;
}

/** A round bead: a flat disc with a thin rim, optionally lit with a soft halo. */
export function bead(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string = C.silver, opts: { rim?: string; glow?: string; alpha?: number } = {}): void {
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = r * 1.2;
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (opts.rim) {
    ctx.strokeStyle = opts.rim;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

/** A rounded tile: a flat fill with an optional outline. */
export function tile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string | null, stroke: string | null = null, lineWidth = 1): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2));
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** A dotted socket: where something belongs. */
export function socket(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, colour: string = C.line2): void {
  ctx.save();
  ctx.setLineDash([3, 4]);
  tile(ctx, x, y, w, h, radius, null, colour, 1);
  ctx.restore();
}

/**
 * Fits a board of cols x rows square cells into an area, centred, with a margin,
 * leaving `top` pixels free above it. Returns the cell size and the board origin.
 */
export function fitGrid(area: { x: number; y: number; w: number; h: number }, cols: number, rows: number, opts: { margin?: number; top?: number; bottom?: number; maxCell?: number } = {}): { cell: number; x: number; y: number; w: number; h: number } {
  const margin = opts.margin ?? 8;
  const top = opts.top ?? 0;
  const bottom = opts.bottom ?? 0;
  const availW = Math.max(1, area.w - margin * 2);
  const availH = Math.max(1, area.h - margin * 2 - top - bottom);
  const cell = Math.max(4, Math.min(availW / cols, availH / rows, opts.maxCell ?? 96));
  const w = cell * cols, h = cell * rows;
  return { cell, w, h, x: area.x + (area.w - w) / 2, y: area.y + margin + top + (availH - h) / 2 };
}
