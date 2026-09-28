import { describe, expect, it } from 'vitest';
import {
  curvatureDrop,
  destinationPoint,
  distanceM,
  EARTH_RADIUS_M,
  elevationAngleDeg,
  initialBearingDeg,
  normalizeLon,
} from './geodesy';

const ONE_DEG_M = (EARTH_RADIUS_M * Math.PI) / 180;

describe('curvatureDrop', () => {
  it('is ≈ 682.8 m at 100 km with k = 0.13', () => {
    expect(curvatureDrop(100_000)).toBeCloseTo(682.8, 1);
  });

  it('is the plain geometric drop with k = 0', () => {
    expect(curvatureDrop(100_000, 0)).toBeCloseTo(784.8, 1);
  });
});

describe('elevationAngleDeg', () => {
  it('is 45° for a target as high above the observer as it is far (ignoring curvature)', () => {
    expect(elevationAngleDeg(1000, 0, 1000, 1)).toBeCloseTo(45, 10);
  });

  it('includes the curvature drop', () => {
    const expected = (Math.atan2(3000 - 682.8 - 1000, 100_000) * 180) / Math.PI;
    expect(elevationAngleDeg(3000, 1000, 100_000)).toBeCloseTo(expected, 3);
  });
});

describe('destinationPoint', () => {
  it('moves one degree east along the equator', () => {
    const p = destinationPoint(0, 0, 90, ONE_DEG_M);
    expect(p.lat).toBeCloseTo(0, 9);
    expect(p.lon).toBeCloseTo(1, 9);
  });

  it('moves one degree north along a meridian', () => {
    const p = destinationPoint(46, 8, 0, ONE_DEG_M);
    expect(p.lat).toBeCloseTo(47, 9);
    expect(p.lon).toBeCloseTo(8, 9);
  });

  it('wraps across the antimeridian', () => {
    const p = destinationPoint(0, 179.5, 90, ONE_DEG_M);
    expect(p.lon).toBeCloseTo(-179.5, 9);
  });

  it('round-trips with distanceM and initialBearingDeg', () => {
    for (const [lat, lon, brg, d] of [
      [47.4211, 10.9853, 37, 180_000],
      [35.3606, 138.7274, 250, 90_000],
      [-43.6, 170.1, 300, 250_000],
    ] as const) {
      const p = destinationPoint(lat, lon, brg, d);
      expect(distanceM(lat, lon, p.lat, p.lon)).toBeCloseTo(d, 3);
      expect(initialBearingDeg(lat, lon, p.lat, p.lon)).toBeCloseTo(brg, 9);
    }
  });
});

describe('normalizeLon', () => {
  it('maps into [-180, 180)', () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(180)).toBe(-180);
  });
});
