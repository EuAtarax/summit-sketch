import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the site from /<repo>/. Override with BASE_PATH for other hosts.
const base = process.env.BASE_PATH ?? '/summit-sketch/';

/** Terrain tiles are ~80 KB each, so 2500 entries is about the 200 MB budget. */
const TERRAIN_TILE_ENTRIES = 2500;

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: 'index.html', spike: 'spike.html' },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // A plain script registers the worker: no workbox-window dependency in the app bundle.
      injectRegister: 'script',
      manifest: {
        name: 'Summit Sketch',
        short_name: 'Summit Sketch',
        description:
          'Pick a summit anywhere on Earth and see a stylized 360° panorama of everything visible from it.',
        theme_color: '#1F2A33',
        background_color: '#F4F6F7',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The app shell works offline; the debug spike page is not part of the app.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        globIgnores: ['**/spike*'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Elevation tiles never change for a given URL, so serve them from the cache first.
            // Requests come from Web Workers; the service worker intercepts those too.
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'terrain-tiles',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: TERRAIN_TILE_ENTRIES, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
});
