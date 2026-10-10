// The Settings screen, the fourth section in the header. It edits the save in
// storage; screens that keep their own copy re-read it through the listeners
// registered here. It renders afresh each time the screen opens.

import { MAX_Z } from '../core/elements';
import { atomBuilt, fleetingTotal, lastingTotal } from '../core/progress';
import { clearSave, loadSave, writeSave, type Settings } from '../core/save';
import { MICROSCOPE } from './icons';
import { confirmDialog, createSegments, switchHtml } from './components';
import { applyProgressPreset, currentPreset, PROGRESS_PRESETS, type ProgressPreset } from '../core/testing';

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
  let atoms = 0;
  for (let z = 1; z <= MAX_Z; z++) if (atomBuilt(z, save)) atoms++;
  const lasting = lastingTotal(save);
  const fleeting = fleetingTotal(save);
  const n = (v: number) => v.toLocaleString('en-US');
  sheet.innerHTML = `
    <h1 class="settings-title">Settings</h1>
    ${toggle('reducedMotion', 'Reduce motion', 'Calmer clouds, shorter animations, no auto-rotation.')}
    ${toggle('sound', 'Sound', 'Tones for fusions, hops and finished atoms.')}
    ${toggle('haptics', 'Vibration', 'Taps on supported phones.')}
    ${toggle('nu', 'Nu', 'The point of light that flies to what to do next and says a line the first time something happens.')}
    <h3>Around the app</h3>
    <p class="muted"><span class="inline-icon">${MICROSCOPE}</span> The microscope opens the science behind whatever is on screen. It stays out of the way until you tap it.</p>
    <h3>Keyboard</h3>
    <p class="muted">Arrow keys swipe or move in most puzzles; each puzzle's instructions list its own keys. U undoes, R restarts and H gives a hint.</p>
    <h3>Testing</h3>
    <p class="muted">Set the whole game to a share of done, to see how screens look. This replaces your progress.</p>
    <div id="set-preset"></div>
    <h3>Progress</h3>
    <p class="muted">${atoms} of ${MAX_Z} atoms built · ${n(lasting.built)} of ${n(lasting.total)} lasting isotopes · ${n(fleeting.built)} of ${n(fleeting.total)} fleeting isotopes</p>
    <div class="actions reset-row"><button class="secondary" id="set-reset">Reset all progress</button></div>
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
  // Asks first; on yes Nu sweeps the screen, then everything goes back to locked.
  sheet.querySelector<HTMLButtonElement>('#set-reset')!.onclick = async () => {
    const ok = await confirmDialog({
      title: 'Reset everything?',
      body: "Every atom, isotope and discovery goes back to locked. This can't be undone.",
      confirmLabel: 'Reset everything',
      tone: 'problem',
      nu: 'reset',
    });
    if (!ok) return;
    clearSave();
    // Forget the screen too, so the app starts over the way a new player's does.
    try { localStorage.removeItem('atomos.place'); } catch { /* storage off */ }
    location.reload();
  };
}
