import { describe, expect, it } from 'vitest';
import {
  campScore,
  DEFAULT_NEARBY,
  FLOORS,
  distanceFactor,
  nearnessFactor,
  pickSpots,
  TRAIL_CLEARANCE_M,
  TRAIL_QUIET_M,
  type NearbyParams,
} from './scoring';

describe('nearnessFactor', () => {
  it('is 1 up to the distance, fades linearly and reaches the floor at twice the distance', () => {
    expect(nearnessFactor(0, 300, 0.2)).toBe(1);
    expect(nearnessFactor(300, 300, 0.2)).toBe(1);
    expect(nearnessFactor(450, 300, 0.2)).toBeCloseTo(0.6, 6); // halfway
    expect(nearnessFactor(600, 300, 0.2)).toBeCloseTo(0.2, 6);
    expect(nearnessFactor(5000, 300, 0.2)).toBeCloseTo(0.2, 6);
  });

  it('gives the floor when there is no such feature at all', () => {
    expect(nearnessFactor(Infinity, 300, 0.4)).toBe(0.4);
  });
});

describe('distanceFactor', () => {
  it('rises from the floor at the feature to 1 at the minimum distance', () => {
    expect(distanceFactor(0, 300, 0.2)).toBeCloseTo(0.2, 6);
    expect(distanceFactor(150, 300, 0.2)).toBeCloseTo(0.6, 6);
    expect(distanceFactor(300, 300, 0.2)).toBe(1);
    expect(distanceFactor(Infinity, 300, 0.2)).toBe(1);
  });
});

describe('campScore', () => {
  const one = (
    inputs: Partial<Parameters<typeof campScore>[0]>,
    nearby: NearbyParams = DEFAULT_NEARBY,
    hide = false,
  ): number => campScore({ suitability: Float32Array.of(1), ...inputs }, nearby, hide)[0]!;

  it('is the plain suitability when nothing is known about the surroundings', () => {
    expect(one({})).toBe(1);
  });

  it('prefers spots near a trail, water and drinking water', () => {
    const near = one({
      trailDistance: Float32Array.of(100),
      waterDistance: Float32Array.of(100),
      drinkingDistance: Float32Array.of(100),
    });
    const far = one({
      trailDistance: Float32Array.of(2000),
      waterDistance: Float32Array.of(2000),
      drinkingDistance: Float32Array.of(2000),
    });
    expect(near).toBe(1);
    expect(far).toBeCloseTo(FLOORS.trail * FLOORS.water * FLOORS.drinking, 6);
  });

  it('does not suggest the path itself, and prefers ground away from it', () => {
    const at = (d: number) => one({ trailDistance: Float32Array.of(d) });
    expect(at(TRAIL_CLEARANCE_M - 1)).toBeLessThan(0.3);
    expect(at(20)).toBeGreaterThan(at(TRAIL_CLEARANCE_M - 1));
    expect(at(40)).toBeGreaterThan(at(20));
    expect(at(40)).toBeLessThan(1);
    expect(at(TRAIL_QUIET_M)).toBe(1);
    expect(at(250)).toBe(1); // still within the preferred 300 m
  });

  it('ignores a preference that is switched off', () => {
    const off: NearbyParams = { ...DEFAULT_NEARBY, trail: 0 };
    expect(one({ trailDistance: Float32Array.of(5000) }, off)).toBe(1);
  });

  it('prefers ground away from water when the water slider is negative', () => {
    const away: NearbyParams = { ...DEFAULT_NEARBY, water: -300 };
    const at = (d: number) => one({ waterDistance: Float32Array.of(d) }, away);
    expect(at(0)).toBeCloseTo(FLOORS.water, 6);
    expect(at(150)).toBeCloseTo((FLOORS.water + 1) / 2, 6);
    expect(at(300)).toBe(1);
    expect(at(Infinity)).toBe(1);
  });

  it('keeps unsuitable and missing cells unsuitable and missing', () => {
    const out = campScore(
      { suitability: Float32Array.of(0, Number.NaN), trailDistance: Float32Array.of(10, 10) },
      DEFAULT_NEARBY,
      false,
    );
    expect(out[0]).toBe(0);
    expect(Number.isNaN(out[1]!)).toBe(true);
  });

  it('cuts ground where a protection hides it, only when asked, and leaves the others', () => {
    const protection = { index: Uint8Array.of(1, 2), hides: [true, false] };
    const inputs = { suitability: Float32Array.of(1, 1), protection };
    expect(Array.from(campScore(inputs, DEFAULT_NEARBY, true))).toEqual([0, 1]);
    expect(Array.from(campScore(inputs, DEFAULT_NEARBY, false))).toEqual([1, 1]);
  });
});

describe('pickSpots', () => {
  const G = { e0: 0, n0: 400, cell: 2, width: 200, height: 200 };

  /** A grid of zeros with square blobs of a given score: [col, row, size, score]. */
  function blobs(list: [number, number, number, number][]): Float32Array {
    const g = new Float32Array(G.width * G.height);
    for (const [c, r, s, v] of list) {
      for (let y = r; y < r + s; y++) for (let x = c; x < c + s; x++) g[y * G.width + x] = v;
    }
    return g;
  }

  it('returns the best place of each area, best first', () => {
    const spots = pickSpots(
      blobs([
        [10, 10, 8, 0.9],
        [120, 120, 8, 0.7],
        [10, 150, 8, 0.95],
      ]),
      G,
      { minSeparationM: 150 },
    );
    expect(spots.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(spots.map((s) => s.score)).toEqual([
      expect.closeTo(0.95, 5),
      expect.closeTo(0.9, 5),
      expect.closeTo(0.7, 5),
    ]);
  });

  it('gives one spot per neighbourhood, not a cluster along the same ridge', () => {
    // One long strip of good ground, 300 m long and 8 m wide: at most 3 spots 150 m apart.
    const strip = new Float32Array(G.width * G.height);
    for (let y = 100; y < 104; y++) for (let x = 10; x < 160; x++) strip[y * G.width + x] = 0.9;
    const spots = pickSpots(strip, G, { count: 10 });
    for (const a of spots)
      for (const b of spots)
        if (a !== b) expect(Math.hypot(a.e - b.e, a.n - b.n)).toBeGreaterThanOrEqual(150);
    expect(spots.length).toBeLessThanOrEqual(3);
  });

  it('skips ground below the minimum score and honors the count', () => {
    const grid = blobs([
      [10, 10, 8, 0.4],
      [120, 120, 8, 0.8],
      [60, 60, 8, 0.8],
    ]);
    expect(pickSpots(grid, G, { minSeparationM: 150 })).toHaveLength(2);
    expect(pickSpots(grid, G, { count: 1 })).toHaveLength(1);
  });

  it('suggests three spots at least 300 m apart by default', () => {
    const wide = { e0: 0, n0: 2000, cell: 2, width: 1000, height: 1000 };
    const grid = new Float32Array(wide.width * wide.height);
    for (const col of [10, 100, 200, 300, 400]) grid[500 * wide.width + col] = 0.9;
    const spots = pickSpots(grid, wide);
    expect(spots).toHaveLength(3);
    expect(spots[1]!.e - spots[0]!.e).toBeGreaterThanOrEqual(300);
  });

  it('reports the LV95 position of the cell center', () => {
    const [spot] = pickSpots(blobs([[50, 40, 1, 1]]), G);
    expect(spot).toMatchObject({ col: 50, row: 40, e: 101, n: 319 });
  });

  it('returns nothing when there is nothing good', () => {
    expect(pickSpots(new Float32Array(G.width * G.height), G)).toEqual([]);
  });
});
