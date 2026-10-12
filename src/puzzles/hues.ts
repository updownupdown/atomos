// The play colors Sort and Flood share: lines of a spectrum, each with a glyph as a second cue
// for players who tell some hues apart poorly. Kept away from the target red, the warning amber,
// the hint rose and the cyan accent.

export interface Hue {
  color: string;
  name: string;
  /** The glyph's name, for the hint line ("blue circles"). */
  glyph: string;
}

export const HUES: Hue[] = [
  { color: '#5b8ae6', name: 'blue', glyph: 'dot' },
  { color: '#e8853f', name: 'orange', glyph: 'triangle' },
  { color: '#4fbf6a', name: 'green', glyph: 'square' },
  { color: '#ae6be0', name: 'violet', glyph: 'diamond' },
  { color: '#e3d34e', name: 'yellow', glyph: 'plus' },
  { color: '#2fb8aa', name: 'teal', glyph: 'ring' },
  { color: '#e2e6e8', name: 'white', glyph: 'cross' },
  { color: '#bf8f62', name: 'tan', glyph: 'bar' },
  { color: '#8ea3bd', name: 'slate', glyph: 'star' },
];

/** Relative luminance of a #rrggbb color, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The ink a glyph is drawn in on a hue: dark on the light hues, light on the deep ones. */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.3 ? 'rgba(16, 17, 18, 0.62)' : 'rgba(255, 255, 255, 0.82)';
}

/** Draws hue k's glyph, centered at x, y, about r across (half-size). */
export function glyph(ctx: CanvasRenderingContext2D, k: number, x: number, y: number, r: number, ink: string): void {
  if (r < 1.5) return;
  const kind = HUES[k % HUES.length].glyph;
  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.4, r * 0.34);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (kind) {
    case 'dot':
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'triangle':
      ctx.moveTo(x, y - r * 0.8);
      ctx.lineTo(x + r * 0.78, y + r * 0.58);
      ctx.lineTo(x - r * 0.78, y + r * 0.58);
      ctx.closePath();
      ctx.fill();
      break;
    case 'square':
      ctx.rect(x - r * 0.58, y - r * 0.58, r * 1.16, r * 1.16);
      ctx.fill();
      break;
    case 'diamond':
      ctx.moveTo(x, y - r * 0.85);
      ctx.lineTo(x + r * 0.7, y);
      ctx.lineTo(x, y + r * 0.85);
      ctx.lineTo(x - r * 0.7, y);
      ctx.closePath();
      ctx.fill();
      break;
    case 'plus':
      ctx.moveTo(x - r * 0.75, y); ctx.lineTo(x + r * 0.75, y);
      ctx.moveTo(x, y - r * 0.75); ctx.lineTo(x, y + r * 0.75);
      ctx.stroke();
      break;
    case 'ring':
      ctx.lineWidth = Math.max(1.4, r * 0.3);
      ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'cross':
      ctx.moveTo(x - r * 0.6, y - r * 0.6); ctx.lineTo(x + r * 0.6, y + r * 0.6);
      ctx.moveTo(x + r * 0.6, y - r * 0.6); ctx.lineTo(x - r * 0.6, y + r * 0.6);
      ctx.stroke();
      break;
    case 'bar':
      ctx.moveTo(x - r * 0.75, y - r * 0.32); ctx.lineTo(x + r * 0.75, y - r * 0.32);
      ctx.moveTo(x - r * 0.75, y + r * 0.32); ctx.lineTo(x + r * 0.75, y + r * 0.32);
      ctx.stroke();
      break;
    default: {
      // A six-pointed asterisk.
      for (let a = 0; a < 3; a++) {
        const t = (a * Math.PI) / 3 + Math.PI / 2;
        ctx.moveTo(x + Math.cos(t) * r * 0.75, y + Math.sin(t) * r * 0.75);
        ctx.lineTo(x - Math.cos(t) * r * 0.75, y - Math.sin(t) * r * 0.75);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
