// Restart, everywhere a puzzle is played: a tap asks first ("Restart this board?"), and on yes Nu
// streaks across the board while the fresh one deals in behind it.

import { confirmDialog, iconButton } from '../ui/components';
import { icon } from '../ui/icons';

export interface RestartOptions {
  /** Clears the board. Runs once, as Nu sets off (or straight away under Reduce motion). */
  restart: () => void;
  /** Whether there is anything to clear; with nothing played yet, Restart does nothing. */
  canRestart?: () => boolean;
  /** What Nu streaks across: the board's canvas. */
  sweepOver?: () => Element | null;
  /** Each frame of the streak, p from 0 to 1, after the board has been cleared. */
  onSweep?: (p: number) => void;
}

/** A confirm dialog is up: puzzle keys wait until it is answered. */
export function confirming(): boolean {
  return document.querySelector('.ui-confirm') !== null;
}

/** Asks before restarting; true once the board has been cleared. */
export async function askRestart(o: RestartOptions): Promise<boolean> {
  if (o.canRestart && !o.canRestart()) return false;
  let done = false;
  const go = () => { if (!done) { done = true; o.restart(); } };
  const ok = await confirmDialog({
    title: 'Restart this board?',
    body: 'Your moves so far are cleared.',
    confirmLabel: 'Restart',
    nu: 'restart',
    sweepOver: o.sweepOver?.() ?? null,
    onSweep: (p) => { go(); o.onSweep?.(p); },
  });
  if (ok) go();
  return ok;
}

/** The toolbar's Restart button, which asks first. */
export function restartButton(o: RestartOptions): HTMLButtonElement {
  return iconButton({ icon: icon('restart'), label: 'Restart', onClick: () => void askRestart(o) });
}
