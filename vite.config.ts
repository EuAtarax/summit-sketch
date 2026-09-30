import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the site from /<repo>/. Override with BASE_PATH for other hosts.
const base = process.env.BASE_PATH ?? '/summit-sketch/';

/** Terrain tiles are ~80 KB each, so 2500 entries is about the 200 MB budget. */
const TERRAIN_TILE_ENTRIES = 2500;
/** Swiss 2 m terrain tiles are 1.2 MB each: 150 is about 180 MB, six 4 x 4 km areas. */
const SWISS_TERRAIN_ENTRIES = 150;

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    rollupOptions: {
      // index.html is the camping finder (the landing page); the panorama app lives at
      // panorama.html; camping.html only redirects old links to the landing page.
      input: {
        main: 'index.html',
        panorama: 'panorama.html',
        spike: 'spike.html',
        camping: 'camping.html',
      },
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
          'Find flat, quiet places to camp in Switzerland, and see the 360° panorama from any summit.',
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
        globIgnores: ['**/spike*', '**/camping.html'],
        navigateFallback: `${base}index.html`,
        // Pages with their own document must not be answered with the landing page.
        navigateFallbackDenylist: [/\/spike\.html$/, /\/camping\.html$/, /\/panorama\.html$/],
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
          {
            // The camping finder's 2 m Swiss terrain (1.2 MB per 1 km tile, fetched whole with a
            // plain GET). swisstopo only allows 2 hours of HTTP caching, but a survey year's
            // file does not change, so keep it; a new survey gets a new URL.
            urlPattern:
              /^https:\/\/data\.geo\.admin\.ch\/ch\.swisstopo\.swissalti3d\/.+_2_2056_\d+\.tif$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'swiss-terrain-2m',
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: SWISS_TERRAIN_ENTRIES,
                maxAgeSeconds: 180 * 24 * 3600,
                purgeOnQuotaError: true,
              },
            },
          },
          {
            // Which tiles exist where: answer from the cache at once (offline too) and refresh it
            // in the background.
            urlPattern: /^https:\/\/data\.geo\.admin\.ch\/api\/stac\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'swiss-stac',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
});
