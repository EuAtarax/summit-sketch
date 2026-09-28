import { fetchTerrariumTile } from './fetchTerrarium';
import { LruCache } from './lru';
import { tileKey, type ElevationSource } from './source';
import { TERRARIUM_MAX_ZOOM } from './terrarium';

export interface TerrariumSourceOptions {
  /** Decoded tiles kept in memory (256 kB each). */
  cacheTiles?: number;
  retries?: number;
}

/** AWS Terrain Tiles (Terrarium PNG) with an in-memory LRU cache and request de-duplication. */
export class TerrariumSource implements ElevationSource {
  readonly maxZoom = TERRARIUM_MAX_ZOOM;
  private readonly cache: LruCache<string, Float32Array>;
  private readonly inflight = new Map<string, Promise<Float32Array>>();
  private readonly retries: number;

  constructor(opts: TerrariumSourceOptions = {}) {
    this.cache = new LruCache(opts.cacheTiles ?? 192);
    this.retries = opts.retries ?? 2;
  }

  getTile(z: number, x: number, y: number): Promise<Float32Array> {
    const key = tileKey(z, x, y);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetchWithRetry(z, x, y)
        .then((elev) => {
          this.cache.set(key, elev);
          return elev;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async fetchWithRetry(z: number, x: number, y: number): Promise<Float32Array> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await fetchTerrariumTile(z, x, y)).elev;
      } catch (err) {
        if (attempt >= this.retries) throw err;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }
}
