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
- [ ] Tap a label to show name, elevation, and distance
- [ ] Export PNG of the full 360° (default 16 px/deg) and of the current view. Cap at 16 M pixels because of the iOS canvas limit.
- [ ] Exports include a small footer with summit name, coordinates, style, and attribution
- [ ] Mobile: share via the Web Share API with the file; desktop: download
- [ ] Stretch: SVG export for Pencil, Ink and Blueprint

## Phase 5: PWA + polish
- [ ] Installable PWA; runtime caching of terrain tiles (Cache API, ~200 MB budget with eviction)
- [ ] Place and peak search via Nominatim (submit only)
- [ ] Shareable URLs: `?lat=…&lon=…&style=…&r=…`
- [ ] Clear empty, loading, offline, and error states
- [ ] Map picker layer choice: **normal** (OSM standard), **terrain** (e.g. OpenTopoMap) and **satellite**. Only free sources whose terms allow this use (check the license first; e.g. EOX Sentinel-2 cloudless is non-commercial with attribution, Esri World Imagery has its own terms). Remember the choice, and show each layer's attribution.

## Phase 6: Remaining 2D styles
- [ ] Ink panorama, Watercolor, Retro poster, Blueprint, Synthwave

## Phase 7: Realistic 3D (separate renderer)
- [ ] three.js terrain from the same `ElevationSource`, as concentric LOD rings around the observer with coarser tiles farther out
- [ ] Curvature + refraction applied as vertex displacement
- [ ] Shader coloring by elevation, slope, and snowline, with distance haze and a sky gradient
- [ ] 360° via cube camera → equirectangular strip, feeding the same viewer and export
- [ ] Optional later: satellite imagery draped on the terrain, only if a free source with a compatible license is found (check the license first)

## Later (to discuss once Phases 1–7 are done)
- [ ] **Camping spot finder:** suggest somewhat flat spots, large enough for a small 2-person tent, on or next to a trail. Local camping laws are out of scope for a first version. Open questions: slope threshold and minimum flat area, resolution needed (the elevation data is ~5–30 m per pixel, which may be too coarse for a tent pitch), trail data from OSM (`highway=path|footway|track`), and how to present results on the map.
