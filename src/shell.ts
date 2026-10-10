// The app shell: one header on every screen, and the hierarchy beneath it.
//   Gallery  — the maps of all 118 atoms.
//   Atom     — one atom, in View mode (the loupe) or Build mode (its puzzles).
//   Puzzles  — every puzzle type on its own, for playtesting. Temporary.
//   Settings — a sheet that opens over whatever is on screen.

import { GalleryApp } from './gallery';
import type { Game } from './game';
import type { Playground } from './playground';
import { onSettingsChange, openSettings } from './ui/settings';
import { icon } from './ui/icons';
import { setScienceHandler } from './ui/science';
import { markSvg } from './ui/mark';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type Screen = 'gallery' | 'atom' | 'puzzles';
export type AtomMode = 'view' | 'build';

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
        if (z !== null) this.z = z;
        if (this.screen === 'gallery' || this.screen === 'atom') this.setNav(z === null ? 'gallery' : 'atom', 'view');
      },
    });
    // Header: the mark (home) on the left, the three sections as icons in the middle, the
    // microscope and Settings on the right.
    $('nav-logo').innerHTML = `${markSvg()}<span class="nav-word">Atomos</span>`;
    $('nav-logo').onclick = () => void this.go('gallery');
    $('nav-gallery').innerHTML = icon('gallery');
    $('nav-atom').innerHTML = icon('atom');
    $('nav-puzzles').innerHTML = icon('puzzles');
    $('nav-science').innerHTML = icon('microscope');
    $('nav-gallery').onclick = () => void this.go('gallery');
    $('nav-atom').onclick = () => void this.go('atom', this.mode);
    $('nav-puzzles').onclick = () => void this.go('puzzles');
    $('nav-settings').innerHTML = icon('settings');
    $('nav-settings').onclick = () => openSettings();
    $('mode-view').onclick = () => void this.go('atom', 'view');
    $('mode-build').onclick = () => void this.go('atom', 'build');
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
      this.game = new Game({ onElement: (z) => { this.z = z; }, onView: (z) => { this.z = z; void this.go('atom', 'view'); } });
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
    if (!showGallery) this.gallery.hide();
    if (!showGame) { this.game?.pause(); $('app').hidden = true; }
    if (!showPlay) this.playground?.hide();

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
    }
  }

  private setNav(screen: Screen, mode: AtomMode): void {
    const on = (id: string, yes: boolean) => $(id).setAttribute('aria-current', yes ? 'page' : 'false');
    on('nav-gallery', screen === 'gallery');
    on('nav-atom', screen === 'atom');
    on('nav-puzzles', screen === 'puzzles');
    $('nav-mode').hidden = screen !== 'atom';
    $('mode-view').setAttribute('aria-pressed', String(mode === 'view'));
    $('mode-build').setAttribute('aria-pressed', String(mode === 'build'));
    document.body.dataset.screen = screen === 'atom' ? `atom-${mode}` : screen;
  }
}
