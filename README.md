# Summit Sketch

A free, static, client-side web app (PWA) with two tools:

- **Camping spot finder** (`index.html`, the landing page; Switzerland, Liechtenstein, Austria and France): tap a spot on the map and get a heatmap of pitchable ground from 1-2 m terrain data, the best spots nearby, trails, water and drinking-water sources, protected areas, and the camping rules of the canton or Bundesland.
- **Panorama** (`panorama.html`, worldwide): a stylized 360 degree view of everything visible from a summit, with labels and image export.

Everything runs in the browser; there is no backend and no API key. See `docs/PLAN.md` for the plan and `CLAUDE.md` for the constraints.

## Run it

```
npm ci            # once
npm run dev       # dev server, open http://localhost:5173/summit-sketch/
```

- **What you see:** the camping finder. Tap the map (zoom in to 12 or more first), and after 1 to 3 seconds a heatmap, the three best spots and a list appear. The menu button (top left) opens the options in three tabs (Spots, Tune, Map); it starts closed and remembers your choice. The Trails and water sliders in the Tune tab are signed: plus prefers ground within that distance, minus prefers ground at least that far away, and 0 is off. A thin red bar along the top edge shows an analysis running, and a short notice next to the search field appears if the tapped spot lies in a federal protected area. Type 3 or more characters in the search field for place suggestions (swisstopo), hover the map on desktop to see the numbers behind a cell, and use the square above the zoom buttons to switch between map and aerial image. `http://localhost:5173/summit-sketch/panorama.html` opens the panorama app.
- **Other commands:** `npm test` (unit tests, no network), `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build` (production build into `dist/`, including the service worker), `npm run preview` (serve `dist/`).
- **Deploy:** pushing to `main` builds, tests and deploys to GitHub Pages (`.github/workflows`). Returning visitors get the new version after their service worker updates; the page reloads once by itself when that happens.

## Configuration

- `VITE_OVERPASS_URL`: replaces the public Overpass server (a mirror, or a local fake for browser tests), for example `VITE_OVERPASS_URL=http://localhost:8787/api npm run dev`.
- `BASE_PATH`: the URL base for the build (default `/summit-sketch/`).
- `VITE_BEV_PROXY_URL`: the proxy for Austria's elevation data (default `https://camp-spots.shitlas-trash.workers.dev`, see `proxy/README.md`).

## Data

Swiss terrain and maps: swisstopo (swissALTI3D, swissSURFACE3D, WMTS tiles), protected areas: FOEN (BAFU), all open government data (source "(c) swisstopo"). Austrian terrain: BEV ALS DTM and DSM (CC BY 4.0) through our proxy; aerial images basemap.at. French terrain and aerial images: IGN (Licence Ouverte). Protected areas outside Switzerland: EEA (Natura 2000, nationally designated areas). Base map outside Switzerland: OpenTopoMap. Hiking routes: Waymarked Trails. Country and region at a spot: geo.admin.ch, else Nominatim reverse. Which European countries could follow, and why: `docs/DATA-EUROPE.md`. Trails, water and drinking water: OpenStreetMap contributors via Overpass. Place search: Nominatim on submit, swisstopo SearchServer for type-ahead suggestions in the camping finder. Panorama elevation: AWS Terrain Tiles. Satellite layer of the panorama map picker: EOX Sentinel-2 cloudless (CC BY-NC-SA 4.0, so the app must stay non-commercial). Details and usage rules are in `CLAUDE.md`.
