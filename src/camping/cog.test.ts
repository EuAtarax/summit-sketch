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
function serve(file: Uint8Array, reportSize = false) {
  const ranges: [number, number][] = [];
  let wholeFetches = 0;
  const fetchFn: FetchFn = async (_url, init) => {
    const header = new Headers(init.headers).get('Range');
    if (!header) {
      wholeFetches++;
      return new Response(file.slice(), { status: 200 });
    }
    const [start, end] = header.replace('bytes=', '').split('-').map(Number) as [number, number];
    ranges.push([start, end]);
    const last = Math.min(end, file.length - 1);
    return new Response(file.slice(start, last + 1), {
      status: 206,
      headers: reportSize ? { 'Content-Range': `bytes ${start}-${last}/${file.length}` } : {},
    });
  };
  return { fetchFn, ranges, wholeFetches: () => wholeFetches };
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

  it('fetches a small file whole, once, instead of block by block', async () => {
    const server = serve(makeFile(), true);
    const raster = new CogRaster('https://example.test/small.tif', server.fetchFn);
    const a = await raster.readWindow(0, 0, 20, 20);
    const b = await raster.readWindow(250, 150, 20, 20); // another tile
    expect(a[0]).toBeCloseTo(elevation(0, 0), 3);
    expect(b[0]).toBeCloseTo(elevation(250, 150), 3);
    expect(server.ranges).toHaveLength(1); // only the header range
    expect(server.wholeFetches()).toBe(1);
  });

  it('retries a dropped connection', async () => {
    const server = serve(makeFile());
    let failures = 1;
    const flaky: FetchFn = async (url, init) => {
      if (failures-- > 0) throw new TypeError('Failed to fetch');
      return server.fetchFn(url, init);
    };
    const raster = new CogRaster('https://example.test/flaky.tif', flaky);
    expect((await raster.readWindow(0, 0, 4, 4))[0]).toBeCloseTo(elevation(0, 0), 3);
  });

  it('reads again after a failed attempt instead of keeping the failure', async () => {
    for (const reportSize of [false, true]) {
      const server = serve(makeFile(), reportSize);
      let down = true;
      const outage: FetchFn = async (url, init) =>
        down ? new Response('busy', { status: 503 }) : server.fetchFn(url, init);
      const raster = new CogRaster(`https://example.test/outage-${reportSize}.tif`, outage);
      await expect(raster.readWindow(0, 0, 4, 4)).rejects.toThrow('HTTP 503');
      down = false;
      expect((await raster.readWindow(0, 0, 4, 4))[0]).toBeCloseTo(elevation(0, 0), 3);
    }
  });

  it('reads again when the tiles fail after the header loaded', async () => {
    const server = serve(makeFile(), true);
    let down = false;
    const outage: FetchFn = async (url, init) =>
      down ? new Response('busy', { status: 503 }) : server.fetchFn(url, init);
    const raster = new CogRaster('https://example.test/tiles-outage.tif', outage);
    await raster.header();
    down = true;
    await expect(raster.readWindow(0, 0, 4, 4)).rejects.toThrow('HTTP 503');
    down = false;
    expect((await raster.readWindow(0, 0, 4, 4))[0]).toBeCloseTo(elevation(0, 0), 3);
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
