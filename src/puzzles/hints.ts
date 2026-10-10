// The Hint button, the same wherever a puzzle is played. The first tap is Look here: the puzzle
// marks a spot and says why in one line. A second tap on the same board is Show me: the puzzle
// plays one move. A run that used Show me can't be flawless. When the player seems stuck (about
// 45 seconds without progress, three undos in a row, or a second restart), the button gets a
// soft white outline; nothing pops up.

import { iconButton } from '../ui/components';
import { icon } from '../ui/icons';
import type { PuzzleView } from './view';

const STUCK_MS = 45_000;

export class HintControl {
  readonly button: HTMLButtonElement;
  /** Look here was shown on this board; the next tap on it is Show me. */
  private pending: { p: PuzzleView; moves: number } | null = null;
  /** Puzzles where Show me played a move, until they are restarted. */
  private showed = new WeakSet<PuzzleView>();
  private said: { p: PuzzleView; moves: number; text: string } | null = null;
  private watched: PuzzleView | null = null;
  private lastMoves = 0;
  private lastProgress = 0;
  private undos = 0;
  private restarts = 0;

  /** `current` is the puzzle on screen; `changed` runs after a hint, to redraw. `button` is for
   *  tests; the app makes its own. */
  constructor(private current: () => PuzzleView | null, private changed: () => void = () => {}, button?: HTMLButtonElement) {
    this.button = button ?? iconButton({ icon: icon('search'), label: 'Hint', onClick: () => this.ask() });
    this.button.classList.add('hint-btn');
  }

  /** The Hint button was tapped. */
  ask(): void {
    const p = this.current();
    if (!p || p.won) return;
    const level = this.pending?.p === p && this.pending.moves === p.moves ? 2 : 1;
    const h = p.help(level);
    this.nudge(false);
    if (!h) return;
    if (h.moved) this.showed.add(p);
    this.pending = level === 1 && !h.moved ? { p, moves: p.moves } : null;
    this.said = { p, moves: p.moves, text: h.text };
    this.changed();
  }

  /** The player touched the board (some games count only some actions as moves, Flux only its
   *  checks): the next tap on Hint is Look here again, and the hint's line goes. */
  touched(): void {
    this.pending = null;
    this.said = null;
  }

  /** The hint's line, while the board is still the one it was given for. */
  line(p: PuzzleView | null): string | null {
    const s = this.said;
    return s && p === s.p && p.moves === s.moves && !p.won ? s.text : null;
  }

  /** Whether Show me played a move in this run. */
  used(p: PuzzleView): boolean {
    return this.showed.has(p);
  }

  /** Called every frame while a puzzle is on screen, to notice a player who is stuck. */
  watch(p: PuzzleView | null, now = performance.now()): void {
    if (p !== this.watched) {
      this.watched = p;
      this.lastMoves = p?.moves ?? 0;
      this.lastProgress = now;
      this.undos = 0;
      this.restarts = 0;
      this.nudge(false);
      return;
    }
    if (!p || p.won) return this.nudge(false);
    if (p.moves > this.lastMoves) {
      this.lastProgress = now;
      this.undos = 0;
      this.nudge(false);
    }
    this.lastMoves = p.moves;
    if (now - this.lastProgress > STUCK_MS) this.nudge(true);
  }

  /** An undo: three in a row look like a player going round in circles. */
  undone(): void {
    if (++this.undos >= 3) this.nudge(true);
    this.lastProgress = performance.now();
  }

  /** A restart: a fresh run, so Show me no longer counts against it; a second one nudges. */
  restarted(p: PuzzleView | null): void {
    if (p) this.showed.delete(p);
    this.pending = null;
    this.said = null;
    this.lastMoves = 0;
    this.lastProgress = performance.now();
    if (++this.restarts >= 2) this.nudge(true);
  }

  private nudge(on: boolean): void {
    this.button.classList.toggle('is-nudge', on);
  }
}
