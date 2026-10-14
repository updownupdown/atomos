// Search, from the magnifier in the home header: one field over atoms (name, symbol or number)
// and games (name), as a sheet dropping from the top. Results come in two groups, Atoms then
// Games, the typed letters lit in each name. Enter opens the first result.
//
//   openFinder({ onAtom: (z) => open(z), onGame: (id) => play(id) });

import { placeColour, type Element } from '../gallery/data';
import { familyOf } from '../gallery/atomlist';
import { searchElements } from './search';
import { gameRow, gamesInOrder } from './gamelist';
import { icon } from './icons';
import { openSheet } from './sheet';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** The name with the first run of the query lit. */
const lit = (name: string, q: string) => {
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return esc(name);
  return `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, i + q.length))}</mark>${esc(name.slice(i + q.length))}`;
};
const ATOMS_SHOWN = 40;

export function openFinder(o: { onAtom: (z: number) => void; onGame: (id: string) => void }): void {
  const sheet = openSheet({ title: null, label: 'Search atoms and games', from: 'top', className: 'finder' });
  const field = document.createElement('label');
  field.className = 'al-search finder-field';
  field.innerHTML = `${icon('search', { size: 20 })}<input type="search" placeholder="Atoms and games" aria-label="Search atoms and games" autocomplete="off" enterkeyhint="search">`;
  sheet.head.prepend(field);
  const input = field.querySelector('input')!;
  const atomRow = (e: Element, q: string) => `<li><button type="button" class="sheet-row" data-z="${e.z}">`
    + `<b class="sheet-sym" style="--c:${placeColour(e)}">${e.symbol}</b>`
    + `<span class="sheet-name"><span>${lit(e.name, q)}</span><small>${e.z} · ${esc(familyOf(e))}</small></span>${icon('chevron-right', { size: 20 })}</button></li>`;
  const paint = () => {
    const q = input.value.trim();
    if (!q) { sheet.body.innerHTML = '<p class="sheet-empty">Find an atom by its name, symbol or number, or a game by its name.</p>'; return; }
    const atoms = searchElements(q).slice(0, ATOMS_SHOWN);
    const games = gamesInOrder().filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    let html = '';
    if (atoms.length) html += `<h3 class="sheet-group">Atoms<small>${atoms.length}</small></h3><ul class="sheet-rows">${atoms.map((e) => atomRow(e, q)).join('')}</ul>`;
    if (games.length) html += `<h3 class="sheet-group">Games<small>${games.length}</small></h3><ul class="sheet-rows">${games.map((p) => gameRow(p, '', lit(p.name, q))).join('')}</ul>`;
    sheet.body.innerHTML = html || `<p class="sheet-empty">Nothing matches “${esc(q)}”.</p>`;
  };
  sheet.body.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-z], [data-game]');
    if (!row || row.disabled) return;
    sheet.close();
    if (row.dataset.z) o.onAtom(Number(row.dataset.z)); else o.onGame(row.dataset.game!);
  });
  input.addEventListener('input', () => { paint(); sheet.body.scrollTop = 0; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sheet.body.querySelector<HTMLButtonElement>('[data-z], [data-game]:not(:disabled)')?.click();
  });
  paint();
  requestAnimationFrame(() => input.focus());
}
