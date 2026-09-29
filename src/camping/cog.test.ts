import { describe, expect, it } from 'vitest';
import { CogRaster, parseCogHeader, type FetchFn } from './cog';
import { buildTestTiff } from './testTiff';

const WIDTH = 300;
const HEIGHT = 200;
/** A smooth surface: elevation grows to the east and south, with a known value per pixel. */
const elevation = (x: number, y: number) => 1000 + x * 0.5 + y * 0.25;

function makeFile(noData?: number) {
  const values = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) values[y * WIDTH + x] = elevation(x, y);
  if (noData !== undefined) values[10 * WIDTH + 10] = noData;
  return buildTestTiff({
    width: WIDTH,
    height: HEIGHT,
    tileSize: 128,
    values,
    originX: 2722000,
    originY: 1205000,
    pixelSize: 2,
    ...(noData !== undefined ? { noData } : {}),
  });
}

/** A fake server that honors Range requests and records what was asked. */
function serve(file: Uint8Array) {
  const ranges: [number, number][] = [];
  const fetchFn: FetchFn = async (_url, init) => {
    const header = new Headers(init.headers).get('Range')!;
    const [start, end] = header.replace('bytes=', '').split('-').map(Number) as [number, number];
    ranges.push([start, end]);
    return new Response(file.slice(start, Math.min(end + 1, file.length)), { status: 206 });
  };
  return { fetchFn, ranges };
}

describe('parseCogHeader', () => {
  it('reads size, tiling, georeferencing and no-data', () => {
    const header = parseCogHeader(makeFile(-9999));
    expect(header).toMatchObject({
      width: WIDTH,
      height: HEIGHT,
      tileWidth: 128,
      tileHeight: 128,
      tilesAcross: 3,
      tilesDown: 2,
      originX: 2722000,
      originY: 1205000,
      pixelSize: 2,
      noData: -9999,
    });
    expect(header.tileOffsets).toHaveLength(6);
  });

  it('rejects files it cannot read correctly instead of returning garbage', () => {
    const lzwFile = makeFile();
    const bigEndian = lzwFile.slice();
    bigEndian[0] = 0x4d;
    bigEndian[1] = 0x4d;
    expect(() => parseCogHeader(bigEndian)).toThrow('little-endian');

    const otherCompression = buildTestTiff({
      width: 8,
      height: 8,
      tileSize: 8,
      values: new Float32Array(64),
      originX: 0,
      originY: 0,
      pixelSize: 1,
      compression: 8,
    });
    expect(() => parseCogHeader(otherCompression)).toThrow('compression');
  });

  it('signals a truncated directory with a RangeError so the caller can fetch more', () => {
    expect(() => parseCogHeader(makeFile().slice(0, 40))).toThrow(RangeError);
  });
});

describe('CogRaster.readWindow', () => {
  it('returns exactly the file values for a window spanning several tiles', async () => {
    const { fetchFn } = serve(makeFile());
    const raster = new CogRaster('https://example.test/a.tif', fetchFn);
    const w = await raster.readWindow(100, 90, 120, 70); // touches 2 x 2 tiles
    for (let y = 0; y < 70; y++) {
      for (let x = 0; x < 120; x++) {
        expect(w[y * 120 + x]).toBeCloseTo(elevation(100 + x, 90 + y), 3);
      }
    }
  });

  it('downloads only the header and the tiles the window touches', async () => {
    const file = makeFile();
    const { fetchFn, ranges } = serve(file);
    const raster = new CogRaster('https://example.test/a.tif', fetchFn);
    await raster.readWindow(5, 5, 20, 20); // inside tile 0 only
    expect(ranges).toHaveLength(2); // header + one tile
    await raster.readWindow(5, 5, 20, 20); // cached
    expect(ranges).toHaveLength(2);
    expect(ranges[0]![0]).toBe(0);
  });

  it('marks no-data cells and pixels outside the file as NaN', async () => {
    const { fetchFn } = serve(makeFile(-9999));
    const raster = new CogRaster('https://example.test/a.tif', fetchFn);
    const w = await raster.readWindow(WIDTH - 5, 8, 10, 6); // 5 columns inside, 5 outside
    expect(w[0]).toBeCloseTo(elevation(WIDTH - 5, 8), 3);
    expect(Number.isNaN(w[9])).toBe(true);
    const cornerWindow = await raster.readWindow(8, 8, 4, 4);
    expect(Number.isNaN(cornerWindow[2 * 4 + 2])).toBe(true); // pixel (10, 10) is no-data
    expect(cornerWindow[0]).toBeCloseTo(elevation(8, 8), 3);
  });
});
