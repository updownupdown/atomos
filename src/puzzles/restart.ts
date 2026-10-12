// Restart, everywhere a puzzle is played: a tap asks first ("Restart this board?"), and on yes Nu
// streaks across the board while the fresh one deals in behind it. A double tap restarts at once,
// without asking; the question says so at its foot.

import { confirmDialog, iconButton } from '../ui/components';
import { icon } from '../ui/icons';
import { nuStreak } from '../ui/nu';

/** How long a first tap waits for a second before it asks. */
export const DOUBLE_TAP_MS = 300;

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
    note: 'Double-tap Restart to skip this question.',
  });
  if (ok) go();
  return ok;
}

/** Restarts without asking (a double tap): Nu streaks across the board as it clears. */
export async function restartNow(o: RestartOptions): Promise<boolean> {
  if (o.canRestart && !o.canRestart()) return false;
  let done = false;
  const go = () => { if (!done) { done = true; o.restart(); } };
  await nuStreak(o.sweepOver?.() ?? null, (p) => { go(); o.onSweep?.(p); });
  go();
  return true;
}

/** The toolbar's Restart button: a tap asks first, a double tap restarts at once. The first tap
 *  waits DOUBLE_TAP_MS for a second before it asks. */
export function restartButton(o: RestartOptions): HTMLButtonElement {
  let wait = 0;
  return iconButton({
    icon: icon('restart'),
    label: 'Restart',
    onClick: () => {
      if (wait) {
        window.clearTimeout(wait);
        wait = 0;
        void restartNow(o);
        return;
      }
      wait = window.setTimeout(() => { wait = 0; void askRestart(o); }, DOUBLE_TAP_MS);
    },
  });
}
