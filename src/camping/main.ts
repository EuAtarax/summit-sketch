import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '../ui/search.css';
import './camping.css';
import { NominatimClient } from '../search/nominatim';
import { SwisstopoSuggester } from '../search/swisstopo';
import { createSearchBar } from '../ui/searchBar';
import { reloadWhenUpdated } from '../ui/updates';
import { patchMinimum, pitchSuitability } from './analysis';
import { AnalysisClient, SupersededError } from './analysisClient';
import { createBaseMap, OVERLAY_PANE } from './baseMap';
import { LAYERS, makeColorizer, renderOverlay, type LayerId } from './heatmap';
import { isInSwitzerland, lv95ToWgs84, wgs84ToLv95 } from './lv95';
import { DRINKING_LABELS } from './osm';
import { createPanel } from './panel';
import type { AnalysisResult, Progress } from './pipeline';
import { campScore, pickSpots, type Spot } from './scoring';
import { loadSettings, saveSettings, withPatch, type CampingSettings } from './settings';
import { describeSpot, NO_GOOD_SPOTS, protectedLayer, summarize } from './summary';
import { DTM_2M, windowBounds, windowCorners } from './terrain';

reloadWhenUpdated();

/** Zoom used when jumping to a place or to the user's location. */
const SPOT_ZOOM = 15;
/** Below this zoom a tap zooms in instead of choosing a spot. */
const MIN_SPOT_ZOOM = 12;
const RESCORE_DELAY_MS = 120;
const RED = '#C8102E';
const BLUE = '#1E6EC8';

// --- state ------------------------------------------------------------------------------

let settings: CampingSettings = loadSettings();
let spot: { lat: number; lon: number } | null = null;
let result: AnalysisResult | null = null;
/** Derived from `result` and the settings by rescore(). */
let suitability: Float32Array | null = null;
let score: Float32Array | null = null;
let protectedValues: Float32Array | null = null;
let spots: Spot[] = [];

// --- map and panel ----------------------------------------------------------------------

const app = document.getElementById('app')!;
const mapEl = document.createElement('div');
mapEl.id = 'map';
const topBar = document.createElement('div');
topBar.className = 'map-top';
app.append(mapEl, topBar);

const { map, showBase, showOverlays } = createBaseMap(mapEl, settings.base, (base) =>
  update({ base }),
);

function update(patch: Partial<CampingSettings>): void {
  settings = withPatch(settings, patch);
  saveSettings(settings);
  panel.syncFrom(settings);
}

const panel = createPanel(app, settings, {
  onAreaChange(patch) {
    update(patch);
    startAnalysis(); // a different area or data source needs a new download
  },
  onViewChange(patch) {
    update(patch);
    if (patch.overlays) showOverlays(settings.overlays);
    if (patch.opacity !== undefined) overlay?.setOpacity(settings.opacity);
    if (patch.showDrinking !== undefined) showDrinkingSources();
    if (patch.layer || patch.palette) renderLayer();
  },
  onModelChange(patch) {
    update(patch);
    scheduleRescore();
  },
  onSpotSelect: focusSpot,
  onLocate: locate,
  onOpenChange: (panelOpen) => update({ panelOpen }),
});
panel.syncFrom(settings);
showBase(settings.base);
showOverlays(settings.overlays);
panel.setLegend(settings.layer, settings.palette);

const nominatim = new NominatimClient(undefined, undefined, undefined, 'ch');
const suggester = new SwisstopoSuggester();
createSearchBar(
  topBar,
  (query) => nominatim.search(query),
  (place) => map.setView([place.lat, place.lon], Math.max(place.zoom, 12)),
  (query, signal) => suggester.suggest(query, signal),
);

// --- choosing a spot and analysing -------------------------------------------------------

let marker: L.CircleMarker | null = null;
let outline: L.Polygon | null = null;
let overlay: L.ImageOverlay | null = null;
const client = new AnalysisClient();

function selectSpot(lat: number, lon: number): void {
  if (!isInSwitzerland(lat, lon)) {
    panel.setStatus('That spot is outside Switzerland. This map covers Switzerland only.');
    return;
  }
  spot = { lat, lon };
  marker?.remove();
  marker = L.circleMarker([lat, lon], {
    radius: 7,
    color: '#FFFFFF',
    weight: 3,
    fillColor: RED,
    fillOpacity: 1,
    interactive: false,
  }).addTo(map);
  writeUrl();
  const href = new URL('panorama.html', location.href);
  href.search = new URLSearchParams({
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    r: '100',
    exact: '1',
  }).toString();
  panel.setPanoramaLink(href.toString());
  startAnalysis();
}

function analysisWindow(): { e: number; n: number; half: number } {
  const p = wgs84ToLv95(spot!.lat, spot!.lon);
  return { e: p.e, n: p.n, half: (settings.areaKm * 1000) / 2 };
}

function drawOutline(solid: boolean): void {
  const { e, n, half } = analysisWindow();
  const b = windowBounds(e, n, half, DTM_2M.gsd);
  outline?.remove();
  outline = L.polygon(windowCorners({ ...b, cell: DTM_2M.gsd }), {
    color: RED,
    weight: solid ? 1.5 : 2,
    dashArray: solid ? undefined : '6 6',
    fill: false,
    interactive: false,
  }).addTo(map);
}

const describeProgress = (p: Progress): string =>
  p.stage === 'surface'
    ? `Loading vegetation height: ${p.done}/${p.total} tiles (large)`
    : p.stage === 'terrain'
      ? `Loading terrain: ${p.done}/${p.total} tiles`
      : p.stage === 'features'
        ? 'Loading trails, water and protected areas...'
        : 'Analysing...';

function startAnalysis(): void {
  if (!spot) return;
  drawOutline(false);
  panel.setStatus('Loading terrain...');
  const { e, n, half } = analysisWindow();
  client
    .run({ e, n, halfSizeM: half, canopy: settings.canopy, date: Date.now() }, (p) =>
      panel.setStatus(describeProgress(p)),
    )
    .then(onResult)
    .catch((err: unknown) => {
      if (err instanceof SupersededError) return;
      console.error(err);
      panel.setStatus(
        "Couldn't load terrain data. Check your connection and try again by tapping the map.",
      );
    });
}

function onResult(res: AnalysisResult): void {
  result = res;
  protectedValues = protectedLayer(res);
  panel.setWarnings(res.warnings);
  panel.setAreas(res.areas);
  showDrinkingSources();
  rescore();
  drawOutline(true);
  if (window.matchMedia('(max-width: 640px)').matches) {
    panel.setOpen(false);
    update({ panelOpen: false });
  }
}

// --- scoring, layers, markers ------------------------------------------------------------

/** Recomputes suitability, the camp score and the best spots from the stored grids. */
function rescore(): void {
  if (!result) return;
  const { width, height } = result.geometry;
  const p = settings.suitability;
  suitability = patchMinimum(
    pitchSuitability(result.slope, result.roughness, result.canopy, p, result.water),
    width,
    height,
    p.patchRadiusCells,
  );
  score = campScore(
    {
      suitability,
      ...(result.trailDistance ? { trailDistance: result.trailDistance } : {}),
      ...(result.waterDistance ? { waterDistance: result.waterDistance } : {}),
      ...(result.drinkingDistance ? { drinkingDistance: result.drinkingDistance } : {}),
      ...(result.protectionIndex
        ? {
            protection: {
              index: result.protectionIndex,
              inForce: result.areas.map((a) => a.inForce),
            },
          }
        : {}),
    },
    settings.nearby,
    settings.hideProtected,
  );
  spots = pickSpots(score, result.geometry);
  renderLayer();
  showSpots();
  panel.setSpots(
    spots.map((s) => describeSpot(result!, s)),
    NO_GOOD_SPOTS,
  );
  panel.setStatus(summarize(result, suitability, score, settings.hideProtected));
}

let rescoreTimer = 0;
function scheduleRescore(): void {
  clearTimeout(rescoreTimer);
  rescoreTimer = window.setTimeout(rescore, RESCORE_DELAY_MS);
}

function valuesOf(layer: LayerId): Float32Array | undefined {
  if (!result) return undefined;
  const byLayer: Record<LayerId, Float32Array | null | undefined> = {
    score,
    suitability,
    slope: result.slope,
    roughness: result.roughness,
    canopy: result.canopy,
    water: result.water,
    protected: protectedValues,
  };
  return byLayer[layer] ?? undefined;
}

function renderLayer(): void {
  panel.setLegend(settings.layer, settings.palette);
  if (!result) return;
  overlay?.remove();
  overlay = null;
  const values = valuesOf(settings.layer);
  if (!values) {
    panel.setStatus(
      settings.layer === 'canopy'
        ? 'Vegetation height needs "Use vegetation height" and an area of 1 km or less.'
        : `${LAYERS[settings.layer].label} is not available for this area.`,
    );
    return;
  }
  const image = renderOverlay(
    result.geometry,
    values,
    makeColorizer(settings.layer, settings.palette),
  );
  overlay = L.imageOverlay(image.canvas.toDataURL(), image.bounds, {
    opacity: settings.opacity,
    interactive: false,
  }).addTo(map);
}

const spotLayer = L.layerGroup().addTo(map);
const spotMarkers = new Map<number, L.Marker>();
function showSpots(): void {
  spotLayer.clearLayers();
  spotMarkers.clear();
  for (const s of spots) {
    const { lat, lon } = lv95ToWgs84(s.e, s.n);
    const item = describeSpot(result!, s);
    const icon = L.divIcon({
      className: 'spot-marker',
      html: `<span>${s.rank}</span>`,
      iconSize: [28, 28],
    });
    spotMarkers.set(
      s.rank,
      L.marker([lat, lon], { icon, pane: OVERLAY_PANE })
        .bindPopup(`<strong>${item.title}</strong><br>${item.detail}`)
        .addTo(spotLayer),
    );
  }
}

function focusSpot(rank: number): void {
  const m = spotMarkers.get(rank);
  if (!m) return;
  map.setView(m.getLatLng(), Math.max(map.getZoom(), 17));
  m.openPopup();
}

const drinkingLayer = L.layerGroup().addTo(map);
function showDrinkingSources(): void {
  drinkingLayer.clearLayers();
  if (!settings.showDrinking || !result) return;
  for (const d of result.drinking) {
    L.circleMarker([d.lat, d.lon], {
      pane: OVERLAY_PANE,
      radius: 6,
      color: '#FFFFFF',
      weight: 2,
      fillColor: BLUE,
      fillOpacity: 1,
    })
      .bindPopup(`${DRINKING_LABELS[d.kind]}${d.name ? `: ${d.name}` : ''}`)
      .addTo(drinkingLayer);
  }
}

// --- location, URL, clicks ---------------------------------------------------------------

function locate(): void {
  if (!navigator.geolocation) {
    panel.setStatus('Your browser cannot tell where you are. Tap the map instead.');
    return;
  }
  panel.setStatus('Finding your location...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      map.setView([pos.coords.latitude, pos.coords.longitude], SPOT_ZOOM);
      selectSpot(pos.coords.latitude, pos.coords.longitude);
    },
    () => panel.setStatus("Couldn't get your location. Allow location access, or tap the map."),
    { enableHighAccuracy: true, timeout: 15_000 },
  );
}

function writeUrl(): void {
  if (!spot) return;
  const url = new URL(location.href);
  url.searchParams.set('lat', spot.lat.toFixed(5));
  url.searchParams.set('lon', spot.lon.toFixed(5));
  history.replaceState(null, '', url);
}

map.on('click', (e: L.LeafletMouseEvent) => {
  // At country zoom a tap is too imprecise to be a spot: zoom in on it first.
  if (map.getZoom() < MIN_SPOT_ZOOM) {
    map.setView(e.latlng, SPOT_ZOOM - 1);
    panel.setStatus('Now tap the exact spot you want to check.');
    return;
  }
  selectSpot(e.latlng.lat, e.latlng.lng);
});

// A shared link opens straight on its spot.
const params = new URLSearchParams(location.search);
const startLat = Number(params.get('lat'));
const startLon = Number(params.get('lon'));
if (params.has('lat') && params.has('lon') && isInSwitzerland(startLat, startLon)) {
  map.setView([startLat, startLon], SPOT_ZOOM);
  selectSpot(startLat, startLon);
}

// Exposed for browser-driven checks.
Object.assign(globalThis, {
  campingApp: {
    map,
    selectSpot,
    get result() {
      return result;
    },
    get score() {
      return score;
    },
    get spots() {
      return spots;
    },
  },
});
