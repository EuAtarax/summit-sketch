import { describe, expect, it } from 'vitest';
import { DEFAULT_SUITABILITY } from './analysis';
import { lv95ToWgs84 } from './lv95';
import { CampModel, type ScoreSettings } from './model';
import type { AnalysisResult } from './pipeline';
import { DEFAULT_NEARBY } from './scoring';

/**
 * A 200 x 200 cell (400 m) area near Schwanden GL: steep everywhere except a flat, smooth
 * meadow of 40 x 40 cells in the north-west quarter, next to a trail.
 */
function result(): AnalysisResult {
  const w = 200;
  const n = w * w;
  const slope = new Float32Array(n).fill(25);
  for (let row = 20; row < 60; row++) for (let col = 20; col < 60; col++) slope[row * w + col] = 2;
  return {
    geometry: { e0: 2722000, n0: 1205000, cell: 2, width: w, height: w },
    slope,
    roughness: new Float32Array(n).fill(0.02),
    water: new Float32Array(n),
    trailDistance: new Float32Array(n).fill(50),
    drinking: [],
    areas: [],
    warnings: [],
    millis: 1,
  };
}

const SETTINGS: ScoreSettings = {
  suitability: DEFAULT_SUITABILITY,
  nearby: DEFAULT_NEARBY,
  hideProtected: true,
};

describe('CampModel', () => {
  it('finds the flat meadow and returns spots with positions and descriptions', () => {
    const model = new CampModel(result());
    const spots = model.rescore(SETTINGS);
    expect(spots.length).toBeGreaterThanOrEqual(1);
    const best = spots[0]!;
    expect(best.rank).toBe(1);
    expect(best.detail).toContain('2° slope');
    // Inside the meadow: E 2722040-2722120, N 1204880-1204960.
    const sw = lv95ToWgs84(2722040, 1204880);
    const ne = lv95ToWgs84(2722120, 1204960);
    expect(best.lat).toBeGreaterThan(sw.lat);
    expect(best.lat).toBeLessThan(ne.lat);
    expect(best.lon).toBeGreaterThan(sw.lon);
    expect(best.lon).toBeLessThan(ne.lon);
  });

  it('only rescores when the scoring settings change', () => {
    const model = new CampModel(result());
    const a = model.rescore(SETTINGS);
    expect(model.rescore({ ...SETTINGS })).toBe(a); // same settings: same answer, no work
    const strict = {
      ...SETTINGS,
      suitability: { ...DEFAULT_SUITABILITY, slopeMaxDeg: 1.5, slopeOkDeg: 1 },
    };
    expect(model.rescore(strict)).toHaveLength(0); // the 2° meadow is now too steep
  });

  it('paints the score layer, and nothing where there is no data for a layer', () => {
    const model = new CampModel(result());
    model.rescore(SETTINGS);
    const pixels = model.paint('score', 'green')!;
    expect(pixels.rgba).toHaveLength(pixels.width * pixels.height * 4);
    const visible = pixels.rgba.filter((_, i) => i % 4 === 3 && pixels.rgba[i]! > 0).length;
    // The meadow is 4 % of the area; allow for the patch margin and the resampling.
    expect(visible / (pixels.width * pixels.height)).toBeGreaterThan(0.02);
    expect(visible / (pixels.width * pixels.height)).toBeLessThan(0.06);
    expect(model.paint('canopy', 'green')).toBeNull();
  });

  it('describes the cell under a position, and nothing outside the area', () => {
    const model = new CampModel(result());
    model.rescore(SETTINGS);
    const meadow = lv95ToWgs84(2722081, 1204919);
    expect(model.describeAt(meadow.lat, meadow.lon)).toMatch(
      /^Score \d+ %, 2° slope, 50 m from a trail/,
    );
    const far = lv95ToWgs84(2730000, 1204919);
    expect(model.describeAt(far.lat, far.lon)).toBeNull();
  });
});
