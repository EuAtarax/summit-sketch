import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SUITABILITY, patchMinimum, pitchSuitability } from './analysis';
import type { FetchFn } from './cog';
import { runAnalysis, type AnalysisResult, type Progress } from './pipeline';
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

describe('runAnalysis', () => {
  let tile: Uint8Array;
  let result: AnalysisResult;
  const progress: Progress[] = [];

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
    const fetchFn: FetchFn = async (url, init) => {
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
    // Window E 2722200-2722600, N 1204400-1204800 (x 100..300, y 100..300).
    result = await runAnalysis(
      { e: 2722400, n: 1204600, halfSizeM: 200, canopy: false },
      (p) => progress.push(p),
      fetchFn,
    );
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
    expect(progress.at(-1)!.stage).toBe('analysis');
    expect(result.canopy).toBeUndefined();
  });

  it('finds the lake, the meadow and the flank', () => {
    // The lake lies in the north-west of the window (x 100..149, y < 250).
    expect(result.water[cell(10, 20)]).toBe(1);
    expect(result.water[cell(100, 30)]).toBe(0); // meadow
    expect(result.slope[cell(100, 30)]).toBeCloseTo(Math.atan(0.03) * (180 / Math.PI), 1);
    expect(result.slope[cell(100, 170)]).toBeGreaterThan(30); // the flank (y >= 250 is row 150)
  });

  it('suggests the meadow, not the lake and not the flank', () => {
    const score = (excludeWater: boolean) => {
      const params = { ...DEFAULT_SUITABILITY, excludeWater };
      return patchMinimum(
        pitchSuitability(result.slope, result.roughness, undefined, params, result.water),
        200,
        200,
        params.patchRadiusCells,
      );
    };
    const strict = score(true);
    expect(strict[cell(100, 30)]).toBeGreaterThan(0.95); // meadow
    expect(strict[cell(10, 20)]).toBe(0); // lake ruled out
    expect(strict[cell(100, 170)]).toBe(0); // flank
    // Without the water rule the perfectly flat lake would look like the best place to camp.
    expect(score(false)[cell(10, 20)]).toBeGreaterThan(0.95);
  });
});
