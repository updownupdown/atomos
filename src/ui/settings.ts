// The Settings screen, the fourth section in the header. It edits the save in
// storage; screens that keep their own copy re-read it through the listeners
// registered here. It renders afresh each time the screen opens.

import { ISOTOPES, isotopeKey } from '../core/isotopes';
import { MAX_Z } from '../core/elements';
import { clearSave, loadSave, writeSave, type Settings } from '../core/save';
import { MICROSCOPE } from './icons';
import { createSegments, switchHtml } from './components';
import { applyProgressPreset, currentPreset, PROGRESS_PRESETS, type ProgressPreset } from '../core/testing';

/** Taps needed after the first to erase everything. */
const RESET_TAPS = 3;

const listeners = new Set<() => void>();

/** Called after any setting changes, so a screen can re-read the save. */
export function onSettingsChange(fn: () => void): void {
  listeners.add(fn);
}

/** Fill the Settings screen (or any container) with the current settings. */
export function renderSettings(sheet: HTMLElement): void {
  const save = loadSave();
  const s = save.settings;
  const toggle = (key: keyof Settings, title: string, help: string) => switchHtml({ label: title, help, checked: s[key], key });
  const found = ISOTOPES.filter((i) => save.isotopes[isotopeKey(i.z, i.a)]?.collected || save.isotopes[isotopeKey(i.z, i.a)]?.witnessed?.length).length;
  sheet.innerHTML = `
    <h1 class="settings-title">Settings</h1>
    ${toggle('reducedMotion', 'Reduce motion', 'Calmer clouds, shorter animations, no auto-rotation.')}
    ${toggle('sound', 'Sound', 'Tones for fusions, hops and finished atoms.')}
    ${toggle('haptics', 'Vibration', 'Taps on supported phones.')}
    <h3>Around the app</h3>
    <p class="muted"><span class="inline-icon">${MICROSCOPE}</span> The microscope opens the science behind whatever is on screen. It stays out of the way until you tap it.</p>
    <h3>Keyboard</h3>
    <p class="muted">Arrow keys swipe or move in most puzzles; each puzzle's instructions list its own keys. U undoes and R restarts.</p>
    <h3>Testing</h3>
    <p class="muted">Set the whole game to a share of done, to see how screens look. This replaces your progress.</p>
    <div id="set-preset"></div>
    <h3>Progress</h3>
    <p class="muted">${Object.keys(save.built).length} of ${MAX_Z} elements built · ${found} of ${ISOTOPES.length} isotopes found</p>
    <div class="actions reset-row"><button class="secondary" id="set-reset">Reset all progress</button><button class="secondary" id="set-cancel" hidden>Cancel</button></div>
    <h3>Design</h3>
    <div class="actions"><a class="secondary settings-link" href="#icons">Icon library</a></div>`;
  sheet.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((inp) => (inp.onchange = () => {
    (s as unknown as Record<string, boolean>)[inp.dataset.key!] = inp.checked;
    writeSave(save);
    listeners.forEach((fn) => fn());
  }));
  const preset = createSegments(PROGRESS_PRESETS.map((p) => ({ id: String(p), label: `${p}%` })), {
    active: String(currentPreset(save) ?? ''),
    label: 'Progress for testing',
    onChange: (id) => {
      writeSave(applyProgressPreset(loadSave(), Number(id) as ProgressPreset));
      location.reload();
    },
  });
  sheet.querySelector('#set-preset')!.append(preset.el);
  const reset = sheet.querySelector<HTMLButtonElement>('#set-reset')!;
  const cancel = sheet.querySelector<HTMLButtonElement>('#set-cancel')!;
  let left = -1;
  const paint = () => {
    cancel.hidden = left < 0;
    reset.classList.toggle('danger', left >= 0);
    reset.textContent = left < 0 ? 'Reset all progress' : `Tap ${left} more time${left === 1 ? '' : 's'} to reset`;
  };
  reset.onclick = () => {
    left = left < 0 ? RESET_TAPS : left - 1;
    if (left === 0) {
      clearSave();
      location.reload();
      return;
    }
    paint();
  };
  cancel.onclick = () => { left = -1; paint(); };
}
