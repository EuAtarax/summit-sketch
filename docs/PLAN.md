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

## Feature ideas (unscheduled, to discuss)

- [ ] **Jump to a peak by name.** Already works from the map: searching a peak (Nominatim) centers the map and opens it as a selectable summit (Phase 5). Possible extensions: search from inside the viewer to switch summit without going back, and "look toward" a peak: search a peak that is visible in the current panorama and turn the view to it (the label pipeline already knows its azimuth and angle).
- [ ] **Pitch / projection.** The panorama uses a cylindrical projection with vertical exaggeration (1 to 3 times), so it can look steep and close, and its height varies a lot between scenes (tall from a summit with deep valleys below, flat from a coast). Options, from cheap to costly:
  - Vertical "pitch" as a framing choice: cap the lowest shown angle and fit the exaggeration to the screen, so the view always fills it. Cheap, no new projection.
  - A rectilinear (perspective) rendering of the current view: reproject the cylindrical tiles onto a virtual pinhole camera with a settable pitch and field of view. The tile cache stays; only the final draw changes. Costs GPU or per-pixel work each frame and distorts the label and sun overlays, which then need the same mapping.
  - True camera tilt with real perspective belongs to the three.js renderer (Phase 7), where pitch is native.
  Recommendation: framing first (cheap), decide on rectilinear after seeing it.
- [ ] **"Can I see mountain A from B?"** and **"from where can I see A?"**
  - Point-to-point line of sight: sample the elevation profile between B and A, apply curvature and refraction (`k = 0.13`), report visible or blocked, the blocking point, and the clearance in meters and degrees. Pure math with tests on synthetic terrain; a search box for each end (Nominatim peak search) or a tap on the map.
  - List of peaks from which A can be seen: by reciprocity this is almost the peak list of A's own panorama, so it reuses the label pipeline (A as observer, all named OSM peaks visible from A). Differences to handle: eye height at B, and the summit tip of A versus a visible slope sample.
  - Areas from which A can be seen: a viewshed raster around A. Needs a new per-cell output from the ray cast (visible cells, not just crests), drawn as an overlay on the map picker. Cost is a full-disc scan at a coarse cell size; do it in the workers with progress.
  - Open questions: maximum distance (visibility of a 4000 m peak reaches 200 km and beyond), the eye height at B (2 m default, adjustable), and how to present thousands of peaks (ranked list, filter by distance and by how much of A is visible).

## Rendering quality (comparison with PeakFinder)
PeakFinder (peakfinder.com, the reference product) renders smoother and with more detail. Its own pages only say that an elevation model is integrated into the app (so it renders offline), that it shows atmospheric effects and Earth's curvature (a heritage of the ViewFinder software by Jonathan de Ferranti, who also supplies part of its DEM data), and that the web version adds shading, lakes and coastlines. The rest below is inference from that and from how our pipeline works, not from inspecting their output.

**Why ours looks different.** The horizon engine keeps only the visible crest of each ray (plus visible sea). Styles then draw polylines and painter's fills from those crests, so the surface between crests is flat: no slope shading, no gullies, no snow patches, no depth haze per pixel. That is a deliberate stylized design (compute once, render many), and it is why the panorama looks like a cutout even at high zoom. Two smaller factors: the global elevation data is coarser than a gap-filled regional DEM (10-30 m, with voids in some areas), and viewer tiles at fixed levels fade in as they render, which can feel less continuous than a per-frame render.

**Options.**
- [ ] **Shaded relief from the ray cast (recommended spike).** Generalize what the cast already does for sea: record, for every ray, the visible surface intervals (angle range, distance, elevation, and the terrain slope and aspect at the hit). That gives a per-column depth and normal profile, still computed once. A new "Shaded relief" style paints each pixel from it: Lambert shading from a light direction, distance haze (atmospheric perspective), snow by elevation and slope, sea, and the existing crest lines on top. Cost: a larger scene (more samples per ray), a finer azimuth step or interpolation between rays to avoid stair-steps at ridges, and a per-pixel renderer (a typed-array pass or a small WebGL shader; a fragment shader is likely needed to stay under the 50 ms budget). The spike measures scene size, quality at 0.1 and 0.05 degree steps, and frame time on a mid-range phone.
- [ ] **Terrain data.** Compare Terrarium tiles with a gap-filled DEM for the Alps (e.g. the ViewFinder/de Ferranti DEM, if its license and format allow static hosting), and check whether higher zooms near the observer help. Any alternative source stays behind the `ElevationSource` interface.
- [ ] **Continuity.** Render the visible tiles progressively at a lower level first (already partly done), keep the previous frame while the next renders, and avoid the fade.
- [ ] **Full 3D (Phase 7)** remains the route to real lighting, shadows and camera tilt; the shaded relief style is the cheaper step that keeps everything in the current 2D pipeline and export.

**Other PeakFinder features worth considering** (from its manual and site): a list of all visible peaks (we have labels; add a list view), marks (favorite, visited, home), an "altitude offset / fly up" control to see terrain hidden behind ranges (cheap: it is the observer eye height, recompute the scene), a telescope mode to label minor distant peaks, SVG export for printing and a horizon export for Stellarium, lakes and coastlines, sun and moon overlays (sun is Phase 5b), camera overlay with compass alignment (AR), and installable offline regions. Not copying their data or assets: our peak names and terrain stay on free, permissively licensed sources.

**Where we can be different:** the camp spot finder, GPX and hiking paths, the "can I see A from B, and from where can I see A" tools, and a free, account-free, installable PWA. PeakFinder's advantage is rendering realism, its gap-filled DEM and its peak database, so quality of the panorama is worth continued investment, but not at the price of the differentiators.

## GPX and hiking paths (idea)
Bring routes into the app, all client-side (no upload, no account).
- [ ] **Import GPX** by file picker and drag-and-drop, parsed with `DOMParser` (no dependency): tracks, routes and waypoints. Keep files local (IndexedDB), list and delete them. Simplify long tracks (Douglas-Peucker) for drawing.
- [ ] **On the map:** draw the track over the picker, fit the map to it, tap a point on the track to open the panorama from there. Elevation from the GPX when present, otherwise from the DEM.
- [ ] **In the panorama:** project the track into the view as an overlay (azimuth and elevation angle from the observer, hidden where the terrain hides it), so you can see where a route goes and what it climbs. Same overlay layer as labels and the sun path.
- [ ] **Along the route:** an elevation profile, and "what is visible from here" as a slider along the track (moves the observer along the route); optionally the list of peaks visible along the whole route.
- [ ] **Hiking paths from OSM:** as a map overlay, either raster tiles from Waymarked Trails (free, CC BY-SA, attribution; check the tile usage policy first) or vector paths from Overpass (`highway=path|footway|track`, `route=hiking` relations) for the area, cached like peaks. The vector data is also an input for the camp spot finder (distance to a trail).
- [ ] **Export:** the current selection or a drawn route as GPX, and the GPX overlay in exported images.
- [ ] Open questions: file size limits on phones, how to mark hidden stretches of a track, whether routes can be drawn in the app, and privacy wording (data never leaves the device).

## Current focus (decided)
The camping spot finder for Switzerland is the focus and the landing page of the site (`index.html`); the panorama app moved to `panorama.html`. The other phases below stay as backlog. Order of work: finish the camping examination (S3-S6), then make it solid on phones, then GPX and paths, then return to the panorama backlog (shaded relief, sun path).

## Camping spot finder (needs examination and planning first)
Find suitable places to camp in the wild: flat enough for a small 2-person tent, near a trail, with water and a good morning sun. Nothing here is built before the spike below.

**Decisions so far**
- **Other countries:** `docs/DATA-EUROPE.md` lists, per European country, whether browser-readable terrain, surface and protected-area data exist (surveyed 2026-09-30, re-check with `scripts/probe-elevation.mjs`).
- **Switzerland first, summer only** (Alps, no snow cover, glaciers or avalanche logic at first). Other countries later behind a provider interface.
- **Two ways in:** an area on the map (heatmap of suitability plus a ranked list) and, when a GPX track is provided, a corridor along it ("spots between km 12 and 18"). Public hiking paths are linked in the same way (see the GPX section).
- **Legal and protected areas are flagged, with a toggle** (show flags, and hide flagged spots). The app never states that a spot is legal or safe.
- **Drinking water sources** are a map layer of their own and an input to the ranking.
- **Test area:** Leuggelenstock and Ijenstock (spelled like this by swisstopo; GL, Glarus Sud, about 46.99 N, 9.03 E, near Schwanden GL). It has protected wildlife zones nearby, which exercises the flags.
- **Where it lives:** a separate module in this repo (`src/camping/`, own entry and map mode) reusing the map picker, tile cache and horizon engine; split into a second app only if it grows its own UX and content.

**What the Swiss data makes possible (checked from a browser, all CORS-open, free including commercial use, citation "© swisstopo")**
- **swissALTI3D**: 0.5 m and 2 m terrain model, one Cloud-Optimized GeoTIFF per 1 km tile in LV95 (EPSG:2056), found through the STAC API (`data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d`). A 2 m tile is 500 x 500 float32 (about 1.2 MB), tiled 128 x 128 with LZW compression, and range requests work, so a corridor along a track needs only the blocks it touches. At 2 m a 3 x 3 m pitch is about two cells, so the resolution problem of the global data (10-30 m) goes away here.
- **swissSURFACE3D** raster (0.5 m surface model, 2017): surface minus terrain gives a canopy and object height (trees, shrubs, boulders, huts).
- **Ground type from the terrain itself:** canopy height (forest, shrub) plus surface roughness of the 0.5 m terrain (blocky scree and rock are rough, meadow is smooth, tussocks and hollows show as small-scale relief). This replaces an external land-cover source for the first version; ESA WorldCover stays the global fallback.
- **Maps:** swisstopo WMTS tiles (`wmts.geo.admin.ch`: national map, aerial imagery, and the hiking-trail overlay `ch.swisstopo.swisstlm3d-wanderwege`) all send CORS headers, so they can be a map layer and an overlay.
- **Protected areas:** the BAFU layers through `api3.geo.admin.ch/rest/services/all/MapServer/identify` return attributes and geometry with CORS. Example: wildlife quiet zones (`ch.bafu.wrz-wildruhezonen_portal`) carry a protection period (e.g. 21.12.-30.04. or 01.04.-30.06.), the rule text and the canton, so flags can be season-aware. Other layers to add: hunting bans, floodplains, moors and moorland landscapes, the Swiss National Park (strict no-camping).
- **Trails and water:** OSM through Overpass (`highway=path|footway|track|bridleway`, `route=hiking`, `waterway`, `natural=water`) as the first source, since the infrastructure exists; whether the swisstopo trail layer returns usable vectors through `identify` is a spike question.
- **Drinking water:** OSM `amenity=drinking_water`, `natural=spring` (with `drinking_water=yes` where tagged), `man_made=water_tap`, fountains, and alpine huts (`tourism=alpine_hut`). Shown as a layer with distance to the spot. Wording matters: untreated spring and stream water can be unsafe (grazing upstream), so the layer says "verify and treat".

**How a spot is found (rule-based, explainable)**
1. **Hard filters:** local slope over the pitch (about 5 degrees ideal, 8 tolerable) at 2 m; not a hollow or a channel (curvature, flow accumulation) and not in reach of flooding (height above the nearest drainage); canopy height and roughness low enough for a pitch; not on rock, scree or wet ground; not below steep faces (rockfall reach) or in avalanche runout in early summer snow; below the snowline.
2. **Soft criteria:** distance off a trail (about 30-300 m, not on it), water distance (50-500 m, not on the shore), shelter versus exposure (topographic openness; avoid ridge tops for lightning and wind), aspect and morning sun, and the sunrise and sunset visibility from the spot, which our horizon engine and the sun path (Phase 5b) already compute. A drinking-water source within reach adds to the score.
3. **Presets** weight the criteria ("sheltered", "sunrise view", "near water", "close to trail").
4. **Output:** a heatmap layer on the map at about 10 m, ranked spots after non-maximum suppression (about 150 m apart), each with the reasons that drove its score and the flags that apply, and "show the view from here" opening the panorama.
5. **Refinement:** the 2 m grid finds zones; the 0.5 m grid re-checks the top candidates in a 100 x 100 m window, where the actual pitch can be resolved.

**Technical notes**
- The Swiss grids are metric (LV95), not Web Mercator tiles. The camping module gets its own grid source (windowed reads, range requests, block cache in IndexedDB) rather than reusing `ElevationSource`; it needs an LV95 <-> WGS84 conversion (swisstopo's approximate formulas, about 1 m, as pure functions with tests) and a small COG reader. Own reader (TIFF header, tile offsets, range fetch, LZW decode, roughly 200 lines, testable with a small committed fixture tile) instead of `geotiff.js`, to keep the bundle small; revisit if other compressions appear.
- Cost: a 5 x 5 km area at 2 m is 6.25 M cells (25 MB as float32): fine in a worker, but download-heavy (about 30 MB) on mobile data, so use range requests for corridors, show progress and cache aggressively.
- Side benefit for the panorama: in Switzerland the same 2 m data could sharpen the near field of the view (see Rendering quality).

**Examination (spike)**
- [x] S1: COG reader and LV95 conversion, with tests; read the Leuggelenstock/Ijenstock area.
- [x] S2: slope, curvature, roughness and canopy rasters at 2 m for a 4 x 4 km area; show them as an overlay on the map picker; check visually against the aerial imagery and the national map.
**Results of S1 and S2** (spike page `camping.html`, run with `npm run dev` and open `/summit-sketch/camping.html`; the page is a development tool, not part of the installed app):
- **Reader:** own COG reader (LZW decoder, range requests, LV95 conversion) with tests, including a real 128 x 128 swissALTI3D tile committed as a fixture (the decoded surface must be smooth and alpine, which random garbage would fail). Small files (the 1.2 MB 2 m tiles) are fetched whole in one request: firing dozens of parallel range requests made the browser drop connections and was far slower than the whole tile, which downloads in about 0.2 s. Requests are capped at 6 in flight overall and retried twice on network errors.
- **Speed:** a 2 x 2 km window at 2 m (1000 x 1000 cells) loads and analyses in about 1 s; a 1 x 1 km window with the 0.5 m surface model (vegetation height) takes about 3 s. The analysis currently runs on the main thread; it belongs in a worker before it is used in the app.
- **Registration:** the overlays line up with the national map and the aerial image (the LV95 grid is rotated about 1 degree against north here, so the overlay is resampled per output pixel). The slope layer lights up the flat basins Seeboden and Ruppenseeli exactly where the map shows them.
- **Vegetation height** (surface minus terrain) follows the tree line of the aerial image closely; meadows stay clear. This confirms that ground type can be derived from the swisstopo data itself.
- **Suitability in the test area** (Leuggelenstock and Ijenstock): only 1.2 % of cells (0.3 % with vegetation) fit a pitch. The area is mostly steep grass flanks and forest, so this is plausible, and the few candidates sit on the flat basins. The thresholds are a first guess and are not calibrated.
- **Roughness at 2 m** shows terraces and animal tracks on steep flanks as stripes and speckles even on meadow, so it separates smooth from very rough ground only coarsely. Boulders and scree need the 0.5 m terrain model, which the refinement step (a 100 x 100 m window around top candidates) should use. Calibrating the slope, roughness and vegetation thresholds is part of S5.
- **Other places to test:** a busier alpine valley with known bivouac spots (to check that real spots score well), and a flat alpine plateau.

**Landing page, first version (done):**
- Click (tap) a spot on the map to choose it; the analysis box is drawn and the analysis starts. Below zoom 12 a tap zooms in first. No need to move the map.
- The analysis runs in a Web Worker (about 1-1.5 s for 2 x 2 km, 3 s for 4 x 4 km); moving a slider re-scores instantly from the stored grids without a download.
- Options, all remembered: area size (0.5, 1, 2, 4 km), heatmap layer (suitability, slope, roughness, vegetation height, lakes and flat surfaces), colours (Green, Traffic light, Viridis, Magma, Blue), opacity, base map (national map, aerial image), overlays (hiking trails; wildlife quiet zones, game reserves, National Park, bird reserves, floodplains, moorland, bogs, fens, nature parks, as map layers from geo.admin.ch), and the pitch model.
- **Tune the pitch:** comfortable slope (default 5 degrees; ground is ruled out at twice that, so 10), bumpiness tolerance (0.3 m), tallest vegetation (3 m), flat patch around the spot (1 cell = 6 m), each with a short explanation and the recommended value, plus "Use recommended values".
- **Lakes are ruled out** (toggle, on by default): they are perfectly flat in the terrain model. Detection: a cell whose 10 m neighbourhood varies by less than 2 cm. Paved and levelled areas are caught too. A "Lakes and flat surfaces" layer shows what was excluded.
- Search (Nominatim, Switzerland only), "Use my location", and shareable links (`?lat=&lon=`); "See the panorama from here" opens `panorama.html` for the spot.
- On phones the panel folds away after an analysis and a chip at the bottom keeps the result and the legend in sight.
- Note: the overlays are visual map layers. Flagging each candidate spot by its protected areas (S4, through `identify`) is still to do; the layer for Swiss trail closures does not exist in the WMTS list, so it is not offered.

**Results of S3 and S4:**
- **One Overpass query per box** (trails, streams and lake outlines, drinking-water sources with their geometry), cached in IndexedDB for a week by a box rounded to 0.005 degrees. Busy servers are retried with backoff; a browser hides Overpass's 429/504 behind a network error, which is retried too. The endpoint is configurable (`VITE_OVERPASS_URL`), which is also where a mirror would go. From the development sandbox the Overpass hosts were unreachable (the proxy refuses the tunnel), so the OSM path was verified against a local fake server and unit tests; the real server is unverified from here.
- **Exact distances:** trails, water and drinking water are rasterized onto the 2 m grid and turned into distance maps with an exact Euclidean distance transform (tested against brute force).
- **Camp score** = terrain suitability x nearness to a trail (fading to a floor of 0.15 beyond twice the distance; ground within 8 m of a path is cut, since that is the path itself) x nearness to water (floor 0.5) x nearness to drinking water (floor 0.6). Each preference has a switch and a distance. An unreachable service never penalizes: unknown is not far. Drinking sources are markers (springs are worded "verify and treat").
- **Protected areas (S4):** one `identify` request for eight federal layers (wildlife quiet zones, game reserves, parks including the Swiss National Park, bird reserves, floodplains, moorland, bogs, fens) returns polygons; they are rasterized onto the grid. Each area knows its protection period; a winter refuge is "not in force" in summer, so it is shown but hides nothing, while areas in force cut the camp score (toggle, on by default). Regional nature parks and moorland landscapes (hundreds of km2, villages included, no camping rule of their own) are listed for information only and never hide ground; where areas overlap the strictest one is painted, so a wildlife zone shows through the park around it. The panel lists the areas in the box with their rule (as published, German) and season. The National Park has no queryable layer of its own, but the parks layer contains it (category SNP).
- **Ranked spots (part of S5):** the best cell of each 10 m block, best first, at least 150 m apart, shown as numbered markers and a list with slope, distances and the protected area each lies in.
- **Failure handling:** if OpenStreetMap or the protection service fails, the terrain result still arrives, with a plain-language warning; nothing else changes.
- **Still to do:** presets (sheltered, sunrise view), sunrise and sunset visibility per spot, calibration of the thresholds on real bivouac spots, cantonal rules (only federal inventories are flagged), and memory on phones at 4 x 4 km (about 130 MB of grids).

- [x] S3: trails, water and drinking water from OSM, with the trail-distance and water-distance rasters.
- [x] S4: protected-area flags from the BAFU layers with season awareness.
- [ ] S5: scoring, presets, heatmap and ranked spots; inspect the top spots on aerial imagery and against known camping and bivouac places in the area.
- [ ] S6: a GPX corridor over the same area.
- [ ] **Deliverable:** a short write-up in `docs/` with the measurements, the chosen approach or a no-go, phases with acceptance criteria, and open legal wording.
