/** Terrarium-encoded elevation tiles (AWS Terrain Tiles). Pure helpers. */

export const TERRARIUM_MAX_ZOOM = 15;

export function terrariumTileUrl(z: number, x: number, y: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}

/** Elevation in meters from one Terrarium pixel: (R*256 + G + B/256) - 32768. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Decodes RGBA pixel data (e.g. from getImageData) into a row-major elevation grid. */
export function decodeTerrariumPixels(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = decodeTerrarium(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!);
  }
  return out;
}

/** Bilinear sample of a size×size grid at fractional pixel coords (pixel centers at +0.5). */
export function sampleBilinear(grid: Float32Array, size: number, px: number, py: number): number {
  const fx = Math.min(Math.max(px - 0.5, 0), size - 1);
  const fy = Math.min(Math.max(py - 0.5, 0), size - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = grid[y0 * size + x0]!;
  const b = grid[y0 * size + x1]!;
  const c = grid[y1 * size + x0]!;
  const d = grid[y1 * size + x1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
