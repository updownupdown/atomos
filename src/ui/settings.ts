// The Settings screen, the fourth section in the header. It edits the save in
// storage; screens that keep their own copy re-read it through the listeners
// registered here. It renders afresh each time the screen opens.

import { MAX_Z } from '../core/elements';
import { atomBuilt, fleetingTotal, lastingTotal } from '../core/progress';
import { clearSave, loadSave, writeSave, type Settings } from '../core/save';
import { backupFileName, makeBackup, readBackup, restoreBackup, storageKept } from '../core/backup';
import { confirmDialog, createSegments, showToast, switchHtml } from './components';
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
    ${toggle('reducedMotion', 'Reduce motion', 'Calmer clouds, shorter animations, no auto-rotation.')}
    ${toggle('sound', 'Sound', 'Tones for fusions, hops and finished atoms.')}
    ${toggle('haptics', 'Vibration', 'Taps on supported phones.')}
    ${toggle('nu', 'Nu', 'The point of light that flies to what to do next and says a line the first time something happens.')}
    <h3>Progress</h3>
    <p class="muted">${atoms} of ${MAX_Z} atoms built · ${n(lasting.built)} of ${n(lasting.total)} lasting isotopes · ${n(fleeting.built)} of ${n(fleeting.total)} fleeting isotopes</p>
    <p class="muted" id="set-kept">Your progress is kept in this browser.</p>
    <div class="actions"><button class="primary" id="set-backup">Back up progress</button><button class="secondary" id="set-restore">Restore a backup</button></div>
    <input type="file" id="set-restore-file" accept="application/json,.json" hidden>
    <p class="muted">For testing, set the whole game to a share of done to see how screens look. This replaces your progress.</p>
    <div id="set-preset"></div>
    <div class="actions reset-row"><button class="secondary" id="set-reset">Reset all progress</button></div>
    <h3>Design</h3>
    <div class="actions"><a class="secondary settings-link" href="#icons">Icon library</a><a class="secondary settings-link" href="#components">Component library</a><a class="secondary settings-link" href="./lab.html">Atom visualization lab</a></div>`;
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
  wireBackup(sheet);
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

/** Back up and restore: a dated file the player keeps, and the way back from one. */
function wireBackup(sheet: HTMLElement): void {
  const kept = sheet.querySelector<HTMLElement>('#set-kept')!;
  void storageKept().then((yes) => {
    if (yes === true) kept.textContent = 'Your progress is kept in this browser, and the browser has promised not to clear it. A backup file keeps it safe if you change phones.';
    else kept.textContent = 'Your progress is kept in this browser, which may clear it if the app goes unused or site data is cleared. Keep a backup file to be safe.';
  });
  sheet.querySelector<HTMLButtonElement>('#set-backup')!.onclick = async () => {
    const b = makeBackup();
    const name = backupFileName(b.at);
    const text = JSON.stringify(b);
    // Phones: the share sheet saves to Files or Drive. Elsewhere: a download.
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Atomos progress' });
        showToast('Backup saved', { tone: 'good' });
        return;
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Backup saved', { tone: 'good' });
  };
  const input = sheet.querySelector<HTMLInputElement>('#set-restore-file')!;
  sheet.querySelector<HTMLButtonElement>('#set-restore')!.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const b = readBackup(await file.text());
    if (!b) { showToast("That file isn't an Atomos backup", { tone: 'bad' }); return; }
    const when = b.at ? new Date(b.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'an earlier day';
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      body: `Your progress goes back to the backup from ${when}. Anything you've done since is replaced.`,
      confirmLabel: 'Restore',
      tone: 'problem',
    });
    if (!ok) return;
    restoreBackup(b);
    location.reload();
  };
}
