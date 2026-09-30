import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUITABILITY,
  dilateMask,
  flatSurfaceMask,
  patchMinimum,
  pitchSuitability,
  type SuitabilityParams,
} from './analysis';

const W = 40;
const H = 30;

function grid(fn: (x: number, y: number) => number): Float32Array {
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = fn(x, y);
  return g;
}

describe('flatSurfaceMask', () => {
  // Left half: a lake at exactly 1421 m. Right half: a pasture with 5 cm of relief per cell.
  const z = grid((x, y) => (x < 20 ? 1421 : 1500 + ((x * 7 + y * 13) % 5) * 0.05));
  const mask = flatSurfaceMask(z, W, H);

  it('marks the inside of a perfectly level surface', () => {
    expect(mask[15 * W + 8]).toBe(1);
  });

  it('does not mark ground that varies even by centimeters', () => {
    expect(mask[15 * W + 30]).toBe(0);
  });

  it('does not mark the shore, where the neighbourhood includes the bank', () => {
    const bank = grid((x) => (x < 20 ? 1421 : 1421 + (x - 19) * 0.5));
    expect(flatSurfaceMask(bank, W, H)[15 * W + 21]).toBe(0);
  });

  it('is NaN at the border and where there is no data', () => {
    const holes = grid(() => 1421);
    holes[15 * W + 15] = Number.NaN;
    const m = flatSurfaceMask(holes, W, H);
    expect(Number.isNaN(m[0]!)).toBe(true);
    expect(Number.isNaN(m[15 * W + 15]!)).toBe(true);
  });
});

describe('pitchSuitability with tunable parameters', () => {
  const one = (slope: number, params: Partial<SuitabilityParams> = {}, water?: number): number =>
    pitchSuitability(
      Float32Array.of(slope),
      Float32Array.of(0.02),
      undefined,
      { ...DEFAULT_SUITABILITY, ...params },
      water === undefined ? undefined : Float32Array.of(water),
    )[0]!;

  it('accepts steeper ground when the slope limits are raised', () => {
    expect(one(9)).toBeLessThan(0.15);
    expect(one(9, { slopeOkDeg: 8, slopeMaxDeg: 14 })).toBeGreaterThan(0.9);
  });

  it('rules ground out sooner when the limits are lowered', () => {
    expect(one(4)).toBeGreaterThan(0.95);
    expect(one(4, { slopeOkDeg: 2, slopeMaxDeg: 4 })).toBe(0);
  });

  it('always rules out lakes', () => {
    expect(one(0, {}, 1)).toBe(0);
    expect(one(0, {}, 0)).toBe(1);
  });

  it('grows a lake mask by the given radius and keeps the rest', () => {
    const mask = new Float32Array(5 * 5);
    mask[2 * 5 + 2] = 1;
    mask[0] = Number.NaN;
    const grown = dilateMask(mask, 5, 5, 1);
    expect(grown[1 * 5 + 1]).toBe(1);
    expect(grown[3 * 5 + 3]).toBe(1);
    expect(grown[0]).toBeNaN();
    expect(grown[4 * 5 + 4]).toBe(0);
  });
});

describe('patchMinimum radius from the parameters', () => {
  it('a larger patch needs a larger flat area', () => {
    const w = 15;
    const good = new Float32Array(w * w);
    for (let y = 4; y < 9; y++) for (let x = 4; x < 9; x++) good[y * w + x] = 1; // 5 x 5 patch
    const at = (r: number) => patchMinimum(good, w, w, r)[6 * w + 6];
    expect(at(0)).toBe(1);
    expect(at(1)).toBe(1);
    expect(at(2)).toBe(1); // a 5 x 5 patch still has its center
    expect(at(3)).toBe(0); // but not a 7 x 7 one
  });
});
