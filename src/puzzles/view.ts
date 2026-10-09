// What the game needs from any puzzle on screen, whatever its rules.

export interface Area { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

export interface PuzzleView {
  readonly won: boolean;
  /** No move can change anything; only a restart helps. */
  readonly stuck: boolean;
  readonly moves: number;
  readonly par: number | null;
  /** Solved without the mistake this puzzle counts against a flawless build. */
  readonly clean: boolean;
  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void;
  down(p: Point): void;
  move(p: Point): void;
  up(p: Point): void;
  cancel(): void;
  /** Returns true when the key was used. */
  key(e: KeyboardEvent): boolean;
  undo(): boolean;
  canUndo(): boolean;
  restart(): void;
  hint(): string;
}

export const MONO = "'Courier Prime', 'Courier New', monospace";
export const SANS = "'Archivo Narrow', 'Arial Narrow', sans-serif";

export const SUBSHELL_COLOURS = { s: '#5f8ae0', p: '#2ea57a', d: '#c07f1e', f: '#a865d6' } as const;

export const ease = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/** A silver droplet, the game's electron. */
export function droplet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lit = false, alpha = 1): void {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  g.addColorStop(0, lit ? `rgba(255, 252, 245, ${alpha})` : `rgba(243, 238, 226, ${alpha})`);
  g.addColorStop(0.7, `rgba(200, 194, 182, ${alpha * 0.95})`);
  g.addColorStop(1, `rgba(140, 134, 122, ${alpha * 0.9})`);
  if (lit) {
    ctx.shadowColor = 'rgba(243, 238, 226, 0.9)';
    ctx.shadowBlur = r * 1.6;
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}
