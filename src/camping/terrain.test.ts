import { beforeAll, describe, expect, it } from 'vitest';
import type { FetchFn } from './cog';
import { buildTestTiff } from './testTiff';
import {
  loadWindow,
  tilesForWindow,
  windowBounds,
  windowCorners,
  wgs84Envelope,
  type Product,
} from './terrain';

describe('windowBounds', () => {
  it('snaps to the cell grid and keeps the requested size', () => {
    const b = windowBounds(2722503.7, 1204811.2, 100, 2);
    expect(b.e0 % 2).toBe(0);
    expect(b.n0 % 2).toBe(0);
    expect(b.width).toBe(100);
    expect(b.height).toBe(100);
    expect(b.e0).toBeLessThanOrEqual(2722503.7 - 100);
    expect(b.n0).toBeGreaterThanOrEqual(1204811.2 + 100);
  });
});

describe('tilesForWindow', () => {
  it('names tiles by their south-west corner in km', () => {
    // A 400 m window straddling the boundary between tile columns 2722 and 2723.
    expect(tilesForWindow(2722900, 1204300, { w: 400, h: 400 }).sort()).toEqual([
      '2722-1203',
      '2722-1204',
      '2723-1203',
      '2723-1204',
    ]);
    // A window that ends exactly on a tile edge does not touch the next tile.
    expect(tilesForWindow(2722000, 1205000, { w: 1000, h: 1000 })).toEqual(['2722-1204']);
  });
});

/** Elevation as a function of the LV95 position, so every cell has a known value. */
const surface = (e: number, n: number) => 1000 + 0.01 * (e - 2722000) + 0.02 * (n - 1204000);

describe('loadWindow', () => {
  const product: Product = { collection: 'ch.test.window', gsd: 2 };
  const tiles = new Map<string, Uint8Array>();

  beforeAll(() => {
    for (const eKm of [2722, 2723]) {
      const values = new Float32Array(500 * 500);
      for (let y = 0; y < 500; y++) {
        for (let x = 0; x < 500; x++) {
          values[y * 500 + x] = surface(eKm * 1000 + x * 2, 1205000 - y * 2);
        }
      }
      tiles.set(
        `${eKm}-1204`,
        buildTestTiff({
          width: 500,
          height: 500,
          tileSize: 128,
          values,
          originX: eKm * 1000,
          originY: 1205000,
          pixelSize: 2,
        }),
      );
    }
  }, 60_000);

  const fetchFn: FetchFn = async (url, init) => {
    if (url.includes('/items')) {
      const features = [...tiles.keys()].map((key) => ({
        id: `test_2019_${key}`,
        assets: {
          a: { href: `https://x/${key}.tif`, type: 'image/tiff; application=geotiff', 'eo:gsd': 2 },
        },
      }));
      return new Response(JSON.stringify({ features }), { status: 200 });
    }
    const file = tiles.get(/\/(\d{4}-\d{4})\.tif/.exec(url)![1]!)!;
    const [start, end] = new Headers(init.headers)
      .get('Range')!
      .replace('bytes=', '')
      .split('-')
      .map(Number) as [number, number];
    return new Response(file.slice(start, end + 1), { status: 206 });
  };

  it('stitches a window across two tiles at the right positions', async () => {
    // Centered on the boundary between the two tiles, 100 m half size, well inside N.
    const w = await loadWindow(product, 2723000, 1204500, 100, undefined, fetchFn);
    expect(w.width).toBe(100);
    for (const [col, row] of [
      [0, 0],
      [49, 10],
      [50, 10], // first column of the east tile
      [99, 99],
    ] as const) {
      const e = w.e0 + col * w.cell;
      const n = w.n0 - row * w.cell;
      expect(w.data[row * w.width + col]).toBeCloseTo(surface(e, n), 2);
    }
    expect(w.data.some(Number.isNaN)).toBe(false);
  });

  it('leaves NaN where no tile exists and reports progress', async () => {
    const progress: number[] = [];
    // Straddles the eastern edge of the two available tiles (column 2724 does not exist).
    const w = await loadWindow(product, 2724000, 1204500, 100, (d) => progress.push(d), fetchFn);
    expect(Number.isNaN(w.data[10 * w.width + w.width - 1]!)).toBe(true);
    expect(Number.isNaN(w.data[10 * w.width]!)).toBe(false);
    expect(progress.at(-1)).toBeGreaterThan(0);
  });
});

describe('windowCorners', () => {
  it('returns the corners of the window around the right place, about its size apart', () => {
    // 1 km window at the Glarus Sud test tile.
    const c = windowCorners({ e0: 2722000, n0: 1205000, cell: 2, width: 500, height: 500 });
    expect(c).toHaveLength(4);
    const dLat = Math.abs(c[0]![0] - c[3]![0]) * 111_200;
    expect(dLat).toBeGreaterThan(950);
    expect(dLat).toBeLessThan(1050);
    for (const [lat, lon] of c) {
      expect(lat).toBeGreaterThan(46.97);
      expect(lat).toBeLessThan(47.01);
      expect(lon).toBeGreaterThan(9.03);
      expect(lon).toBeLessThan(9.09);
    }
  });
});

describe('wgs84Envelope', () => {
  const g = { e0: 2722000, n0: 1205000, cell: 2, width: 500, height: 500 };

  it('contains all four corners even though the grid is rotated against north', () => {
    const [west, south, east, north] = wgs84Envelope(g);
    for (const [lat, lon] of windowCorners(g)) {
      expect(lon).toBeGreaterThanOrEqual(west);
      expect(lon).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
    // The two opposite corners alone (south-west and north-east) would miss part of it.
    const corners = windowCorners(g);
    expect(Math.min(...corners.map((c) => c[1]))).toBe(west);
  });

  it('grows by the margin on every side', () => {
    const plain = wgs84Envelope(g);
    const grown = wgs84Envelope(g, 100);
    expect(plain[0] - grown[0]).toBeGreaterThan(0.0008);
    expect(grown[3] - plain[3]).toBeGreaterThan(0.0008);
  });
});
