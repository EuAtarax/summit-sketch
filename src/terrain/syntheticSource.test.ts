import { describe, expect, it } from 'vitest';
import { TILE_SIZE, tileToLonLat } from '../geo/tiles';
import { SyntheticSource } from './syntheticSource';

describe('SyntheticSource', () => {
  it('evaluates the terrain function at pixel centers', async () => {
    const src = new SyntheticSource((lat, lon) => lat * 1000 + lon);
    const tile = await src.getTile(10, 533, 360);
    const p = tileToLonLat(533 + 17.5 / TILE_SIZE, 360 + 42.5 / TILE_SIZE, 10);
    expect(tile[42 * TILE_SIZE + 17]).toBeCloseTo(p.lat * 1000 + p.lon, 1);
  });
});
