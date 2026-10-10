// A gate puzzle played over everything, to open part of the gallery: a lens (Lumen), the nucleus
// view (Aurum) or a look (Glyph). The gallery calls playUnlock from a locked item's Unlock button;
// a win records the unlock and fires 'atomos:progress' so every screen can refresh.

import { loadSave, writeSave } from '../core/save';
import { unlockPuzzle, unlockZ, type UnlockId } from '../core/unlocks';
import { iconButton } from '../ui/components';
import { askRestart, restartButton } from './restart';
import { icon } from '../ui/icons';
import { modalOpen } from '../ui/modal';
import { puzzleType } from './catalog';
import { PuzzleHost } from './host';
import { difficulty } from './difficulty';
import { createGameBar, gameFooter, offerRules } from './gamebar';
import { openRules } from './rulesModal';
import { showWin } from './winPanel';
import type { Area } from './view';

export interface UnlockInfo {
  /** What it opens, for the header and the win panel: "The Ribbon lens". */
  title: string;
  /** What the player can do now, in a sentence, for the win panel. */
  note?: string;
}

let open: Promise<boolean> | null = null;

/** Plays the puzzle that opens `id`. Resolves true once it is solved (and saved), false if the
 *  player backs out. Replaying an open unlock plays the same board again. */
export function playUnlock(id: UnlockId, info: UnlockInfo): Promise<boolean> {
  if (open) return open;
  open = run(id, info).finally(() => { open = null; });
  return open;
}

function run(id: UnlockId, info: UnlockInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const save = loadSave();
    const reduced = save.settings.reducedMotion;
    const t = puzzleType(unlockPuzzle(id));
    const z = unlockZ(id, save);

    const root = document.createElement('section');
    root.className = 'unlock-screen';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', `${t.name}: unlock ${info.title}`);
    root.innerHTML = `
      <div class="pg-play"><canvas aria-label="The puzzle."></canvas></div>`;
    document.body.append(root);

    const canvas = root.querySelector('canvas')!;
    const play = root.querySelector<HTMLElement>('.pg-play')!;
    const area = (): Area => {
      const r = canvas.getBoundingClientRect();
      const colW = r.width < 700 ? r.width - 16 : Math.min(720, r.width * 0.7);
      return { x: (r.width - colW) / 2, y: 6, w: colW, h: Math.max(200, r.height - 12) };
    };
    const host = new PuzzleHost(canvas, area);
    let closeWin = () => {};
    const restartOpts = {
      canRestart: () => (host.current?.moves ?? 0) > 0,
      sweepOver: () => canvas,
      restart: () => { closeWin(); host.restart(); },
    };
    host.onRestartKey = () => void askRestart(restartOpts);

    const undo = iconButton({ icon: icon('undo'), label: 'Undo', onClick: () => host.undo() });
    const rules = () => openRules(t, { reducedMotion: reduced });
    const bar = createGameBar([
      undo,
      restartButton(restartOpts),
      host.hints.button,
      iconButton({ icon: icon('info'), label: 'Instructions', onClick: rules }),
    ]);
    bar.setDifficulty(difficulty(t.id, z));
    bar.setTitle(t.name, `Unlocking ${info.title}`);
    play.before(bar.el);
    const foot = gameFooter('Back', () => finish(Boolean(loadSave().unlocks[id])));
    play.after(foot.el);
    offerRules(bar, t, rules);

    host.onFrame = (v) => {
      undo.disabled = !v.canUndo();
      const plain = host.status();
      bar.update(v, plain.length > 60 && plain !== host.hints.line(v) ? '' : plain);
    };

    const finish = (won: boolean) => {
      host.set(null);
      host.pause();
      window.removeEventListener('keydown', key, true);
      root.remove();
      resolve(won);
    };

    host.onWon = (v) => {
      const s = loadSave();
      const prev = s.unlocks[id];
      const best = prev?.best === undefined ? v.moves : Math.min(prev.best, v.moves);
      s.unlocks[id] = { at: prev?.at ?? Date.now(), z, best };
      writeSave(s);
      window.dispatchEvent(new CustomEvent('atomos:progress', { detail: { unlock: id } }));
      closeWin = showWin(play, {
        kicker: prev ? 'Solved again' : 'Unlocked',
        title: info.title,
        flawless: v.clean && !host.hints.used(v),
        stats: [
          { label: 'Moves', value: String(v.moves) },
          ...(v.par !== null ? [{ label: 'Par', value: v.moves <= v.par ? `${v.par} ✓` : String(v.par) }] : []),
        ],
        note: prev ? `Your best is ${best} move${best === 1 ? '' : 's'}.` : info.note,
        actions: [{ label: 'Done', primary: true, onClick: () => finish(true) }],
      }, reduced);
    };

    function key(e: KeyboardEvent): void {
      if (modalOpen()) return;
      if (e.key === 'Escape') { finish(Boolean(loadSave().unlocks[id])); e.preventDefault(); e.stopPropagation(); return; }
      if (host.key(e)) { e.preventDefault(); e.stopPropagation(); }
    }
    window.addEventListener('keydown', key, true);

    host.set(t.make!(z, 0, reduced));
    window.dispatchEvent(new Event('resize'));
    foot.back.focus({ preventScroll: true });
  });
}

// So the flow can be tried from the console before the gallery wires its buttons.
declare global { interface Window { atomosUnlock?: typeof playUnlock } }
window.atomosUnlock = playUnlock;
