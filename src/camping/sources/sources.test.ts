import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../../net/fetch';
import { countryForIso } from '../countries';
import { sampleInto } from '../resample';
import type { GridGeometry } from '../terrain';
import { buildTiff } from '../testTiff';
import { bevTilesFor, bevUrl } from './austria';
import { franceSource, ignUrl } from './france';

/** A tilted plane, so resampling errors show. */
const plane = (e: number, n: number) => 1000 + 0.1 * (e - 4_400_000) - 0.05 * (n - 2_600_000);

describe('sampleInto', () => {
  // Source pixels of 2.00004 m with a half-pixel offset against the grid, as BEV overviews.
  const ps = 2.00004;
  const originX = 4_399_999.5;
  const originY = 2_600_400.5;
  const w = 250;
  const h = 250;
  const data = Float32Array.from({ length: w * h }, (_, i) =>
    plane(originX + ((i % w) + 0.5) * ps, originY - (Math.floor(i / w) + 0.5) * ps),
  );
  const block = { data, width: w, height: h, originX, originY, pixelSize: ps };
  const g: GridGeometry = { e0: 4_400_100, n0: 2_600_300, cell: 2, width: 20, height: 20 };

  it('reproduces a plane bilinearly at the cell centers', () => {
    const out = new Float32Array(400).fill(Number.NaN);
    sampleInto(block, out, g, 1, 'bilinear');
    for (const [col, row] of [
      [0, 0],
      [7, 13],
      [19, 19],
    ] as const) {
      const e = g.e0 + (col + 0.5) * 2;
      const n = g.n0 - (row + 0.5) * 2;
      expect(out[row * 20 + col]).toBeCloseTo(plane(e, n), 1);
    }
  });

  it('leaves cells outside the block and already filled cells alone', () => {
    const far: GridGeometry = { ...g, e0: 4_500_000 };
    const out = new Float32Array(400).fill(Number.NaN);
    sampleInto(block, out, far, 1, 'nearest');
    expect(out.every(Number.isNaN)).toBe(true);
    const filled = new Float32Array(400).fill(7);
    sampleInto(block, filled, g, 1, 'nearest');
    expect(filled[0]).toBe(7);
  });

  it('samples sub-cells for a surface model', () => {
    const out = new Float32Array(40 * 40).fill(Number.NaN);
    sampleInto(block, out, g, 2, 'nearest');
    expect(out.some(Number.isNaN)).toBe(false);
  });
});

describe('Austria (BEV)', () => {
  it('finds the 50 km tiles a box overlaps, and none outside Austria', () => {
    // Around Innsbruck, straddling the tile border at E 4 450 000.
    const tiles = bevTilesFor(4_449_000, 2_690_000, 4_451_000, 2_692_000);
    expect(tiles).toEqual([
      { north: 2_650_000, east: 4_400_000 },
      { north: 2_650_000, east: 4_450_000 },
    ]);
    expect(bevTilesFor(4_000_000, 2_000_000, 4_002_000, 2_002_000)).toEqual([]);
  });

  it('reads through the proxy', () => {
    expect(bevUrl('DTM', 2_650_000, 4_400_000)).toMatch(
      /\/bev\/ALS\/DTM\/\d{8}\/ALS_DTM_CRS3035RES50000mN2650000E4400000\.tif$/,
    );
  });
});

describe('France (IGN)', () => {
  it('asks for a box in EPSG:3035, easting first', () => {
    const url = new URL(ignUrl('terrain', 4_078_000, 2_539_000, 4_080_000, 2_541_000, 1000, 1000));
    expect(url.searchParams.get('CRS')).toBe('EPSG:3035');
    expect(url.searchParams.get('VERSION')).toBe('1.3.0'); // the only version IGN accepts
    expect(url.searchParams.get('BBOX')).toBe('4078000,2539000,4080000,2541000');
    expect(url.searchParams.get('FORMAT')).toBe('image/geotiff');
  });

  it('fills the grid from GeoTIFF answers, in pieces for large boxes', async () => {
    const requests: string[] = [];
    const fake: FetchFn = async (url) => {
      requests.push(url);
      const q = new URL(url).searchParams;
      const [e0, , , n1] = q.get('BBOX')!.split(',').map(Number) as [
        number,
        number,
        number,
        number,
      ];
      const width = Number(q.get('WIDTH'));
      const height = Number(q.get('HEIGHT'));
      const step = 2;
      const values = Float32Array.from({ length: width * height }, (_, i) =>
        plane(e0 + ((i % width) + 0.5) * step, n1 - (Math.floor(i / width) + 0.5) * step),
      );
      const tiff = await buildTiff({
        bigTiff: false,
        images: [
          {
            width,
            height,
            values,
            tileSize: null,
            rowsPerStrip: 64,
            compression: 1,
            format: 'f32',
          },
        ],
        originX: e0,
        originY: n1,
        pixelSize: step,
      });
      return new Response(tiff.slice(), { status: 200 });
    };
    const g: GridGeometry = {
      e0: 4_078_000,
      n0: 2_541_000,
      cell: 2,
      width: 1200,
      height: 300,
      crs: 'EPSG:3035',
    };
    const data = await franceSource.terrain(g, () => {}, fake);
    expect(requests).toHaveLength(2); // 1200 columns: two pieces of at most 1000
    for (const [col, row] of [
      [0, 0],
      [999, 150],
      [1000, 150],
      [1199, 299],
    ] as const) {
      expect(data[row * 1200 + col]).toBeCloseTo(
        plane(g.e0 + (col + 0.5) * 2, g.n0 - (row + 0.5) * 2),
        2,
      );
    }
  });
});

describe('countryForIso', () => {
  it('maps Liechtenstein to the Swiss data and knows nothing about Italy yet', () => {
    expect(countryForIso('LI')?.id).toBe('ch');
    expect(countryForIso('at')?.id).toBe('at');
    expect(countryForIso('it')).toBeNull();
  });
});
