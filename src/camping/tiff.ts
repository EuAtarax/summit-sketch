import { decodeLzw } from './lzw';

/**
 * A small GeoTIFF reader for elevation rasters: little-endian classic TIFF and BigTIFF, tiled or
 * striped, uncompressed, LZW or Deflate, with or without the floating-point predictor, one
 * sample of float32, float64 or 16-bit integers. Cloud-Optimized GeoTIFFs keep every image
 * (full resolution and overviews) up front, so one read of the first bytes finds all of them.
 * Anything else is rejected loudly, so an unexpected file never turns into silent garbage.
 */

const TAG = {
  newSubfileType: 254,
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
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

const COMPRESSIONS = new Set([1, 5, 8, 32946]); // none, LZW, Deflate (Adobe and old code)
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8, 16: 8, 18: 8 };

/** One image of the file: the full resolution or an overview. */
export interface TiffLevel {
  width: number;
  height: number;
  /** Block size: the tile size, or for a striped image the full width and RowsPerStrip. */
  tileWidth: number;
  tileHeight: number;
  tilesAcross: number;
  tilesDown: number;
  tileOffsets: number[];
  tileByteCounts: number[];
  compression: number;
  /** 1 none, 3 floating point. */
  predictor: number;
  /** 1 unsigned integer, 2 signed integer, 3 float. */
  sampleFormat: number;
  bitsPerSample: number;
  noData: number | null;
  /** Pixel size in the file's units (derived for overviews). */
  pixelSize: number;
}

/** The full-resolution image with the georeferencing, and every image of the file. */
export interface CogHeader extends TiffLevel {
  /** Top-left corner of the top-left pixel in the file's coordinate system (pixel-is-area). */
  originX: number;
  originY: number;
  /** Full resolution first, then the overviews, coarsest last. */
  levels: TiffLevel[];
}

interface Entry {
  type: number;
  count: number;
  /** Where the values are: inline in the entry, or at the offset it stores. */
  at: number;
}

/**
 * Parses all image directories. Throws a RangeError when a directory or one of its arrays
 * lies beyond `bytes`, so the caller can fetch more of the file and try again.
 */
export function parseCogHeader(bytes: Uint8Array): CogHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0x4949) {
    throw new Error('Unsupported TIFF: expected little-endian byte order');
  }
  const version = view.getUint16(2, true);
  const big = version === 43;
  if (!big && version !== 42) throw new Error('Unsupported TIFF version');
  const u64 = (at: number) => Number(view.getBigUint64(at, true));
  const pointer = (at: number) => (big ? u64(at) : view.getUint32(at, true));

  const levels: TiffLevel[] = [];
  let geo: { originX: number; originY: number; pixelSize: number } | null = null;
  let ifd = pointer(big ? 8 : 4);
  const seen = new Set<number>();
  while (ifd !== 0 && !seen.has(ifd)) {
    seen.add(ifd);
    const count = big ? u64(ifd) : view.getUint16(ifd, true);
    const first = ifd + (big ? 8 : 2);
    const size = big ? 20 : 12;
    const entries = new Map<number, Entry>();
    for (let i = 0; i < count; i++) {
      const at = first + i * size;
      const type = view.getUint16(at + 2, true);
      const n = big ? u64(at + 4) : view.getUint32(at + 4, true);
      const valueAt = at + (big ? 12 : 8);
      const inline = n * (TYPE_SIZE[type] ?? 8) <= (big ? 8 : 4);
      entries.set(view.getUint16(at, true), {
        type,
        count: n,
        at: inline ? valueAt : pointer(valueAt),
      });
    }
    const next = pointer(first + count * size);

    const read = (e: Entry, i: number): number => {
      const at = e.at + i * (TYPE_SIZE[e.type] ?? 8);
      switch (e.type) {
        case 1:
          return view.getUint8(at);
        case 3:
          return view.getUint16(at, true);
        case 4:
          return view.getUint32(at, true);
        case 11:
          return view.getFloat32(at, true);
        case 12:
          return view.getFloat64(at, true);
        case 16:
        case 18:
          return u64(at);
        default:
          throw new Error(`Unsupported TIFF field type ${e.type}`);
      }
    };
    const scalar = (tag: number, fallback?: number): number => {
      const e = entries.get(tag);
      if (!e) {
        if (fallback === undefined) throw new Error(`TIFF tag ${tag} is missing`);
        return fallback;
      }
      return read(e, 0);
    };
    const array = (tag: number): number[] => {
      const e = entries.get(tag);
      if (!e) throw new Error(`TIFF tag ${tag} is missing`);
      return Array.from({ length: e.count }, (_, i) => read(e, i));
    };

    // Transparency masks share the file with the images; they are not elevation.
    const isMask = (scalar(TAG.newSubfileType, 0) & 4) !== 0;
    if (!isMask) {
      const compression = scalar(TAG.compression, 1);
      const predictor = scalar(TAG.predictor, 1);
      const bits = scalar(TAG.bitsPerSample, 1);
      const format = scalar(TAG.sampleFormat, 1);
      const problem = !COMPRESSIONS.has(compression)
        ? 'Unsupported TIFF compression'
        : predictor !== 1 && predictor !== 3
          ? 'Unsupported TIFF predictor'
          : scalar(TAG.samplesPerPixel, 1) !== 1
            ? 'Unsupported TIFF: more than one sample per pixel'
            : !((format === 3 && (bits === 32 || bits === 64)) || (format !== 3 && bits === 16))
              ? 'Unsupported TIFF sample format: expected float32, float64 or 16-bit integers'
              : null;
      if (problem) {
        // An odd overview can be skipped; the full-resolution image must be readable.
        if (levels.length === 0) throw new Error(problem);
      } else {
        const width = scalar(TAG.imageWidth);
        const height = scalar(TAG.imageLength);
        const tiled = entries.has(TAG.tileWidth);
        const tileWidth = tiled ? scalar(TAG.tileWidth) : width;
        const tileHeight = tiled ? scalar(TAG.tileLength) : scalar(TAG.rowsPerStrip, height);
        const tilesAcross = Math.ceil(width / tileWidth);
        const tilesDown = Math.ceil(height / tileHeight);
        const tileOffsets = array(tiled ? TAG.tileOffsets : TAG.stripOffsets);
        const tileByteCounts = array(tiled ? TAG.tileByteCounts : TAG.stripByteCounts);
        if (tileOffsets.length !== tilesAcross * tilesDown) {
          throw new Error('Unexpected tile count');
        }
        let noData: number | null = null;
        const nd = entries.get(TAG.noData);
        if (nd) {
          let text = '';
          for (let i = 0; i < nd.count; i++) text += String.fromCharCode(view.getUint8(nd.at + i));
          const parsed = Number.parseFloat(text);
          noData = Number.isFinite(parsed) ? parsed : null;
        }
        if (levels.length === 0) {
          const scale = entries.get(TAG.pixelScale);
          const tie = entries.get(TAG.tiepoint);
          if (!scale || !tie) throw new Error('GeoTIFF georeferencing is missing');
          geo = { pixelSize: read(scale, 0), originX: read(tie, 3), originY: read(tie, 4) };
        }
        levels.push({
          width,
          height,
          tileWidth,
          tileHeight,
          tilesAcross,
          tilesDown,
          tileOffsets,
          tileByteCounts,
          compression,
          predictor,
          sampleFormat: format,
          bitsPerSample: bits,
          noData,
          // Overviews cover the same extent with fewer, larger pixels.
          pixelSize: (geo!.pixelSize * (levels[0]?.width ?? width)) / width,
        });
      }
    }
    ifd = next;
  }
  if (!geo || levels.length === 0) throw new Error('TIFF has no readable image');
  return { ...levels[0]!, ...geo, levels };
}

/** Inflates zlib-compressed bytes with the browser's own decompressor. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Undoes the floating-point predictor (TIFF technical note 3): each row is stored as byte planes
 * (most significant bytes of all samples first), with every byte differenced from the previous.
 */
export function undoFloatPredictor(raw: Uint8Array, width: number, rows: number, bytes: number) {
  const rowBytes = width * bytes;
  const plane = new Uint8Array(rowBytes);
  for (let r = 0; r < rows; r++) {
    const row = raw.subarray(r * rowBytes, (r + 1) * rowBytes);
    if (row.length < rowBytes) break;
    for (let i = 1; i < rowBytes; i++) row[i] = (row[i]! + row[i - 1]!) & 0xff;
    plane.set(row);
    for (let c = 0; c < width; c++) {
      for (let b = 0; b < bytes; b++) row[c * bytes + b] = plane[(bytes - b - 1) * width + c]!;
    }
  }
}

/**
 * Decodes one tile or strip into float32 values (tileWidth x tileHeight, row-major from the
 * north). A short last strip is padded; copyBlock never copies rows below the image. No-data
 * becomes NaN.
 */
export async function decodeBlock(compressed: Uint8Array, level: TiffLevel): Promise<Float32Array> {
  const bytesPerSample = level.bitsPerSample / 8;
  const cells = level.tileWidth * level.tileHeight;
  const expected = cells * bytesPerSample;
  let raw: Uint8Array;
  if (level.compression === 5) {
    raw = decodeLzw(compressed, expected);
  } else {
    const plain = level.compression === 1 ? compressed : await inflate(compressed);
    // A fresh, aligned buffer of the full block size (a last strip may be shorter).
    raw = new Uint8Array(expected);
    raw.set(plain.subarray(0, expected));
  }
  if (level.predictor === 3) {
    undoFloatPredictor(raw, level.tileWidth, level.tileHeight, bytesPerSample);
  }
  const source =
    level.sampleFormat === 3
      ? level.bitsPerSample === 64
        ? new Float64Array(raw.buffer, raw.byteOffset, cells)
        : new Float32Array(raw.buffer, raw.byteOffset, cells)
      : level.sampleFormat === 2
        ? new Int16Array(raw.buffer, raw.byteOffset, cells)
        : new Uint16Array(raw.buffer, raw.byteOffset, cells);
  const out = source instanceof Float32Array ? source : Float32Array.from(source);
  const noData =
    level.noData === null
      ? null
      : level.bitsPerSample === 32
        ? Math.fround(level.noData)
        : level.noData;
  if (noData !== null) {
    for (let i = 0; i < cells; i++) if (source[i] === noData) out[i] = Number.NaN;
  }
  return out;
}

/** The pixels of one image of a whole file in memory (a small GeoTIFF from a web service). */
export async function readImage(bytes: Uint8Array, level: TiffLevel): Promise<Float32Array> {
  const out = new Float32Array(level.width * level.height).fill(Number.NaN);
  for (let ty = 0; ty < level.tilesDown; ty++) {
    for (let tx = 0; tx < level.tilesAcross; tx++) {
      const index = ty * level.tilesAcross + tx;
      const start = level.tileOffsets[index]!;
      const block = await decodeBlock(
        bytes.subarray(start, start + level.tileByteCounts[index]!),
        level,
      );
      copyBlock(block, level, tx, ty, out, 0, 0, level.width, level.height);
    }
  }
  return out;
}

/** Copies the overlap of one decoded block with a pixel window into the window's array. */
export function copyBlock(
  block: Float32Array,
  level: TiffLevel,
  tx: number,
  ty: number,
  out: Float32Array,
  x0: number,
  y0: number,
  width: number,
  height: number,
): void {
  const tileX = tx * level.tileWidth;
  const tileY = ty * level.tileHeight;
  const xa = Math.max(x0, tileX);
  const xb = Math.min(x0 + width, tileX + level.tileWidth, level.width);
  const ya = Math.max(y0, tileY);
  const yb = Math.min(y0 + height, tileY + level.tileHeight, level.height);
  for (let y = ya; y < yb; y++) {
    const src = (y - tileY) * level.tileWidth + (xa - tileX);
    const dst = (y - y0) * width + (xa - x0);
    out.set(block.subarray(src, src + (xb - xa)), dst);
  }
}
