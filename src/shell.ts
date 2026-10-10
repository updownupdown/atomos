// The app shell: one header on every screen, and the hierarchy beneath it.
//   Gallery  — the maps of all 118 atoms.
//   Atom     — one atom, in View mode (the loupe) or Build mode (its puzzles).
//   Puzzles  — every puzzle type on its own, for playtesting. Temporary.
//   Settings — its own screen, the fourth section.
// On Atom screens a mode row sits under the header: View or Build, quick details, the microscope.

import { GalleryApp } from './gallery';
import type { Game } from './game';
import type { Playground } from './playground';
import { ELEMENTS } from './gallery/data';
import { onSettingsChange, renderSettings } from './ui/settings';
import { icon, type IconName } from './ui/icons';
import { setScienceHandler } from './ui/science';
import { markSvg } from './ui/mark';
import { initModeBar, setModeDefault, showModeBar, type AtomMode } from './ui/modebar';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type Screen = 'gallery' | 'atom' | 'puzzles' | 'settings';
export type { AtomMode };

export class AppShell {
  private screen: Screen = 'gallery';
  private mode: AtomMode = 'view';
  /** The atom the Atom tab shows; the last one looked at or built. */
  private z = 1;
  private gallery: GalleryApp;
  private game: Game | null = null;
  private playground: Playground | null = null;

  constructor() {
    this.gallery = new GalleryApp({
      onBuild: (z) => { this.z = z; void this.go('atom', 'build'); },
      onLoupe: (z) => {
        if (z !== null) this.setZ(z);
        if (this.screen === 'gallery' || this.screen === 'atom') this.setNav(z === null ? 'gallery' : 'atom', 'view');
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
    initModeBar((mode) => void this.go('atom', mode));
    onSettingsChange(() => {
      this.gallery.syncSettings();
      this.game?.reloadSettings();
    });
    this.setNav('gallery', 'view');
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
      this.game = new Game({ onElement: (z) => this.setZ(z) });
      this.z = want;
    }
    this.screen = screen;
    this.mode = screen === 'atom' ? mode : this.mode;
    this.setNav(screen, this.mode);

    // Put away whatever is not on screen. The screen that shows re-registers the microscope.
    setScienceHandler(null);
    const showGallery = screen === 'gallery' || (screen === 'atom' && mode === 'view');
    const showGame = screen === 'atom' && mode === 'build';
    const showPlay = screen === 'puzzles';
    const showSettings = screen === 'settings';
    if (!showGallery) this.gallery.hide();
    if (!showGame) { this.game?.pause(); $('app').hidden = true; }
    if (!showPlay) this.playground?.hide();
    $('settings-screen').hidden = !showSettings;
    if (screen === 'atom') setModeDefault(this.detail(), true);

    if (showGallery) {
      this.gallery.show();
      if (screen === 'atom') this.gallery.openAtom(this.z);
      else this.gallery.closeAtom();
    } else if (showGame) {
      $('app').hidden = false;
      // Switching View to Build on the same atom keeps the puzzle in progress.
      if (this.game!.currentZ !== this.z) this.game!.openElement(this.z);
      this.game!.resume();
    } else if (showPlay) {
      this.playground!.show();
    } else if (showSettings) {
      renderSettings($('settings-page'));
      $('settings-screen').scrollTop = 0;
    }
  }

  private setZ(z: number): void {
    this.z = z;
    if (this.screen === 'atom') setModeDefault(this.detail());
  }

  /** The mode row's default details: which atom this is. */
  private detail(): string {
    const e = ELEMENTS[this.z - 1];
    return e ? `<span class="mode-z">${e.z}</span><span class="mode-name">${e.name}</span>` : '';
  }

  private setNav(screen: Screen, mode: AtomMode): void {
    const on = (id: string, yes: boolean) => $(id).setAttribute('aria-current', yes ? 'page' : 'false');
    on('nav-gallery', screen === 'gallery');
    on('nav-atom', screen === 'atom');
    on('nav-puzzles', screen === 'puzzles');
    on('nav-settings', screen === 'settings');
    showModeBar(screen === 'atom', mode);
    document.body.dataset.screen = screen === 'atom' ? `atom-${mode}` : screen;
  }
}
