import { describe, expect, it } from 'vitest';
import { buildTiff, type TiffImageSpec } from './testTiff';
import { decodeBlock, parseCogHeader, readImage } from './tiff';

const W = 40;
const H = 30;
/** A smooth, known surface with a no-data corner. */
const values = Float64Array.from({ length: W * H }, (_, i) => {
  const x = i % W;
  const y = Math.floor(i / W);
  return x < 3 && y < 3 ? -9999 : 1000 + x * 0.25 - y * 0.5 + 0.001 * x * y;
});
const overview = Float64Array.from({ length: 20 * 15 }, (_, i) => 2000 + i);

async function roundTrip(image: Partial<TiffImageSpec>, bigTiff = false) {
  const bytes = await buildTiff({
    bigTiff,
    images: [
      { width: W, height: H, values, tileSize: 16, compression: 5, format: 'f32', ...image },
      { width: 20, height: 15, values: overview, tileSize: 16, compression: 5, format: 'f32' },
    ],
    originX: 4400000,
    originY: 2650000,
    pixelSize: 1,
    noData: -9999,
  });
  const header = parseCogHeader(bytes);
  return { header, full: await readImage(bytes, header.levels[0]!), bytes };
}

function expectValues(got: Float32Array, precision: number) {
  for (let i = 0; i < W * H; i++) {
    if (values[i] === -9999) expect(Number.isNaN(got[i]!)).toBe(true);
    else expect(got[i]).toBeCloseTo(values[i]!, precision);
  }
}

describe('parseCogHeader', () => {
  it('reads BigTIFF with overviews, their sizes and derived pixel sizes', async () => {
    const { header } = await roundTrip({}, true);
    expect(header.levels).toHaveLength(2);
    expect(header).toMatchObject({ width: W, height: H, originX: 4400000, pixelSize: 1 });
    expect(header.levels[1]).toMatchObject({ width: 20, height: 15, pixelSize: 2 });
  });
});

describe('decoding', () => {
  it.each([
    ['LZW tiles', { compression: 5 }],
    ['uncompressed strips', { compression: 1, tileSize: null, rowsPerStrip: 7 }],
    ['Deflate tiles', { compression: 8 }],
    ['Deflate with the floating-point predictor', { compression: 8, predictor: 3 }],
    ['float64', { format: 'f64', compression: 5 }],
  ] as const)('reads %s', async (_, image) => {
    const { full } = await roundTrip(image as Partial<TiffImageSpec>, true);
    expectValues(full, 3);
  });

  it('reads 16-bit integers (whole meters)', async () => {
    const { full } = await roundTrip({ format: 'i16', compression: 1 });
    expect(full[10 * W + 20]).toBe(Math.trunc(values[10 * W + 20]!));
    expect(Number.isNaN(full[0]!)).toBe(true);
  });

  it('reads an overview image', async () => {
    const { header, bytes } = await roundTrip({});
    const level = header.levels[1]!;
    const block = await decodeBlock(
      bytes.subarray(level.tileOffsets[0]!, level.tileOffsets[0]! + level.tileByteCounts[0]!),
      level,
    );
    expect(block[0]).toBe(2000);
    expect(block[16 + 1]).toBe(2021); // row 1, column 1 of a 20-wide image in a 16-wide tile
  });
});
