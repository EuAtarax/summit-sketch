import type { FetchFn } from '../../net/fetch';
import { sampleInto } from '../resample';
import { rasterFor, type GridGeometry } from '../terrain';
import type { TerrainSource, TileProgress } from './types';

/**
 * Austria: the BEV's airborne laser scanning models (ALS DTM and DSM, 1 m, CC BY 4.0), one
 * Cloud-Optimized GeoTIFF per 50 km square of EPSG:3035 with overviews (2 m, 4 m, ...). The
 * BEV server sends no CORS header, so the files are read through our proxy (proxy/).
 */
const PROXY =
  (import.meta.env.VITE_BEV_PROXY_URL as string | undefined) ??
  'https://camp-spots.shitlas-trash.workers.dev';
/** Survey date of the current release (the folder name at the BEV). */
const RELEASE = '20250915';
const TILE_M = 50_000;

/**
 * The 55 tiles, by the lower-left corner in units of 50 km: northing -> eastings. From the
 * BEV's ATOM feed (the same set for DTM and DSM).
 */
const TILES: Record<number, readonly number[]> = {
  51: [93],
  52: [86, 87, 88, 89, 90, 91, 92, 93, 94, 95],
  53: [85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96],
  54: [85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96],
  55: [90, 91, 92, 93, 94, 95, 96, 97],
  56: [90, 91, 92, 93, 94, 95, 96],
  57: [92, 93, 94, 95, 96],
};

export function bevUrl(kind: 'DTM' | 'DSM', north: number, east: number): string {
  return `${PROXY}/bev/ALS/${kind}/${RELEASE}/ALS_${kind}_CRS3035RES50000mN${north}E${east}.tif`;
}

/** Lower-left corners (meters) of the BEV tiles that overlap a box. */
export function bevTilesFor(
  e0: number,
  n0: number,
  e1: number,
  n1: number,
): { north: number; east: number }[] {
  const out: { north: number; east: number }[] = [];
  for (const [n, eastings] of Object.entries(TILES)) {
    const north = Number(n) * TILE_M;
    for (const e of eastings) {
      const east = e * TILE_M;
      if (east < e1 && east + TILE_M > e0 && north < n1 && north + TILE_M > n0) {
        out.push({ north, east });
      }
    }
  }
  return out;
}

/**
 * Samples one BEV model onto the grid at `factor` sub-cells per cell, from the coarsest image
 * that is still fine enough (the 2 m overview for terrain, the 1 m image for the surface).
 */
async function loadBev(
  kind: 'DTM' | 'DSM',
  g: GridGeometry,
  factor: number,
  onProgress: TileProgress,
  fetchFn?: FetchFn,
): Promise<Float32Array> {
  const step = g.cell / factor;
  const e1 = g.e0 + g.width * g.cell;
  const n1 = g.n0 - g.height * g.cell;
  const out = new Float32Array(g.width * factor * g.height * factor).fill(Number.NaN);
  const tiles = bevTilesFor(g.e0, n1, e1, g.n0);
  let done = 0;
  onProgress(0, tiles.length);
  await Promise.all(
    tiles.map(async ({ north, east }) => {
      const raster = rasterFor(bevUrl(kind, north, east), false, fetchFn);
      const header = await raster.header();
      // Coarsest image with pixels no larger than the step (1 % slack: overviews are 2.00004 m).
      let level = 0;
      header.levels.forEach((l, i) => {
        if (l.pixelSize <= step * 1.01 && l.pixelSize >= header.levels[level]!.pixelSize) level = i;
      });
      const image = header.levels[level]!;
      const ps = image.pixelSize;
      const x0 = Math.max(0, Math.floor((g.e0 - header.originX) / ps) - 1);
      const y0 = Math.max(0, Math.floor((header.originY - g.n0) / ps) - 1);
      const x1 = Math.min(image.width, Math.ceil((e1 - header.originX) / ps) + 1);
      const y1 = Math.min(image.height, Math.ceil((header.originY - n1) / ps) + 1);
      if (x1 > x0 && y1 > y0) {
        const data = await raster.readWindow(x0, y0, x1 - x0, y1 - y0, level);
        sampleInto(
          {
            data,
            width: x1 - x0,
            height: y1 - y0,
            originX: header.originX + x0 * ps,
            originY: header.originY - y0 * ps,
            pixelSize: ps,
          },
          out,
          g,
          factor,
          kind === 'DTM' ? 'bilinear' : 'nearest',
        );
      }
      onProgress(++done, tiles.length);
    }),
  );
  return out;
}

export const austriaSource: TerrainSource = {
  terrain: (g, onProgress, fetchFn) => loadBev('DTM', g, 1, onProgress, fetchFn),
  async surface(g, onProgress, fetchFn) {
    const factor = Math.round(g.cell); // 1 m sub-cells of the 2 m grid
    return { data: await loadBev('DSM', g, factor, onProgress, fetchFn), factor };
  },
};
