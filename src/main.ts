// Entry point. The gallery is the home screen; the puzzle screen that unlocks
// an element is loaded on demand from the gallery's Build button and hands
// back when the player taps Gallery.

import { GalleryApp } from './gallery';
import type { Game } from './game';
import { registerSW } from 'virtual:pwa-register';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let game: Game | null = null;

const app = new GalleryApp({
  onBuild: async (z) => {
    if (!game) {
      const { Game } = await import('./game');
      game = new Game(() => {
        $('app').hidden = true;
        app.show();
      });
    }
    app.hide();
    $('app').hidden = false;
    game.openElement(z);
  },
});

// Reachable from the console for prototyping and automated checks.
(window as unknown as { atomosGallery: GalleryApp }).atomosGallery = app;
registerSW({ immediate: true });
