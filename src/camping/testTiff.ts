/**
 * Test-only helpers: an independent TIFF-LZW encoder and a builder for tiny tiled float32
 * GeoTIFFs shaped like swissALTI3D files, so the reader can be tested without the network.
 */

/** TIFF LZW encoder (early change), following the structure of libtiff's encoder. */
export function encodeLzw(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const emit = (code: number, bits: number) => {
    bitBuffer = (bitBuffer << bits) | code;
    bitCount += bits;
    while (bitCount >= 8) {
      out.push((bitBuffer >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
    bitBuffer &= (1 << bitCount) - 1;
  };

  const dictionary = new Map<number, number>();
  let next = 258;
  let bits = 9;
  /** Called after a table entry was added (or would have been, for the last code). */
  const afterAdd = () => {
    next++;
    if (next === 4094) {
      emit(256, bits);
      dictionary.clear();
      next = 258;
      bits = 9;
    } else if (next === 512) bits = 10;
    else if (next === 1024) bits = 11;
    else if (next === 2048) bits = 12;
  };

  emit(256, bits);
  if (data.length > 0) {
    let current = data[0]!;
    for (let i = 1; i < data.length; i++) {
      const byte = data[i]!;
      const key = current * 256 + byte;
      const hit = dictionary.get(key);
      if (hit !== undefined) {
        current = hit;
      } else {
        emit(current, bits);
        dictionary.set(key, next);
        afterAdd();
        current = byte;
      }
    }
    emit(current, bits);
    afterAdd();
  }
  emit(257, bits);
  if (bitCount > 0) emit(0, 8 - bitCount);
  return Uint8Array.from(out);
}

export interface TestTiffOptions {
  width: number;
  height: number;
  tileSize: number;
  /** Row-major from the north, width * height values. */
  values: Float32Array;
  originX: number;
  originY: number;
  pixelSize: number;
  noData?: number;
  /** Override the compression tag, to test that unsupported files are rejected. */
  compression?: number;
}

/** A classic little-endian tiled float32 GeoTIFF with LZW tiles and its directory up front. */
export function buildTestTiff(o: TestTiffOptions): Uint8Array {
  const tilesAcross = Math.ceil(o.width / o.tileSize);
  const tilesDown = Math.ceil(o.height / o.tileSize);
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < tilesDown; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      const tile = new Float32Array(o.tileSize * o.tileSize);
      for (let y = 0; y < o.tileSize; y++) {
        for (let x = 0; x < o.tileSize; x++) {
          const gx = tx * o.tileSize + x;
          const gy = ty * o.tileSize + y;
          if (gx < o.width && gy < o.height)
            tile[y * o.tileSize + x] = o.values[gy * o.width + gx]!;
        }
      }
      tiles.push(encodeLzw(new Uint8Array(tile.buffer)));
    }
  }

  const noDataText = o.noData === undefined ? null : `${o.noData}\0`;
  const entryCount = 11 + (noDataText ? 1 : 0);
  const ifdSize = 2 + entryCount * 12 + 4;
  let cursor = 8 + ifdSize;
  const offsetsAt = cursor;
  cursor += tiles.length * 4;
  const countsAt = cursor;
  cursor += tiles.length * 4;
  const scaleAt = cursor;
  cursor += 24;
  const tiepointAt = cursor;
  cursor += 48;
  const noDataAt = cursor;
  cursor += noDataText ? noDataText.length : 0;
  const tileOffsets: number[] = [];
  for (const t of tiles) {
    tileOffsets.push(cursor);
    cursor += t.length;
  }

  const bytes = new Uint8Array(cursor);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entryCount, true);
  let entry = 10;
  const put = (tag: number, type: number, count: number, value: number) => {
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(entry + 8, value, true);
    else view.setUint32(entry + 8, value, true);
    entry += 12;
  };
  put(256, 3, 1, o.width);
  put(257, 3, 1, o.height);
  put(258, 3, 1, 32);
  put(259, 3, 1, o.compression ?? 5);
  put(322, 3, 1, o.tileSize);
  put(323, 3, 1, o.tileSize);
  put(324, 4, tiles.length, offsetsAt);
  put(325, 4, tiles.length, countsAt);
  put(339, 3, 1, 3);
  put(33550, 12, 3, scaleAt);
  put(33922, 12, 6, tiepointAt);
  if (noDataText) put(42113, 2, noDataText.length, noDataAt);

  tiles.forEach((t, i) => {
    view.setUint32(offsetsAt + i * 4, tileOffsets[i]!, true);
    view.setUint32(countsAt + i * 4, t.length, true);
    bytes.set(t, tileOffsets[i]!);
  });
  [o.pixelSize, o.pixelSize, 0].forEach((v, i) => view.setFloat64(scaleAt + i * 8, v, true));
  [0, 0, 0, o.originX, o.originY, 0].forEach((v, i) =>
    view.setFloat64(tiepointAt + i * 8, v, true),
  );
  if (noDataText) {
    for (let i = 0; i < noDataText.length; i++) bytes[noDataAt + i] = noDataText.charCodeAt(i);
  }
  return bytes;
}

export interface TiffImageSpec {
  width: number;
  height: number;
  /** Row-major from the north. */
  values: Float32Array | Float64Array;
  /** Tile size, or null for strips of `rowsPerStrip` rows. */
  tileSize: number | null;
  rowsPerStrip?: number;
  /** 1 none, 5 LZW, 8 Deflate. */
  compression: 1 | 5 | 8;
  /** 3 = floating-point predictor. */
  predictor?: 1 | 3;
  format: 'f32' | 'f64' | 'i16';
}

export interface TiffSpec {
  bigTiff: boolean;
  /** Full resolution first, then overviews. */
  images: TiffImageSpec[];
  originX: number;
  originY: number;
  pixelSize: number;
  noData?: number;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The floating-point predictor's encoding: byte planes per row, then byte differences. */
function applyFloatPredictor(raw: Uint8Array, width: number, rows: number, bytes: number) {
  const rowBytes = width * bytes;
  for (let r = 0; r < rows; r++) {
    const row = raw.subarray(r * rowBytes, (r + 1) * rowBytes);
    const plane = new Uint8Array(rowBytes);
    for (let c = 0; c < width; c++) {
      for (let b = 0; b < bytes; b++) plane[(bytes - b - 1) * width + c] = row[c * bytes + b]!;
    }
    for (let i = rowBytes - 1; i > 0; i--) plane[i] = (plane[i]! - plane[i - 1]!) & 0xff;
    row.set(plane);
  }
}

/**
 * Any of the layouts the reader supports: classic or BigTIFF, tiles or strips, several images
 * (overviews), three compressions, the floating-point predictor and three sample formats.
 */
export async function buildTiff(spec: TiffSpec): Promise<Uint8Array> {
  const big = spec.bigTiff;
  const dirs = [];
  for (const img of spec.images) {
    const bytes = img.format === 'f64' ? 8 : img.format === 'f32' ? 4 : 2;
    const bw = img.tileSize ?? img.width;
    const bh = img.tileSize ?? img.rowsPerStrip ?? img.height;
    const across = Math.ceil(img.width / bw);
    const down = Math.ceil(img.height / bh);
    const blocks: Uint8Array[] = [];
    for (let by = 0; by < down; by++) {
      for (let bx = 0; bx < across; bx++) {
        const typed =
          img.format === 'f64'
            ? new Float64Array(bw * bh)
            : img.format === 'f32'
              ? new Float32Array(bw * bh)
              : new Int16Array(bw * bh);
        for (let y = 0; y < bh; y++) {
          for (let x = 0; x < bw; x++) {
            const gx = bx * bw + x;
            const gy = by * bh + y;
            if (gx < img.width && gy < img.height)
              typed[y * bw + x] = img.values[gy * img.width + gx]!;
          }
        }
        const raw = new Uint8Array(typed.buffer.slice(0));
        if (img.predictor === 3) applyFloatPredictor(raw, bw, bh, bytes);
        blocks.push(
          img.compression === 5 ? encodeLzw(raw) : img.compression === 8 ? await deflate(raw) : raw,
        );
      }
    }
    dirs.push({ img, bytes, bw, bh, blocks });
  }

  // Layout: header, then per image its directory, arrays and blocks.
  const entrySize = big ? 20 : 12;
  const ptrSize = big ? 8 : 4;
  const buf = new Uint8Array(64 * 1024 * 1024);
  const view = new DataView(buf.buffer);
  let cursor = big ? 16 : 8;
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, big ? 43 : 42, true);
  if (big) {
    view.setUint16(4, 8, true);
    view.setBigUint64(8, BigInt(cursor), true);
  } else view.setUint32(4, cursor, true);
  const writePtr = (at: number, v: number) =>
    big ? view.setBigUint64(at, BigInt(v), true) : view.setUint32(at, v, true);

  dirs.forEach((d, level) => {
    const tags: { tag: number; type: number; values: number[] }[] = [];
    const tiled = d.img.tileSize !== null;
    const offsetsType = big ? 16 : 4;
    tags.push({ tag: 256, type: 4, values: [d.img.width] });
    tags.push({ tag: 257, type: 4, values: [d.img.height] });
    tags.push({ tag: 258, type: 3, values: [d.bytes * 8] });
    tags.push({ tag: 259, type: 3, values: [d.img.compression] });
    if (level > 0) tags.push({ tag: 254, type: 4, values: [1] });
    if (!tiled) tags.push({ tag: 278, type: 4, values: [d.bh] });
    tags.push({ tag: 317, type: 3, values: [d.img.predictor ?? 1] });
    tags.push({ tag: 339, type: 3, values: [d.img.format === 'i16' ? 2 : 3] });
    tags.push({ tag: tiled ? 324 : 273, type: offsetsType, values: d.blocks.map(() => 0) });
    tags.push({ tag: tiled ? 325 : 279, type: offsetsType, values: d.blocks.map((b) => b.length) });
    if (tiled) {
      tags.push({ tag: 322, type: 3, values: [d.bw] });
      tags.push({ tag: 323, type: 3, values: [d.bh] });
    }
    if (level === 0) {
      tags.push({ tag: 33550, type: 12, values: [spec.pixelSize, spec.pixelSize, 0] });
      tags.push({ tag: 33922, type: 12, values: [0, 0, 0, spec.originX, spec.originY, 0] });
      if (spec.noData !== undefined) {
        const text = `${spec.noData}\0`;
        tags.push({ tag: 42113, type: 2, values: [...text].map((ch) => ch.charCodeAt(0)) });
      }
    }
    tags.sort((a, b) => a.tag - b.tag);
    const ifdAt = cursor;
    const countSize = big ? 8 : 2;
    let dataAt = ifdAt + countSize + tags.length * entrySize + ptrSize;
    if (big) view.setBigUint64(ifdAt, BigInt(tags.length), true);
    else view.setUint16(ifdAt, tags.length, true);
    const size = (type: number) => ({ 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 })[type as 2]!;
    const writeValue = (at: number, type: number, v: number) => {
      if (type === 2) view.setUint8(at, v);
      else if (type === 3) view.setUint16(at, v, true);
      else if (type === 4) view.setUint32(at, v, true);
      else if (type === 12) view.setFloat64(at, v, true);
      else view.setBigUint64(at, BigInt(v), true);
    };
    const valueLocations: number[] = [];
    tags.forEach((t, i) => {
      const at = ifdAt + countSize + i * entrySize;
      view.setUint16(at, t.tag, true);
      view.setUint16(at + 2, t.type, true);
      if (big) view.setBigUint64(at + 4, BigInt(t.values.length), true);
      else view.setUint32(at + 4, t.values.length, true);
      const valueAt = at + (big ? 12 : 8);
      const bytes = t.values.length * size(t.type);
      let where = valueAt;
      if (bytes > ptrSize) {
        where = dataAt;
        writePtr(valueAt, dataAt);
        dataAt += bytes + (bytes % 2);
      }
      valueLocations.push(where);
      t.values.forEach((v, k) => writeValue(where + k * size(t.type), t.type, v));
    });
    // Blocks after the arrays; then fill in the offsets.
    const offTag = tags.findIndex((t) => t.tag === (tiled ? 324 : 273));
    d.blocks.forEach((b, k) => {
      buf.set(b, dataAt);
      writeValue(
        valueLocations[offTag]! + k * size(tags[offTag]!.type),
        tags[offTag]!.type,
        dataAt,
      );
      dataAt += b.length;
    });
    const nextAt = ifdAt + countSize + tags.length * entrySize;
    cursor = dataAt + (dataAt % 2);
    writePtr(nextAt, level + 1 < dirs.length ? cursor : 0);
  });
  return buf.slice(0, cursor);
}
