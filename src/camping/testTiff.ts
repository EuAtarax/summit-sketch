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
