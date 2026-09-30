import { describe, expect, it } from 'vitest';
import {
  vegetationHeight,
  withLakes,
  patchMinimum,
  pitchSuitability,
  roughness,
  slopeDegrees,
} from './analysis';

const W = 40;
const H = 30;
const CELL = 2;

/** A grid whose value depends on the position, with x growing east and y (row) growing south. */
function grid(fn: (x: number, y: number) => number): Float32Array {
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = fn(x, y);
  return g;
}

describe('slopeDegrees', () => {
  it('is zero on flat ground and matches a known ramp', () => {
    expect(
      slopeDegrees(
        grid(() => 500),
        W,
        H,
        CELL,
      )[15 * W + 20],
    ).toBeCloseTo(0, 6);
    // Rising 1 m per 2 m cell eastwards: tan(slope) = 0.5, about 26.565 degrees.
    const east = slopeDegrees(
      grid((x) => x * 1),
      W,
      H,
      CELL,
    );
    expect(east[15 * W + 20]).toBeCloseTo(Math.atan(0.5) * (180 / Math.PI), 4);
    // The same ramp towards the south gives the same slope (direction does not matter).
    const south = slopeDegrees(
      grid((_x, y) => y * 1),
      W,
      H,
      CELL,
    );
    expect(south[15 * W + 20]).toBeCloseTo(Math.atan(0.5) * (180 / Math.PI), 4);
  });

  it('is NaN on the border and next to missing data', () => {
    const g = grid(() => 100);
    g[15 * W + 20] = Number.NaN;
    const s = slopeDegrees(g, W, H, CELL);
    expect(Number.isNaN(s[0]!)).toBe(true);
    expect(Number.isNaN(s[15 * W + 21]!)).toBe(true);
    expect(Number.isNaN(s[15 * W + 24]!)).toBe(false);
  });
});

describe('roughness', () => {
  it('is zero on any plane, however steep', () => {
    const r = roughness(
      grid((x, y) => 3 * x - 2 * y),
      W,
      H,
      CELL,
    );
    expect(r[15 * W + 20]).toBeCloseTo(0, 5);
  });

  it('is large where the surface is bumpy at the pitch scale', () => {
    const bumpy = roughness(
      grid((x, y) => ((x + y) % 2 === 0 ? 0.4 : 0)),
      W,
      H,
      CELL,
    );
    const smooth = roughness(
      grid((x) => x * 0.05),
      W,
      H,
      CELL,
    );
    expect(bumpy[15 * W + 20]!).toBeGreaterThan(0.15);
    expect(smooth[15 * W + 20]!).toBeLessThan(0.001);
  });
});

describe('vegetationHeight', () => {
  // A 4 x 4 cell terrain (2 m) and its 16 x 16 surface (0.5 m), factor 4.
  const W = 4;
  const F = 4;
  const flatTerrain = new Float32Array(W * W).fill(100);
  const surfaceWith = (set: (x: number, y: number) => number) =>
    Float32Array.from({ length: (W * F) ** 2 }, (_, i) =>
      set(i % (W * F), Math.floor(i / (W * F))),
    );

  it('keeps a small tree crown at full height instead of averaging it away', () => {
    // A 1 x 1 m crown (2 x 2 pixels) of 10 m in cell (1, 1).
    const surface = surfaceWith((x, y) => (x >= 5 && x <= 6 && y >= 5 && y <= 6 ? 110 : 100));
    const h = vegetationHeight(surface, flatTerrain, W, W, F);
    expect(h[1 * W + 1]).toBeCloseTo(10, 5);
    expect(h[0]).toBe(0);
  });

  it('ignores a single-pixel spike, and never goes negative', () => {
    const surface = surfaceWith((x, y) => (x === 5 && y === 5 ? 120 : y > 12 ? 99 : 100));
    const h = vegetationHeight(surface, flatTerrain, W, W, F);
    expect(h[1 * W + 1]).toBe(0);
    expect(h[3 * W + 3]).toBe(0);
  });

  it('reads a bare slope as bare, thanks to the interpolated ground', () => {
    // Ground rising 1 m per 2 m cell to the east; the surface follows it exactly.
    const terrain = Float32Array.from({ length: W * W }, (_, i) => 100 + (i % W));
    const surface = surfaceWith((x) => 100 + (x + 0.5) / F - 0.5);
    const h = vegetationHeight(surface, terrain, W, W, F);
    for (const v of h.subarray(W, 2 * W)) expect(v).toBeLessThan(0.3);
  });

  it('is NaN where the surface has no data', () => {
    const h = vegetationHeight(
      new Float32Array((W * F) ** 2).fill(Number.NaN),
      flatTerrain,
      W,
      W,
      F,
    );
    expect(Number.isNaN(h[5]!)).toBe(true);
  });
});

describe('pitchSuitability', () => {
  const s = (slope: number, rough: number, canopy?: number) =>
    pitchSuitability(
      Float32Array.of(slope),
      Float32Array.of(rough),
      canopy === undefined ? undefined : Float32Array.of(canopy),
    )[0]!;

  it('rates gentle smooth open ground as fully suitable', () => {
    expect(s(2, 0.03, 0.1)).toBeCloseTo(1, 6);
  });

  it('rules a cell out when any one criterion fails', () => {
    expect(s(14, 0.03, 0.1)).toBe(0); // too steep
    expect(s(2, 0.5, 0.1)).toBe(0); // boulders
    expect(s(2, 0.03, 6)).toBe(0); // forest
  });

  it('degrades smoothly between the thresholds', () => {
    const mid = s(7.5, 0.03);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    expect(s(6, 0.03)).toBeGreaterThan(s(8, 0.03));
  });

  it('keeps missing data as missing', () => {
    expect(Number.isNaN(s(Number.NaN, 0.03))).toBe(true);
  });
});

describe('patchMinimum', () => {
  it('needs a whole patch of good cells, not a single lucky one', () => {
    const w = 9;
    const good = new Float32Array(w * w);
    good[4 * w + 4] = 1; // a lone good cell
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) good[(y + 5) * w + (x + 5)] = 1; // a 3 x 3 patch (bottom right)
    const kept = patchMinimum(good, w, w, 1);
    expect(kept[4 * w + 4]).toBe(0); // the lone cell is gone
    expect(kept[6 * w + 6]).toBe(1); // the centre of the patch survives
    expect(kept[5 * w + 5]).toBe(0); // its corner does not
  });

  it('treats the border and NaN as unsuitable', () => {
    const w = 5;
    const g = new Float32Array(w * w).fill(1);
    g[2 * w + 2] = Number.NaN;
    const kept = patchMinimum(g, w, w, 1);
    expect(kept[0]).toBe(0);
    expect(kept[1 * w + 1]).toBe(0); // next to the NaN
  });
});

describe('withLakes', () => {
  it('marks mapped lakes and keeps the flat-surface marks and gaps', () => {
    const flat = Float32Array.of(0, 1, Number.NaN, 0);
    const out = withLakes(flat, Uint8Array.of(1, 0, 1, 0));
    expect(Array.from(out)).toEqual([1, 1, 1, 0]);
  });
});
