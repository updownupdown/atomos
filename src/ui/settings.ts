// The Settings screen, the fourth section in the header. It edits the save in
// storage; screens that keep their own copy re-read it through the listeners
// registered here. It renders afresh each time the screen opens.

import { MAX_Z } from '../core/elements';
import { atomBuilt, fleetingTotal, segmentsOf } from '../core/progress';
import { clearSave, loadSave, writeSave, type Settings } from '../core/save';
import { backupFileName, makeBackup, readBackup, restoreBackup, storageKept } from '../core/backup';
import { confirmDialog, createSegments, showToast } from './components';
import { icon, type IconName } from './icons';
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
  // A switch row: its icon, its name over a short line, the switch at the right.
  const toggle = (key: keyof Settings, glyph: IconName, title: string, help: string) => `
    <label class="ui-switch-row set-row">
      <span class="set-icon" aria-hidden="true">${icon(glyph, { size: 22 })}</span>
      <span class="ui-switch-text">${title}<small>${help}</small></span>
      <input type="checkbox" role="switch" class="ui-switch" data-key="${key}"${s[key] ? ' checked' : ''}>
    </label>`;
  // The same totals as Collect: atoms built, stable parts (each atom's nucleus, electrons and
  // lasting isotopes) and fleeting isotopes.
  let atoms = 0;
  const stable = { built: 0, total: 0 };
  for (let z = 1; z <= MAX_Z; z++) {
    if (atomBuilt(z, save)) atoms++;
    const segs = segmentsOf(z, save);
    stable.built += segs.filter((x) => x.done).length;
    stable.total += segs.length;
  }
  const fleeting = fleetingTotal(save);
  const n = (v: number) => v.toLocaleString('en-US');
  // A count row: icon, name, a bar, and n/total, the columns lined up across rows.
  const count = (glyph: IconName, title: string, built: number, total: number) => `
    <div class="set-count" role="group" aria-label="${title}: ${n(built)} of ${n(total)}">
      <span class="set-icon" aria-hidden="true">${icon(glyph, { size: 20 })}</span>
      <span class="set-count-name">${title}</span>
      <span class="set-count-bar" aria-hidden="true"><i style="width:${total ? (100 * built / total).toFixed(2) : 0}%"></i></span>
      <span class="set-count-n" aria-hidden="true">${n(built)}/${n(total)}</span>
    </div>`;
  const link = (href: string, title: string) => `<a class="set-link" href="${href}"><span>${title}</span>${icon('chevron-right', { size: 20 })}</a>`;
  sheet.innerHTML = `
    <div class="set-card">
      ${toggle('reducedMotion', 'motion', 'Reduce motion', 'Calmer clouds and shorter animations.')}
      ${toggle('sound', 'sound', 'Sound', 'Tones for fusions, hops and finished atoms.')}
      ${toggle('haptics', 'vibrate', 'Vibration', 'Taps on supported phones.')}
      ${toggle('nu', 'nu', 'Nu', 'The point of light that shows the way and circles Hint when you seem stuck.')}
    </div>
    <h3 class="set-head">Progress</h3>
    <div class="set-card set-counts">
      ${count('atom', 'Atoms', atoms, MAX_Z)}
      ${count('isotope-stable', 'Stable', stable.built, stable.total)}
      ${count('isotope-fleeting', 'Fleeting', fleeting.built, fleeting.total)}
    </div>
    <p class="set-note" id="set-kept">Your progress is kept in this browser.</p>
    <div class="set-pair"><button class="primary" id="set-backup">Back up</button><button class="secondary" id="set-restore">Restore</button></div>
    <input type="file" id="set-restore-file" accept="application/json,.json" hidden>
    <h3 class="set-head">Testing</h3>
    <p class="set-note">Set the whole game to a share of done to see how screens look. This replaces your progress.</p>
    <div id="set-preset"></div>
    <button class="secondary set-reset" id="set-reset">Reset all progress</button>
    <h3 class="set-head">Design</h3>
    <nav class="set-card set-links" aria-label="Design">
      ${link('#icons', 'Icon library')}${link('#components', 'Component library')}${link('./lab.html', 'Atom visualization lab')}
    </nav>`;
  sheet.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((inp) => (inp.onchange = () => {
    (s as unknown as Record<string, boolean>)[inp.dataset.key!] = inp.checked;
    writeSave(save);
    listeners.forEach((fn) => fn());
    window.dispatchEvent(new Event('atomos:settings'));
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
    if (yes === true) kept.textContent = 'Kept in this browser, which has promised not to clear it. A backup file keeps it safe if you change phones.';
    else kept.textContent = 'Kept in this browser, which may clear it if the app goes unused. Keep a backup file to be safe.';
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
