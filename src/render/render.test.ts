import { describe, expect, it } from 'vitest';
import type { PanoramaScene } from '../horizon/scene';
import { LEVELS, levelFor, sceneAngleRange, TILE_PX, visibleTiles } from './tiles';
import { createViewTransform, gridStep, wrap180, wrap360 } from './viewTransform';

describe('wrap helpers', () => {
  it('fold angles', () => {
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-190)).toBe(170);
    expect(wrap360(-10)).toBe(350);
    expect(wrap360(720)).toBe(0);
  });
});

describe('createViewTransform', () => {
  const v = createViewTransform({
    width: 600,
    height: 300,
    azStart: 350,
    pxPerDeg: 10,
    angleAtTop: 5,
  });

  it('maps azimuths across north continuously', () => {
    expect(v.azToX(350)).toBeCloseTo(0, 9);
    expect(v.azToX(0)).toBeCloseTo(100, 9);
    expect(v.azToX(40)).toBeCloseTo(500, 9);
  });

  it('gives negative x just left of the view instead of wrapping', () => {
    expect(v.azToX(345)).toBeCloseTo(-50, 9);
  });

  it('maps angles downward from angleAtTop, with exaggeration', () => {
    expect(v.angleToY(5)).toBe(0);
    expect(v.angleToY(-5)).toBe(100);
    const e = createViewTransform({
      width: 1,
      height: 1,
      azStart: 0,
      pxPerDeg: 10,
      angleAtTop: 0,
      exaggeration: 2,
    });
    expect(e.angleToY(-1)).toBe(20);
  });
});

describe('gridStep', () => {
  it('picks the smallest step at least minPx apart', () => {
    expect(gridStep(30, 28)).toBe(1);
    expect(gridStep(7, 28)).toBe(5);
    expect(gridStep(100, 28)).toBe(0.5);
  });
});

describe('levels', () => {
  it('tiles the full circle exactly', () => {
    for (const l of LEVELS) expect(l.n * l.tileDeg).toBeCloseTo(360, 9);
  });

  it('picks the coarsest level with enough resolution', () => {
    const l = levelFor(20);
    expect(l.ppd).toBeGreaterThanOrEqual(20 * 0.97);
    expect(LEVELS[l.index - 1]!.ppd).toBeLessThan(20 * 0.97);
  });
});

describe('visibleTiles', () => {
  const level = LEVELS[2]!; // 8 tiles, 45° each
  const content = { top: 10, bottom: -30 };

  it('covers a view that crosses north with wrapped columns', () => {
    const tiles = visibleTiles(
      level,
      { azLeft: -20, angleTop: 10, ppd: level.ppd, width: 500, height: 100 },
      content,
    );
    const cols = [...new Set(tiles.map((t) => t.kx))];
    expect(cols).toEqual([-1, 0]); // -20°..+24°: tile 7 (315–360°) then tile 0
    expect(tiles[0]!.x).toBeCloseTo((-45 + 20) * level.ppd, 6);
    expect(tiles[0]!.size).toBe(TILE_PX);
  });

  it('only returns rows inside the content', () => {
    const fine = LEVELS[4]!; // 22.8 px/deg: 40° of content = 910 px = 2 rows
    const tiles = visibleTiles(
      fine,
      { azLeft: 0, angleTop: 50, ppd: fine.ppd, width: 10, height: 10_000 },
      content,
    );
    const rows = [...new Set(tiles.map((t) => t.ky))];
    expect(rows).toEqual([0, 1]);
  });
});

describe('sceneAngleRange', () => {
  it('adds sky above the horizon and room below the lowest feature', () => {
    const scene = {
      horizonAngle: Float32Array.from([1, 2, NaN]),
      ridgelines: [{ points: [{ az: 0, angle: -12, dist: 1, elev: 0 }], minDist: 1, maxDist: 1 }],
      sea: {
        offsets: new Uint32Array(4),
        lo: Float32Array.from([-15]),
        hi: Float32Array.from([-3]),
      },
    } as unknown as PanoramaScene;
    expect(sceneAngleRange(scene)).toEqual({ top: 5, bottom: -17 });
  });
});
