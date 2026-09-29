import { describe, expect, it } from 'vitest';
import { isInSwitzerland, lv95ToWgs84, wgs84ToLv95 } from './lv95';

/** Distance in meters between two LV95 points. */
const dist = (a: { e: number; n: number }, b: { e: number; n: number }) =>
  Math.hypot(a.e - b.e, a.n - b.n);

describe('LV95 conversion', () => {
  it('maps the old Bern observatory (the grid origin) to 2600000 / 1200000', () => {
    // swisstopo reference: 46 deg 57' 03.9" N, 7 deg 26' 19.1" E.
    const p = wgs84ToLv95(46.951083, 7.438639);
    expect(dist(p, { e: 2600000, n: 1200000 })).toBeLessThan(2);
  });

  it('inverts itself within centimeters across Switzerland', () => {
    for (const [lat, lon] of [
      [47.3769, 8.5417], // Zurich
      [46.2044, 6.1432], // Geneva
      [46.9866, 9.0321], // Ijenstock (GL)
      [46.5197, 10.4633], // near Livigno, eastern edge
      [46.0207, 8.9511], // Lugano area, south
    ] as const) {
      const p = wgs84ToLv95(lat, lon);
      const back = lv95ToWgs84(p.e, p.n);
      expect(Math.abs(back.lat - lat)).toBeLessThan(2e-5); // about 2 m
      expect(Math.abs(back.lon - lon)).toBeLessThan(2e-5);
    }
  });

  it('places the swissALTI3D tile 2722-1204 where the STAC search found it (Glarus Sud)', () => {
    // Tile ids are the km coordinates of the south-west corner.
    const center = lv95ToWgs84(2722500, 1204500);
    expect(center.lat).toBeGreaterThan(46.97);
    expect(center.lat).toBeLessThan(47.01);
    expect(center.lon).toBeGreaterThan(9.03);
    expect(center.lon).toBeLessThan(9.09);
  });

  it('knows the rough extent of Switzerland', () => {
    expect(isInSwitzerland(46.99, 9.03)).toBe(true);
    expect(isInSwitzerland(48.85, 2.35)).toBe(false); // Paris
  });
});
