/** Anything that can provide elevation tiles in the slippy-map tile scheme. */
export interface ElevationSource {
  readonly maxZoom: number;
  /** Row-major TILE_SIZE × TILE_SIZE elevations in meters. x must be in [0, 2^z). */
  getTile(z: number, x: number, y: number): Promise<Float32Array>;
}

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}
