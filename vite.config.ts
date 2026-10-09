import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';

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
            theme_color: '#0c0b0a',
            background_color: '#0c0b0a',
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
            // Google Fonts: serve from cache once seen, so the typefaces survive offline.
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
                handler: 'StaleWhileRevalidate',
                options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
              },
            ],
          },
        }),
      ],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', target: 'es2022' },
}));
