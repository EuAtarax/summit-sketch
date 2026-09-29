import { beforeAll, describe, expect, it } from 'vitest';
import { destinationPoint } from '../geo/geodesy';
import { computeScene } from '../horizon/pipeline';
import type { PanoramaScene } from '../horizon/scene';
import { coneTerrain, SyntheticSource } from '../terrain/syntheticSource';
import { labelCandidatesFor, type LabelPipelineDeps } from './labelPipeline';
import type { Peak } from './overpass';

const OBSERVER = { lat: 47, lon: 10, groundElev: 500, eyeHeight: 2 };

function peakAt(id: number, bearing: number, distM: number, ele: number | null): Peak {
  const p = destinationPoint(OBSERVER.lat, OBSERVER.lon, bearing, distM);
  return { id, ...p, name: `Peak ${id}`, ele };
}

describe('labelCandidatesFor', () => {
  let scene: PanoramaScene;

  beforeAll(async () => {
    const tall = destinationPoint(OBSERVER.lat, OBSERVER.lon, 0, 30_000);
    const low = destinationPoint(OBSERVER.lat, OBSERVER.lon, 90, 30_000);
    scene = await computeScene(
      new SyntheticSource(
        coneTerrain(
          [
            { ...tall, height: 3000, radiusM: 4000 },
            { ...low, height: 1200, radiusM: 4000 },
          ],
          500,
        ),
      ),
      OBSERVER,
      { radiusM: 60_000, azStep: 0.25 },
    );
  }, 60_000);

  it('labels visible peaks best first and takes missing elevations from the DEM', async () => {
    const peaks = [
      peakAt(1, 90, 30_000, 1700), // OSM elevation
      peakAt(2, 0, 30_000, null), // DEM elevation, tallest
      peakAt(3, 180, 30_000, 800), // a bump on flat terrain, also visible
      peakAt(4, 0, 90_000, 4000), // outside the 60 km radius
    ];
    let demQueries = 0;
    const deps: LabelPipelineDeps = {
      loadPeaks: async () => peaks,
      elevations: async (points) => {
        demQueries = points.length;
        return Float32Array.from(points, () => 3500);
      },
    };
    const labels = await labelCandidatesFor(scene, deps);
    expect(demQueries).toBe(1);
    expect(labels.map((l) => l.id)).not.toContain(4);
    expect(labels[0]).toMatchObject({ id: 2, name: 'Peak 2' });
    expect(labels.map((l) => l.id)).toContain(1);
  });

  it('skips the DEM call when every peak has an OSM elevation', async () => {
    let called = false;
    const deps: LabelPipelineDeps = {
      loadPeaks: async () => [peakAt(1, 90, 30_000, 1700)],
      elevations: async () => {
        called = true;
        return new Float32Array(0);
      },
    };
    expect(await labelCandidatesFor(scene, deps)).toHaveLength(1);
    expect(called).toBe(false);
  });

  it('drops peaks whose DEM elevation is unknown', async () => {
    const deps: LabelPipelineDeps = {
      loadPeaks: async () => [peakAt(2, 0, 30_000, null)],
      elevations: async (points) => Float32Array.from(points, () => Number.NaN),
    };
    expect(await labelCandidatesFor(scene, deps)).toEqual([]);
  });
});
