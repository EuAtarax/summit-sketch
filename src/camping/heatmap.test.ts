import { describe, expect, it } from 'vitest';
import { LAYERS, makeColorizer, overlayGrid, paintOverlay, type LayerId } from './heatmap';
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

describe('special layers', () => {
  it('colors lakes blue whatever the palette', () => {
    const a = makeColorizer('water', 'green')(1);
    const b = makeColorizer('water', 'magma')(1);
    expect(a).toEqual(b);
    expect(a[3]).toBeGreaterThan(100);
    expect(makeColorizer('water', 'green')(0)[3]).toBe(0);
  });

  it('shows protection in force stronger than protection out of season, and nothing elsewhere', () => {
    const c = makeColorizer('protected', 'green');
    expect(c(0)[3]).toBe(0);
    expect(c(1)[3]).toBeGreaterThan(0);
    expect(c(2)[3]).toBeGreaterThan(c(1)[3]);
    expect(c(2)[0]).toBeGreaterThan(c(1)[0] - 100);
  });

  it('draws the camp score like the terrain-only suitability', () => {
    const score = makeColorizer('score', 'viridis');
    const terrain = makeColorizer('suitability', 'viridis');
    expect(score(0.8)).toEqual(terrain(0.8));
  });
});

describe('overlayGrid and paintOverlay', () => {
  // 100 x 100 cells of 2 m near Schwanden GL.
  const g = { e0: 2722000, n0: 1205000, cell: 2, width: 100, height: 100 };
  const og = overlayGrid(g);

  it('maps every pixel to a cell of the grid, or to -1 in the corners the rotation leaves', () => {
    expect(og.cells).toHaveLength(og.width * og.height);
    expect(Math.max(og.width, og.height)).toBe(1200);
    const inside = og.cells.filter((c) => c >= 0).length;
    expect(inside / og.cells.length).toBeGreaterThan(0.95);
    expect(og.cells.reduce((m, c) => Math.max(m, c), -1)).toBeLessThan(g.width * g.height);
  });

  it.each(layers)('paints %s like makeColorizer', (layer) => {
    const values = Float32Array.from({ length: 100 * 100 }, (_, i) =>
      layer === 'water' || layer === 'protected' ? i % 3 : (i % 97) / 7,
    );
    values[0] = Number.NaN;
    const rgba = paintOverlay(og, values, layer, 'viridis');
    const color = makeColorizer(layer, 'viridis');
    for (let p = 0; p < og.cells.length; p += 997) {
      const cell = og.cells[p]!;
      const expected = cell < 0 ? [0, 0, 0, 0] : Array.from(color(values[cell]!));
      const got = Array.from(rgba.subarray(p * 4, p * 4 + 4));
      // Palette colors come from a 256-step table; alpha is exact up to rounding.
      got.forEach((v, k) => expect(Math.abs(v - expected[k]!)).toBeLessThanOrEqual(2));
    }
  });
});
