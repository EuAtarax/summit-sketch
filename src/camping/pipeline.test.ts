import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SUITABILITY, patchMinimum, pitchSuitability } from './analysis';
import type { FetchFn } from '../net/fetch';
import { lv95ToWgs84 } from './lv95';
import { runAnalysis, type AnalysisParams, type AnalysisResult, type Progress } from './pipeline';
import { buildTestTiff } from './testTiff';

/**
 * One synthetic 1 km tile (E 2722000-2723000, N 1204000-1205000, 2 m cells):
 * a lake at exactly 1421 m (x < 150, y < 250), a gentle meadow (x >= 150, y < 250,
 * 3 % slope, about 1.7 degrees) and a steep 35 degree flank (y >= 250).
 */
const surface = (x: number, y: number): number => {
  if (y >= 250) return 1500 + (y - 250) * 2 * 0.7;
  return x < 150 ? 1421 : 1500 + (x - 150) * 2 * 0.03;
};

/** The analysis window: E 2722200-2722600, N 1204400-1204800 (tile pixels x 100..300, y 100..300). */
const PARAMS: AnalysisParams = {
  e: 2722400,
  n: 1204600,
  halfSizeM: 200,
  canopy: false,
  date: new Date('2026-07-15T12:00:00').getTime(),
};

const ll = (e: number, n: number) => lv95ToWgs84(e, n);
const geoRing = (e0: number, n0: number, e1: number, n1: number) =>
  [
    [e0, n0],
    [e1, n0],
    [e1, n1],
    [e0, n1],
    [e0, n0],
  ].map(([e, n]) => {
    const p = ll(e!, n!);
    return [p.lon, p.lat];
  });

/** What the fake services answer. */
const OSM_ANSWER = {
  elements: [
    // A footpath along the row of N 1204700, from E 2722300 to 2722500.
    {
      type: 'way',
      tags: { highway: 'path' },
      geometry: [ll(2722300, 1204700), ll(2722500, 1204700)],
    },
    // A mapped pond on the sloping meadow (E 2722380-2722420, N 1204700-1204720): not flat in
    // the terrain, so only its outline marks it.
    {
      type: 'way',
      tags: { natural: 'water' },
      geometry: [
        ll(2722380, 1204700),
        ll(2722420, 1204700),
        ll(2722420, 1204720),
        ll(2722380, 1204720),
        ll(2722380, 1204700),
      ],
    },
    // A fountain at E 2722500, N 1204500.
    { type: 'node', ...ll(2722500, 1204500), tags: { amenity: 'drinking_water', name: 'Brunnen' } },
  ],
};
const IDENTIFY_ANSWER = {
  results: [
    {
      layerBodId: 'ch.bafu.bundesinventare-jagdbanngebiete',
      geometry: { type: 'Polygon', coordinates: [geoRing(2722400, 1204400, 2722600, 1204600)] },
      properties: { gebietsname: 'Testbann', typ_de: 'Integraler Schutz' },
    },
  ],
};

describe('runAnalysis', () => {
  let tile: Uint8Array;
  let result: AnalysisResult;
  const progress: Progress[] = [];

  const services =
    (options: { osm?: boolean; identify?: boolean } = {}): FetchFn =>
    async (url, init) => {
      if (url.includes('overpass')) {
        return options.osm === false
          ? new Response('busy', { status: 503 })
          : new Response(JSON.stringify(OSM_ANSWER), { status: 200 });
      }
      if (url.includes('identify')) {
        return options.identify === false
          ? new Response('down', { status: 503 })
          : new Response(JSON.stringify(IDENTIFY_ANSWER), { status: 200 });
      }
      if (url.includes('/items')) {
        const features = [
          {
            id: 'swissalti3d_2019_2722-1204',
            assets: {
              a: { href: 'https://x/t.tif', type: 'image/tiff; application=geotiff', 'eo:gsd': 2 },
            },
          },
        ];
        return new Response(JSON.stringify({ features }), { status: 200 });
      }
      const range = new Headers(init.headers).get('Range');
      if (!range) return new Response(tile.slice(), { status: 200 });
      const [start, end] = range.replace('bytes=', '').split('-').map(Number) as [number, number];
      const last = Math.min(end, tile.length - 1);
      return new Response(tile.slice(start, last + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${last}/${tile.length}` },
      });
    };

  beforeAll(async () => {
    const values = new Float32Array(500 * 500);
    for (let y = 0; y < 500; y++) for (let x = 0; x < 500; x++) values[y * 500 + x] = surface(x, y);
    tile = buildTestTiff({
      width: 500,
      height: 500,
      tileSize: 128,
      values,
      originX: 2722000,
      originY: 1205000,
      pixelSize: 2,
    });
    result = await runAnalysis(PARAMS, (p) => progress.push(p), {
      fetchFn: services(),
      osmBackoffMs: [],
    });
  }, 60_000);

  const cell = (col: number, row: number) => row * result.geometry.width + col;

  it('reports its geometry and progress', () => {
    expect(result.geometry).toMatchObject({
      e0: 2722200,
      n0: 1204800,
      cell: 2,
      width: 200,
      height: 200,
    });
    expect(progress.some((p) => p.stage === 'terrain')).toBe(true);
    expect(progress.some((p) => p.stage === 'features')).toBe(true);
    expect(result.canopy).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('rules out a mapped pond the terrain does not show as flat, with its shore', () => {
    expect(result.water[cell(100, 45)]).toBe(1); // inside the outline (rows 40-49)
    expect(result.water[cell(100, 51)]).toBe(1); // the 4 m shore buffer
    expect(result.water[cell(100, 54)]).toBe(0);
    expect(result.water[cell(80, 45)]).toBe(0);
  });

  it('finds the lake, the meadow and the flank', () => {
    expect(result.water[cell(10, 20)]).toBe(1);
    expect(result.water[cell(100, 30)]).toBe(0);
    expect(result.slope[cell(100, 30)]).toBeCloseTo(Math.atan(0.03) * (180 / Math.PI), 1);
    expect(result.slope[cell(100, 170)]).toBeGreaterThan(30);
  });

  it('suggests the meadow, not the lake and not the flank', () => {
    const params = DEFAULT_SUITABILITY;
    const strict = patchMinimum(
      pitchSuitability(result.slope, result.roughness, undefined, params, result.water),
      200,
      200,
      params.patchRadiusCells,
    );
    expect(strict[cell(100, 30)]).toBeGreaterThan(0.95);
    expect(strict[cell(10, 20)]).toBe(0);
    expect(strict[cell(100, 170)]).toBe(0);
  });

  it('measures the distance to the trail and to the drinking-water source', () => {
    // The path is on row 50 (N 1204700), columns 50..150.
    expect(result.trailDistance![cell(100, 50)]).toBeLessThan(2);
    expect(result.trailDistance![cell(100, 60)]).toBeCloseTo(20, -1); // 10 rows = 20 m south
    // The fountain is at column 150, row 150.
    expect(result.drinkingDistance![cell(150, 150)]).toBe(0);
    expect(result.drinkingDistance![cell(150, 160)]).toBeCloseTo(20, -1);
    expect(result.drinking).toHaveLength(1);
    expect(result.drinking[0]).toMatchObject({ kind: 'drinking_water', name: 'Brunnen' });
  });

  it('paints the protected area onto the grid and lists it without its outline', () => {
    expect(result.protectionIndex![cell(150, 150)]).toBe(1); // inside E 2722400-2722600, N 1204400-1204600
    expect(result.protectionIndex![cell(10, 10)]).toBe(0);
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0]).toMatchObject({
      kind: 'Game reserve',
      name: 'Testbann',
      inForce: true,
      restricts: true,
    });
    expect(result.areas[0]).not.toHaveProperty('polygons');
  });

  it('still delivers the terrain when the OpenStreetMap server is down, with a warning', async () => {
    const r = await runAnalysis(PARAMS, () => {}, {
      fetchFn: services({ osm: false }),
      osmBackoffMs: [],
    });
    expect(r.trailDistance).toBeUndefined();
    expect(r.drinking).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/OpenStreetMap/);
    expect(r.protectionIndex).toBeDefined();
    expect(r.slope[r.geometry.width * 30 + 100]).toBeGreaterThan(0);
  });

  it('still delivers the terrain when the protected-area service is down, with a warning', async () => {
    const r = await runAnalysis(PARAMS, () => {}, {
      fetchFn: services({ identify: false }),
      osmBackoffMs: [],
    });
    expect(r.protectionIndex).toBeUndefined();
    expect(r.areas).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Protected areas/);
    expect(r.trailDistance).toBeDefined();
  });
});
