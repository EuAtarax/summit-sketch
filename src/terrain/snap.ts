import { normalizeLon } from '../geo/geodesy';
import { lonLatToTile, metersPerPixel, TILE_SIZE, tileToLonLat } from '../geo/tiles';
import type { ElevationSource } from './source';
import { TileGrid, tilesInBox } from './tileGrid';

export interface SnapResult {
  lat: number;
  lon: number;
  elev: number;
}

/** Highest loaded pixel within rPx of (gx, gy); pixel centers are at +0.5. */
export function highestInRadius(
  grid: TileGrid,
  gx: number,
  gy: number,
  rPx: number,
): { px: number; py: number; elev: number } {
  let best = { px: Math.floor(gx), py: Math.floor(gy), elev: -Infinity };
  const r2 = rPx * rPx;
  for (let py = Math.floor(gy - rPx); py <= Math.ceil(gy + rPx); py++) {
    for (let px = Math.floor(gx - rPx); px <= Math.ceil(gx + rPx); px++) {
      if ((px + 0.5 - gx) ** 2 + (py + 0.5 - gy) ** 2 > r2) continue;
      const elev = grid.pixel(px, py);
      if (elev > best.elev) best = { px, py, elev };
    }
  }
  return best;
}

/** Moves a tapped point to the highest DEM cell within radiusM, because DEMs blunt summits. */
export async function snapToSummit(
  source: ElevationSource,
  lat: number,
  lon: number,
  radiusM = 150,
  zoom = source.maxZoom,
): Promise<SnapResult> {
  const t = lonLatToTile(lat, lon, zoom);
  const gx = t.x * TILE_SIZE;
  const gy = t.y * TILE_SIZE;
  const rPx = radiusM / metersPerPixel(lat, zoom);
  const grid = new TileGrid(zoom);
  const tiles = tilesInBox(zoom, gx - rPx - 1, gy - rPx - 1, gx + rPx + 1, gy + rPx + 1);
  await Promise.all(
    tiles.map(async ({ x, y }) => grid.set(x, y, await source.getTile(zoom, x, y))),
  );
  const best = highestInRadius(grid, gx, gy, rPx);
  const p = tileToLonLat((best.px + 0.5) / TILE_SIZE, (best.py + 0.5) / TILE_SIZE, zoom);
  return { lat: p.lat, lon: normalizeLon(p.lon), elev: best.elev };
}

/** DEM elevation at exactly this point (bilinear at the given zoom), without snapping. */
export async function elevationAt(
  source: ElevationSource,
  lat: number,
  lon: number,
  zoom = source.maxZoom,
): Promise<SnapResult> {
  const t = lonLatToTile(lat, lon, zoom);
  const gx = t.x * TILE_SIZE;
  const gy = t.y * TILE_SIZE;
  const grid = new TileGrid(zoom);
  const tiles = tilesInBox(zoom, gx - 2, gy - 2, gx + 2, gy + 2);
  await Promise.all(
    tiles.map(async ({ x, y }) => grid.set(x, y, await source.getTile(zoom, x, y))),
  );
  return { lat, lon, elev: grid.sample(gx, gy) };
}
