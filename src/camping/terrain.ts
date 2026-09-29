import { CogRaster, type FetchFn } from './cog';
import { lv95ToWgs84 } from './lv95';
import { fetchTileAssets } from './stac';

/** A metric raster window in LV95: cell (col, row) covers E e0 + col*cell, N n0 - row*cell. */
export interface GridWindow {
  /** Easting of the window's west edge and northing of its north edge, meters. */
  e0: number;
  n0: number;
  cell: number;
  width: number;
  height: number;
  /** Row-major from the north; NaN where there is no data. */
  data: Float32Array;
}

export interface Product {
  collection: string;
  /** Ground sampling distance in meters. */
  gsd: number;
}

export const DTM_2M: Product = { collection: 'ch.swisstopo.swissalti3d', gsd: 2 };
export const DTM_05M: Product = { collection: 'ch.swisstopo.swissalti3d', gsd: 0.5 };
/** Surface model with buildings and vegetation; only published at 0.5 m (about 17 MB per km2). */
export const DSM_05M: Product = { collection: 'ch.swisstopo.swisssurface3d-raster', gsd: 0.5 };

const TILE_M = 1000;

/** Window of the given half size around a point, snapped to the cell grid (which divides 1 km). */
export function windowBounds(
  centerE: number,
  centerN: number,
  halfSizeM: number,
  cell: number,
): { e0: number; n0: number; width: number; height: number } {
  const e0 = Math.floor((centerE - halfSizeM) / cell) * cell;
  const n1 = Math.ceil((centerN + halfSizeM) / cell) * cell;
  const cells = Math.round((2 * halfSizeM) / cell);
  return { e0, n0: n1, width: cells, height: cells };
}

/** Keys ("2722-1204") of the 1 km tiles a window touches, by their south-west corner in km. */
export function tilesForWindow(e0: number, n0: number, size: { w: number; h: number }): string[] {
  const eKm0 = Math.floor(e0 / TILE_M);
  const eKm1 = Math.floor((e0 + size.w - 1e-6) / TILE_M);
  const nKm0 = Math.floor((n0 - size.h) / TILE_M);
  const nKm1 = Math.floor((n0 - 1e-6) / TILE_M);
  const keys: string[] = [];
  for (let e = eKm0; e <= eKm1; e++) for (let n = nKm0; n <= nKm1; n++) keys.push(`${e}-${n}`);
  return keys;
}

const rasters = new Map<string, CogRaster>();

function rasterFor(href: string, fetchFn?: FetchFn): CogRaster {
  let r = rasters.get(href);
  if (!r) rasters.set(href, (r = new CogRaster(href, fetchFn)));
  return r;
}

/**
 * Loads a square window of a swisstopo raster around an LV95 point by reading only the
 * needed blocks of the 1 km GeoTIFF tiles. Areas without a tile stay NaN.
 */
export async function loadWindow(
  product: Product,
  centerE: number,
  centerN: number,
  halfSizeM: number,
  onProgress?: (done: number, total: number) => void,
  fetchFn?: FetchFn,
): Promise<GridWindow> {
  const cell = product.gsd;
  const b = windowBounds(centerE, centerN, halfSizeM, cell);
  const sizeM = b.width * cell;
  const sw = lv95ToWgs84(b.e0, b.n0 - sizeM);
  const ne = lv95ToWgs84(b.e0 + sizeM, b.n0);
  const margin = 0.002;
  const assets = await fetchTileAssets(
    product.collection,
    [sw.lon - margin, sw.lat - margin, ne.lon + margin, ne.lat + margin],
    cell,
    fetchFn,
  );

  const data = new Float32Array(b.width * b.height).fill(Number.NaN);
  const keys = tilesForWindow(b.e0, b.n0, { w: sizeM, h: sizeM });
  let done = 0;
  onProgress?.(0, keys.length);
  await Promise.all(
    keys.map(async (key) => {
      const asset = assets.get(key);
      if (asset) {
        const raster = rasterFor(asset.href, fetchFn);
        const header = await raster.header();
        // Overlap of the window with this tile, in window cells and in tile pixels.
        const ea = Math.max(b.e0, header.originX);
        const eb = Math.min(b.e0 + sizeM, header.originX + header.width * header.pixelSize);
        const nt = Math.min(b.n0, header.originY);
        const nb = Math.max(b.n0 - sizeM, header.originY - header.height * header.pixelSize);
        if (eb > ea && nt > nb) {
          const px0 = Math.round((ea - header.originX) / header.pixelSize);
          const py0 = Math.round((header.originY - nt) / header.pixelSize);
          const w = Math.round((eb - ea) / header.pixelSize);
          const h = Math.round((nt - nb) / header.pixelSize);
          const part = await raster.readWindow(px0, py0, w, h);
          const col0 = Math.round((ea - b.e0) / cell);
          const row0 = Math.round((b.n0 - nt) / cell);
          for (let y = 0; y < h; y++) {
            data.set(part.subarray(y * w, (y + 1) * w), (row0 + y) * b.width + col0);
          }
        }
      }
      onProgress?.(++done, keys.length);
    }),
  );
  return { e0: b.e0, n0: b.n0, cell, width: b.width, height: b.height, data };
}
