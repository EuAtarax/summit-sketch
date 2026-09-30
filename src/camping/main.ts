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
import {
  AnalysisClient,
  SupersededError,
  type ResultSummary,
  type ViewUpdate,
} from './analysisClient';
import { createBaseMap, OVERLAY_PANE } from './baseMap';
import { LAYERS } from './heatmap';
import { isInSwitzerland, wgs84ToLv95 } from './lv95';
import type { SpotView } from './model';
import { DRINKING_LABELS } from './osm';
import { createPanel } from './panel';
import type { Progress } from './pipeline';
import { createProgressBar, progressFraction, shortStage } from './progress';
import { createSpotProgress } from './spotProgress';
import { loadSettings, saveSettings, withPatch, type CampingSettings } from './settings';
import { NO_GOOD_SPOTS, restrictionNotice } from './summary';
import { DTM_2M, windowBounds, windowCorners } from './terrain';
import { createToast } from './toast';

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
/** The latest finished analysis; its grids stay in the worker. */
let result: ResultSummary | null = null;
let spots: SpotView[] = [];

// --- map and panel ----------------------------------------------------------------------

const app = document.getElementById('app')!;
const mapEl = document.createElement('div');
mapEl.id = 'map';
const topBar = document.createElement('div');
topBar.className = 'map-top';
app.append(mapEl, topBar);

const progressBar = createProgressBar(app);

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
    if (patch.layer || patch.palette) {
      panel.setLegend(settings.layer, settings.palette);
      refreshView();
    }
  },
  onModelChange(patch) {
    update(patch);
    scheduleRefresh();
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
// After the search field, so it sits next to it (below it on phones).
const showToast = createToast(topBar);

// --- choosing a spot and analysing -------------------------------------------------------

let marker: L.CircleMarker | null = null;
let outline: L.Polygon | null = null;
let overlay: L.ImageOverlay | null = null;
const client = new AnalysisClient();
const spotProgress = createSpotProgress(map);

function selectSpot(lat: number, lon: number): void {
  if (!isInSwitzerland(lat, lon)) {
    say('That spot is outside Switzerland. This map covers Switzerland only.');
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
    // While loading, the dashes march around the box (see camping.css).
    className: solid ? 'analysis-outline' : 'analysis-outline loading',
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

/** A message in the panel and, since the panel may be closed, as a short toast. */
function say(text: string): void {
  panel.setStatus(text);
  showToast(text);
}

function startAnalysis(): void {
  if (!spot) return;
  drawOutline(false);
  panel.setStatus('Loading terrain...');
  progressBar.update(0.03);
  spotProgress.start([spot.lat, spot.lon], 'Loading terrain');
  const { e, n, half } = analysisWindow();
  client
    .run({ e, n, halfSizeM: half, canopy: settings.canopy, date: Date.now() }, (p) => {
      panel.setStatus(describeProgress(p));
      progressBar.update(progressFraction(p));
      spotProgress.update(shortStage(p), progressFraction(p));
    })
    .then(onResult)
    .catch((err: unknown) => {
      if (err instanceof SupersededError) return;
      console.error(err);
      progressBar.finish();
      spotProgress.finish();
      say("Couldn't load terrain data. Check your connection and try again by tapping the map.");
    });
}

function onResult(res: ResultSummary): void {
  result = res;
  panel.setWarnings(res.warnings);
  panel.setAreas(res.areas);
  showDrinkingSources();
  refreshView();
  drawOutline(true);
  progressBar.finish();
  spotProgress.finish();
  if (res.areaAtCenter) showToast(restrictionNotice(res.areaAtCenter));
  if (window.matchMedia('(max-width: 640px)').matches) {
    panel.setOpen(false);
    update({ panelOpen: false });
  }
}

// --- scoring, layers, markers ------------------------------------------------------------

let viewSeq = 0;
let overlayUrl: string | null = null;

/**
 * Asks the worker for the best spots and the heatmap under the current settings (it rescores
 * only when the scoring settings changed) and shows them. Replies to older requests are dropped.
 */
function refreshView(): void {
  if (!result) return;
  const seq = ++viewSeq;
  const { suitability, nearby, hideProtected, layer, palette } = settings;
  client
    .view({ suitability, nearby, hideProtected }, layer, palette)
    .then((view) => {
      if (view && seq === viewSeq) showView(view);
    })
    .catch((err: unknown) => {
      if (!(err instanceof SupersededError)) console.error(err);
    });
}

function showView(view: ViewUpdate): void {
  spots = view.spots;
  overlay?.remove();
  overlay = null;
  if (overlayUrl) URL.revokeObjectURL(overlayUrl);
  overlayUrl = null;
  if (view.overlay) {
    overlayUrl = URL.createObjectURL(view.overlay.blob);
    overlay = L.imageOverlay(overlayUrl, view.overlay.bounds, {
      opacity: settings.opacity,
      interactive: false,
    }).addTo(map);
  } else {
    say(
      settings.layer === 'canopy'
        ? 'Vegetation height needs "Use vegetation height" and an area of 1 km or less.'
        : `${LAYERS[settings.layer].label} is not available for this area.`,
    );
  }
  showSpots();
  panel.setSpots(spots, NO_GOOD_SPOTS);
  panel.setStatus('');
}

let refreshTimer = 0;
function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshView, RESCORE_DELAY_MS);
}

const spotLayer = L.layerGroup().addTo(map);
const spotMarkers = new Map<number, L.Marker>();
function showSpots(): void {
  spotLayer.clearLayers();
  spotMarkers.clear();
  for (const s of spots) {
    const icon = L.divIcon({
      className: 'spot-marker',
      html: `<span>${s.rank}</span>`,
      iconSize: [28, 28],
    });
    spotMarkers.set(
      s.rank,
      L.marker([s.lat, s.lon], { icon, pane: OVERLAY_PANE })
        .bindPopup(`<strong>${s.title}</strong><br>${s.detail}`)
        .on('click', () => focusSpot(s.rank))
        .addTo(spotLayer),
    );
  }
}

/** Width of the open side panel on wide screens, plus its margin: that part of the map is hidden. */
const PANEL_COVER_PX = 364;
const FOCUS_ZOOM = 17;

/**
 * Centers a best spot in the part of the map that is actually visible (not under the side
 * panel) and zooms in on it. On phones the panel is closed first so the spot is not under it.
 */
function focusSpot(rank: number): void {
  const m = spotMarkers.get(rank);
  if (!m) return;
  const phone = window.matchMedia('(max-width: 640px)').matches;
  if (phone && settings.panelOpen) {
    panel.setOpen(false);
    update({ panelOpen: false });
  }
  const covered = !phone && settings.panelOpen ? PANEL_COVER_PX : 0;
  const at = m.getLatLng();
  map.fitBounds(L.latLngBounds([at, at]), {
    maxZoom: Math.max(map.getZoom(), FOCUS_ZOOM),
    paddingTopLeft: [covered, 0],
    animate: true,
  });
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

// --- hover readout (desktop) --------------------------------------------------------------

/** Shows why the ground under the mouse scores as it does: the numbers behind the heatmap. */
function setupHoverReadout(): void {
  if (!window.matchMedia('(hover: hover)').matches) return;
  const readout = document.createElement('div');
  readout.className = 'cell-readout';
  readout.hidden = true;
  mapEl.append(readout);
  let frame = 0;
  let seq = 0;
  let inside = false;
  map.on('mousemove', (e: L.LeafletMouseEvent) => {
    cancelAnimationFrame(frame);
    inside = true;
    frame = requestAnimationFrame(() => {
      if (!result) return;
      const mine = ++seq;
      // The grids live in the worker; the answer comes back within a frame or two.
      void client
        .describe(e.latlng.lat, e.latlng.lng)
        .catch(() => null)
        .then((text) => {
          if (mine !== seq || !inside) return;
          readout.hidden = text === null;
          if (text === null) return;
          readout.textContent = text;
          readout.style.transform = `translate(${e.containerPoint.x + 16}px, ${e.containerPoint.y + 16}px)`;
        });
    });
  });
  map.on('mouseout', () => {
    cancelAnimationFrame(frame);
    inside = false;
    readout.hidden = true;
  });
}
setupHoverReadout();

// --- location, URL, clicks ---------------------------------------------------------------

function locate(): void {
  if (!navigator.geolocation) {
    say('Your browser cannot tell where you are. Tap the map instead.');
    return;
  }
  panel.setStatus('Finding your location...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      map.setView([pos.coords.latitude, pos.coords.longitude], SPOT_ZOOM);
      selectSpot(pos.coords.latitude, pos.coords.longitude);
    },
    () => say("Couldn't get your location. Allow location access, or tap the map."),
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
    say('Now tap the exact spot you want to check.');
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
    describe: (lat: number, lon: number) => client.describe(lat, lon),
    get spots() {
      return spots;
    },
  },
});
