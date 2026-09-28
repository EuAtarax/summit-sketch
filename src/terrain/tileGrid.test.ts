import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../geo/tiles';
import { TileGrid, tilesInBox } from './tileGrid';

/** Tile whose value at a pixel equals its global pixel x (a linear ramp in x). */
function rampTile(tx: number): Float32Array {
  const t = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) t[py * TILE_SIZE + px] = tx * TILE_SIZE + px;
  }
  return t;
}

describe('TileGrid', () => {
  it('samples pixel centers exactly', () => {
    const g = new TileGrid(2);
    g.set(1, 1, rampTile(1));
    expect(g.sample(300.5, 300.5)).toBe(300);
  });

  it('interpolates across a tile boundary', () => {
    const g = new TileGrid(2);
    g.set(0, 1, rampTile(0));
    g.set(1, 1, rampTile(1));
    // Between pixel 255 (tile 0) and pixel 256 (tile 1).
    expect(g.sample(256, 300.5)).toBeCloseTo(255.5, 6);
  });

  it('interpolates across a tile corner', () => {
    const g = new TileGrid(2);
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      g.set(x, y, rampTile(x));
    }
    expect(g.sample(256, 256)).toBeCloseTo(255.5, 6);
  });

  it('wraps x across the antimeridian', () => {
    const g = new TileGrid(1); // 2 tiles wide, 512 px
    g.set(0, 0, rampTile(0));
    g.set(1, 0, rampTile(1));
    // Halfway between pixel 511 (value 511) and pixel 0 (value 0).
    expect(g.sample(512, 100.5)).toBeCloseTo(255.5, 6);
  });

  it('returns NaN when a tile is missing', () => {
    const g = new TileGrid(3);
    expect(g.sample(10, 10)).toBeNaN();
  });
});

describe('tilesInBox', () => {
  it('lists every overlapped tile, wrapping x and clamping y', () => {
    const tiles = tilesInBox(1, -10, -10, 10, 10);
    expect(tiles).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});
