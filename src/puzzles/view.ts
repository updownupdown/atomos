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

/** Draws into a w x h box (CSS pixels, the context already scaled). t is seconds from the start
 *  of the illustration's play. Pure drawing: no shared state, no allocation-heavy work. */
export type DemoFn = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

/**
 * One still picture of a rule that can also play out. The modal shows it still, at t = `duration`
 * (its finished state), and plays it from 0 to `duration` only when the player taps Play.
 */
export interface Illustration {
  draw: DemoFn;
  /** Seconds the play takes; the still shows its last frame. 1.5 to 4 s. */
  duration: number;
  /** A few words under the picture, e.g. "Every bead on the line". Optional. */
  caption?: string;
}

/**
 * One rule of a puzzle for its Instructions modal. Views export `RULES: RuleCard[]`, basics first.
 * Each card shows its title and text, then its pictures side by side: a `good` one (the rule kept)
 * and a `bad` one (the rule broken), or a single `good` one where there is nothing to get wrong.
 * Nothing moves until the player taps the card's Play button, which plays good, then bad.
 * `demo` is the older single looping example, still shown (as one still with Play) where a view
 * has no pictures yet.
 */
export interface RuleCard {
  /** The symbol's or rule's short name, e.g. "Photons". */
  title: string;
  /** One or two plain sentences, no markup. */
  text: string;
  good?: Illustration;
  bad?: Illustration;
  /** Deprecated: a single looping example (2-6 s loop). */
  demo?: DemoFn;
}

// Canvas text uses Outfit like the rest of the app (both names kept for existing callers).
export const FONT = "'Outfit Variable', 'Outfit', system-ui, sans-serif";
export const MONO = FONT;
export const SANS = FONT;

export const SUBSHELL_COLORS = { s: '#5f8ae0', p: '#2ea57a', d: '#c07f1e', f: '#a865d6' } as const;

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
