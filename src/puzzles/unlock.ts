// A gate puzzle played over everything, to open part of the gallery: a lens (Lumen), the nucleus
// view (Aurum) or a look (Glyph). The gallery calls playUnlock from a locked item's Unlock button;
// a win records the unlock and fires 'atomos:progress' so every screen can refresh.

import { loadSave, writeSave } from '../core/save';
import { unlockPuzzle, unlockZ, type UnlockId } from '../core/unlocks';
import { createHoldButton, iconButton } from '../ui/components';
import { icon } from '../ui/icons';
import { modalOpen } from '../ui/modal';
import { puzzleType } from './catalog';
import { PuzzleHost } from './host';
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
      <div class="pg-head">
        <button class="back-plate" data-back aria-label="Back without unlocking">${icon('chevron-left', { size: 20 })}<span>Back</span></button>
        <h2 class="pg-title">${t.name}</h2>
        <span class="pg-use">Unlock · ${info.title}</span>
      </div>
      <div class="pg-play"><canvas aria-label="The puzzle."></canvas></div>
      <div class="pg-bottom">
        <div class="pg-status"><span class="pg-count"></span><span class="pg-hint" role="status" aria-live="polite"></span></div>
        <div class="pg-actions"></div>
      </div>`;
    document.body.append(root);

    const canvas = root.querySelector('canvas')!;
    const play = root.querySelector<HTMLElement>('.pg-play')!;
    const count = root.querySelector<HTMLElement>('.pg-count')!;
    const hintEl = root.querySelector<HTMLElement>('.pg-hint')!;
    const area = (): Area => {
      const r = canvas.getBoundingClientRect();
      const colW = r.width < 700 ? r.width - 16 : Math.min(720, r.width * 0.7);
      return { x: (r.width - colW) / 2, y: 6, w: colW, h: Math.max(200, r.height - 12) };
    };
    const host = new PuzzleHost(canvas, area);
    let closeWin = () => {};
    let shown = '';

    const undo = iconButton({ icon: icon('undo'), label: 'Undo', onClick: () => host.undo() });
    root.querySelector('.pg-actions')!.append(
      undo,
      createHoldButton({ icon: icon('restart'), label: 'Restart', doneLabel: 'Restarted', onConfirm: () => { closeWin(); host.restart(); } }),
      iconButton({ icon: icon('info'), label: 'Instructions', onClick: () => openRules(t, { reducedMotion: reduced }) }),
    );

    host.onFrame = (v) => {
      const text = `${v.moves} move${v.moves === 1 ? '' : 's'}${v.par !== null ? ` · par ${v.par}` : ''}`;
      if (count.textContent !== text) count.textContent = text;
      undo.disabled = !v.canUndo();
      const plain = v.hint().replace(/<[^>]+>/g, '');
      if (plain !== shown) {
        shown = plain;
        hintEl.textContent = plain.length > 60 ? '' : plain;
      }
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
        flawless: v.clean,
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
    root.querySelector<HTMLButtonElement>('[data-back]')!.onclick = () => finish(Boolean(loadSave().unlocks[id]));

    host.set(t.make!(z, 0, reduced));
    window.dispatchEvent(new Event('resize'));
    root.querySelector<HTMLButtonElement>('[data-back]')!.focus({ preventScroll: true });
  });
}

// So the flow can be tried from the console before the gallery wires its buttons.
declare global { interface Window { atomosUnlock?: typeof playUnlock } }
window.atomosUnlock = playUnlock;
