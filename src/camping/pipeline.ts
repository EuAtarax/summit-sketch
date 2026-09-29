import { downsampleMean, flatSurfaceMask, objectHeight, roughness, slopeDegrees } from './analysis';
import type { FetchFn } from './cog';
import { DSM_05M, DTM_2M, loadWindow, type GridGeometry } from './terrain';

export interface AnalysisParams {
  /** Center of the area in LV95, meters. */
  e: number;
  n: number;
  /** Half the side length of the square, meters. */
  halfSizeM: number;
  /** Also load the 0.5 m surface model to get vegetation height (large download). */
  canopy: boolean;
}

/**
 * Everything that does not depend on the user's thresholds. Suitability is derived from
 * these on demand, so moving a slider never needs another download.
 */
export interface AnalysisResult {
  geometry: GridGeometry;
  elevation: Float32Array;
  /** Degrees. */
  slope: Float32Array;
  /** Meters, RMS distance from the local plane over a 6 m window. */
  roughness: Float32Array;
  /** 1 on lakes and other perfectly flat surfaces, 0 elsewhere, NaN without data. */
  water: Float32Array;
  /** Vegetation and object height in meters, when it was requested. */
  canopy?: Float32Array;
  millis: number;
}

export interface Progress {
  stage: 'terrain' | 'surface' | 'analysis';
  done: number;
  total: number;
}

/** Loads the terrain around a point and derives slope, roughness, water and vegetation. */
export async function runAnalysis(
  params: AnalysisParams,
  onProgress: (p: Progress) => void,
  fetchFn?: FetchFn,
): Promise<AnalysisResult> {
  const started = performance.now();
  const dtm = await loadWindow(
    DTM_2M,
    params.e,
    params.n,
    params.halfSizeM,
    (done, total) => onProgress({ stage: 'terrain', done, total }),
    fetchFn,
  );
  const { width, height, cell } = dtm;
  onProgress({ stage: 'analysis', done: 0, total: 1 });
  const slope = slopeDegrees(dtm.data, width, height, cell);
  const rough = roughness(dtm.data, width, height, cell);
  const water = flatSurfaceMask(dtm.data, width, height);

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

  const { data: elevation, ...geometry } = dtm;
  return {
    geometry,
    elevation,
    slope,
    roughness: rough,
    water,
    ...(canopy ? { canopy } : {}),
    millis: performance.now() - started,
  };
}
