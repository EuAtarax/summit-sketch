/** Web Mercator (slippy map) tile math. Pure functions. */

export const TILE_SIZE = 256;

/** Fractional tile coordinates of a point at zoom z (standard slippy-map formula). */
export function lonLatToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Latitude/longitude of fractional tile coordinates at zoom z. */
export function tileToLonLat(x: number, y: number, z: number): { lat: number; lon: number } {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/** Ground meters per pixel of a 256 px tile at latitude lat and zoom z. */
export function metersPerPixel(lat: number, z: number): number {
  return (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}
