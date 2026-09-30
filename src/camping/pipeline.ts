import { createIdbCache, type Cache } from '../cache/idbCache';
import type { BBox } from '../peaks/overpass';
import {
  dilateMask,
  downsampleMean,
  flatSurfaceMask,
  objectHeight,
  roughness,
  slopeDegrees,
} from './analysis';
import type { FetchFn } from './cog';
import { wgs84ToLv95 } from './lv95';
import { fetchFeatures, type DrinkingSource, type LatLon, type OsmFeatures } from './osm';
import { fetchProtectedAreas, protectionIndex, type ProtectedArea } from './protection';
import { distanceTransform, rasterizeLines, rasterizePoints, type Point } from './raster';
import {
  DSM_05M,
  DTM_2M,
  loadWindow,
  wgs84Envelope,
  windowBounds,
  type GridGeometry,
} from './terrain';

export interface AnalysisParams {
  /** Center of the area in LV95, meters. */
  e: number;
  n: number;
  /** Half the side length of the square, meters. */
  halfSizeM: number;
  /** Also load the 0.5 m surface model to get vegetation height (large download). */
  canopy: boolean;
  /** The day the protection periods are checked against, in ms since the epoch. */
  date: number;
}

/** A protected area without its outline: all the panel needs to list it. */
export type AreaInfo = Omit<ProtectedArea, 'polygons'>;

/**
 * Everything that does not depend on the user's thresholds. Suitability and the camp score are
 * derived from these on demand, so moving a slider never needs another download.
 */
export interface AnalysisResult {
  geometry: GridGeometry;
  /** Degrees. */
  slope: Float32Array;
  /** Meters, RMS distance from the local plane over a 6 m window. */
  roughness: Float32Array;
  /** 1 on lakes and other perfectly flat surfaces, 0 elsewhere, NaN without data. */
  water: Float32Array;
  /** Vegetation and object height in meters, when it was requested. */
  canopy?: Float32Array;
  /** Meters to the nearest trail, stream or lake shore, and drinking-water source. Infinity when
   * the area has none; absent when OpenStreetMap could not be reached. */
  trailDistance?: Float32Array;
  waterDistance?: Float32Array;
  drinkingDistance?: Float32Array;
  drinking: DrinkingSource[];
  /** 1-based index into `areas` for each cell (0 = not protected); absent when unavailable. */
  protectionIndex?: Uint8Array;
  areas: AreaInfo[];
  /** Plain-language notes about data that could not be loaded. */
  warnings: string[];
  millis: number;
}

export interface Progress {
  stage: 'terrain' | 'surface' | 'features' | 'analysis';
  done: number;
  total: number;
}

export interface AnalysisDeps {
  /** One fetch for every service (tests route by URL). */
  fetchFn?: FetchFn;
  /** Persistent cache for OpenStreetMap answers. */
  osmCache?: Cache<OsmFeatures>;
  /** Retry delays for a busy Overpass server (tests use none). */
  osmBackoffMs?: readonly number[];
}

const OSM_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const BOX_MARGIN_M = 100;
/** Ground this close to a lake (2 cells, 4 m) is ruled out too, as a tent must not touch water. */
const SHORE_BUFFER_CELLS = 2;

export const OSM_UNAVAILABLE =
  'Trails, water and drinking water could not be loaded (the OpenStreetMap server is busy). The result ignores them.';
export const PROTECTION_UNAVAILABLE =
  'Protected areas could not be loaded. Check the rules that apply before camping.';

/** The default cache lives in IndexedDB, which not every environment (tests) has. */
function defaultOsmCache(): Cache<OsmFeatures> | undefined {
  return typeof indexedDB === 'undefined'
    ? undefined
    : createIdbCache<OsmFeatures>({
        dbName: 'summit-sketch-osm',
        store: 'features',
        maxAgeMs: OSM_MAX_AGE_MS,
      });
}

/** WGS84 box around a window, with a margin so features just outside still count. */
function wgs84Box(g: GridGeometry): BBox {
  const [west, south, east, north] = wgs84Envelope(g, BOX_MARGIN_M);
  return { south, west, north, east };
}

const toLv95 = (p: LatLon): Point => {
  const q = wgs84ToLv95(p.lat, p.lon);
  return [q.e, q.n];
};

/** Distance rasters (meters) to trails, water and drinking water from OSM features. */
function featureDistances(f: OsmFeatures, g: GridGeometry) {
  const distance = (mask: Uint8Array) => distanceTransform(mask, g.width, g.height, g.cell);
  return {
    trailDistance: distance(
      rasterizeLines(
        f.trails.map((l) => l.map(toLv95)),
        g,
      ),
    ),
    waterDistance: distance(
      rasterizeLines(
        f.water.map((l) => l.map(toLv95)),
        g,
      ),
    ),
    drinkingDistance: distance(rasterizePoints(f.drinking.map(toLv95), g)),
  };
}

const areaInfo = (a: ProtectedArea): AreaInfo => ({
  layer: a.layer,
  kind: a.kind,
  name: a.name,
  rule: a.rule,
  period: a.period,
  inForce: a.inForce,
  restricts: a.restricts,
});

/**
 * Loads the terrain around a point and derives slope, roughness, water and vegetation; also
 * fetches trails, water, drinking water (OpenStreetMap) and protected areas (swisstopo/BAFU) in
 * parallel. Failures of those two are reported as warnings, never as a failed analysis.
 */
export async function runAnalysis(
  params: AnalysisParams,
  onProgress: (p: Progress) => void,
  deps: AnalysisDeps = {},
): Promise<AnalysisResult> {
  const started = performance.now();
  const { fetchFn } = deps;
  const bounds = windowBounds(params.e, params.n, params.halfSizeM, DTM_2M.gsd);
  const box = wgs84Box({ ...bounds, cell: DTM_2M.gsd });

  // Start the slow network calls first; the terrain is read while they are in flight.
  const osmCache = deps.osmCache ?? defaultOsmCache();
  const osm = fetchFeatures(box, {
    ...(fetchFn ? { fetchFn } : {}),
    ...(osmCache ? { cache: osmCache } : {}),
    ...(deps.osmBackoffMs ? { backoffMs: deps.osmBackoffMs } : {}),
  });
  const protection = fetchProtectedAreas(box, new Date(params.date), fetchFn);
  // A failure is handled below; this only keeps an early rejection from being reported as unhandled.
  osm.catch(() => undefined);
  protection.catch(() => undefined);

  const dtm = await loadWindow(
    DTM_2M,
    params.e,
    params.n,
    params.halfSizeM,
    (done, total) => onProgress({ stage: 'terrain', done, total }),
    fetchFn,
  );
  const { width, height, cell } = dtm;
  const terrainDone = performance.now();
  onProgress({ stage: 'analysis', done: 0, total: 1 });
  const slope = slopeDegrees(dtm.data, width, height, cell);
  const rough = roughness(dtm.data, width, height, cell);
  const water = dilateMask(
    flatSurfaceMask(dtm.data, width, height),
    width,
    height,
    SHORE_BUFFER_CELLS,
  );

  let canopy: Float32Array | undefined;
  if (params.canopy) {
    // The same window in the 0.5 m surface model: centered exactly on the terrain window so
    // the two grids line up cell for cell after averaging 4 x 4 cells down to 2 m.
    const size = width * cell;
    const dsm = await loadWindow(
      DSM_05M,
      dtm.e0 + size / 2,
      dtm.n0 - size / 2,
      size / 2,
      (done, total) => onProgress({ stage: 'surface', done, total }),
      fetchFn,
    );
    const coarse = downsampleMean(dsm.data, dsm.width, dsm.height, cell / DSM_05M.gsd);
    canopy = objectHeight(coarse.data, dtm.data);
  }

  const analysisDone = performance.now();
  onProgress({ stage: 'features', done: 0, total: 1 });
  const [osmResult, protectionResult] = await Promise.allSettled([osm, protection]);
  const warnings: string[] = [];
  const geometry: GridGeometry = { e0: dtm.e0, n0: dtm.n0, cell, width, height };

  const result: AnalysisResult = {
    geometry,
    slope,
    roughness: rough,
    water,
    drinking: [],
    areas: [],
    warnings,
    millis: 0,
  };
  if (canopy) result.canopy = canopy;
  if (osmResult.status === 'fulfilled') {
    Object.assign(result, featureDistances(osmResult.value, geometry));
    result.drinking = osmResult.value.drinking;
  } else {
    console.warn('OpenStreetMap features unavailable', osmResult.reason);
    warnings.push(OSM_UNAVAILABLE);
  }
  if (protectionResult.status === 'fulfilled') {
    result.protectionIndex = protectionIndex(protectionResult.value, geometry);
    result.areas = protectionResult.value.map(areaInfo);
  } else {
    console.warn('Protected areas unavailable', protectionResult.reason);
    warnings.push(PROTECTION_UNAVAILABLE);
  }
  result.millis = performance.now() - started;
  const ms = (from: number, to: number) => `${Math.round(to - from)} ms`;
  console.debug(
    `[camping] terrain ${ms(started, terrainDone)}, analysis ${ms(terrainDone, analysisDone)}, ` +
      `waiting for OSM and protection data ${ms(analysisDone, performance.now())}`,
  );
  return result;
}
