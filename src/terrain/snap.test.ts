import { describe, expect, it } from 'vitest';
import { destinationPoint, distanceM } from '../geo/geodesy';
import { coneTerrain, SyntheticSource } from './syntheticSource';
import { elevationAt, snapToSummit } from './snap';

const TAP = { lat: 46.5, lon: 8.0 };

describe('snapToSummit', () => {
  it('moves to a summit 100 m away', async () => {
    const apex = destinationPoint(TAP.lat, TAP.lon, 60, 100);
    const source = new SyntheticSource(
      coneTerrain([{ ...apex, height: 1000, radiusM: 2000 }], 500),
    );
    const s = await snapToSummit(source, TAP.lat, TAP.lon);
    expect(distanceM(s.lat, s.lon, apex.lat, apex.lon)).toBeLessThan(3); // ~1 z15 pixel
    expect(s.elev).toBeGreaterThan(1497);
    expect(s.elev).toBeLessThanOrEqual(1500);
  });

  it('ignores a higher summit outside the radius', async () => {
    const near = destinationPoint(TAP.lat, TAP.lon, 200, 80);
    const far = destinationPoint(TAP.lat, TAP.lon, 20, 300);
    const source = new SyntheticSource(
      coneTerrain([
        { ...near, height: 200, radiusM: 150 },
        { ...far, height: 2000, radiusM: 100 },
      ]),
    );
    const s = await snapToSummit(source, TAP.lat, TAP.lon);
    expect(distanceM(s.lat, s.lon, near.lat, near.lon)).toBeLessThan(3);
  });
});

describe('elevationAt', () => {
  it('samples the DEM at exactly the given point', async () => {
    const source = new SyntheticSource((lat) => (lat - 46) * 100_000); // 1 m per 0.00001°
    const s = await elevationAt(source, 46.5, 8.0);
    expect(s.lat).toBe(46.5);
    expect(s.lon).toBe(8.0);
    expect(s.elev).toBeCloseTo(50_000, -1); // within ~10 m (one z15 pixel is ~2 m here)
  });
});
