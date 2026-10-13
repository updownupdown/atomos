import { describe, expect, it } from 'vitest';
import { lossOf, type PuzzleView } from '../src/puzzles/view';

const view = (o: Partial<Record<'won' | 'stuck' | 'failed' | 'undo', boolean>> & { loss?: PuzzleView['loss'] }): PuzzleView =>
  ({ won: Boolean(o.won), stuck: Boolean(o.stuck), failed: o.failed, loss: o.loss, canUndo: () => Boolean(o.undo) }) as unknown as PuzzleView;

describe('lossOf', () => {
  it('is null while the board can go on, and on a won board', () => {
    expect(lossOf(view({}))).toBeNull();
    expect(lossOf(view({ won: true, stuck: true }))).toBeNull();
  });

  it('words a board lost for good by its own loss, Glyph by default, with Undo only where allowed', () => {
    expect(lossOf(view({ failed: true, stuck: true, undo: true }))).toMatchObject({ headline: 'Out of guesses', undo: false });
    expect(lossOf(view({ failed: true, undo: true, loss: { headline: 'Jammed', undo: true } }))).toMatchObject({ headline: 'Jammed', undo: true });
    expect(lossOf(view({ failed: true, undo: false, loss: { headline: 'Jammed', undo: true } }))).toMatchObject({ undo: false });
  });

  it('calls a dead end Stuck, with Undo when there is a move to take back', () => {
    expect(lossOf(view({ stuck: true, undo: true }))).toMatchObject({ headline: 'Stuck', undo: true });
    expect(lossOf(view({ stuck: true, undo: false }))).toMatchObject({ headline: 'Stuck', undo: false });
  });
});
