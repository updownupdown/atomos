// Entry point: the app shell owns the header and every screen beneath it.

import { AppShell } from './shell';
import { registerSW } from 'virtual:pwa-register';

const shell = new AppShell();

// Reachable from the console for prototyping and automated checks.
(window as unknown as { atomos: AppShell }).atomos = shell;
registerSW({ immediate: true });
