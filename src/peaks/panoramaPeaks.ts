import type { BBox, Peak } from './overpass';
import { fetchPeaksFromOverpass, type FetchFn } from './overpassFetch';

/** Meters per degree of latitude on the spherical earth used in geo/. */
const M_PER_DEG_LAT = 111_194.9;
/** Covers the error of rounding the observer to two decimals (~0.6 km) with room to spare. */
const ROUNDING_MARGIN_M = 2000;
/** Beyond this latitude a longitude span is meaningless, so the whole circle is queried. */
const POLAR_LAT = 89;

/**
 * Bounding box(es) that contain the disc of radiusM around a point. Two boxes when the disc
 * crosses the antimeridian, so worldwide observers work.
 */
export function bboxesForRadius(lat: number, lon: number, radiusM: number): BBox[] {
  const dLat = radiusM / M_PER_DEG_LAT;
  const south = Math.max(-90, lat - dLat);
  const north = Math.min(90, lat + dLat);
  // The disc is widest in longitude at its pole-ward edge.
  const edgeLat = Math.abs(lat) + dLat;
  const dLon = edgeLat >= POLAR_LAT ? 180 : dLat / Math.cos((edgeLat * Math.PI) / 180);
  if (dLon >= 180) return [{ south, north, west: -180, east: 180 }];
  const west = lon - dLon;
  const east = lon + dLon;
  if (west < -180) {
    return [
      { south, north, west: west + 360, east: 180 },
      { south, north, west: -180, east },
    ];
  }
  if (east > 180) {
    return [
      { south, north, west, east: 180 },
      { south, north, west: -180, east: east - 360 },
    ];
  }
  return [{ south, north, west, east }];
}

/** Observer rounded to 0.01 deg (~1 km), so nearby panoramas share one cached query. */
export function roundedObserver(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

export function panoramaPeakKey(lat: number, lon: number, radiusM: number): string {
  const o = roundedObserver(lat, lon);
  return `${o.lat.toFixed(2)},${o.lon.toFixed(2)},${Math.round(radiusM / 1000)}km`;
}

/** Persistent second-level cache (IndexedDB in the browser, a stub in tests). */
export interface PeakCacheBackend {
  get(key: string): Promise<Peak[] | undefined>;
  set(key: string, peaks: Peak[]): Promise<void>;
}

/**
 * One Overpass request per panorama: every named peak within the radius. Results are cached
 * in memory and in the optional backend, keyed by the rounded observer and radius.
 */
export class PanoramaPeakLoader {
  private readonly memory = new Map<string, Peak[]>();
  private readonly inflight = new Map<string, Promise<Peak[]>>();
  requests = 0;

  constructor(
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly backoffMs: readonly number[] = [2000, 5000, 10000],
    /** A panorama-sized response is large; the server's own limit is 25 s. */
    private readonly timeoutMs = 40_000,
    private readonly backend?: PeakCacheBackend,
  ) {}

  load(lat: number, lon: number, radiusM: number): Promise<Peak[]> {
    const key = panoramaPeakKey(lat, lon, radiusM);
    const hit = this.memory.get(key);
    if (hit) return Promise.resolve(hit);
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetchOrRestore(key, lat, lon, radiusM)
        .then((peaks) => {
          this.memory.set(key, peaks);
          return peaks;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async fetchOrRestore(
    key: string,
    lat: number,
    lon: number,
    radiusM: number,
  ): Promise<Peak[]> {
    const stored = await this.backend?.get(key);
    if (stored) return stored;
    const o = roundedObserver(lat, lon);
    const peaks = await fetchPeaksFromOverpass(
      bboxesForRadius(o.lat, o.lon, radiusM + ROUNDING_MARGIN_M),
      { fetchFn: this.fetchFn, backoffMs: this.backoffMs, timeoutMs: this.timeoutMs },
      () => this.requests++,
    );
    await this.backend?.set(key, peaks);
    return peaks;
  }
}
