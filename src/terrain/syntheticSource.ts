import { distanceM } from '../geo/geodesy';
import { TILE_SIZE, tileToLonLat } from '../geo/tiles';
import type { ElevationSource } from './source';

export type TerrainFn = (lat: number, lon: number) => number;

/** Elevation tiles generated from a function, sampled at pixel centers. For tests. */
export class SyntheticSource implements ElevationSource {
  readonly maxZoom = 15;
  requests = 0;

  constructor(private readonly fn: TerrainFn) {}

  getTile(z: number, x: number, y: number): Promise<Float32Array> {
    this.requests++;
    const out = new Float32Array(TILE_SIZE * TILE_SIZE);
    const lons = new Float64Array(TILE_SIZE);
    for (let px = 0; px < TILE_SIZE; px++) {
      lons[px] = tileToLonLat(x + (px + 0.5) / TILE_SIZE, y, z).lon;
    }
    for (let py = 0; py < TILE_SIZE; py++) {
      const { lat } = tileToLonLat(x, y + (py + 0.5) / TILE_SIZE, z);
      for (let px = 0; px < TILE_SIZE; px++) {
        out[py * TILE_SIZE + px] = this.fn(lat, lons[px]!);
      }
    }
    return Promise.resolve(out);
  }
}

export interface Cone {
  lat: number;
  lon: number;
  height: number;
  radiusM: number;
}

/** Flat plane at `base` meters with cones on top (heights add up where cones overlap). */
export function coneTerrain(cones: Cone[], base = 0): TerrainFn {
  return (lat, lon) => {
    let h = base;
    for (const c of cones) {
      // Cheap reject before the haversine.
      if (Math.abs(lat - c.lat) * 110_000 > c.radiusM) continue;
      const d = distanceM(lat, lon, c.lat, c.lon);
      if (d < c.radiusM) h += c.height * (1 - d / c.radiusM);
    }
    return h;
  };
}
