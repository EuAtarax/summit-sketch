# Summit Sketch (working name)

A free, mobile-first browser app (PWA) with two tools.

- **Camping spot finder (the landing page, `index.html`, Switzerland only for now).** The user taps a spot on a swisstopo map and gets a heatmap of pitchable ground from 2 m terrain data, with tunable thresholds, hiking trails and protected-area overlays. Code in `src/camping/`. This is the current focus.
- **Panorama (`panorama.html`, worldwide).** The user picks a summit anywhere on Earth and gets a stylized 360° panorama of everything visible from there, with several visual styles, optional peak labels, and export as an image.

Read `docs/PLAN.md` (phases and acceptance criteria) and `docs/STYLES.md` (style specs) before starting any phase.

## Hard constraints

- **Free to run.** The app is static hosting only: no backend, no API keys, and no services that need a billing account. Do not use Google Maps, Google 3D Tiles, Mapbox, or anything with paid tiers.
- **All computation happens client-side**, in the user's browser.
- **Mobile-first.** The app must stay responsive on a mid-range phone. Heavy work runs in Web Workers, and the main thread never blocks for more than ~50 ms.
- **Worldwide coverage for the panorama.** Never hardcode anything to the Alps there. The camping finder is Switzerland-only on purpose (it needs swisstopo's 2 m terrain and BAFU data); keep its data providers behind interfaces so other countries can follow.
- **Respect data providers.** Follow their usage policies, cache aggressively, and show attribution in the app and on every exported image.

## Stack

- Vite + TypeScript (strict mode), with no UI framework (vanilla TS with small modules)
- Leaflet for the map picker, using OpenStreetMap raster tiles
- Canvas 2D for all 2D styles
- Vitest for unit tests
- `vite-plugin-pwa` from Phase 5 onward
- three.js in Phase 7 only
- Self-hosted fonts via `@fontsource` so they work offline

Keep dependencies minimal. Ask before adding any dependency larger than ~50 kB gzipped.

## Data sources

| Purpose | Source | Notes |
|---|---|---|
| Elevation | AWS Terrain Tiles, Terrarium format: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | 256 px tiles, max zoom 15, global. Decode: `elev_m = (R*256 + G + B/256) - 32768`. Attribution per the tilezen/joerd attribution docs. **Verify availability + CORS in Phase 1 before building on it.** Keep the source behind an interface so it can be swapped. |
| Peak names | OSM via Overpass API (`https://overpass-api.de/api/interpreter`) | Query only `node["natural"="peak"]["name"]`. Shared public server: one request per panorama, cache results, back off on 429. |
| Place search | Nominatim | Max 1 request/s. Search on submit only, never on each keystroke. |
| Map picker tiles | OpenStreetMap standard tiles, OpenTopoMap (terrain), EOX Sentinel-2 cloudless (satellite) | Light use with attribution is fine. Providers live in `ui/mapConfig.ts`. EOX is CC BY-NC-SA 4.0: the app must stay non-commercial. |
| Swiss terrain and maps (camping finder, Switzerland only) | swisstopo: swissALTI3D and swissSURFACE3D Cloud-Optimized GeoTIFFs via the STAC API (`data.geo.admin.ch`), WMTS tiles (`wmts.geo.admin.ch`), BAFU layers via `api3.geo.admin.ch` | Open Government Data: free including commercial use, source "© swisstopo" required. All CORS-open. Read with range requests or whole small files, in LV95 (`camping/lv95.ts`). |

Attribution line (app footer and exports): "Elevation: Terrain Tiles (Mapzen/AWS, see sources) · Map data © OpenStreetMap contributors".

## Architecture

```
src/
  geo/        tile math, geodesy (destination point, distance), pure functions
  terrain/    ElevationSource interface, TerrariumSource, SyntheticSource (tests), tile cache
  horizon/    worker entry, ray casting, crest extraction, ridge linking → PanoramaScene
  peaks/      Overpass fetch (one query per panorama), peak visibility, ranking
  render/     ViewTransform (projection), style registry, styles/*, shared noise/brush utils
  ui/         map picker, summit sheet, panorama viewer, style picker, export
  search/     Nominatim client (submit-only, throttled)
  camping/    Switzerland camping finder: COG reader, LV95, slope/roughness/vegetation analysis,
              suitability model, heatmap, overlays, settings, analysis worker, page (main.ts)
```

Pages: `index.html` (camping finder, landing), `panorama.html` (panorama app), `spike.html` (data spike, not in the offline cache), `camping.html` (redirects to the landing page).

**Compute once, render many.** The horizon engine produces one `PanoramaScene`. Styles are pure renderers of that scene, so switching style never recomputes terrain.

```ts
interface RidgePoint { az: number; angle: number; dist: number; elev: number } // deg, deg, m, m
interface Ridgeline  { points: RidgePoint[]; minDist: number; maxDist: number }
interface PanoramaScene {
  observer: { lat: number; lon: number; groundElev: number; eyeHeight: number; name?: string };
  azStep: number;             // degrees between rays, e.g. 0.1
  radiusM: number;
  horizonAngle: Float32Array; // outermost visible angle per ray
  horizonDist: Float32Array;  // distance of that outermost visible crest per ray
  ridgelines: Ridgeline[];    // all visible crests, linked across rays
  sea: { offsets: Uint32Array; lo: Float32Array; hi: Float32Array;   // visible open-sea angle intervals per ray
         loDist: Float32Array; hiDist: Float32Array };                // near/far distance of each interval
}
interface ViewTransform {
  width: number; height: number;
  azStart: number;            // azimuth at x = 0 (wraps)
  pxPerDeg: number;
  exaggeration: number;       // vertical scale factor, 1 = true angles
  angleAtTop: number;
  azToX(az: number): number;
  angleToY(angle: number): number;
}
interface PanoramaStyle {
  id: string; name: string;
  paper(opts): string;         // sky above the rendered content
  ground(opts): string;        // ground below the rendered content
  uses: ('snowline' | 'palette')[]; // options it reacts to (cache keys, thumbnails)
  labelStyle: LabelStyle;      // font, colors, leader line, chip (see STYLES.md)
  render(ctx: CanvasRenderingContext2D, scene: PanoramaScene, view: ViewTransform,
         opts: { seed: number; snowlineM: number; palette: 'dawn' | 'day' | 'dusk';
                 labels?: readonly LabeledPeak[] | null }): void;
}
// Styles may be asked to draw any slice (the viewer renders tiles): derive all geometry
// and randomness from absolute azimuth/angle so adjacent tiles and the 0°/360° seam agree.
// Labels are placed outside the style, once per (style, zoom level, exaggeration), in absolute
// az/angle space with a box offset in px; the style calls drawPeakLabels(...) last.
```

## Core math (keep in `geo/` and `horizon/`, with unit tests)

- Earth radius `R = 6_371_000 m`, refraction coefficient `k = 0.13`.
- Apparent drop of a target at distance `d`: `drop = d² / (2R) · (1 − k)`. Test value: d = 100 km gives ≈ 682.8 m.
- Elevation angle: `angle = atan2(h_target − drop − h_observer, d)`, in degrees.
- Observer height = snapped summit ground elevation + eye height (default 2 m). If the user picked a named OSM peak with an `ele` tag, prefer that tag over the DEM value, because the DEM blunts summits.
- **Summit snap:** after a tap, search a ~150 m radius for the highest DEM cell and use it as the observer.
- Destination point along a bearing uses the spherical formula. Web Mercator tile math is the standard slippy-map formula. Meters per pixel = `156543.03 · cos(lat) / 2^z`.
- **Zoom by distance:** z12 for 0–20 km, z11 for 20–60 km, z10 for 60–150 km, z9 beyond. Make these bands configurable.
- **Sample step** ≈ half the pixel size of the zoom used at that distance. Use bilinear interpolation.
- **Crest extraction per ray:** walk outward and track the running max angle. A sample is visible if its angle exceeds the running max. When the ray goes from visible to hidden, record the previous sample as a crest.
- **Ridge linking:** connect a crest on ray `i` to a crest on ray `i+1` when the relative distance difference is < 6% and the angle difference is < 0.3°. Handle the 0°/360° wrap. Drop ridgelines spanning less than 0.5° of azimuth.
- **Parallelism:** split the azimuth range across `min(navigator.hardwareConcurrency, 4)` workers. Decode tiles inside the workers with `createImageBitmap` + `OffscreenCanvas`.

## Coding rules

- Math and data transforms are pure functions with Vitest tests. Tests never touch the network; they use `SyntheticSource`, e.g. a flat plane plus a cone of known height at a known distance.
- All randomness in renderers is seeded (seed derived from the observer coordinates), so the on-screen view and the export match exactly.
- User-facing errors say what happened and what to do next, e.g. "Couldn't load elevation data. Check your connection and try again."
- Work in small, reviewable steps and commit after each working step with a clear message.
- **At the end of every phase:** stop, summarize what changed, list exactly how to test it manually, and tick the boxes in `docs/PLAN.md`.

## UI direction

The panorama is the hero, and the UI chrome stays quiet around it. Ground the look in alpine trail signage and field notebooks.

- **Palette:** Snow `#F4F6F7`, Slate ink `#1F2A33`, Stone `#8A9199`, Glacier `#7FA7B8`, Trail red `#C8102E`. Trail red is the only accent, used for the primary action and the selected summit.
- **Type:** Atkinson Hyperlegible for the UI (readable in bright sunlight) and Barlow Condensed for peak labels (narrow, so more labels fit).
- **Flow:** A full-screen map opens with a search field on top. Tapping the map snaps to the nearest summit and opens a bottom sheet showing the name, elevation, and a "Show the view" button. The viewer is full-bleed, with a thin compass strip, and a bottom bar holds the style thumbnails, a labels toggle, and export.
- Use sentence case and plain verbs. Show a progress indicator with real stages: "Loading terrain 42/310", "Tracing ridges", "Drawing".
- Respect `prefers-reduced-motion`, keep focus states visible, and use touch targets ≥ 44 px.
