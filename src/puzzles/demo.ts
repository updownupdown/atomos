// A game playing itself, small: the moving picture at the top of the Puzzles screen. An easy
// board is dealt and the game's own Show me (help level 2) plays it a move at a time, the way a
// player would; once it is solved it holds for a moment and a fresh deal starts. It runs only
// while shown (start/stop), and holds still under Reduce motion. A game whose Show me is slow to
// answer stops moving rather than stall the screen.

import type { PuzzleType } from './catalog';
import type { PuzzleView } from './view';
import { dialFor } from './difficulty';

/** The board is laid out at this size, then shrunk into the canvas. */
const LAYOUT = 340;
/** Time between moves, and how long a solved board holds before the next deal. */
const STEP_MS = 1100;
const HOLD_MS = 1800;
/** A Show me slower than this makes the demo a still for that game. */
const SLOW_MS = 120;

export class GameDemo {
  private type: PuzzleType | null = null;
  private view: PuzzleView | null = null;
  private deal = 0;
  private raf = 0;
  private nextAt = 0;
  private running = false;
  private readonly slow = new Set<string>();

  constructor(readonly canvas: HTMLCanvasElement, private readonly reduced: () => boolean) {}

  /** Shows this game (a fresh easy deal), playing if started. */
  show(t: PuzzleType): void {
    if (this.type?.id === t.id && this.view) return;
    this.type = t;
    this.deal = 0;
    this.dealNew();
    this.paint(performance.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextAt = performance.now() + STEP_MS;
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private dealNew(): void {
    const t = this.type;
    this.view = null;
    if (!t?.makeAt) return;
    try {
      this.view = t.makeAt(dialFor(t.id, 30), this.deal, this.reduced());
    } catch {
      this.view = null;
    }
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    if (!this.reduced() && this.canvas.isConnected && this.canvas.offsetParent !== null) {
      this.step(now);
      this.paint(now);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Plays the next move when it is due, or deals again once the board is done. */
  private step(now: number): void {
    const v = this.view, t = this.type;
    if (!v || !t || now < this.nextAt || this.slow.has(t.id)) return;
    if (v.won || v.failed) {
      this.deal += 1;
      this.dealNew();
      this.nextAt = now + STEP_MS;
      return;
    }
    const t0 = performance.now();
    let moved = false;
    try {
      moved = Boolean(v.help(2)?.moved);
    } catch {
      moved = false;
    }
    if (performance.now() - t0 > SLOW_MS) this.slow.add(t.id);
    // Stuck or done: hold the board a moment, then deal again.
    if (!moved || v.won) this.nextAt = now + HOLD_MS;
    else this.nextAt = now + STEP_MS;
    if (!moved && !v.won) { this.deal += 1; this.dealNew(); }
  }

  private paint(now: number): void {
    const c = this.canvas;
    const css = c.clientWidth || 140;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(css * dpr);
    if (c.width !== px || c.height !== px) { c.width = px; c.height = px; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    if (!this.view) return;
    ctx.setTransform(px / LAYOUT, 0, 0, px / LAYOUT, 0, 0);
    try {
      this.view.draw(ctx, { x: 6, y: 6, w: LAYOUT - 12, h: LAYOUT - 12 }, now);
    } catch {
      // A picture is decoration; a view that cannot draw small leaves it blank.
    }
  }
}
