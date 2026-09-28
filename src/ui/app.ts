import { CancelledComputeError, HorizonEngine, type EngineRun } from '../horizon/engine';
import type { SnapResult } from '../terrain/snap';
import { formatCoords } from './format';
import { createMapPicker } from './mapPicker';
import { createPanoramaView } from './panoramaView';
import { createSummitSheet, RADIUS_OPTIONS_KM, type RadiusKm } from './summitSheet';

const EYE_HEIGHT_M = 2;
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const ELEVATION_ERROR = "Couldn't load elevation data. Check your connection and try again.";

export function mountApp(root: HTMLElement): void {
  const mapEl = document.createElement('div');
  mapEl.className = 'map';
  const hint = document.createElement('p');
  hint.className = 'map-hint';
  hint.textContent = 'Tap a summit to see its view';
  root.replaceChildren(mapEl, hint);

  const engine = new HorizonEngine();
  let summit: SnapResult | null = null;
  let pickSeq = 0;
  let run: EngineRun | null = null;

  const picker = createMapPicker(mapEl, (lat, lon) => void pick(lat, lon));
  const sheet = createSummitSheet(root, {
    onShowView: () => void showView(),
    onClose: () => {
      pickSeq++;
      summit = null;
      sheet.hide();
      picker.clearSelection();
    },
  });
  const view = createPanoramaView(root, () => {
    run?.cancel();
    run = null;
    view.close();
  });

  async function pick(lat: number, lon: number): Promise<boolean> {
    const seq = ++pickSeq;
    summit = null;
    hint.hidden = true;
    picker.setSelection(lat, lon, 'pending');
    sheet.showLoading();
    try {
      const s = await engine.snap(lat, lon);
      if (seq !== pickSeq) return false;
      summit = s;
      picker.setSelection(s.lat, s.lon, 'selected');
      sheet.showSummit(s);
      return true;
    } catch {
      if (seq === pickSeq) sheet.showError(ELEVATION_ERROR, () => void pick(lat, lon));
      return false;
    }
  }

  async function showView(): Promise<void> {
    if (!summit) return;
    const s = summit;
    const radiusKm = sheet.radiusKm;
    writeUrl(s, radiusKm);
    view.open(
      'Selected summit',
      `${Math.round(s.elev)} m · ${formatCoords(s.lat, s.lon)} · ${radiusKm} km`,
    );
    run?.cancel();
    const current = engine.compute(
      { lat: s.lat, lon: s.lon, groundElev: s.elev, eyeHeight: EYE_HEIGHT_M },
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
      // Let the "Drawing" status paint before the synchronous render.
      view.progress('Drawing', null);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      if (run !== current) return;
      view.showScene(scene, stats);
      if (DEBUG) {
        // Exposed for validation from the console: summitSketch.scene, summitSketch.stats.
        (globalThis as Record<string, unknown>).summitSketch = { scene, stats, view };
        console.info('[horizon]', JSON.stringify(stats));
      }
    } catch (err) {
      if (err instanceof CancelledComputeError || run !== current) return;
      console.error(err);
      view.showError(ELEVATION_ERROR, () => void showView());
    }
  }

  // Deep link: ?lat=…&lon=…&r=… opens the view directly.
  const params = new URLSearchParams(location.search);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const r = Number(params.get('r'));
  if ((RADIUS_OPTIONS_KM as readonly number[]).includes(r)) sheet.setRadius(r as RadiusKm);
  if (params.has('lat') && params.has('lon') && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) {
    picker.focus(lat, lon, 12);
    void pick(lat, lon).then((ok) => {
      if (ok) void showView();
    });
  }
}

function writeUrl(s: { lat: number; lon: number }, radiusKm: number): void {
  const url = new URL(location.href);
  url.searchParams.set('lat', s.lat.toFixed(5));
  url.searchParams.set('lon', s.lon.toFixed(5));
  url.searchParams.set('r', String(radiusKm));
  history.replaceState(null, '', url);
}
