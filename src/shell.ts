// The app shell: the screen's name at the top, the sections in a dock at the foot, and the
// hierarchy beneath them.
//   Atlas    — every atom to admire and look up: the maps, Details and atom pages ('gallery').
//   Collect  — one period's atoms and how far each is collected; home.
//     Atom   — one atom, in View mode (the loupe), Build mode (its puzzles) or Info, opened
//              from Collect (or the Atlas); the header marks Collect while it is open.
//   Puzzles  — every puzzle type on its own, on any atom; it never builds atoms.
//   Settings — its own screen, the fourth section.
// Atom screens have no title or dock: the atom bar is their top (back, the element, before and
// after) and the View / Build / Info bar floats at the foot.

import { GalleryApp } from './gallery';
import { Collect } from './gallery/collect';
import { closeAtomList, createListToggle, type ListToggle } from './gallery/atomlist';
import type { Game } from './game';
import type { Playground } from './playground';
import { onSettingsChange, renderSettings } from './ui/settings';
import { renderIconPage } from './ui/iconpage';
import { renderComponentPage } from './ui/componentpage';
import { icon, type IconName } from './ui/icons';
import { setScienceHandler } from './ui/science';
import { markSvg } from './ui/mark';
import { initModeBar, MODES, refreshModeProgress, showModeBar, type AtomMode } from './ui/modebar';
import { reducedMotion } from './ui/nu';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

import { readPlace, type Screen } from './core/place';
import { setNavigator } from './core/next';
import { loadSave } from './core/save';
export type { Screen };
export type { AtomMode };

const PLACE_KEY = 'atomos.place';

/** Each screen's name, at the top in the wordmark's style. */
const TITLES: Record<Screen, string> = {
  gallery: 'Atlas', collect: 'Collect', atom: '', puzzles: 'Puzzles', settings: 'Settings', icons: 'Icons', components: 'Components',
};

export class AppShell {
  private screen: Screen = 'collect';
  private mode: AtomMode = 'view';
  /** The atom the Atom tab shows; the last one looked at or built. */
  private z = 1;
  private gallery: GalleryApp;
  private collect: Collect;
  private game: Game | null = null;
  private playground: Playground | null = null;

  constructor() {
    // Read where the player was before anything below records the gallery as the new place.
    let saved: string | null = null;
    try { saved = localStorage.getItem(PLACE_KEY); } catch { /* storage off: start at the gallery */ }
    this.gallery = new GalleryApp({
      onBuild: (z) => { this.z = z; void this.go('atom', 'build'); },
      onLoupe: (z) => {
        if (z !== null) {
          this.setZ(z);
          // An atom opened over the Atlas is the Atom screen now.
          if (this.screen === 'gallery') this.atomFrom = 'gallery';
          if (this.screen === 'gallery' || this.screen === 'atom') { this.screen = 'atom'; this.setNav('atom', this.mode === 'info' ? 'info' : 'view'); }
        } else if (this.screen === 'atom') {
          // Closed from inside (Escape): back where it was opened, Collect on this atom or the Atlas.
          this.closeAtom();
        }
      },
      // Leaving View's full screen goes back to Build.
      onLeaveView: () => { if (this.screen === 'atom' && this.mode === 'view') void this.go('atom', 'build'); },
    });
    this.collect = new Collect($('collect-screen'), { onOpen: (z) => { this.z = z; void this.go('atom', 'build'); } });
    // The atom bar's Back button: where the atom was opened, Collect or the Atlas.
    document.addEventListener('atomos:collect', () => this.closeAtom());
    // Escape on the Build page: back where the atom was opened.
    document.addEventListener('atomos:close-atom', () => this.closeAtom());
    // Top: the mark (home), then the screen's name. The dock: the four sections, each an icon
    // over its name.
    $('nav-logo').innerHTML = markSvg();
    $('nav-logo').onclick = () => void this.go('collect');
    const sections: [string, IconName, () => void][] = [
      ['nav-collect', 'collect', () => void this.go('collect')],
      ['nav-puzzles', 'puzzles', () => void this.go('puzzles')],
      ['nav-gallery', 'atlas', () => void this.go('gallery')],
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
    this.setNav('collect', 'view');
    // The Next button anywhere opens its step; an atom opens in Build.
    setNavigator({
      openStep: (step) => { this.z = step.z; void this.go('atom', 'build').then(() => this.game?.play(step.z, step.stage)); },
      openAtom: (z) => { this.z = z; void this.go('atom', 'build'); },
    });
    // The two library pages have addresses, so they can be linked and reloaded.
    const routed = () => (location.hash === '#icons' ? 'icons' : location.hash === '#components' ? 'components' : null);
    // Off a library page's address (Back from it): back to Settings, where its link is.
    const route = () => { const r = routed(); if (r) void this.go(r); else if (this.screen === 'icons' || this.screen === 'components') void this.go('settings'); };
    window.addEventListener('hashchange', route);
    if (routed()) route();
    else this.restore(saved);
    this.watchBack();
  }

  /** The system's Back (Android's back gesture, the browser's Back button) steps back through
   *  the app the way the on-screen Back and Escape do, instead of leaving it: one history entry
   *  stands above home whenever the player is anywhere else (another screen, a puzzle, a sheet
   *  over Collect). Popping it takes one step back and, if that isn't home yet, puts the entry
   *  back. At home, with nothing open, Back leaves the app as usual. */
  private watchBack(): void {
    let dropping = false;
    const armed = () => (history.state as { atomos?: number } | null)?.atomos === 1;
    // A library page's address coming or going is the hash's own navigation, not a step back.
    let hash = location.hash;
    const sync = () => {
      hash = location.hash;
      if (dropping) return;
      if (!this.atHome()) { if (!armed()) history.pushState({ atomos: 1 }, ''); }
      else if (armed()) { dropping = true; history.back(); }
    };
    window.addEventListener('popstate', () => {
      if (dropping) { dropping = false; return; }
      if (location.hash !== hash) { hash = location.hash; return; }
      this.stepBack();
      // The step may take a moment (a screen loading, a sheet fading): re-arm after it.
      window.setTimeout(sync, 300);
    });
    this.syncBack = () => window.setTimeout(sync, 0);
    // Sheets, dialogs and the win sheet come and go from anywhere.
    new MutationObserver(() => this.syncBack()).observe(document.body, { childList: true });
    new MutationObserver(() => this.syncBack()).observe($('modal'), { attributes: true, attributeFilter: ['hidden'] });
    this.syncBack();
  }

  private syncBack: () => void = () => {};

  /** Something sits over the screen that Escape closes: a sheet, a dialog, a drawer, the win
   *  sheet or a gate puzzle. */
  private overlayOpen(): boolean {
    return !$('modal').hidden || Boolean(document.querySelector('.win, .ui-confirm, .ui-drawer, .unlock-screen, .alist-scrim'));
  }

  private atHome(): boolean {
    return this.screen === 'collect' && !this.overlayOpen();
  }

  /** One step back, as the on-screen Back would take it. */
  private stepBack(): void {
    const escape = () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
    // Whatever is open closes first; a puzzle goes back to its list or Build page; an atom's
    // View or Info closes to where it was opened (the gallery answers Escape for those).
    if (this.overlayOpen()) return escape();
    if (this.screen === 'atom' && (this.mode !== 'build' || this.game?.inPuzzle)) return escape();
    if (this.screen === 'puzzles' && this.playground?.inPuzzle) return escape();
    if (this.screen === 'icons' || this.screen === 'components') { void this.go('settings'); return; }
    if (this.screen === 'atom') return this.closeAtom();
    if (this.screen !== 'collect') void this.go('collect');
  }

  /** Where an atom was opened from: the Atlas, or Collect (anything else). Back, Escape and the
   *  atom bar's Back button return there. */
  private atomFrom: 'gallery' | 'collect' = 'collect';

  private closeAtom(): void {
    void this.go(this.atomFrom);
  }

  /** Where the app opens. A player who hasn't built anything yet starts on hydrogen's Build
   *  page; everyone else lands on Collect, on the Up next atom's period, where Up next says what
   *  to do. The last atom and mode are remembered. */
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
    void this.go('collect');
  }

  private remember(screen: Screen, mode: AtomMode): void {
    try { localStorage.setItem(PLACE_KEY, JSON.stringify({ screen, mode, z: this.z })); } catch { /* not remembered */ }
  }

  get atomZ(): number { return this.z; }
  /** The build screen, once it has been opened; for console checks. */
  get build(): Game | null { return this.game; }

  /** Go to a screen. Between an atom's modes the page slides sideways (a view transition,
   *  where the browser has one and motion is on); anything else switches at once. */
  async go(screen: Screen, mode: AtomMode = this.mode): Promise<void> {
    // View opens over Build full screen, so only Build and Info slide.
    const stepping = this.screen === 'atom' && screen === 'atom' && mode !== this.mode && MODES.includes(mode) && MODES.includes(this.mode);
    const doc = document as Document & { startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> } };
    if (!stepping || !doc.startViewTransition || reducedMotion()) return this.show(screen, mode);
    // View, Build and Info sit side by side: the page slides toward the mode picked. Build loads
    // first, so the old page isn't held while it does.
    if (mode === 'build') await this.loadGame();
    const root = document.documentElement;
    const dir = MODES.indexOf(mode) > MODES.indexOf(this.mode) ? 'next' : 'prev';
    root.dataset.vt = dir;
    const t = doc.startViewTransition(() => this.show(screen, mode));
    await t.finished.catch(() => undefined);
    // A quicker swipe may have started the next slide already; leave its direction be.
    if (root.dataset.vt === dir) delete root.dataset.vt;
  }

  private async loadGame(): Promise<void> {
    if (this.game) return;
    const { Game } = await import('./game');
    const want = this.z;
    this.game = new Game({ onElement: (z) => this.setZ(z), onView: (z) => { this.setZ(z); void this.go('atom', 'view'); }, onInfo: (z) => { this.setZ(z); void this.go('atom', 'info'); } });
    this.z = want;
  }

  private async show(screen: Screen, mode: AtomMode): Promise<void> {
    if (screen === 'puzzles' && !this.playground) {
      const { Playground } = await import('./playground');
      this.playground = new Playground();
    }
    if (screen === 'atom' && mode === 'build') await this.loadGame();
    // Back to Collect from an atom: on that atom's period, centered on it.
    const fromAtom = this.screen === 'atom';
    if (screen === 'atom' && this.screen !== 'atom') this.atomFrom = this.screen === 'gallery' ? 'gallery' : 'collect';
    this.screen = screen;
    this.mode = screen === 'atom' ? mode : this.mode;
    this.setNav(screen, this.mode);

    // Put away whatever is not on screen. The screen that shows re-registers the microscope.
    setScienceHandler(null);
    const showGallery = screen === 'gallery' || (screen === 'atom' && mode !== 'build');
    const showGame = screen === 'atom' && mode === 'build';
    const showCollect = screen === 'collect';
    const showPlay = screen === 'puzzles';
    const showSettings = screen === 'settings';
    const showIcons = screen === 'icons';
    const showComponents = screen === 'components';
    if (!showGallery) this.gallery.hide();
    if (!showGame) { this.game?.pause(); $('app').hidden = true; }
    if (!showCollect) this.collect.hide();
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
    } else if (showCollect) {
      this.collect.show(fromAtom ? this.z : null);
    } else if (showPlay) {
      this.playground!.show();
    } else if (showComponents) {
      renderComponentPage($('component-page'), () => void this.go('settings'));
      $('components-screen').scrollTop = 0;
    } else if (showIcons) {
      renderIconPage($('icon-page'), () => void this.go('settings'));
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


  /** At the right of the title on Collect: the collection button, how much of the table is
   *  built, which opens the list of every atom (atomlist.ts). */
  private listToggle: ListToggle | null = null;
  private paintAside(screen: Screen): void {
    const aside = $('nav-aside');
    aside.hidden = screen !== 'collect';
    if (aside.hidden) return;
    if (!this.listToggle) {
      this.listToggle = createListToggle({ current: () => this.collect.state.z, onPick: (z) => this.collect.focus(z) });
      aside.replaceChildren(this.listToggle.el);
    }
    this.listToggle.refresh();
  }

  private setNav(screen: Screen, mode: AtomMode): void {
    closeAtomList();
    const on = (id: string, yes: boolean) => $(id).setAttribute('aria-current', yes ? 'page' : 'false');
    on('nav-gallery', screen === 'gallery');
    on('nav-collect', screen === 'collect' || screen === 'atom');
    on('nav-puzzles', screen === 'puzzles');
    on('nav-settings', screen === 'settings');
    showModeBar(screen === 'atom', mode);
    $('nav-title').textContent = TITLES[screen];
    this.paintAside(screen);
    document.body.dataset.screen = screen === 'atom' ? `atom-${mode}` : screen;
    this.remember(screen, mode);
    this.syncBack();
  }
}
