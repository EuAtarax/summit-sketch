import type { FetchFn } from '../../net/fetch';
import type { GridGeometry } from '../terrain';

export type TileProgress = (done: number, total: number) => void;

/**
 * Where a country's elevation comes from. Both methods fill the analysis grid (2 m cells in
 * the country's CRS) exactly, whatever the source's own pixel grid; NaN where there is no data.
 */
export interface TerrainSource {
  /** Bare-ground heights, one per cell. */
  terrain(g: GridGeometry, onProgress: TileProgress, fetchFn?: FetchFn): Promise<Float32Array>;
  /**
   * Surface heights (trees, buildings) at `factor` x `factor` sub-cells per cell, row-major over
   * the grid's (width * factor) x (height * factor) sub-cells.
   */
  surface(
    g: GridGeometry,
    onProgress: TileProgress,
    fetchFn?: FetchFn,
  ): Promise<{ data: Float32Array; factor: number }>;
}
