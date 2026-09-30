import { decodeLzw } from './lzw';

import type { FetchFn } from '../net/fetch';

const TAG = {
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  predictor: 317,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  noData: 42113,
} as const;

const COMPRESSION_LZW = 5;

/** What is needed to read tiles out of a Cloud-Optimized GeoTIFF with range requests. */
export interface CogHeader {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  tilesAcross: number;
  tilesDown: number;
  tileOffsets: number[];
  tileByteCounts: number[];
  noData: number | null;
  /** Top-left corner of the top-left pixel in the file's coordinate system (pixel-is-area). */
  originX: number;
  originY: number;
  /** Pixel size in the file's units (meters for LV95). */
  pixelSize: number;
}

/**
 * Parses the first image's directory of a classic little-endian tiled float32 GeoTIFF with LZW
 * compression and no predictor (swissALTI3D and swissSURFACE3D). Anything else is rejected
 * loudly, so an unexpected file never turns into silent garbage. Throws a RangeError when the
 * directory extends past `bytes`.
 */
export function parseCogHeader(bytes: Uint8Array): CogHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0x4949 || view.getUint16(2, true) !== 42) {
    throw new Error('Unsupported TIFF: expected classic little-endian');
  }
  const ifd = view.getUint32(4, true);
  const count = view.getUint16(ifd, true);

  const entries = new Map<number, { type: number; count: number; valueOffset: number }>();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    entries.set(view.getUint16(at, true), {
      type: view.getUint16(at + 2, true),
      count: view.getUint32(at + 4, true),
      valueOffset: at + 8,
    });
  }
  const need = (tag: number) => {
    const e = entries.get(tag);
    if (!e) throw new Error(`TIFF tag ${tag} is missing`);
    return e;
  };
  /** Location of an entry's values: inline in the entry, or at the offset it stores. */
  const valuesAt = (tag: number, itemSize: number) => {
    const e = need(tag);
    return e.count * itemSize <= 4 ? e.valueOffset : view.getUint32(e.valueOffset, true);
  };
  const scalar = (tag: number): number => {
    const e = need(tag);
    return e.type === 3 ? view.getUint16(e.valueOffset, true) : view.getUint32(e.valueOffset, true);
  };
  const longs = (tag: number): number[] => {
    const e = need(tag);
    const base = valuesAt(tag, 4);
    return Array.from({ length: e.count }, (_, i) => view.getUint32(base + i * 4, true));
  };
  const doubles = (tag: number): number[] => {
    const e = need(tag);
    const base = valuesAt(tag, 8);
    return Array.from({ length: e.count }, (_, i) => view.getFloat64(base + i * 8, true));
  };

  if (scalar(TAG.compression) !== COMPRESSION_LZW) throw new Error('Unsupported TIFF compression');
  const predictor = entries.has(TAG.predictor) ? scalar(TAG.predictor) : 1;
  if (predictor !== 1) throw new Error('Unsupported TIFF predictor');
  if (scalar(TAG.bitsPerSample) !== 32 || scalar(TAG.sampleFormat) !== 3) {
    throw new Error('Unsupported TIFF sample format: expected float32');
  }

  const width = scalar(TAG.imageWidth);
  const height = scalar(TAG.imageLength);
  const tileWidth = scalar(TAG.tileWidth);
  const tileHeight = scalar(TAG.tileLength);
  const tilesAcross = Math.ceil(width / tileWidth);
  const tilesDown = Math.ceil(height / tileHeight);
  const tileOffsets = longs(TAG.tileOffsets);
  const tileByteCounts = longs(TAG.tileByteCounts);
  if (tileOffsets.length !== tilesAcross * tilesDown) throw new Error('Unexpected tile count');

  const [pixelSize] = doubles(TAG.pixelScale);
  const tiepoint = doubles(TAG.tiepoint);
  let noData: number | null = null;
  if (entries.has(TAG.noData)) {
    const e = need(TAG.noData);
    const base = valuesAt(TAG.noData, 1);
    let text = '';
    for (let i = 0; i < e.count; i++) text += String.fromCharCode(view.getUint8(base + i));
    const parsed = Number.parseFloat(text);
    noData = Number.isFinite(parsed) ? parsed : null;
  }

  return {
    width,
    height,
    tileWidth,
    tileHeight,
    tilesAcross,
    tilesDown,
    tileOffsets,
    tileByteCounts,
    noData,
    originX: tiepoint[3]!,
    originY: tiepoint[4]!,
    pixelSize: pixelSize!,
  };
}

/** Decodes one compressed tile into meters (float32), row-major from the north. */
export function decodeTile(compressed: Uint8Array, header: CogHeader): Float32Array {
  const cells = header.tileWidth * header.tileHeight;
  const raw = decodeLzw(compressed, cells * 4);
  const values = new Float32Array(raw.buffer, raw.byteOffset, cells);
  if (header.noData !== null) {
    for (let i = 0; i < cells; i++) if (values[i] === header.noData) values[i] = Number.NaN;
  }
  return values;
}

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
      this.decodeAll(bytes, header);
      return header;
    }
    for (const size of [HEADER_BYTES, 8 * HEADER_BYTES]) {
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

  private tileKey(index: number): string {
    return `${this.id}:${index}`;
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

  /** Decodes every tile of a whole file and puts them in the cache. */
  private decodeAll(bytes: Uint8Array, header: CogHeader): Float32Array[] {
    const tiles = header.tileOffsets.map((start, i) =>
      decodeTile(bytes.subarray(start, start + header.tileByteCounts[i]!), header),
    );
    tiles.forEach((t, i) => cacheTile(this.tileKey(i), Promise.resolve(t)));
    return tiles;
  }

  private tile(header: CogHeader, index: number): Promise<Float32Array> {
    const key = this.tileKey(index);
    const hit = tileCache.get(key);
    if (hit) {
      // Most recently used goes to the end.
      tileCache.delete(key);
      tileCache.set(key, hit);
      return hit;
    }
    const small = this.totalBytes !== null && this.totalBytes <= WHOLE_FILE_MAX_BYTES;
    const loading = small
      ? this.wholeFile(header).then((tiles) => tiles[index]!)
      : fetchBytes(this.fetchFn, this.url, {
          start: header.tileOffsets[index]!,
          length: header.tileByteCounts[index]!,
        }).then(({ bytes }) => decodeTile(bytes, header));
    cacheTile(key, loading);
    return loading;
  }

  /**
   * Reads the pixel window [x0, x0 + width) x [y0, y0 + height) (pixel coordinates, row 0 in
   * the north). Pixels outside the file and no-data pixels are NaN.
   */
  async readWindow(x0: number, y0: number, width: number, height: number): Promise<Float32Array> {
    const header = await this.header();
    const out = new Float32Array(width * height).fill(Number.NaN);
    const tx0 = Math.max(0, Math.floor(x0 / header.tileWidth));
    const tx1 = Math.min(header.tilesAcross - 1, Math.floor((x0 + width - 1) / header.tileWidth));
    const ty0 = Math.max(0, Math.floor(y0 / header.tileHeight));
    const ty1 = Math.min(header.tilesDown - 1, Math.floor((y0 + height - 1) / header.tileHeight));

    const jobs: { tx: number; ty: number }[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ tx, ty });

    let next = 0;
    const lane = async () => {
      while (next < jobs.length) {
        const { tx, ty } = jobs[next++]!;
        const tile = await this.tile(header, ty * header.tilesAcross + tx);
        copyTileIntoWindow(tile, header, tx, ty, out, x0, y0, width, height);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_TILES, jobs.length) }, lane));
    return out;
  }
}

/** Copies the overlap of one decoded tile with the window into the window's array. */
function copyTileIntoWindow(
  tile: Float32Array,
  header: CogHeader,
  tx: number,
  ty: number,
  out: Float32Array,
  x0: number,
  y0: number,
  width: number,
  height: number,
): void {
  const tileX = tx * header.tileWidth;
  const tileY = ty * header.tileHeight;
  const xa = Math.max(x0, tileX);
  const xb = Math.min(x0 + width, tileX + header.tileWidth, header.width);
  const ya = Math.max(y0, tileY);
  const yb = Math.min(y0 + height, tileY + header.tileHeight, header.height);
  for (let y = ya; y < yb; y++) {
    const src = (y - tileY) * header.tileWidth + (xa - tileX);
    const dst = (y - y0) * width + (xa - x0);
    out.set(tile.subarray(src, src + (xb - xa)), dst);
  }
}
