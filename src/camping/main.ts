import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '../ui/search.css';
import './camping.css';
import { NominatimClient } from '../search/nominatim';
import { createSearchBar } from '../ui/searchBar';
import { patchMinimum, pitchSuitability, shareAbove } from './analysis';
import { AnalysisClient, SupersededError } from './analysisClient';
import { LAYERS, makeColorizer, renderOverlay, windowCorners, type LayerId } from './heatmap';
import { isInSwitzerland, lv95ToWgs84, wgs84ToLv95 } from './lv95';
import { CREDITS, OVERLAYS, overlayTileUrl } from './overlays';
import { createPanel } from './panel';
import type { AnalysisResult, Progress } from './pipeline';
import { loadSettings, saveSettings, type CampingSettings } from './settings';
import { DTM_2M, windowBounds } from './terrain';

const SWITZERLAND_BOUNDS: L.LatLngBoundsLiteral = [
  [45.8, 5.95],
  [47.85, 10.55],
];
/** Zoom used when jumping to a place or to the user's location. */
const SPOT_ZOOM = 15;
/** Below this zoom a tap zooms in instead of choosing a spot. */
const MIN_SPOT_ZOOM = 12;
/** A cell counts as pitchable from this suitability on (for the summary numbers). */
const PITCHABLE = 0.5;
const RESCORE_DELAY_MS = 120;
const RED = '#C8102E';

const SWISSTOPO =
  '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';
const BASES = {
  map: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  aerial:
    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
} as const;

let settings: CampingSettings = loadSettings();
let spot: { lat: number; lon: number } | null = null;
let result: AnalysisResult | null = null;
let suitability: Float32Array | null = null;

const app = document.getElementById('app')!;
const mapEl = document.createElement('div');
mapEl.id = 'map';
const topBar = document.createElement('div');
topBar.className = 'map-top';
app.append(mapEl, topBar);

const map = L.map(mapEl, { zoomControl: false, attributionControl: false });
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control
  .attribution({ prefix: false, position: 'bottomleft' })
  .addAttribution(`Terrain: swissALTI3D ${SWISSTOPO}`)
  .addTo(map);
map.fitBounds(SWITZERLAND_BOUNDS);
// Overlays (trails, protected areas) sit above the heatmap so they stay readable through it.
map.createPane('overlays').style.zIndex = '450';

let baseLayer: L.TileLayer | null = null;
function showBase(id: CampingSettings['base']): void {
  baseLayer?.remove();
  baseLayer = L.tileLayer(BASES[id], {
    maxNativeZoom: id === 'aerial' ? 20 : 18,
    maxZoom: 20,
    attribution: SWISSTOPO,
  })
    .addTo(map)
    .bringToBack();
}

const overlayLayers = new Map<string, L.TileLayer>();
function showOverlays(ids: readonly string[]): void {
  for (const [id, layer] of overlayLayers) {
    if (!ids.includes(id)) {
      layer.remove();
      overlayLayers.delete(id);
    }
  }
  for (const def of OVERLAYS) {
    if (!ids.includes(def.id) || overlayLayers.has(def.id)) continue;
    overlayLayers.set(
      def.id,
      L.tileLayer(overlayTileUrl(def.layer), {
        pane: 'overlays',
        opacity: 0.75,
        maxNativeZoom: 18,
        maxZoom: 20,
        attribution: CREDITS[def.credit],
      }).addTo(map),
    );
  }
}

function update(patch: Partial<CampingSettings>): void {
  settings = { ...settings, ...patch };
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
    if (patch.base) showBase(settings.base);
    if (patch.overlays) showOverlays(settings.overlays);
    if (patch.opacity !== undefined) overlay?.setOpacity(settings.opacity);
    if (patch.layer || patch.palette) renderLayer();
  },
  onSuitabilityChange(params) {
    update({ suitability: params });
    scheduleRescore();
  },
  onLocate: locate,
});
panel.syncFrom(settings);
showBase(settings.base);
showOverlays(settings.overlays);
panel.setLegend(settings.layer, settings.palette);

const nominatim = new NominatimClient(undefined, undefined, undefined, 'ch');
createSearchBar(
  topBar,
  (query) => nominatim.search(query),
  (place) => map.setView([place.lat, place.lon], Math.max(place.zoom, 12)),
);

// --- choosing a spot and analysing ------------------------------------------------------

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

const describe = (p: Progress): string =>
  p.stage === 'surface'
    ? `Loading vegetation height: ${p.done}/${p.total} tiles (large)`
    : p.stage === 'terrain'
      ? `Loading terrain: ${p.done}/${p.total} tiles`
      : 'Analysing...';

function startAnalysis(): void {
  if (!spot) return;
  drawOutline(false);
  panel.setStatus('Loading terrain...');
  const { e, n, half } = analysisWindow();
  client
    .run({ e, n, halfSizeM: half, canopy: settings.canopy }, (p) => panel.setStatus(describe(p)))
    .then((res) => {
      result = res;
      rescore();
      drawOutline(true);
      if (window.matchMedia('(max-width: 640px)').matches) panel.setOpen(false);
    })
    .catch((err: unknown) => {
      if (err instanceof SupersededError) return;
      console.error(err);
      panel.setStatus(
        "Couldn't load terrain data. Check your connection and try again by tapping the map.",
      );
    });
}

/** Recomputes suitability from the stored grids and the current thresholds. */
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
  renderLayer();
  const good = shareAbove(suitability, PITCHABLE);
  const sizeM = width * result.geometry.cell;
  const hectares = (good * sizeM * sizeM) / 10_000;
  panel.setStatus(
    `${(sizeM / 1000).toFixed(1)} x ${(sizeM / 1000).toFixed(1)} km in ${(result.millis / 1000).toFixed(1)} s. ` +
      `${(good * 100).toFixed(1)} % of the area (${hectares.toFixed(1)} ha) has ground you could pitch on.`,
  );
}

let rescoreTimer = 0;
function scheduleRescore(): void {
  clearTimeout(rescoreTimer);
  rescoreTimer = window.setTimeout(rescore, RESCORE_DELAY_MS);
}

function valuesOf(layer: LayerId): Float32Array | undefined {
  if (!result) return undefined;
  switch (layer) {
    case 'suitability':
      return suitability ?? undefined;
    case 'slope':
      return result.slope;
    case 'roughness':
      return result.roughness;
    case 'canopy':
      return result.canopy;
    case 'water':
      return result.water;
  }
}

function renderLayer(): void {
  panel.setLegend(settings.layer, settings.palette);
  if (!result) return;
  overlay?.remove();
  overlay = null;
  const values = valuesOf(settings.layer);
  if (!values) {
    panel.setStatus(
      `${LAYERS[settings.layer].label} needs "Use vegetation height" and an area of 1 km or less.`,
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

// --- location, URL ----------------------------------------------------------------------

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
    get suitability() {
      return suitability;
    },
    lv95ToWgs84,
  },
});
