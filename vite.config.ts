import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// `npm run build:single` inlines everything into one HTML file, used for
// shareable previews. The normal build is what Capacitor will wrap, and it is
// also an installable web app: the service worker caches the whole build and
// picks up each new deploy on the next visit.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single'
    ? [viteSingleFile(), VitePWA({ disable: true })]
    : [
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg', 'icons/atomos.svg'],
          manifest: {
            name: 'Atomos',
            short_name: 'Atomos',
            description: 'Build atoms from light and probability.',
            theme_color: '#101112',
            background_color: '#101112',
            display: 'standalone',
            orientation: 'portrait',
            start_url: './',
            scope: './',
            icons: [
              { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          },
        }),
      ],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    // The normal build also ships the atom visualization lab (lab.html, src/lab/) beside the
    // app. The single-file build stays one page: index.html only.
    rolldownOptions: mode === 'single'
      ? {}
      : { input: { main: resolve(root, 'index.html'), lab: resolve(root, 'lab.html') } },
  },
}));
