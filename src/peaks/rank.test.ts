import { beforeAll, describe, expect, it } from 'vitest';
import { destinationPoint } from '../geo/geodesy';
import { computeScene } from '../horizon/pipeline';
import type { PanoramaScene } from '../horizon/scene';
import { coneTerrain, SyntheticSource } from '../terrain/syntheticSource';
import type { Peak } from './overpass';
import { angularProminence, rankPeaks } from './rank';
import { peakSightings, visiblePeaks } from './visibility';

const OBSERVER = { lat: 47, lon: 10, groundElev: 500, eyeHeight: 2 };

function at(bearing: number, distM: number) {
  return destinationPoint(OBSERVER.lat, OBSERVER.lon, bearing, distM);
}

function peakAt(id: number, bearing: number, distM: number, ele: number): Peak {
  return { id, ...at(bearing, distM), name: `Peak ${id}`, ele };
}

describe('peak ranking', () => {
  let scene: PanoramaScene;

  beforeAll(async () => {
    // Two isolated cones 30 km away (tall north, low east) and a broad 900 m plateau ridge
    // south, with a small bump on it.
    const terrain = coneTerrain(
      [
        { ...at(0, 30_000), height: 3000, radiusM: 4000 },
        { ...at(90, 30_000), height: 1200, radiusM: 4000 },
        { ...at(180, 30_000), height: 900, radiusM: 9000 },
        { ...at(182, 30_000), height: 100, radiusM: 1500 },
      ],
      500,
    );
    scene = await computeScene(new SyntheticSource(terrain), OBSERVER, {
      radiusM: 60_000,
      azStep: 0.25,
    });
  }, 60_000);

  const rank = (peaks: Peak[]) =>
    rankPeaks(scene, visiblePeaks(scene, peakSightings(scene, peaks), new Map()));

  it('gives an isolated summit real angular prominence', () => {
    const [p] = visiblePeaks(scene, peakSightings(scene, [peakAt(1, 0, 30_000, 3500)]), new Map());
    expect(angularProminence(scene, p!)).toBeGreaterThan(2);
  });

  it('gives a bump on a broad ridge little prominence', () => {
    const [p] = visiblePeaks(
      scene,
      peakSightings(scene, [peakAt(2, 182, 30_000, 1500)]),
      new Map(),
    );
    expect(angularProminence(scene, p!)).toBeLessThan(1);
  });

  it('ranks the tall isolated summit first and the ridge bump last', () => {
    const ranked = rank([
      peakAt(3, 182, 30_000, 1500),
      peakAt(1, 0, 30_000, 3500),
      peakAt(2, 90, 30_000, 1700),
    ]);
    expect(ranked.map((r) => r.peak.id)).toEqual([1, 2, 3]);
    expect(ranked[0]!.score).toBeLessThanOrEqual(1);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[2]!.score);
  });
});
