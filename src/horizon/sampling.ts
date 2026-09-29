import { curvatureDrop, EARTH_RADIUS_M, REFRACTION_K } from '../geo/geodesy';
import { metersPerPixel, TILE_SIZE } from '../geo/tiles';
import { tilesInBox } from '../terrain/tileGrid';

/** Rays use `zoom` up to `maxDistM`; the last band should extend to Infinity. */
export interface ZoomBand {
  maxDistM: number;
  zoom: number;
}

export const DEFAULT_ZOOM_BANDS: readonly ZoomBand[] = [
  { maxDistM: 20_000, zoom: 12 },
  { maxDistM: 60_000, zoom: 11 },
  { maxDistM: 150_000, zoom: 10 },
  { maxDistM: Infinity, zoom: 9 },
];

/** The zoom the ray cast uses at a distance, so lookups there hit the same cached tiles. */
export function zoomForDistance(
  distM: number,
  bands: readonly ZoomBand[] = DEFAULT_ZOOM_BANDS,
): number {
  return (bands.find((b) => distM <= b.maxDistM) ?? bands[bands.length - 1]!).zoom;
}

/** Distances along a ray, shared by every ray of one panorama. */
export interface RaySamples {
  count: number;
  dist: Float64Array;
  /** Index into `bands` for each sample. */
  band: Uint8Array;
  /** Bands actually reached within the radius, with their start distance. */
  bands: { zoom: number; startM: number; endM: number; stepM: number }[];
  sinD: Float64Array;
  cosD: Float64Array;
  drop: Float64Array;
}

export interface SamplingOptions {
  zoomBands?: readonly ZoomBand[];
  refractionK?: number;
  /** Sample step as a fraction of the pixel size at the band's zoom. */
  stepFactor?: number;
  maxZoom?: number;
}

export function buildRaySamples(lat: number, radiusM: number, o: SamplingOptions = {}): RaySamples {
  const zoomBands = o.zoomBands ?? DEFAULT_ZOOM_BANDS;
  const k = o.refractionK ?? REFRACTION_K;
  const stepFactor = o.stepFactor ?? 0.5;
  const maxZoom = o.maxZoom ?? 15;

  const bands: RaySamples['bands'] = [];
  const dist: number[] = [];
  const band: number[] = [];
  let start = 0;
  let d = 0;
  for (const zb of zoomBands) {
    if (start >= radiusM) break;
    const end = Math.min(zb.maxDistM, radiusM);
    const zoom = Math.min(zb.zoom, maxZoom);
    const stepM = metersPerPixel(lat, zoom) * stepFactor;
    const bi = bands.length;
    bands.push({ zoom, startM: start, endM: end, stepM });
    for (d += stepM; d <= end; d += stepM) {
      dist.push(d);
      band.push(bi);
    }
    d = dist[dist.length - 1] ?? 0;
    start = end;
  }

  const count = dist.length;
  const out: RaySamples = {
    count,
    dist: Float64Array.from(dist),
    band: Uint8Array.from(band),
    bands,
    sinD: new Float64Array(count),
    cosD: new Float64Array(count),
    drop: new Float64Array(count),
  };
  for (let i = 0; i < count; i++) {
    const delta = dist[i]! / EARTH_RADIUS_M;
    out.sinD[i] = Math.sin(delta);
    out.cosD[i] = Math.cos(delta);
    out.drop[i] = curvatureDrop(dist[i]!, k);
  }
  return out;
}

const D2R = Math.PI / 180;
const MAX_SIN_LAT = Math.sin(85.05 * D2R);

/** Precomputed observer terms for projecting points along rays. */
export interface RayOrigin {
  sinLat: number;
  cosLat: number;
  lonRad: number;
}

export function rayOrigin(lat: number, lon: number): RayOrigin {
  return { sinLat: Math.sin(lat * D2R), cosLat: Math.cos(lat * D2R), lonRad: lon * D2R };
}

/**
 * Global Web Mercator pixel coords of the point at angular distance δ along bearing θ,
 * written to `out`. Uses the spherical destination formula without an asin:
 * Mercator y only needs sin(lat).
 */
export function rayPointToPx(
  o: RayOrigin,
  sinT: number,
  cosT: number,
  sinD: number,
  cosD: number,
  worldPx: number,
  out: { x: number; y: number },
): void {
  let s = o.sinLat * cosD + o.cosLat * sinD * cosT;
  if (s > MAX_SIN_LAT) s = MAX_SIN_LAT;
  else if (s < -MAX_SIN_LAT) s = -MAX_SIN_LAT;
  const lon = o.lonRad + Math.atan2(sinT * sinD * o.cosLat, cosD - o.sinLat * s);
  out.x = ((lon + Math.PI) / (2 * Math.PI)) * worldPx;
  out.y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx;
}

/**
 * All tiles (per band) that rays [rayStart, rayStart + rayCount) touch, including the
 * neighbors bilinear sampling needs. Walks each ray at a coarse step and pads a box around
 * each point by half that step, so nothing between coarse points is missed.
 */
export function requiredTiles(
  lat: number,
  lon: number,
  samples: RaySamples,
  azStep: number,
  rayStart: number,
  rayCount: number,
): { x: number; y: number }[][] {
  const o = rayOrigin(lat, lon);
  const p = { x: 0, y: 0 };
  return samples.bands.map((b) => {
    const worldPx = TILE_SIZE * 2 ** b.zoom;
    const mpp = metersPerPixel(lat, b.zoom);
    const coarseM = (TILE_SIZE / 16) * mpp;
    // Half a coarse step plus bilinear neighbor plus slack for latitude variation of mpp.
    const pad = (coarseM / mpp) * 0.5 * 1.1 + 2;
    const seen = new Set<number>();
    const tiles: { x: number; y: number }[] = [];
    const n = 2 ** b.zoom;
    for (let r = 0; r < rayCount; r++) {
      const theta = (rayStart + r) * azStep * D2R;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      for (let d = b.startM; ; d += coarseM) {
        const dd = Math.min(d, b.endM);
        const delta = dd / EARTH_RADIUS_M;
        rayPointToPx(o, sinT, cosT, Math.sin(delta), Math.cos(delta), worldPx, p);
        for (const t of tilesInBox(b.zoom, p.x - pad, p.y - pad, p.x + pad, p.y + pad)) {
          const key = t.y * n + t.x;
          if (!seen.has(key)) {
            seen.add(key);
            tiles.push(t);
          }
        }
        if (dd >= b.endM) break;
      }
    }
    return tiles;
  });
}
