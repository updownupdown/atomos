// The app shell: one header on every screen, and the hierarchy beneath it.
//   Gallery  — the maps of all 118 atoms.
//   Atom     — one atom, in View mode (the loupe) or Build mode (its puzzles).
//   Practice — every puzzle type on its own, on any atom; it never builds atoms.
//   Settings — its own screen, the fourth section.
// On Atom screens a mode row sits under the header: View or Build, quick details, the microscope.

import { GalleryApp } from './gallery';
import type { Game } from './game';
import type { Playground } from './playground';
import { onSettingsChange, renderSettings } from './ui/settings';
import { renderIconPage } from './ui/iconpage';
import { renderComponentPage } from './ui/componentpage';
import { icon, type IconName } from './ui/icons';
import { setScienceHandler } from './ui/science';
import { markSvg } from './ui/mark';
import { initModeBar, refreshModeProgress, showModeBar, type AtomMode } from './ui/modebar';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

import { readPlace, type Screen } from './core/place';
import { setNavigator } from './core/next';
import { atomBuilt } from './core/progress';
import { loadSave } from './core/save';
export type { Screen };
export type { AtomMode };

const PLACE_KEY = 'atomos.place';

export class AppShell {
  private screen: Screen = 'gallery';
  private mode: AtomMode = 'view';
  /** The atom the Atom tab shows; the last one looked at or built. */
  private z = 1;
  private gallery: GalleryApp;
  private game: Game | null = null;
  private playground: Playground | null = null;

  constructor() {
    // Read where the player was before anything below records the gallery as the new place.
    let saved: string | null = null;
    try { saved = localStorage.getItem(PLACE_KEY); } catch { /* storage off: start at the gallery */ }
    this.gallery = new GalleryApp({
      onBuild: (z) => { this.z = z; void this.go('atom', 'build'); },
      onLoupe: (z) => {
        if (z !== null) this.setZ(z);
        if (this.screen === 'gallery' || this.screen === 'atom') this.setNav(z === null ? 'gallery' : 'atom', this.mode === 'info' ? 'info' : 'view');
      },
    });
    // Header: the mark (home) on the left, then the four sections, each an icon over its name.
    $('nav-logo').innerHTML = `${markSvg()}<span class="nav-word">Atomos</span>`;
    $('nav-logo').onclick = () => void this.go('gallery');
    const sections: [string, IconName, () => void][] = [
      ['nav-gallery', 'gallery', () => void this.go('gallery')],
      ['nav-atom', 'atom', () => void this.go('atom', this.mode)],
      ['nav-puzzles', 'puzzles', () => void this.go('puzzles')],
      ['nav-settings', 'settings', () => void this.go('settings')],
    ];
    for (const [id, ico, go] of sections) {
      $(id).querySelector('.nav-ico')!.innerHTML = icon(ico);
      $(id).onclick = go;
    }
    initModeBar((mode) => void this.go('atom', mode), () => this.z);
    onSettingsChange(() => {
      refreshModeProgress();
      this.gallery.syncSettings();
      this.game?.reloadSettings();
    });
    this.setNav('gallery', 'view');
    // The Next button anywhere opens its step; an atom opens in Build until it is built, then View.
    setNavigator({
      openStep: (step) => { this.z = step.z; void this.go('atom', 'build').then(() => this.game?.play(step.z, step.stage)); },
      openAtom: (z) => { this.z = z; void this.go('atom', atomBuilt(z) ? 'view' : 'build'); },
    });
    // The two library pages have addresses, so they can be linked and reloaded.
    const routed = () => (location.hash === '#icons' ? 'icons' : location.hash === '#components' ? 'components' : null);
    const route = () => { const r = routed(); if (r) void this.go(r); };
    window.addEventListener('hashchange', route);
    if (routed()) route();
    else this.restore(saved);
  }

  /** Where the app opens. A player who hasn't built anything yet starts on hydrogen's Build
   *  page; everyone else lands on the Gallery, where Up next says what to do. The Atom tab still
   *  remembers the last atom and mode. */
  private restore(raw: string | null): void {
    const save = loadSave();
    if (!Object.keys(save.built).length && !Object.keys(save.steps).length) {
      this.z = 1;
      this.go('atom', 'build').catch(() => void this.go('gallery'));
      return;
    }
    const place = readPlace(raw);
    this.z = place.z;
    this.mode = place.mode;
  }

  private remember(screen: Screen, mode: AtomMode): void {
    try { localStorage.setItem(PLACE_KEY, JSON.stringify({ screen, mode, z: this.z })); } catch { /* not remembered */ }
  }

  get atomZ(): number { return this.z; }
  /** The build screen, once it has been opened; for console checks. */
  get build(): Game | null { return this.game; }

  async go(screen: Screen, mode: AtomMode = this.mode): Promise<void> {
    if (screen === 'puzzles' && !this.playground) {
      const { Playground } = await import('./playground');
      this.playground = new Playground();
    }
    if (screen === 'atom' && mode === 'build' && !this.game) {
      const { Game } = await import('./game');
      const want = this.z;
      this.game = new Game({ onElement: (z) => this.setZ(z), onView: (z) => { this.setZ(z); void this.go('atom', 'view'); } });
      this.z = want;
    }
    this.screen = screen;
    this.mode = screen === 'atom' ? mode : this.mode;
    this.setNav(screen, this.mode);

    // Put away whatever is not on screen. The screen that shows re-registers the microscope.
    setScienceHandler(null);
    const showGallery = screen === 'gallery' || (screen === 'atom' && mode !== 'build');
    const showGame = screen === 'atom' && mode === 'build';
    const showPlay = screen === 'puzzles';
    const showSettings = screen === 'settings';
    const showIcons = screen === 'icons';
    const showComponents = screen === 'components';
    if (!showGallery) this.gallery.hide();
    if (!showGame) { this.game?.pause(); $('app').hidden = true; }
    if (!showPlay) this.playground?.hide();
    $('settings-screen').hidden = !showSettings;
    $('icons-screen').hidden = !showIcons;
    $('components-screen').hidden = !showComponents;
    // The library pages are the screens with an address; leaving one drops it.
    if ((!showIcons && location.hash === '#icons') || (!showComponents && location.hash === '#components')) history.replaceState(null, '', location.pathname + location.search);

    if (showGallery) {
      this.gallery.show();
      if (screen === 'atom') this.gallery.openAtom(this.z, mode === 'info' ? 'info' : 'view');
      else this.gallery.closeAtom();
    } else if (showGame) {
      $('app').hidden = false;
      // Switching View to Build on the same atom keeps the puzzle in progress.
      if (this.game!.currentZ !== this.z) this.game!.openElement(this.z);
      this.game!.resume();
    } else if (showPlay) {
      this.playground!.show();
    } else if (showComponents) {
      renderComponentPage($('component-page'), () => void this.go('gallery'));
      $('components-screen').scrollTop = 0;
    } else if (showIcons) {
      renderIconPage($('icon-page'), () => void this.go('gallery'));
      $('icons-screen').scrollTop = 0;
    } else if (showSettings) {
      renderSettings($('settings-page'));
      $('settings-screen').scrollTop = 0;
    }
  }

  private setZ(z: number): void {
    this.z = z;
    if (this.screen === 'atom') refreshModeProgress();
    if (document.body.dataset.screen?.startsWith('atom')) this.remember('atom', this.mode);
  }


  private setNav(screen: Screen, mode: AtomMode): void {
    const on = (id: string, yes: boolean) => $(id).setAttribute('aria-current', yes ? 'page' : 'false');
    on('nav-gallery', screen === 'gallery');
    on('nav-atom', screen === 'atom');
    on('nav-puzzles', screen === 'puzzles');
    on('nav-settings', screen === 'settings');
    showModeBar(screen === 'atom', mode);
    document.body.dataset.screen = screen === 'atom' ? `atom-${mode}` : screen;
    this.remember(screen, mode);
  }
}
