// Runs one PuzzleView on a canvas: pointer and keyboard input, the draw loop,
// undo and restart. The build screen and the playground both sit on this.

import { syncPalette } from './palette';
import { confirming } from './restart';
import { HintControl } from './hints';
import { drawWinFx, winHold } from './winFx';
import type { Area, Point, PuzzleView } from './view';

export class PuzzleHost {
  private view: PuzzleView | null = null;
  private raf = 0;
  private pointerId: number | null = null;
  private paused = false;
  /** Called after each frame with the view, so the host screen can refresh its counters. */
  onFrame: ((view: PuzzleView) => void) | null = null;
  /** Called once when the view reports a win, after the solved board has shown for a moment
   *  with the win effect (winFx.ts). */
  onWon: ((view: PuzzleView) => void) | null = null;
  private wonReported = false;
  /** When the current win was first seen (null while unsolved). */
  private wonAt: number | null = null;
  /** Calm motion: a short hold and no sparks. */
  reducedMotion = false;
  /** The Hint button for this canvas: Look here, then Show me. */
  readonly hints = new HintControl(() => this.view, () => this.wake());
  /** The R key: asks before restarting when set (see askRestart); restarts at once otherwise. */
  onRestartKey: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private area: () => Area) {
    syncPalette(); // the stylesheet is certainly applied by now
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => this.cancel());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.cancel());
    window.addEventListener('resize', () => this.resize());
    // A canvas that was hidden (no size) starts drawing again once it has one.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get current(): PuzzleView | null { return this.view; }

  set(view: PuzzleView | null): void {
    this.view = view;
    this.wonReported = false;
    this.wonAt = null;
    this.pointerId = null;
    if (!view) this.clear();
    this.wake();
  }

  /** Stops drawing while the screen is hidden; wake() resumes. */
  pause(): void {
    this.paused = true;
  }

  wake(): void {
    this.paused = false;
    if (!this.raf && this.view) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  undo(): void {
    if (this.view?.undo()) { this.wonReported = false; this.wonAt = null; this.hints.undone(); }
    this.wake();
  }

  restart(): void {
    this.view?.restart();
    this.hints.restarted(this.view);
    this.wonReported = false;
    this.wonAt = null;
    this.wake();
  }

  /** The status line: the Hint button's line while its board is on screen, else the view's own. */
  status(): string {
    const v = this.view;
    if (!v) return '';
    return this.hints.line(v) ?? v.hint().replace(/<[^>]+>/g, '');
  }

  /** Feeds a key to the view; true when it was used. */
  key(e: KeyboardEvent): boolean {
    if (!this.view || this.paused || confirming()) return false;
    if (e.key === 'u' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) { this.undo(); return true; }
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) { if (this.onRestartKey) this.onRestartKey(); else this.restart(); return true; }
    if (e.key === 'h' && !e.ctrlKey && !e.metaKey) { this.hints.ask(); return true; }
    if (this.view.key(e)) { this.hints.touched(); this.wake(); return true; }
    return false;
  }

  private frame(now: number): void {
    this.raf = 0;
    const v = this.view;
    if (!v || this.paused) return;
    const area = this.area();
    // Hidden (another tab is showing): nothing to draw into, so the loop stops until the
    // canvas has a size again (the ResizeObserver wakes it).
    if (area.w <= 0 || area.h <= 0 || !this.canvas.clientWidth) return;
    const ctx = this.ctx();
    v.draw(ctx, area, now);
    if (!v.won) this.wonAt = null;
    else {
      this.wonAt ??= now;
      drawWinFx(ctx, area, now - this.wonAt, this.reducedMotion);
    }
    this.hints.watch(v, now);
    this.onFrame?.(v);
    if (v.won && !this.wonReported && now - this.wonAt! >= winHold(this.reducedMotion)) {
      this.wonReported = true;
      this.onWon?.(v);
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.wake();
  }

  private ctx(): CanvasRenderingContext2D {
    const ctx = this.canvas.getContext('2d')!;
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, r.width);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    return ctx;
  }

  private clear(): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Pointer positions are in canvas space, matching the area the view draws in. */
  private point(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!this.view || this.paused || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.view.down(this.point(e));
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId || !this.view) return;
    this.view.move(this.point(e));
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.view?.up(this.point(e));
    this.hints.touched();
    this.wake();
  }

  private cancel(): void {
    this.pointerId = null;
    this.view?.cancel();
  }
}
