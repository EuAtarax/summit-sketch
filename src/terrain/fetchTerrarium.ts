import { TILE_SIZE } from '../geo/tiles';
import { decodeTerrariumPixels, terrariumTileUrl } from './terrarium';

export interface DecodedTile {
  z: number;
  x: number;
  y: number;
  elev: Float32Array; // TILE_SIZE × TILE_SIZE, row-major
  imagerySources: string | null;
}

/**
 * Fetches one Terrarium tile over CORS and decodes it to meters.
 * Color conversion is disabled so the browser can't alter the encoded RGB values.
 */
export async function fetchTerrariumTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<DecodedTile> {
  const res = await fetch(terrariumTileUrl(z, x, y), { mode: 'cors', signal: signal ?? null });
  if (!res.ok) throw new Error(`Tile ${z}/${x}/${y}: HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  return {
    z,
    x,
    y,
    elev: decodeTerrariumPixels(data),
    imagerySources: res.headers.get('x-amz-meta-x-imagery-sources'),
  };
}
