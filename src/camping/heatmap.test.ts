import { describe, expect, it } from 'vitest';
import { LAYERS, makeColorizer, windowCorners, type LayerId } from './heatmap';
import { paletteColor } from './palettes';

const layers = Object.keys(LAYERS) as LayerId[];

describe('makeColorizer', () => {
  it.each(layers)('%s is transparent for missing data', (layer) => {
    expect(makeColorizer(layer, 'green')(Number.NaN)).toEqual([0, 0, 0, 0]);
  });

  it('hides unsuitable cells and shows suitable ones on the suitability layer', () => {
    const color = makeColorizer('suitability', 'green');
    expect(color(0)[3]).toBe(0);
    expect(color(1)[3]).toBeGreaterThan(200);
    expect(color(0.5)[3]).toBeGreaterThan(color(0.2)[3]);
  });

  it('paints good terrain with the best palette color and bad terrain with the worst', () => {
    const slope = makeColorizer('slope', 'traffic');
    expect(Array.from(slope(2)).slice(0, 3)).toEqual(Array.from(paletteColor('traffic', 1)));
    expect(Array.from(slope(45)).slice(0, 3)).toEqual(Array.from(paletteColor('traffic', 0)));
    // The same value gets a different color in another palette.
    expect(makeColorizer('slope', 'viridis')(45).slice(0, 3)).not.toEqual(slope(45).slice(0, 3));
  });

  it('shows vegetation only where there is some', () => {
    const canopy = makeColorizer('canopy', 'green');
    expect(canopy(0.1)[3]).toBe(0);
    expect(canopy(8)[3]).toBeGreaterThan(0);
  });

  it('ranks values consistently: flatter, smoother and more open is better', () => {
    expect(LAYERS.slope.goodness(3)).toBeGreaterThan(LAYERS.slope.goodness(20));
    expect(LAYERS.roughness.goodness(0.05)).toBeGreaterThan(LAYERS.roughness.goodness(0.4));
    expect(LAYERS.canopy.goodness(0)).toBeGreaterThan(LAYERS.canopy.goodness(9));
  });
});

describe('windowCorners', () => {
  it('returns the corners of the window around the right place, about its size apart', () => {
    // 1 km window at the Glarus Sud test tile.
    const c = windowCorners({ e0: 2722000, n0: 1205000, cell: 2, width: 500, height: 500 });
    expect(c).toHaveLength(4);
    const dLat = Math.abs(c[0]![0] - c[3]![0]) * 111_200;
    expect(dLat).toBeGreaterThan(950);
    expect(dLat).toBeLessThan(1050);
    for (const [lat, lon] of c) {
      expect(lat).toBeGreaterThan(46.97);
      expect(lat).toBeLessThan(47.01);
      expect(lon).toBeGreaterThan(9.03);
      expect(lon).toBeLessThan(9.09);
    }
  });
});
