import { describe, expect, it } from 'vitest';
import { lonLatToTile, metersPerPixel, tileToLonLat } from './tiles';

describe('lonLatToTile', () => {
  it('maps the origin to the center of the world', () => {
    const { x, y } = lonLatToTile(0, 0, 1);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(1, 12);
  });

  it('matches a known tile (Zugspitze at z12)', () => {
    const { x, y } = lonLatToTile(47.4211, 10.9853, 12);
    expect(Math.floor(x)).toBe(2172);
    expect(Math.floor(y)).toBe(1433);
  });

  it('round-trips through tileToLonLat', () => {
    for (const [lat, lon] of [
      [47.4211, 10.9853],
      [35.3606, 138.7274],
      [-33.9, -70.1],
    ] as const) {
      const t = lonLatToTile(lat, lon, 15);
      const back = tileToLonLat(t.x, t.y, 15);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });
});

describe('metersPerPixel', () => {
  it('is ~156 km at z0 on the equator', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 2);
  });

  it('halves per zoom level and shrinks with cos(lat)', () => {
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 9) / 4, 6);
  });
});
