import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './camping.css';
import {
  downsampleMean,
  objectHeight,
  patchMinimum,
  pitchSuitability,
  roughness,
  shareAbove,
  slopeDegrees,
} from './analysis';
import { LAYERS, renderOverlay, type LayerId } from './heatmap';
import { isInSwitzerland, lv95ToWgs84, wgs84ToLv95 } from './lv95';
import { DSM_05M, DTM_2M, loadWindow, type GridWindow } from './terrain';

/** Start where the plan says to test: Leuggelenstock and Ijenstock, Glarus Sud. */
const START = { lat: 46.988, lon: 9.032, zoom: 15 };
const HALF_SIZE_M = 1000;
/** The surface model is 17 MB per km2, so its window (and the analysis) shrinks. */
const HALF_SIZE_WITH_CANOPY_M = 500;
const PATCH_RADIUS_CELLS = 1;

const SWISSTOPO =
  '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';
const BASES = {
  map: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  aerial:
    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
} as const;

interface Result {
  grid: GridWindow;
  layers: Partial<Record<LayerId, Float32Array>>;
  millis: number;
}

const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="map"></div>
  <form class="panel" id="panel">
    <h1>Camping spike</h1>
    <p class="hint">Analyses the terrain around the map center at 2 m resolution (swissALTI3D, Switzerland only).</p>
    <label class="check"><input type="checkbox" id="canopy" /> Include vegetation height (0.5 m surface model, about 17 MB per km2, 1 x 1 km)</label>
    <button type="submit" id="analyse">Analyse here</button>
    <label>Layer
      <select id="layer">
        ${(Object.keys(LAYERS) as LayerId[]).map((id) => `<option value="${id}">${LAYERS[id].label}</option>`).join('')}
      </select>
    </label>
    <label>Base map
      <select id="base"><option value="map">National map</option><option value="aerial">Aerial image</option></select>
    </label>
    <label>Overlay opacity <input type="range" id="opacity" min="0" max="1" step="0.05" value="0.85" /></label>
    <p id="status" role="status">Move the map, then press "Analyse here".</p>
  </form>`;

const map = L.map('map', { zoomControl: false, attributionControl: false }).setView(
  [START.lat, START.lon],
  START.zoom,
);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control
  .attribution({ prefix: false })
  .addAttribution(`Terrain: swissALTI3D ${SWISSTOPO}`)
  .addTo(map);

let baseLayer: L.TileLayer | null = null;
const showBase = (id: keyof typeof BASES) => {
  baseLayer?.remove();
  baseLayer = L.tileLayer(BASES[id], {
    maxNativeZoom: id === 'aerial' ? 20 : 18,
    maxZoom: 20,
    attribution: SWISSTOPO,
  })
    .addTo(map)
    .bringToBack();
};
showBase('map');

let result: Result | null = null;
let overlay: L.ImageOverlay | null = null;
let extent: L.Rectangle | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (text: string) => ($('status').textContent = text);

function showLayer(id: LayerId): void {
  if (!result) return;
  const values = result.layers[id];
  overlay?.remove();
  if (!values) {
    status(`${LAYERS[id].label} needs "Include vegetation height" and a new analysis.`);
    return;
  }
  const image = renderOverlay(result.grid, values, LAYERS[id].stops);
  overlay = L.imageOverlay(image.canvas.toDataURL(), image.bounds, {
    opacity: Number($<HTMLInputElement>('opacity').value),
    interactive: false,
  }).addTo(map);
}

async function analyse(lat: number, lon: number, withCanopy: boolean): Promise<Result> {
  if (!isInSwitzerland(lat, lon)) throw new Error('This spike covers Switzerland only.');
  const started = performance.now();
  const center = wgs84ToLv95(lat, lon);
  const half = withCanopy ? HALF_SIZE_WITH_CANOPY_M : HALF_SIZE_M;

  status('Loading terrain...');
  const dtm = await loadWindow(DTM_2M, center.e, center.n, half, (done, total) =>
    status(`Loading terrain: ${done}/${total} tiles`),
  );
  const { width, height, cell } = dtm;
  const slope = slopeDegrees(dtm.data, width, height, cell);
  const rough = roughness(dtm.data, width, height, cell);

  let canopy: Float32Array | undefined;
  if (withCanopy) {
    // Same window in the 0.5 m surface model: center it exactly on the terrain window.
    const size = width * cell;
    const dsm = await loadWindow(
      DSM_05M,
      dtm.e0 + size / 2,
      dtm.n0 - size / 2,
      size / 2,
      (done, total) => status(`Loading surface model: ${done}/${total} tiles (large)`),
    );
    const coarse = downsampleMean(dsm.data, dsm.width, dsm.height, cell / DSM_05M.gsd);
    canopy = objectHeight(coarse.data, dtm.data);
  }

  status('Analysing...');
  const suitability = patchMinimum(
    pitchSuitability(slope, rough, canopy),
    width,
    height,
    PATCH_RADIUS_CELLS,
  );
  const layers: Result['layers'] = { suitability, slope, roughness: rough };
  if (canopy) layers.canopy = canopy;
  return { grid: dtm, layers, millis: performance.now() - started };
}

$('panel').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = map.getCenter();
  const withCanopy = $<HTMLInputElement>('canopy').checked;
  const button = $<HTMLButtonElement>('analyse');
  button.disabled = true;
  try {
    result = await analyse(c.lat, c.lng, withCanopy);
    extent?.remove();
    const sw = lv95ToWgs84(result.grid.e0, result.grid.n0 - result.grid.height * result.grid.cell);
    const ne = lv95ToWgs84(result.grid.e0 + result.grid.width * result.grid.cell, result.grid.n0);
    extent = L.rectangle(
      [
        [sw.lat, sw.lon],
        [ne.lat, ne.lon],
      ],
      { color: '#C8102E', weight: 1.5, fill: false, interactive: false },
    ).addTo(map);
    showLayer($<HTMLSelectElement>('layer').value as LayerId);
    const good = shareAbove(result.layers.suitability!, 0.5);
    status(
      `${result.grid.width * result.grid.cell} m window, ${(result.millis / 1000).toFixed(1)} s. ` +
        `${(good * 100).toFixed(1)} % of cells fit a pitch (suitability of 0.5 or more).`,
    );
  } catch (err) {
    console.error(err);
    status(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    button.disabled = false;
  }
});

$('layer').addEventListener('change', (e) =>
  showLayer((e.target as HTMLSelectElement).value as LayerId),
);
$('base').addEventListener('change', (e) =>
  showBase((e.target as HTMLSelectElement).value as keyof typeof BASES),
);
$('opacity').addEventListener('input', (e) =>
  overlay?.setOpacity(Number((e.target as HTMLInputElement).value)),
);

// Exposed for browser-driven checks.
Object.assign(globalThis, {
  campingSpike: {
    map,
    analyse,
    get result() {
      return result;
    },
    showLayer,
  },
});
