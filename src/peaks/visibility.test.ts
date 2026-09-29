import { beforeAll, describe, expect, it } from 'vitest';
import { destinationPoint } from '../geo/geodesy';
import { computeScene } from '../horizon/pipeline';
import type { PanoramaScene } from '../horizon/scene';
import { coneTerrain, SyntheticSource } from '../terrain/syntheticSource';
import { runningMaxAngle } from './crestLookup';
import type { Peak } from './overpass';
import { MIN_PEAK_DIST_M, needsDemElevation, peakSightings, visiblePeaks } from './visibility';

const OBSERVER = { lat: 47, lon: 10, groundElev: 500, eyeHeight: 2 };
const BASE = 500;

function peakAt(id: number, bearing: number, distM: number, ele: number | null): Peak {
  const p = destinationPoint(OBSERVER.lat, OBSERVER.lon, bearing, distM);
  return { id, lat: p.lat, lon: p.lon, name: `Peak ${id}`, ele };
}

describe('peak visibility', () => {
  let scene: PanoramaScene;
  // A 1000 m cone 20 km north (apex at ~2.7 deg), and a 4000 m cone 45 km north (apex at
  // ~4.9 deg, so only its upper part clears the first). A lone 1200 m cone 30 km east.
  const near = destinationPoint(OBSERVER.lat, OBSERVER.lon, 0, 20_000);
  const far = destinationPoint(OBSERVER.lat, OBSERVER.lon, 0, 45_000);
  const east = destinationPoint(OBSERVER.lat, OBSERVER.lon, 90, 30_000);

  beforeAll(async () => {
    const terrain = coneTerrain(
      [
        { ...near, height: 1000, radiusM: 4000 },
        { ...far, height: 4000, radiusM: 5000 },
        { ...east, height: 1200, radiusM: 3000 },
      ],
      BASE,
    );
    scene = await computeScene(new SyntheticSource(terrain), OBSERVER, {
      radiusM: 60_000,
      azStep: 0.25,
    });
  }, 60_000);

  it('reports no obstruction in an empty direction and one behind a crest', () => {
    expect(runningMaxAngle(scene, 200, 50_000)).toBeLessThan(0); // only the flat plane's skyline
    expect(runningMaxAngle(scene, 0, 30_000)).toBeGreaterThan(2); // the near cone
  });

  it('keeps peaks that stand clear and drops peaks hidden behind nearer terrain', () => {
    const peaks = [
      peakAt(1, 0, 20_000, 1500), // near summit, nothing in front
      peakAt(2, 0, 45_000, 4500), // far summit, taller than the near cone's skyline
      peakAt(3, 0, 45_000, 2000), // same distance, below the near cone's skyline (1.7 deg)
      peakAt(4, 90, 30_000, 1700), // isolated cone summit
    ];
    const visible = visiblePeaks(scene, peakSightings(scene, peaks), new Map());
    expect(visible.map((v) => v.peak.id).sort()).toEqual([1, 2, 4]);
  });

  it('ignores the observer summit and peaks beyond the radius', () => {
    const peaks = [peakAt(1, 10, MIN_PEAK_DIST_M - 100, 900), peakAt(2, 10, 61_000, 5000)];
    expect(peakSightings(scene, peaks)).toEqual([]);
  });

  it('prefers OSM elevation and falls back to the DEM value', () => {
    const noEle = peakAt(5, 90, 30_000, null);
    const sightings = peakSightings(scene, [noEle]);
    expect(needsDemElevation(sightings)).toHaveLength(1);
    expect(visiblePeaks(scene, sightings, new Map())).toEqual([]); // no elevation, dropped
    const withDem = visiblePeaks(scene, sightings, new Map([[5, 1700]]));
    expect(withDem).toHaveLength(1);
    expect(withDem[0]!.elev).toBe(1700);
    expect(withDem[0]!.angle).toBeGreaterThan(0);
  });
});
