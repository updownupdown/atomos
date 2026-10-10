// Entry point: the app shell owns the header and every screen beneath it.

import '@fontsource-variable/outfit';
import { AppShell } from './shell';
import { registerSW } from 'virtual:pwa-register';
import { showSplash } from './ui/splash';

showSplash();
// Canvas text can't wait for CSS to pull the font in; ask for it up front.
void document.fonts?.load("16px 'Outfit Variable'");
const shell = new AppShell();

// Reachable from the console for prototyping and automated checks.
(window as unknown as { atomos: AppShell }).atomos = shell;
registerSW({ immediate: true });
