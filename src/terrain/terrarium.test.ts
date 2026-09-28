import { describe, expect, it } from 'vitest';
import { decodeTerrarium, decodeTerrariumPixels, sampleBilinear } from './terrarium';

/** Inverse of the Terrarium encoding, used only to build fixtures. */
function encode(elev: number): [number, number, number] {
  const v = elev + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v % 256);
  const b = Math.floor((v - Math.floor(v)) * 256);
  return [r, g, b];
}

describe('decodeTerrarium', () => {
  it('decodes sea level', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
  });

  it('decodes the documented formula', () => {
    // 2962 m = 128*256 + 2962 → R=139, G=146
    expect(decodeTerrarium(139, 146, 0)).toBe(2962);
    expect(decodeTerrarium(139, 146, 128)).toBe(2962.5);
  });

  it('decodes negative elevations', () => {
    expect(decodeTerrarium(...encode(-418.25))).toBe(-418.25);
  });
});

describe('decodeTerrariumPixels', () => {
  it('ignores alpha and decodes every pixel', () => {
    const rgba = new Uint8ClampedArray([...encode(100), 255, ...encode(2962), 255]);
    expect(Array.from(decodeTerrariumPixels(rgba))).toEqual([100, 2962]);
  });
});

describe('sampleBilinear', () => {
  const grid = new Float32Array([0, 10, 20, 30]); // 2×2

  it('returns exact values at pixel centers', () => {
    expect(sampleBilinear(grid, 2, 0.5, 0.5)).toBe(0);
    expect(sampleBilinear(grid, 2, 1.5, 1.5)).toBe(30);
  });

  it('interpolates between centers', () => {
    expect(sampleBilinear(grid, 2, 1, 1)).toBe(15);
  });

  it('clamps at the edges', () => {
    expect(sampleBilinear(grid, 2, 0, 0)).toBe(0);
    expect(sampleBilinear(grid, 2, 2, 2)).toBe(30);
  });
});
