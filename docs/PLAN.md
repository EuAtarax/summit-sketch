# Build plan

Tick boxes as work completes. Each phase ends with a manual test checklist for Niklas.

## Phase 0: Setup
- [x] Vite + TS strict project, ESLint + Prettier, Vitest
- [x] Folder structure per CLAUDE.md
- [x] GitHub Actions deploy to GitHub Pages (or Cloudflare Pages), so the app is live from day one
- [x] Footer with data attribution

**Done when:** `npm test` passes and the deployed URL shows the empty shell on a phone.

## Phase 1: Horizon engine (the core, and the priority)
- [x] **Data spike:** fetch one Terrarium tile from the browser. Confirm CORS works and decode one known elevation. Report the result before continuing.
- [x] `geo/` tile math + geodesy with tests
- [x] `ElevationSource` interface, `TerrariumSource` with an in-memory LRU tile cache, and `SyntheticSource`
- [x] Summit snap (highest cell within ~150 m)
- [x] Ray casting with zoom-by-distance, curvature + refraction, and crest extraction
- [x] Ridge linking into `Ridgeline[]`
- [x] Web Workers split by azimuth, with progress messages
- [x] Radius selector: 100 / 200 / 300 km (default 200)
- [x] Debug renderer: plain lines colored by distance, plus the horizon line and a degree grid
- [x] Map picker (Leaflet): tap a point, snap, then compute

**Tests:** a synthetic cone at a known distance gives the expected angle ±0.01°; the curvature drop at 100 km ≈ 682.8 m; a cone hidden behind a taller nearer cone produces no crest.

**Manual validation:** compare the debug view with udeuschle.de or HeyWhatsThat for:
- Zugspitze (47.4211, 10.9853)
- Säntis (47.2494, 9.3433)
- Mt. Fuji (35.3606, 138.7274)

The horizon shape and the direction of major peaks should match.

**Performance targets:** 200 km in < 10 s on desktop and < 30 s on a mid-range phone; peak memory < 300 MB.

## Phase 2: Style system + first styles
- [x] `ViewTransform` (cylindrical projection, wrap-around, vertical exaggeration 1–3×, default auto-fit)
- [x] Style registry and a style picker with live thumbnails
- [x] Shared utilities: seeded RNG, 1D noise, a "wobbly stroke" brush, depth bands (log-scale by distance), snowline helper
- [x] Styles: **Pencil sketch**, **Misty layers**, **Cartoon** (see STYLES.md)

**Done when:** switching styles is instant (< 200 ms) with no recompute.

## Phase 3: Peak labels (toggle)
- [x] One Overpass query per panorama (bbox of the radius, named peaks only), cached by rounded observer coordinates
- [x] Visibility test: the peak's angle (from its OSM `ele`, falling back to the DEM) must be ≥ the running max angle along its azimuth up to 98% of its distance, minus a 0.05° tolerance
- [x] Label placement: rank by elevation and angular prominence, place greedily without overlaps, and draw leader lines to the summit point
- [x] Each style defines its own label look
- [x] Labels off by default; the toggle is remembered

**Implementation notes:** the running max at 98% of the peak's distance comes from the scene's visible crests (no re-cast), so a crest dropped by ridge linking cannot hide a peak. Peaks without `ele` get a DEM summit elevation (highest cell within 100 m, at the zoom the ray cast uses at that distance). Angular prominence is the summit angle minus the higher of the two sides' lowest crest at a similar distance within 6 degrees of azimuth. Labels add a sky band above the highest crest while on (about five rows), so toggling re-frames the horizon and rebuilds the tile cache.

## Phase 4: Viewer + export
- [x] 360° viewer: drag/swipe with inertia, wrap-around, pinch to zoom, compass strip with N/E/S/W and degree ticks
- [x] Tap a label to show name, elevation, and distance
- [x] Export PNG of the full 360° (default 16 px/deg) and of the current view. Cap at 16 M pixels because of the iOS canvas limit.
- [x] Exports include a small footer with summit name, coordinates, style, and attribution
- [x] Mobile: share via the Web Share API with the file; desktop: download
- [ ] Stretch: SVG export for Pencil, Ink and Blueprint

**Implementation notes:** a tap on a label opens a bottom card (name, elevation, distance, bearing) and highlights the label in trail red. Export renders 256 px strips into one canvas, yielding between strips, at 16 px/deg (lowered in 5 % steps until the image, footer included, fits 16 M pixels). The whole-panorama image starts at the azimuth that cuts the fewest labels (north if free). Label fonts scale with the footer text so they stay legible in large images. Touch devices share the file via the Web Share API, everything else downloads it.


## Phase 5: PWA + polish
- [x] Installable PWA; runtime caching of terrain tiles (Cache API, ~200 MB budget with eviction)
- [x] Place and peak search via Nominatim (submit only)
- [x] Shareable URLs: `?lat=…&lon=…&style=…&r=…`
- [x] Clear empty, loading, offline, and error states
- [x] Map picker layer choice: **normal** (OSM standard), **terrain** (e.g. OpenTopoMap) and **satellite**. Only free sources whose terms allow this use (check the license first; e.g. EOX Sentinel-2 cloudless is non-commercial with attribution, Esri World Imagery has its own terms). Remember the choice, and show each layer's attribution.

**Implementation notes:** `vite-plugin-pwa` (dev dependency only, script registration) precaches the app shell and caches elevation tiles CacheFirst, capped at 2500 entries (about 200 MB) with eviction on quota errors; verified offline in a real browser (a panorama opened before rebuilds offline). Map tiles are not cached by the service worker: cross-origin `<img>` tiles are opaque responses that count about 7 MB each against the quota, so the browser's HTTP cache handles them. Search runs on submit only, throttled to 1 request/s, cached and cancelable; a peak result opens as a summit, other places center the map. The link (lat, lon, r, style, labels) is always in the address bar; the viewer's Link button shares it (native sheet on touch devices, clipboard elsewhere). **Satellite license:** EOX Sentinel-2 cloudless is CC BY-NC-SA 4.0, non-commercial only, so the app must stay free with no ads or paid tier. Esri World Imagery was rejected (its terms expect an ArcGIS account for third-party apps). Overpass answers 429/504 without CORS headers, so the browser reports those as a network error; the client retries those with backoff.

## Phase 5b: Sun path
The sun's path across the panorama, for the chosen day, as an overlay. Pure math in `geo/` (or a new `sun/`), drawn like the compass strip and labels, so it needs no scene recompute.
- [ ] Sun position (azimuth, elevation) for a latitude, longitude and instant, as a pure function with tests against known values (e.g. noon altitude at an equinox equals 90 minus latitude; solstice declination 23.44 degrees). No dependency: a compact NOAA/Meeus-style formula is enough (well under 1 degree).
- [ ] Atmospheric refraction consistent with the horizon math (k = 0.13 for terrain; standard refraction of about 0.57 degrees for the sun at the horizon), and the sun's disc radius (0.27 degrees) for rise and set.
- [ ] Overlay in the viewer: the day's arc as a dotted line in absolute azimuth/angle space, hour ticks, the current position as a marker, sunrise and sunset markers. Drawn on top of the tiles (it changes with time, so it must not invalidate the tile cache).
- [ ] Time control: "Now" by default, a date picker and a time-of-day slider. Live update while the viewer is open.
- [ ] Terrain-aware: compare the sun's elevation with the skyline (`horizonAngle`) along its azimuth, so the app can say when the sun really rises and sets behind the terrain, and mark the stretches of the arc that are hidden behind ridges.
- [ ] A toggle (off by default, remembered), and an option to include the arc and the date in exports and in the export footer.
- [ ] Open question: time zone. The browser knows the device zone but not the zone of the summit, and a time zone database is a large dependency. Start with the device zone plus solar time, and revisit.

## Phase 6: Remaining 2D styles
- [ ] Ink panorama, Watercolor, Retro poster, Blueprint, Synthwave

## Phase 7: Realistic 3D (separate renderer)
- [ ] three.js terrain from the same `ElevationSource`, as concentric LOD rings around the observer with coarser tiles farther out
- [ ] Curvature + refraction applied as vertex displacement
- [ ] Shader coloring by elevation, slope, and snowline, with distance haze and a sky gradient
- [ ] 360° via cube camera → equirectangular strip, feeding the same viewer and export
- [ ] Optional later: satellite imagery draped on the terrain, only if a free source with a compatible license is found (check the license first)

## Camping spot finder (needs examination and planning first)
Find suitable places to camp in the wild: flat enough for a small 2-person tent, on or near a trail. This is not scheduled. It starts with an examination phase whose result decides whether and how to build it; nothing below is implemented before that decision.

**Where it lives (recommendation, to confirm after the examination):** start as a separate module in this repo (`src/camping/`, own entry point and map mode), reusing `geo/`, `terrain/` (the `ElevationSource` and tile cache), the map picker and the horizon engine. The panorama app stays focused. If the finder grows its own UX, data layers and legal content, split it into a second app in a workspace, sharing `geo/` and `terrain/` as packages. The strongest reason to stay close is the overlap: "will I get the sunrise from this spot?" and "what does the view look like?" are exactly what the horizon engine and the sun path answer.

**Examination (a spike, roughly one to two sessions):**
- [ ] **Terrain resolution.** Terrarium tiles reach z15 (about 5 m per pixel at the equator) but the underlying data is 10-30 m, so a tent pitch (about 3 x 3 m of gentle slope) is below what it can resolve. Measure it: compute slope statistics on known campsites (OSM `tourism=camp_site`, `camp_pitch`, known wild spots) against random terrain, and see whether slope alone separates them. Compare with national high-resolution open DEMs (e.g. swissALTI3D, IGN RGE ALTI, USGS 3DEP, 1-10 m) to quantify what is lost with a global source. Any regional source breaks "worldwide" and must stay optional, behind the `ElevationSource` interface.
- [ ] **Candidate criteria** and how to score them: slope (threshold and minimum contiguous flat area), distance to a trail (OSM `highway=path|footway|track`, 5-300 m), water nearby (`natural=water`, `waterway=*`, but not in a drainage bottom or a flood plain), exposure (wind, from topographic openness computed with the horizon code), and terrain hazards (below steep slopes and gullies: rockfall, avalanche runout, snow-covered ground above the snowline).
- [ ] **Views and light.** Sunrise and sunset visibility from the spot (depends on the sun path phase and the horizon engine), and view quality (openness, distance to the horizon).
- [ ] **Legal and safety data.** Local wild-camping law differs by country and even by valley, and it is out of scope to decide. Investigate what is freely available to at least flag conflicts (OSM `boundary=protected_area`, `leisure=nature_reserve`, `access=private`, `tourism=camp_site` nearby) and how to word a clear, honest disclaimer. The app must never present a spot as legal or safe.
- [ ] **Compute budget.** Area analysis reads many more tiles than a panorama. Estimate tiles and time for a 5 km and a 20 km search area on a mid-range phone, and decide the cell size, the worker split and the caching.
- [ ] **Presentation.** Heatmap layer on the map, ranked list of candidate spots with a why (slope, trail distance, sunrise), and "show the view from here" opening the panorama for that spot.
- [ ] **Deliverable:** a short write-up in `docs/` with the measurements, the chosen approach or a no-go, a phase breakdown with acceptance criteria, and the app-or-module decision.

