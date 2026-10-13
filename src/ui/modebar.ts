// An atom's modes: Build (its puzzles), Info (the element's pages) and View (the 3D atom alone,
// full screen). There is no bar to pick them: Build has View and Info buttons over its atom, and
// Info's progress box has Build. progressHtml, the ring and percentages, is shared with the
// gallery's views row.

export type AtomMode = 'view' | 'build' | 'info';

/** The modes that slide sideways into each other, left to right. */
export const MODES: AtomMode[] = ['build', 'info'];

/** The ring and percentages the mode rows share; the gallery's views row shows the figures
 *  alone (`ring` false). The percentage turns green at 100%. */
export function progressHtml(main: number, extra?: { label: string; pct: number } | null, ring = true): string {
  const n = Math.round(Math.max(0, Math.min(1, main)) * 100);
  const arc = `<span class="mode-ring${n >= 100 ? ' is-done' : ''}" aria-hidden="true"><svg viewBox="0 0 20 20"><circle class="mode-prog-track" cx="10" cy="10" r="7.5"/><circle class="mode-prog-arc" cx="10" cy="10" r="7.5" pathLength="100" stroke-dasharray="${n} 100"/></svg></span>`;
  const sub = extra ? `<small class="mode-sub">${Math.round(extra.pct * 100)}% ${extra.label}</small>` : '';
  return `${ring ? arc : ''}<span class="mode-figs"><b class="mode-pct${n >= 100 ? ' is-done' : ''}">${n}%</b>${sub}</span>`;
}
