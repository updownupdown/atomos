// Keeping a player's progress safe. Everything lives in this browser's storage, which a
// browser may clear (Safari after about a week without a visit, or "clear browsing data").
// So we ask the browser to keep it once there is something to lose, and Settings offers a
// backup file the player can keep and restore from.

/** Every key the app keeps in storage starts with this; a backup carries all of them. */
const PREFIX = 'atomos.';
/** Per-device screen memory, not progress: left out of backups and kept on restore. */
const DEVICE_ONLY = new Set(['atomos.place']);

export interface Backup {
  app: 'atomos';
  kind: 'backup';
  version: 1;
  /** When it was made (ms). */
  at: number;
  /** Raw storage values by key. */
  data: Record<string, string>;
}

function keys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX) && !DEVICE_ONLY.has(k)) out.push(k);
  }
  return out.sort();
}

/** A snapshot of everything the player has, as a backup object. */
export function makeBackup(now = Date.now()): Backup {
  const data: Record<string, string> = {};
  for (const k of keys()) {
    const v = localStorage.getItem(k);
    if (v !== null) data[k] = v;
  }
  return { app: 'atomos', kind: 'backup', version: 1, at: now, data };
}

/** Reads a backup file's text; null when it isn't an Atomos backup. */
export function readBackup(text: string): Backup | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const b = v as Partial<Backup>;
  if (b.app !== 'atomos' || b.kind !== 'backup' || b.version !== 1 || !b.data || typeof b.data !== 'object') return null;
  const data: Record<string, string> = {};
  for (const [k, val] of Object.entries(b.data)) {
    if (k.startsWith(PREFIX) && !DEVICE_ONLY.has(k) && typeof val === 'string') data[k] = val;
  }
  if (!data['atomos.save.v1']) return null;
  return { app: 'atomos', kind: 'backup', version: 1, at: Number.isFinite(b.at) ? Number(b.at) : 0, data };
}

/** Replaces everything stored with the backup's contents. */
export function restoreBackup(b: Backup): void {
  for (const k of keys()) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(b.data)) localStorage.setItem(k, v);
}

/** The backup's file name, dated: atomos-progress-2026-10-12.json. */
export function backupFileName(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `atomos-progress-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

let asked = false;

/** Asks the browser, once per visit, not to clear our storage. Most browsers answer quietly;
 *  installed apps and well-used sites are usually granted. */
export function keepStorage(): void {
  if (asked) return;
  asked = true;
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.persist || !s.persisted) return;
    void s.persisted().then((yes) => (yes ? true : s.persist())).catch(() => undefined);
  } catch {
    // Not supported: the backup file is the safety net.
  }
}

/** Whether the browser has promised to keep our storage; null when it can't say. */
export async function storageKept(): Promise<boolean | null> {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    return s?.persisted ? await s.persisted() : null;
  } catch {
    return null;
  }
}
