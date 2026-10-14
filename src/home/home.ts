// Home: where the app opens for a returning player, and the Home button in the dock. A jumping
// point to the three sections: Collect, Learn and Play, each under its own heading. This is the
// first, plain version; the Home page design (being mocked up) replaces what is inside, while
// the shell keeps mounting it here: renderHome(host, go) on every visit.
//
//   renderHome($('home-body'), (s) => shell.toSection(s));

import { loadSave } from '../core/save';
import { collectionProgress } from '../gallery/atomlist';
import { PUZZLES } from '../puzzles/catalog';
import { icon, type IconName } from '../ui/icons';
import './home.css';

export type HomeTarget = 'collect' | 'learn' | 'play';

const pct = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;

export function renderHome(host: HTMLElement, go: (to: HomeTarget) => void): void {
  const p = collectionProgress(loadSave());
  const games = PUZZLES.filter((g) => g.make).length;
  const block = (to: HomeTarget, title: string, ico: IconName, body: string, cta: string) =>
    `<section class="home-sec" aria-labelledby="home-h-${to}"><h2 class="home-h" id="home-h-${to}">${icon(ico, { size: 22 })}${title}</h2>`
    + `<div class="home-card">${body}<button type="button" class="home-go" data-go="${to}">${cta}${icon('chevron-right', { size: 20 })}</button></div></section>`;
  host.innerHTML = block('collect', 'Collect', 'collect',
    `<p class="home-big"><b>${p.built}</b> of ${p.atoms} atoms built</p>`
      + `<div class="home-trk"><span>Stable</span><i><b style="width:${pct(p.stable)}"></b></i><span>${pct(p.stable)}</span></div>`
      + `<div class="home-trk home-trk--thin"><span>Fleeting</span><i><b style="width:${pct(p.fleeting)}"></b></i><span>${pct(p.fleeting)}</span></div>`,
    'Open Collect')
    + block('learn', 'Learn', 'atlas', '<p>Every atom up close: the table in its many shapes, facts, isotopes and properties.</p>', 'Open Learn')
    + block('play', 'Play', 'puzzles', `<p>${games} games, each on its own, at any level.</p>`, 'Open Play');
  host.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go as HomeTarget); });
}
