// The global settings sheet, reachable from the header on every screen. It
// edits the save in storage; screens that keep their own copy re-read it
// through the listeners registered here.

import { ISOTOPES, isotopeKey } from '../core/isotopes';
import { MAX_Z } from '../core/elements';
import { clearSave, loadSave, writeSave, type Settings } from '../core/save';
import { closeModal, openModal } from './modal';
import { MICROSCOPE } from './icons';

const listeners = new Set<() => void>();

/** Called after any setting changes, so a screen can re-read the save. */
export function onSettingsChange(fn: () => void): void {
  listeners.add(fn);
}

export function openSettings(): void {
  const save = loadSave();
  const s = save.settings;
  const toggle = (key: keyof Settings, title: string, help: string) => `
    <label class="toggle"><span>${title}<small>${help}</small></span><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}></label>`;
  const found = ISOTOPES.filter((i) => save.isotopes[isotopeKey(i.z, i.a)]?.collected || save.isotopes[isotopeKey(i.z, i.a)]?.witnessed?.length).length;
  const sheet = openModal(`
    <h2>Settings</h2>
    ${toggle('reducedMotion', 'Reduce motion', 'Calmer clouds, shorter animations, no auto-rotation.')}
    ${toggle('sound', 'Sound', 'Tones for fusions, hops and finished atoms.')}
    ${toggle('haptics', 'Vibration', 'Taps on supported phones.')}
    <h3>Around the app</h3>
    <p class="muted"><span class="inline-icon">${MICROSCOPE}</span> The microscope opens the science behind whatever is on screen. It stays out of the way until you tap it.</p>
    <h3>Keyboard</h3>
    <p class="muted">Merge: arrow keys swipe. Shells: 1, 2, 3 pick a ring, left and right turn it, space hops the electron at the gate (up and down choose the direction). U undoes, R restarts the puzzle.</p>
    <h3>Testing</h3>
    ${toggle('unlockAll', 'Unlock every element', 'Every atom counts as collected and can be built in any order.')}
    <h3>Progress</h3>
    <p class="muted">${Object.keys(save.built).length} of ${MAX_Z} elements built · ${found} of ${ISOTOPES.length} isotopes found</p>
    <div class="actions"><button class="secondary" id="set-reset">Reset all progress</button><button class="primary" id="set-close">Done</button></div>`);
  sheet.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((inp) => (inp.onchange = () => {
    (s as unknown as Record<string, boolean>)[inp.dataset.key!] = inp.checked;
    writeSave(save);
    listeners.forEach((fn) => fn());
  }));
  sheet.querySelector<HTMLButtonElement>('#set-close')!.onclick = () => closeModal();
  sheet.querySelector<HTMLButtonElement>('#set-reset')!.onclick = (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    if (b.dataset.confirm) {
      clearSave();
      location.reload();
    } else {
      b.dataset.confirm = '1';
      b.textContent = 'Tap again to erase everything';
    }
  };
}
