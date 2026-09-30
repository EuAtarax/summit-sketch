import { lonLatToTile, tileToLonLat } from '../geo/tiles';
import type { BBox } from '../geo/bbox';
import type { Peak } from './overpass';
import type { FetchFn } from '../net/fetch';
import { fetchPeaksFromOverpass } from './overpassFetch';

/** Peaks are fetched per slippy tile at this zoom (~40 × 30 km in the Alps). */
export const PEAK_TILE_ZOOM = 10;

/** Tile keys (x/y at PEAK_TILE_ZOOM) covering a bounding box. */
export function peakTilesFor(b: BBox): { x: number; y: number }[] {
  const nw = lonLatToTile(b.north, b.west, PEAK_TILE_ZOOM);
  const se = lonLatToTile(b.south, b.east, PEAK_TILE_ZOOM);
  const n = 2 ** PEAK_TILE_ZOOM;
  const out: { x: number; y: number }[] = [];
  for (let y = Math.floor(nw.y); y <= Math.floor(se.y); y++) {
    for (let x = Math.floor(nw.x); x <= Math.floor(se.x); x++) {
      out.push({ x: ((x % n) + n) % n, y: Math.min(n - 1, Math.max(0, y)) });
    }
  }
  return out;
}

function tileBBox(x: number, y: number): BBox {
  const nw = tileToLonLat(x, y, PEAK_TILE_ZOOM);
  const se = tileToLonLat(x + 1, y + 1, PEAK_TILE_ZOOM);
  return { south: se.lat, west: nw.lon, north: nw.lat, east: se.lon };
}

/**
 * Named OSM peaks, fetched from the shared public Overpass server one tile at a time
 * (never in parallel), cached in memory, with backoff when the server is busy.
 */
export class PeakStore {
  private readonly tiles = new Map<string, Peak[]>();
  private readonly inflight = new Map<string, Promise<Peak[]>>();
  private chain: Promise<unknown> = Promise.resolve();
  requests = 0;

  constructor(
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly backoffMs = [2000, 5000, 10000],
    /** A hanging server must not block a tap forever. */
    private readonly timeoutMs = 8000,
  ) {}

  /** Peaks already cached for the box (no network). */
  cached(b: BBox): Peak[] {
    return peakTilesFor(b).flatMap((t) => this.tiles.get(`${t.x}/${t.y}`) ?? []);
  }

  /** Fetches missing tiles for the box (at most maxTiles) and returns all its cached peaks. */
  async ensure(b: BBox, maxTiles = 9): Promise<Peak[]> {
    const tiles = peakTilesFor(b);
    if (tiles.length > maxTiles) return this.cached(b);
    await Promise.all(tiles.map((t) => this.tile(t.x, t.y)));
    return this.cached(b);
  }

  private tile(x: number, y: number): Promise<Peak[]> {
    const key = `${x}/${y}`;
    const done = this.tiles.get(key);
    if (done) return Promise.resolve(done);
    let p = this.inflight.get(key);
    if (!p) {
      // Serialize requests: the next one starts only after the previous finished.
      p = this.chain
        .catch(() => undefined)
        .then(() => this.fetchTile(tileBBox(x, y)))
        .then((peaks) => {
          this.tiles.set(key, peaks);
          return peaks;
        })
        .finally(() => this.inflight.delete(key));
      this.chain = p;
      this.inflight.set(key, p);
    }
    return p;
  }

  private fetchTile(b: BBox): Promise<Peak[]> {
    return fetchPeaksFromOverpass(
      b,
      { fetchFn: this.fetchFn, backoffMs: this.backoffMs, timeoutMs: this.timeoutMs },
      () => this.requests++,
    );
  }
}
