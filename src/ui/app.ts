import { metersPerPixel } from '../geo/tiles';
import { CancelledComputeError, HorizonEngine, type EngineRun } from '../horizon/engine';
import { nearestPeak, type BBox, type Peak } from '../peaks/overpass';
import { PeakStore } from '../peaks/peakStore';
import { formatCoords } from './format';
import { createMapPicker } from './mapPicker';
import { createPanoramaView } from './panoramaView';
import {
  createSummitSheet,
  RADIUS_OPTIONS_KM,
  type RadiusKm,
  type SheetSummit,
} from './summitSheet';

const EYE_HEIGHT_M = 2;
/** From this map zoom on, OSM peaks are shown and taps select summits. */
const PEAK_ZOOM = 11;
/** How close (in screen px) a tap must be to a peak to select it. */
const PEAK_TAP_PX = 32;
/** OSM `ele` is ignored if it disagrees with the DEM by more than this (tagging errors). */
const MAX_ELE_DEM_DIFF_M = 400;
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const ELEVATION_ERROR = "Couldn't load elevation data. Check your connection and try again.";

export function mountApp(root: HTMLElement): void {
  const mapEl = document.createElement('div');
  mapEl.className = 'map';
  const hint = document.createElement('p');
  hint.className = 'map-hint';
  root.replaceChildren(mapEl, hint);

  const engine = new HorizonEngine();
  const peaks = new PeakStore();
  let selected: SheetSummit | null = null;
  let pickSeq = 0;
  let run: EngineRun | null = null;
  let peakLoad = 0;

  const picker = createMapPicker(
    mapEl,
    {
      onPick: (lat, lon, zoom) => void pick(lat, lon, zoom),
      onViewChange: (bounds, zoom) => {
        updateHint(zoom);
        void loadPeaks(bounds, zoom);
      },
    },
    PEAK_ZOOM,
  );
  const sheet = createSummitSheet(root, {
    onShowView: () => void showView(),
    onClose: () => {
      pickSeq++;
      selected = null;
      sheet.hide();
      picker.clearSelection();
      updateHint(picker.zoom);
    },
  });
  const view = createPanoramaView(root, () => {
    run?.cancel();
    run = null;
    view.close();
  });

  function updateHint(zoom: number) {
    hint.hidden = selected !== null;
    hint.textContent =
      zoom < PEAK_ZOOM ? 'Zoom in or tap to find a summit' : 'Tap a summit to see its view';
  }

  /** Loads and shows OSM peaks for the visible map area (debounced by moveend). */
  async function loadPeaks(bounds: BBox, zoom: number) {
    if (zoom < PEAK_ZOOM) return;
    const seq = ++peakLoad;
    picker.setPeaks(peaks.cached(bounds));
    try {
      const list = await peaks.ensure(bounds);
      if (seq === peakLoad) picker.setPeaks(list);
    } catch (err) {
      console.warn('Peak names unavailable', err);
    }
  }

  /**
   * A tap near an OSM peak selects that peak (name and OSM elevation). Anywhere else the
   * exact tapped point is used, so cliff edges and viewpoints work too.
   */
  async function pick(
    lat: number,
    lon: number,
    zoom: number,
    peakRadiusM = Math.max(30, PEAK_TAP_PX * metersPerPixel(lat, zoom)),
  ): Promise<boolean> {
    if (zoom < PEAK_ZOOM) {
      picker.focus(lat, lon, 13);
      return false;
    }
    const seq = ++pickSeq;
    selected = null;
    hint.hidden = true;
    picker.setSelection(lat, lon, 'pending');
    sheet.showLoading();
    const radiusM = peakRadiusM;
    const d = Math.max(radiusM, 1) / 111_000;
    const around = { south: lat - d, north: lat + d, west: lon - d * 2, east: lon + d * 2 };

    let peak: Peak | null = null;
    try {
      if (radiusM > 0) peak = nearestPeak(await peaks.ensure(around), lat, lon, radiusM);
    } catch (err) {
      console.warn('Peak lookup failed, using the tapped point', err);
    }
    if (seq !== pickSeq) return false;

    try {
      const target = peak ?? { lat, lon };
      const dem = await engine.elevation(target.lat, target.lon);
      if (seq !== pickSeq) return false;
      const useOsm = peak?.ele != null && Math.abs(peak.ele - dem.elev) <= MAX_ELE_DEM_DIFF_M;
      selected = {
        lat: target.lat,
        lon: target.lon,
        elev: useOsm ? peak!.ele! : dem.elev,
        elevSource: useOsm ? 'osm' : 'dem',
        ...(peak ? { name: peak.name } : {}),
      };
      picker.setSelection(selected.lat, selected.lon, 'selected');
      sheet.showSummit(selected);
      return true;
    } catch {
      if (seq === pickSeq) {
        sheet.showError(ELEVATION_ERROR, () => void pick(lat, lon, zoom, peakRadiusM));
      }
      return false;
    }
  }

  async function showView(): Promise<void> {
    if (!selected) return;
    const s = selected;
    const radiusKm = sheet.radiusKm;
    writeUrl(s, radiusKm);
    view.open(
      s.name ?? 'Selected point',
      `${Math.round(s.elev)} m · ${formatCoords(s.lat, s.lon)} · ${radiusKm} km`,
    );
    const current = engine.compute(
      {
        lat: s.lat,
        lon: s.lon,
        groundElev: s.elev,
        eyeHeight: EYE_HEIGHT_M,
        ...(s.name ? { name: s.name } : {}),
      },
      { radiusM: radiusKm * 1000 },
      (p) => {
        if (p.stage === 'terrain')
          view.progress(`Loading terrain ${p.loaded}/${p.total}`, p.total ? p.loaded / p.total : 0);
        else if (p.stage === 'tracing') view.progress('Tracing ridges', p.done / p.total);
        else view.progress('Linking ridges', null);
      },
    );
    run = current;
    try {
      const { scene, stats } = await current.promise;
      if (run !== current) return;
      view.progress('Drawing', null);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      if (run !== current) return;
      view.showScene(scene, stats);
      if (DEBUG) {
        // Exposed for validation from the console.
        Object.assign(debugHandle, { scene, stats, view, selected: s });
        console.info('[horizon]', JSON.stringify(stats));
      }
    } catch (err) {
      if (err instanceof CancelledComputeError || run !== current) return;
      console.error(err);
      view.showError(ELEVATION_ERROR, () => void showView());
    }
  }

  // Deep link: ?lat=…&lon=…&r=… opens the view directly. A named peak within 150 m is used
  // (hand-written links are approximate); links the app wrote for a plain point carry exact=1.
  const params = new URLSearchParams(location.search);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const r = Number(params.get('r'));
  if ((RADIUS_OPTIONS_KM as readonly number[]).includes(r)) sheet.setRadius(r as RadiusKm);
  updateHint(picker.zoom);
  const debugHandle: Record<string, unknown> = { picker, peaks };
  if (DEBUG) (globalThis as Record<string, unknown>).summitSketch = debugHandle;
  if (params.has('lat') && params.has('lon') && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) {
    picker.focus(lat, lon, 14);
    const exact = params.get('exact') === '1';
    void pick(lat, lon, 14, exact ? 0 : 150).then((ok) => {
      if (ok) void showView();
    });
  }
}

function writeUrl(s: SheetSummit, radiusKm: number): void {
  const url = new URL(location.href);
  url.searchParams.set('lat', s.lat.toFixed(5));
  url.searchParams.set('lon', s.lon.toFixed(5));
  url.searchParams.set('r', String(radiusKm));
  if (s.name) url.searchParams.delete('exact');
  else url.searchParams.set('exact', '1');
  history.replaceState(null, '', url);
}
