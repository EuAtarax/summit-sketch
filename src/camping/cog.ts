import type { FetchFn } from '../net/fetch';
import { copyBlock, decodeBlock, parseCogHeader, type CogHeader, type TiffLevel } from './tiff';

export { parseCogHeader, type CogHeader } from './tiff';

const HEADER_BYTES = 64 * 1024;
const MAX_CONCURRENT_TILES = 6;
/**
 * Decoded tiles kept across all rasters (128 x 128 float32 = 64 KB each, so about 32 MB): a
 * 4 x 4 km window of 2 m terrain needs about 400. Least recently used tiles go first.
 */
const MAX_CACHED_TILES = 512;
/** Files up to this size are fetched whole in one request instead of block by block. */
const WHOLE_FILE_MAX_BYTES = 4 * 1024 * 1024;
/** Requests in flight across all rasters; browsers refuse a flood of parallel requests. */
const MAX_CONCURRENT_REQUESTS = 6;
const RETRY_DELAYS_MS = [400, 1200];

let activeRequests = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  activeRequests++;
  try {
    return await task();
  } finally {
    activeRequests--;
    waiting.shift()?.();
  }
}

interface Fetched {
  bytes: Uint8Array;
  /** Size of the whole file, from Content-Range, when the server said so. */
  totalBytes: number | null;
}

/**
 * One range (or, without `range`, the whole file). A network-level failure (a TypeError from
 * fetch) is retried twice with a short delay: the tile servers are fast but occasionally drop
 * a connection.
 */
async function fetchBytes(
  fetchFn: FetchFn,
  url: string,
  range?: { start: number; length: number },
): Promise<Fetched> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await limited(async () => {
        const init: RequestInit = range
          ? { headers: { Range: `bytes=${range.start}-${range.start + range.length - 1}` } }
          : {};
        const res = await fetchFn(url, init);
        if (res.status !== 206 && res.status !== 200)
          throw new Error(`HTTP ${res.status} for ${url}`);
        const total = /\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '');
        return {
          bytes: new Uint8Array(await res.arrayBuffer()),
          totalBytes: total
            ? Number(total[1])
            : range
              ? null
              : Number(res.headers.get('Content-Length')) || null,
        };
      });
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (!(err instanceof TypeError) || delay === undefined) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const tileCache = new Map<string, Promise<Float32Array>>();

/** Adds a tile to the shared cache; a failed load is forgotten so the next read tries again. */
function cacheTile(key: string, tile: Promise<Float32Array>): void {
  tileCache.set(key, tile);
  tile.catch(() => {
    if (tileCache.get(key) === tile) tileCache.delete(key);
  });
  while (tileCache.size > MAX_CACHED_TILES) {
    tileCache.delete(tileCache.keys().next().value as string);
  }
}

let nextRasterId = 1;

/**
 * A remote COG read with HTTP range requests: only the header and the tiles a window touches
 * are downloaded (small files, like the 1.2 MB 2 m terrain tiles, are fetched whole in one
 * request and decoded at once), and decoded tiles are kept in a shared, bounded cache.
 */
export class CogRaster {
  private readonly id = nextRasterId++;
  private headerPromise: Promise<CogHeader> | null = null;
  private totalBytes: number | null = null;
  /** A whole-file download in flight; its bytes are dropped once the tiles are decoded. */
  private whole: Promise<Float32Array[]> | null = null;

  /**
   * `wholeFile`: the caller knows the file is small, so it is fetched whole in one plain
   * request from the start (no separate header range). A plain GET is what the service worker
   * and the HTTP cache can store, so the file is downloaded only once.
   */
  constructor(
    readonly url: string,
    private readonly fetchFn: FetchFn = (u, init) => fetch(u, init),
    private readonly wholeFileKnown = false,
  ) {}

  header(): Promise<CogHeader> {
    if (!this.headerPromise) {
      const loading = this.loadHeader();
      this.headerPromise = loading;
      // A failed header (a dropped connection) must not stick: the next read tries again.
      loading.catch(() => {
        if (this.headerPromise === loading) this.headerPromise = null;
      });
    }
    return this.headerPromise;
  }

  private async loadHeader(): Promise<CogHeader> {
    if (this.wholeFileKnown) {
      const { bytes } = await fetchBytes(this.fetchFn, this.url);
      const header = parseCogHeader(bytes);
      this.totalBytes = bytes.length;
      void this.decodeAll(bytes, header).catch(() => undefined); // failures are forgotten
      return header;
    }
    // A COG keeps every directory and its tile index up front; large files (a 50 km tile at
    // 1 m) need a few hundred kilobytes for that.
    for (const size of [HEADER_BYTES, 8 * HEADER_BYTES, 64 * HEADER_BYTES]) {
      const { bytes, totalBytes } = await fetchBytes(this.fetchFn, this.url, {
        start: 0,
        length: size,
      });
      this.totalBytes = totalBytes;
      try {
        return parseCogHeader(bytes);
      } catch (err) {
        if (!(err instanceof RangeError)) throw err;
      }
    }
    throw new Error(`TIFF directory of ${this.url} is unexpectedly large`);
  }

  private tileKey(level: number, index: number): string {
    return `${this.id}:${level}:${index}`;
  }

  /**
   * Every tile of a small file from one download, all decoded at once and put in the cache;
   * the compressed bytes are not kept.
   */
  private wholeFile(header: CogHeader): Promise<Float32Array[]> {
    this.whole ??= fetchBytes(this.fetchFn, this.url)
      .then(({ bytes }) => this.decodeAll(bytes, header))
      .finally(() => {
        this.whole = null;
      });
    return this.whole;
  }

  /** Decodes every full-resolution tile of a whole file and puts them in the cache. */
  private decodeAll(bytes: Uint8Array, header: CogHeader): Promise<Float32Array[]> {
    const tiles = header.tileOffsets.map((start, i) =>
      decodeBlock(bytes.subarray(start, start + header.tileByteCounts[i]!), header),
    );
    tiles.forEach((t, i) => cacheTile(this.tileKey(0, i), t));
    return Promise.all(tiles);
  }

  private tile(header: CogHeader, levelIndex: number, index: number): Promise<Float32Array> {
    const level: TiffLevel = header.levels[levelIndex]!;
    const key = this.tileKey(levelIndex, index);
    const hit = tileCache.get(key);
    if (hit) {
      // Most recently used goes to the end.
      tileCache.delete(key);
      tileCache.set(key, hit);
      return hit;
    }
    const small = this.totalBytes !== null && this.totalBytes <= WHOLE_FILE_MAX_BYTES;
    const loading =
      small && levelIndex === 0
        ? this.wholeFile(header).then((tiles) => tiles[index]!)
        : fetchBytes(this.fetchFn, this.url, {
            start: level.tileOffsets[index]!,
            length: level.tileByteCounts[index]!,
          }).then(({ bytes }) => decodeBlock(bytes, level));
    cacheTile(key, loading);
    return loading;
  }

  /**
   * Reads the pixel window [x0, x0 + width) x [y0, y0 + height) of one image (`level` 0 is the
   * full resolution, 1 the first overview, ...; pixel coordinates of that image, row 0 in the
   * north). Pixels outside the image and no-data pixels are NaN.
   */
  async readWindow(
    x0: number,
    y0: number,
    width: number,
    height: number,
    level = 0,
  ): Promise<Float32Array> {
    const header = await this.header();
    const image = header.levels[level];
    if (!image) throw new Error(`${this.url} has no image ${level}`);
    const out = new Float32Array(width * height).fill(Number.NaN);
    const tx0 = Math.max(0, Math.floor(x0 / image.tileWidth));
    const tx1 = Math.min(image.tilesAcross - 1, Math.floor((x0 + width - 1) / image.tileWidth));
    const ty0 = Math.max(0, Math.floor(y0 / image.tileHeight));
    const ty1 = Math.min(image.tilesDown - 1, Math.floor((y0 + height - 1) / image.tileHeight));

    const jobs: { tx: number; ty: number }[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ tx, ty });

    let next = 0;
    const lane = async () => {
      while (next < jobs.length) {
        const { tx, ty } = jobs[next++]!;
        const tile = await this.tile(header, level, ty * image.tilesAcross + tx);
        copyBlock(tile, image, tx, ty, out, x0, y0, width, height);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_TILES, jobs.length) }, lane));
    return out;
  }
}
