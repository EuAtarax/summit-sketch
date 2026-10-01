import { describe, expect, it } from 'vitest';
import { crsOf, LAEA_EUROPE, LV95 } from './crs';

describe('LAEA Europe (EPSG:3035)', () => {
  it('matches the worked example of IOGP Guidance Note 7-2', () => {
    const p = LAEA_EUROPE.forward(50, 5);
    expect(p.e).toBeCloseTo(3962799.45, 1);
    expect(p.n).toBeCloseTo(2999718.85, 1);
  });

  it('puts a BEV tile corner where Austria is', () => {
    // Tile N2600000 E4400000 (lower-left corner) lies in Tyrol.
    const c = LAEA_EUROPE.inverse(4400000, 2600000);
    expect(c.lat).toBeGreaterThan(46.5);
    expect(c.lat).toBeLessThan(47.5);
    expect(c.lon).toBeGreaterThan(10);
    expect(c.lon).toBeLessThan(11.5);
  });

  it.each([
    [52, 10],
    [47.2, 11.4],
    [60.5, 7],
    [37, -5],
    [45.9, 6.87],
  ])('round-trips %f, %f to a centimeter', (lat, lon) => {
    const p = LAEA_EUROPE.forward(lat, lon);
    const back = LAEA_EUROPE.inverse(p.e, p.n);
    expect(back.lat).toBeCloseTo(lat, 7);
    expect(back.lon).toBeCloseTo(lon, 7);
  });
});

describe('crsOf', () => {
  it('defaults to LV95 and finds LAEA by id', () => {
    expect(crsOf({})).toBe(LV95);
    expect(crsOf({ crs: 'EPSG:3035' })).toBe(LAEA_EUROPE);
  });
});
